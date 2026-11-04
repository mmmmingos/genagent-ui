// Side discussions: talk a question through with an agent that has read the whole session,
// then send one composed answer back. For Claude Code sessions the side agent is a real fork
// (claude --resume <id> --fork-session), so it starts with the full context and the original is untouched.
// For Codex and Grok sessions it is a Claude Code session that reads that transcript.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { DATA, MODELS } from "./config.js";
import { readSession, digest } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";

export const bus = new EventEmitter();
const DIR = path.join(DATA, "side");
fs.mkdirSync(DIR, { recursive: true });
const sides = new Map();
const children = new Map(); // side id -> running claude process

const READ_ONLY_TOOLS = "Read,Grep,Glob,WebSearch,WebFetch";
const RULES = `You are in a SIDE DISCUSSION opened from GenUI Agent. The user wants to think something through with you before answering the main agent. Your job is to advise, not act:
- Do not edit files, run commands or take actions. You may read files and search to check facts.
- Keep replies short and conversational: a few sentences, plain language, concrete.
- Help the user reach a clear decision. Point out trade-offs and what the main agent will need to know. When it is a question the main agent asked with options, end with a clear recommendation among them.
- Nothing you say reaches the main agent until the user presses "Answer with this" and sends the answer.`;

const pub = (s) => ({ ...s, busy: !!s.busy });
function save(s) { const { ...rest } = s; fs.writeFileSync(path.join(DIR, s.id + ".json"), JSON.stringify(rest)); bus.emit("side", pub(s)); }
export function get(id) {
  if (sides.has(id)) return pub(sides.get(id));
  try { const s = JSON.parse(fs.readFileSync(path.join(DIR, id + ".json"), "utf8")); s.busy = false; sides.set(id, s); return pub(s); } catch { return null; }
}
const raw = (id) => (get(id) ? sides.get(id) : null);

// Fork sessions are bookkeeping, not work: the sidebar hides them.
let forkCache = { at: 0, ids: new Set() };
export function forkIds() {
  if (Date.now() - forkCache.at < 10000) return forkCache.ids;
  const ids = new Set();
  try { for (const f of fs.readdirSync(DIR)) { try { const s = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); (s.forkIds || [s.forkId]).forEach((x) => x && ids.add(x)); } catch {} } } catch {}
  forkCache = { at: Date.now(), ids };
  return ids;
}

const opts = (s, extra) => ({ model: MODELS.side, tools: READ_ONLY_TOOLS, userSettingsOnly: true, cwd: s.cwd && fs.existsSync(s.cwd) ? s.cwd : DATA, timeoutMs: 300000, onChild: (c) => children.set(s.id, c), isCancelled: () => !!s.cancelled, ...extra });
function track(s, r) { s.forkId = r.sessionId || s.forkId; s.forkIds = [...new Set([...(s.forkIds || []), s.forkId])]; s.contextTokens = r.contextTokens; s.cost += r.cost; forkCache.at = 0; }

