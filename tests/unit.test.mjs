// Unit checks for the transcript readers and the Markdown helper. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaude, parseCodex, parseGrok, digest } from "../server/transcripts.js";
import { md, ago, kt } from "../web/util.js";

test("Claude: user/assistant/tool events, pending AskUserQuestion, context", () => {
  const lines = [
    { type: "user", cwd: "C:\\proj", message: { role: "user", content: "Build the page" }, timestamp: "t1" },
    { type: "user", isMeta: true, message: { role: "user", content: "<system-reminder>x</system-reminder>" } },
    { type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Which colour?" }, { type: "tool_use", id: "tu1", name: "AskUserQuestion", input: { questions: [{ question: "Colour?", options: [{ label: "Red" }] }] } }], usage: { input_tokens: 10, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 } } },
  ];
  const p = parseClaude(lines);
  assert.equal(p.cwd, "C:\\proj");
  assert.equal(p.title, "Build the page");
  assert.equal(p.events.filter((e) => e.role === "user").length, 1);
  assert.ok(p.pendingAsk && p.pendingAsk.input.questions[0].question === "Colour?");
  assert.equal(p.context.pct, 10);
  // Once answered, it is no longer pending.
  const answered = parseClaude([...lines, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Red" }] } }]);
  assert.equal(answered.pendingAsk, null);
});

test("Codex: messages, tool calls, cwd, noise filtered", () => {
  const p = parseCodex([
    { type: "session_meta", payload: { id: "abc", cwd: "C:\\w" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>x</environment_context>" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the bug" }] } },
    { type: "response_item", payload: { type: "function_call", name: "shell", arguments: "{\"command\":[\"ls\"]}" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ]);
  assert.equal(p.cwd, "C:\\w");
  assert.equal(p.title, "Fix the bug");
  assert.deepEqual(p.events.map((e) => e.role), ["user", "tool", "assistant"]);
});

test("Grok: user query unwrapped, synthetic reminders skipped, JSON answers unwrapped", () => {
  const p = parseGrok([
    { type: "system", content: "You are Grok" },
    { type: "user", content: [{ type: "text", text: "<system-reminder>skills</system-reminder>" }], synthetic_reason: "system_reminder" },
    { type: "user", content: [{ type: "text", text: "<user_query>\nSearch X\n</user_query>" }] },
    { type: "assistant", content: "{\"answer\":\"Here it is\"}" },
  ], "C:/nowhere/x");
  assert.equal(p.events[0].text.trim(), "Search X");
  assert.equal(p.events[1].text, "Here it is");
});

test("digest keeps the first message and the newest events within the limit", () => {
  const events = [{ role: "user", text: "GOAL" }, ...Array.from({ length: 400 }, (_, i) => ({ role: "assistant", text: "x".repeat(200) + i }))];
  const d = digest({ events, pendingAsk: null }, 5000);
  assert.ok(d.includes("GOAL"));
  assert.ok(d.includes("399"));
  assert.ok(d.includes("earlier events omitted"));
});

test("md renders code, lists and escapes HTML", () => {
  const h = md("Hi **there** `x<y`\n- a\n- b\n```\n<b>raw</b>\n```");
  assert.ok(h.includes("<b>there</b>"));
  assert.ok(h.includes("<code>x&lt;y</code>"));
  assert.ok(h.includes("<ul><li>a</li><li>b</li></ul>"));
  assert.ok(h.includes("&lt;b&gt;raw&lt;/b&gt;"));
  assert.ok(!h.includes("<b>raw</b>"));
});

test("small formatters", () => {
  assert.equal(kt(1500), "1.5k");
  assert.equal(kt(250000), "250k");
  assert.equal(ago(Date.now() - 5000), "now");
});

// ---- The timeline and the agent's own task list ----
import { buildTimeline, goalLabel, messageKind, timelineText } from "../server/timeline.js";
import { applyNotes, emptyNotes } from "../server/genui.js";

test("Codex update_plan becomes the flow", () => {
  const p = parseCodex([
    { type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan: [{ step: "Make a.txt", status: "completed" }, { step: "Make b.txt", status: "in_progress" }, { step: "Make c.txt", status: "pending" }] }) } },
  ]);
  assert.deepEqual(p.plan, [{ label: "Make a.txt", state: "done" }, { label: "Make b.txt", state: "current" }, { label: "Make c.txt", state: "next" }]);
});

