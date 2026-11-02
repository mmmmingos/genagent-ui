// Side discussions: talk a question through with an agent that has read the whole session,
// then send one composed answer back. For Claude Code sessions the side agent is a real fork
// (claude --resume <id> --fork-session), so it starts with the full context and the original is untouched.
// For Codex and Grok sessions it is a Claude Code session that reads that transcript.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, MODELS } from "./config.js";
import { readSession, digest } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";

const DIR = path.join(DATA, "side");
fs.mkdirSync(DIR, { recursive: true });
const sides = new Map();

const READ_ONLY_TOOLS = "Read,Grep,Glob,WebSearch,WebFetch";
const RULES = `You are in a SIDE DISCUSSION opened from GenUI Agent. The user wants to think something through with you before answering the main agent. Your job is to advise, not act:
- Do not edit files, run commands or take actions. You may read files and search to check facts.
- Keep replies short and conversational: a few sentences, plain language, concrete.
- Help the user reach a clear decision. Point out trade-offs and what the main agent will need to know.
- Nothing you say reaches the main agent until the user presses Compose and Send.`;

function save(s) { fs.writeFileSync(path.join(DIR, s.id + ".json"), JSON.stringify({ ...s, busy: undefined })); }
export function get(id) {
  if (sides.has(id)) return sides.get(id);
  try { const s = JSON.parse(fs.readFileSync(path.join(DIR, id + ".json"), "utf8")); sides.set(id, s); return s; } catch { return null; }
}

// Open a side discussion about a session (and optionally one card on it).
export async function open({ harness, file, mainId, cwd, topic }) {
  const id = crypto.randomUUID();
  const s = { id, harness, file, mainId, cwd, topic: topic || "", msgs: [], forkId: null, contextTokens: 0, cost: 0, composed: "", createdAt: Date.now() };
  sides.set(id, s);
  const opener = `${RULES}\n\nThe user opened this side discussion${topic ? ` about: "${topic}"` : ""}.\nStart by summarising, in 2-4 sentences, what the main agent needs from the user here and the key consideration, then ask what is on their mind.`;
  let r;
  if (harness === "claude" && mainId) {
    r = await claudeCall({ model: MODELS.side, resume: mainId, fork: true, tools: READ_ONLY_TOOLS, cwd: cwd || DATA, prompt: opener, timeoutMs: 300000 });
  } else {
    const parsed = readSession(harness, file);
    const ctx = `The main session is a ${harness} session in ${parsed.cwd || cwd || "an unknown folder"}. Its full transcript is at ${file} (you may Read it). Digest:\n\n${digest(parsed, 40000)}`;
    r = await claudeCall({ model: MODELS.side, tools: READ_ONLY_TOOLS, cwd: parsed.cwd && fs.existsSync(parsed.cwd) ? parsed.cwd : DATA, addDirs: [path.dirname(file)], prompt: `${opener}\n\n${ctx}`, timeoutMs: 300000 });
  }
  s.forkId = r.sessionId; s.contextTokens = r.contextTokens; s.cost += r.cost;
  s.msgs.push({ who: "ai", text: r.result });
  save(s);
  return s;
}

export async function message(id, text) {
  const s = get(id);
  if (!s) throw new Error("Side discussion not found");
  s.msgs.push({ who: "me", text });
  const r = await claudeCall({ model: MODELS.side, resume: s.forkId, tools: READ_ONLY_TOOLS, cwd: s.cwd && fs.existsSync(s.cwd) ? s.cwd : DATA, prompt: text, timeoutMs: 300000 });
  s.forkId = r.sessionId || s.forkId; s.contextTokens = r.contextTokens; s.cost += r.cost;
  s.msgs.push({ who: "ai", text: r.result });
  save(s);
  return s;
}

// Write the single answer that goes back to the main agent.
export async function compose(id) {
  const s = get(id);
  if (!s) throw new Error("Side discussion not found");
  const r = await claudeCall({ model: MODELS.side, resume: s.forkId, tools: READ_ONLY_TOOLS, cwd: s.cwd && fs.existsSync(s.cwd) ? s.cwd : DATA, timeoutMs: 300000,
    prompt: `Now write the message the user will send back to the main agent, based on this side discussion. Write it as the user, addressed to the main agent. Lead with the decision or answer, then the reasons that matter, then any constraints it should carry forward, then anything still undecided. Be complete but tight: the main agent has NOT seen this discussion. Output only the message text, no preamble.` });
  s.forkId = r.sessionId || s.forkId; s.contextTokens = r.contextTokens; s.cost += r.cost;
  s.composed = String(r.result || "").trim();
  save(s);
  return s;
}

export function markSent(id, text) {
  const s = get(id);
  if (s) { s.sentText = text; s.sentAt = Date.now(); save(s); }
  return s;
}