// Open a side discussion. Returns at once; the opener arrives later through the bus.
export function open({ harness, file, mainId, cwd, topic, first }) {
  // A Codex or Grok side chat reads that session's transcript, so it must exist first.
  if (!(harness === "claude" && mainId) && !(file && fs.existsSync(file))) throw new Error("This session has no transcript yet. Try again after its first turn.");
  const id = crypto.randomUUID();
  const s = { id, harness, file, mainId, cwd, topic: topic || "", msgs: [], forkId: null, forkIds: [], contextTokens: 0, cost: 0, composed: "", createdAt: Date.now(), busy: true, err: "" };
  sides.set(id, s);
  // With a first message the side agent answers it straight away; without one it opens with a short summary.
  const opener = first
    ? `${RULES}\n\nThe user opened this side discussion${topic ? ` about the main agent's question: "${topic}"` : ""}.\nTheir first message: ${first}`
    : `${RULES}\n\nThe user opened this side discussion${topic ? ` about: "${topic}"` : ""}.\nStart by summarising, in 2-4 sentences, what the main agent needs from the user here and the key consideration, then ask what is on their mind.`;
  if (first) s.msgs.push({ who: "me", text: String(first) });
  (async () => {
    try {
      let r;
      if (harness === "claude" && mainId) r = await claudeCall(opts(s, { resume: mainId, fork: true, prompt: opener }));
      else {
        const parsed = readSession(harness, file);
        const ctx = `The main session is a ${harness} session in ${parsed.cwd || cwd || "an unknown folder"}. Its full transcript is at ${file} (you may Read it). Digest:\n\n${digest(parsed, 40000)}`;
        r = await claudeCall(opts(s, { addDirs: [path.dirname(file)], prompt: `${opener}\n\n${ctx}` }));
      }
      track(s, r);
      s.msgs.push({ who: "ai", text: r.result });
    } catch (e) { s.err = e.message === "Cancelled" ? "" : e.message; }
    s.busy = false; children.delete(id); save(s);
  })();
  save(s);
  return pub(s);
}

export async function message(id, text) {
  const s = raw(id);
  if (!s) throw new Error("Side discussion not found");
  if (s.busy) throw new Error("Still thinking about the last message");
  s.busy = true; s.err = "";
  s.msgs.push({ who: "me", text });
  try {
    const r = await claudeCall(opts(s, { resume: s.forkId, prompt: text }));
    track(s, r);
    s.msgs.push({ who: "ai", text: r.result });
  } catch (e) { s.msgs.pop(); s.err = e.message; throw e; }
  finally { s.busy = false; children.delete(id); save(s); }
  return pub(s);
}

// Write the single answer that goes back to the main agent. With options (a question from "Needs from
// you"), it is one line that goes into the user's reply next to his other answers.
export async function compose(id, known = [], answerOnly = false, options = null) {
  const s = raw(id);
  if (!s) throw new Error("Side discussion not found");
  if (s.busy) throw new Error("Still thinking");
  s.busy = true;
  const settled = known.length ? ` The user has already decided these, so treat them as settled and don't ask for them again: ${known.map((k) => `"${String(k.title).slice(0, 200)}" = "${String(k.answer).slice(0, 300)}"`).join("; ")}.` : "";
  const oneLine = `Now write the user's answer to the question, based on this side discussion. It goes into his reply to the main agent as one item of a list, so write one line, as the user: the decision, plus a short reason only when the main agent needs it.${options && options.length ? ` If one of these options is the decision, start with its exact label: ${options.map((o) => `"${String(o).slice(0, 120)}"`).join(", ")}.` : ""}${settled} Output only that line.`;
  try {
    const r = await claudeCall(opts(s, { resume: s.forkId,
      prompt: Array.isArray(options) ? oneLine : `Now write the message the user will send back to the main agent, based on this side discussion. Write it as the user, addressed to the main agent. Lead with the decision or answer, then the reasons that matter, then any constraints it should carry forward, then anything still undecided. Be complete but tight: the main agent has NOT seen this discussion.${answerOnly ? " This is the answer to a question the main agent asked: answer that question and give the reasons, nothing more. Don't add new instructions, extra work or next steps it didn't ask about." : ""}${settled} Output only the message text, no preamble.` }));
    track(s, r);
    s.composed = String(r.result || "").trim();
  } finally { s.busy = false; children.delete(id); save(s); }
  return pub(s);
}

export function cancel(id) {
  const s = sides.get(id); if (s) s.cancelled = true;
  const c = children.get(id);
  if (c) { c.cancelled = true; try { c.kill(); } catch {} children.delete(id); }
}

export function markSent(id, text) {
  const s = raw(id);
  if (s) { s.sentText = text; s.sentAt = Date.now(); save(s); }
  return s ? pub(s) : null;
}
