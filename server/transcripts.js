// Read the three harnesses' saved sessions into one shape.
// Each harness keeps its own on-disk format; everything here is read-only.
import fs from "node:fs";
import path from "node:path";
import { STORES } from "./config.js";

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const isNoise = (t) => !t || /^\s*<[a-z_-]+>/i.test(t) || /^\s*<(system-reminder|user_info|environment_context|permissions|skills_instructions|collaboration_mode|local-command|command-|user_instructions)/i.test(t) || /^Caveat: The messages below/i.test(t) || /^# AGENTS\.md instructions for /.test(t) || /^\[Request interrupted by user/.test(t);

function readLines(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a line still being written */ }
  }
  return out;
}

// Read only the start and end of a big file: enough for a title, cwd and last activity.
function headTail(file, head = 24000, tail = 48000) {
  try {
    const fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const hb = Buffer.alloc(Math.min(head, size));
    fs.readSync(fd, hb, 0, hb.length, 0);
    let tb = Buffer.alloc(0);
    if (size > head) { tb = Buffer.alloc(Math.min(tail, size - head)); fs.readSync(fd, tb, 0, tb.length, size - tb.length); }
    fs.closeSync(fd);
    const parse = (s) => s.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return { head: parse(hb.toString("utf8")), tail: parse(tb.toString("utf8")), size };
  } catch { return { head: [], tail: [], size: 0 }; }
}

// The agent's own task list (Codex update_plan, Claude TodoWrite or TaskCreate/TaskUpdate) as flow steps.
const PLAN_STATE = { completed: "done", done: "done", in_progress: "current", inprogress: "current", active: "current", pending: "next", todo: "next" };
export function toPlan(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const steps = items.map((x) => ({ label: String(x.step || x.content || x.subject || x.title || "").trim(), state: PLAN_STATE[String(x.status || "").toLowerCase()] || "next" })).filter((x) => x.label);
  return steps.length ? steps : null;
}

// ---- Claude Code --------------------------------------------------------------
function claudeText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

export function parseClaude(lines) {
  const events = [];
  let cwd = "", title = "", usage = null, model = "", customTitle = "", plan = null;
  const tasks = [];
  const answered = new Set();
  for (const l of lines) {
    if (l.type === "custom-title" && l.customTitle) customTitle = l.customTitle;
    if (l.type === "summary" && l.summary && !title) title = l.summary;
    if (l.isSidechain) continue;
    if (l.cwd && !cwd) cwd = l.cwd;
    // A message typed while the agent was working is folded into its turn as a queued command: it is still the user speaking.
    if (l.type === "attachment" && l.attachment && l.attachment.type === "queued_command" && (l.attachment.origin || {}).kind === "human" && l.attachment.prompt) {
      events.push({ role: "user", text: String(l.attachment.prompt), t: l.timestamp, queued: true });
      continue;
    }
    const c = l.message && l.message.content;
    if (l.type === "user" && !l.isMeta) {
      if (Array.isArray(c) && c.some((b) => b.type === "tool_result")) {
        c.filter((b) => b.type === "tool_result").forEach((b) => answered.add(b.tool_use_id));
        events.push({ role: "tool_result", text: clip(typeof c[0].content === "string" ? c[0].content : claudeText(c[0].content), 400), t: l.timestamp });
        continue;
      }
      // Long pastes are recorded wrapped in <pasted_content>; show what was actually typed.
      const text = claudeText(c).replace(/<pasted_content[^>]*>\s*([\s\S]*?)\s*<\/pasted_content>/g, "$1");
      if (isNoise(text)) continue;
      events.push({ role: "user", text, t: l.timestamp });
    }
    if (l.type === "assistant" && Array.isArray(c)) {
      if (l.message.model) model = l.message.model;
      if (l.message.usage) usage = l.message.usage;
      for (const b of c) {
        if (b.type === "text" && b.text.trim()) events.push({ role: "assistant", text: b.text, t: l.timestamp });
        if (b.type === "tool_use") {
          events.push({ role: "tool", tool: b.name, input: b.input, id: b.id, t: l.timestamp });
          if (b.name === "TodoWrite" && b.input) plan = toPlan(b.input.todos) || plan;
          // Newer Claude Code keeps its list with TaskCreate / TaskUpdate (ids count up from 1).
          if (b.name === "TaskCreate" && b.input) { tasks.push({ subject: b.input.subject || b.input.description || "", status: "pending" }); plan = toPlan(tasks); }
          if (b.name === "TaskUpdate" && b.input) { const k = tasks[Number(b.input.taskId) - 1]; if (k) { if (b.input.status) k.status = b.input.status; if (b.input.subject) k.subject = b.input.subject; } plan = toPlan(tasks.filter((x) => x.status !== "deleted")); }
        }
      }
    }
  }
  // An AskUserQuestion with no result yet is a question waiting on the user.
  const pendingAsk = [...events].reverse().find((e) => e.role === "tool" && e.tool === "AskUserQuestion" && !answered.has(e.id)) || null;
  const firstUser = events.find((e) => e.role === "user");
  let context = null;
  if (usage) {
    const used = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    const window = /\[1m\]/.test(model) || used > 200000 ? 1000000 : 200000;
    context = { used, window, pct: Math.min(100, Math.round((used / window) * 100)) };
  }
  return { events, cwd, model, context, pendingAsk, plan, title: customTitle || title || clip(firstUser ? firstUser.text.replace(/\s+/g, " ") : "", 80) };
}

