// Live sessions: real harness CLIs running in pseudo-terminals the app owns.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import pty from "@lydell/node-pty";
import { DATA, PORT, TOKEN, ROOT, STORES, cleanEnv } from "./config.js";
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

export function list() {
  return [...sessions.values()].map(summary);
}
export function get(id) { return sessions.get(id); }

export function summary(s) {
  return {
    id: s.id, harness: s.harness, label: HARNESSES[s.harness].label, cwd: s.cwd, name: s.name, status: s.status,
    file: s.file, createdAt: s.createdAt, alive: s.alive, exitCode: s.exitCode, origin: s.origin,
    pendingAsk: s.pendingAsk ? { id: s.pendingAsk.id, questions: s.pendingAsk.questions } : null,
    pendingPermission: s.pendingPermission ? { id: s.pendingPermission.id, tool: s.pendingPermission.tool, input: s.pendingPermission.input } : null,
    terminalNeeds: s.terminalNeeds || null, context: s.context || null, lastActivity: s.lastActivity,
  };
}

function changed(s, what = "session") {
  s.lastActivity = Date.now();
  bus.emit("session", summary(s), what);
}

// Start a harness in a terminal. Returns the session.
export function start({ harness, cwd, prompt, name, model, resume, origin = "app", goalHint }) {
  const bin = resolveBin(HARNESSES[harness].bin);
  if (!bin) throw new Error(`${HARNESSES[harness].label} isn't installed`);
  if (!cwd || !fs.existsSync(cwd)) throw new Error(`Folder not found: ${cwd}`);
  const id = resume && harness === "claude" ? resume : crypto.randomUUID();
  if (sessions.get(id)?.alive) throw new Error("That session is already running here");
  const args = launchArgs(harness, { id, settingsFile: harness === "claude" ? SETTINGS : null, prompt, resume, name, model });
  const env = cleanEnv({ GENUI_PORT: String(PORT), GENUI_TOKEN: TOKEN, GENUI_SID: id });
  const p = pty.spawn(bin.file, [...bin.pre, ...args], { name: "xterm-256color", cols: 120, rows: 36, cwd, env, useConpty: true });
  const s = {
    id, harness, cwd, name: name || "", model, origin, goalHint: goalHint || prompt || "", pty: p, alive: true, exitCode: null,
    status: "starting", buf: "", screen: "", createdAt: Date.now(), startedAt: Date.now(), lastOutput: Date.now(), lastActivity: Date.now(),
    file: null, pendingAsk: null, pendingPermission: null, terminalNeeds: null, resumeOf: resume || null,
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
    if (s.pendingAsk) { s.pendingAsk.respond({}); s.pendingAsk = null; }
    if (s.pendingPermission) { s.pendingPermission.respond({}); s.pendingPermission = null; }
    changed(s);
  });
  findTranscript(s);
  persist();
  changed(s, "started");
  return s;
}

// Prompts that live only in the terminal (folder trust, login, update notices) become a card.
function sniffScreen(s) {
  const tail = s.screen.slice(-1600);
  let needs = null;
  if (/trust this folder|Do you trust the (files|contents)|Is this a project you created or one you trust/i.test(tail)) needs = { kind: "trust", text: "The harness wants to know if you trust this folder before it starts." };
  else if (/Allow Codex to|approve this command|Would you like to run the following command/i.test(tail) && s.harness !== "claude") needs = { kind: "approve", text: "The agent is asking for approval in its terminal." };
  else if (/\(y\/n\)|\[y\/N\]|\[Y\/n\]/.test(tail.slice(-200))) needs = { kind: "yesno", text: "The terminal is waiting for a yes or no." };
  if (JSON.stringify(needs) !== JSON.stringify(s.terminalNeeds)) {
    s.terminalNeeds = needs;
    if (needs) s.status = "needs";
    changed(s);
  }
  // Codex and Grok have no hooks here: treat output going quiet as the end of a turn.
  if (s.harness !== "claude") {
    clearTimeout(s.quietTimer);
    if (s.status !== "working" && s.status !== "starting" && !needs) { s.status = "working"; changed(s); }
    s.quietTimer = setTimeout(() => { if (s.alive && s.status === "working") { s.status = "idle"; changed(s, "turn-end"); } }, 4000);
  }
}

// Where each harness writes this session's transcript.
function findTranscript(s) {
  const tryFind = () => {
    if (!s.alive && s.file) return;
    let f = null;
    if (s.harness === "claude") {
      const enc = s.cwd.replace(/[^A-Za-z0-9]/g, "-");
      const direct = path.join(STORES.claude, enc, `${s.id}.jsonl`);
      if (fs.existsSync(direct)) f = direct;
      else {
        try { for (const d of fs.readdirSync(STORES.claude)) { const p = path.join(STORES.claude, d, `${s.id}.jsonl`); if (fs.existsSync(p)) { f = p; break; } } } catch {}
      }
    } else if (s.harness === "codex") {
      f = newestMatching(STORES.codex, 4, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), s.startedAt - 5000, (file) => {
        try { const first = fs.readFileSync(file, "utf8").split("\n")[0]; const m = JSON.parse(first); return path.resolve(m.payload.cwd || "") === path.resolve(s.cwd); } catch { return false; }
      });
    } else {
      const encDir = path.join(STORES.grok, encodeURIComponent(s.cwd));
      f = newestMatching(encDir, 1, (n) => n === "chat_history.jsonl", s.startedAt - 5000, () => true);
    }
    if (f) { s.file = f; persist(); watch(s); changed(s); return; }
    if (Date.now() - s.startedAt < 10 * 60 * 1000) setTimeout(tryFind, 1500);
  };
  setTimeout(tryFind, 800);
}

