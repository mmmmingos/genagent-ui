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

// ---- Growing flow and the agent's own task list ----
import { emptyTree, applyOps, stepsFromTree, currentLeaf, currentGoal, treeText } from "../server/flowtree.js";

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

test("flowchart: built with refs, one current step, goals on its path are current", () => {
  const t = applyOps(emptyTree(), [
    { op: "add", ref: "g", kind: "goal", label: "Audit the signup fork", state: "current" },
    { op: "add", parent: "g", kind: "step", label: "Read fork code", state: "done" },
    { op: "add", parent: "g", kind: "step", label: "Check routing", state: "current" },
    { op: "add", parent: "g", kind: "step", label: "Visual pass", state: "next" },
  ]);
  assert.equal(currentLeaf(t).label, "Check routing");
  assert.equal(currentGoal(t).label, "Audit the signup fork");
  assert.deepEqual(stepsFromTree(t).map((s) => s.state), ["done", "current", "next"]);
});

test("flowchart: done and dropped nodes are never rewritten; a pivot is a new branch", () => {
  let t = applyOps(emptyTree(), [
    { op: "add", ref: "g", kind: "goal", label: "Audit the signup fork", state: "current" },
    { op: "add", parent: "g", label: "Read fork code", state: "done" },
    { op: "add", parent: "g", label: "Visual pass", state: "current" },
  ]);
  const read = t.nodes.find((n) => n.label === "Read fork code"), visual = t.nodes.find((n) => n.label === "Visual pass");
  // The user changes course: the visual pass is dropped and a new goal branches off.
  t = applyOps(t, [
    { op: "rename", id: read.id, label: "Skimmed the code" },       // done: refused
    { op: "state", id: read.id, state: "next" },                    // done: refused
    { op: "state", id: visual.id, state: "dropped" },
    { op: "add", ref: "g2", parent: t.nodes[0].id, kind: "goal", label: "Fix Trustpilot link", state: "current" },
    { op: "add", parent: "g2", label: "Find the link source", state: "current" },
  ]);
  assert.equal(t.nodes.find((n) => n.id === read.id).label, "Read fork code");
  assert.equal(t.nodes.find((n) => n.id === read.id).state, "done");
  assert.equal(t.nodes.find((n) => n.id === visual.id).state, "dropped");
  t = applyOps(t, [{ op: "state", id: visual.id, state: "current" }]); // dropped: refused
  assert.equal(t.nodes.find((n) => n.id === visual.id).state, "dropped");
  assert.equal(currentGoal(t).label, "Fix Trustpilot link");
  assert.equal(t.nodes.filter((n) => n.state === "current" && n.kind === "step").length, 1);
  assert.match(treeText(t), /- n1 \[goal, current\] Audit the signup fork\n  - n2 \[step, done\] Read fork code/);
});

test("flowchart: moving on closes the old current step; renames only before a step starts", () => {
  let t = applyOps(emptyTree(), [
    { op: "add", ref: "g", kind: "goal", label: "Build the page", state: "current" },
    { op: "add", parent: "g", label: "Write the hero", state: "current" },
    { op: "add", parent: "g", label: "Pricing bit", state: "next" },
  ]);
  const pricing = t.nodes.find((n) => n.label === "Pricing bit");
  t = applyOps(t, [{ op: "rename", id: pricing.id, label: "Write the pricing section" }, { op: "state", id: pricing.id, state: "current" }]);
  assert.equal(t.nodes.find((n) => n.label === "Write the hero").state, "done");
  assert.equal(currentLeaf(t).label, "Write the pricing section");
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

test("flowchart: a goal whose branches are all finished is done; later goals branch off the trunk", () => {
  const t = applyOps(emptyTree(), [
    { op: "add", ref: "g", kind: "goal", label: "Rebrand the navbar", state: "done" },
    { op: "add", parent: "g", label: "Link navbar", state: "done" },
    { op: "add", ref: "g2", kind: "goal", label: "Port the latest dev", state: "done" },
    { op: "add", parent: "g2", label: "Update the icon", state: "done" },
  ]);
  const [trunk, , branch] = t.nodes;
  assert.equal(branch.parent, trunk.id);
  assert.equal(trunk.state, "done");
});
