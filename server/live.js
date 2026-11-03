// Live sessions: real harness CLIs running in pseudo-terminals the app owns.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import pty from "@lydell/node-pty";
import { DATA, PORT, ROOT, STORES, cleanEnv, hookSecret, ID_RE } from "./config.js";
import { resolveBin, launchArgs, HARNESSES } from "./harness.js";
import { readSession } from "./transcripts.js";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const REG = path.join(DATA, "live.json");
const sessions = new Map(); // id -> session
const BUF_MAX = 400_000;

// One settings file adds GenUI's hooks to the sessions it starts (only those sessions).
const SETTINGS = path.join(DATA, "claude-hooks.json");
function writeHookSettings() {
  const cmd = `node "${path.join(ROOT, "server", "hook-client.mjs").replace(/\\/g, "/")}"`;
  const h = (matcher, timeout) => [{ matcher, hooks: [{ type: "command", command: cmd, ...(timeout ? { timeout } : {}) }] }];
  const s = { hooks: {
    SessionStart: h(""), UserPromptSubmit: h(""), Stop: h(""), Notification: h(""),
    PreToolUse: h("AskUserQuestion", 3600), PermissionRequest: h("", 3600), PreCompact: h(""),
  } };
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
}
writeHookSettings();

function persist() {
  const rows = [...sessions.values()].map((s) => ({ id: s.id, harness: s.harness, cwd: s.cwd, name: s.name, file: s.file, createdAt: s.createdAt, origin: s.origin, goalHint: s.goalHint }));
  const old = loadRegistry().filter((r) => !sessions.has(r.id));
  fs.writeFileSync(REG, JSON.stringify([...rows, ...old].slice(0, 200), null, 2));
}
export function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REG, "utf8")); } catch { return []; }
}

const plain = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\x1b[()][0-9A-B]/g, "");

export function list() { return [...sessions.values()].map(summary); }
export function get(id) { return sessions.get(id); }

export function summary(s) {
  const ask = s.asks[0], perm = s.perms[0];
  return {
    id: s.id, harness: s.harness, label: HARNESSES[s.harness].label, cwd: s.cwd, name: s.name, status: s.status,
    file: s.file, createdAt: s.createdAt, alive: s.alive, exitCode: s.exitCode, origin: s.origin, goalHint: s.goalHint, turnError: s.turnError || null,
    pendingAsk: ask ? { id: ask.id, questions: ask.questions } : null,
    pendingPermission: perm ? { id: perm.id, tool: perm.tool, input: perm.input } : null,
    queued: Math.max(0, s.asks.length - 1) + Math.max(0, s.perms.length - 1),
    terminalNeeds: s.terminalNeeds || null, context: s.context || null, lastActivity: s.lastActivity,
  };
}

function changed(s, what = "session") {
  s.lastActivity = Date.now();
  bus.emit("session", summary(s), what);
}