// ---- Codex --------------------------------------------------------------------
// Codex wraps the API's error JSON in a string; dig out the human message and its code.
function codexError(err) {
  let message = String((err && err.message) || err || "Codex couldn't run this turn"), code = "";
  try { const j = JSON.parse(message); const e = j.error || j; message = e.message || message; code = e.code || e.type || ""; } catch {}
  return { message: clip(message, 400), code };
}
export function parseCodex(lines) {
  const events = [];
  let cwd = "", id = "", context = null, model = "", turn = null, plan = null, turnError = null;
  for (const l of lines) {
    const p = l.payload || {};
    // Codex marks each turn's start and end explicitly; that beats guessing from silence.
    if (l.type === "event_msg" && p.type === "task_started") { turn = "running"; turnError = null; }
    if (l.type === "event_msg" && (p.type === "task_complete" || p.type === "turn_aborted")) turn = "done";
    // A turn that failed (bad model, auth, quota) ends with an error and no reply: show it, never a silent "done".
    if (l.type === "event_msg" && p.type === "task_complete" && p.error) {
      turnError = codexError(p.error);
      events.push({ role: "error", text: turnError.message, code: turnError.code, t: l.timestamp });
    }
    if (l.type === "session_meta") { cwd = p.cwd || cwd; id = p.id || p.session_id || id; }
    if (l.type === "turn_context" && p.cwd) cwd = cwd || p.cwd;
    if (l.type === "event_msg" && p.type === "task_started" && p.model_context_window) context = { window: p.model_context_window, used: 0, pct: 0 };
    if (l.type === "event_msg" && p.type === "token_count" && p.info) {
      const used = (p.info.last_token_usage && p.info.last_token_usage.input_tokens) || (p.info.total_token_usage && p.info.total_token_usage.input_tokens) || 0;
      const window = p.info.model_context_window || (context && context.window) || 258400;
      context = { used, window, pct: Math.min(100, Math.round((used / window) * 100)) };
    }
    if (l.type === "response_item") {
      if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
        const text = (p.content || []).map((b) => b.text || "").join("\n");
        if (p.role === "user" && isNoise(text)) continue;
        if (text.trim()) events.push({ role: p.role, text, t: l.timestamp });
      }
      if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
        let input = p.arguments || p.input || p.action;
        try { if (typeof input === "string") input = JSON.parse(input); } catch {}
        events.push({ role: "tool", tool: p.name || p.type, input, t: l.timestamp });
        if (p.name === "update_plan" && input && typeof input === "object") plan = toPlan(input.plan) || plan;
      }
      if (p.type === "function_call_output") events.push({ role: "tool_result", text: clip(typeof p.output === "string" ? p.output : JSON.stringify(p.output), 400), t: l.timestamp });
    }
    if (l.type === "turn_context" && p.model) model = p.model;
  }
  const firstUser = events.find((e) => e.role === "user");
  return { events, cwd, id, model, context, turn, turnError, plan, pendingAsk: null, title: clip(firstUser ? firstUser.text.replace(/\s+/g, " ") : "", 80) };
}

// ---- Grok ---------------------------------------------------------------------
export function parseGrok(lines, dir) {
  const events = [];
  for (const l of lines) {
    if (l.type === "user" && !l.synthetic_reason) {
      const raw = Array.isArray(l.content) ? l.content.map((b) => b.text || "").join("\n") : String(l.content || "");
      const text = raw.replace(/^\s*<user_query>\s*|\s*<\/user_query>\s*$/g, "");
      if (isNoise(text)) continue;
      events.push({ role: "user", text, t: null });
    }
    if (l.type === "assistant") {
      let text = typeof l.content === "string" ? l.content : Array.isArray(l.content) ? l.content.map((b) => b.text || "").join("\n") : "";
      try { const j = JSON.parse(text); if (j && typeof j.answer === "string") text = j.answer; } catch {}
      if (text.trim()) events.push({ role: "assistant", text, t: null });
      (l.tool_calls || []).forEach((tc) => events.push({ role: "tool", tool: (tc.function && tc.function.name) || tc.name || "tool", input: tc.function && tc.function.arguments, t: null }));
    }
    if (l.type === "backend_tool_call" && l.kind) events.push({ role: "tool", tool: l.kind.tool_type || "tool", input: l.kind.action, t: null });
    if (l.type === "tool" || l.type === "tool_result") events.push({ role: "tool_result", text: clip(JSON.stringify(l.content || ""), 300), t: null });
  }
  let title = "", cwd = "";
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")); title = s.title || s.summary || ""; cwd = s.cwd || s.workspace || ""; } catch {}
  if (!cwd) cwd = decodeURIComponent(path.basename(path.dirname(dir)));
  const firstUser = events.find((e) => e.role === "user");
  return { events, cwd, model: "grok", context: null, pendingAsk: null, title: title || clip(firstUser ? firstUser.text.replace(/\s+/g, " ") : "", 80) };
}

