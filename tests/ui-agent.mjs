// Drive version 1 like a person, on a real Claude Code session in sandbox/: the agent asks two
// questions in its reply; you answer one and send; the other stays on "Needs from you", marked as
// still open; Discuss it opens a side chat whose answer goes into your reply; a question in Claude
// Code's own menu is answered from the rail (GenUI presses Esc once and types the answer); steps open
// to show what they touched; coming back shows what happened while you were away; the Orchestrator
// shows each agent's Did / Needs lines and All needs. Run: node tests/ui-agent.mjs [outDir]
// Uses its own port and data folder, so a running GenUI Agent is never touched.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots", "agent");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4388, CDP = 9333;
const STAMP = Date.now(), DATA = path.join(ROOT, "sandbox", "data-" + STAMP);
const SANDBOX = path.join(ROOT, "sandbox", "agent-" + STAMP);
fs.mkdirSync(path.join(SANDBOX, ".claude"), { recursive: true });
// This scratch folder lets the agent write files and run node without asking, so the run is about GenUI.
fs.writeFileSync(path.join(SANDBOX, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Write", "Edit", "Read", "Bash(node:*)"] } }, null, 2));
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1", GENUI_DATA: DATA };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-agent-" + STAMP)}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
let n = 0; const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64")); };
let failed = 0; const check = (label, ok) => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + label); return ok; };
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(400); } return false; };
const clickSel = async (sel) => {
  const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:"center"}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width};})()`);
  if (!box || !box.w) { errors.push("not clickable: " + sel); return false; }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
};
const typeText = (text) => cdp("Input.insertText", { text });
let TOKEN = "", H = {};
const api = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H })).json();
const S = (expr) => ev(`(()=>{ const S = GENUI.S, r = GENUI.current(); return ${expr}; })()`);
const needCount = () => S(`document.querySelectorAll('#railpane .need:not(.done):not(.block)').length`);
const transcriptHas = async (sid, re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const cur = (await api("/api/state")).live.find((x) => x.id === sid); if (cur && cur.file && fs.existsSync(cur.file) && re.test(fs.readFileSync(cur.file, "utf8"))) return true; await sleep(1000); } return false; };
const turnOver = (sid, ms) => waitFor(`(()=>{ const l = GENUI.S.live.get(${JSON.stringify(sid)}); return l && l.status === 'idle' && !GENUI.S.genBusy.has(l.file); })()`, ms);

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await sleep(250); } }
  TOKEN = fs.readFileSync(path.join(DATA, "token"), "utf8").trim(); H = { "content-type": "application/json", "x-genui-token": TOKEN };
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

  // 1. A turn that ends on two questions in plain text.
  const s = await api("/api/sessions", { harness: "claude", cwd: SANDBOX, model: "sonnet", name: "Pricing plans",
    prompt: "In this folder, write plans.md listing three plans (Starter $19, Pro $49, Business $129) one per line. Then run: node -e \"console.log('plans ok')\". Then end your turn by asking me two separate questions in plain text (do not use the AskUserQuestion tool): 1. Which plan should be highlighted as most popular? 2. What yearly discount should we show: 20% off, or 2 months free? Whenever I reply later, do only what I say, then end your turn with a one-line summary and no questions, unless I ask for one." });
  await ev(`GENUI.openLive(${JSON.stringify(s.id)})`);
  check("agent view: the real terminal beside the rail", await waitFor(`!document.getElementById('termwrap').hidden && document.querySelector('.main').classList.contains('agent')`, 10000));
  // Folder trust in a fresh scratch folder shows as a card in Needs from you.
  if (await waitFor(`!!document.querySelector('#railpane [data-act=term-yes]')`, 25000)) { await shot("trust"); await clickSel("#railpane [data-act=term-yes]"); }
  // A quick turn can be over before the first look, so either a blue step or the ended turn counts.
  check("the timeline has your message and the step it's on", await waitFor(`!!document.querySelector('#railpane .trow.goal') && !!document.querySelector('#railpane .nd.run, #railpane .nd.turn, #railpane .nd.needs')`, 90000));
  await sleep(1500); await shot("working");
  check("the turn ends and the AI layer reads it", await turnOver(s.id, 240000));
  check("Needs from you: both questions from its reply", await waitFor(`document.querySelectorAll('#railpane .need:not(.done):not(.block)').length >= 2`, 60000));
  check("each step can be opened: Touched plans.md with its line count", await (async () => {
    await clickSel(`#railpane .trow.step[data-step^="t"]`);
    return waitFor(`/plans\\.md/.test(document.querySelector('#railpane .tdetail')?.textContent||'') || /node/.test(document.querySelector('#railpane .tdetail')?.textContent||'')`, 5000);
  })());
  await sleep(400); await shot("needs-two");

  // 2. Answer only the plan question, and send.
  await ev(`(()=>{ const c = [...document.querySelectorAll('#railpane .need:not(.done):not(.block)')].find((x) => /popular|highlight/i.test(x.querySelector('.nq').textContent)); c.id = 'plan-q'; })()`);
  const first = await S(`document.querySelector('#plan-q .npill[data-v^="Pro"]') ? 'pill' : 'text'`);
  if (first === "pill") await clickSel(`#plan-q .npill[data-v^="Pro"]`);
  else { await clickSel("#plan-q .npill.else"); await sleep(200); await clickSel("#plan-q .elsein"); await typeText("Pro"); }
  check("the answer gathers in your reply", await waitFor(`/About your question/.test(document.querySelector('#railpane .replytext')?.value||'')`, 5000));
  check("Send is ready, and says 1 of 2 answered", await S(`!document.getElementById('sendbtn').disabled && /1\\/2/.test(document.querySelector('#railpane .reply .rh')?.textContent||'')`));
  await shot("one-answered");
  await clickSel("#sendbtn");
  check("sent: the answered question shows as done", await waitFor(`!!document.querySelector('#railpane .need.done')`, 10000));
  check("Claude Code received the reply as your next message", await transcriptHas(s.id, /About your question/, 20000));
  // Step away while it works: the Orchestrator records what you have seen.
  await clickSel(`#side [data-act=go][data-page=overview]`);
  check("Orchestrator: the agent's row", await waitFor(`!!document.getElementById(${JSON.stringify("ov-" + s.id)})`, 5000));
  check("the turn ends", await turnOver(s.id, 240000));
  check("Orchestrator row: Did and Needs lines, and new steps since you looked", await waitFor(`(()=>{ const r = document.getElementById(${JSON.stringify("ov-" + s.id)}); return r && /Did/.test(r.textContent) && /Needs/.test(r.textContent) && !!r.querySelector('.newchip') && !!r.querySelector('svg'); })()`, 60000));
  await sleep(500); await shot("orchestrator");
  await clickSel(`[data-act=dash-tab][data-tab=needs]`);
  check("All needs lists the question you skipped", await waitFor(`document.querySelectorAll('.nitem').length >= 1`, 5000));
  await shot("all-needs");

  // 3. Back in the session: what happened while you were away, and the skipped question still open.
  await clickSel(`.nitem`);
  check("the item opens its session", await waitFor(`GENUI.S.page === 'session' && GENUI.S.sel.id === ${JSON.stringify(s.id)}`, 5000));
  check("Since you were away: new steps are highlighted", await waitFor(`!!document.querySelector('#railpane .awayrow') && !!document.querySelector('#railpane .trow .nw')`, 5000));
  check("the skipped question is still on the list, marked as open since before your reply", await waitFor(`document.querySelectorAll('#railpane .need:not(.done):not(.block)').length === 1 && !!document.querySelector('#railpane .need .old')`, 30000));
  await sleep(400); await shot("still-open");

  // 4. Discuss it: a side chat with its own agent; Answer with this writes into your reply.
  await ev(`[...document.querySelectorAll('#railpane .need:not(.done):not(.block)')].find((x) => /discount/i.test(x.textContent)).id = 'disc-q'`);
  await clickSel("#disc-q [data-act=need-discuss]");
  check("Discuss it opens a side chat with the question pinned", await waitFor(`!!document.querySelector('#railpane .sp-head') && /discount/i.test(document.querySelector('#railpane .sp-q')?.textContent||'')`, 5000));
  await shot("side-open");
  await clickSel("#sp-in"); await typeText("Our prices are whole dollars. Which discount keeps the yearly prices round?");
  await clickSel("[data-act=side-msg]");
  check("the side agent (a fork of the session) replies", await waitFor(`document.querySelectorAll('#railpane .sp-ai').length >= 1`, 240000));
  await shot("side-reply");
  await clickSel("[data-act=side-answer]");
  check("Answer with this: back on the rail, the answer is in your reply", await waitFor(`!document.querySelector('#railpane .sp-head') && /discount/i.test(document.querySelector('#railpane .replytext')?.value||'')`, 180000));
  check("the question says it was worked out on the side", await S(`/Worked out on the side/.test(document.querySelector('#railpane .need:not(.done)')?.textContent||'')`));
  await shot("answer-from-side");
  // Add a request of your own to the reply: a question in Claude Code's own menu.
  await ev(`(()=>{ const t = document.querySelector('#railpane .replytext'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()`);
  await typeText("\nNow use the AskUserQuestion tool to ask me one question: which colour should the buy button be, Red or Blue?");
  await clickSel("#sendbtn");
  check("the discussion is kept under the timeline", await waitFor(`!!document.querySelector('#railpane .pl-side')`, 10000));

  // 5. A question in Claude Code's own menu, answered from the rail.
  check("its menu question shows in Needs from you", await waitFor(`!!GENUI.current().l.pendingAsk && /colou?r/i.test(document.querySelector('#railpane .need:not(.done):not(.block)')?.textContent||'') && !document.querySelector('#railpane .need.block')`, 180000));
  await sleep(500); await shot("menu-question");
  await clickSel(`#railpane .need:not(.done) .npill[data-v="Blue"]`);
  check("the reply notes GenUI will close the menu first", await waitFor(`/Esc/.test(document.querySelector('#railpane .reply .note')?.textContent||'')`, 3000));
  await clickSel("#sendbtn");
  check("GenUI closed the menu (one Esc) and sent the answer", await waitFor(`!GENUI.current().l.pendingAsk`, 20000));
  check("Claude Code received it as your next message", await transcriptHas(s.id, /Blue/, 20000));
  check("its turn ends", await turnOver(s.id, 240000));
  await sleep(1000); await shot("after-menu");
  check("nothing else needs you", await waitFor(`document.querySelectorAll('#railpane .need:not(.done)').length === 0`, 60000));

  // Dark mode, then Stop.
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await sleep(400); await shot("dark");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await clickSel("[data-act=stop-ask]");
  check("Stop asks first", await waitFor(`!!document.querySelector('.stop-pop')`, 3000));
  await clickSel(".stop-pop [data-act=stop-session]");
  check("the ended session offers Resume, New session here and Close", await waitFor(`/Session (ended|stopped)/.test(document.getElementById("tend")?.textContent||'') && !!document.querySelector('#tend [data-act=session-close]')`, 10000));
  await clickSel("#tend [data-act=session-close]");
  check("Close removes it from the running list", await waitFor(`!GENUI.S.live.has(${JSON.stringify(s.id)}) && GENUI.S.page === 'overview'`, 8000));
} catch (e) { failed++; console.log("FAIL exception " + e.stack); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  console.log(failed ? `${failed} failed` : "all passed");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill(); setTimeout(() => process.exit(failed ? 1 : 0), 600);
}
