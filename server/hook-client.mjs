#!/usr/bin/env node
// Claude Code runs this for each hook event in sessions GenUI Agent started.
// It forwards the event to the app. For a question (AskUserQuestion) or a permission request it
// waits for the answer given in the app. If the app isn't reachable it does nothing, so Claude Code
// falls back to its own prompt in the terminal.
const port = process.env.GENUI_PORT, token = process.env.GENUI_TOKEN, sid = process.env.GENUI_SID;
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  if (!port || !token || !sid) process.exit(0);
  let ev = {};
  try { ev = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const wait = (ev.hook_event_name === "PreToolUse" && ev.tool_name === "AskUserQuestion") || ev.hook_event_name === "PermissionRequest";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/hook/${encodeURIComponent(sid)}${wait ? "?wait=1" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-genui-token": token },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(wait ? 3500 * 1000 : 4000),
    });
    const out = await res.text();
    if (out && out.trim() && out.trim() !== "{}") process.stdout.write(out);
  } catch { /* app closed or slow: let Claude Code handle it itself */ }
  process.exit(0);
});
