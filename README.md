# GenUI Agent

A visual layer over your real agent sessions. Each agent is the actual harness (Claude Code, Codex, Grok) in its own terminal, looking and working exactly as it does at home. Beside it, a rail shows where the plan stands: the step it's on, what it's doing right now, and, in amber, when it needs you. When you're not sure how to answer one of its questions, **Discuss it** opens a side chat that knows the session; the answer you settle on goes back into the agent's own menu, so the main session's context only grows by that answer.

## Start it

```
npm install
npm run setup     # writes the launcher and puts "GenUI Agent" on your desktop
```

Then double-click **GenUI Agent** on the desktop. It starts a small local server (only reachable from this computer) and opens the app in its own window. Closing the window doesn't stop running sessions; double-click again to reopen it.

Needs Node 22+, and whichever of `claude`, `codex` and `grok` you use, already signed in.

## What it does

- **Agent view**: a session started from the app is its real CLI in a terminal, with the plan rail beside it. Its questions and approvals stay in the harness's own menus, answered in the terminal as usual. Claude Code sessions get GenUI's hooks for that session only; they only report (what was asked, what needs approval), and the app reads the terminal's screen to know when a menu is open. The current step is blue while the agent works, amber when it needs you, grey when it's your turn. Click the amber step to see what it needs.
- **Saved sessions**: everything in `~/.claude/projects`, `~/.codex/sessions` and `~/.grok/sessions`, read-only. Open one to see its generated goal and flow. Resuming one is a deliberate two-step action.
- **Flowchart**: the app asks Claude (Sonnet, tools off) to read the conversation and keep a flowchart of it as it unfolds: the first goal is the trunk, every new request or change of direction branches off it, and the agent's work sits under each as steps. It only grows: each update reads what's new and returns changes to the tree, and finished or dropped steps are never reworded or removed (rules in `server/flowtree.js`), so you can follow a long conversation from start to now. Finished branches fold to one line. It refreshes when a turn ends and, during long turns, every few tool calls or about once a minute (`GENUI_MIDTURN_TOOLS`, default 6; `GENUI_MIDTURN_SEC`, default 60). The same call reads any questions in the agent's last reply as cards from a fixed kit (choice, approval, answer, teammate, checklist, note); answers go to the agent as one message. Claude Code itself runs unchanged: the app only reads its transcript.
- **Side discussion**: for a Claude Code session it's a real fork (`claude --resume <id> --fork-session`) with read-only tools, so it knows the whole session and the original is untouched. For Codex and Grok sessions it's a Claude Code session that reads that transcript. *Compose answer* writes one complete reply. For a question in Claude Code's menu, *Send answer* types it into the menu's own "Type something" option; otherwise *Send* types it into the session.
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

- **The agent's own questions** (Claude Code's AskUserQuestion) and **approvals** appear in its terminal, as always; pick there. The amber step shows the question and its options with **Discuss it**; the side chat's answer goes into the menu as if you'd typed it.
- **Questions in its reply** are ones GenUI Agent read from the agent's last message, shown as cards under the amber step. Answers are collected (each card shows "not sent yet") and go together as one message with **Send N answers**. Answers you haven't sent survive the agent's next turn.
- **Discuss it** on a card opens a side chat about it in the rail. **Use as the answer** puts the composed answer into the card; nothing reaches the session until you send.
- **New goal**: send to plan it into steps (a fresh worker per step, started when you say; steps marked "You" are yours to tick off), or **Start now** for one session in the harness shown.
- When the window isn't in front, the title shows `(N) GenUI Agent` and Windows notifications appear for questions, approvals and finished turns.

## Security

The server listens on 127.0.0.1 only and answers only to its exact host and origin. The window is opened with a one-time launch code (valid 60 seconds) and gets a per-launch cookie; requests from other local ports are refused. The install token in `~/.genui-agent/token` can only mint a launch code (and unlock the API for the test suite when `GENUI_TEST=1`). Each Claude Code session gets its own hook secret, and Codex/Grok sessions get no GenUI credentials. Text sent into a terminal is stripped of control characters. Planner and side-chat calls load only your user-level Claude settings and no MCP servers, never a project folder's own settings.

The remaining limit is the usual one for local tools: a program already running as your Windows user can read your files, including that token, so it could open its own window onto the app. Don't run untrusted code as your own user.
