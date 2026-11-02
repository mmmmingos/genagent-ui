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
  assert.equal(ago(Date.now() - 5000), "just now");
});
