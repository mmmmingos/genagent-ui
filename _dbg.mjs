import pty from "@lydell/node-pty";
import { resolveBin } from "./server/harness.js";
import { cleanEnv } from "./server/config.js";
const b = resolveBin("codex");
const p = pty.spawn(b.file, [...b.pre, "Reply with exactly: HI"], { cols: 120, rows: 36, cwd: process.cwd() + "/sandbox/codexdbg2", env: cleanEnv() });
let out = ""; p.onData((d) => (out += d));
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\x1b[()][0-9A-B]/g, "");
setTimeout(() => { const t = plain(out); console.log("LEN", t.length); console.log(JSON.stringify(t.slice(-1200))); try { p.kill(); } catch {} process.exit(0); }, 15000);
