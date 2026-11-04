// The owner's journey, end to end, with real clicks and typing: start a session with a first
// message (no plan in the way), watch the flowchart build, answer Claude's question with help from a
// side chat, type a follow-up in the real terminal, see the flowchart branch, check the Orchestrator.
// Run: node tests/ui-journey.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots", "journey");
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const PORT = 4386, CDP = 9331;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const DIR = path.join(ROOT, "sandbox", "journey-" + Date.now());
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, "notes.md"), "# Brew Club\nA monthly coffee subscription that ships small-batch beans from local roasters.\n");
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-journey-" + Date.now())}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
let n = 0; const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64")); };
const T0 = Date.now(); const ts = () => `${Math.round((Date.now() - T0) / 1000)}s`;
const check = (label, ok) => console.log(`${ok ? "PASS" : "FAIL"} [${ts()}] ${label}`);
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(400); } return false; };
const clickSel = async (sel) => {
  const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width};})()`);
  if (!box || !box.w) { errors.push("not clickable: " + sel); return false; }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
};
const typeText = (text) => cdp("Input.insertText", { text });
const enter = async () => { for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined }); };
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const state = async (sid) => (await (await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: H })).json()).live.find((x) => x.id === sid);
const goals = (sel) => `[...document.querySelectorAll('${sel} .tn.goal > .th .tl')].map(e=>e.textContent)`;

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
  await shot("home");

  // 1. New session: pick the folder, type the first message, press Enter. Claude should just start.
  await clickSel("#side .srow-new");
  await waitFor(`!!document.getElementById('ng-goal')`);
  await clickSel("#ng-folder"); await waitFor(`!!document.getElementById('pk-path')`, 8000);
  await ev(`(()=>{const i=document.getElementById('pk-path'); i.focus(); i.select();})()`); await typeText(DIR);
  await clickSel(".picker .pk-head [data-act=pk-use]");
  await waitFor(`(document.querySelector('#ng-folder')||{}).textContent?.includes('journey-')`, 5000);
  await clickSel("#ng-goal");
  await typeText("Read notes.md and sum it up in one sentence. Then use your AskUserQuestion tool to ask me which audience the landing page should target: developers, designers or founders.");
  await shot("first-message");
  await enter();
  check("Enter starts Claude Code straight away (no plan step)", await waitFor(`!!(GENUI.current() && GENUI.current().kind === 'live') && !document.getElementById('plan-card') && !document.getElementById('planning')`, 15000));
  const sid = await ev(`GENUI.current().id`);
  check("the first message reached Claude exactly as typed", await waitFor(`/Read notes\\.md and sum it up/.test(document.querySelector('.xterm-rows')?.textContent||'')`, 30000));
  // Folder trust in a fresh folder, if asked: open the amber step and trust.
  for (let i = 0; i < 30; i++) { if (await ev(`/Trust/.test(document.querySelector('#railpane button.pl-now.needs')?.textContent||'')`)) { await clickSel("#railpane button.pl-now.needs"); await sleep(300); await clickSel("#railpane [data-act=term-yes]"); break; } if (await ev(`GENUI.current().state === 'run'`)) break; await sleep(1000); }
  check("instant flowchart shows the goal from the first message within seconds", await waitFor(`${goals("#railpane")}.some(t => /notes\\.md/i.test(t))`, 20000));
  check("Ask on the side is there any time; + starts a new session in this folder", await ev(`!!document.querySelector('#railpane [data-act=aside]') && !!document.querySelector('[data-act=new-here]')`));
  await sleep(1500); await shot("working");

  // 2. Claude asks in its own menu; the step turns amber; Discuss it; the answer goes into the menu.
  check("Claude's question turns the step amber", await waitFor(`/Asking/.test(document.querySelector('#railpane button.pl-now.needs')?.textContent||'')`, 180000));
  check("Claude Code's own menu is in the terminal", await waitFor(`/Type something/.test(document.querySelector('.xterm-rows')?.textContent||'')`, 10000));
  await shot("question");
  await clickSel("#railpane button.pl-now.needs");
  await waitFor(`!!document.querySelector('#railpane [data-act=discuss-ask]')`, 5000);
  await shot("question-open");
  await clickSel("#railpane [data-act=discuss-ask]");
  check("Discuss it opens with the question pinned, ready to type", await waitFor(`!!document.querySelector('#railpane .sp-q') && !!document.getElementById('sp-in')`, 5000));
  await clickSel("#sp-in"); await typeText("We sell to people who love coffee but are busy. Developers or founders? Keep it short.");
  await clickSel("[data-act=side-msg]");
  check("the side agent, a copy of the session, replies", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 1`, 240000));
  await shot("side-chat");
  await clickSel("[data-act=side-answer]");
  check("Answer with this puts a draft under the question", await waitFor(`(document.querySelector('#railpane .at-draft textarea')||{}).value?.length > 3`, 180000));
  await shot("draft");
  await clickSel("#railpane [data-act=ask-send]");
  check("Send: GenUI closes the question, the answer goes in as your message, Claude carries on", await (async () => { for (let i = 0; i < 60; i++) { const s = await state(sid); const f = s && s.file && fs.existsSync(s.file) ? fs.readFileSync(s.file, "utf8") : ""; if (s && !s.pendingAsk && /About your question/.test(f)) return true; await sleep(1000); } return false; })());
  check("the discussion is kept under the flowchart", await waitFor(`!!document.querySelector('#railpane .pl-side')`, 10000));
  for (let i = 0; i < 240; i++) { const s = await state(sid); if (s && s.status === "idle") break; await sleep(1000); }
  await sleep(4000); await shot("answered");

  // 2b. Ask on the side: your own multi-step side conversation; what you work out can go in as a message.
  for (let i = 0; i < 240; i++) { const st = await state(sid); if (st && st.status === "idle") break; await sleep(1000); }
  await clickSel("#railpane [data-act=aside]");
  check("Ask on the side opens, ready to type", await waitFor(`!!document.querySelector('#railpane .sp-head') && /Ask on the side/.test(document.querySelector('#railpane .sp-head').textContent) && !!document.getElementById('sp-in')`, 5000));
  await clickSel("#sp-in"); await typeText("Which file did you read, and what is the business called? One line.");
  await clickSel("[data-act=side-msg]");
  check("the side agent replies", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 1`, 240000));
  await clickSel("#sp-in"); await typeText("Good. Now suggest one short slogan for it, five words at most.");
  await clickSel("[data-act=side-msg]");
  check("and keeps going for more than one message", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 2`, 240000));
  await shot("aside");
  await clickSel("[data-act=side-answer]");
  check("Write a message drafts it in the panel, editable", await waitFor(`(document.getElementById('sp-composed')||{}).value?.length > 3`, 180000));
  await shot("aside-draft");
  await clickSel("[data-act=aside-send]");
  check("Send puts it in as your next message", await (async () => { for (let i = 0; i < 30; i++) { const st = await state(sid); const f = st && st.file && fs.existsSync(st.file) ? fs.readFileSync(st.file, "utf8") : ""; if (/slogan/i.test(f.split("Good. Now suggest").pop() || "") || st.status === "working") return true; await sleep(1000); } return false; })());
  check("the aside is listed under the flowchart", await waitFor(`document.querySelectorAll('#railpane .pl-side').length >= 2`, 10000));
  for (let i = 0; i < 240; i++) { const st = await state(sid); if (st && st.status === "idle") break; await sleep(1000); }

  // 3. A follow-up typed into the real terminal: the flowchart branches.
  const g1 = (await ev(goals("#railpane"))).length;
  await ev(`document.querySelector('.xterm-helper-textarea').focus()`);
  await typeText("Now write tagline.txt with one tagline for that audience.");
  await sleep(400); await enter();
  check("typing in the real terminal works", await waitFor(`GENUI.current().state === 'run'`, 30000));
  check("the follow-up appears in the instant flowchart as a new branch", await waitFor(`${goals("#railpane")}.length > ${g1}`, 30000));
  await sleep(1500); await shot("follow-up");
  for (let i = 0; i < 120; i++) { const s = await state(sid); if (s && s.status === "idle" && fs.existsSync(path.join(DIR, "tagline.txt"))) break; await sleep(1000); }
  // The AI flowchart arrives after the turn; compare both.
  await waitFor(`!GENUI.S.genBusy.size`, 120000); await sleep(2500);
  await clickSel("#railpane [data-act=flow-mode][data-mode=ai]"); await sleep(600);
  const aiGoals = await ev(goals("#railpane"));
  check(`AI flowchart: ${JSON.stringify(aiGoals)}`, aiGoals.length >= 1);
  await shot("flow-ai");
  await clickSel("#railpane [data-act=flow-mode][data-mode=instant]"); await sleep(600);
  const instantGoals = await ev(goals("#railpane"));
  check(`Instant flowchart: ${JSON.stringify(instantGoals)}`, instantGoals.length >= 2);
  await shot("flow-instant");
  await clickSel("#railpane [data-act=flow-mode][data-mode=ai]");

  // 4. The Orchestrator lists the running agent and what it is doing.
  await clickSel("#side [data-act=go][data-page=overview]");
  check("Orchestrator lists the agent", await waitFor(`!!document.getElementById(${JSON.stringify("ov-" + sid)})`, 5000));
  await sleep(600); await shot("orchestrator");
  await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sid}/stop`, { method: "POST", headers: H, body: "{}" });
} catch (e) { console.log("FAIL exception " + e.message); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill(); setTimeout(() => process.exit(0), 600);
}
