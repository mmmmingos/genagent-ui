// Run Claude Code non-interactively (claude -p) for the app's own work: generating UI data,
// side discussions and plans. Uses the owner's own Claude Code sign-in.
import { spawn } from "node:child_process";
import { DATA, cleanEnv } from "./config.js";
import { resolveBin } from "./harness.js";

let running = 0;
const queue = [];
const MAX = 3;

function slot() {
  return new Promise((res) => { if (running < MAX) { running++; res(); } else queue.push(res); });
}
function release() { running--; const n = queue.shift(); if (n) { running++; n(); } }

// opts: { prompt, stdin, model, schema, system, lean, tools, resume, fork, sessionId, cwd, addDirs, timeoutMs }
export async function claudeCall(opts) {
  const bin = resolveBin("claude");
  if (!bin) throw new Error("Claude Code isn't installed");
  const a = ["-p", "--output-format", "json"];
  if (opts.model) a.push("--model", opts.model);
  if (opts.schema) a.push("--json-schema", JSON.stringify(opts.schema));
  if (opts.lean) a.push("--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--no-session-persistence");
  if (opts.system) a.push("--system-prompt", opts.system);
  if (opts.appendSystem) a.push("--append-system-prompt", opts.appendSystem);
  if (opts.tools !== undefined && !opts.lean) a.push("--tools", opts.tools);
  if (opts.resume) a.push("--resume", opts.resume);
  if (opts.fork) a.push("--fork-session");
  if (opts.sessionId) a.push("--session-id", opts.sessionId);
  for (const d of opts.addDirs || []) a.push("--add-dir", d);
  if (opts.permissionMode) a.push("--permission-mode", opts.permissionMode);
  a.push(opts.prompt);
  await slot();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(bin.file, [...bin.pre, ...a], { cwd: opts.cwd || DATA, env: cleanEnv(), windowsHide: true });
      let out = "", err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      const timer = setTimeout(() => { child.kill(); reject(new Error("Claude took too long to answer")); }, opts.timeoutMs || 240000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        let j = null;
        try { j = JSON.parse(out.trim().split("\n").pop()); } catch {}
        if (!j) return reject(new Error((err || out || `claude exited ${code}`).slice(0, 400)));
        if (j.is_error) return reject(new Error(String(j.result || j.api_error_status || "Claude returned an error").slice(0, 400)));
        const u = j.usage || {};
        resolve({
          result: j.result, data: j.structured_output ?? null, sessionId: j.session_id, cost: j.total_cost_usd || 0,
          contextTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          outputTokens: u.output_tokens || 0,
        });
      });
      if (opts.stdin) child.stdin.end(opts.stdin); else child.stdin.end();
    });
  } finally { release(); }
}