function newestMatching(dir, depth, nameOk, sinceMs, extraOk) {
  let best = null;
  const walk = (d, left) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) walk(p, left - 1);
      else if (e.isFile() && nameOk(e.name)) {
        const st = fs.statSync(p);
        if (st.mtimeMs >= sinceMs && (!best || st.mtimeMs > best.m) && extraOk(p)) best = { p, m: st.mtimeMs };
      }
    }
  };
  walk(dir, depth);
  return best && best.p;
}

function watch(s) {
  let lastSize = -1;
  const tick = () => {
    try {
      const st = fs.statSync(s.file);
      if (st.size !== lastSize) {
        lastSize = st.size;
        const parsed = readSession(s.harness, s.file);
        s.context = parsed.context;
        bus.emit("transcript", s.id, parsed);
      }
    } catch {}
  };
  tick();
  s.watcher = setInterval(tick, 1200);
}

// ---- Input -----------------------------------------------------------------
export function write(id, data) { const s = sessions.get(id); if (s?.alive) s.pty.write(data); }
export function resize(id, cols, rows) { const s = sessions.get(id); if (s?.alive) try { s.pty.resize(Math.max(20, cols), Math.max(5, rows)); } catch {} }

// Send a message as if typed: paste it as one block, then press Enter.
export function send(id, text) {
  const s = sessions.get(id);
  if (!s?.alive) throw new Error("This session isn't running");
  const body = text.replace(/\r\n/g, "\n");
  s.pty.write(`\x1b[200~${body}\x1b[201~`);
  setTimeout(() => s.pty.write("\r"), 120);
  s.status = "working"; changed(s);
}

export function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.pty.kill(); } catch {}
  clearInterval(s.watcher);
}

export function stopAll() { for (const id of sessions.keys()) stop(id); }

// ---- Hooks from Claude Code ------------------------------------------------------
// Called with each hook event; `respond` answers a waiting hook (AskUserQuestion / PermissionRequest).
export function onHook(id, ev, respond, wantsAnswer) {
  const s = sessions.get(id);
  if (!s) { respond({}); return; }
  const name = ev.hook_event_name;
  if (ev.transcript_path && !s.file) { s.file = ev.transcript_path; persist(); watch(s); }
  if (name === "SessionStart") { s.status = "idle"; }
  if (name === "UserPromptSubmit") { s.status = "working"; s.terminalNeeds = null; }
  if (name === "Stop") { s.status = "idle"; changed(s, "turn-end"); respond({}); return; }
  if (name === "Notification") {
    if (/permission/i.test(ev.notification_type || ev.message || "")) s.status = "needs";
    else if (/idle|input/i.test(ev.notification_type || "")) s.status = s.pendingAsk ? "needs" : "idle";
  }
  if (name === "PreToolUse" && ev.tool_name === "AskUserQuestion" && wantsAnswer) {
    const qid = crypto.randomUUID();
    s.pendingAsk = { id: qid, questions: (ev.tool_input && ev.tool_input.questions) || [], input: ev.tool_input, respond };
    s.status = "needs";
    changed(s, "ask");
    return; // answered later through answerAsk()
  }
  if (name === "PermissionRequest" && wantsAnswer) {
    const qid = crypto.randomUUID();
    s.pendingPermission = { id: qid, tool: ev.tool_name, input: ev.tool_input, respond };
    s.status = "needs";
    changed(s, "permission");
    return;
  }
  changed(s);
  respond({});
}

// Answer a multiple-choice question: Claude Code receives the answers as if picked in its menu.
export function answerAsk(id, qid, answers) {
  const s = sessions.get(id);
  if (!s?.pendingAsk || s.pendingAsk.id !== qid) throw new Error("That question is no longer open");
  const pa = s.pendingAsk; s.pendingAsk = null;
  if (answers === null) pa.respond({}); // answer it in the terminal instead
  else pa.respond({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...pa.input, answers } } });
  s.status = "working"; changed(s);
}

export function answerPermission(id, qid, allow, message) {
  const s = sessions.get(id);
  if (!s?.pendingPermission || s.pendingPermission.id !== qid) throw new Error("That request is no longer open");
  const pp = s.pendingPermission; s.pendingPermission = null;
  if (allow === null) pp.respond({});
  else pp.respond({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: allow ? { behavior: "allow" } : { behavior: "deny", message: message || "The user declined this in GenUI Agent." } } });
  s.status = "working"; changed(s);
}

// Folder-trust and similar terminal prompts: the safe default needs a keypress the user chooses.
export function answerTerminal(id, choice) {
  const s = sessions.get(id);
  if (!s?.alive || !s.terminalNeeds) return;
  if (s.terminalNeeds.kind === "trust") s.pty.write(choice === "yes" ? (s.harness === "claude" ? "\x1b[B\r" : "\r") : "\x1b");
  else if (s.terminalNeeds.kind === "yesno") s.pty.write(choice === "yes" ? "y\r" : "n\r");
  else s.pty.write(choice === "yes" ? "\r" : "\x1b");
  s.terminalNeeds = null; s.status = "working"; s.screen = ""; changed(s);
}
