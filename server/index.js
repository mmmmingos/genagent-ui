// GenUI Agent server: serves the app, streams terminals, receives Claude Code hooks.
// Binds to 127.0.0.1 only; every request needs the per-install token.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { WebSocketServer } from "ws";
import { ROOT, DATA, PORT, HOST, TOKEN } from "./config.js";
import * as live from "./live.js";
import { listSaved, readSession } from "./transcripts.js";
import { generate, cached } from "./genui.js";
import * as side from "./side.js";
import { plan, stepPrompt } from "./plan.js";
import { available, HARNESSES } from "./harness.js";

const WEB = path.join(ROOT, "web");
const MOD = path.join(ROOT, "node_modules");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const log = (...a) => fs.appendFileSync(path.join(DATA, "server.log"), `[${new Date().toISOString()}] ${a.join(" ")}\n`);

function authed(req) {
  const h = req.headers["x-genui-token"];
  const c = /(?:^|;\s*)genui=([a-f0-9]+)/.exec(req.headers.cookie || "");
  return h === TOKEN || (c && c[1] === TOKEN);
}
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((resolve) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } }); });

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}
const inside = (base, p) => { const r = path.resolve(base, "." + p); return r.startsWith(path.resolve(base)) ? r : null; };

// Saved sessions are cached for a few seconds; listing reads ~hundreds of files.
let savedCache = { at: 0, items: [] };
function saved(force) {
  if (force || Date.now() - savedCache.at > 15000) savedCache = { at: Date.now(), items: listSaved({ limit: 400 }) };
  return savedCache.items;
}
const findFile = (harness, file) => {
  // Only transcripts the app listed (or started) may be opened.
  const ok = saved().some((s) => s.file === file) || live.list().some((s) => s.file === file) || live.loadRegistry().some((s) => s.file === file);
  return ok && fs.existsSync(file) ? file : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;
  try {
    if (p === "/health") return json(res, 200, { ok: true, app: "genui-agent" });

    // Hooks from Claude Code sessions the app started.
    if (p.startsWith("/hook/") && req.method === "POST") {
      if (req.headers["x-genui-token"] !== TOKEN) return json(res, 403, {});
      const sid = decodeURIComponent(p.slice(6));
      const ev = await body(req);
      const wants = url.searchParams.get("wait") === "1";
      let done = false;
      const respond = (out) => { if (done) return; done = true; json(res, 200, out || {}); };
      req.on("close", () => { done = true; });
      live.onHook(sid, ev, respond, wants);
      return;
    }

    // First visit with ?t=<token> sets the cookie, then the address bar is cleaned.
    if (p === "/" ) {
      if (url.searchParams.get("t") === TOKEN) {
        res.writeHead(302, { "set-cookie": `genui=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`, location: "/" });
        return res.end();
      }
      if (!authed(req)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("Open GenUI Agent from its desktop shortcut."); }
      return serveFile(res, path.join(WEB, "index.html"));
    }
    if (p.startsWith("/web/")) return serveFile(res, inside(WEB, p.slice(4)) || "");
    if (p.startsWith("/vendor/xterm/")) return serveFile(res, inside(path.join(MOD, "@xterm"), p.slice(13)) || "");

    if (!p.startsWith("/api/")) { res.writeHead(404); return res.end(); }
    if (!authed(req)) return json(res, 403, { error: "Not signed in to this app" });
    const B = req.method === "POST" ? await body(req) : {};
    const m = p.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/);

    if (p === "/api/state") return json(res, 200, { harnesses: available(), labels: Object.fromEntries(Object.entries(HARNESSES).map(([k, v]) => [k, v.label])), live: live.list(), registry: live.loadRegistry(), saved: saved(url.searchParams.get("refresh") === "1"), home: process.env.USERPROFILE || process.env.HOME });
    if (p === "/api/sessions" && req.method === "POST") {
      const s = live.start({ harness: B.harness, cwd: B.cwd, prompt: B.prompt, name: B.name, model: B.model, origin: B.origin || "app", goalHint: B.goalHint });
      return json(res, 200, live.summary(s));
    }
    if (p === "/api/resume" && req.method === "POST") {
      if (!B.confirm) return json(res, 400, { error: "Resuming a saved session needs confirmation" });
      const s = live.start({ harness: B.harness, cwd: B.cwd, resume: B.id, origin: "resumed" });
      return json(res, 200, live.summary(s));
    }
    if (m) {
      const [, id, action] = m;
      if (action === "send") { live.send(id, String(B.text || "")); return json(res, 200, { ok: true }); }
      if (action === "ask") { live.answerAsk(id, B.qid, B.answers ?? null); return json(res, 200, { ok: true }); }
      if (action === "permission") { live.answerPermission(id, B.qid, B.allow ?? null, B.message); return json(res, 200, { ok: true }); }
      if (action === "terminal") { live.answerTerminal(id, B.choice); return json(res, 200, { ok: true }); }
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
      return json(res, 200, await generate(B.harness, file));
    }
    if (p === "/api/side" && req.method === "POST") {
      const file = B.file ? findFile(B.harness, B.file) : null;
      return json(res, 200, await side.open({ harness: B.harness, file, mainId: B.mainId, cwd: B.cwd, topic: B.topic }));
    }
    const sm = p.match(/^\/api\/side\/([^/]+)\/(\w+)$/);
    if (sm) {
      const [, id, action] = sm;
      if (action === "msg") return json(res, 200, await side.message(id, String(B.text || "")));
      if (action === "compose") return json(res, 200, await side.compose(id));
      if (action === "sent") return json(res, 200, side.markSent(id, B.text));
    }
    if (p === "/api/plan" && req.method === "POST") return json(res, 200, await plan({ goal: B.goal, cwd: B.cwd }));
    if (p === "/api/plan/start" && req.method === "POST") {
      const step = B.plan.steps[B.index];
      const harness = step.harness === "you" ? "claude" : step.harness;
      const s = live.start({ harness, cwd: B.cwd, prompt: stepPrompt(B.plan, B.index, B.answers || {}), name: `${B.plan.title} · ${step.label}`.slice(0, 60), origin: "plan", goalHint: B.plan.goal });
      return json(res, 200, live.summary(s));
    }
    if (p === "/api/folders") {
      const base = url.searchParams.get("path") || path.join(process.env.USERPROFILE || "", "Documents", "GitHub");
      let dirs = [];
      try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).slice(0, 200); } catch {}
      return json(res, 200, { path: base, parent: path.dirname(base), dirs });
    }
    if (p === "/api/quit" && req.method === "POST") { json(res, 200, { ok: true }); setTimeout(shutdown, 200); return; }
    return json(res, 404, { error: "Unknown endpoint" });
  } catch (e) {
    log("error", p, e.stack || e.message);
    return json(res, 500, { error: e.message });
  }
});

