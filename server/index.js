// GenUI Agent server: serves the app, streams terminals, receives Claude Code hooks.
// Binds to 127.0.0.1 only. Requests must name this exact host and port, come from this exact origin,
// and carry either the window's per-launch session cookie or the install token (tests and tools).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { ROOT, DATA, PORT, HOST, TOKEN, hookSecret, safeEqual, ID_RE } from "./config.js";
import * as live from "./live.js";
import { listSaved, readSession } from "./transcripts.js";
import { generate, cached } from "./genui.js";
import * as side from "./side.js";
import { plan, stepPrompt } from "./plan.js";
import { available, HARNESSES } from "./harness.js";

const WEB = path.join(ROOT, "web");
const MOD = path.join(ROOT, "node_modules");
const ORIGIN = `http://${HOST}:${PORT}`;
const HOSTPORT = `${HOST}:${PORT}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const log = (...a) => fs.appendFileSync(path.join(DATA, "server.log"), `[${new Date().toISOString()}] ${a.join(" ")}\n`);

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
    savedCache = { at: Date.now(), items: listSaved({ limit: 400 }).filter((s) => !forks.has(s.id)) };
  }
  return savedCache.items;
}
const findFile = (harness, file) => {
  // Only transcripts the app listed (or started) may be opened.
  const ok = saved().some((s) => s.file === file) || live.list().some((s) => s.file === file) || live.loadRegistry().some((s) => s.file === file);
  return ok && fs.existsSync(file) ? file : null;
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
      const ev = await body(req);
      const wants = url.searchParams.get("wait") === "1";
      const respond = (out) => json(res, 200, out || {});
      const qid = live.onHook(sid, ev, respond, wants);
      // If the hook gives up (timeout, Esc in the terminal, Claude kills it), the card must go too.
      if (qid) res.on("close", () => { if (!res.writableEnded) live.hookGone(sid, qid); });
      return;
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
      if (action === "ask") { live.answerAsk(id, B.qid, B.answers ?? null); return json(res, 200, { ok: true }); }
      if (action === "permission") { live.answerPermission(id, B.qid, B.allow ?? null, B.message); return json(res, 200, { ok: true }); }
      if (action === "terminal") { live.answerTerminal(id, B.choice); return json(res, 200, { ok: true }); }
      if (action === "interrupt") { live.interrupt(id, B.key === "ctrlc" ? "\x03" : "\x1b"); return json(res, 200, { ok: true }); }
      if (action === "stop") { live.stop(id); return json(res, 200, { ok: true }); }
    }
    if (p === "/api/view") {
      const harness = url.searchParams.get("harness"), file = findFile(harness, url.searchParams.get("file"));
      if (!file) return json(res, 404, { error: "Session not found" });
      const parsed = readSession(harness, file);
      return json(res, 200, { cwd: parsed.cwd, title: parsed.title, context: parsed.context, pendingAsk: parsed.pendingAsk && parsed.pendingAsk.input, events: parsed.events.slice(-80), total: parsed.events.length, gen: cached(file) });
    }
    if (p === "/api/gen" && req.method === "POST") {
      const file = findFile(B.harness, B.file);
      if (!file) return json(res, 404, { error: "Session not found" });
      return json(res, 200, await generate(B.harness, file, { force: !!B.force }));
    }
    if (p === "/api/side" && req.method === "POST") {
      const file = B.file ? findFile(B.harness, B.file) : null;
      if (B.mainId) checkId(B.mainId);
      return json(res, 200, side.open({ harness: B.harness, file, mainId: B.mainId, cwd: B.cwd, topic: B.topic }));
    }
    const sm = p.match(/^\/api\/side\/([^/]+)(?:\/(\w+))?$/);
    if (sm) {
      const [, id, action] = sm; checkId(id);
      if (!action) return json(res, 200, side.get(id) || {});
      if (action === "msg") return json(res, 200, await side.message(id, String(B.text || "")));
      if (action === "compose") return json(res, 200, await side.compose(id, Array.isArray(B.known) ? B.known.slice(0, 20) : []));
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
      let dirs = [];
      try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).slice(0, 300); } catch {}
      return json(res, 200, { path: path.resolve(base), parent: path.dirname(path.resolve(base)), dirs });
    }
    if (p === "/api/quit" && req.method === "POST") { json(res, 200, { ok: true }); setTimeout(shutdown, 200); return; }
    return json(res, 404, { error: "Unknown endpoint" });
  } catch (e) {
    log("error", p, e.stack || e.message);
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
live.bus.on("transcript", (id, parsed) => broadcast({ type: "transcript", id, context: parsed.context, count: parsed.events.length, last: parsed.events.slice(-30) }));
side.bus.on("side", (s) => broadcast({ type: "side", side: s }));

// Regenerate a live session's UI when a turn ends.
const regen = new Map();
live.bus.on("session", (summary, what) => {
  if (what !== "turn-end" || !summary.file) return;
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
