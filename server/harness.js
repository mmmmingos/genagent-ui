// How to launch each harness: find its real executable and build its command line.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cache = {};

// On Windows the npm shims are .cmd files; run what they point at directly so arguments
// with spaces and quotes reach the CLI intact.
export function resolveBin(name) {
  if (cache[name]) return cache[name];
  let found = null;
  try {
    const where = execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    const exe = where.find((p) => p.toLowerCase().endsWith(".exe"));
    const cmd = where.find((p) => p.toLowerCase().endsWith(".cmd"));
    if (exe) found = { file: exe, pre: [] };
    else if (cmd) {
      const txt = fs.readFileSync(cmd, "utf8");
      const dir = path.dirname(cmd);
      const exeIn = txt.match(/"%dp0%\\([^"]+\.exe)"/i);
      const jsIn = txt.match(/"%dp0%\\([^"]+\.(?:c?js|mjs))"/i);
      if (exeIn) found = { file: path.join(dir, exeIn[1]), pre: [] };
      else if (jsIn) found = { file: process.execPath, pre: [path.join(dir, jsIn[1])] };
      else found = { file: process.env.ComSpec || "cmd.exe", pre: ["/c", cmd] };
    } else if (where[0]) found = { file: where[0], pre: [] };
  } catch { /* not installed */ }
  cache[name] = found;
  return found;
}

export const HARNESSES = {
  claude: { label: "Claude Code", bin: "claude" },
  codex: { label: "Codex", bin: "codex" },
  grok: { label: "Grok", bin: "grok" },
};

export function available() {
  const out = {};
  for (const [k, h] of Object.entries(HARNESSES)) out[k] = !!resolveBin(h.bin);
  return out;
}

// Arguments for a new interactive session, or for resuming one.
export function launchArgs(harness, { id, settingsFile, prompt, resume, name, model }) {
  if (harness === "claude") {
    const a = [];
    if (resume) a.push("--resume", resume); else a.push("--session-id", id);
    if (settingsFile) a.push("--settings", settingsFile);
    if (name) a.push("-n", name);
    if (model) a.push("--model", model);
    if (prompt) a.push(prompt);
    return a;
  }
  if (harness === "codex") {
    const a = resume ? ["resume", resume] : [];
    if (model) a.push("-m", model);
    if (prompt) a.push(prompt);
    return a;
  }
  // grok
  const a = [];
  if (resume) a.push("--resume", resume);
  if (model) a.push("-m", model);
  if (prompt) a.push(prompt);
  return a;
}
