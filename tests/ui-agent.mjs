// Drive the agent view like a person: a Claude Code session asks a question in its own menu, the plan
// rail turns its step amber, a click opens the question, "Discuss it" opens a side chat, and the
// answer worked out there goes back into Claude Code's menu. Run: node tests/ui-agent.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots", "agent");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4388, CDP = 9333;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const SANDBOX = path.join(ROOT, "sandbox", "agent-" + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-agent-" + Date.now())}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
let n = 0; const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64")); };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(400); } return false; };
const clickSel = async (sel) => {
  const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width};})()`);
  if (!box || !box.w) { errors.push("not clickable: " + sel); return false; }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
};
const typeText = (text) => cdp("Input.insertText", { text });
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H })).json();

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await sleep(250); } }
  let wsUrl; for (let i = 0; i < 40 && !wsUrl; i++) { try { const t = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {} await sleep(250); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push("page: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) errors.push("console: " + JSON.stringify(d.params.args.map((a) => a.value || a.description)));
    if (d.method === "Network.responseReceived" && d.params.response.status >= 400) errors.push(`http ${d.params.response.status} ${d.params.response.url}`); };
  await cdp("Runtime.enable"); await cdp("Page.enable"); await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.THEME || "light" }] });
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/?c=${code}` });
  check("app loaded", await waitFor(`!!document.querySelector('#side .srow-new')`));

  // A session that is a step of a plan, so the rail shows the plan with this step current.
  const s = await api("/api/sessions", { harness: "claude", cwd: SANDBOX, model: "sonnet", name: "Pick a button colour",
    prompt: "Look at the folder (it may be empty), then use the AskUserQuestion tool to ask me which colour I prefer for the main button: Red, Green or Blue, each with a one-line description. After I answer, write button.txt containing the answer, then reply with exactly ANSWER=<my answer>." });
  await ev(`(()=>{ GENUI.S.plans.unshift({ title: "Landing page refresh", goal: "Refresh the landing page", cwd: ${JSON.stringify(SANDBOX)}, steps: [{label:"Agree the copy",harness:"you"},{label:"Pick a button colour",harness:"claude"},{label:"Build the page",harness:"codex"},{label:"QA in the browser",harness:"claude"}], started: [null, ${JSON.stringify(s.id)}], done: [true], answers: {} }); GENUI.openLive(${JSON.stringify(s.id)}); })()`);
  check("agent view: the real terminal is the main pane", await waitFor(`!document.getElementById('termwrap').hidden && document.querySelector('.main').classList.contains('agent')`, 10000));
  check("rail shows the plan with this step current", await waitFor(`/step 2 of 4/.test(document.querySelector('#railpane .pl-count')?.textContent||'') && !!document.querySelector('#railpane .pl-row.current')`, 10000));
  await sleep(4000); await shot("working");
  const trust = await waitFor(`!!document.querySelector('#railpane button.pl-now.needs') || GENUI.current().state === 'run'`, 60000);
  // Folder trust in a fresh scratch folder: it shows as the step needing you; open it and trust.
  if (await ev(`/Trust/.test(document.querySelector('#railpane button.pl-now.needs')?.textContent||'')`)) {
    await clickSel("#railpane button.pl-now.needs"); await sleep(300); await shot("trust");
    await clickSel("#railpane [data-act=term-yes]");
  }
  check("working step is blue while the agent works", trust && await waitFor(`!!document.querySelector('#railpane .pl-row.current.run') || !!document.querySelector('#railpane .pl-row.current.needs')`, 30000));
  // The question opens in Claude Code's own menu; the step turns amber and says so.
  check("question: the step turns amber", await waitFor(`!!document.querySelector('#railpane .pl-row.current.needs') && /Asking/.test(document.querySelector('#railpane button.pl-now.needs')?.textContent||'')`, 150000));
  check("Claude Code's own menu is in the terminal", await waitFor(`/Type something/.test(document.querySelector('.xterm-rows')?.textContent||'')`, 10000));
  await sleep(600); await shot("needs-you");
  await clickSel("#railpane button.pl-now.needs");
  check("clicking the step opens the question with Discuss it", await waitFor(`!!document.querySelector('#railpane .at-q [data-act=discuss-ask]')`, 5000));
  await sleep(400); await shot("question-open");
  await clickSel("#railpane [data-act=discuss-ask]");
  check("side chat opens in the rail", await waitFor(`!!document.querySelector('#railpane .sp-head') && document.getElementById('panel').hidden`, 5000));
  check("side chat opener arrives", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 1`, 180000));
  await sleep(400); await shot("side-open");
  await clickSel("#sp-in"); await typeText("It is a calm wellness brand. I am torn between green and a soft teal. Which fits better?");
  await clickSel("[data-act=side-msg]");
  check("side reply", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 2`, 180000));
  await clickSel("[data-act=side-compose]");
  check("composed answer", await waitFor(`(document.getElementById('sp-composed')||{}).value?.length > 3`, 180000));
  await sleep(300); await shot("side-composed");
  const answer = await ev(`document.getElementById('sp-composed').value`);
  await clickSel("[data-act=side-use-composed]");
  check("side chat closes back to the plan", await waitFor(`!document.querySelector('#railpane .sp-head') && !!document.querySelector('#railpane .pl-scroll')`, 30000));
  let got = false;
  for (let i = 0; i < 120 && !got; i++) { await sleep(1000); const cur = (await api("/api/state")).live.find((x) => x.id === s.id); got = !!(cur.file && fs.existsSync(cur.file) && /ANSWER=/.test(fs.readFileSync(cur.file, "utf8"))); }
  check(`Claude received the side chat's answer through its own menu ("${String(answer).slice(0, 50)}")`, got);
  await sleep(4000); await shot("after-answer");
  // Orchestrator lists the running agent with its progress.
  await clickSel("#side [data-act=go][data-page=overview]");
  check("Orchestrator lists the running agent", await waitFor(`!!document.getElementById(${JSON.stringify("ov-" + s.id)})`, 5000));
  check("Orchestrator has no saved-session history", await ev(`!document.querySelector('[id^=ovs-]')`));
  await sleep(500); await shot("orchestrator");
  await api(`/api/sessions/${s.id}/stop`, {});
} catch (e) { console.log("FAIL exception " + e.message); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill(); setTimeout(() => process.exit(0), 600);
}
