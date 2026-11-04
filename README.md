# GenUI Agent

A visual layer over your real agent sessions. Each agent is the actual harness (Claude Code, Codex, Grok) in its own terminal, looking and working exactly as it does at home. Beside it, a rail shows where the plan stands: the step it's on, what it's doing right now, and, in amber, when it needs you. When you're not sure how to answer one of its questions, **Discuss it** opens a side agent that knows the session; the answer you settle on goes in as your next message, so the main session's context only grows by that answer.

GenUI is a wrapper: it runs your installed harness unmodified, so harness updates arrive by themselves. It watches through official interfaces where they exist, and the only key it ever presses in the harness's own menus is a single Esc to close a question you have answered on the side (see [How it stays a wrapper](#how-it-stays-a-wrapper)).

## Start it

```
npm install
npm run setup     # writes the launcher and puts "GenUI Agent" on your desktop
```

Then double-click **GenUI Agent** on the desktop. It starts a small local server (only reachable from this computer) and opens the app in its own window. Closing the window doesn't stop running sessions; double-click again to reopen it.

Needs Node 22+, and whichever of `claude`, `codex` and `grok` you use, already signed in.

## What it does

- **Agent view**: a session started from the app is its real CLI in a terminal, with the plan rail beside it. Its questions and approvals stay in the harness's own menus, answered in the terminal as usual. Claude Code sessions get GenUI's hooks for that session only; they only report (what was asked, what needs approval, when a question is answered or cancelled, when a turn ends). The current step is blue while the agent works, amber when it needs you, grey when it's your turn. Click the amber step to see what it needs.
- **Saved sessions**: everything in `~/.claude/projects`, `~/.codex/sessions` and `~/.grok/sessions`, read-only. Open one to see its generated goal and flow. Resuming one is a deliberate two-step action.
- **Flowchart**: two sources you can switch between in the rail. **Instant** is built by code from the transcript as it happens (`server/flowdraft.js`): each message you send that asks for something is a goal (the first is the trunk, later ones branch off it; a short "yes / go ahead" continues the current one) and the agent's actions become steps ("Read 4 files", "Edit NavbarV3.tsx ×3", "Run npm test"). **AI**: the app asks Claude (Sonnet, tools off) to read the conversation and keep a flowchart of it as it unfolds: the first goal is the trunk, every new request or change of direction branches off it, and the agent's work sits under each as steps. It only grows: each update reads what's new and returns changes to the tree, and finished or dropped steps are never reworded or removed (rules in `server/flowtree.js`), so you can follow a long conversation from start to now. Finished branches fold to one line. It refreshes when a turn ends and, during long turns, every few tool calls or about once a minute (`GENUI_MIDTURN_TOOLS`, default 6; `GENUI_MIDTURN_SEC`, default 60). The same call reads any questions in the agent's last reply as cards from a fixed kit (choice, approval, answer, teammate, checklist, note); answers go to the agent as one message. Claude Code itself runs unchanged: the app only reads its transcript.
- **Discuss it** (one of two entry points; the other is a new session): on a question the agent asked, it opens a side agent in the rail with the question pinned. For a Claude Code session it is a real fork (`claude --resume <id> --fork-session`) with read-only tools, so it knows the whole session and the original is untouched; for Codex and Grok it is a Claude Code session that reads that transcript. Type straight away; **Answer with this** writes the answer, which lands under the question for you to check, and **Send** puts it in (below). The discussion stays listed under the flowchart, read-only. Quick asides about the work use Claude Code's own `/btw`; anything unrelated is a **New session** (the **+** in the header starts one in the same folder).
- **Research**: `research/genui-landscape.md` surveys how other generative-UI systems work and what that means here.
- **Orchestrator**: the agents started here, running ones first, each with its step and what it's doing or needs; then plans and the agents that ended. **New goal** plans a goal into steps (Opus, read-only look at the folder), assigns a harness to each, predicts the questions each step will need, and starts a fresh worker per step with the plan and your early answers.

## Layout

