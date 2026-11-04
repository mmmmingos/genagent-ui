// Generative UI: read a session and decide what to show: its flowchart, what is happening now, and
// a card for each thing the agent is waiting on the user for. The model picks components from a
// fixed kit. The flowchart (flowtree.js) only grows: each update reads what is new in the
// conversation and returns operations on the tree, so nothing settled is ever rewritten.
// When the agent keeps its own task list (Codex's plan, Claude's TodoWrite) the app shows that too.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, MODELS } from "./config.js";
import { readSession, digest } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";
import { emptyTree, applyOps, stepsFromTree, treeText, currentGoal } from "./flowtree.js";

const CACHE = path.join(DATA, "gen");
fs.mkdirSync(CACHE, { recursive: true });

export const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "What this session is about overall, 2-6 words, sentence case, no trailing period" },
    goal: { type: "string", description: "What the user wants right now, in one or two plain sentences" },
    status: { type: "string", enum: ["working", "waiting", "done", "idle", "blocked"], description: "waiting = the agent's last turn ends asking the user something" },
    now: { type: "string", description: "One short line: what is happening right now or what the agent is waiting for" },
    ops: {
      type: "array", description: "Changes to the flowchart, applied in order. Empty if nothing changed.",
      items: { type: "object", properties: {
        op: { type: "string", enum: ["add", "state", "rename"] },
        id: { type: "string", description: "state/rename: the existing node's id, or the ref of a node added earlier in this list" },
        ref: { type: "string", description: "add: a short handle for the new node so later ops can point at it, e.g. 'a'" },
        parent: { type: "string", description: "add: the id or ref of the goal (or step) it belongs under; empty for a new top-level goal" },
        kind: { type: "string", enum: ["goal", "step"] },
        label: { type: "string", description: "add/rename: 2-6 words, sentence case" },
        state: { type: "string", enum: ["done", "current", "next", "dropped"] },
        note: { type: "string", description: "Optional short meta, e.g. '14 files' or 'PR #12'" },
      }, required: ["op"] },
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
  required: ["title", "goal", "status", "now", "ops", "cards"],
};

const SYSTEM = `You keep a live flowchart of a conversation between a user and a coding or operations agent (Claude Code, Codex or Grok), and produce the data for a calm, compact UI about it.
The flowchart is a tree. Goal nodes are what the user asked for. Step nodes under a goal are the units of work toward it, ones a user would recognise ("Map the nav entries", "Write the pricing section"); never a single command, wait, check or reply on its own, and when the work is a list of separate items, one step per item.
It only grows. You see the tree so far and what is new in the conversation, and you return operations:
- add: a new goal or step. The conversation's first goal is the trunk. Every user message that asks for new or different work starts a new goal, branching off the goal it grew out of (the trunk, when unsure); a message that only answers the agent, approves, or says go ahead continues the current goal. Steps go under their goal, in order: the agent's work for that request.
- state: mark a step done when the transcript shows it finished; current for the one the agent is on (exactly one, or the last one when it waits on the user); dropped when the user changed course and it will not happen.
- rename: only for a step not started yet, when the work showed a clearer name.
Never touch done or dropped nodes. Keep labels short and plain. If nothing changed, return no ops.
Cards are ONLY for things the agent's latest turn is waiting on the user for: one card per question, the agent's own options when it gives them, its recommendation marked. Never invent questions. If the agent is still working or finished without asking, return no cards. If an open multiple-choice question block is included, make no cards for it (the app shows it separately).
Write plainly: no jargon the user didn't use, no emojis, no marketing tone.`;

const running = new Map();
const latestPath = (file) => path.join(CACHE, crypto.createHash("sha1").update(file).digest("hex") + ".latest.json");
function cacheKey(file, size, extra = "") { return crypto.createHash("sha1").update(`${file}|${size}|${extra}|v5`).digest("hex"); }

