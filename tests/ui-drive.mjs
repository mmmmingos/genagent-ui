// Drive the real app window in headless Chrome against real sessions in sandbox/.
// Run: node tests/ui-drive.mjs [outDir]   (own server on port 4398; screenshots to outDir)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4398, CDP = 9338;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const SANDBOX = path.join(ROOT, "sandbox", "ui-" + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
fs.writeFileSync(path.join(SANDBOX, "notes.md"), "# Landing page\nWe are writing a landing page for a coffee subscription.\n");

const env = { ...process.env, GENUI_PORT: String(PORT) };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-ui-" + Date.now())}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const sendCdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await sendCdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
const shot = async (name) => { const r = await sendCdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);
const waitFor = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(500); } return false; };
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H })).json();

try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  let wsUrl; for (let i = 0; i < 40 && !wsUrl; i++) { try { const t = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {} await sleep(250); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push("page: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console: " + JSON.stringify(d.params.args.map((a) => a.value || a.description))); };
  await sendCdp("Runtime.enable"); await sendCdp("Page.enable");
  const theme = process.env.THEME || "light";
  await sendCdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  await sendCdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await sendCdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/?t=${TOKEN}` });
  check("app loaded", await waitFor(`!!document.querySelector('.side .brand')`, 15000));
  await sleep(800);
  await shot(`01-overview-${theme}`);
  check("saved sessions listed in sidebar", (await ev(`document.querySelectorAll('.side-list.saved .row').length`)) > 5);

  // Open a saved session (read-only) and wait for the generated goal.
  await ev(`document.querySelector('.side-list.saved .row').click()`);
  await sleep(600); await shot(`02-saved-loading-${theme}`);
  check("saved session: generated goal shown", await waitFor(`!!document.querySelector('.goal .goal-text')`, 120000));
  await sleep(300); await shot(`03-saved-goal-${theme}`);

  // Start a live Claude Code session in the sandbox through the API, then open it.
  const s = await api("/api/sessions", { harness: "claude", cwd: SANDBOX, model: "sonnet", name: "Landing page",
    prompt: "Read notes.md. Then ask me, using the AskUserQuestion tool, which headline style I prefer for the coffee landing page (offer 3 short options with descriptions). After I answer, write a 2-sentence hero in your reply and end by asking me in plain text two open questions: what the price is, and whether we offer a free trial." });
  await sleep(500);
  await ev(`GENUI.openLive(${JSON.stringify(s.id)})`);
  check("trust card shown", await waitFor(`!!document.querySelector('.term-need')`, 60000));
  await shot(`04-live-trust-${theme}`);
  await ev(`document.querySelector('[data-act=term-yes]').click()`);
  check("AskUserQuestion card shown", await waitFor(`!!document.querySelector('[data-ask]')`, 150000));
  await sleep(400); await shot(`05-live-ask-${theme}`);
  await ev(`document.querySelectorAll('[data-askpick]')[1].click()`);
  await sleep(200); await shot(`06-live-ask-picked-${theme}`);
  await ev(`document.querySelector('[data-act=ask-send]').click()`);
  check("generated question cards after the turn", await waitFor(`document.querySelectorAll('.cards .q').length >= 1`, 240000));
  await sleep(500); await shot(`07-live-cards-${theme}`);
  // Terminal tab.
  await ev(`document.querySelector('[data-tab=terminal]').click()`); await sleep(1500);
  check("terminal shows the real Claude Code", await ev(`document.querySelector('.xterm-rows') && document.querySelector('.xterm-rows').textContent.length > 50`));
  await shot(`08-terminal-${theme}`);
  await ev(`document.querySelector('[data-tab=flow]').click()`); await sleep(300);
  // Side discussion on the first card.
  await ev(`document.querySelector('[data-discuss]').click()`);
  await sleep(500); await shot(`09-side-opening-${theme}`);
  check("side discussion opener", await waitFor(`document.querySelectorAll('.d-msg.ai:not(.pending)').length >= 1`, 180000));
  await shot(`10-side-open-${theme}`);
  await ev(`(()=>{const t=document.getElementById('side-in'); t.value='Assume 18 dollars a month. Is that fair for this kind of product?'; document.getElementById('side-msg').click();})()`);
  check("side reply", await waitFor(`document.querySelectorAll('.d-msg.ai:not(.pending)').length >= 2`, 180000));
  await ev(`document.getElementById('side-compose').click()`);
  check("composed answer", await waitFor(`!!document.getElementById('side-composed') && document.getElementById('side-composed').value.length > 20`, 180000));
  await shot(`11-side-composed-${theme}`);
  await ev(`document.getElementById('side-send').click()`);
  check("main session got the composed answer", await waitFor(`!document.getElementById('discuss').hidden === false || document.getElementById('discuss').hidden`, 10000));
  await sleep(20000); await shot(`12-after-send-${theme}`);
  // Orchestrator + new goal page.
  await ev(`GENUI.go('overview')`); await sleep(600); await shot(`13-orchestrator-${theme}`);
  await ev(`GENUI.go('new')`); await sleep(400); await shot(`14-new-goal-${theme}`);
  await api(`/api/sessions/${s.id}/stop`, {});
} catch (e) {
  console.log("FAIL exception " + e.message);
} finally {
  console.log("errors:", errors.length ? errors : "none");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill();
  setTimeout(() => process.exit(0), 600);
}
