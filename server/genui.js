// Generative UI: read a session and decide what to show — its goal, its flow, and a card for
// each thing the agent is waiting on the user for. The model picks components from a fixed kit.
// The flow grows with the work: finished steps are kept as they were and new steps are appended.
// When the agent keeps its own task list (Codex's plan, Claude's TodoWrite), that list is the flow.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, MODELS } from "./config.js";
import { readSession, digest } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";

const CACHE = path.join(DATA, "gen");
fs.mkdirSync(CACHE, { recursive: true });
export const MAX_STEPS = 30;

export const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "What this session is, 2-6 words, sentence case, no trailing period" },
    goal: { type: "string", description: "The overall goal in one or two plain sentences, as the agent is pursuing it now" },
    status: { type: "string", enum: ["working", "waiting", "done", "idle", "blocked"], description: "waiting = the agent's last turn ends asking the user something" },
    now: { type: "string", description: "One short line: what is happening right now or what the agent is waiting for" },
    steps: {
      type: "array", description: `The session's flow, in order, from the start to the goal: every step done so far, the current one, and the ones still to come. Up to ${MAX_STEPS} steps.`,
      items: { type: "object", properties: {
        label: { type: "string", description: "2-6 words, sentence case" },
        state: { type: "string", enum: ["done", "current", "next"] },
        note: { type: "string", description: "Optional short meta, e.g. '14 files' or 'PR #12'. Empty if none" },
      }, required: ["label", "state"] },
    },
    cards: {
      type: "array", description: "One card per open question or decision the agent is waiting on the user for in its LATEST turn. Empty if it isn't waiting.",
      items: { type: "object", properties: {
        kind: { type: "string", enum: ["choice", "approve", "input", "teammate", "checklist", "info"],
          description: "choice: pick among options the agent offered. approve: yes/no on a concrete thing (a plan, a draft, running something). input: the agent needs a fact or text from the user. teammate: only another named person can answer. checklist: several things the user must do or confirm. info: something the user should know, no answer needed" },
        title: { type: "string", description: "The question, short, ends with ? when it is a question" },
        why: { type: "string", description: "One line on why the agent needs it / what it unblocks" },
        options: { type: "array", items: { type: "object", properties: {
          label: { type: "string" }, detail: { type: "string", description: "Trade-off in one short line" }, recommended: { type: "boolean" },
        }, required: ["label"] } },
        multi: { type: "boolean", description: "choice only: more than one option may be picked" },
        draft: { type: "string", description: "approve/input: the concrete text or plan being approved, or a suggested answer" },
        owner: { type: "string", description: "teammate only: who can answer" },
        items: { type: "array", items: { type: "string" }, description: "checklist only" },
      }, required: ["kind", "title"] },
    },
  },
  required: ["title", "goal", "status", "now", "steps", "cards"],
};

const SYSTEM = `You read a coding or operations agent's session transcript (Claude Code, Codex or Grok) and produce the data for a calm, compact UI about it.
Rules:
- The goal is the agent's overall objective as it stands now, not just the first message.
- Steps are the session's flow and it GROWS with the work. If a previous flow is given: copy every step it marks "done" exactly as written, in the same order, at the start of your list; never reword, merge or drop them. Then give the current step and the steps still to come, adding new ones as the work reveals them. Mark a step done only when the transcript shows it finished. Exactly one step is "current" unless everything is done. At most ${MAX_STEPS} steps; short sentence-case labels. A step is a unit of work the user would recognise ("Create step-3.txt", "Write the pricing section"), never a single command, wait, check or reply on its own; fold those into the step they serve. When the work is a list of separate items, keep one step per item rather than bundling them.
- Cards are ONLY for things the agent's latest turn is waiting on the user for. Split a message that asks several questions into one card each. Use the agent's own options when it offers them; mark the one it recommends. Never invent questions. If the agent is still working or finished without asking, return no cards.
- If an open multiple-choice question block is included, do NOT make cards for it (the app shows it separately).
- Write plainly: no jargon the user didn't use, no emojis, no marketing tone.`;

const running = new Map();
const nkey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const latestPath = (file) => path.join(CACHE, crypto.createHash("sha1").update(file).digest("hex") + ".latest.json");

