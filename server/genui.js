// The AI layer of the timeline. Code builds the timeline itself (timeline.js: your messages, the
// agent's steps, what each touched); a model reads what is new and adds what code can't know:
// - a one-line summary of each step, and a clearer label where code only had "Says: …";
// - whether each message of yours changed direction, and which work that set aside (dropped, with why);
// - the asks: every question the agent put to you, kept over the whole session until you answer it
//   properly. An answer that skipped it leaves it open, so it stays on "Needs from you".
// It only grows: notes and settled asks are never rewritten. Answers you send from GenAgent UI are recorded
// at once (answers.json), so an ask clears without waiting for the model.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, MODELS } from "./config.js";
import { readSession } from "./transcripts.js";
import { claudeCall } from "./claude-call.js";
import { buildTimeline, timelineText } from "./timeline.js";

const CACHE = path.join(DATA, "gen");
fs.mkdirSync(CACHE, { recursive: true });

export const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "What this session is about overall, 2-6 words, sentence case, no trailing period" },
    goal: { type: "string", description: "What the user wants right now, in one or two plain sentences" },
    status: { type: "string", enum: ["working", "waiting", "done", "idle", "blocked"], description: "waiting = the agent's last turn ends asking the user something" },
    now: { type: "string", description: "One short line: what is happening now, or what the agent is waiting for, or what comes next" },
    did: { type: "string", description: "One line, past tense: what the agent did in its latest stretch of work, concrete (files, counts, results). No 'I'." },
    sections: { type: "array", description: "One entry per NEW user message section [u…] in the new part", items: { type: "object", properties: {
      id: { type: "string" }, kind: { type: "string", enum: ["start", "new", "turn"], description: "start: the first message. new: asks for more or different work that builds on what was done. turn: changes direction, so work in progress is set aside or redone differently" },
    }, required: ["id", "kind"] } },
    steps: { type: "array", description: "Notes for steps [t…], [q…], [a…] in the new part that have no summary yet (no '=' line)", items: { type: "object", properties: {
      id: { type: "string" },
      summary: { type: "string", description: "One plain sentence: what happened in this step and what came of it. Concrete, under 25 words" },
      label: { type: "string", description: "Only when the label is vague ('Says: …', 'Use …', 'Asks …'): 2-6 words for what happened, e.g. 'Found the cause'. Omit otherwise" },
    }, required: ["id", "summary"] } },
    dropped: { type: "array", description: "Steps whose work the user set aside by changing direction", items: { type: "object", properties: {
      id: { type: "string" }, why: { type: "string", description: "One sentence, to the user: what he asked for instead, and what happened to this work" },
    }, required: ["id", "why"] } },
    asks: { type: "array", description: "Changes to the list of things the agent asked the user", items: { type: "object", properties: {
      op: { type: "string", enum: ["add", "answer", "moot"] },
      id: { type: "string", description: "answer/moot: the ask's id (k…)" },
      step: { type: "string", description: "add: the id of the step whose AGENT text asked it" },
      key: { type: "string", description: "add: 2-4 words naming the decision, e.g. 'Yearly discount'" },
      q: { type: "string", description: "add: the question, short, ending with ?" },
      ctx: { type: "string", description: "add: one line: what the agent did meanwhile, or why it matters" },
      options: { type: "array", description: "add: the choices the question names or the agent offered ('20% off, or 2 months free?' has two), each short. Empty only for an open question", items: { type: "object", properties: {
        label: { type: "string", description: "Short, as the user would say it" }, detail: { type: "string", description: "A few words, optional" }, recommended: { type: "boolean" },
      }, required: ["label"] } },
      answer: { type: "string", description: "answer: what the user decided, in a few words" },
    }, required: ["op"] } },
  },
  required: ["title", "goal", "status", "now", "did", "sections", "steps", "dropped", "asks"],
};

const SYSTEM = `You annotate the timeline of a conversation between a user and a coding or operations agent (Claude Code, Codex or Grok). Code has already built the timeline: [u…] sections are the user's messages, and the indented lines under them are the agent's steps with ids, what they touched, and the agent's own words (AGENT:). You add what code can't know. You see the asks so far, the timeline before (short) and the new part (full).
- sections: for each new [u…] section, its kind. "turn" only when the user changes direction, so that work in progress is set aside or redone another way ("no, a switch like the one in settings"); a message that adds to or builds on the work is "new".
- steps: a one-sentence summary for each step in the new part that has no "=" summary line yet: what happened and what came of it, concrete. A clearer label only when the label is vague.
- dropped: when a "turn" sets work aside, the steps of that work, each with one sentence to the user on why.
- asks: the user returns after hours and needs every question the agent put to him that is still open. Add an ask for each question or decision the agent asked the user in its AGENT text in the new part (not questions it answered itself, not rhetorical ones). Several questions in one message are separate asks. When a question names its choices, give them as options, so the user can answer with one click.Questions asked in a menu ("asked in a menu") are tracked by the app: don't add them. For each open ask, judge whether a LATER user message answered it: explicitly, or clearly by what he said. If he moved on without addressing it, or answered only part, it stays open: do not answer it for him, and do not mark it moot because he moved on. Mark it moot only when the work it was about was dropped or the agent says it no longer needs it.
Never repeat or change notes that already exist, and never add an ask that is already listed, open or settled. Write plainly, to the user as "you": no jargon he didn't use, no emojis, no marketing tone.`;

