// End-to-end check of the backend against a real Claude Code session in the sandbox.
// Run: node tests/e2e-backend.mjs   (starts its own server on port 4399)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4399;
const DATA = path.join(os.homedir(), ".genui-agent");
const SANDBOX = path.join(ROOT, "sandbox", "e2e-" + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
fs.writeFileSync(path.join(SANDBOX, "README.md"), "# e2e sandbox\n");

const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);

let ws;
try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  const st = await api("/api/state");
  check("state lists harnesses " + JSON.stringify(st.harnesses), st.harnesses.claude);
  check(`saved sessions listed (${st.saved.length})`, st.saved.length > 0);

  // The window's cookie is minted per launch: exchange the install token for it like the launcher does.
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  const login = await fetch(`http://127.0.0.1:${PORT}/?c=${code}`, { redirect: "manual" });
  check("launch code is single-use", (await fetch(`http://127.0.0.1:${PORT}/?c=${code}`, { redirect: "manual" })).status === 403);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("window cookie issued", /^genui=[a-f0-9]{48}$/.test(cookie));
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const events = [];
  ws.on("message", (m) => { const j = JSON.parse(m); if (j.type !== "pty" && j.type !== "replay") events.push(j); });
  await new Promise((r) => ws.on("open", r));

  const s = await api("/api/sessions", { harness: "claude", cwd: SANDBOX, model: "sonnet", name: "e2e test",
    prompt: "Use the AskUserQuestion tool to ask me one question: which colour do I prefer, options Red and Blue. After the answer, reply with exactly: ANSWER=<colour>." });
  check("session started " + s.id, !!s.id);
  ws.send(JSON.stringify({ type: "sub", id: s.id }));

  // Folder trust prompt -> card -> answer "yes".
  let got = null;
  for (let i = 0; i < 60 && !got; i++) { await sleep(1000); const cur = (await api("/api/state")).live.find((x) => x.id === s.id); if (cur.terminalNeeds || cur.pendingAsk) got = cur; }
  if (got && got.terminalNeeds) {
    check("terminal trust prompt detected as a card", got.terminalNeeds.kind === "trust");
    await api(`/api/sessions/${s.id}/terminal`, { choice: "yes" });
  }
  // Wait for the AskUserQuestion to arrive through the hook.
  let ask = null;
  for (let i = 0; i < 120 && !ask; i++) { await sleep(1000); const cur = (await api("/api/state")).live.find((x) => x.id === s.id); if (cur.pendingAsk) ask = cur.pendingAsk; }
  check("AskUserQuestion arrived via hook", !!ask);
  if (ask) {
    const q = ask.questions[0];
    await api(`/api/sessions/${s.id}/ask`, { qid: ask.id, answers: { [q.question]: "Red" } });
  }
  // The agent should now print ANSWER=Red in its terminal and the transcript.
  let ok = false;
  for (let i = 0; i < 90 && !ok; i++) {
    await sleep(1000);
    const cur = (await api("/api/state")).live.find((x) => x.id === s.id);
    if (cur.file && fs.existsSync(cur.file) && /ANSWER=Red/.test(fs.readFileSync(cur.file, "utf8"))) ok = true;
  }
  check("agent received the answer (ANSWER=Red in transcript)", ok);
  const cur = (await api("/api/state")).live.find((x) => x.id === s.id);
  check("transcript file found", !!cur.file);
  check("turn-end status idle", cur.status === "idle");

  // Typing a follow-up message into the terminal.
  await api(`/api/sessions/${s.id}/send`, { text: "Now reply with exactly: SECOND=ok" });
  let ok2 = false;
  for (let i = 0; i < 90 && !ok2; i++) { await sleep(1000); if (/SECOND=ok/.test(fs.readFileSync(cur.file, "utf8"))) ok2 = true; }
  check("typed message delivered (SECOND=ok)", ok2);

  // Generated UI arrives after a turn ends.
  let gen = events.find((e) => e.type === "gen");
  for (let i = 0; i < 60 && !gen; i++) { await sleep(1000); gen = events.find((e) => e.type === "gen"); }
  check("generated goal/flow pushed: " + (gen ? gen.gen.title : "none"), !!gen);

  // Side discussion: fork, one message, compose.
  let sd = await api("/api/side", { harness: "claude", file: cur.file, mainId: s.id, cwd: SANDBOX, topic: "Which colour should I pick?" });
  for (let i = 0; i < 180 && (sd.busy || !sd.msgs.length); i++) { await sleep(1000); sd = await api(`/api/side/${sd.id}`); }
  check("side discussion opened with an opener", sd.msgs.length === 1 && sd.msgs[0].text.length > 20);
  const sd2 = await api(`/api/side/${sd.id}/msg`, { text: "I think blue is calmer. Is that a good reason?" });
  check("side reply", sd2.msgs.length === 3);
  const sd3 = await api(`/api/side/${sd.id}/compose`, {});
  check("composed answer: " + sd3.composed.slice(0, 80).replace(/\n/g, " "), sd3.composed.length > 10);
  const before = fs.readFileSync(cur.file, "utf8");
  check("main transcript untouched by side discussion", !/calmer/.test(before));
  // Security: wrong Host, foreign Origin, cookie-only from another port, form posts, bad ids, and the master token on /hook.
  const raw = async (opts) => { const r = await fetch(`http://127.0.0.1:${PORT}${opts.path}`, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body, redirect: "manual" }); return r.status; };
  check("wrong Host header refused", (await new Promise((res) => { import("node:http").then((h) => { const rq = h.request({ host: "127.0.0.1", port: PORT, path: "/api/state", headers: { host: "evil.example:4399", "x-genui-token": TOKEN } }, (r) => { r.resume(); res(r.statusCode); }); rq.on("error", () => {}); rq.end(); }); })) === 421);
  check("cookie from another port's page refused", (await raw({ path: "/api/state", headers: { cookie, "sec-fetch-site": "same-site", origin: "http://127.0.0.1:5555" } })) === 403);
  check("form-encoded POST refused", (await raw({ path: "/api/sessions", method: "POST", headers: { "x-genui-token": TOKEN, "content-type": "application/x-www-form-urlencoded" }, body: "harness=claude" })) === 415);
  check("bad session id refused", (await raw({ path: "/api/sessions/..%2f..%2fx/stop", method: "POST", headers: { "x-genui-token": TOKEN, "content-type": "application/json" }, body: "{}" })) === 400);
  check("master token not accepted on /hook", (await raw({ path: `/hook/${s.id}`, method: "POST", headers: { "x-genui-token": TOKEN, "content-type": "application/json" }, body: "{}" })) === 403);
  await api(`/api/sessions/${s.id}/stop`, {});
} catch (e) {
  console.log("FAIL exception " + e.message);
} finally {
  try { ws && ws.close(); } catch {}
  srv.kill();
  setTimeout(() => process.exit(0), 500);
}
