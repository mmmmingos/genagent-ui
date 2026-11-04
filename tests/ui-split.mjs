// Split view and small windows: two sessions side by side, each with its own terminal; the sidebar
// fills the pane you're in; in a narrow pane the rail folds into a header button and opens as a
// drawer; a session can open in its own window; closing a pane goes back to the single view.
// Real Claude Code sessions in sandbox/, own port and data folder. Run: node tests/ui-split.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "sandbox", "shots", "split");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4392, CDP = 9334, STAMP = Date.now();
const DATA = path.join(ROOT, "sandbox", "data-" + STAMP), SB = path.join(ROOT, "sandbox", "split-" + STAMP);
for (const d of ["a", "b"]) { fs.mkdirSync(path.join(SB, d, ".claude"), { recursive: true }); fs.writeFileSync(path.join(SB, d, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Write", "Edit", "Read"] } })); }
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1", GENUI_DATA: DATA, GENUI_SAVED_ROOT: SB };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => process.stderr.write("[server] " + d));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), "genui-split-" + STAMP)}`, "--hide-scrollbars", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push("eval: " + expr.slice(0, 80) + " -> " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result?.value; };
let n = 0; const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64")); };
let failed = 0; const check = (label, ok) => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + label); return ok; };
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(400); } return false; };
const click = (expr) => ev(`(()=>{ const e = ${expr}; if (!e) return false; e.click(); return true; })()`);
let TOKEN = "", H = {};
const api = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H })).json();
// Inside pane i's iframe.
const inPane = (i, expr) => `(()=>{ const f = document.querySelector('#pane-${i} iframe'); if (!f || !f.contentWindow || !f.contentWindow.GENUI) return null; const d = f.contentDocument, G = f.contentWindow.GENUI; return ${expr}; })()`;

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await sleep(250); } }
  TOKEN = fs.readFileSync(path.join(DATA, "token"), "utf8").trim(); H = { "content-type": "application/json", "x-genui-token": TOKEN };
  let wsUrl; for (let i = 0; i < 40 && !wsUrl; i++) { try { const t = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {} await sleep(250); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push("page: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/?c=${code}` });
  check("app loaded", await waitFor(`!!document.querySelector('#side .srow-new')`));
  const a = await api("/api/sessions", { harness: "claude", cwd: path.join(SB, "a"), model: "sonnet", prompt: "Write notes.md with one line: hello. Then end your turn by asking me in plain text (no tools): Should I add a second line?" });
  const b = await api("/api/sessions", { harness: "claude", cwd: path.join(SB, "b"), model: "sonnet", prompt: "Reply with exactly one short sentence saying you are ready. Use no tools." });
  await ev(`GENUI.openLive(${JSON.stringify(a.id)})`);
  check("a session has Split and Open in its own window in its header", await waitFor(`!!document.querySelector('.head [data-act=split]') && !!document.querySelector('.head [data-act=pop-out]')`, 8000));
  await click(`document.querySelector('.head [data-act=split]')`);
  check("Split: two panes, the session on the left, an empty one on the right", await waitFor(`document.querySelectorAll('.pane').length === 2 && !!document.querySelector('#pane-0 iframe') && !!document.querySelector('#pane-1 .pane-empty')`, 5000));
  check("the left pane is the session alone: its own terminal, no sidebar", await waitFor(inPane(0, `G.S.page === 'session' && !d.getElementById('termwrap').hidden && getComputedStyle(d.getElementById('side')).display === 'none'`), 15000));
  await shot("split-empty");
  await click(`document.getElementById(${JSON.stringify("sr-" + b.id)})`);
  check("the sidebar fills the pane you're in", await waitFor(`!!document.querySelector('#pane-1 iframe') && GENUI.S.panes[1] === ${JSON.stringify(b.id)}`, 5000));
  check("both terminals run side by side", await waitFor(inPane(1, `!d.getElementById('termwrap').hidden && d.querySelector('.xterm-rows') && /\\S/.test(d.querySelector('.xterm-rows').textContent)`), 60000));
  check("a pane is narrow: no meta line, the rail folded away", await waitFor(inPane(0, `d.querySelector('.main').classList.contains('narrow')`), 5000));
  // Clicking into a pane makes it the one the sidebar fills.
  await ev(inPane(0, `d.querySelector('.head').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) || true`));
  check("clicking a pane focuses it", await waitFor(`GENUI.S.paneFocus === 0 && document.getElementById('pane-0').classList.contains('on')`, 3000));
  // Pane A's turn ends on a question: its header shows Needs from you; it opens as a drawer.
  check("in a narrow pane, what it needs is a header button", await waitFor(inPane(0, `/Needs/.test(d.querySelector('.railbtn')?.textContent || '')`), 240000));
  await sleep(800); await shot("split-needs-button");
  await ev(inPane(0, `d.querySelector('.railbtn').click() || true`));
  check("the button opens the rail over the terminal", await waitFor(inPane(0, `d.querySelector('.main').classList.contains('railopen') && getComputedStyle(d.getElementById('railpane')).display !== 'none' && !!d.querySelector('#railpane .need')`), 5000));
  await sleep(500); await shot("split-drawer");
  // Its own window.
  const before = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === "page").length;
  // A real click (a new window needs one): the button's place inside pane 1's frame.
  const at = await ev(`(()=>{ const f = document.querySelector('#pane-1 iframe'), r = f.getBoundingClientRect(), b = f.contentDocument.querySelector('[data-act=pane-pop]').getBoundingClientRect(); return { x: r.left + b.left + b.width / 2, y: r.top + b.top + b.height / 2 }; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  await sleep(1500);
  const pages = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === "page");
  check("Open in its own window: a new window shows that session alone", pages.length === before + 1 && pages.some((t) => t.url.endsWith("#pane/" + b.id)));
  check("and it leaves the split (never shown twice)", await waitFor(`!GENUI.S.panes.includes(${JSON.stringify(b.id)})`, 3000));
  await shot("after-pop");
  // Close the empty pane: one session left, back to the normal view.
  await click(`document.querySelector('[data-act=pane-x]')`);
  check("closing down to one pane goes back to the normal view of it", await waitFor(`GENUI.S.page === 'session' && GENUI.S.sel.id === ${JSON.stringify(a.id)} && !document.querySelector('.panes')`, 5000));
  // A narrow main window folds the rail too.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 860, deviceScaleFactor: 1, mobile: false });
  check("a small window folds the rail into the header", await waitFor(`document.querySelector('.main').classList.contains('narrow') && !!document.querySelector('.head .railbtn')`, 5000));
  await sleep(500); await shot("small-window");
  for (const s of [a, b]) await api(`/api/sessions/${s.id}/stop`, {});
} catch (e) { failed++; console.log("FAIL exception " + e.stack); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  console.log(failed ? `${failed} failed` : "all passed");
  try { ws.close(); } catch {}
  chrome.kill(); srv.kill();
  // The scratch sessions and their transcripts go; the screenshots stay.
  setTimeout(() => {
    for (const d of ["a", "b"]) fs.rmSync(path.join(os.homedir(), ".claude", "projects", path.join(SB, d).replace(/[^A-Za-z0-9]/g, "-")), { recursive: true, force: true });
    fs.rmSync(SB, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }, 1500);
}