const running = new Map();
const hashOf = (file) => crypto.createHash("sha1").update(file).digest("hex");
const latestPath = (file) => path.join(CACHE, hashOf(file) + ".latest.json");
const answersPath = (file) => path.join(CACHE, hashOf(file) + ".answers.json");
const sizedPath = (file, size) => path.join(CACHE, crypto.createHash("sha1").update(`${file}|${size}|v6`).digest("hex") + ".json");
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

export function emptyNotes() { return { sections: {}, steps: {}, dropped: {}, asks: [], seq: 0, cursor: 0 }; }

// Answers sent from GenAgent UI, by ask id: they settle an ask at once, before the model has read the reply.
function sentAnswers(file) { return readJson(answersPath(file)) || {}; }
export function recordAnswers(file, answers) {
  const all = sentAnswers(file);
  for (const a of answers || []) if (a && /^[\w-]{1,40}$/.test(String(a.id || ""))) all[a.id] = { answer: clip(a.answer, 300), at: Date.now() };
  fs.writeFileSync(answersPath(file), JSON.stringify(all));
  return all;
}
function withAnswers(out, file) {
  const sent = sentAnswers(file);
  return { ...out, sent, asks: (out.asks || []).map((a) => (a.state === "open" && sent[a.id] ? { ...a, state: "answered", answer: sent[a.id].answer, by: "you", answeredAt: sent[a.id].at } : a)) };
}

// Apply the model's notes to what is there. Returns new notes; the input is not changed. Existing
// notes and settled asks are never rewritten, and every id must be one the timeline has.
export function applyNotes(prev, data, tl, { midTurn = false } = {}) {
  const n = { sections: { ...prev.sections }, steps: { ...prev.steps }, dropped: { ...prev.dropped }, asks: prev.asks.map((a) => ({ ...a })), seq: prev.seq || 0, cursor: prev.cursor || 0 };
  const secIds = new Set(tl.sections.map((s) => s.id)), steps = new Map(tl.sections.flatMap((s) => s.steps.map((x) => [x.id, x])));
  for (const s of data.sections || []) if (secIds.has(s.id) && !n.sections[s.id] && ["start", "new", "turn"].includes(s.kind)) n.sections[s.id] = { kind: s.kind };
  for (const s of data.steps || []) {
    if (!steps.has(s.id) || n.steps[s.id] || !String(s.summary || "").trim()) continue;
    const vague = /^(Says|Use|Asks|Search the code)\b/.test(steps.get(s.id).label);
    n.steps[s.id] = { summary: clip(s.summary, 220), ...(vague && s.label ? { label: clip(s.label, 60) } : {}) };
  }
  for (const d of data.dropped || []) if (steps.has(d.id) && !n.dropped[d.id] && steps.get(d.id).kind !== "you") n.dropped[d.id] = { why: clip(d.why, 220) };
  if (!midTurn) {
    const byId = new Map(n.asks.map((a) => [a.id, a]));
    for (const o of data.asks || []) {
      if (o.op === "add") {
        const q = clip(o.q, 200); if (!q || n.asks.length >= 80) continue;
        const step = steps.has(o.step) ? o.step : null; if (!step) continue;
        // The same question again (asked before, open or settled) is never a new ask.
        const key = clip(o.key || q, 40).toLowerCase();
        if (n.asks.some((a) => a.q.toLowerCase() === q.toLowerCase() || (a.step === step && a.key.toLowerCase() === key))) continue;
        const a = { id: "k" + ++n.seq, step, key: clip(o.key || q, 40), q, ctx: clip(o.ctx, 200), options: (o.options || []).slice(0, 6).map((x) => ({ label: clip(x.label, 80), detail: clip(x.detail, 80), recommended: !!x.recommended })).filter((x) => x.label), state: "open", at: Date.now() };
        n.asks.push(a); byId.set(a.id, a);
      } else if (o.op === "answer" || o.op === "moot") {
        const a = byId.get(o.id); if (!a || a.state !== "open") continue;
        a.state = o.op === "answer" ? "answered" : "moot"; a.answer = clip(o.answer, 200); a.by = "agent-read"; a.answeredAt = Date.now();
      }
    }
  }
  return n;
}

export function cached(file) {
  try {
    const st = fs.statSync(file);
    const sized = readJson(sizedPath(file, st.size));
    if (sized) return withAnswers({ ...sized, fresh: true }, file);
    // Fall back to the latest notes for this file, even if the transcript has grown since.
    const latest = readJson(latestPath(file));
    if (latest && latest.notes) return withAnswers({ ...latest, fresh: false }, file);
  } catch {}
  return null;
}