test("Claude TodoWrite becomes the flow, latest list wins", () => {
  const todo = (items) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: "t" + items.length, name: "TodoWrite", input: { todos: items } }] } });
  const p = parseClaude([
    todo([{ content: "A", status: "in_progress" }, { content: "B", status: "pending" }]),
    todo([{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }]),
  ]);
  assert.deepEqual(p.plan.map((x) => x.state), ["done", "current", "next"]);
  assert.equal(p.plan.length, 3);
});

test("Codex: a failed turn surfaces its error, and a new turn clears it", () => {
  const apiErr = JSON.stringify({ type: "error", status: 400, error: { type: "invalid_request_error", message: "The 'x' model is not supported.", code: "model_not_found" } });
  const lines = [
    { type: "session_meta", payload: { id: "s1", cwd: "C:\proj" } },
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ text: "Do it" }] } },
    { type: "event_msg", timestamp: "t2", payload: { type: "task_complete", last_agent_message: null, error: { message: apiErr } } },
  ];
  const p = parseCodex(lines);
  assert.equal(p.turn, "done");
  assert.deepEqual(p.turnError, { message: "The 'x' model is not supported.", code: "model_not_found" });
  assert.equal(p.events.at(-1).role, "error");
  assert.equal(parseCodex([...lines, { type: "event_msg", payload: { type: "task_started" } }]).turnError, null);
});

