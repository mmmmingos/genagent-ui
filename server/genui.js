// Generative UI: read a session and decide what to show — its goal, its flow, and a card for
// each thing the agent is waiting on the user for. The model picks components from a fixed kit.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, MODELS } from "./config.js";
import { readSession, digest } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";

const CACHE = path.join(DATA, "gen");
fs.mkdirSync(CACHE, { recursive: true });

export const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "What this session is, 2-6 words, sentence case, no trailing period" },
    goal: { type: "string", description: "The overall goal in one or two plain sentences, as the agent is pursuing it now" },
    status: { type: "string", enum: ["working", "waiting", "done", "idle", "blocked"], description: "waiting = the agent's last turn ends asking the user something" },
    now: { type: "string", description: "One short line: what is happening right now or what the agent is waiting for" },
    steps: {
      type: "array", description: "The session's flow: 3-8 steps from start to the goal, in order",
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
- Steps describe the real flow of this session (what was done, what is happening, what remains), 3-8 steps, short sentence-case labels. Exactly one step is "current" unless everything is done.
- Cards are ONLY for things the agent's latest turn is waiting on the user for. Split a message that asks several questions into one card each. Use the agent's own options when it offers them; mark the one it recommends. Never invent questions. If the agent is still working or finished without asking, return no cards.
- If an open multiple-choice question block is included, do NOT make cards for it (the app shows it separately).
- Write plainly: no jargon the user didn't use, no emojis, no marketing tone.`;

const running = new Map();

function cacheKey(file, size, extra = "") {
  return crypto.createHash("sha1").update(`${file}|${size}|${extra}|v3`).digest("hex");
}

export function cached(file) {
  try {
    const st = fs.statSync(file);
    const p = path.join(CACHE, cacheKey(file, st.size) + ".json");
    if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, "utf8")), fresh: true };
    // Fall back to the latest generation for this file, even if the transcript has grown since.
    const latest = path.join(CACHE, crypto.createHash("sha1").update(file).digest("hex") + ".latest.json");
    if (fs.existsSync(latest)) return { ...JSON.parse(fs.readFileSync(latest, "utf8")), fresh: false };
  } catch {}
  return null;
}

export async function generate(harness, file) {
  const st = fs.statSync(file);
  const key = cacheKey(file, st.size);
  const p = path.join(CACHE, key + ".json");
  if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, "utf8")), fresh: true };
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const parsed = readSession(harness, file);
    const text = digest(parsed);
    const r = await claudeCall({ model: MODELS.generate, lean: true, schema: SCHEMA, system: SYSTEM, stdin: text,
      prompt: "The session transcript digest is on stdin. Produce the UI data.", timeoutMs: 180000 });
    if (!r.data) throw new Error("The generator returned no data");
    const out = { ...r.data, at: Date.now(), cost: r.cost, size: st.size };
    fs.writeFileSync(p, JSON.stringify(out));
    fs.writeFileSync(path.join(CACHE, crypto.createHash("sha1").update(file).digest("hex") + ".latest.json"), JSON.stringify(out));
    return { ...out, fresh: true };
  })();
  running.set(key, job);
  try { return await job; } finally { running.delete(key); }
}
