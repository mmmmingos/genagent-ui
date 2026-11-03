// Probe: how does each harness record its own task list? Starts a real session in sandbox/ through
// the app and prints the plan-related tool calls from its transcript. Run: node tests/probe-plan.mjs claude|codex
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = process.argv[2] || "claude";
const PORT = 4395;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H }); return r.json(); };
const dir = path.join(ROOT, "sandbox", `probe-${harness}-${Date.now()}`);
fs.mkdirSync(dir, { recursive: true });
try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  const prompt = harness === "codex"
    ? "Use your plan tool (update_plan) to plan exactly 3 steps: create a.txt, create b.txt, create c.txt, each containing its letter. Then do them one at a time, updating the plan after each."
    : "Use your todo/task list tool to plan exactly 3 steps: create a.txt, create b.txt, create c.txt, each containing its letter. Then do them one at a time, marking each done in the task list as you go.";
  const s = await api("/api/sessions", { harness, cwd: dir, prompt, model: harness === "claude" ? "sonnet" : undefined });
  let file = null;
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    const cur = (await api("/api/state")).live.find((x) => x.id === s.id);
    if (cur.terminalNeeds) await api(`/api/sessions/${s.id}/terminal`, { choice: "yes" });
    if (cur.pendingPermission) await api(`/api/sessions/${s.id}/permission`, { qid: cur.pendingPermission.id, allow: true });
    file = cur.file;
    if (file && fs.existsSync(path.join(dir, "c.txt")) && cur.status === "idle") break;
  }
  console.log("files:", fs.readdirSync(dir).join(", "), "| transcript:", file);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const l of lines) {
    const c = l.message && l.message.content;
    if (Array.isArray(c)) for (const b of c) {
      if (b.type === "tool_use" && !/^(Write|Bash|Read|PowerShell|Edit)$/.test(b.name)) console.log("USE", b.name, JSON.stringify(b.input).slice(0, 400));
      if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); if (/task|todo/i.test(t)) console.log("RES", t.slice(0, 200)); }
    }
    const p = l.payload;
    if (p && (p.type === "function_call" || p.type === "custom_tool_call") && !/shell|exec/i.test(p.name || "")) console.log("CALL", p.name, String(p.arguments || p.input || "").slice(0, 400));
  }
  await api(`/api/sessions/${s.id}/stop`, {});
} catch (e) { console.log("ERR", e.message); }
finally { srv.kill(); setTimeout(() => process.exit(0), 500); }