// The part of the timeline that is text for the model: earlier steps short, new ones in full, the
// newest kept when it is long.
function chunkText(tl, notes, from, maxChars = 36000) {
  const full = timelineText(tl, from).split("\n").map((l) => {
    const m = /^\s+\[([\w-]+)\]/.exec(l); const s = m && notes.steps[m[1]];
    return s ? `${l}\n    = ${s.summary}` : l;
  });
  let body = "";
  for (let i = full.length - 1; i >= 0; i--) { if (body.length + full[i].length > maxChars) { body = "[… earlier part omitted …]\n" + body; break; } body = full[i] + "\n" + body; }
  return body;
}
function beforeText(tl, from) {
  const rows = [];
  for (const s of tl.sections) {
    if (s.ev >= from) break;
    rows.push(`[${s.id}] USER: ${clip(s.text, 160)}`);
    for (const x of s.steps.filter((x) => (x.end ?? x.ev) < from).slice(-6)) rows.push(`  [${x.id}] ${x.label}`);
  }
  return rows.slice(-60).join("\n");
}

// midTurn: the agent is still working: notes only, asks wait for the turn to end (its last message
// isn't final yet), and the cursor stays put so the turn-end update reads the whole turn.
// force: build the notes again from the whole conversation.
export async function generate(harness, file, { force = false, midTurn = false } = {}) {
  const st = fs.statSync(file);
  const p = sizedPath(file, st.size);
  if (!force && !midTurn && fs.existsSync(p)) return withAnswers({ ...readJson(p), fresh: true }, file);
  const key = `${file}|${st.size}|${midTurn}|${force}`;
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const parsed = readSession(harness, file);
    const ev = parsed.events;
    const tl = buildTimeline(ev, { cwd: parsed.cwd, working: midTurn });
    const prev = readJson(latestPath(file));
    let notes = !force && prev && prev.notes ? prev.notes : emptyNotes();
    // A transcript that got shorter (compacted, rewritten) is read again from the start.
    if (notes.cursor > ev.length) notes = emptyNotes();
    // Answers you sent from GenAgent UI settle their asks before the model reads on.
    const sent = sentAnswers(file);
    notes.asks = notes.asks.map((a) => (a.state === "open" && sent[a.id] ? { ...a, state: "answered", answer: sent[a.id].answer, by: "you" } : a));
    const from = notes.cursor, open = notes.asks.filter((a) => a.state === "open");
    const planBlock = parsed.plan ? `[THE AGENT'S OWN TASK LIST]\n${parsed.plan.map((s) => `- [${s.state}] ${s.label}`).join("\n")}\n\n` : "";
    const settled = notes.asks.filter((a) => a.state !== "open").slice(-30);
    const text = `[OPEN ASKS SO FAR]\n${open.map((a) => `- ${a.id} (asked at step ${a.step}): ${a.q}`).join("\n") || "(none)"}\n\n` +
      (settled.length ? `[ASKS ALREADY SETTLED: never add these again]\n${settled.map((a) => `- ${a.q} → ${a.state === "moot" ? "no longer needed" : a.answer}`).join("\n")}\n\n` : "") +
      (from ? `[TIMELINE BEFORE, short]\n${beforeText(tl, from) || "(nothing)"}\n\n` : "") +
      `${planBlock}[NEW PART OF THE TIMELINE, oldest to newest]\n${chunkText(tl, notes, from) || "(nothing new)"}` +
      (parsed.pendingAsk ? `\n\n[A MENU QUESTION IS OPEN RIGHT NOW] (tracked by the app; don't add it)` : "");
    const ask = midTurn ? "The agent is in the MIDDLE of a turn, still working: status must be \"working\", return no asks." : from ? "Annotate the new part." : "Annotate the whole timeline.";
    const r = await claudeCall({ lane: "gen", model: MODELS.generate, lean: true, schema: SCHEMA, system: SYSTEM, stdin: text, prompt: ask, timeoutMs: 180000 });
    if (!r.data) throw new Error("The generator returned no data");
    const data = r.data;
    notes = applyNotes(notes, data, tl, { midTurn });
    if (!midTurn) notes.cursor = ev.length;
    const out = { userTurns: ev.filter((e) => e.role === "user").length, title: clip(data.title, 60), goal: data.goal || "", status: midTurn ? "working" : data.status,
      now: clip(data.now, 160), did: clip(data.did, 200), notes, asks: notes.asks, midTurn, at: Date.now(), cost: r.cost, size: st.size };
    if (!midTurn) fs.writeFileSync(p, JSON.stringify(out));
    fs.writeFileSync(latestPath(file), JSON.stringify(out));
    return withAnswers({ ...out, fresh: true }, file);
  })();
  running.set(key, job);
  try { return await job; } finally { running.delete(key); }
}
