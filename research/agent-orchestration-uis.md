# One human, many agents: how orchestration UIs are designed (November 2026)

Research for GenAgent UI, 4 November 2026. The question: how do other products let one person run and supervise many coding agents at once (Claude Code, Codex, Gemini, Grok and others), and what does an orchestrator layer do there? The aim is to rethink GenAgent UI's Orchestrator page and agent view.

**Method.** I ran 14 searches of X (through Grok, posts mostly June to November 2026), one Reddit Answers question, and checked product pages, docs and repos for every tool named in the brief. Everything from X and Reddit is what people *say*. Where a post comes from a tool's own maker or is a sales pitch, I say so. Prasenjit Sarkar (@stretchcloud), for example, posts about competitors a lot while promoting his own tool, Campfire. Replies from the @grok account are an assistant talking, not user reviews.

---

## 0. The short version

- **Almost everyone has settled on the same core:** one git worktree (or container or VM) per task; a sidebar that lists the agents, each with a 3 to 5 state attention signal (*working / needs you / done / failed*); one click into the real session; and a diff review step at the end of every lane (diff, then PR, then merge, then archive).
- **The fight now is over the main view.** The options are a *list or inbox* (Agentbox, Antigravity's Inbox, Codex Triage, Warp), a *kanban by status* (Devin Desktop, Vibe Kanban, Nimbalyst, Campfire), a *spatial map or canvas* (Amp's thread map, Cursor's agent map, OpenCove and other canvases), *tiles or panes* (Herdr, Claude Squad, Cursor tiles), or *one conversational master thread* (Codex, Claude desktop with `/btw`, T3 Code). Users with five or more agents complain about plain chat lists and tab soup, and ask for a map.
- **Human attention is now the bottleneck, and people say so outright** ("Human attention is the new bottleneck of AI work", Agentbox). The best designs keep agents quiet until they are done or stuck. Each one arrives as a two-line "what I did / what I need", with a recommended answer you accept with one key. Only irreversible or high-blast-radius actions interrupt you. Everything else is batched.
- **Orchestrator AIs are now mainstream:** Factory Missions, Claude Code agent teams, Codex's master thread, Devin's orchestrator sessions, Amp agent-to-agent, Herdr coordinators, Cursor `/multitask`. The failure modes are well known: the lead drifts after reading many reports, absorbs the work itself, loses the reasoning at every handoff, and becomes the review bottleneck. The fix people describe is a *thin* orchestrator. It plans, routes and checks. Workers have their own isolated contexts. Code does the merge and the ranking, and follow-ups go straight to the worker.
- **The standalone tools are being absorbed or are dying.** In 2026, Terragon shut down (Feb), Crystal was deprecated (Feb), Vibe Kanban's company folded (Apr), LangGraph's Agent Inbox repo was archived (Sep) and Google Jules is being shut down (read-only from 11 Nov, gone 31 Dec). Meanwhile Anthropic, OpenAI, Cursor, VS Code, Google and Cognition all shipped their own multi-agent hubs. A wrapper survives by doing something the vendors' hubs don't. For GenUI that is the generative goal map across *different* harnesses.

---

## 1. Landscape at a glance

| Tool | Status, Nov 2026 | Main view | Isolation | Orchestrator AI? | How it asks the human |
|---|---|---|---|---|---|
| **Claude Code CLI** (subagents, agent teams) | Subagents GA; agent teams experimental | Agent panel under the prompt; optional tmux split panes | `claude --worktree`; subagent `isolation: worktree` | Yes: team lead + shared task list + mailboxes | Teammate permission prompts bubble up to the lead |
| **Claude Code desktop** | Sessions hub shipped 14 Oct 2026 | Session sidebar with live status, details cards, background-tasks pane | Worktree per session; Local/Cloud/SSH/WSL | Cross-session messaging; suggested-task cards | Sidebar status; side chat `/btw` |
| **Codex app** (in the ChatGPT desktop app since 9 Jul) | Active | Projects, then threads; Triage inbox; review pane | Local / Worktree / Cloud per thread | Master thread spawns threads and subagents | Review queue: approve / revise / reject |
| **Cursor 3 Agents window** | 3.0 on 2 Apr; 3.2 `/multitask` | Full-screen agent list (local + cloud), tiles, agent map | Worktree, cloud sandbox, SSH | Parent spawns async subagents; merge agent | Approval prompts locally; cloud runs alone |
| **VS Code Agents window** (`code --agents`) | Shipped 2026 | Agent Sessions list across local/background/cloud | Worktrees | "Conductor" agent pattern (Copilot Orchestra) | Session status |
| **Google Antigravity Agent Manager** (Jules folding in) | Active; Jules shuts 31 Dec | "Mission control": Inbox + agents side by side + Artifacts | Workspaces | Leaked "Chief of Stuff" agent that spawns agents | Comment on Artifacts; waiting-for-approval state |
| **Devin Desktop** (formerly Windsurf) | Launched 2 Jun; refresh 23 Oct | Agent Command Center kanban: *In Progress / Blocked / Ready for Review* | Local + cloud VMs | Orchestrator sessions spawn dozens of children | Blocked column; Review tab |
| **Factory Missions** | Active | Mission Control: milestones, features, workers | Factory workers | Yes: orchestrator, workers, validators | Clarifying questions *before* work starts |
| **Amp** | Active | Threads + thread map; orbs | Orb = fresh remote machine per thread | Agent-to-agent spawn/message (17 Jul) | Thread review by teammates |
| **Warp / Oz** | Oz launched 10 Feb | Agent Management Panel + Runs page | Cloud runs | Parent/child runs (Sub-agents tab) | *Blocked* status + notifications |
| **Conductor** | Active (Mac; v0.92) | Workspace sidebar, chat, diff | Worktree per workspace | No (you are the orchestrator) | Diff, then PR, then merge, then archive |
| **Orca** | Active, MIT, ~115k stars | Worktrees + terminals + Agent Activity View + browser | Worktree; SSH | Sub-agents; hand off a conversation to another agent | Activity view: waiting / working / monitoring / done |
| **T3 Code** | "very very early", MIT, ~45k stars | Conversational control surface (desktop/web/phone) | Uses local harnesses | No | Thread status (a Stream Deck add-on blinks per thread) |
| **Herdr** | Active, Rust binary + Mac app | Spaces, tabs and real panes; agents sidebar | `herdr worktree create` | Coordinator agent assigns, waits, reads, follows up | Sidebar working / blocked / done / error |
| **Superset** | Active, OSS | Terminal for 10+ agents | Worktree + setup/teardown scripts | No | Review + open in editor |
| **Claude Squad** | Active, AGPL, ~8.7k stars | TUI list + preview/diff tabs | tmux + worktree | No | Attach to session; `--autoyes` |
| **Crystal / Nimbalyst** | Crystal deprecated Feb 2026; Nimbalyst active | Visual workspace: agents, tasks, docs, diagrams, wiki | Worktrees | Opus + Codex orchestration (user report) | Wiki of decisions and questions |
| **Sculptor (Imbue)** | Quiet; last repo push May 2026 | Agent list + Pairing Mode | Docker container per agent | No | Merge/discard; AI "Suggestions" |
| **Vibe Kanban** | Company shut Apr 2026; community-maintained | Kanban of issues, then workspaces | Worktree + dev server per task | No (MCP lets an agent create issues) | Diff with inline comments, PR |
| **Terragon** | Shut down 9 Feb 2026 (code open-sourced) | Cloud task list | Cloud containers | No | PRs |
| **Omnara** | Active, Apache-2.0 | Web/phone command center for the same session | Worktrees | Now pitched as "open-source alternative to Claude managed agents" | Answer from phone or watch; voice |
| **Agentbox** | Launched 6 Oct, GPL-3 | Inbox of rows, shown only when an agent is done or stuck | Worktree per work item | Dispatcher + workers | Two-line summary + numbered options + one key |
| **LangGraph Studio / Agent Inbox** | Studio active; Agent Inbox repo archived 20 Sep 2026 | Graph view with interrupts; inbox of interrupts | n/a (framework) | Your graph | accept / edit / respond / ignore |
| **CrewAI Studio / AMP** | Crew Studio canvas refreshed Jul 2026 | Canvas + control plane traces | n/a | Crews with roles | Human approval gates |
| **AutoGen Studio** | Maintenance mode; successor MS Agent Framework 1.0 (GA 2 Apr 2026) | Low-code team builder | n/a | Group chat | n/a |

---

## 2. Product by product

### 2.1 Vendor-native hubs

**Claude Code: subagents, agent teams, desktop sessions hub.**
- *CLI.* Subagents run inside one session and report back. Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) make the session a **team lead**. Teammates are full, independent Claude Code sessions sharing a **task list** (pending / in progress / completed, with dependencies shown as *blocked*) and per-agent **mailboxes** (JSON files under `~/.claude/teams/`). The UI is an **agent panel below the prompt**: arrow keys select a teammate, Enter opens its transcript so you can message it directly, `x` stops it, Ctrl+T toggles the task list. Idle rows collapse to "N idle agents". Split panes need tmux or iTerm2, which rules out Windows Terminal. Hooks (`TeammateIdle`, `TaskCreated`, `TaskCompleted`) act as quality gates. Notable choices: teammate *plans are auto-approved* unless you change that teammate's mode, so the lead or Claude Code approves, not you. Teammates' permission prompts surface in the lead's session. A relayed "approval" from another agent is treated as untrusted. Docs advise 3 to 5 teammates and 5 to 6 tasks each ([docs](https://code.claude.com/docs/en/agent-teams)).
- *Desktop (14 Oct 2026).* A sessions hub with live statuses in the nav bar: start, track and follow up on several sessions from the main screen ([@ClaudeDevs](https://x.com/ClaudeDevs/status/2110445844675838148), [@testingcatalog](https://x.com/testingcatalog/status/2110455911344931130)). There is a worktree per session, saved environments (Local/Cloud/SSH/WSL), a **session details panel** of cards (where it runs, what it changed, what it's running, context %), and a **background tasks pane** listing subagents, background shells and workflows. `/btw` (Ctrl+;) opens a side chat that reads the main thread. **Suggested-task cards** appear with *Start / Do it here / Start all*, and sessions can message each other, with arrivals held until the receiver's turn ends ([docs](https://code.claude.com/docs/en/desktop)). Users say subagents, background tasks and context breakdown are "much more intuitive in Claude Code desktop than Codex" ([@ntwrknrd](https://x.com/ntwrknrd/status/2116087785048383858)). Others now run one pinned session per project plus `/btw` instead of many threads ([@chris_bgp](https://x.com/chris_bgp/status/2115388379344814425)).
- *Complaints:* cost (one user found 44% of six weeks' spend went to subagents, and 75% of spend was re-reading context; [@rsaryevdev](https://x.com/rsaryevdev/status/2117790083420205175)). Subagents silently inherit xhigh effort ([@browserOS_ai](https://x.com/browserOS_ai/status/2117785947819634914)). Each teammate's compaction remembers a different summary, which causes drift ([@jbdamask](https://x.com/jbdamask/status/2117738229340270686)).

**OpenAI Codex app.** It launched on 2 Feb 2026 as a Mac "command center", and since 9 Jul 2026 it has been a Codex mode inside the ChatGPT desktop app. Layout: **projects then threads** in a sidebar. Each thread is Local, Worktree or Cloud. An **Automations** tab sits beside a **Triage** inbox ("Runs with findings appear as inbox items, filterable by all runs or unread only"). The **review queue** shows a git diff with inline comments and offers Approve (commit/PR), Revise (continue the thread) or Reject ([Vaughan guide](https://codex.danielvaughan.com/2026/04/08/codex-desktop-automations/)). For orchestration, an OpenAI engineer brain-dumps by voice into **one master thread** that "spins up multiple threads on separate worktrees, delegates to subagents" ([@victornunez](https://x.com/victornunez/status/2077162415310184877)), and Codex can start real sessions programmatically and read their journals for summaries ([@bcinarli](https://x.com/bcinarli/status/2116526912201765319)). Praise: "the terminal era is over… managing 30 tabs is pure cognitive overhead", calling it the best agentic UI ([@Yuchenj_UW](https://x.com/Yuchenj_UW/status/2106435001340621147)). Complaints: "a big pile of mess… overwhelming" ([@argofowl](https://x.com/argofowl/status/2105242316126757182)), and usage multipliers killed 5+ parallel xhigh agents ([@ostynhyss](https://x.com/ostynhyss/status/2081495771321425971)).

**Cursor 3 Agents window.** Cursor 3.0 (2 Apr 2026) replaced Composer with a **full-screen Agents Window**: a sidebar of every local and cloud agent across repos, with agent tabs side by side or in a grid ("a small Kubernetes dashboard"). Agents run in worktrees, cloud sandboxes or over SSH. A **merge agent** reconciles parallel worktrees before one review pass ([dev.to](https://dev.to/gabrielanhaia/cursor-3-glass-replaced-composer-with-an-agents-window-1pcg)). Cursor 3.2 added `/multitask` with async subagents. An **agent map** shows one parent with its sub-agents and long-running shells: who is running, for how long, the token count, and how each piece connects to the parent ([@yuvraajsinghh1](https://x.com/yuvraajsinghh1/status/2116809800675954789)). 3.28.7 strings point to an Agents window of its own on Mac and tasks on the right ([@blankspeaker](https://x.com/blankspeaker/status/2117507653119447073), inferred from flags). Adam Wathan: the agents UI "everyone complained about" now looks like Cursor "saw the future" ([post](https://x.com/adamwathan/status/2089370188407787532)). A critic's point: "six agents… is almost always a sign you're using parallelism as a substitute for prompting clarity".

**VS Code Agents window.** An *Agent Sessions* sidebar view lists local, background and cloud sessions with status and one-click switching. A separate **Agents window** (`code --agents`) manages agents across workspaces and hosts, stays in sync with the editor, and uses worktrees. It is built on an "Agent Host Protocol" shared with the GitHub Copilot app and mobile ([VS Code wrapped, 28 Oct 2026](https://code.visualstudio.com/blogs/2026/10/28/vscode-wrapped), [multi-agent blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)). One user's reaction: "looks like Orca, Superset or Paseo" ([@xelandre__](https://x.com/xelandre__/status/2117752676998095353)).

**Google Antigravity Agent Manager (and the end of Jules).** The Manager view is "mission control": spawn agents into separate workspaces, see them **side by side with status, their Artifacts, and whether they wait for approval**. An **Inbox** tracks all conversations. **Artifacts** (task lists, plans, screenshots, browser recordings) take inline comments while the agent keeps working ([codelab](https://codelabs.developers.google.com/getting-started-google-antigravity?hl=en)). Since 26 Aug the agent can render **interactive generative-UI artifacts** inline and in an artifacts panel ([@antigravity](https://x.com/antigravity/status/2092750545383551281)). A leaked "Chief of Stuff" agent would operate Antigravity, spawn agents and **review pending conversations from the last three days that need you** ([@testingcatalog](https://x.com/testingcatalog/status/2116885887313133576)). Jules goes read-only after 11 Nov 2026 and shuts on 31 Dec 2026, with its async work folded into Antigravity ([TestingCatalog](https://www.testingcatalog.com/cloud-execution-is-coming-to-antigravity-soon/)). Users praise "highlight and reply to a specific comment in AI output" ([@karmicdaoistt](https://x.com/karmicdaoistt/status/2117715024454291467)). Context blow-ups are the top complaint ([@huang18825](https://x.com/huang18825/status/2117789546868072520)).

**Devin Desktop (Cognition).** Windsurf was renamed in June 2026: "Manage fleets of local and cloud agents from one surface. Plan, delegate, review, and ship" ([@cognition](https://x.com/cognition/status/2061889596703551926)). The 23 Oct refresh opens on an **Agent Command Center**, a kanban that groups every local and cloud session into **In Progress / Blocked / Ready for Review**, with the IDE underneath. Other vendors' agents join via ACP ([@cognition](https://x.com/cognition/status/2113671026286682500), [@VictorMotricala](https://x.com/VictorMotricala/status/2113684419219267627)). The Agent Window has a sessions sidebar, session view, Automations, Review, Wiki and ⌘K ([@Chris_Wozniczek](https://x.com/Chris_Wozniczek/status/2114734546453454881)). The longest field report ([@jishnuteegala](https://x.com/jishnuteegala/status/2110408411909083619)) has the praise: one session spawned **36 reviewer sessions** on their own VMs and pushed findings back, he could steer mid-run and put idle children to sleep, and `/handoff` moves a local planning session to the cloud. The complaints: two Ultra sessions burned a month's allowance in about 2 days, unattended sessions **died overnight with no stall alert**, and one denied command in headless mode killed 7 sessions. "I mostly steer the orchestrator."

**Factory Missions.** This is the clearest orchestrator design. The orchestrator first **asks clarifying questions**, then writes a plan of **milestones → features** plus a **validation contract**, then spawns workers and validators. **Mission Control** shows progress across milestones, which agent works on what, and lets you intervene. The docs say "the skillset… looks less like traditional debugging and more like project management of agents", and the orchestrator is something you talk to throughout ([docs](https://docs.factory.ai/missions/overview)). One 79-hour run used 229+ agents and 158 tasks, at about 5.3 h per milestone, and was "very impressive". The weak spot was the visual polish of the last 20% ([@jholtdigital](https://x.com/jholtdigital/status/2068342224278913517)).

**Amp.** Every conversation is a synced **thread**. **Orbs** give each thread a fresh remote machine, so "no development on your computer", 30 threads at once, and teammates review a thread instead of pulling a PR ([@bryceadams](https://x.com/bryceadams/status/2116675820794327366), [@OndrejMirtes](https://x.com/OndrejMirtes/status/2115572350049484923)). Since 17 Jul agents spawn other agents (in orbs, locally or on other machines) and exchange messages and files ([Amp news](https://ampcode.com/news/from-agent-to-agent)). **Thread Map** (`threads: map`) draws threads as a graph of references, continuations and handoffs. You pick a node and press Enter to jump in ([Tessl](https://tessl.io/blog/amp-launches-thread-map-to-help-navigate-ai-coding-agent-work/)). That makes it the closest vendor analogue to GenUI's flowchart, one level up.

**Warp / Oz.** The **Agent Management Panel** (app) and **Runs page** (web) list one row per conversation or cloud run with **Source** (app, CLI, API, Slack/Linear, scheduled), **Status** (*Working, Blocked, Canceled, Failed, Success*) and duration, plus filters ("everything that failed today"). Child runs nest under the parent on a Sub-agents tab. A third-party harness that needs input **ends as Blocked instead of hanging**. A vertical tab sidebar shows an attention dot, and notifications work for Claude Code, Codex and OpenCode ([docs](https://docs.warp.dev/agents/using-agents/managing-agents)). On X, Warp is discussed for its self-improving review agent, not for its fleet UI.

### 2.2 Third-party local desktops and terminals

**Conductor** (conductor.build, Mac). It runs Claude Code, Codex, Cursor and OpenCode in parallel. Each **workspace** is an isolated worktree with its own branch, files, terminal and diff, and the lifecycle is "review the diff, open a pull request, merge, and archive the workspace" ([docs](https://www.conductor.build/docs/)). Fans credit it with free provider switching, automatic handoff, and handling PR conflicts, CI errors and review comments in the UI ([@kalanyei](https://x.com/kalanyei/status/2117619375423488418)). An agency says 50 to 60% of its shipped code comes through Claude Code orchestrated in Conductor ([@crowdlinker](https://x.com/crowdlinker/status/2095183349652341237)). Complaints: a UI outage on 3 Nov that one user blamed on an unrotated licence key for a virtualised message-list component, which the team fixed fast ([@tomjohndesign](https://x.com/tomjohndesign/status/2117705975167852921), [@pranavctl](https://x.com/pranavctl/status/2117725198082552039), [@jamesdillard](https://x.com/jamesdillard/status/2117708967665139808)). Users who wanted VMs, overnight runs and remote control moved on once those became paid ([@kalanyei](https://x.com/kalanyei/status/2117619375423488418)). There is no orchestrator AI: you are the conductor.

**Orca** (stablyai/orca, MIT, about 115k stars, Electron, desktop + iOS/Android + SSH). It has worktrees, Ghostty-class terminals with splits, a VS Code-style file editor, an embedded Chromium with a click-to-edit **Design Mode**, annotatable diffs, GitHub/Linear integration, and 40+ CLI agents ([repo](https://github.com/stablyai/orca)). Its **Agent Activity View** (10 Sep) lets you "see what agents need you, without opening a single one": *waiting · working · monitoring · done*, plus the last agent message and a jump-in ([@orca_build](https://x.com/orca_build/status/2098055393377124672)). Reddit's most-recommended tool ("I don't know how people stay organized… without it"). Complaints: rough UX, stalls, a laggy early phone terminal ([@kalanyei](https://x.com/kalanyei/status/2117619375423488418)), and "getting more complex… moving toward a chat-based UI on top of the agents" ([@solanky](https://x.com/solanky/status/2116760574310731799)). By November it had a T3-style conversational layer and one-click handoff of a conversation to another agent ([@corndogjpn2](https://x.com/corndogjpn2/status/2117650313834549577)).

**T3 Code** (pingdotgg/t3code, MIT). An "agent harness control surface" over your *installed, signed-in* harnesses (Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity), on desktop, web and phone ([repo](https://github.com/pingdotgg/t3code)). It is the closest in spirit to GenUI's wrapper stance. One user ranked it top after trying "claude/codex desktop app, herdr, orca, superset, conductor" ([@iamyatendrak](https://x.com/iamyatendrak/status/2117702876726431780)). Greg Isenberg uses T3 as "the control surface for every agent, from my phone too", with Orca running the fleet ([post](https://x.com/gregisenberg/status/2117734977312047537)). Someone built a Stream Deck map where each T3 thread is a key that **blinks when an agent needs him** ([@hsalazar](https://x.com/hsalazar/status/2117816043653726686)).

**Herdr** (Rust binary + TUI, plus a Mac app). Layout: **spaces** top-left (one per project), **tabs** across the top (one agent each), real panes, and an **agents list bottom-left showing who's working and who needs a response** ([@AlexFinn](https://x.com/AlexFinn/status/2098243595593830436)). It runs a headless server, so closing the window doesn't kill agents, and it can manage SSH machines and is configured through files. The coordination pattern people love: "Claude and Codex each get a pane. The main agent assigns work, waits, reads, and follows up. I used to carry every conclusion between windows myself" ([@Voxyz_ai](https://x.com/Voxyz_ai/status/2086059460502417772), [later post](https://x.com/Voxyz_ai/status/2097070213250372025)). Weak spots: no audit timeline ([@solanky](https://x.com/solanky/status/2116760574310731799)), and status is inferred by heuristics. Mitchell Hashimoto counted about 10 Herdr commits in three months just to keep detecting Claude Code, which is why he published a terminal status spec ([@mitchellh](https://x.com/mitchellh/status/2107577887159386152); see 3.1). A solo builder asks whether assigning tasks and resolving conflicts costs more than one Codex run straight through ([@star_flow_ai](https://x.com/star_flow_ai/status/2117803518107037734)).

**Superset** (superset-sh, OSS). "Terminal to run 10+ parallel coding agents". There is a worktree per task, and **setup/teardown scripts** install dependencies and copy env vars, which addresses the top worktree complaint (env and deps don't follow you). It opens a worktree in any editor in one click ([repo](https://github.com/superset-sh/superset)).

**Claude Squad** (smtg-ai, AGPL). A TUI with a **session list on the left and preview/diff tabs on the right**, using tmux and a worktree per session. Keys: `n` new, Enter attach, `s` commit/push, `c` checkout, `r` resume. `--autoyes` auto-accepts prompts ([repo](https://github.com/smtg-ai/claude-squad)). It is still recommended as "the veteran tmux-plus-worktree combo… not a review workspace". The same thread has a telling remark: "past about three parallel agents, reviewing diffs becomes the whole job" ([@YoDevp](https://x.com/YoDevp/status/2116519637852500440)).

**Crystal → Nimbalyst.** Crystal was an early desktop app that gave each agent a worktree. It stopped in Feb 2026 and its team moved to **Nimbalyst**: a visual workspace combining agents, tasks, docs, diagrams and code, plus a **wiki where "agents organize decisions, questions, and the big picture"** ([site](https://nimbalyst.com/)). People still use it "to orchestrate opus and codex in a really cool visual environment" ([@Ryan_Ravenson](https://x.com/Ryan_Ravenson/status/2117769390707941614)). Whether it is MIT or closed and paid is disputed on X.

**Sculptor (Imbue).** A Mac app that runs Claude Code (later Codex) agents in **Docker containers**. **Pairing Mode** syncs an agent's container into your IDE both ways so you can test, merge assistance resolves conflicts, and AI "Suggestions" do review. It is quiet now: the last repo push was May 2026, and X has only a catalogue line ([research note](https://rywalker.com/research/sculptor)).

**Vibe Kanban** (BloopAI). A kanban board of issues. Each card opens a **workspace** (branch, terminal, dev server), and work comes back for **diff review with inline comments**, an embedded browser, and PRs with AI descriptions. It supports 10+ agents ([repo](https://github.com/BloopAI/vibe-kanban)). Bloop shut down in April 2026 for lack of a business model, and the tool lives on as community-maintained and local-only ([shutdown post](https://vibekanban.com/blog/shutdown)). People still install it and wire agents to it via MCP (`create_issue`) ([@grok reply](https://x.com/grok/status/2117539520555917750)).

**Agentbox** (savannahfeder/agentbox, GPL-3, launched 6 Oct). This is the purest "attention inbox". "Every agent chat window collapses into a single inbox, agents stay quiet until they need you and prioritize themselves" ([@SavannahFeder](https://x.com/SavannahFeder/status/2107566510386577695)). A row appears only when an agent is done or stuck, and shows **"what the agent did and what it wants from you, in two lines"**, with **numbered options and a recommended one**. Keys: J/K, `E` accept the recommendation, `1/2/3` pick an option, `R` reply, `L` defer, ⌘K. Tasks carry priority tags, and **"an agent cannot promote its own work"**. A slot limit (`maxConcurrentSessions`) queues work by priority, and "an answer you have already given wins a tie against new work, so replies never pile up". It runs one headless Claude Code or Codex session per work item in its own worktree ([repo](https://github.com/savannahfeder/agentbox)).

**Canvases and maps.** One user lost track of 5 to 10 agents ("what each one was doing, where it was in the repo, and how the work connected") and built an infinite map for Claude Code, Codex and Cursor ([@dannyinsf_](https://x.com/dannyinsf_/status/2093407620967092359), 842 bookmarks). Collaborator is "an infinite canvas of independent Claude Code terminals… no tabs" ([@hey_madni](https://x.com/hey_madni/status/2071904711880400935)). Open-source canvases include **OpenCove** (terminals, notes, tasks and sessions on one canvas), **Void**, **CodeGrid** (dozens of sessions on a 2D canvas) and **Cate**. The demand is explicit: "Having a list of chats for managing >5 agents running in parallel is the worst UX… a visual 2d interface like a mind map with agents running branches" ([@hamudinaanaa](https://x.com/hamudinaanaa/status/2115333877862727945)).

**Newer ones people mention** (mostly maker posts, little outside review):
- **Campfire**, from its builder: a kanban built from each agent's tool calls, a per-session cost dashboard, "permission voting" (any single no blocks, 30 s timer), fork a session to race the same task across backends ([@stretchcloud](https://x.com/stretchcloud/status/2117294917118722077)).
- **DevChain**: tmux terminals in the browser, and agents update a shared task board via MCP, with pre-commit diff review. Its sibling **DevThrottle** surfaces which sessions wait on you ([@DanKornas](https://x.com/DanKornas/status/2117677179886538926)).
- **Agent Orchestrator** (OrchestratorInc, OSS): isolated workspaces plus automated feedback loops for CI failures, review comments and merge conflicts ([@tom_doerr](https://x.com/tom_doerr/status/2086106858603860213)).
- **omux**: a sidebar of working / needs you / done ([@omuxapp](https://x.com/omuxapp/status/2117709939460489463)).
- **Chorus**: a kanban of plan → WIP → review (Reddit).
- **Paseo**: GUI-first, phone-friendly, recommended to non-programmers ([@hfcorriez](https://x.com/hfcorriez/status/2102871334657397099)).
- **Worktrunk**: a CLI for worktree-per-agent with shared build caches, about 10k stars ([@RoundtableSpace](https://x.com/RoundtableSpace/status/2117757464619688330)).
- **whatsmyagentdoing**: per agent, thinking / running a tool / waiting for you ([@KitchExtremeX](https://x.com/KitchExtremeX/status/2115432048542593424)).
- Someone's hand-rolled stack: Herdr, five harnesses, Tailscale, and "Pilothouse" for rules and approvals ([@nawabkona](https://x.com/nawabkona/status/2117752068597600291)).

### 2.3 Remote / cloud

- **Terragon** ran Claude Code, Codex, Amp and Gemini as background agents in cloud containers. It shut down on 9 Feb 2026 (announced 16 Jan) and the code is open source ([summary](https://bra1ndump-website.pages.dev/blog/research/harness-engineering/terragon)). This is the clearest example of a vendor feature (cloud background agents) eating a startup.
- **Omnara** starts a normal Claude Code or Codex session (`pip install omnara && omnara`) that you continue from the web, phone or watch, with voice. It is Apache-2.0 ([overview](https://www.everydev.ai/tools/omnara)), and is now positioned as "the open-source alternative to claude managed agents" ([@omnaraai](https://x.com/omnaraai/status/2117686597013709020)).
- Remote environments are "the future… but every coding agent I tried makes a mess of implementing them" ([@liran_tal](https://x.com/liran_tal/status/2117770056067088384)).

### 2.4 Framework studios (non-coding orchestrators)

- **LangGraph Studio** draws the graph. You set interrupts before and after nodes, edit state, and step through. **Agent Inbox** defined the cleanest human-in-the-loop schema: each interrupt is an `action_request` plus a description, and the human can **accept / edit / respond / ignore**, as allowed per interrupt. The repo was archived on 20 Sep 2026, with a hosted copy at dev.agentinbox.ai ([repo](https://github.com/langchain-ai/agent-inbox)).
- **CrewAI**: Crew Studio is a canvas with an AI copilot (refreshed Jul 2026). The AMP control plane traces calls, tools, memory, tokens and costs, with human approval gates ([repo](https://github.com/crewAIInc/crewAI)). In practice: researcher → writer → reviewer roles, each with tools, structured output and a human checkpoint ([@RizeOnline](https://x.com/RizeOnline/status/2117667938912100818)).
- **AutoGen Studio** is in maintenance mode. Microsoft Agent Framework 1.0 (GA 2 Apr 2026) succeeds it ([summary](https://futureagi.com/blog/what-is-autogen-2026/)).
- On X, people treat these as code frameworks chosen by coordination style: graph (LangGraph), roles (CrewAI) or conversation (AutoGen). The visual canvases people actually post about are n8n, Dify and Langflow ([@pablogori392947](https://x.com/pablogori392947/status/2117792573561684479), [@sitin_dev](https://x.com/sitin_dev/status/2116720129866125411)). This lane matters less to GenUI. Its one transferable idea is Agent Inbox's four-action response schema.

### 2.5 Generative-UI supervision (closest to GenUI's own idea)

- Before a long run, have a **dashboard-builder subagent** write one self-refreshing HTML file: tasks and status, what's stuck, **questions waiting on you plus the default if you don't answer**, and the latest deliverables ([@Voxyz_ai](https://x.com/Voxyz_ai/status/2103946635831050740)).
- Generative UI for Claude Code, Codex and Pi: the agent renders charts and forms while it works, via the AI SDK HarnessAgent + json-render ([@ctatedev](https://x.com/ctatedev/status/2066555279295008908)). CopilotKit's "Catalog and Surfaces" ships 70 components over AG-UI/A2UI ([@CopilotKit](https://x.com/CopilotKit/status/2115499466182799400)).
- An approval card that shows **the real coloured diff instead of filenames** ("the approval moment is the product") ([@Vatsalpandya333](https://x.com/Vatsalpandya333/status/2117478875735445694)). Live diagrams and diffs you comment on to revise ([@modemdev](https://x.com/modemdev/status/2079579673114386562)).
- @pitus_ has no orchestrator posts. His series continues with **#7 Interactive Action Plan** (3 Nov) ([post](https://x.com/pitus_/status/2117688977876492426)), and he wished for "the UI that shows which tools the agent picked, live. So that you can stop it when it grabs the wrong one" ([post](https://x.com/pitus_/status/2109943155890242038)).

---

## 3. Synthesis 1: the design patterns for "one human, many agents"

### 3.1 The fleet rail with a small, standard state set
Every tool has a list of agents with a coloured state. The vocabularies differ, but they are converging:

| Tool | States |
|---|---|
| Herdr | working / blocked / done / error (+ idle) |
| Orca | waiting / working / monitoring / done |
| Warp | Working / Blocked / Canceled / Failed / Success |
| Devin | In Progress / Blocked / Ready for Review |
| omux, Agentbox | working / needs you / done |

The important 2026 development is that **agents now report their own state**. Mitchell Hashimoto's terminal spec, the **OSC 7501 "Program Status Protocol"**, is shipped in Ghostty 1.4 and emitted by Claude Code, Pi and Crush: working, blocked (permission, question or sign-in), done, error and idle ([@mitchellh](https://x.com/mitchellh/status/2107577887159386152); [Orca docs on agents and sessions](https://www.onorca.dev/docs/model/agents-sessions)). Tools that still infer state by reading the screen (Herdr's ten commits) are on the losing side.

### 3.2 Five main-view shapes

```
LIST / INBOX                 KANBAN BY STATUS                 MAP / CANVAS
┌──────────────────────┐     ┌──────────┬─────────┬────────┐  ┌──────────────────────────┐
│● auth-fix   needs you│     │In progress│ Blocked │ Review │  │      [goal]              │
│  "Migrate or keep?"  │     │ ▢ api     │ ▢ db ⚠  │ ▢ ui ✓ │  │     /   |   \            │
│  [1 Migrate] [2 Keep]│     │ ▢ tests   │         │        │  │  [api] [db⚠] [ui✓]       │
│✓ ui-tweak   done     │     └──────────┴─────────┴────────┘  │    |     |               │
│◌ tests      working  │                                       │  step  step              │
└──────────────────────┘                                       └──────────────────────────┘
Agentbox, Antigravity Inbox,   Devin Command Center, Vibe        Amp thread map, Cursor agent
Codex Triage, Warp panel,      Kanban, Nimbalyst, Campfire,      map, OpenCove/Collaborator/
Orca Activity View             DevChain, Chorus                  CodeGrid canvases

TILES / PANES                ONE MASTER THREAD
┌────────┬────────┐          ┌──────────────────────────┐
│ agent1 │ agent2 │          │ you: build X, Y, Z       │
├────────┼────────┤          │ ▸ spawned 3 threads      │
│ agent3 │ agent4 │          │ ▸ thread Y needs input   │
└────────┴────────┘          └──────────────────────────┘
Herdr, Claude Squad, Cursor  Codex master thread, Claude desktop
tiles, agent-team split      + /btw, T3 Code, Devin orchestrator,
panes                        Factory orchestrator chat
```

What people say about each:
- **List/inbox**: best for attention. It needs strong summaries.
- **Kanban**: best for "where is everything". It turns noisy when cards are raw todos ("unreadable todos, repeated popups that things are blocked, dependency chains hard to untie", [@smtconscious](https://x.com/smtconscious) via search).
- **Map**: best for "how the work connects", and most requested by people with 5+ agents.
- **Tiles**: good up to about 4 agents, then the screen runs out.
- **Master thread**: lowest overhead for one human, but it hides the workers.

Mature products combine two or more: Devin uses kanban plus a sessions sidebar, Antigravity uses an inbox plus side-by-side agents, Cursor uses a list plus tiles plus a map.

### 3.3 Attention, not visibility, is the product
- **Quiet by default.** Agents surface only when *done* or *stuck* (Agentbox, Orca Activity View, Antigravity's pending-conversations agent).
- **The two-line ask.** What I did, what I need, plus a **recommended option** and a key to accept it (Agentbox). Add a **default if you don't answer** (Vox's dashboard).
- **Batch the yeses.** "Posts, sends and anything that spends money wait in one queue for my yes. The rest… handle on their own" ([@VanceConsulting](https://x.com/VanceConsulting/status/2117376393516400700)). "A dozen tabs all pinging you is how you approve things you did not read" ([@Podex_AI](https://x.com/Podex_AI/status/2115612414771155124)). "Spend human attention only where the blast radius is real, and fail closed" ([@Iam_Shivanshu](https://x.com/Iam_Shivanshu/status/2117655960491590117)).
- **Approval must live where the agent can't reach it.** In a Cornell/Yale test, 9 of 10 models read a passcode from the human's inbox and raised their own cap ([@TAAFTResearch](https://x.com/TAAFTResearch/status/2117574749874237882), [@dsflowmind](https://x.com/dsflowmind/status/2117726102261051611)). Claude Code agent teams treat relayed approvals from other agents as untrusted for the same reason.
- **Evidence in the ask.** Show the diff, screenshot or test output, not a filename (TasksMind, Antigravity Artifacts, Devin before/after screenshots).
- **The human ranks, not the agent.** "An agent cannot promote its own work" (Agentbox).

### 3.4 Isolation is solved, and environment is the open problem
A worktree per task is now built in (`claude --worktree`, Codex, Cursor, VS Code, Conductor, Orca, Superset). Heavier work goes to containers or VMs (Sculptor, Amp orbs, Devin, Codex Cloud, Claude cloud sessions). Recurring complaints: worktrees don't carry env, dependencies or ports, uncommitted work isn't copied, and same-area edits still conflict at merge ([@vladrooman](https://x.com/vladrooman/status/2117534939054837903)). Superset's setup scripts and Worktrunk's shared caches exist because of this.

### 3.5 Every lane ends in a review station
The lane runs diff → inline comments → approve / revise / reject → PR → merge → archive (Conductor, Codex, Vibe Kanban, Orca's annotatable diffs, Devin's Ready for Review column). Then come automated feedback loops: CI failure, review comment or merge conflict goes back to the agent (Agent Orchestrator, Conductor, Jules' CI auto-fix). Reddit's consensus: **a clear done check per task ("a test or a command, not 'looks good'")** and **a reviewer that doesn't share the author's context**, "since a reviewer that saw the reasoning tends to agree with it."

### 3.6 Other recurring pieces
- **Persistence**: a background server, so closing the window never kills agents (Herdr, Orca; GenUI already does this).
- **Phone and remote**: T3, Orca, Paseo, Omnara, Conductor iOS, Codex Cloud. "Leave the computer at home running agents."
- **Cost and usage visible per agent**: Campfire's cost dashboard. Complaints about burn are everywhere (Devin, Codex multipliers, Claude subagent spend).
- **Concurrency slots + a queue**: Agentbox. Docs recommend 3 to 5 agents (Claude agent teams). "Add sessions at the pace you can review" ([@BojoDanchev](https://x.com/BojoDanchev/status/2115488923698725035)).
- **A shared memory outside any one agent**: Nimbalyst's wiki, Beads, structured handoff notes ("what it changed, what it verified, what's still risky", Reddit).

---

## 4. Synthesis 2: what the orchestrator does, and what the human does

| Phase | Orchestrator AI (where it exists) | Human |
|---|---|---|
| Goal | Asks clarifying questions **before** any work (Factory) | States the goal and what "done" means; answers the up-front questions |
| Plan | Splits the goal into milestones → features/tasks with dependencies; writes a validation contract (Factory); fills the shared task list (Claude agent teams) | Approves or edits the plan; sets priorities |
| Staff | Spawns workers, picks a harness and model per task (Opus lead, Sonnet builders, Haiku explorers), assigns a worktree or VM | Sets budget and concurrency; chooses which harnesses are allowed |
| Run | Routes messages, unblocks dependent tasks, restarts failed units, puts idle children to sleep (Devin), keeps a summary | Answers the asks that truly need a person; steers ("I mostly steer the orchestrator") |
| Check | Validators or reviewers with **fresh context** (Factory validators, Devin's 36 reviewers, a separate review agent on the PR); CI-fix loops | Spot-checks the evidence; reviews behaviour, not every line |
| Merge | A merge agent reconciles worktrees (Cursor); conflict resolution (Sculptor, Conductor) | Final approval to merge or ship; irreversible actions |

**Known failure modes of the orchestrator**, all reported on X between Aug and Nov 2026:
- **Drift.** It "keeps routing after it has started routing worse, around the fifth report", while the workers' traces look clean ([@hanakoxbt](https://x.com/hanakoxbt/status/2099608553107456472)). An orchestrator holding everything applies one subsystem's conventions to another (Meta, per [@FredPohl](https://x.com/FredPohl/status/2116822331112800767)).
- **Absorbing the work.** The lead plans, codes and reviews itself. Claude's docs say to tell it "Wait for your teammates…".
- **Handoff loss.** "The handoff passes the conclusion and drops the reasoning trace" ([@arpit_bhayani](https://x.com/arpit_bhayani/status/2100444191876903215)). Teammates compact into different memories ([@jbdamask](https://x.com/jbdamask/status/2117738229340270686)).
- **Coordinator bottleneck.** Routing every intermediate step back through the lead saturates its context ([@marfinxx](https://x.com/marfinxx/status/2087307396431438126)). On the human side: "if agents produce work faster than people can review… we've moved the bottleneck" ([@uttamvarma](https://x.com/uttamvarma/status/2115918046728790125)).
- **Silent death.** Unattended sessions die overnight with no stall alert (Devin report).
- **Auto-approval creep.** Teammate plans auto-approved by default; `--autoyes` in Claude Squad.

**Fixes people describe:**
- A **thin "chief of staff"** that only routes, sequences and checks, while specialists reason in clean contexts and only summaries come back up ([@arpit_bhayani](https://x.com/arpit_bhayani/status/2102388569449140316)).
- A **router that never decomposes**, with follow-ups going straight to the worker ([@Alexlearnai](https://x.com/Alexlearnai/status/2117195512776683686)).
- **Merging and ranking done by code**, not by an LLM node that must read everything (Hanako).
- A **shared queue and state store** instead of a lead relay (marfin).
- **Structured handoff notes**, and one owner of the final outcome ([@DawneraGames](https://x.com/DawneraGames/status/2116561687696572576)).

---

## 5. Synthesis 3: what GenAgent UI should take, and what to avoid

GenUI already has several pieces others lack:
- **real, unmodified harnesses across vendors** (Claude Code, Codex, Grok);
- a **flowchart per session**: code-built Instant, plus an AI-annotated tree that only grows;
- **amber "needs you" steps**;
- **Discuss it** side forks, so the main session's context grows only by your answer;
- **reply cards** that batch into one message;
- a **planner that predicts each step's questions** before workers start;
- **hook-based state** instead of screen guessing.

The ideas below build on those.

### 5.1 Ideas to adopt (strongest first)

1. **Make the Orchestrator home an attention inbox, with the fleet list second.** Default view: rows only for agents that are *done* or *need you*, sorted by your priority and then by how many downstream steps each blocks. Each row shows the two-line ask (what it did, what it needs), the existing GenUI card (choice, approval, answer), a **recommended option**, and keys (`1/2/3`, `E` accept, `R` reply, `D` Discuss it, `L` later). Working agents collapse to one line at the bottom ("4 working"). This is Agentbox's model plus GenUI's cards. Extend **Send N answers** across agents: answer five asks from three agents in one pass, and each answer goes to its own terminal.

2. **Raise the flowchart one level into a goal map.** Nobody else has a generative map of a *multi-agent goal*. Amp's thread map shows links between threads, Cursor's map shows a parent and its children, and the canvases are just spatial terminals. Draw the planned goal as the trunk, each worker as a branch, each worker's GenUI steps under it, and dependencies as edges. Colours follow the design system: blue working, amber needs you, grey your turn, green done, red failed. Click a node to open that agent's terminal and rail. This answers the most repeated complaint from people running 5+ agents ("I kept losing track of… how the work connected"; "a list of chats for >5 agents is the worst UX"). Keep the split from `genui-landscape.md`: code owns structure, IDs and layout; the model only names and groups.

3. **Front-load the questions (pre-flight).** GenUI's planner already predicts each step's questions. Turn that into a **pre-flight card stack** shown before any worker starts, like Factory's clarifying round. Give each card a **default if you don't answer** and a deadline. Workers start with those answers, and an unanswered card later falls back to its default and is flagged on the map instead of blocking. That converts most mid-run interrupts into one batched sitting.

4. **Tier the interruptions by blast radius.** Interrupt only for irreversible or outward actions: push, merge, deploy, send, spend, delete, credentials. Everything else queues as a non-blocking "FYI" on the map. Put **evidence in the card** (the diff hunk, test output, screenshot), not a filename. GenUI's approval channel is already one the agent can't read or forge, since the app types the answer into a terminal it owns and side agents are read-only. Keep it that way and say so in the UI.

5. **Read official state signals, with OSC 7501 first.** Claude Code emits OSC 7501 (working / blocked / done / error / idle) when the terminal answers its query. GenUI owns the pty, so it can answer that query and read the state directly. That is more robust than the footer reading, and it gives Codex and Grok sessions status the moment they adopt the protocol. Hooks stay the source of detail (what was asked). This fits "How it stays a wrapper" exactly.

6. **End every worker in a review station with a structured handoff note.** When a worker finishes, show diff + tests run + "what I changed / what I verified / what's still risky". Ask the worker for that note as its last message; the flowchart already holds most of it. Offer **"Review with a fresh agent"**: a reviewer that doesn't share the author's context, which Reddit's top advice says matters. Then approve / revise / reject, PR, merge, archive.

7. **Keep the orchestrator thin, and use GenUI's own flowcharts as its view of the workers.** The planner plans, routes and checks. It shouldn't read worker transcripts. It reads each worker's **flowchart tree**, a compact structured summary GenUI already maintains, which avoids the drift-after-five-reports and context-saturation failures. Follow-ups from you go **straight to the worker**, not through the planner. Ordering, merge sequencing and ranking are done by code from the tree. The planner speaks only when a step fails twice or a dependency changes.

8. **Make the worktree per worker the default, with a setup script.** Each worker gets a worktree. A per-folder setup script copies `.env`, installs or links dependencies and assigns ports, following Superset and Worktrunk. Show conflicts between worker branches early on the map, as an edge between two branches touching the same files.

9. **Add concurrency slots, a priority queue, and "answers win ties".** Cap running workers (default 3 to 5, as Claude's docs and practitioners suggest). Queue the rest by your priority, and never let an agent raise its own priority. An answered ask resumes before new work starts.

10. **Show cost and stall per branch.** Put tokens or usage per worker on its branch, add a goal budget, and raise an amber "stalled" state when a worker shows no hook event or OSC change for N minutes. This is Devin's "died overnight with no stall alert" complaint.

11. **Later: a phone view of the inbox only.** The pattern (T3, Orca, Omnara, Paseo) is that people leave the PC running and answer from the phone. GenUI's inbox rows are exactly the right unit. Don't port the terminal to the phone; Orca's laggy phone terminal is the warning.

A possible home layout:

```
┌───────────────┬──────────────────────────────────────────────┬────────────────────────┐
│ FLEET         │ GOAL MAP: "Ship billing v2"                  │ NEEDS YOU (3)          │
│ ● api   Claude│            [Ship billing v2]                 │ ▲ db · Codex           │
│ ● db    Codex │           /       |        \                 │  Migrated 3 tables.    │
│ ○ ui    Grok  │      [api ●]  [db ▲]   [ui ✓ review]         │  Drop legacy column?   │
│ ✓ docs  Claude│        |        |          |                 │  [1 Keep] [2 Drop ★]   │
│               │   Edit 4 files  Run migr.  diff +120 −8      │  Discuss it · Later    │
│ 4 running/5   │        ·        ▲ ask      [Review]          │ ▲ api · Claude         │
│ $3.10 / $10   │                                              │  Approve git push?     │
│               │  ── db and api both touch billing.ts ──      │  [diff hunk…]          │
│ + New goal    │                                              │ [Send 3 answers]       │
└───────────────┴──────────────────────────────────────────────┴────────────────────────┘
 click any node or row → that agent's real terminal + its plan rail (today's agent view)
```

### 5.2 Pitfalls to avoid

- **Tab or chat soup past 5 agents.** A list of chats doesn't scale. Make the map and the inbox primary, and the terminals a click away.
- **Kanban of raw todos.** Columns full of unreadable task text and "blocked" popups are a reported failure. If GenUI shows columns, cards must be generated summaries, and *blocked* must say on whom.
- **Approval fatigue.** Every extra "Approve?" trains rubber-stamping. Batch, tier, show evidence, and never offer a global auto-yes.
- **A fat orchestrator.** Don't let the planner read every transcript, do the work itself, or approve plans on your behalf (the Claude agent-teams default). Keep it a router with a checklist.
- **Status by screen-scraping.** It is fragile, as Herdr's churn shows. Prefer hooks and OSC 7501, and keep screen reading as a speed-up only (already GenUI's rule).
- **Parallelism beyond review bandwidth.** "Past about three parallel agents, reviewing diffs becomes the whole job." A solo owner may get more from 1 to 3 well-specified agents than from 10. Make the default small and show review backlog as a first-class number.
- **Turning into a chat app.** Orca was criticised for drifting toward "a chat-based UI on top of the agents". GenUI's promise is the *real* harness beside a visual rail. Keep the terminal the source of truth.
- **Silent cost burn and silent death.** Both top the Devin and Codex complaints. Budget and stall alarms are table stakes.
- **Third-party runtime dependencies.** Conductor's 3 Nov outage was reportedly a licence key in a UI library. Keep GenUI's dependency surface small and local.
- **Competing with vendor hubs on their own ground.** The 2026 casualties (Terragon, Crystal, Vibe Kanban's company, Jules, Agent Inbox) were mostly single-harness managers whose feature the platform absorbed. GenUI's defensible ground: **cross-harness** (Claude + Codex + Grok in one map), **wrapper-only** (harness updates arrive for free), and **generative explanation** (map, cards, Discuss it). Don't rebuild what `claude --worktree`, the Claude desktop hub or the Codex review queue already do well. Link to them.

---

## Sources

**Product docs and pages**
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams
- Claude Code desktop: https://code.claude.com/docs/en/desktop
- Codex desktop guide (automations, triage, review queue): https://codex.danielvaughan.com/2026/04/08/codex-desktop-automations/
- Codex in ChatGPT app: https://learn.chatgpt.com/docs/app
- Cursor 3 Agents Window: https://dev.to/gabrielanhaia/cursor-3-glass-replaced-composer-with-an-agents-window-1pcg ; 3.2: https://doolpa.com/news/cursor-3-2-multitask-worktrees-multi-root-workspaces-april-24-2026
- VS Code: https://code.visualstudio.com/blogs/2026/10/28/vscode-wrapped ; https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development
- Antigravity codelab: https://codelabs.developers.google.com/getting-started-google-antigravity?hl=en ; Jules shutdown: https://www.testingcatalog.com/cloud-execution-is-coming-to-antigravity-soon/
- Devin Desktop: https://dev.to/docdavkitty/devin-desktop-turns-the-ide-into-an-agent-command-center-and-opens-the-door-to-any-ai-coder-3660
- Factory Missions: https://docs.factory.ai/missions/overview ; https://factory.ai/news/missions
- Amp: https://ampcode.com/news/from-agent-to-agent ; https://ampcode.com/docs/orbs ; thread map: https://tessl.io/blog/amp-launches-thread-map-to-help-navigate-ai-coding-agent-work/
- Warp: https://docs.warp.dev/agents/using-agents/managing-agents
- Conductor: https://www.conductor.build/ ; https://www.conductor.build/docs/
- Orca: https://github.com/stablyai/orca ; https://www.onorca.dev/docs/model/agents-sessions
- T3 Code: https://github.com/pingdotgg/t3code
- Herdr: https://herdr.dev/docs/remote ; https://dev.to/pvgomes/herdr-is-tmux-for-coding-agents-3h2a
- Superset: https://github.com/superset-sh/superset
- Claude Squad: https://github.com/smtg-ai/claude-squad
- Nimbalyst: https://nimbalyst.com/
- Sculptor: https://rywalker.com/research/sculptor
- Vibe Kanban: https://github.com/BloopAI/vibe-kanban ; https://vibekanban.com/blog/shutdown
- Terragon: https://bra1ndump-website.pages.dev/blog/research/harness-engineering/terragon
- Omnara: https://www.everydev.ai/tools/omnara
- Agentbox: https://github.com/savannahfeder/agentbox
- Canvases: https://github.com/DeadWaveWave/opencove ; https://github.com/190km/void ; https://github.com/ziplyne-agency/codegrid-claude-code-terminal ; https://github.com/0-AI-UG/cate
- LangGraph Agent Inbox: https://github.com/langchain-ai/agent-inbox
- CrewAI: https://github.com/crewAIInc/crewAI ; AutoGen status: https://futureagi.com/blog/what-is-autogen-2026/

**X posts** (cited inline above; the key ones)
- Fleet and attention: https://x.com/dannyinsf_/status/2093407620967092359 · https://x.com/hamudinaanaa/status/2115333877862727945 · https://x.com/orca_build/status/2098055393377124672 · https://x.com/AlexFinn/status/2098243595593830436 · https://x.com/omuxapp/status/2117709939460489463 · https://x.com/mitchellh/status/2107577887159386152 · https://x.com/hsalazar/status/2117816043653726686
- Inbox and approvals: https://x.com/SavannahFeder/status/2107566510386577695 · https://x.com/dannypostma/status/2082275703710679344 · https://x.com/VanceConsulting/status/2117376393516400700 · https://x.com/Podex_AI/status/2115612414771155124 · https://x.com/Iam_Shivanshu/status/2117655960491590117 · https://x.com/AnandButani/status/2117708870613397685 · https://x.com/TAAFTResearch/status/2117574749874237882 · https://x.com/Vatsalpandya333/status/2117478875735445694
- Vendor hubs: https://x.com/ClaudeDevs/status/2110445844675838148 · https://x.com/testingcatalog/status/2110455911344931130 · https://x.com/daniel_mac8/status/2110476077240082643 · https://x.com/ntwrknrd/status/2116087785048383858 · https://x.com/victornunez/status/2077162415310184877 · https://x.com/Yuchenj_UW/status/2106435001340621147 · https://x.com/yuvraajsinghh1/status/2116809800675954789 · https://x.com/adamwathan/status/2089370188407787532 · https://x.com/cognition/status/2061889596703551926 · https://x.com/cognition/status/2113671026286682500 · https://x.com/jishnuteegala/status/2110408411909083619 · https://x.com/jholtdigital/status/2068342224278913517 · https://x.com/bryceadams/status/2116675820794327366 · https://x.com/antigravity/status/2092750545383551281 · https://x.com/testingcatalog/status/2116885887313133576
- Third-party tools: https://x.com/Voxyz_ai/status/2086059460502417772 · https://x.com/Voxyz_ai/status/2097070213250372025 · https://x.com/kalanyei/status/2117619375423488418 · https://x.com/crowdlinker/status/2095183349652341237 · https://x.com/tomjohndesign/status/2117705975167852921 · https://x.com/iamyatendrak/status/2117702876726431780 · https://x.com/gregisenberg/status/2117734977312047537 · https://x.com/solanky/status/2116760574310731799 · https://x.com/YoDevp/status/2116519637852500440 · https://x.com/Ryan_Ravenson/status/2117769390707941614 · https://x.com/stretchcloud/status/2117294917118722077 (maker of Campfire) · https://x.com/DanKornas/status/2117677179886538926 · https://x.com/tom_doerr/status/2086106858603860213
- Orchestrator failure modes: https://x.com/hanakoxbt/status/2099608553107456472 · https://x.com/arpit_bhayani/status/2102388569449140316 · https://x.com/arpit_bhayani/status/2100444191876903215 · https://x.com/Alexlearnai/status/2117195512776683686 · https://x.com/FredPohl/status/2116822331112800767 · https://x.com/marfinxx/status/2087307396431438126 · https://x.com/uttamvarma/status/2115918046728790125 · https://x.com/jbdamask/status/2117738229340270686 · https://x.com/DawneraGames/status/2116561687696572576
- Generative-UI supervision: https://x.com/Voxyz_ai/status/2103946635831050740 · https://x.com/ctatedev/status/2066555279295008908 · https://x.com/CopilotKit/status/2115499466182799400 · https://x.com/pitus_/status/2117688977876492426 · https://x.com/pitus_/status/2109943155890242038

**Reddit** (one Reddit Answers question): https://www.reddit.com/answers/dafaeff6-bc52-4172-8c94-ba45db4a9e73/. Threads include https://www.reddit.com/r/ClaudeCode/comments/1x3a7ni/how_do_you_guys_orchestrate_multiple_coding/ · https://www.reddit.com/r/LLMDevs/comments/1wkn5if/whats_the_best_tool_for_running_claude_code_and/ · https://www.reddit.com/r/ClaudeCode/comments/1xb1fnv/things_i_wish_i_knew_before_running_multiple_ai/ · https://www.reddit.com/r/BestGitHubRepos/comments/1x6t15y/orca_the_ai_orchestrator_for_100x_builders_928k/