| Path | What |
|---|---|
| `server/index.js` | HTTP + WebSocket server, routes, opens the window |
| `server/live.js` | Terminals (node-pty), a headless copy of each screen, Claude Code hooks, session state |
| `server/hook-client.mjs` | The hook command Claude Code runs; tells the app what happened and returns at once |
| `server/transcripts.js` | Reads all three harnesses' saved sessions into one shape |
| `server/genui.js` | Conversation → flowchart updates and cards (structured output) |
| `server/flowtree.js` | The flowchart's rules: a tree that only grows |
| `server/side.js` | Side discussions (forks) and composed answers |
| `server/plan.js` | The orchestrator's planner |
| `web/` | The window: `app.js`, `app.css`, `util.js` |
| `research/` | The design study of @pitus_'s Generative UI series; `DESIGN.md` is the spec |
| `prototypes/` | The earlier click-through mockups |
| `tests/` | `npm test` (unit), `npm run test:e2e` (drives a real Claude Code session in `sandbox/`) and `npm run test:ui` (clicks through the app in headless Chrome: the agent view, New goal) |

App data (token, generated-UI cache, side discussions, logs) lives in `~/.genui-agent`.

## How answering works

- **The agent's own questions** (Claude Code's AskUserQuestion) and **approvals** appear in its terminal, as always; pick there if you know the answer. The amber step shows the question with **Discuss it** and **Copy** (to ask a teammate). When you send an answer worked out on the side, GenUI presses Esc once to close the question menu, waits for Claude Code's hook to confirm it closed, then types the answer as your next message ("About your question …").
- **Questions in its reply** are ones GenUI Agent read from the agent's last message, shown as cards under the amber step. Answers are collected (each card shows "not sent yet") and go together as one message with **Send N answers**. Answers you haven't sent survive the agent's next turn.
- **Discuss it** on a card works the same way; **Answer with this** fills in that card, and its answer goes with the others.
- **New session**: type your first message and press Enter; the harness starts in that folder with exactly that message, as in your terminal. **Plan a goal** (on the Orchestrator page) breaks a bigger goal into steps, each run by its own agent.
- **Stop** asks first; a stopped session dims its terminal and offers **Resume**, **New session here** and **Close** (Close takes it off the running list; it stays in your saved sessions).
- When the window isn't in front, the title shows `(N) GenUI Agent` and Windows notifications appear for questions, approvals and finished turns.

## How it stays a wrapper

GenUI launches your installed `claude` (or `codex`, `grok`) unchanged; it adds only a per-session settings file with its hooks. What it relies on, and how likely a harness update is to affect it:

| What | How | If the harness changes |
|---|---|---|
| Question asked / answered / cancelled, approval needed, turn ended | Claude Code [hooks](https://code.claude.com/docs/en/hooks) (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, …) | Official and documented |
| Side discussions | `claude --resume <id> --fork-session` | Official |
| Putting an answer in | Typing it into the terminal GenUI owns, as your next message; if a question menu is open, one Esc first, confirmed by the `PostToolUseFailure` hook | Plain keyboard input |
| The flowchart's content | Reading the saved transcript (`~/.claude/projects/…jsonl`) | Not a documented format: read defensively, so an unknown line is skipped rather than breaking anything |
| Noticing sooner that a menu closed or a turn ended | Reading the screen (Claude Code's footer and menus) | A speed-up only: if the wording changes, the hooks still carry the state |

Claude Code's official way to push messages into a running session, [channels](https://code.claude.com/docs/en/channels), is a research preview that needs an MCP plugin and a launch flag; typing into the terminal does the same job without them.

## Security

The server listens on 127.0.0.1 only and answers only to its exact host and origin. The window is opened with a one-time launch code (valid 60 seconds) and gets a per-launch cookie; requests from other local ports are refused. The install token in `~/.genui-agent/token` can only mint a launch code (and unlock the API for the test suite when `GENUI_TEST=1`). Each Claude Code session gets its own hook secret, and Codex/Grok sessions get no GenUI credentials. Text sent into a terminal is stripped of control characters. Planner and side-chat calls load only your user-level Claude settings and no MCP servers, never a project folder's own settings.

The remaining limit is the usual one for local tools: a program already running as your Windows user can read your files, including that token, so it could open its own window onto the app. Don't run untrusted code as your own user.