// ---- Live updates to the window ----------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  const c = /(?:^|;\s*)genui=([a-f0-9]+)/.exec(req.headers.cookie || "");
  const origin = req.headers.origin || "";
  if (!c || c[1] !== TOKEN || (origin && !origin.startsWith(`http://${HOST}:${PORT}`))) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  ws.subs = new Set();
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "sub") { ws.subs.add(m.id); const s = live.get(m.id); if (s) ws.send(JSON.stringify({ type: "replay", id: m.id, data: s.buf })); }
    if (m.type === "unsub") ws.subs.delete(m.id);
    if (m.type === "input") live.write(m.id, m.data);
    if (m.type === "resize") live.resize(m.id, m.cols, m.rows);
  });
});
const broadcast = (msg, onlyFor) => { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1 && (!onlyFor || ws.subs.has(onlyFor))) ws.send(s); };
live.bus.on("pty", (id, data) => broadcast({ type: "pty", id, data }, id));
live.bus.on("session", (summary, what) => broadcast({ type: "session", session: summary, what }));
live.bus.on("transcript", (id, parsed) => broadcast({ type: "transcript", id, context: parsed.context, count: parsed.events.length, last: parsed.events.slice(-30) }));

// Regenerate a live session's UI when a turn ends.
const regen = new Map();
live.bus.on("session", (summary, what) => {
  if (what !== "turn-end" || !summary.file) return;
  clearTimeout(regen.get(summary.id));
  regen.set(summary.id, setTimeout(async () => {
    try { const g = await generate(summary.harness, summary.file); broadcast({ type: "gen", id: summary.id, file: summary.file, gen: g }); }
    catch (e) { log("gen error", e.message); broadcast({ type: "gen-error", id: summary.id, error: e.message }); }
  }, 1500));
});

// ---- Start, and open the app window ----------------------------------------------------
function openWindow() {
  const url = `http://${HOST}:${PORT}/?t=${TOKEN}`;
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
  try { const r = await fetch(`http://${HOST}:${PORT}/health`, { signal: AbortSignal.timeout(800) }); const j = await r.json(); return j.app === "genui-agent"; } catch { return false; }
}

const wantOpen = process.argv.includes("--open");
if (await alreadyRunning()) {
  if (wantOpen) openWindow();
  process.exit(0);
}
server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
  console.log(`GenUI Agent on http://${HOST}:${PORT}`);
  if (wantOpen) openWindow();
});
