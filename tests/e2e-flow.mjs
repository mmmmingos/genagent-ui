// End-to-end: the flowchart follows a conversation as it unfolds. It updates during a long turn,
// grows with new work, turns a change of direction into a new branch, and never rewrites what is
// settled. Real Claude Code session in sandbox/. Run: node tests/e2e-flow.mjs
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
const show = (tree) => { const kids = (p) => tree.nodes.filter((n) => n.parent === p); const out = []; const walk = (p, d) => kids(p).forEach((n) => { out.push(`    ${"  ".repeat(d)}${{ done: "✓", current: "●", next: "○", dropped: "✗" }[n.state]} ${n.kind === "goal" ? n.label.toUpperCase() : n.label}`); walk(n.id, d + 1); }); walk(null, 0); return out.join("\n"); };

let ws;
try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  const { code } = await (await fetch(`http://127.0.0.1:${PORT}/launch`, { method: "POST", headers: { "x-genui-token": TOKEN } })).json();
  const cookie = ((await fetch(`http://127.0.0.1:${PORT}/?c=${code}`, { redirect: "manual" })).headers.get("set-cookie") || "").split(";")[0];
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const gens = [];
  let sid = null;
  ws.on("message", (m) => {
    const j = JSON.parse(m);
    if (j.type === "gen" && j.id === sid && j.gen.tree) { gens.push({ midTurn: !!j.gen.midTurn, tree: j.gen.tree }); console.log(`  update #${gens.length}${j.gen.midTurn ? " (mid-turn)" : ""}:\n${show(j.gen.tree)}`); }
  });
  await new Promise((r) => ws.on("open", r));
  const step = (i) => `Step ${i}: run the shell command "ping -n 6 127.0.0.1" (it just waits a few seconds), then create the file step-${i}.txt containing "${i}".`;
  const s = await api("/api/sessions", { harness: "claude", cwd: dir, model: "sonnet", name: "flow test",
    prompt: `Do these steps strictly one at a time, in order, without asking me anything:\n${[1, 2, 3, 4].map(step).join("\n")}\nWhen all are done, reply with exactly: BATCH1 DONE` });
  sid = s.id;
  const waitTurn = async (marker, ms) => {
    for (let t = 0; t < ms / 1000; t++) {
      await sleep(1000);
      const cur = (await api("/api/state")).live.find((x) => x.id === sid);
      if (cur.terminalNeeds) await api(`/api/sessions/${sid}/terminal`, { choice: "yes" });
      if (cur.file && fs.existsSync(cur.file) && fs.readFileSync(cur.file, "utf8").includes(marker) && cur.status === "idle") return true;
    }
    return false;
  };
  const waitGen = async (from) => { for (let t = 0; t < 120 && !gens.slice(from).some((g) => !g.midTurn); t++) await sleep(1000); };
  check("turn 1 finished", await waitTurn("BATCH1 DONE", 420000));
  await waitGen(0);
  check(`flowchart refreshed during the turn (${gens.filter((g) => g.midTurn).length} mid-turn updates)`, gens.some((g) => g.midTurn));
  // Turn 2: a change of direction.
  const n1 = gens.length;
  await api(`/api/sessions/${sid}/send`, { text: "Change of plan: forget the step files. New task: write a short README.md for this folder (two sentences), then create notes/ideas.md with three bullet ideas for a coffee brand. When done, reply with exactly: PIVOT DONE" });
  check("turn 2 (a change of direction) finished", await waitTurn("PIVOT DONE", 300000));
  await waitGen(n1);
  // Turn 3: more work on the new direction.
  const n2 = gens.length;
  await api(`/api/sessions/${sid}/send`, { text: "Add a fourth idea to notes/ideas.md and a one-line tagline at the top of README.md. When done, reply with exactly: MORE DONE" });
  check("turn 3 finished", await waitTurn("MORE DONE", 300000));
  await waitGen(n2);
  const last = gens.at(-1)?.tree;
  if (last) {
    const goals = last.nodes.filter((n) => n.kind === "goal");
    check(`the change of direction is its own branch (${goals.length} goals: ${goals.map((g) => g.label).join(" / ")})`, goals.length >= 2);
    // Across every update: nodes are never removed, and settled ones never change.
    let kept = true, frozen = true;
    const settled = new Map();
    let prevIds = new Set();
    for (const g of gens) {
      const ids = new Set(g.tree.nodes.map((n) => n.id));
      if (![...prevIds].every((id) => ids.has(id))) kept = false;
      for (const [id, v] of settled) { const n = g.tree.nodes.find((x) => x.id === id); if (!n || n.label !== v.label || n.state !== v.state) frozen = false; }
      for (const n of g.tree.nodes) if ((n.state === "done" || n.state === "dropped") && !settled.has(n.id)) settled.set(n.id, { label: n.label, state: n.state });
      prevIds = ids;
    }
    check(`the flowchart only grows: no node ever removed (${last.nodes.length} nodes now)`, kept);
    check(`settled nodes never reworded or reopened (${settled.size} of them)`, frozen);
    check("exactly one current step at the end", last.nodes.filter((n) => n.state === "current" && n.kind === "step").length <= 1);
  } else check("flowchart arrived", false);
  await api(`/api/sessions/${sid}/stop`, {});
} catch (e) { console.log("FAIL exception " + e.message); }
finally { try { ws.close(); } catch {} srv.kill(); setTimeout(() => process.exit(0), 500); }
