# GenUI Agent

A visual layer over your real agent sessions, built for coming back to many agents and catching up. Each agent is the actual harness (Claude Code, Codex, Grok) in its own terminal, looking and working exactly as it does at home. Beside it, a rail shows what happened while you were away, everything the agent still needs from you (over the whole session, not only its last reply), and a timeline of the session you can click into. You answer it all in one reply. When you're not sure how to answer, **Discuss it** opens a side chat with its own agent that knows the session; the answer you settle on goes into your reply, so the main session's context only grows by that answer.

GenUI is a wrapper: it runs your installed harness unmodified, so harness updates arrive by themselves. It watches through official interfaces where they exist, and the only key it ever presses in the harness's own menus is a single Esc to close a question you have answered on the side (see [How it stays a wrapper](#how-it-stays-a-wrapper)).

## Start it

```
npm install
npm run setup     # writes the launcher and puts "GenUI Agent" on your desktop
```

Then double-click **GenUI Agent** on the desktop. It starts a small local server (only reachable from this computer) and opens the app in its own window. Closing the window doesn't stop running sessions; double-click again to reopen it.

Needs Node 22+, and whichever of `claude`, `codex` and `grok` you use, already signed in.

## What it does

- **Agent view**: a session started from the app is its real CLI in a terminal, with the rail beside it. Claude Code sessions get GenUI's hooks for that session only; they only report (what was asked, what needs approval, when a question is answered or cancelled, when a turn ends). The rail, top to bottom:
  - **While you were away**: how many steps happened since you last looked at this session, and what they did. The same steps carry a blue dot in the timeline, below a "Since you were away" line. What you've seen is recorded when you leave the session or the window.
  - **Needs from you**: everything the agent is waiting on. First what its terminal is waiting on now (an approval, folder trust, a failed turn); then every question it asked over the whole session that you haven't answered properly, oldest first. A question asked before your latest message and still unanswered is marked "open 2h 5m" in amber. Each one links to its step. Pick an option, or write your own; your answers gather in **Your reply**, which you can edit, and **Send** types it in as one message. Answered questions clear at once.
  - **Flowchart**: the session as one timeline, top to bottom. Each message you sent starts a section headed by your own words ("You started", "You asked", "You changed direction"); the agent's steps sit under it. Work set aside when you changed direction steps off the line with a ×. The step it's on is blue while it works, amber when it needs you, grey when it's your turn. Click any step to see what happened in it: a summary, the files it touched (with lines added and removed), the commands it ran and their results, what the agent said, and what it asked and how you answered. **Show in the terminal** finds it in the scrollback.
- **Saved sessions**: everything in `~/.claude/projects`, `~/.codex/sessions` and `~/.grok/sessions`, read-only. Open one to see its generated goal and flow. Resuming one is a deliberate two-step action.
- **How the timeline is built**: in two layers. Code builds it from the transcript the moment anything happens (`server/timeline.js`): your messages, the agent's actions grouped into steps ("Read 4 files", "Edit NavbarV3.tsx ×3", "Run npm test") with their files, commands, results and the agent's words, and Claude Code's menu questions with their answers. A short "yes" or an answer continues a section; "no, …" or "actually …" starts one as a change of direction. Then AI (Claude Sonnet, tools off, `server/genui.js`) reads what is new and adds what code can't know: a one-line summary per step, which messages changed direction and which work that dropped, a "Did" line, and the list of asks: every question the agent put to you in its replies, kept open until a later message of yours actually answers it. It only grows: notes and settled asks are never rewritten. It runs when a turn ends and, during long turns, every few tool calls or about once a minute (`GENUI_MIDTURN_TOOLS`, default 6; `GENUI_MIDTURN_SEC`, default 60). Until it has read a turn, a question at the end of that turn still shows, straight from code.
- **Side agents** (a fork of the session, multi-step, read-only tools; for a Claude Code session it is a real fork, `claude --resume <id> --fork-session`, so it knows the whole session and the original is untouched; for Codex and Grok it is a Claude Code session that reads that transcript). Two ways in:
  - **Discuss it**, on any question in Needs from you: a side chat opens in the rail with its own side agent, the question pinned on top; type straight away, or pick a suggestion. **Answer with this** writes the answer in one line into your reply (selecting the option it names), marks the question "Worked out on the side", and brings the rail back. **Continue discussion** reopens it.
  - **Ask on the side**, at the bottom of the rail, any time: your own side conversation about the session, as many messages as you like. **Write a message** drafts something for the agent in the panel; edit it and **Send**, or keep talking. Nothing reaches the session otherwise.
  Both stay listed under the flowchart ("On the side"). Anything unrelated is a **New session**: the **+** in the header starts one in the same folder.
- **Research**: `research/genui-landscape.md` surveys how other generative-UI systems work and what that means here.
- **Orchestrator**: every agent started here, for when you come back. "Welcome back. You were away 2h 14m" when you've been gone a while. Each row: its state (needs you, your turn, working) and how many answers it needs; **Did** (what it did lately) and **Needs** (which answers), **Now** (what it's doing) or **Next**; the session as a line of dots (rings for your messages, amber for open questions, a dashed tick where you left off, × for dropped work); and how many steps are new since you looked. **All needs** lists every open question across all agents; click one to answer it in its session. **Plan a goal** plans a goal into steps (Opus, read-only look at the folder), assigns a harness to each, predicts the questions each step will need, and starts a fresh worker per step with the plan and your early answers.

## Layout

| Path | What |
|---|---|
| `server/index.js` | HTTP + WebSocket server, routes, opens the window |
| `server/live.js` | Terminals (node-pty), a headless copy of each screen, Claude Code hooks, session state |
| `server/hook-client.mjs` | The hook command Claude Code runs; tells the app what happened and returns at once |
| `server/transcripts.js` | Reads all three harnesses' saved sessions into one shape |
| `server/timeline.js` | The timeline, built by code from the transcript: sections, steps and what each touched |
| `server/genui.js` | The timeline's AI layer: step summaries, changes of direction, dropped work, and the asks kept over the whole session |
| `server/side.js` | Side discussions (forks) and composed answers |
| `server/plan.js` | The orchestrator's planner |
| `web/` | The window: `app.js`, `app.css`, `util.js` |
| `research/` | The design study of @pitus_'s Generative UI series; `DESIGN.md` is the spec |
| `prototypes/` | The earlier click-through mockups |
| `tests/` | `npm test` (unit), `npm run test:e2e` (drives a real Claude Code session in `sandbox/`) and `npm run test:ui` (clicks through the app in headless Chrome, on its own port and data folder: the agent view and catching up, New goal) |

App data (token, generated-UI cache, side discussions, logs) lives in `~/.genui-agent`.

## How answering works

- **Everything it asked is in Needs from you**: questions in its replies (read by the AI layer, and kept until you answer them) and Claude Code's own menu questions (AskUserQuestion, with their options). Approvals stay in its terminal; the card says so and takes you there.
- **One reply**: pick or write answers; they gather as "About your questions: 1. … 2. …". Edit it freely, add anything else, and **Send**. If a menu question is open, GenUI presses Esc once to close it, waits for Claude Code's hook to confirm, then types the reply as your next message. Questions you didn't answer stay on the list.
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