test("Claude Code's own menus are recognised from the screen", async () => {
  const { nativeMenu } = await import("../server/live.js");
  const ask = ["❯ 1. Red", "  2. Blue", "  3. Type something.", "  4. Chat about this", "", "Enter to select · ↑/↓ to navigate · Esc to cancel"];
  const perm = [" Bash command", "   echo hi > a.txt", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel · Tab to amend"];
  const review = ["Review your answers", " ● What shape?", "   → Pill", "Ready to submit your answers?", "❯ 1. Submit answers", "  2. Cancel"];
  const idle = ["● ANSWER=Red", "", "❯ ", "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt"];
  assert.deepEqual(nativeMenu(ask), { kind: "ask" });
  assert.deepEqual(nativeMenu(perm), { kind: "permission" });
  assert.deepEqual(nativeMenu(review), { kind: "ask" });
  assert.equal(nativeMenu(idle), null);
});

test("Claude: queued messages count as the user's; TaskCreate/TaskUpdate lists become the flow", () => {
  const p = parseClaude([
    { type: "user", message: { role: "user", content: "Build the page" } },
    { type: "assistant", message: { content: [
      { type: "tool_use", id: "a", name: "TaskCreate", input: { subject: "Write hero" } },
      { type: "tool_use", id: "b", name: "TaskCreate", input: { subject: "Write FAQ" } },
      { type: "tool_use", id: "c", name: "TaskUpdate", input: { taskId: "1", status: "completed" } },
      { type: "tool_use", id: "d", name: "TaskUpdate", input: { taskId: "2", status: "in_progress" } },
    ] } },
    { type: "attachment", attachment: { type: "queued_command", prompt: "Also add a footer", origin: { kind: "human" } } },
  ]);
  assert.deepEqual(p.plan, [{ label: "Write hero", state: "done" }, { label: "Write FAQ", state: "current" }]);
  assert.deepEqual(p.events.filter((e) => e.role === "user").map((e) => e.text), ["Build the page", "Also add a footer"]);
});

test("timeline: your messages start sections, the agent's actions become grouped steps with what they touched", () => {
  const ev = [
    { role: "user", text: "Can you update the navbar to point to juney.ai? Thanks", t: "2026-11-04T01:00:00Z" },
    { role: "tool", tool: "Read", id: "r1", input: { file_path: "C:/r/app/NavbarV3.tsx" } },
    { role: "tool", tool: "Grep", id: "g1", input: { pattern: "juney" } },
    { role: "tool_result", id: "g1", text: "2 matches" },
    { role: "tool", tool: "Read", input: { file_path: "C:/r/app/FooterV3.tsx" } },
    { role: "tool", tool: "Edit", id: "e1", input: { file_path: "C:/r/app/NavbarV3.tsx", old_string: "a\nb", new_string: "a\nb\nc" } },
    { role: "tool", tool: "Edit", input: { file_path: "C:/r/app/NavbarV3.tsx", old_string: "x", new_string: "y" } },
    { role: "assistant", text: "Done. Should I colour it too?" },
    { role: "user", text: "yes" },                                   // an answer: same section
    { role: "tool", tool: "Bash", id: "b1", input: { command: "cd C:/r && npm test && npm run lint" } },
    { role: "tool_result", id: "b1", text: "42 passed\nok" },
    { role: "assistant", text: "Tests pass." },
    { role: "user", text: "Now fix the footer link as well." },     // a new request
    { role: "tool", tool: "Edit", id: "e2", input: { file_path: "C:/r/app/FooterV3.tsx", old_string: "", new_string: "z" } },
  ];
  const tl = buildTimeline(ev, { cwd: "C:/r", working: true });
  assert.deepEqual(tl.sections.map((s) => [s.kind, s.label]), [["start", "Update the navbar to point to juney.ai"], ["new", "Fix the footer link as well"]]);
  const [a] = tl.sections;
  assert.deepEqual(a.steps.map((s) => s.label), ["Read 2 files", "Edit NavbarV3.tsx ×2", "Asks: Should I colour it too?", "You replied: yes", "Run npm test"]);
  assert.deepEqual(a.steps[0].files.map((f) => f.f), ["app/NavbarV3.tsx", "app/FooterV3.tsx"]);
  assert.deepEqual(a.steps[1].files, [{ f: "app/NavbarV3.tsx", add: 4, del: 3 }]);
  assert.deepEqual(a.steps[4].cmds, [{ c: "npm test", r: "42 passed · ok", ok: true }]);
  assert.equal(a.steps[4].said, "Tests pass.");
  assert.equal(a.t, Date.parse("2026-11-04T01:00:00Z"));
  // Ids come from the conversation, so they stay put as it grows.
  assert.deepEqual(buildTimeline(ev.slice(0, 8)).sections[0].steps.slice(0, 2).map((s) => s.id), ["tr1", "te1"]);
  assert.equal(goalLabel("I want you to rename the button. Then ship it"), "Rename the button");
  assert.match(timelineText(tl), /\[te1\] Edit NavbarV3\.tsx ×2 \(app\/NavbarV3\.tsx \+4 -3\)/);
});

test("timeline: a change of direction, a menu question and its answer, Esc and the answer that follows", () => {
  assert.equal(messageKind("no, a switch like the one in settings"), "turn");
  assert.equal(messageKind("no"), "answer");
  assert.equal(messageKind("ok, make it teal"), "answer");
  assert.equal(messageKind("About your questions:\n1. Logo: Dark."), "answer");
  assert.equal(messageKind("Also add a monthly toggle"), "new");
  const ask = (id) => ({ role: "tool", tool: "AskUserQuestion", id, input: { questions: [{ question: "Which logo?", header: "Logo", options: [{ label: "Dark" }, { label: "Light", description: "for the footer" }] }] } });
  const tl = buildTimeline([
    { role: "user", text: "Make a logo" }, ask("q1"),
    { role: "tool_result", id: "q1", text: 'User has answered your questions: "Which logo?"="Dark". You can now continue' },
    ask("q2"), { role: "tool_result", id: "q2", error: true, text: "The user doesn't want to proceed with this tool use." },
    { role: "user", text: "About your question:\nLogo: Light." },
    ask("q3"),
  ]);
  const st = tl.sections[0].steps;
  assert.deepEqual(st[0].ask.answers, [{ q: "Which logo?", a: "Dark" }]);
  assert.equal(st[1].ask.cancelled, true);
  assert.equal(st[1].ask.reply, "About your question: Logo: Light.");
  assert.equal(st[3].ask.answered, false);
  assert.deepEqual(st[3].ask.qs[0].options[1], { label: "Light", detail: "for the footer" });
});

test("timeline: a turn that ends on a question gets its own Asks step; mid-turn text isn't final", () => {
  const ev = [{ role: "user", text: "Write the FAQ" }, { role: "tool", tool: "Write", id: "w", input: { file_path: "faq.md", content: "a\nb" } }, { role: "assistant", text: "Done. Remove the Enterprise entries? And push to preview?" }];
  const ended = buildTimeline(ev).sections[0].steps;
  assert.deepEqual(ended.map((s) => s.kind), ["edit", "asktext"]);
  assert.equal(ended[1].label, "Asks 2 questions");
  assert.equal(ended[0].said, "");
  const working = buildTimeline(ev, { working: true }).sections[0].steps;
  assert.deepEqual(working.map((s) => s.kind), ["edit"]);
});

test("AI notes: only grow, only for ids the timeline has; asks stay open until answered", () => {
  const tl = buildTimeline([
    { role: "user", text: "Add a yearly toggle" }, { role: "tool", tool: "Edit", id: "e", input: { file_path: "a.tsx", old_string: "", new_string: "x" } },
    { role: "assistant", text: "I used 20% off for now. Tell me if it should be different." },
    { role: "user", text: "Make the FAQ match" }, { role: "tool", tool: "Read", id: "r", input: { file_path: "faq.md" } },
  ]);
  let n = applyNotes(emptyNotes(), {
    sections: [{ id: "u0", kind: "start" }, { id: "nope", kind: "turn" }],
    steps: [{ id: "te", summary: "Added the switch.", label: "Ignored: not vague" }, { id: "ghost", summary: "x" }],
    dropped: [], asks: [{ op: "add", step: "te", key: "Yearly discount", q: "What yearly discount should it show?", options: [{ label: "20% off" }, { label: "2 months free", recommended: true }] }, { op: "add", step: "ghost", q: "Hallucinated?" }],
  }, tl);
  assert.deepEqual(Object.keys(n.sections), ["u0"]);
  assert.deepEqual(n.steps, { te: { summary: "Added the switch." } });
  assert.equal(n.asks.length, 1);
  assert.equal(n.asks[0].state, "open");
  // A later pass can't rewrite a note, and mid-turn it leaves the asks alone.
  n = applyNotes(n, { steps: [{ id: "te", summary: "Rewritten" }], asks: [{ op: "answer", id: "k1", answer: "x" }] }, tl, { midTurn: true });
  assert.equal(n.steps.te.summary, "Added the switch.");
  assert.equal(n.asks[0].state, "open");
  n = applyNotes(n, { asks: [{ op: "answer", id: "k1", answer: "2 months free" }] }, tl);
  assert.equal(n.asks[0].state, "answered");
  n = applyNotes(n, { asks: [{ op: "moot", id: "k1" }] }, tl);
  assert.equal(n.asks[0].state, "answered");
  assert.equal(n.asks[0].answer, "2 months free");
});

test("AI notes: a question already asked, even answered, is never added again", () => {
  const tl = buildTimeline([{ role: "user", text: "Price it" }, { role: "assistant", text: "Which discount: 20% off or 2 months free?" }]);
  const step = tl.sections[0].steps[0].id;
  let n = applyNotes(emptyNotes(), { asks: [{ op: "add", step, key: "Yearly discount", q: "Which discount should we show?" }] }, tl);
  n = applyNotes(n, { asks: [{ op: "answer", id: "k1", answer: "20% off" }] }, tl);
  n = applyNotes(n, { asks: [{ op: "add", step, key: "yearly discount", q: "What yearly discount should be offered?" }] }, tl);
  assert.equal(n.asks.length, 1);
});
