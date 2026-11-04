// GenUI Agent server: serves the app, streams terminals, receives Claude Code hooks.
// Binds to 127.0.0.1 only. Requests must name this exact host and port, come from this exact origin,
// and carry either the window's per-launch session cookie or the install token (tests and tools).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { ROOT, DATA, PORT, HOST, TOKEN, hookSecret, safeEqual, ID_RE, log } from "./config.js";
import * as live from "./live.js";
import { listSaved, readSession } from "./transcripts.js";
import { generate, cached, recordAnswers } from "./genui.js";
import { buildTimeline } from "./timeline.js";
import * as side from "./side.js";
import { plan, stepPrompt } from "./plan.js";
import { available, HARNESSES } from "./harness.js";

const WEB = path.join(ROOT, "web");
const MOD = path.join(ROOT, "node_modules");
const ORIGIN = `http://${HOST}:${PORT}`;
const HOSTPORT = `${HOST}:${PORT}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

// The window's credential is minted per launch, so the long-lived install token never sits in a cookie.
const WINDOW_SECRET = crypto.randomBytes(24).toString("hex");
// The window is opened with a one-time code (valid 60 s), never with the install token itself.
const launchCodes = new Map();
function mintCode() { const c = crypto.randomBytes(16).toString("hex"); launchCodes.set(c, Date.now() + 60000); return c; }
// The install token unlocks the API only for the test suite; otherwise it can only mint a launch code.
const TEST_MODE = process.env.GENUI_TEST === "1";

function authed(req) {
  const h = req.headers["x-genui-token"];
  if (TEST_MODE && h && safeEqual(h, TOKEN)) return true;
  const c = /(?:^|;\s*)genui=([a-f0-9]+)/.exec(req.headers.cookie || "");
  if (!c || !safeEqual(c[1], WINDOW_SECRET)) return false;
  // A cookie alone is not enough: other ports on 127.0.0.1 are "same-site" and would send it too.
  const site = req.headers["sec-fetch-site"], origin = req.headers.origin;
  if (origin && origin !== ORIGIN) return false;
  return site === "same-origin" || (!site && origin === ORIGIN);
}
const json = (res, code, b) => { if (res.writableEnded) return; res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(b)); };
const body = (req) => new Promise((resolve) => { let s = ""; req.on("data", (d) => { s += d; if (s.length > 2e6) req.destroy(); }); req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } }); });

function serveFile(res, file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}
const inside = (base, p) => { const b = path.resolve(base); const r = path.resolve(b, "." + p); return r === b || r.startsWith(b + path.sep) ? r : null; };
const checkId = (id) => { if (!ID_RE.test(String(id || ""))) throw new Error("Bad id"); return id; };

// Saved sessions are cached for a few seconds; listing reads hundreds of files.
let savedCache = { at: 0, items: [] };
function saved(force) {
  if (force || Date.now() - savedCache.at > 15000) {
    const forks = side.forkIds();
    // GENUI_SAVED_ROOT (demos, tests): list only sessions from inside that folder.
    const root = process.env.GENUI_SAVED_ROOT ? path.resolve(process.env.GENUI_SAVED_ROOT).toLowerCase() : "";
    const inRoot = (cwd) => !root || (!!cwd && (path.resolve(cwd).toLowerCase() + path.sep).startsWith(root + path.sep));
    savedCache = { at: Date.now(), items: listSaved({ limit: 400 }).filter((s) => !forks.has(s.id) && inRoot(s.cwd)) };
  }
  return savedCache.items;
}
const findFile = (harness, file) => {
  // Only transcripts the app listed (or started) may be opened. Windows paths ignore case, and the
  // same project folder can be spelled "C--Users…" by one tool and "c--Users…" by another.
  if (!file) return null;
  const k = path.resolve(String(file)).toLowerCase(), same = (f) => !!f && path.resolve(f).toLowerCase() === k;
  const hit = saved().find((s) => same(s.file)) || live.list().find((s) => same(s.file)) || live.loadRegistry().find((s) => same(s.file));
  return hit && fs.existsSync(hit.file) ? hit.file : null;
};

const server = http.createServer(async (req, res) => {
  // DNS rebinding and stray hosts: only answer to the exact host:port.
  if (req.headers.host !== HOSTPORT) { res.writeHead(421); return res.end(); }
  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;
  try {
    if (p === "/health") return json(res, 200, { ok: true, app: "genui-agent" });
    if (p === "/launch" && req.method === "POST") {
      if (!safeEqual(String(req.headers["x-genui-token"] || ""), TOKEN)) return json(res, 403, {});
      return json(res, 200, { code: mintCode() });
    }

    // Hooks from Claude Code sessions the app started. Each session has its own secret.
    if (p.startsWith("/hook/") && req.method === "POST") {
      const sid = decodeURIComponent(p.slice(6));
      if (!ID_RE.test(sid) || !safeEqual(String(req.headers["x-genui-token"] || ""), hookSecret(sid))) return json(res, 403, {});
      live.onHook(sid, await body(req));
      return json(res, 200, {});
    }

    // First visit with a one-time launch code sets the per-launch cookie, then the address bar is cleaned.
    if (p === "/") {
      const c = url.searchParams.get("c");
      const exp = c && launchCodes.get(c);
      if (exp) launchCodes.delete(c);
      if (exp && exp > Date.now()) {
        res.writeHead(302, { "set-cookie": `genui=${WINDOW_SECRET}; HttpOnly; SameSite=Strict; Path=/`, location: "/" });
        return res.end();
      }
      if (!/(?:^|;\s*)genui=/.test(req.headers.cookie || "") || !authedCookie(req)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("Open GenUI Agent from its desktop shortcut."); }
      return serveFile(res, path.join(WEB, "index.html"));
    }
    if (p.startsWith("/web/")) return serveFile(res, inside(WEB, p.slice(4)));
    if (p.startsWith("/vendor/xterm/")) return serveFile(res, inside(path.join(MOD, "@xterm"), p.slice(13)));
    if (p.startsWith("/vendor/morphdom/")) return serveFile(res, inside(path.join(MOD, "morphdom", "dist"), p.slice(16)));

    if (!p.startsWith("/api/")) { res.writeHead(404); return res.end(); }
    if (!authed(req)) return json(res, 403, { error: "Not signed in to this app" });
    if (req.method === "POST" && !/^application\/json/.test(req.headers["content-type"] || "")) return json(res, 415, { error: "JSON only" });
    const B = req.method === "POST" ? await body(req) : {};
    const m = p.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/);

    if (p === "/api/state") return json(res, 200, { harnesses: available(), labels: Object.fromEntries(Object.entries(HARNESSES).map(([k, v]) => [k, v.label])), live: live.list(), saved: saved(url.searchParams.get("refresh") === "1"), home: process.env.USERPROFILE || process.env.HOME });
    if (p === "/api/sessions" && req.method === "POST") {
      const s = live.start({ harness: B.harness, cwd: B.cwd, prompt: B.prompt, name: B.name, model: B.model, origin: B.origin || "app", goalHint: B.goalHint });
      return json(res, 200, live.summary(s));
    }
    if (p === "/api/resume" && req.method === "POST") {
      if (!B.confirm) return json(res, 400, { error: "Resuming a saved session needs confirmation" });
      checkId(B.id);
      const file = !B.fork && B.file ? findFile(B.harness, B.file) : null;
      const s = live.start({ harness: B.harness, cwd: B.cwd, resume: B.id, fork: !!B.fork, file, origin: B.fork ? "forked" : "resumed" });
      return json(res, 200, live.summary(s));
    }
    if (m) {
      const [, id, action] = m; checkId(id);
      if (action === "send") { live.send(id, String(B.text || "")); return json(res, 200, { ok: true }); }
      // A worked-out answer to the agent's open question: close its menu (Esc), then type it as the user's message.
      if (action === "answer") { await live.answerQuestion(id, String(B.text || "")); return json(res, 200, { ok: true }); }
      // An ended session leaves the running list; its transcript stays in the saved sessions.
      if (action === "forget") { live.forget(id); return json(res, 200, { ok: true }); }
      if (action === "discard") return json(res, 200, { ok: live.discard(id) });
      if (action === "terminal") { live.answerTerminal(id, B.choice); return json(res, 200, { ok: true }); }
      if (action === "interrupt") { live.interrupt(id, B.key === "ctrlc" ? "\x03" : "\x1b"); return json(res, 200, { ok: true }); }
      if (action === "stop") { live.stop(id); return json(res, 200, { ok: true }); }
    }
    if (p === "/api/view") {
      const harness = url.searchParams.get("harness"), file = findFile(harness, url.searchParams.get("file"));
      if (!file) return json(res, 404, { error: "Session not found" });
      const parsed = readSession(harness, file);
      return json(res, 200, { cwd: parsed.cwd, title: parsed.title, context: parsed.context, pendingAsk: parsed.pendingAsk && parsed.pendingAsk.input, plan: parsed.plan || null, events: parsed.events.slice(-80), total: parsed.events.length, timeline: buildTimeline(parsed.events, { cwd: parsed.cwd }), userTurns: parsed.events.filter((e) => e.role === "user").length, gen: cached(file) });
    }
    if (p === "/api/gen" && req.method === "POST") {
      const file = findFile(B.harness, B.file);
      if (!file) return json(res, 404, { error: "Session not found" });
      return json(res, 200, await generate(B.harness, file, { force: !!B.force }));
    }
    // Answers sent from GenUI's reply: their asks clear at once, before the model has read the reply.
    if (p === "/api/asks" && req.method === "POST") {
      const file = findFile(B.harness, B.file);
      if (!file) return json(res, 404, { error: "Session not found" });
      recordAnswers(file, Array.isArray(B.answers) ? B.answers.slice(0, 40) : []);
      return json(res, 200, cached(file) || {});
    }
    if (p === "/api/side" && req.method === "POST") {
      const file = B.file ? findFile(B.harness, B.file) : null;
      if (B.mainId) checkId(B.mainId);
      return json(res, 200, side.open({ harness: B.harness, file, mainId: B.mainId, cwd: B.cwd, topic: B.topic, first: B.first ? String(B.first).slice(0, 8000) : "" }));
    }
    const sm = p.match(/^\/api\/side\/([^/]+)(?:\/(\w+))?$/);
    if (sm) {
      const [, id, action] = sm; checkId(id);
      if (!action) return json(res, 200, side.get(id) || {});
      if (action === "msg") return json(res, 200, await side.message(id, String(B.text || "")));
      if (action === "compose") return json(res, 200, await side.compose(id, Array.isArray(B.known) ? B.known.slice(0, 20) : [], !!B.answerOnly, Array.isArray(B.options) ? B.options.slice(0, 8).map(String) : null));
      if (action === "sent") return json(res, 200, side.markSent(id, B.text));
      if (action === "cancel") { side.cancel(id); return json(res, 200, { ok: true }); }
    }
    if (p === "/api/plan" && req.method === "POST") return json(res, 200, await plan({ goal: B.goal, cwd: B.cwd }));
    if (p === "/api/plan/start" && req.method === "POST") {
      const step = B.plan.steps[B.index];
      if (!step || step.harness === "you") return json(res, 400, { error: "That step is yours to do" });
      const s = live.start({ harness: step.harness, cwd: B.cwd, prompt: stepPrompt(B.plan, B.index, B.answers || {}), name: `${B.plan.title} · ${step.label}`.slice(0, 60), origin: "plan", goalHint: B.plan.goal });
      return json(res, 200, live.summary(s));
    }
    if (p === "/api/folders") {
      const base = url.searchParams.get("path") || path.join(process.env.USERPROFILE || "", "Documents", "GitHub");
      let dirs = [], exists = false;
      try { exists = fs.statSync(base).isDirectory(); dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).slice(0, 400); } catch {}
      // A project folder has its own repo or manifest; a folder of projects (like GitHub) doesn't.
      const project = exists && [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "CLAUDE.md", "AGENTS.md"].some((f) => fs.existsSync(path.join(base, f)));
      return json(res, 200, { path: path.resolve(base), parent: path.dirname(path.resolve(base)), dirs, exists, project });
    }
    if (p === "/api/quit" && req.method === "POST") { json(res, 200, { ok: true }); setTimeout(shutdown, 200); return; }
    return json(res, 404, { error: "Unknown endpoint" });
  } catch (e) {
    log("error", p, e.stack || e.message, e.detail || "");
    return json(res, e.message === "Bad id" ? 400 : 500, { error: e.message });
  }
});
function authedCookie(req) {
  const c = /(?:^|;\s*)genui=([a-f0-9]+)/.exec(req.headers.cookie || "");
  return !!(c && safeEqual(c[1], WINDOW_SECRET));
}

// ---- Live updates to the window ----------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  const ok = req.headers.host === HOSTPORT && req.headers.origin === ORIGIN && authedCookie(req);
  if (!ok) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  ws.subs = new Set();
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!ID_RE.test(String(m.id || ""))) return;
    if (m.type === "sub") { ws.subs.add(m.id); const s = live.get(m.id); if (s) ws.send(JSON.stringify({ type: "replay", id: m.id, data: s.buf })); }
    if (m.type === "unsub") ws.subs.delete(m.id);
    if (m.type === "input" && typeof m.data === "string") live.write(m.id, m.data);
    if (m.type === "resize") live.resize(m.id, m.cols | 0, m.rows | 0);
  });
});
const broadcast = (msg, onlyFor) => { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1 && (!onlyFor || ws.subs.has(onlyFor))) ws.send(s); };
live.bus.on("pty", (id, data) => broadcast({ type: "pty", id, data }, id));
live.bus.on("session", (summary, what) => broadcast({ type: "session", session: summary, what }));
live.bus.on("gone", (id) => broadcast({ type: "gone", id }));
// A long session's timeline is a few hundred kB, so each session's goes out at most every 2.5 s;
// the latest state always follows.
const sentAt = new Map(), later = new Map();
live.bus.on("transcript", (id, parsed) => {
  const out = () => {
    const st = live.get(id)?.status, working = st === "working" || st === "needs";
    sentAt.set(id, Date.now()); later.delete(id);
    broadcast({ type: "transcript", id, context: parsed.context, count: parsed.events.length, last: parsed.events.slice(-30), plan: parsed.plan || null, timeline: buildTimeline(parsed.events, { cwd: parsed.cwd || live.get(id)?.cwd, working }), userTurns: parsed.events.filter((e) => e.role === "user").length });
  };
  clearTimeout(later.get(id));
  const wait = 2500 - (Date.now() - (sentAt.get(id) || 0));
  if (wait <= 0) out(); else later.set(id, setTimeout(out, wait));
  midTurn(id, parsed);
});

// While a long turn runs, refresh the goal and flow every few tool calls or about once a minute,
// so the current step moves without waiting for the turn to end.
const MID_SEC = Number(process.env.GENUI_MIDTURN_SEC || 60), MID_TOOLS = Number(process.env.GENUI_MIDTURN_TOOLS || 6);
const mid = new Map(); // id -> { at, tools, busy }
function midTurn(id, parsed) {
  const s = live.get(id);
  if (!s || !s.alive || s.status !== "working" || !s.file) return;
  const tools = parsed.events.filter((e) => e.role === "tool").length;
  const m = mid.get(id) || { at: s.startedAt, tools: 0, busy: false };
  mid.set(id, m);
  const since = (Date.now() - m.at) / 1000, more = tools - m.tools;
  if (m.busy || more <= 0 || !((more >= MID_TOOLS && since >= 25) || since >= MID_SEC)) return;
  m.busy = true; m.at = Date.now(); m.tools = tools;
  broadcast({ type: "gen-start", id, file: s.file, midTurn: true });
  generate(s.harness, s.file, { midTurn: true })
    .then((g) => { if (s.status === "working") broadcast({ type: "gen", id, file: s.file, gen: g }); else broadcast({ type: "gen-error", id, file: s.file, error: "turn ended" }); })
    .catch((e) => { log("mid gen error", e.message); broadcast({ type: "gen-error", id, file: s.file, error: e.message }); })
    .finally(() => { m.busy = false; });
}
side.bus.on("side", (s) => broadcast({ type: "side", side: s }));

// Regenerate a live session's UI when a turn ends.
const regen = new Map();
live.bus.on("session", (summary, what) => {
  if (what !== "turn-end" || !summary.file) return;
  const m = mid.get(summary.id); if (m) { m.at = Date.now(); }
  clearTimeout(regen.get(summary.id));
  regen.set(summary.id, setTimeout(async () => {
    broadcast({ type: "gen-start", id: summary.id, file: summary.file });
    try { const g = await generate(summary.harness, summary.file); broadcast({ type: "gen", id: summary.id, file: summary.file, gen: g }); }
    catch (e) { log("gen error", e.message); broadcast({ type: "gen-error", id: summary.id, file: summary.file, error: e.message }); }
  }, 1500));
});

// ---- Start, and open the app window ----------------------------------------------------
function openWindow(code = mintCode()) {
  const url = `${ORIGIN}/?c=${code}`;
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google/Chrome/Application/chrome.exe"),
  ];
  const browser = candidates.find((c) => fs.existsSync(c));
  if (browser) spawn(browser, [`--app=${url}`, `--user-data-dir=${path.join(DATA, "window")}`, "--window-size=1440,920", "--no-first-run", "--no-default-browser-check"], { detached: true, stdio: "ignore" }).unref();
  else spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

function shutdown() {
  live.stopAll();
  setTimeout(() => process.exit(0), 400);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function alreadyRunning() {
  try { const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(800) }); const j = await r.json(); return j.app === "genui-agent"; } catch { return false; }
}

const wantOpen = process.argv.includes("--open");
if (await alreadyRunning()) {
  // Ask the running instance for a one-time code, then open a window onto it.
  if (wantOpen) { try { const r = await fetch(`${ORIGIN}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } }); const j = await r.json(); openWindow(j.code); } catch {} }
  process.exit(0);
}
server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
  console.log(`GenUI Agent on ${ORIGIN}`);
  if (wantOpen) openWindow();
});