function cacheKey(file, size, extra = "") {
  return crypto.createHash("sha1").update(`${file}|${size}|${extra}|v4`).digest("hex");
}

// Two labels name the same step if one contains the other or they share most of their words
// (the generator sometimes adds a detail like '(contains "1")' to a finished step).
export function sameStep(a, b) {
  const x = nkey(a), y = nkey(b);
  if (!x || !y) return false;
  // Numbers name different items ("Step 3" vs "Step 4", "#12" vs "#13"): if they differ, so do the steps.
  const nums = (t) => [...new Set(t.match(/\d+/g) || [])].sort().join(",");
  if (nums(x) !== nums(y)) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(A.size, B.size) >= 0.75;
}

// Finished steps never move or disappear: re-anchor any the model dropped or reworded, then cap.
export function mergeSteps(prev = [], next = []) {
  const done = prev.filter((s) => s.state === "done");
  const rest = next.filter((s) => !done.some((d) => sameStep(d.label, s.label)));
  let steps = [...done.map((s) => ({ ...s, state: "done" })), ...rest];
  if (!steps.some((s) => s.state === "current") && steps.some((s) => s.state === "next")) steps = steps.map((s, i, a) => (i === a.findIndex((x) => x.state === "next") ? { ...s, state: "current" } : s));
  return steps.slice(-MAX_STEPS);
}

// The agent's own task list, when it keeps one, is exact and needs no model call.
export function planSteps(plan) {
  return (plan || []).slice(0, MAX_STEPS).map((p) => ({ label: p.label, state: p.state, note: "" }));
}

export function cached(file) {
  try {
    const st = fs.statSync(file);
    const p = path.join(CACHE, cacheKey(file, st.size) + ".json");
    if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, "utf8")), fresh: true };
    // Fall back to the latest generation for this file, even if the transcript has grown since.
    if (fs.existsSync(latestPath(file))) return { ...JSON.parse(fs.readFileSync(latestPath(file), "utf8")), fresh: false };
  } catch {}
  return null;
}

// midTurn: the agent is still working, so only the goal and flow are updated (no cards).
export async function generate(harness, file, { force = false, midTurn = false } = {}) {
  const st = fs.statSync(file);
  const key = cacheKey(file, st.size);
  const p = path.join(CACHE, key + ".json");
  if (!force && fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, "utf8")), fresh: true };
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const parsed = readSession(harness, file);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(latestPath(file), "utf8")); } catch {}
    const prevBlock = prev && prev.steps && prev.steps.length && !parsed.plan
      ? `[PREVIOUS FLOW — keep its done steps exactly]\n${prev.steps.map((s, i) => `${i + 1}. [${s.state}] ${s.label}${s.note ? ` (${s.note})` : ""}`).join("\n")}\n\n` : "";
    const planBlock = parsed.plan ? `[THE AGENT'S OWN TASK LIST — the app shows it as the flow; use it for "now"]\n${parsed.plan.map((s) => `- [${s.state}] ${s.label}`).join("\n")}\n\n` : "";
    const text = prevBlock + planBlock + digest(parsed);
    const ask = midTurn
      ? "The session transcript digest is on stdin. The agent is in the MIDDLE of a turn and still working: status must be \"working\" and cards must be empty. Update the goal, flow and now-line."
      : "The session transcript digest is on stdin. Produce the UI data.";
    const r = await claudeCall({ lane: "gen", model: MODELS.generate, lean: true, schema: SCHEMA, system: SYSTEM, stdin: text, prompt: ask, timeoutMs: 180000 });
    if (!r.data) throw new Error("The generator returned no data");
    const data = { ...r.data };
    if (midTurn) { data.cards = []; data.status = "working"; }
    data.steps = parsed.plan ? planSteps(parsed.plan) : mergeSteps(prev ? prev.steps : [], data.steps || []);
    const out = { ...data, source: parsed.plan ? "agent" : "generated", midTurn, at: Date.now(), cost: r.cost, size: st.size };
    fs.writeFileSync(p, JSON.stringify(out));
    fs.writeFileSync(latestPath(file), JSON.stringify(out));
    return { ...out, fresh: true };
  })();
  running.set(key, job);
  try { return await job; } finally { running.delete(key); }
}
