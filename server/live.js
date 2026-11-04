// Live sessions: real harness CLIs running in pseudo-terminals the app owns.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import pty from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";
import { DATA, PORT, ROOT, STORES, cleanEnv, hookSecret, ID_RE } from "./config.js";
import { resolveBin, launchArgs, HARNESSES } from "./harness.js";
import { readSession } from "./transcripts.js";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const REG = path.join(DATA, "live.json");
const sessions = new Map(); // id -> session
const BUF_MAX = 400_000;

// One settings file adds GenUI's hooks to the sessions it starts (only those sessions). The hooks
// only report: questions and approvals stay in Claude Code's own menus, in its terminal.
const SETTINGS = path.join(DATA, "claude-hooks.json");
function writeHookSettings() {
  const cmd = `node "${path.join(ROOT, "server", "hook-client.mjs").replace(/\\/g, "/")}"`;
  const h = (matcher) => [{ matcher, hooks: [{ type: "command", command: cmd }] }];
  const s = { hooks: {
    SessionStart: h(""), UserPromptSubmit: h(""), Stop: h(""), Notification: h(""),
    PreToolUse: h("AskUserQuestion"), PostToolUse: h("AskUserQuestion"), PermissionRequest: h(""), PreCompact: h(""),
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
  return {
    id: s.id, harness: s.harness, label: HARNESSES[s.harness].label, cwd: s.cwd, name: s.name, status: s.status,
    file: s.file, createdAt: s.createdAt, alive: s.alive, exitCode: s.exitCode, origin: s.origin, goalHint: s.goalHint, turnError: s.turnError || null,
    // What Claude Code's own menu in the terminal is waiting on: a question (with its questions) or an approval.
    native: s.native ? s.native.kind : null,
    pendingAsk: s.ask && s.native?.kind === "ask" ? { id: s.ask.id, questions: s.ask.questions } : null,
    pendingPermission: s.perm && s.native?.kind === "permission" ? { id: s.perm.id, tool: s.perm.tool, input: s.perm.input } : null,
    terminalNeeds: s.terminalNeeds || null, context: s.context || null, lastActivity: s.lastActivity,
  };
}

// The terminal as it looks now: a headless copy of the screen, fed the same output as the window.
function screenRows(s) {
  const b = s.vt.buffer.active, rows = [];
  for (let i = 0; i < s.vt.rows; i++) rows.push(b.getLine(b.viewportY + i)?.translateToString(true) || "");
  return rows;
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
    file: null, ask: null, perm: null, native: null, terminalNeeds: null, hooked: false, resumeOf: resume || null,
    vt: new xtermHeadless.Terminal({ cols: 120, rows: 36, allowProposedApi: true, scrollback: 200 }),
  };
  sessions.set(id, s);
  p.onData((d) => {
    s.buf += d;
    if (s.buf.length > BUF_MAX) s.buf = s.buf.slice(-BUF_MAX);
    s.screen = (s.screen + plain(d)).slice(-6000);
    s.lastOutput = Date.now();
    s.vt.write(d);
    bus.emit("pty", id, d);
    sniffScreen(s);
  });
  p.onExit(({ exitCode }) => {
    s.alive = false; s.exitCode = exitCode; s.status = "exited";
    s.ask = null; s.perm = null; s.native = null; s.terminalNeeds = null;
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

// Prompts that live only in the terminal (folder trust, yes/no) become a card. Only the last few
// lines count, so an agent printing "(y/n)" in its reply doesn't trigger a card. Claude Code's own
// menus (its questions and approvals) are read from the screen as it really looks, so the app knows
// exactly when one is open and when it closes; the user answers them in the terminal, as always.
function hookCommands(cwd) {
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (typeof v.command === "string") out.push(v.command); Object.values(v).forEach(walk); } };
  try { walk(JSON.parse(fs.readFileSync(path.join(cwd, ".codex", "hooks.json"), "utf8"))); } catch {}
  return [...new Set(out)].join("\n").slice(0, 400);
}

// Claude Code's menus end with "Esc to cancel": its question menu says "Enter to select", its approval
// asks "Do you want to ...". Exported for tests.
export function nativeMenu(rows) {
  const filled = rows.filter((r) => r.trim());
  const foot = filled.slice(-3).join("\n"), near = filled.slice(-30).join("\n");
  if (!/Esc to cancel/i.test(foot) && !/Ready to submit your answers\?/i.test(near)) return null;
  if (/Enter to select|Ready to submit your answers\?/i.test(near)) return { kind: "ask" };
  if (/Do you want to /i.test(near)) return { kind: "permission" };
  return { kind: "menu" };
}

// Claude Code's footer says "esc to interrupt" only while a turn runs. If the hook that ends a turn is
// late, the screen already shows it ended: count the turn over once that has held for a moment.
function readIdle(s, rows) {
  if (s.status !== "working" || !s.hooked) { s.idleSince = 0; return; }
  const foot = rows.filter((r) => r.trim()).slice(-3).join("\n");
  const waiting = /shift\+tab to cycle|for agents|\? for shortcuts/i.test(foot) && !/esc to interrupt/i.test(foot);
  if (!waiting) { s.idleSince = 0; return; }
  if (!s.idleSince) { s.idleSince = Date.now(); clearTimeout(s.idleTimer); s.idleTimer = setTimeout(() => sniffScreen(s), 1600); return; }
  if (Date.now() - s.idleSince < 1500) return;
  s.idleSince = 0; s.status = "idle"; changed(s, "turn-end");
}

function readNative(s) {
  const rows = screenRows(s);
  readIdle(s, rows);
  const m = nativeMenu(rows);
  if (m) {
    s.nativeGoneAt = 0;
    if (s.native?.kind === m.kind) return;
    s.native = { ...m, at: Date.now() }; s.status = "needs";
    changed(s, m.kind === "ask" ? "ask" : m.kind === "permission" ? "permission" : "session");
    return;
  }
  // A menu redraws as it closes; only count it gone once the screen has stayed clear for a moment.
  if (!s.native) return;
  if (!s.nativeGoneAt) { s.nativeGoneAt = Date.now(); clearTimeout(s.nativeTimer); s.nativeTimer = setTimeout(() => sniffScreen(s), 500); return; }
  if (Date.now() - s.nativeGoneAt < 400) return;
  closeNative(s);
  changed(s);
}
// The menu was answered: the agent carries on, unless its turn already ended while the menu was up.
function closeNative(s) {
  if (!s.native) return;
  if (s.native.kind === "ask") s.ask = null;
  if (s.native.kind === "permission") s.perm = null;
  if (s.status === "needs" && !s.terminalNeeds) s.status = (s.stoppedAt || 0) > s.native.at ? "idle" : "working";
  s.native = null; s.nativeGoneAt = 0;
}

function sniffScreen(s) {
  clearTimeout(s.sniffTimer);
  s.sniffTimer = setTimeout(() => {
    if (s.harness === "claude") { readNative(s); if (s.hooked) return; }
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
export function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (!s?.alive || !(cols > 0) || !(rows > 0)) return;
  const c = Math.max(20, Math.min(cols, 500)), r = Math.max(5, Math.min(rows, 300));
  try { s.pty.resize(c, r); s.vt.resize(c, r); } catch {}
}

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
// Claude Code's hooks report what is happening; none of them waits for the app. Its questions and
// approvals show in its own menus, and the screen tells us when those open and close.
export function onHook(id, ev) {
  const s = sessions.get(id);
  if (!s) return;
  const name = ev.hook_event_name;
  s.hooked = true;
  if (ev.transcript_path && !s.file && fs.existsSync(path.dirname(ev.transcript_path))) { s.file = ev.transcript_path; persist(); watch(s); }
  if (name === "SessionStart") { if (s.status === "starting") s.status = "idle"; s.terminalNeeds = null; }
  if (name === "UserPromptSubmit") { s.status = "working"; s.terminalNeeds = null; s.ask = null; s.perm = null; }
  if (name === "Stop") {
    s.stoppedAt = Date.now(); s.terminalNeeds = null;
    if (s.native && s.nativeGoneAt) closeNative(s); // already leaving the screen
    s.status = s.native ? "needs" : "idle";
    changed(s, "turn-end"); return;
  }
  if (name === "Notification" && /idle_prompt/i.test(ev.notification_type || ev.message || "") && s.status === "working") { s.status = "idle"; changed(s, "turn-end"); return; }
  if (name === "PreToolUse" && ev.tool_name === "AskUserQuestion") { s.ask = { id: crypto.randomUUID(), questions: (ev.tool_input && ev.tool_input.questions) || [] }; s.status = "needs"; changed(s, "ask"); sniffScreen(s); return; }
  if (name === "PostToolUse" && ev.tool_name === "AskUserQuestion") { s.ask = null; s.status = "working"; }
  if (name === "PermissionRequest") { s.perm = { id: crypto.randomUUID(), tool: ev.tool_name, input: ev.tool_input }; s.status = "needs"; changed(s, "permission"); sniffScreen(s); return; }
  if (name === "PreToolUse" && s.status !== "working" && !s.native) s.status = "working";
  changed(s);
}

// Put an answer worked out in a side chat into Claude Code's open question menu, through its own
// "Type something" option, exactly as if typed there. qi picks the question in a multi-question menu.
export async function typeAnswer(id, qi, text) {
  const s = sessions.get(id);
  if (!s?.alive || s.native?.kind !== "ask" || !s.ask) throw new Error("The question isn't open in the terminal any more");
  const qs = s.ask.questions, q = qs[qi];
  if (!q) throw new Error("No such question");
  const body = String(text).replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "").trim();
  if (!body) throw new Error("Nothing to send");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = async (k, ms = 180) => { s.pty.write(k); await sleep(ms); };
  const flat = () => screenRows(s).join("\n").replace(/\s+/g, " ");
  const shown = () => flat().includes(q.question.replace(/\s+/g, " ").slice(0, 60));
  // Several questions show one at a time, as tabs: move to the right one.
  for (let n = 0; n < qs.length + 1 && qs.length > 1 && !shown(); n++) await key("\x1b[C", 250);
  if (!shown()) throw new Error("Couldn't find that question in the terminal");
  const typeRow = (q.options || []).length + 1;
  if (q.multiSelect) {
    // Checkbox lists toggle on a number, so walk the cursor down to "Type something" instead.
    const rows = screenRows(s), cur = rows.map((r) => /^\s*❯\s*(\d+)\./.exec(r)).find(Boolean);
    const from = cur ? Number(cur[1]) : 1;
    for (let n = from; n < typeRow; n++) await key("\x1b[B");
    for (let n = from; n > typeRow; n--) await key("\x1b[A");
  } else await key(String(typeRow), 250);
  await key(`\x1b[200~${body}\x1b[201~`, 450);
  if (q.multiSelect) await key("\x1b[B", 250);
  await key("\r", 600);
  // After the last question Claude Code shows a review; submit it when every question has an answer.
  const review = flat();
  if (/Ready to submit your answers\?/.test(review) && (review.match(/→/g) || []).length >= qs.length) await key("\r", 300);
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
