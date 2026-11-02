// Paths, port and the per-install secret. Everything the app keeps lives in ~/.genui-agent.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = os.homedir();
export const DATA = process.env.GENUI_DATA || path.join(HOME, ".genui-agent");
export const PORT = Number(process.env.GENUI_PORT || 4317);
export const HOST = "127.0.0.1";

fs.mkdirSync(DATA, { recursive: true });

// A random token guards every API call, WebSocket and hook, so other local pages can't drive the terminals.
const tokenFile = path.join(DATA, "token");
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString("hex"));
export const TOKEN = fs.readFileSync(tokenFile, "utf8").trim();

export const STORES = {
  claude: path.join(HOME, ".claude", "projects"),
  codex: path.join(HOME, ".codex", "sessions"),
  grok: path.join(HOME, ".grok", "sessions"),
};

// Models the app itself uses for generating goals, flows and cards, and for side discussions.
export const MODELS = {
  generate: process.env.GENUI_GEN_MODEL || "sonnet",
  side: process.env.GENUI_SIDE_MODEL || "sonnet",
  plan: process.env.GENUI_PLAN_MODEL || "opus",
};

// Environment for every harness the app starts: drop the markers a parent Claude Code session
// leaves behind (they turn off transcript saving and point at the wrong session).
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDE(CODE)?_|^CLAUDECODE$|^CLAUDE_PID$/i.test(k)) delete env[k];
  return { ...env, FORCE_COLOR: "1", ...extra };
}
