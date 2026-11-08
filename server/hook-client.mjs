#!/usr/bin/env node
// Claude Code runs this for each hook event in sessions GenAgent UI started. It tells the app what
// happened and returns at once: questions and approvals stay in Claude Code's own menus.
const port = process.env.GENUI_PORT, token = process.env.GENUI_HOOK_TOKEN, sid = process.env.GENUI_SID;
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  if (!port || !token || !sid) process.exit(0);
  try {
    await fetch(`http://127.0.0.1:${port}/hook/${encodeURIComponent(sid)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-genui-token": token },
      body: raw || "{}",
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* app closed or slow: Claude Code carries on by itself */ }
  process.exit(0);
});
