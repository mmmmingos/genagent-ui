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
      const exeIn = txt.match(/"%~?dp0%?\\([^"]+\.exe)"/i);
      const jsIn = txt.match(/"%~?dp0%?\\([^"]+\.(?:c?js|mjs))"/i);
      // A JS entry point wins: shims for node CLIs also mention node.exe itself.
      // There is no cmd.exe fallback: prompts would go through the shell's parser.
      if (jsIn) found = { file: process.execPath, pre: [path.join(dir, jsIn[1])] };
      else if (exeIn && !/(^|\\)node\.exe$/i.test(exeIn[1])) found = { file: path.join(dir, exeIn[1]), pre: [] };
    } else if (where[0]) found = { file: where[0], pre: [] };
  } catch { /* not installed */ }
  cache[name] = found;
  return found;
}

export const HARNESSES = {
  // Your own shell: you type the commands (claude --dangerously-skip-permissions, codex, anything).
  terminal: { label: "Terminal", bin: null },
  claude: { label: "Claude Code", bin: "claude" },
  codex: { label: "Codex", bin: "codex" },
  grok: { label: "Grok", bin: "grok" },
};

export function available() {
  const out = {};
  for (const [k, h] of Object.entries(HARNESSES)) out[k] = !h.bin || !!resolveBin(h.bin);
  return out;
}

// Arguments for a new interactive session, resuming one, or forking one.
// A prompt starting with "-" gets a leading space so the CLI can't read it as a flag.
const safePrompt = (p) => (p && /^\s*-/.test(p) ? " " + p : p);
export function launchArgs(harness, { id, settingsFile, prompt, resume, fork, name, model }) {
  prompt = safePrompt(prompt);
  if (harness === "claude") {
    const a = [];
    if (resume) { a.push("--resume", resume); if (fork) a.push("--fork-session", "--session-id", id); } else a.push("--session-id", id);
    if (settingsFile) a.push("--settings", settingsFile);
    if (name) a.push("-n", name);
    if (model) a.push("--model", model);
    if (prompt) a.push(prompt);
    return a;
  }
  if (harness === "codex") {
    const a = resume ? [fork ? "fork" : "resume", resume] : [];
    if (model) a.push("-m", model);
    if (prompt) a.push(prompt);
    return a;
  }
  // grok
  const a = [];
  if (resume) { a.push("--resume", resume); if (fork) a.push("--fork-session", "--session-id", id); }
  if (model) a.push("-m", model);
  if (prompt) a.push(prompt);
  return a;
}

// The shell a Terminal session runs, with a `claude` function defined in it: it runs your installed
// claude with GenAgent UI's hook settings added and every argument you typed passed through, so the
// rail follows any claude you start there. Subcommands (mcp, update, ...) run untouched.
const SUBCOMMANDS = ["mcp", "plugin", "plugins", "update", "upgrade", "doctor", "install", "config", "setup-token", "migrate-installer", "auth", "agents"];
const HINT = "GenAgent UI: type claude (and any flags, e.g. --dangerously-skip-permissions); the rail follows it.";
export function shellLaunch(settingsFile, dataDir) {
  const claude = resolveBin("claude");
  if (process.platform === "win32") {
    const exe = process.env.GENUI_SHELL || resolveBin("pwsh")?.file || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
    const lines = claude ? [
      `function global:claude {`,
      `  $pre = @(${claude.pre.map(q).join(", ")})`,
      `  if ($args.Count -gt 0 -and @(${SUBCOMMANDS.map(q).join(", ")}) -contains [string]$args[0]) { & ${q(claude.file)} @pre @args }`,
      `  else { & ${q(claude.file)} @pre --settings ${q(settingsFile)} @args }`,
      `}`,
      `Write-Host ${q(HINT)} -ForegroundColor DarkGray`,
    ] : ["$null"];
    // -EncodedCommand: no quoting through the command line, and no script file for the execution policy to block.
    return { file: exe, args: ["-NoLogo", "-NoExit", "-EncodedCommand", Buffer.from(lines.join("\n"), "utf16le").toString("base64")], env: {} };
  }
  const exe = process.env.GENUI_SHELL || process.env.SHELL || "/bin/bash";
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const run = claude ? [claude.file, ...claude.pre].map(q).join(" ") : "";
  const fn = claude ? `claude() { case "$1" in ${SUBCOMMANDS.join("|")}) command ${run} "$@";; *) command ${run} --settings ${q(settingsFile)} "$@";; esac; }\nprintf '\\033[2m%s\\033[0m\\n' ${q(HINT)}\n` : "";
  const name = path.basename(exe);
  if (name === "zsh") {
    const dir = path.join(dataDir, "zsh");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".zshrc"), `ZDOTDIR="$HOME"\n[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"\n${fn}`);
    return { file: exe, args: ["-i"], env: { ZDOTDIR: dir } };
  }
  if (name === "bash") {
    const rc = path.join(dataDir, "bashrc");
    fs.writeFileSync(rc, `[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n${fn}`);
    return { file: exe, args: ["--rcfile", rc, "-i"], env: {} };
  }
  return { file: exe, args: ["-i"], env: {} };
}