// Start a harness in a terminal. Returns the session.
export function start({ harness, cwd, prompt, name, model, resume, fork, file, origin = "app", goalHint }) {
  if (!HARNESSES[harness]) throw new Error("Unknown harness");
  const bin = resolveBin(HARNESSES[harness].bin);
  if (!bin) throw new Error(`${HARNESSES[harness].label} isn't installed`);
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Folder not found: ${cwd}`);
  if (resume && !ID_RE.test(resume)) throw new Error("Bad session id");
  if (model && !/^[\w.\[\]-]{1,60}$/.test(model)) throw new Error("Bad model name");
  const id = resume && harness === "claude" && !fork ? resume : crypto.randomUUID();
  if (sessions.get(id)?.alive) throw new Error("That session is already running here");
  const args = launchArgs(harness, { id, settingsFile: harness === "claude" ? SETTINGS : null, prompt, resume, fork, name: name ? String(name).replace(/[\r\n]/g, " ").slice(0, 80) : "", model });
  // Only Claude Code sessions get hook variables, and only their own per-session secret.
  const extra = harness === "claude" ? { GENUI_PORT: String(PORT), GENUI_HOOK_TOKEN: hookSecret(id), GENUI_SID: id } : {};
  const p = pty.spawn(bin.file, [...bin.pre, ...args], { name: "xterm-256color", cols: 120, rows: 36, cwd, env: cleanEnv(extra), useConpty: true });
  const s = {
    id, harness, cwd, name: name || "", model, origin, goalHint: goalHint || prompt || "", pty: p, alive: true, exitCode: null,
    status: prompt ? "working" : "starting", buf: "", screen: "", createdAt: Date.now(), startedAt: Date.now(), lastOutput: Date.now(), lastActivity: Date.now(),
    file: null, asks: [], perms: [], terminalNeeds: null, hooked: false, resumeOf: resume || null,
  };
  sessions.set(id, s);
  p.onData((d) => {
    s.buf += d;
    if (s.buf.length > BUF_MAX) s.buf = s.buf.slice(-BUF_MAX);
    s.screen = (s.screen + plain(d)).slice(-6000);
    s.lastOutput = Date.now();
    bus.emit("pty", id, d);
    sniffScreen(s);
  });
  p.onExit(({ exitCode }) => {
    s.alive = false; s.exitCode = exitCode; s.status = "exited";
    for (const a of s.asks) a.respond({}); for (const q of s.perms) q.respond({});
    s.asks = []; s.perms = []; s.terminalNeeds = null;
    clearInterval(s.watcher); clearTimeout(s.quietTimer); clearTimeout(s.intTimer);
    changed(s);
  });
  if (!prompt && harness !== "claude") setTimeout(() => { if (s.status === "starting") { s.status = "idle"; changed(s); } }, 4000);
  // Resuming (not forking) keeps writing to the saved transcript, so bind it directly.
  if (file && resume && !fork) { s.file = file; setTimeout(() => watch(s), 300); }
  else findTranscript(s);
  persist();
  changed(s, "started");
  return s;
}

// Prompts that live only in the terminal (folder trust, yes/no) become a card. Claude Code reports
// everything else through hooks, so its screen is only read until the first hook arrives, and only
// the last few lines count, so an agent printing "(y/n)" in its reply doesn't trigger a card.
function hookCommands(cwd) {
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (typeof v.command === "string") out.push(v.command); Object.values(v).forEach(walk); } };
  try { walk(JSON.parse(fs.readFileSync(path.join(cwd, ".codex", "hooks.json"), "utf8"))); } catch {}
  return [...new Set(out)].join("\n").slice(0, 400);
}

function sniffScreen(s) {
  if (s.harness === "claude" && s.hooked) return;
  clearTimeout(s.sniffTimer);
  s.sniffTimer = setTimeout(() => {
    const tail = s.screen.slice(-700), flat = s.screen.slice(-2500).replace(/\s+/g, " ");
    let needs = null;
    // An API error Codex prints instead of a reply (bad model, quota, sign-in): the turn is over.
    if (s.harness === "codex") {
      const m = /■ \{"type":"error".*?"message":"((?:[^"\\]|\\.)*)"(?:,"code":"([^"]*)")?/.exec(flat.slice(-1500));
      if (m && (!s.turnError || s.turnError.message !== m[1])) { s.turnError = { message: m[1].slice(0, 400), code: m[2] || "" }; if (s.status === "working") s.status = "idle"; changed(s, "turn-end"); }
    }
    // Codex asks before running a project's own hooks (.codex/hooks.json): first as a menu, then per hook.
    // Show the commands it would run, read from the project, since the menu doesn't list them.
    const hooksMenu = /Hooks need review.*Continue without trusting.*Press enter to confirm or esc to go back\s*$/.test(flat);
    if (s.harness === "codex" && (hooksMenu || /Press t to trust; esc to go back\s*$/.test(flat))) {
      needs = { kind: "hooks", menu: hooksMenu, text: "This project has hooks (.codex/hooks.json) that Codex runs around its tools. Trust them, or carry on without them.", detail: hookCommands(s.cwd) };
    }
    else if (/trust this folder|Do you trust the (files|contents)|Is this a project you created or one you trust/i.test(tail)) needs = { kind: "trust", text: "The harness wants to know if you trust this folder before it starts." };
    else if (s.harness !== "claude" && /(Allow Codex to|approve this command|Would you like to run the following command)/i.test(tail.slice(-400))) needs = { kind: "approve", text: "The agent is asking for approval in its terminal." };
    else if (/(\(y\/n\)|\[y\/N\]|\[Y\/n\])\s*$/.test(tail.trimEnd())) needs = { kind: "yesno", text: "The terminal is waiting for a yes or no." };
    if (JSON.stringify(needs) !== JSON.stringify(s.terminalNeeds)) { s.terminalNeeds = needs; if (needs) s.status = "needs"; changed(s); }
  }, 250);
}

// Where each harness writes this session's transcript. Files another live session already uses are skipped.
function findTranscript(s) {
  const claimed = () => new Set([...sessions.values()].filter((o) => o !== s && o.file).map((o) => o.file));
  const tryFind = () => {
    if (s.file) return;
    let f = null;
    if (s.harness === "claude") {
      const enc = s.cwd.replace(/[^A-Za-z0-9]/g, "-");
      const direct = path.join(STORES.claude, enc, `${s.id}.jsonl`);
      if (fs.existsSync(direct)) f = direct;
    } else if (s.harness === "codex") {
      f = newestMatching(STORES.codex, 4, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), s.startedAt, claimed(), (file) => {
        // The first line (session_meta) can be huge (it embeds instructions), so read the cwd field from its start.
        try {
          const fd = fs.openSync(file, "r"), buf = Buffer.alloc(8192); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
          const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString("utf8", 0, n));
          return !!m && path.resolve(JSON.parse(`"${m[1]}"`)) === path.resolve(s.cwd);
        } catch { return false; }
      });
    } else {
      f = newestMatching(path.join(STORES.grok, encodeURIComponent(s.cwd)), 1, (n) => n === "chat_history.jsonl", s.startedAt, claimed(), () => true);
    }
    if (f) { s.file = f; persist(); watch(s); changed(s); return; }
    if (s.alive && Date.now() - s.startedAt < 10 * 60 * 1000) setTimeout(tryFind, 1500);
  };
  setTimeout(tryFind, 800);
}

function newestMatching(dir, depth, nameOk, sinceMs, claimed, extraOk) {
  let best = null;
  const walk = (d, left) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) walk(p, left - 1);
      else if (e.isFile() && nameOk(e.name) && !claimed.has(p)) {
        const st = fs.statSync(p);
        // Created after this session started (birth time), so an older session's file never matches.
        const born = st.birthtimeMs || st.ctimeMs;
        if (born >= sinceMs - 1500 && (!best || born > best.m) && extraOk(p)) best = { p, m: born };
      }
    }
  };
  walk(dir, depth);
  return best && best.p;
}

function watch(s) {
  clearInterval(s.watcher);
  let lastSize = -1;
  const tick = () => {
    try {
      const st = fs.statSync(s.file);
      if (st.size !== lastSize) {
        const grew = lastSize >= 0;
        lastSize = st.size;
        const parsed = readSession(s.harness, s.file);
        s.context = parsed.context;
        bus.emit("transcript", s.id, parsed);
        // Codex writes explicit turn markers; Grok has none, so a long silence ends its turn.
        if (s.harness === "codex" && s.alive && parsed.turn) {
          if (parsed.turn === "running" && s.status !== "working") { s.status = "working"; s.terminalNeeds = null; s.turnError = null; changed(s); }
          if (parsed.turn === "done" && (s.status === "working" || s.status === "starting") && grew) { s.status = "idle"; s.turnError = parsed.turnError; changed(s, "turn-end"); }
        } else if (s.harness === "grok" && grew && s.alive) {
          if (s.status !== "working") { s.status = "working"; s.terminalNeeds = null; changed(s); }
          clearTimeout(s.quietTimer);
          s.quietTimer = setTimeout(() => { if (s.alive && s.status === "working") { s.status = "idle"; changed(s, "turn-end"); } }, 20000);
        }
      }
    } catch {}
  };
  tick();
  s.watcher = setInterval(tick, 1200);
}

// ---- Input -----------------------------------------------------------------
export function write(id, data) {
  const s = sessions.get(id); if (!s?.alive) return;
  s.pty.write(data);
  // Answering in the terminal itself: the "waiting in the terminal" card has done its job.
  if (s.terminalNeeds && s.terminalNeeds.kind === "menu" && /[\r\n]/.test(data)) { s.terminalNeeds = null; s.status = "working"; changed(s); }
}
export function resize(id, cols, rows) { const s = sessions.get(id); if (s?.alive && cols > 0 && rows > 0) try { s.pty.resize(Math.max(20, Math.min(cols, 500)), Math.max(5, Math.min(rows, 300))); } catch {} }

// Send a message as if typed: paste it as one block, then press Enter. Control characters are
// stripped so pasted text can't end the paste early and inject keystrokes.
export function send(id, text) {
  const s = sessions.get(id);
  if (!s?.alive) throw new Error("This session isn't running");
  const body = String(text).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  if (!body.trim()) throw new Error("Nothing to send");
  s.pty.write(`\x1b[200~${body}\x1b[201~`);
  setTimeout(() => s.pty.write("\r"), 120);
  s.status = "working"; s.terminalNeeds = null; changed(s);
}

// Interrupt (Esc for Claude Code, Ctrl+C in the terminal). Claude Code runs no Stop hook when
// interrupted, so a quiet terminal shortly after counts as the turn ending.
export function interrupt(id, key) {
  const s = sessions.get(id);
  if (!s?.alive) return;
  s.pty.write(key);
  const at = Date.now();
  clearTimeout(s.intTimer);
  const check = () => {
    if (!s.alive || s.status !== "working") return;
    if (Date.now() - s.lastOutput > 1500) { s.status = "idle"; changed(s, "turn-end"); }
    else if (Date.now() - at < 15000) s.intTimer = setTimeout(check, 700);
  };
  s.intTimer = setTimeout(check, 1600);
}

export function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.pty.kill(); } catch {}
  clearInterval(s.watcher);
}
export function stopAll() { for (const id of sessions.keys()) stop(id); }

// ---- Hooks from Claude Code ------------------------------------------------------
// Called with each hook event. Returns the question id when the hook waits for an answer.
export function onHook(id, ev, respond, wantsAnswer) {
  const s = sessions.get(id);
  if (!s) { respond({}); return null; }
  const name = ev.hook_event_name;
  s.hooked = true;
  if (ev.transcript_path && !s.file && fs.existsSync(path.dirname(ev.transcript_path))) { s.file = ev.transcript_path; persist(); watch(s); }
  if (name === "SessionStart") { if (s.status === "starting") s.status = "idle"; s.terminalNeeds = null; }
  if (name === "UserPromptSubmit") { s.status = "working"; s.terminalNeeds = null; }
  if (name === "Stop") { s.status = "idle"; s.terminalNeeds = null; changed(s, "turn-end"); respond({}); return null; }
  if (name === "Notification") {
    const t = ev.notification_type || ev.message || "";
    if (/permission/i.test(t) && !s.perms.length) { s.status = "needs"; s.terminalNeeds = { kind: "menu", text: "Claude Code is asking for permission in its terminal." }; }
    else if (/idle_prompt/i.test(t) && s.status === "working") { s.status = "idle"; changed(s, "turn-end"); respond({}); return null; }
  }
  if (name === "PreToolUse" && ev.tool_name === "AskUserQuestion" && wantsAnswer) {
    const qid = crypto.randomUUID();
    s.asks.push({ id: qid, questions: (ev.tool_input && ev.tool_input.questions) || [], input: ev.tool_input, respond });
    s.status = "needs";
    changed(s, "ask");
    return qid;
  }
  if (name === "PermissionRequest" && wantsAnswer) {
    const qid = crypto.randomUUID();
    s.perms.push({ id: qid, tool: ev.tool_name, input: ev.tool_input, respond });
    s.status = "needs";
    changed(s, "permission");
    return qid;
  }
  if (name === "PreToolUse" || name === "UserPromptSubmit") { if (s.status !== "working") s.status = "working"; }
  changed(s);
  respond({});
  return null;
}

// The waiting hook went away (timed out, or Esc in the terminal): drop its card; the terminal has the prompt now.
export function hookGone(id, qid) {
  const s = sessions.get(id); if (!s) return;
  const before = s.asks.length + s.perms.length;
  s.asks = s.asks.filter((a) => a.id !== qid); s.perms = s.perms.filter((p) => p.id !== qid);
  if (s.asks.length + s.perms.length === before) return;
  if (s.alive) { s.status = "needs"; s.terminalNeeds = { kind: "menu", text: "The question moved to the terminal." }; }
  changed(s);
}

function toTerminal(s, text) { s.status = "needs"; s.terminalNeeds = { kind: "menu", text }; }

// Answer a multiple-choice question: Claude Code receives the answers as if picked in its menu.
export function answerAsk(id, qid, answers) {
  const s = sessions.get(id);
  const i = s ? s.asks.findIndex((a) => a.id === qid) : -1;
  if (i < 0) throw new Error("That question is no longer open");
  const [pa] = s.asks.splice(i, 1);
  if (answers === null) { pa.respond({}); toTerminal(s, "Answer the question in the terminal."); }
  else { pa.respond({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...pa.input, answers } } }); s.status = s.asks.length || s.perms.length ? "needs" : "working"; }
  changed(s);
}

export function answerPermission(id, qid, allow, message) {
  const s = sessions.get(id);
  const i = s ? s.perms.findIndex((p) => p.id === qid) : -1;
  if (i < 0) throw new Error("That request is no longer open");
  const [pp] = s.perms.splice(i, 1);
  if (allow === null) { pp.respond({}); toTerminal(s, "Decide in the terminal."); }
  else { pp.respond({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: allow ? { behavior: "allow" } : { behavior: "deny", message: message || "The user declined this in GenUI Agent." } } }); s.status = s.asks.length || s.perms.length ? "needs" : "working"; }
  changed(s);
}

// Folder-trust and similar terminal prompts: the safe default needs a keypress the user chooses.
export function answerTerminal(id, choice) {
  const s = sessions.get(id);
  if (!s?.alive || !s.terminalNeeds) return;
  const k = s.terminalNeeds.kind;
  if (k === "trust") s.pty.write(choice === "yes" ? (s.harness === "claude" ? "\x1b[B\r" : "\r") : "\x1b");
  else if (k === "yesno") s.pty.write(choice === "yes" ? "y\r" : "n\r");
  else if (k === "approve") s.pty.write(choice === "yes" ? "\r" : "\x1b");
  // Codex's hooks menu: 1 review, 2 trust all and continue, 3 continue without them. Its detail screen takes t or esc.
  else if (k === "hooks") s.pty.write(s.terminalNeeds.menu ? (choice === "yes" ? "\x1b[B\r" : "\x1b[B\x1b[B\r") : choice === "yes" ? "t" : "\x1b");
  s.terminalNeeds = null; s.status = "working"; s.screen = ""; changed(s);
}
