// End-to-end: the flow updates during a long turn, grows when more work is asked for,
// and keeps finished steps as they were. Real Claude Code session in sandbox/.
// Run: node tests/e2e-flow.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4394;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1", GENUI_MIDTURN_SEC: "20", GENUI_MIDTURN_TOOLS: "4" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);
const dir = path.join(ROOT, "sandbox", "flow-" + Date.now());
fs.mkdirSync(dir, { recursive: true });
const nk = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let ws;
try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  const cookie = ((await fetch(`http://127.0.0.1:${PORT}/?c=${code}`, { redirect: "manual" })).headers.get("set-cookie") || "").split(";")[0];
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const gens = [];
  let sid = null, status = null;
  ws.on("message", (m) => {
    const j = JSON.parse(m);
    if (j.type === "session" && j.session.id === sid) status = j.session.status;
    if (j.type === "gen" && j.id === sid) { gens.push({ statusAtArrival: status, midTurn: !!j.gen.midTurn, steps: j.gen.steps, at: Date.now() }); console.log(`  gen #${gens.length}${j.gen.midTurn ? " (mid-turn)" : ""}: ${j.gen.steps.map((s) => `${s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"} ${s.label}`).join(" | ")}`); }
  });
  await new Promise((r) => ws.on("open", r));

  const step = (i) => `Step ${i}: run the shell command "ping -n 8 127.0.0.1" (it just waits a few seconds), then create the file step-${i}.txt containing "${i}".`;
  const s = await api("/api/sessions", { harness: "claude", cwd: dir, model: "sonnet", name: "flow test",
    prompt: `Do these steps strictly one at a time, in order, without asking me anything:\n${[1, 2, 3, 4, 5].map(step).join("\n")}\nWhen all are done, reply with exactly: BATCH1 DONE` });
  sid = s.id;
  const waitTurn = async (marker, ms) => {
    for (let t = 0; t < ms / 1000; t++) {
      await sleep(1000);
      const cur = (await api("/api/state")).live.find((x) => x.id === sid);
      if (cur.terminalNeeds) await api(`/api/sessions/${sid}/terminal`, { choice: "yes" });
      if (cur.pendingPermission) await api(`/api/sessions/${sid}/permission`, { qid: cur.pendingPermission.id, allow: true });
      if (cur.file && fs.existsSync(cur.file) && fs.readFileSync(cur.file, "utf8").includes(marker) && cur.status === "idle") return true;
    }
    return false;
  };
  check("batch 1 finished", await waitTurn("BATCH1 DONE", 420000));
  // Wait for the turn-end generation.
  for (let t = 0; t < 90 && !gens.some((g) => !g.midTurn && g.at > 0 && g.statusAtArrival !== "working"); t++) await sleep(1000);
  const mids = gens.filter((g) => g.midTurn);
  check(`flow refreshed during the turn (${mids.length} mid-turn updates)`, mids.length >= 1);
  const after1 = [...gens].reverse().find((g) => !g.midTurn);
  check("turn-end flow arrived", !!after1);

  // Ask for more work: the flow should grow and keep what's done.
  const n1 = gens.length;
  await api(`/api/sessions/${sid}/send`, { text: `Now do three more steps the same way, one at a time:\n${[6, 7, 8].map(step).join("\n")}\nWhen done, reply with exactly: BATCH2 DONE` });
  check("batch 2 finished", await waitTurn("BATCH2 DONE", 360000));
  for (let t = 0; t < 90 && !gens.slice(n1).some((g) => !g.midTurn && g.statusAtArrival !== "working"); t++) await sleep(1000);
  const after2 = [...gens].reverse().find((g) => !g.midTurn);
  if (after1 && after2) {
    const done1 = after1.steps.filter((s) => s.state === "done").map((s) => s.label);
    const labels2 = after2.steps.map((s) => s.label);
    check(`finished steps kept as they were (${done1.length} of them)`, done1.every((l, i) => labels2[i] === l));
    check(`flow grew: ${after1.steps.length} -> ${after2.steps.length} steps`, after2.steps.length > after1.steps.length || after2.steps.filter((s) => s.state === "done").length > done1.length);
    // Across every update, a step once done never went missing.
    let ok = true, seen = [];
    for (const g of gens) { const ls = new Set(g.steps.map((s) => nk(s.label))); if (!seen.every((x) => ls.has(x))) ok = false; seen = [...new Set([...seen, ...g.steps.filter((s) => s.state === "done").map((s) => nk(s.label))])]; }
    check("no finished step ever disappeared across updates", ok);
  }
  await api(`/api/sessions/${sid}/stop`, {});
} catch (e) { console.log("FAIL exception " + e.message); }
finally { try { ws.close(); } catch {} srv.kill(); setTimeout(() => process.exit(0), 500); }
