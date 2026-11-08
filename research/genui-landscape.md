# Generative UI today: how the systems work, and what GenAgent UI should do

Research for GenAgent UI, November 2026. The question behind it: should the flowchart beside the terminal be produced by AI, by code, or both, and is there a protocol or pattern worth copying?

Short answer: **both, in layers.** Code builds the skeleton from the transcript the moment anything happens. The model only annotates it: it groups, names and marks intent, and it refers to nodes by IDs that code assigned. Almost every production system below draws the same line. Deterministic code owns structure, identity, layout and state. The model picks from a fixed vocabulary and fills in content.

---

## 1. The landscape, system by system

For each system: what the model emits, who renders it, how state and streaming work, how the UI stays stable, and where code decides versus the model.

### 1.1 Vercel AI SDK

There are two generations.

**AI SDK RSC (`streamUI`): the model's tool call runs server code that yields React.** You give `streamUI` tools, and each tool has a `generate` function, which can be an async generator. When the model calls a tool, the server runs `generate`. It can `yield` a loading component, fetch data, then `return` the final component. These React Server Components stream to the client as the call's `value` ([streamUI reference](https://ai-sdk.dev/docs/reference/ai-sdk-rsc/stream-ui)). The model never writes UI. It only chooses a tool and its arguments. The docs now say plainly that "AI SDK RSC is currently experimental. We recommend using AI SDK UI for production", and they include a migration guide ([RSC overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview)).

**AI SDK UI (`useChat` and message parts): tool calls become typed parts, and the client maps them to components.** A message is an array of `parts` (text, reasoning, file, `tool-<name>`, `data-<name>`). Each tool part moves through states: `input-streaming`, then `input-available`, then `output-available` or `output-error`. Your client code switches on `part.type` and `part.state` to render a skeleton, the finished component, or an error ([Generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)).

- **What the model emits:** tool calls with JSON arguments. Nothing visual.
- **Who renders:** your React components on the client, chosen by tool name.
- **Streaming and stability:** custom `data-*` parts carry an optional `id`. "When you write to a data part with the same ID, the client automatically reconciles and updates that part." So you can write `status: 'loading'` and later the final data under the same ID. Parts marked `transient: true` reach `onData` but stay out of history ([Streaming data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)).
- **Code vs model:** code decides every pixel. The model decides only which tool to call and with what arguments.

The update-in-place-by-ID idea is exactly what a growing flowchart needs.

### 1.2 CopilotKit and the AG-UI protocol

CopilotKit sorts generative UI into three kinds by how much control the frontend keeps ([CopilotKit, Developer's guide to generative UI in 2026](https://copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)):

1. **Static:** the agent calls a tool, and a pre-built component renders it (`useFrontendTool`, `useComponent`, `useRenderToolCall`, `useHumanInTheLoop`). The frontend keeps the most control ([docs](https://docs.copilotkit.ai/generative-ui)).
2. **Declarative:** the agent returns a JSON UI spec (A2UI or Open-JSON-UI), and the frontend renders it with its own components and theme (`createA2UIMessageRenderer`).
3. **Open-ended:** the agent returns a whole UI surface, usually MCP Apps HTML in an iframe (`MCPAppsMiddleware`). It has the most freedom and the least consistency and safety.

**AG-UI** is the transport underneath all three: one event stream from agent to frontend ([AG-UI events](https://docs.ag-ui.com/concepts/events)).

- **Lifecycle:** `RunStarted`, `RunFinished` (with an `outcome` of success or interrupt), `RunError`, `StepStarted` and `StepFinished` (each with `stepName`).
- **Text and tool calls:** start, content, end triples (`TextMessageStart`/`Content`/`End`, `ToolCallStart`/`Args`/`End`, then `ToolCallResult`). Content events carry a `delta` that the client concatenates.
- **State:** `StateSnapshot` carries the full state. `StateDelta` carries an RFC 6902 JSON Patch against it ([State](https://docs.ag-ui.com/concepts/state)). `MessagesSnapshot` carries the history.
- **Activity:** `ActivitySnapshot` and `ActivityDelta` are activity messages kept up to date by patch. They suit progress or plan widgets.
- **Others:** reasoning events, `SubagentStarted`/`Finished`/`Error`, and `Raw` and `Custom` escape hatches.
- **Human in the loop:** frontend tools. The agent calls a tool that the frontend executes by rendering UI and waiting for the user ([Tools](https://docs.ag-ui.com/concepts/tools)).

On stability, the frontend keeps the authoritative copy of state. Snapshots resynchronise it, and deltas keep updates small. Code owns the event schema and the reducers. The model's output is just one producer of events.

### 1.3 Google A2UI

A2UI is a declarative UI spec led by Google, with CopilotKit as a launch partner. v0.9 shipped on 17 April 2026 ([Google Developers Blog](https://developers.googleblog.com/a2ui-v0-9-generative-ui/)).

- **What the model emits:** JSON messages. In v0.9 these are `createSurface` (which names a `catalogId` and must come first), `updateComponents`, `updateDataModel` and `deleteSurface`. In v0.8 they were `surfaceUpdate`, `dataModelUpdate`, `beginRendering` and `deleteSurface` ([message reference](https://a2ui.org/reference/messages/)).
- **Key design choice:** components form an **adjacency list**, a flat list of components each with an `id` that point to their children by ID instead of nesting. The stated reason is that a flat list is "much easier for LLMs to generate piece by piece" and to update one component at a time ([components](https://a2ui.org/concepts/components)).
- **State:** structure (components) is kept apart from data (the data model). Components bind to JSON Pointer paths such as `{"path": "/user/email"}` and re-render when that value changes. Data updates therefore never touch structure.
- **Who renders:** native renderers for React, Angular, Lit and Flutter, using the client's own catalog of components. v0.9 renamed the "Standard" catalog to "Basic" because "frontend developers don't want new components. They already have a design system."
- **Streaming:** "resilient streaming". The SDK parses and validates JSON as it streams, so components render before the full block arrives. In v0.8 the client buffered messages until `beginRendering` arrived.
- **Code vs model:** the catalog (code) defines what can exist. The model composes and fills it.

The flat, ID-referenced, update-by-ID shape fits a flowchart that grows over time. GenAgent UI's `flowtree.js` ops (`add` with `parent`, then `state` and `rename` by ID) are already close to it.

### 1.4 MCP-UI, MCP Apps and the OpenAI Apps SDK

All three put UI resources in tool results.

- **MCP-UI** was the community prototype. A server returned a UI resource (`createUIResource`) with `rawHtml`, `externalUrl` or `remoteDom` content. The host rendered it in a sandboxed iframe through `UIResourceRenderer`, and the iframe sent `tool`, `prompt`, `intent`, `notify` and `link` actions back over `postMessage`. Its packages now implement the MCP Apps standard ([repo](https://github.com/idosal/mcp-ui)).
- **MCP Apps (SEP-1865, Final)** standardises this ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)). UI templates are **predeclared** `ui://` resources (`text/html;profile=mcp-app`), and tools point to them through metadata. Hosts can therefore prefetch and security-review templates, and template and data stay separate. The iframe talks to the host with MCP JSON-RPC over `postMessage`. Inline embedding in tool results was considered and deferred for performance and reviewability.
- **OpenAI Apps SDK:** the developer links a tool to a widget through `_meta.ui.resourceUri` (formerly `openai/outputTemplate`). The tool's `structuredContent` reaches the iframe as `window.openai.toolOutput`, or through the standard `ui/notifications/tool-result`. The widget can persist `widgetState`, call tools (`callTool`, which bridges to `tools/call`) and send follow-up messages. ChatGPT supports the MCP Apps standard. In OpenAI's words, the developer controls what renders, not the model ([Build your ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)).

**Code vs model:** the HTML is written by a developer ahead of time, not by the model at runtime. The model chooses the tool and fills its arguments. Even the "open-ended" category is therefore usually pre-built UI fed by model-chosen data.

### 1.5 Thesys C1, now OpenUI

C1 was an OpenAI-compatible API whose responses were not markdown but "a string that is structured payload", an XML-like envelope holding UI content. The `C1Component` React component rendered it, and `stream: true` gave progressive rendering ([legacy streaming docs](https://docs.thesys.dev/guides/streaming)). The C1 docs now redirect to **OpenUI**, an open framework ([OpenUI docs](https://www.openui.com/docs), [repo](https://github.com/thesysdev/openui)).

- **What the model emits:** *OpenUI Lang*, a line-oriented DSL with one `identifier = Expression` per line, for example `root = Stack([header, stats])` and `s1 = StatCard("Revenue", "$1.2M", "up")`. They claim it uses far fewer tokens than JSON.
- **Streaming:** the parser reads line by line. Forward references are allowed, and the renderer shows a placeholder until the definition arrives. Writing top-down (layout, then components, then data) gives the best streaming. An "Autofix" step repairs invalid output.
- **Code vs model:** "You define the components. The model decides how to combine them."

It is the same idea as A2UI (flat, ID-referenced, catalog-constrained), with a cheaper syntax.

### 1.6 LangGraph / LangChain generative UI

([docs](https://docs.langchain.com/langsmith/generative-ui-react))

- **What the model emits:** nothing UI-specific. Graph nodes (code) call `push_ui_message(name, props, message=...)` in Python or `ui.push()` in JavaScript, usually after a model call.
- **State:** UI messages live in a `ui` state channel with its own reducer (`ui_message_reducer`). Pushing again with the **same ID** updates that element, and `merge=True` merges props for streaming. `delete_ui_message` removes one.
- **Who renders:** `useStream()` exposes `values.ui`, and `LoadExternalComponent` loads the bundled component code (declared in `langgraph.json`) into a shadow DOM.
- **Code vs model:** the graph author decides when UI appears. The model supplies content.

### 1.7 assistant-ui

A React chat UI kit. `makeAssistantToolUI({ toolName, render })` registers a component for one tool. `render` receives `args`, `argsText` (the partial arguments while streaming), `result` and `status` (`running`, `requires-action`, `complete`, `incomplete`), and can return a result for human-in-the-loop tools ([makeAssistantToolUI](https://www.assistant-ui.com/docs/copilots/make-assistant-tool-ui)). It is the purest "tool call to component" mapping. It also has a LangGraph generative UI adapter ([docs](https://www.assistant-ui.com/docs/runtimes/langgraph/generative-ui)).

### 1.8 Tambo

You register components with `name`, `description`, `component` and a Zod `propsSchema`. Tambo turns each schema into a tool definition, so the model "calls" a component, Tambo validates the output and **streams props** into it as they arrive. There are two kinds ([repo](https://github.com/tambo-ai/tambo)):

- **Generative** components render once.
- **Interactable** components (`withInteractable`) persist and are updated in later turns.

Note that the README says Tambo Cloud shuts down on 31 October 2026. Self-hosting remains. The interactable-component idea (one persistent component the model keeps editing) maps directly onto "one flowchart, updated every turn".

### 1.9 json-render (Vercel Labs) and similar spec renderers

([repo](https://github.com/vercel-labs/json-render))

- **What the model emits:** a spec of the form `{ root, elements }`, where `elements` is a flat map from ID to `{ type, props, children: [ids] }`.
- **Catalog:** `defineCatalog()` defines components and actions with Zod prop schemas. The model can only produce what the catalog has.
- **Streaming:** "SpecStream" is a JSONL stream that `createSpecStreamCompiler()` turns into progressive patches on the spec.
- **Dynamic behaviour:** props can bind to state (`{ "$state": "/path" }`) or to conditions, and elements can carry `visible` conditions and `watch` triggers. All of it runs in code.
- **Who renders:** renderers for React, Vue, Svelte, React Native, terminal (Ink) and more.

This is the same convergence again: flat map, IDs, catalog, patches.

### 1.10 Anthropic: artifacts and interactive visuals

- **Artifacts** are the **code-generation** end of the spectrum. Claude writes a whole self-contained document (HTML, React, SVG, Mermaid, markdown). It runs in a cross-origin sandboxed iframe with full-site process isolation and a strict CSP. A small team built it in about three months ([Simon Willison, "How Anthropic built Artifacts"](https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts), [Anthropic help](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)). Edits are either targeted updates to a section or full rewrites.
- **Interactive visuals** (beta in March 2026) are inline, temporary visuals that "change or disappear as the conversation evolves". Claude decides when to draw one, and the user can ask for adjustments ([Claude blog](https://claude.com/blog/claude-builds-visuals)).
- **Code vs model:** the model decides everything inside the sandbox. Code only isolates it.

Stability comes from regenerating or patching the code, so a small request can still shift the layout. That is fine for an explainer and wrong for a status display.

### 1.11 Google Generative UI (Gemini "dynamic view")

This is research and product work (Gemini app and Search AI Mode, November 2025) in which Gemini 3 Pro writes **full HTML, CSS and JS** for each prompt. It relies on a long system prompt (goals, planning, examples, technical specs, tips for avoiding common errors), tools for image generation and search, and post-processors that fix common errors ([Google Research blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/), [paper](https://arxiv.org/abs/2604.09577)).

Human raters strongly preferred it to markdown, but only when generation time was ignored. It "can sometimes take a minute or more". This is the clearest evidence that full code generation looks rich but is too slow for anything live.

### 1.12 Agent progress and plan views (closest to GenAgent UI)

- **Claude Code's own task list.** The agent calls a tool, and the harness renders a list. The old `TodoWrite` sent the whole list on every call. Current Claude Code splits it into `TaskCreate` (one per item: `subject`, `activeForm`), `TaskUpdate` (`taskId`, `status` of `pending`, `in_progress`, `completed` or `deleted`), `TaskGet` and `TaskList`. The new task's ID arrives only in the tool result (`tool_use_result.task.id`). Claude Code also repairs key names such as `id` or `task_id` to `taskId` before running the tool, but the transcript shows the raw input, so read fields defensively. **Important:** from Claude Code v2.1.268 these tools are on by default only for Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier. Newer models get no task list unless the session opts in, for example with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ([Track todos, Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/todo-tracking)).
- **Codex `update_plan`.** The model sends `{ explanation?, plan: [{ step, status }] }` with `pending`, `in_progress` or `completed`, and the TUI renders it ([codex-protocol `plan_tool.rs`](https://docs.rs/crate/codex-protocol/latest/source/src/plan_tool.rs)). A third-party write-up says it became opt-in (`[tools.update_plan] enabled = true`) in late August 2026 ([Daniel Vaughan](https://codex.danielvaughan.com/2026/08/31/codex-cli-update-plan-tool-opt-in-external-planning-competing-surfaces/)). I have not confirmed this against OpenAI's own docs, so check it there.
- **Cursor plan mode** has the agent research, ask questions, and write an editable markdown plan with to-dos. To-dos can depend on each other and are ticked off as the agent works. Plans can be saved to `.cursor/plans/` ([Cursor blog](https://cursor.com/blog/plan-mode)).
- **Devin 2.0 interactive planning** returns files, findings and an editable plan before it acts. A Progress tab logs shell, editor and browser actions in one timeline ([Devin docs](https://docs.devin.ai/work-with-devin/interactive-planning)).
- **Kiro** keeps the plan as files (`requirements.md`, `design.md`, `tasks.md`) that the agent executes task by task ([Kiro blog](https://kiro.dev/blog/from-chat-to-specs-deep-dive/)).
- **Transcript visualisers for coding agents** are all **programmatic**:
  - [coding-agent-visualizer](https://github.com/everettjf/coding-agent-visualizer) normalises Claude Code, Codex, Gemini CLI, OpenCode and Cursor logs into one model (nodes, tools, tokens, parent links). It folds tool calls into chips, branches subagents off the main flow, lays out with dagre plus chain compaction, and live-tails the files.
  - [ccviz](https://pypi.org/project/ccviz/) draws per-turn workflow graphs, with new nodes appearing within a few seconds.

  None of them use a model for structure.

The pattern across plan views: **the model writes the plan itself (as a tool call or a file), and code renders and tracks it.** Progress against the plan comes from status fields the model sets. Nobody infers it from screenshots or the model's prose.

---

## 2. Patterns across systems

### 2.1 Four ways a model produces UI

| Pattern | Model emits | Renders | Examples | Speed and stability | Good for |
|---|---|---|---|---|---|
| **Code generation** | Full HTML, JS or React | Sandboxed iframe | Claude artifacts and visuals, Gemini dynamic view | Slow (seconds to a minute). Each regeneration can shift the layout. | One-off explainers and tools |
| **Component selection (tool to component)** | A tool call and its arguments | Pre-built component chosen by tool name | AI SDK UI, assistant-ui, CopilotKit static, Tambo, LangGraph, MCP Apps and Apps SDK (template fixed, data from the model) | Fast, stable, typed | Known shapes: cards, approvals, results |
| **Declarative spec** | JSON or DSL describing a tree from a catalog | Client's own components | A2UI, json-render, OpenUI Lang, Open-JSON-UI | Medium. Stable if IDs persist. Streams component by component. | Varied layouts in a consistent style |
| **Event or state stream** | Nothing visual. Events and state patches. | Client reducers and components | AG-UI, LangGraph `ui` channel, AI SDK data parts, harness todo lists | Fastest. Deterministic. | Live progress and status |

Most real products combine these: an event stream as transport, component selection for known widgets, and a declarative spec where layouts vary.

### 2.2 Who decides what

Across every system, deterministic code owns:

- the vocabulary (catalog or tool list)
- identity (IDs)
- the state store and its reducers
- layout and styling
- validation and repair
- security

The model owns:

- which component or tool to use
- the words (labels, summaries)
- grouping and intent
- sometimes composition, within the catalog

Even the "open-ended" systems keep the template in code (MCP Apps predeclares templates for exactly this reason).

### 2.3 How incremental updates are handled

- **Stable IDs plus update-in-place.** AI SDK data parts with the same `id`, LangGraph `push_ui_message` with the same ID, A2UI `updateComponents` keyed by component ID, Tambo interactables.
- **Snapshot plus delta.** AG-UI `StateSnapshot` and `StateDelta` (JSON Patch), A2UI data-model updates, json-render SpecStream patches. Snapshots repair drift, and deltas keep updates cheap.
- **Flat adjacency lists instead of nested trees** (A2UI, json-render, OpenUI). The model can emit or update one node at a time without restating the tree.
- **Separate structure from data.** Binding to data paths lets values change without re-emitting structure.
- **Append-only history plus mutable status.** Plan tools and AG-UI messages are never rewritten. Only `status` fields change. GenAgent UI's `flowtree.js` already enforces this: finished and dropped nodes are frozen, and only steps not yet started can be renamed.
- **Partial-input rendering.** AI SDK `input-streaming` and assistant-ui `argsText` let a skeleton fill in while arguments stream.

---

## 3. Recommendations for GenAgent UI

What exists today (from the code): `server/genui.js` asks Sonnet to return `ops` on a tree that only grows (`server/flowtree.js`), plus cards from a fixed kit. An uncommitted `server/flowdraft.js` builds an "Instant" tree from the transcript with no model call. `web/app.js` currently offers a toggle between **AI** and **Instant**.

The main recommendation is to **replace the toggle with one tree in two layers**.

### 3.1 The programmatic flowchart: instant, derived from the transcript

Make this the only source of **structure** and **state**. It should be correct with no model at all.

1. **Event-source it.** Parse each harness's transcript into a normalised event stream, which `transcripts.js` already does: user message, assistant text, tool call, tool result, error, turn start and end. Then fold the events with a pure reducer into the tree. Process only new lines (track a byte offset per file) instead of rebuilding the whole tree on every change.
2. **Give every node an ID taken from the source, not a counter.** Use the user message's UUID or line number for goals and the first tool call's ID for steps (Claude `tool_use.id`, Codex `call_id`). Right now `buildDraft` numbers nodes `d1, d2, …` on every rebuild, and folding (`"N earlier actions"`) deletes and renames nodes. IDs then shift under the UI and animations jump. With source IDs:
   - the DOM can key on them;
   - the AI layer can refer to them;
   - folding becomes a **view** decision (collapse older steps in the renderer) instead of deleting data.
3. **Use the agent's own task list when it has one, and expect it often won't.**
   - **Bug: Claude's current task tools are ignored.** `transcripts.js` reads only `TodoWrite`. `flowdraft.js` already drops `TaskCreate` and `TaskUpdate` as "the agent's own list", so on current Claude Code the list disappears entirely. Add a small reducer: `TaskCreate` waits for its `tool_result` to get the task ID, `TaskUpdate` changes status or removes on `deleted`, and the `taskId`, `id` and `task_id` keys are read defensively, as the [Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/todo-tracking) show.
   - **Newer models emit no task list by default** (Claude), and Codex's `update_plan` may now be opt-in. For sessions GenAgent UI **starts**, decide whether to set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (and the Codex equivalent). It gives a free, model-authored plan at the cost of nudging the agent's behaviour. Make it a setting, not a silent default.
   - Without a task list, the tool-call grouping in `flowdraft.js` is the fallback. That is why section 3.2 matters.
4. **Group tool calls with deterministic rules, as `flowdraft.js` already starts to:**
   - runs of reads become "Read 4 files";
   - repeated edits to one file become "Edit X ×3";
   - each distinct command becomes "Run …";
   - delegations (`Agent`/`Task`) branch like subagents, the way coding-agent-visualizer does;
   - `AskUserQuestion` and approvals become amber nodes.

   Short "yes / go ahead" replies continue the current goal, as they do now.
5. **Derive state, never guess it.**
   - "Current" is the last open tool call, or the latest goal when it is the user's turn.
   - "Waiting" comes from the hook or screen signal `live.js` already has.
   - "Done" means a tool result exists.
   - "Error" means `is_error` or a failed turn.
6. **Make it feel generative without a model:**
   - Animate new nodes in (fade or slide plus height) and keep existing nodes fixed. The [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) or a FLIP pattern does this cheaply when nodes are keyed by stable IDs.
   - Pulse the current node while it works and switch it to amber when it waits.
   - Stream the label of the running step from the tool input as it arrives (for example "Run npm te…" growing to "Run npm test"). This is the AI SDK `input-streaming` idea, made possible by the live terminal and hooks.
   - Show a live "now" line from the last tool call ("Editing NavbarV3.tsx").
   - Keep the layout append-only. A vertical rail with indented branches needs no general graph layout. If you ever move to a 2D graph, use ELK layered with model-order options (`considerModelOrder.strategy`, `forceNodeModelOrder`) or its interactive strategies so older nodes stay put ([ELK, Constraining the model](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html)).

### 3.2 The AI pass: group and label on top of the skeleton

Keep a model in the loop for what code can't do well:

- naming a goal from a messy request;
- splitting a long run of actions into units a person recognises ("Map the nav entries");
- spotting a change of direction;
- predicting upcoming steps;
- reading questions in prose into cards.

Constrain it so it can never break the skeleton:

1. **The model sees the skeleton with IDs and returns overlay ops only:**
   - `group { ids: [...contiguous step ids], label }` creates a step that wraps those skeleton nodes;
   - `label { id, text }` gives a goal or group a better name;
   - `goal { from_id, label, parent_goal }` marks where a new direction starts, which can override the regex heuristic;
   - `plan { after_id, label }` adds a predicted step, drawn as a ghost until real events land in it;
   - `drop { id }` applies to predicted steps only.

   It never creates nodes for events, never changes state, and never touches structure code owns. This is the A2UI and json-render discipline (fixed vocabulary, ID references, updates keyed by ID), applied to a tree that already exists.
2. **Validate and apply in code.** This is where `flowtree.js` already lives. Reject groups that aren't contiguous or that cross goals. Ignore IDs that don't exist. Freeze labels on finished groups, keeping today's "done and dropped never change" rule.
3. **New events after the model's last cursor appear immediately, ungrouped,** under the current goal (or a lightly styled "working…" group). When the next AI pass returns, wrap them with a short animation: children slide under a new parent and its label fades in. The tree is never wrong, only less summarised, for at most one pass.
4. **Cadence and cost:**
   - Run at turn end, as now.
   - Run mid-turn every N tool calls or every M seconds, as now (`GENUI_MIDTURN_TOOLS`, `GENUI_MIDTURN_SEC`).
   - Send only skeleton nodes added since the cursor plus their parent goals, not the transcript. Labels and groups need tool names and arguments and the user's words, not tool output. That cuts tokens a lot.
   - A small, fast model is enough for mid-turn labelling. Keep the stronger model for turn-end passes that also produce cards.
5. **Cards stay a fixed-kit, component-selection pattern** (choice, approve, input, teammate, checklist, note), as they are now. That is the AI SDK / assistant-ui / Tambo pattern and the right one. Native `AskUserQuestion` stays deterministic (`pendingAsk`). Only questions buried in prose need the model.
6. **Drop the AI / Instant toggle.** One tree, skeleton always on, overlay when available. If you keep a switch, make it "show raw actions" (expand groups), not "pick a source".

### 3.3 Protocols and patterns worth adopting

- **Adopt the AG-UI event shape internally; skip the dependency.** Between `server/` and `web/`, send:
  - `RunStarted` and `RunFinished` (turn boundaries);
  - `ToolCallStart`, `ToolCallArgs` and `ToolCallEnd` (from hooks and the transcript);
  - `ActivitySnapshot` and `ActivityDelta`, or `StateSnapshot` and `StateDelta`, for the tree, with JSON Patch.

  On connect or reopen the client gets a snapshot. After that it gets deltas, and a snapshot whenever a transcript is compacted or rewritten (which `genui.js` already handles by starting over). This replaces today's "broadcast `draft: buildDraft(...)`" full-tree message. It keeps the door open to plugging in AG-UI-speaking agents later, but CopilotKit itself is not needed.
- **Use a flat adjacency list for the tree** (A2UI and json-render): `{ nodes: { [id]: { kind, parent, label, state, source, children } } }`. Use it for storage, for model I/O and for patches. `flowtree.js` is already flat with `parent` pointers, so this mostly means keying by ID and patching instead of resending.
- **Separate the skeleton store from the overlay store.** The skeleton is code-owned and append-only. The overlay is model-owned and versioned per pass. Merge them in the renderer. That gives instant updates, AI polish, and no way for a bad model response to corrupt history. It is the AI SDK "same-ID reconcile" plus AG-UI "snapshot repairs drift" approach applied to two sources.
- **Keep a fixed component kit for everything rendered** (node kinds: goal, step, group, ask, approval, error, subagent; plus the card kinds). The model chooses among them and never emits markup. Don't use code generation (artifacts or MCP Apps HTML) for the rail: Google's own results show the latency, and regeneration breaks the stability a live status view needs.
- **Optional later:** expose the session tree as a read-only MCP resource, so a side-discussion fork or another agent can read "where are we" without parsing the transcript.

### 3.4 Concrete next steps, in order

1. Add Claude `TaskCreate`/`TaskUpdate` parsing alongside `TodoWrite` in `transcripts.js`. Today Claude's current task lists are lost.
2. Switch `flowdraft.js` node IDs to source IDs and make folding a render-time collapse.
3. Make the skeleton incremental (byte-offset tail plus reducer) and broadcast deltas instead of whole trees.
4. Rewrite the `genui.js` schema so ops reference skeleton IDs (`group`, `label`, `goal`, `plan`), with validation in `flowtree.js`. Remove the AI/Instant toggle.
5. Add the entry, regroup and label animations and the streaming label for the running step.
6. Decide on the task-tools setting for sessions GenAgent UI starts.

---

## Sources

Vercel AI SDK: [Generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces) · [Streaming data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data) · [RSC overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview) · [streamUI](https://ai-sdk.dev/docs/reference/ai-sdk-rsc/stream-ui)
AG-UI and CopilotKit: [Events](https://docs.ag-ui.com/concepts/events) · [State](https://docs.ag-ui.com/concepts/state) · [Tools](https://docs.ag-ui.com/concepts/tools) · [Generative UI docs](https://docs.copilotkit.ai/generative-ui) · [Developer's guide 2026](https://copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)
A2UI: [Messages](https://a2ui.org/reference/messages/) · [Components](https://a2ui.org/concepts/components) · [v0.9 announcement](https://developers.googleblog.com/a2ui-v0-9-generative-ui/)
MCP UI: [SEP-1865 MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) · [ext-apps](https://github.com/modelcontextprotocol/ext-apps) · [MCP-UI](https://github.com/idosal/mcp-ui) · [OpenAI Apps SDK UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
Others: [OpenUI](https://www.openui.com/docs) · [OpenUI repo](https://github.com/thesysdev/openui) · [Thesys C1 streaming (legacy)](https://docs.thesys.dev/guides/streaming) · [LangGraph generative UI](https://docs.langchain.com/langsmith/generative-ui-react) · [assistant-ui tool UI](https://www.assistant-ui.com/docs/copilots/make-assistant-tool-ui) · [Tambo](https://github.com/tambo-ai/tambo) · [json-render](https://github.com/vercel-labs/json-render)
Anthropic and Google: [How Anthropic built Artifacts](https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts) · [Artifacts help](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) · [Claude interactive visuals](https://claude.com/blog/claude-builds-visuals) · [Google Generative UI blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/) · [paper](https://arxiv.org/abs/2604.09577)
Agent plan views: [Claude Code todo tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking) · [Codex plan_tool.rs](https://docs.rs/crate/codex-protocol/latest/source/src/plan_tool.rs) · [update_plan opt-in (third party)](https://codex.danielvaughan.com/2026/08/31/codex-cli-update-plan-tool-opt-in-external-planning-competing-surfaces/) · [Cursor plan mode](https://cursor.com/blog/plan-mode) · [Devin interactive planning](https://docs.devin.ai/work-with-devin/interactive-planning) · [Kiro specs](https://kiro.dev/blog/from-chat-to-specs-deep-dive/) · [coding-agent-visualizer](https://github.com/everettjf/coding-agent-visualizer) · [ccviz](https://pypi.org/project/ccviz/)
Layout: [ELK, Constraining the model](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html) · [React Flow layouting](https://reactflow.dev/docs/guides/layouting)
