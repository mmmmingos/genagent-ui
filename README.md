# GenUI Agent

A calm window over your real agent sessions. It runs the actual harnesses (Claude Code, Codex, Grok) in terminals it owns, reads what each session is doing, and shows it as a goal, a flow and a card for each thing the agent is waiting on you for. When you're not sure how to answer, you talk it through in a side discussion and send back one complete answer, so the main session's context only grows by that answer.

## Start it

```
npm install
npm run setup     # writes the launcher and puts "GenUI Agent" on your desktop
```

Then double-click **GenUI Agent** on the desktop. It starts a small local server (only reachable from this computer) and opens the app in its own window. Closing the window doesn't stop running sessions; double-click again to reopen it.

Needs Node 22+, and whichever of `claude`, `codex` and `grok` you use, already signed in.

## What it does

- **Running here**: sessions started from the app. Each is the real CLI in a terminal (the Terminal tab). Claude Code sessions get GenUI's hooks for that session only, so:
  - multiple-choice questions (AskUserQuestion) appear as cards and your pick is passed straight to Claude Code;
  - permission requests can be allowed or denied from the card;
  - folder-trust and other terminal prompts become cards too.
- **Saved sessions**: everything in `~/.claude/projects`, `~/.codex/sessions` and `~/.grok/sessions`, read-only. Open one to see its generated goal and flow. Resuming one is a deliberate two-step action.
- **Generated UI**: after each turn the app asks Claude (Sonnet, tools off) to read the transcript and return the goal, the flow and the open questions as cards from a fixed kit: choice, approval, answer, teammate, checklist, note. Answers you give collect in a tray and go to the agent as one message.
- **Side discussion**: for a Claude Code session it's a real fork (`claude --resume <id> --fork-session`) with read-only tools, so it knows the whole session and the original is untouched. For Codex and Grok sessions it's a Claude Code session that reads that transcript. *Compose answer* writes one complete reply; *Send* types it into the main session.
- **Orchestrator**: every session as a flow. **New goal** plans a goal into steps (Opus, read-only look at the folder), assigns a harness to each, predicts the questions each step will need, and starts a fresh worker per step with the plan and your early answers.

## Layout

| Path | What |
|---|---|
| `server/index.js` | HTTP + WebSocket server, routes, opens the window |
| `server/live.js` | Terminals (node-pty), Claude Code hooks, session state |
| `server/hook-client.mjs` | The hook command Claude Code runs; forwards to the app and waits for answers |
| `server/transcripts.js` | Reads all three harnesses' saved sessions into one shape |
| `server/genui.js` | Transcript → goal, flow and cards (structured output) |
| `server/side.js` | Side discussions (forks) and composed answers |
| `server/plan.js` | The orchestrator's planner |
| `web/` | The window: `app.js`, `app.css`, `util.js` |
| `research/` | The design study of @pitus_'s Generative UI series; `DESIGN.md` is the spec |
| `prototypes/` | The earlier click-through mockups |
| `tests/` | `npm test` (unit) and `npm run test:e2e` (drives a real Claude Code session in `sandbox/`) |

App data (token, generated-UI cache, side discussions, logs) lives in `~/.genui-agent`.

## How answering works

- **Asked directly** cards are the agent's own multiple-choice questions (Claude Code's AskUserQuestion). Your pick goes straight to it after a 2-second undo window; typing in the composer while one is open answers it too.
- **From the reply** cards are questions GenUI Agent read from the agent's last message. Answers are collected (each card shows "not sent yet") and go together as one message with **Send N answers**. Answers you haven't sent survive the agent's next turn.
- **Discuss it** opens a side chat about that card. **Use as the answer** puts the composed answer into the card; nothing reaches the session until you send.
- **New goal**: send to plan it into steps (a fresh worker per step, started when you say; steps marked "You" are yours to tick off), or **Start now** for one session in the harness shown.
- When the window isn't in front, the title shows `(N) GenUI Agent` and Windows notifications appear for questions, approvals and finished turns.

## Security

The server listens on 127.0.0.1 only and answers only to its exact host and origin. The window gets a per-launch cookie (the install token is only exchanged for it); API calls from other local ports are refused. Each Claude Code session gets its own hook secret, and Codex/Grok sessions get no GenUI credentials at all. Text sent into a terminal is stripped of control characters. Planner and side-chat calls load only your user-level Claude settings and no MCP servers, never a project folder's own settings.
