# GenUI Agent: product brief

The source of truth for what we're building. Read this first; the owner corrects it.

## The problem
The owner runs many agents at once (7–9 sessions, across businesses and harnesses). They work for hours and need his input along the way. When he steps away and comes back, he has forgotten where each one was, what it needs from him, and how it got there. He wants to catch up at a glance and give each agent a complete reply so it can carry on.

## Two layers
1. **Agents (sessions).** Each agent is one real session with its own workflow: what it has done, where it is, what it needs.
2. **Orchestrator agent (phase 2).** An agent that manages several agents and creates new ones as needed: a silent supervisor in the "group chat" between the owner and his agents. Not built yet.

## Fixed decisions
- **A wrapper, not a new product.** The real, unmodified CLIs (Claude Code, Codex, Grok) run inside GenUI's window, so their updates need no work from us. GenUI watches through hooks and transcripts. It puts text in by typing it as the owner's next message. The only key it ever presses in the CLIs' menus is a single Esc, to close a question the owner has answered on the side. (Claude Code "channels" are deferred.)
- **Look and feel:** the @pitus_ generative-UI style in `DESIGN.md`. The terminal is always dark.
- **Agent view:** the real terminal on the left, a rail on the right.
- **Flowchart = branches.** A git-graph style tree:
  - The first goal is the trunk, and each new request or change of direction branches off it. The agent's work sits under each goal as steps.
  - The tree only grows: settled steps are never rewritten.
  - The current step is blue while the agent works, amber when it needs the owner, and grey when it's his turn. Clicking an amber step shows what's needed.
  - It can be built by AI or instantly by code (there's a switch today). The research suggests merging the two into one tree with two layers; this is open.
- **Three ways to get help:**
  - **Discuss it** on a question the agent asked: a side agent drafts the answer, which goes under the question; Send closes the question and types the answer in.
  - **Ask on the side,** any time: a multi-step side agent about the session, with an optional message back.
  - **New session** for anything unrelated: the **+** in the header uses the same folder.
  - Not Claude Code's /btw: it's one-shot. Side agents are forks with read-only tools, and their discussions stay listed under the flowchart.
- **Sessions:**
  - **New session:** type and press Enter; it starts in the most recent project.
  - **Stop:** one click, then a confirm. A stopped session offers Resume, New session here, and Close.
  - **Planning:** "Plan a goal" is on the Orchestrator page, to be redesigned with phase 2.
- **Testing:** test sessions run only in `sandbox/`. Real sessions are read-only. Never auto-trust a folder outside `sandbox/`. Clean up test sessions afterwards. Local git only.

## Version 1: come back and catch up (current focus)
1. **Dashboard** (the Orchestrator page) for the 6–7 agents. Each row shows:
   - the step it's on and its state (working, needs you, your turn);
   - how many things it needs from the owner;
   - two lines: "Did: …" and "Needs: …";
   - a "new since you looked" marker.
2. **Each step in the flowchart is clickable** and shows what happened in that step:
   - a short summary;
   - the files and commands it touched;
   - the agent's key message;
   - any questions asked and how they were answered.
3. **"Needs from you":** every unresolved ask across the whole session, not only the latest reply. Each item links to its step and clears once answered.
4. **Answer them in one go,** sent to the session as one complete message.
5. **"Since you were away":** steps added since the owner last looked are highlighted.

Not yet confirmed by the owner: the exact content of a step's detail, tracking asks over the whole session, the two "Did / Needs" lines, and one combined "needs from you" view across all agents.

## Phase 2: the orchestrator agent
A supervisor agent that creates and manages agents, with each agent working in an isolated branch or worktree. The research's warnings about lead agents: they drift after a handful of reports, start doing the work themselves, and become the review bottleneck. The fix people report is a thin coordinator, plus code that does the merging and ranking.

## Research
- `DESIGN.md`: the design spec.
- `pitus-method.md`: the @pitus_ study.
- `genui-landscape.md`: how generative-UI systems work.
- `agent-orchestration-uis.md`: multi-agent interfaces on X.