export function cached(file) {
  try {
    const st = fs.statSync(file);
    const p = path.join(CACHE, cacheKey(file, st.size) + ".json");
    if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, "utf8")), fresh: true };
    // Fall back to the latest generation for this file, even if the transcript has grown since.
    const latest = JSON.parse(fs.readFileSync(latestPath(file), "utf8"));
    if (latest.tree) return { ...latest, fresh: false };
  } catch {}
  return null;
}

// Only what happened since the tree was last updated, newest kept when it is long.
function eventsText(events, maxChars = 30000) {
  const rows = events.map((e) => e.role === "user" ? `USER: ${clip(e.text, 2500)}` : e.role === "assistant" ? `AGENT: ${clip(e.text, 3000)}`
    : e.role === "tool" ? `  [tool ${e.tool}] ${clip(typeof e.input === "string" ? e.input : JSON.stringify(e.input || ""), 220)}`
    : e.role === "tool_result" ? `  [result] ${clip(e.text, 160)}` : e.role === "error" ? `  [error] ${clip(e.text, 300)}` : "").filter(Boolean);
  let body = "";
  for (let i = rows.length - 1; i >= 0; i--) { if (body.length + rows[i].length > maxChars) { body = `[… ${i + 1} earlier events omitted …]\n` + body; break; } body = rows[i] + "\n" + body; }
  return body;
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

// midTurn: the agent is still working, so only the flowchart and now-line are updated (no cards).
// force: rebuild the flowchart from the whole conversation.
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
    const ev = parsed.events;
    let tree = !force && prev && prev.tree ? prev.tree : emptyTree();
    // A transcript that got shorter (compacted, rewritten) is read again from the start.
    if (tree.cursor > ev.length) tree = emptyTree();
    const fresh = !tree.nodes.length;
    const planBlock = parsed.plan ? `[THE AGENT'S OWN TASK LIST, shown by the app as is; use it for steps and "now"]\n${parsed.plan.map((s) => `- [${s.state}] ${s.label}`).join("\n")}\n\n` : "";
    const ask = (midTurn ? "The agent is in the MIDDLE of a turn and still working: status must be \"working\" and cards must be empty. " : "") +
      (fresh ? "The flowchart is empty: build it from the whole conversation with add ops (refs link children to parents)." : "Update the flowchart with what is new.");
    const text = fresh
      ? planBlock + digest(parsed)
      : `[FLOWCHART SO FAR]\n${treeText(tree)}\n\n[THE CONVERSATION'S FIRST MESSAGE]\n${clip((ev.find((e) => e.role === "user") || {}).text || "", 1500)}\n\n${planBlock}[NEW SINCE THE LAST UPDATE, oldest to newest]\n${eventsText(ev.slice(Math.max(0, tree.cursor - 2))) || "(nothing new)"}` +
        (parsed.pendingAsk ? `\n\n[OPEN MULTIPLE-CHOICE QUESTION FROM THE AGENT]\n${JSON.stringify(parsed.pendingAsk.input)}` : "");
    const r = await claudeCall({ lane: "gen", model: MODELS.generate, lean: true, schema: SCHEMA, system: SYSTEM, stdin: text, prompt: ask, timeoutMs: 180000 });
    if (!r.data) throw new Error("The generator returned no data");
    const data = { ...r.data };
    if (midTurn) { data.cards = []; data.status = "working"; }
    const userTurns = ev.filter((e) => e.role === "user").length;
    tree = { ...applyOps(tree, data.ops || [], userTurns), cursor: ev.length };
    const g = currentGoal(tree);
    const out = { title: data.title, goal: data.goal || (g && g.label) || "", status: data.status, now: data.now, cards: data.cards || [],
      tree, steps: stepsFromTree(tree), source: parsed.plan ? "agent" : "generated", midTurn, at: Date.now(), cost: r.cost, size: st.size };
    fs.writeFileSync(p, JSON.stringify(out));
    fs.writeFileSync(latestPath(file), JSON.stringify(out));
    return { ...out, fresh: true };
  })();
  running.set(key, job);
  try { return await job; } finally { running.delete(key); }
}