// ---- One entry point per session file -------------------------------------------
export function readSession(harness, file) {
  const lines = readLines(file);
  if (harness === "claude") return parseClaude(lines);
  if (harness === "codex") return parseCodex(lines);
  return parseGrok(lines, path.dirname(file));
}

// ---- Listing saved sessions (cheap: head and tail of each file) -----------------------
function walk(dir, match, depth = 4, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0 && e.name !== "subagents") walk(p, match, depth - 1, out);
    else if (e.isFile() && match(e.name, p)) out.push(p);
  }
  return out;
}

export function listSaved({ limit = 400 } = {}) {
  const items = [];
  const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };
  for (const f of walk(STORES.claude, (n) => n.endsWith(".jsonl"), 1)) {
    const s = stat(f); if (!s || s.size < 600) continue;
    items.push({ harness: "claude", id: path.basename(f, ".jsonl"), file: f, mtime: s.mtimeMs, size: s.size });
  }
  for (const f of walk(STORES.codex, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), 4)) {
    const s = stat(f); if (!s || s.size < 600) continue;
    const m = path.basename(f).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    items.push({ harness: "codex", id: m ? m[1] : path.basename(f), file: f, mtime: s.mtimeMs, size: s.size });
  }
  for (const f of walk(STORES.grok, (n) => n === "chat_history.jsonl", 2)) {
    const s = stat(f); if (!s || s.size < 600) continue;
    items.push({ harness: "grok", id: path.basename(path.dirname(f)), file: f, mtime: s.mtimeMs, size: s.size });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  const top = items.slice(0, limit);
  for (const it of top) Object.assign(it, quickMeta(it));
  return top.filter((it) => it.title);
}

function quickMeta(it) {
  const { head, tail } = headTail(it.file);
  const lines = [...head, ...tail];
  const parsed = it.harness === "claude" ? parseClaude(lines) : it.harness === "codex" ? parseCodex(lines) : parseGrok(lines, path.dirname(it.file));
  const lastA = [...parsed.events].reverse().find((e) => e.role === "assistant");
  const firstU = parseFirstUser(head, it.harness);
  return {
    cwd: parsed.cwd,
    title: (it.harness === "claude" && parsed.title) || firstU || parsed.title,
    last: lastA ? clip(lastA.text.replace(/\s+/g, " "), 160) : "",
    context: parsed.context,
    waiting: !!parsed.pendingAsk,
  };
}

function parseFirstUser(head, harness) {
  const parsed = harness === "claude" ? parseClaude(head) : harness === "codex" ? parseCodex(head) : parseGrok(head, "");
  const u = parsed.events.find((e) => e.role === "user");
  return u ? clip(u.text.replace(/\s+/g, " "), 80) : "";
}

// A compact text digest for the model that writes the goal, flow and cards.
export function digest(parsed, maxChars = 48000) {
  const lines = [];
  const ev = parsed.events;
  const first = ev.find((e) => e.role === "user");
  if (first) lines.push(`[FIRST USER MESSAGE]\n${clip(first.text, 4000)}`);
  const rest = [];
  for (const e of ev) {
    if (e.role === "user") rest.push(`USER: ${clip(e.text, 2500)}`);
    else if (e.role === "assistant") rest.push(`AGENT: ${clip(e.text, 3000)}`);
    else if (e.role === "tool") rest.push(`  [tool ${e.tool}] ${clip(typeof e.input === "string" ? e.input : JSON.stringify(e.input || ""), 220)}`);
    else if (e.role === "tool_result") rest.push(`  [result] ${clip(e.text, 160)}`);
  }
  // Keep the newest material; the first message already anchors the goal.
  let body = "";
  for (let i = rest.length - 1; i >= 0; i--) {
    if (body.length + rest[i].length > maxChars) { body = `[… ${i + 1} earlier events omitted …]\n` + body; break; }
    body = rest[i] + "\n" + body;
  }
  lines.push(`[SESSION, oldest to newest]\n${body}`);
  if (parsed.pendingAsk) lines.push(`[OPEN MULTIPLE-CHOICE QUESTION FROM THE AGENT]\n${JSON.stringify(parsed.pendingAsk.input)}`);
  return lines.join("\n\n");
}
