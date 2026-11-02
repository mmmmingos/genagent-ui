// Check that Codex and Grok sessions start, show their terminal prompts as cards, take typed
// messages, get found on disk and get a generated flow. Run: node tests/e2e-other-harnesses.mjs [codex|grok]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const which = process.argv.slice(2).length ? process.argv.slice(2) : ["codex", "grok"];
const PORT = 4397;
const TOKEN = fs.readFileSync(path.join(os.homedir(), ".genui-agent", "token"), "utf8").trim();
const env = { ...process.env, GENUI_PORT: String(PORT), GENUI_TEST: "1" };
for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$/.test(k)) delete env[k];
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { "content-type": "application/json", "x-genui-token": TOKEN };
const api = async (p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: "POST", headers: H, body: JSON.stringify(b) } : { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
const check = (label, ok) => console.log((ok ? "PASS " : "FAIL ") + label);
const state = async (id) => (await api("/api/state")).live.find((x) => x.id === id);

try {
  for (let i = 0; i < 40; i++) { try { await api("/health"); break; } catch { await sleep(250); } }
  for (const h of which) {
    const dir = path.join(ROOT, "sandbox", `${h}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "README.md"), "# sandbox\n");
    const s = await api("/api/sessions", { harness: h, cwd: dir, prompt: "Reply with exactly: HELLO_FROM_" + h.toUpperCase() + ". Do not run any tools." });
    check(`${h}: started`, !!s.id);
    let cur, seenNeeds = false;
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      cur = await state(s.id);
      if (cur.terminalNeeds && !seenNeeds) { seenNeeds = true; console.log(`  ${h}: terminal needs -> ${cur.terminalNeeds.kind}; answering yes`); await api(`/api/sessions/${s.id}/terminal`, { choice: "yes" }); }
      if (cur.file && fs.existsSync(cur.file) && new RegExp("HELLO_FROM_" + h.toUpperCase()).test(fs.readFileSync(cur.file, "utf8"))) break;
      if (!cur.alive) break;
    }
    check(`${h}: transcript found (${cur.file ? path.basename(cur.file) : "none"})`, !!cur.file);
    check(`${h}: agent replied in transcript`, cur.file && /HELLO_FROM_/.test(fs.readFileSync(cur.file, "utf8")));
    if (!cur.file) { const scr = (await (await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: H })).json()); console.log("  alive:", cur.alive, "status:", cur.status); }
    // Typed follow-up.
    if (cur.alive) {
      await api(`/api/sessions/${s.id}/send`, { text: "Now reply with exactly: SECOND_" + h.toUpperCase() });
      let ok = false;
      for (let i = 0; i < 90 && !ok; i++) { await sleep(1000); const c2 = await state(s.id); if (c2.file && new RegExp("SECOND_" + h.toUpperCase()).test(fs.readFileSync(c2.file, "utf8"))) ok = true; }
      check(`${h}: typed follow-up delivered`, ok);
    }
    if (cur.file) { try { const g = await api("/api/gen", { harness: h, file: cur.file }); check(`${h}: generated flow "${g.title}" (${g.steps.length} steps)`, g.steps.length > 0); } catch (e) { check(`${h}: generated flow (${e.message})`, false); } }
    await api(`/api/sessions/${s.id}/stop`, {});
  }
} catch (e) { console.log("FAIL exception " + e.message); }
finally { srv.kill(); setTimeout(() => process.exit(0), 500); }
