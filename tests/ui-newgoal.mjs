// Drive the New goal page like a person: open the folder picker, browse into a folder, use it,
// type a goal, and press Start now (and Plan it). Run: node tests/ui-newgoal.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4393, CDP = 9339;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const TARGET = path.join(ROOT, "sandbox", "newgoal-" + Date.now());
fs.mkdirSync(TARGET, { recursive: true });
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-ng-" + Date.now())}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(300); } return false; };
// Real mouse clicks at an element's centre, the way a person clicks (not element.click()).
const clickSel = async (sel) => {
  const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height};})()`);
  if (!box || !box.w) { errors.push("not clickable: " + sel); return false; }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
};
const typeText = async (text) => { await cdp("Input.insertText", { text }); };

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
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/?c=${code}` });
  check("app loaded", await waitFor(`!!document.querySelector('#side .srow-new')`));
  await clickSel("#side .srow-new");
  check("new goal page", await waitFor(`!!document.getElementById('ng-goal')`));
  await shot("ng-01-page");
  // Folder picker
  await clickSel("#ng-folder");
  check("picker opens", await waitFor(`!!document.querySelector('.picker .pk-item')`, 8000));
  const pickerBox = await ev(`(()=>{const r=document.querySelector('.picker')?.getBoundingClientRect(); return r && {top:r.top,bottom:r.bottom,left:r.left,h:innerHeight};})()`);
  check(`picker fully on screen ${JSON.stringify(pickerBox)}`, pickerBox && pickerBox.top >= 0 && pickerBox.bottom <= pickerBox.h);
  await shot("ng-02-picker");
  check(`recent projects listed (${await ev(`document.querySelectorAll('.pk-recent .pk-item').length`)})`, (await ev(`document.querySelectorAll('.pk-recent .pk-item').length`)) >= 1);
  // The picker opens at your most recent project; go to the GitHub folder first.
  await ev(`(()=>{const i=document.getElementById('pk-path'); i.focus(); i.select();})()`);
  await typeText(path.join(os.homedir(), "Documents", "GitHub"));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitFor(`!!document.querySelector('.picker .pk-open[data-d="GenUI Agent"]')`, 8000);
  // Browse: GitHub -> › GenUI Agent -> › sandbox, then click the target folder to choose it.
  for (const name of ["GenUI Agent", "sandbox"]) {
    const ok = await clickSel(`.picker .pk-open[data-d="${name}"]`);
    check(`look inside ${name}`, ok && (await waitFor(`(document.getElementById('pk-path')||{}).value?.endsWith(${JSON.stringify(name)})`, 8000)));
  }
  await shot("ng-03-picker-in");
  await clickSel(`.picker .pk-item[data-act=pk-pick][data-p$=${JSON.stringify(path.basename(TARGET))}]`);
  check("clicking a folder chooses it", await waitFor(`!document.querySelector('.picker') && (document.querySelector('#ng-folder')||{}).textContent?.includes(${JSON.stringify(path.basename(TARGET))})`, 5000));
  await shot("ng-04-folder-set");
  // The path box: a folder of projects (GitHub) warns instead of being used.
  const GITHUB = path.join(os.homedir(), "Documents", "GitHub");
  const typePath = async (p) => { await ev(`(()=>{const i=document.getElementById('pk-path'); i.focus(); i.select();})()`); await typeText(p); };
  await clickSel("#ng-folder");
  await waitFor(`!!document.getElementById('pk-path')`, 8000);
  await typePath(GITHUB);
  await clickSel(".picker .pk-head [data-act=pk-use]");
  check("a folder of projects warns instead of being used", await waitFor(`!!document.querySelector('.pk-warn')`, 5000) && (await ev(`!document.querySelector('#ng-folder').textContent.includes('GitHub')`)));
  // Paste a path and press Use this folder straight away, no Enter: the typed path is used.
  await typePath(path.join(ROOT, "sandbox"));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  check("Enter in the path box browses there", await waitFor(`!!document.querySelector('.picker .pk-open[data-d=${JSON.stringify(path.basename(TARGET))}]')`, 8000));
  await typePath(TARGET);
  await clickSel(".picker .pk-head [data-act=pk-use]");
  check("a typed path is used without pressing Enter", await waitFor(`!document.querySelector('.picker') && (document.querySelector('#ng-folder')||{}).textContent?.includes(${JSON.stringify(path.basename(TARGET))})`, 5000));
  // Type a goal, press Start now
  await clickSel("#ng-goal");
  await typeText("Reply with exactly: STARTED_FROM_UI");
  check("goal typed", (await ev(`document.getElementById('ng-goal').value`)) === "Reply with exactly: STARTED_FROM_UI");
  await clickSel("[data-act=start-now]");
  check("Start now opens a live session", await waitFor(`!!(window.GENUI && GENUI.current() && GENUI.current().kind === 'live')`, 15000));
  await shot("ng-05-started");
  const sid = await ev(`GENUI.current() && GENUI.current().id`);
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) {
    await sleep(1000);
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { "x-genui-token": TOKEN } })).json();
    const cur = st.live.find((x) => x.id === sid);
    if (cur && cur.terminalNeeds) await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sid}/terminal`, { method: "POST", headers: { "content-type": "application/json", "x-genui-token": TOKEN }, body: JSON.stringify({ choice: "yes" }) });
    if (cur && cur.file && fs.existsSync(cur.file) && fs.readFileSync(cur.file, "utf8").includes("STARTED_FROM_UI")) ok = true;
  }
  check("the started session ran the goal (reply in its transcript)", ok);
  await shot("ng-06-ran");
  if (sid) await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sid}/stop`, { method: "POST", headers: { "content-type": "application/json", "x-genui-token": TOKEN }, body: "{}" });
  // Plan it path: folder remembered, send the goal for planning.
  await clickSel("#side .srow-new"); await waitFor(`!!document.getElementById('ng-goal')`);
  await clickSel("#ng-goal"); await typeText("Create two text files, a.txt and b.txt, each with one line of text.");
  await clickSel("[data-act=plan]");
  check("planning starts", await waitFor(`!!document.getElementById('planning') || !!document.getElementById('plan-card')`, 8000));
  check("a plan arrives", await waitFor(`!!document.getElementById('plan-card')`, 240000));
  await shot("ng-07-plan");
} catch (e) { console.log("FAIL exception " + e.message); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill(); setTimeout(() => process.exit(0), 600);
}
