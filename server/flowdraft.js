// The instant flowchart: built by code from the transcript, no model call, so it changes the moment
// the agent does anything. Each message from the user that asks for something starts a goal (the
// first is the trunk, later ones branch off it); the agent's actions under it become steps, grouped
// so they read like work ("Read 4 files", "Edit NavbarV3.tsx ×3", "Run npm test"). Same tree shape
// as the AI flowchart (flowtree.js), so the rail draws either.
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const base = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";

// A short reply that answers or approves ("yes", "ok, make it teal", "go ahead") continues the current
// goal; anything else is a new request, even right after the agent asked "Want me to …?".
const CONTINUE = /^(y|yes|yep|yeah|no|nope|ok|okay|sure|go|go ahead|do it|continue|carry on|proceed|sounds good|looks good|lgtm|approved?|thanks?|thank you|perfect|great|nice|please do|keep going|next)\b/i;
const continues = (text) => CONTINUE.test(text) && text.length <= 60;

export function goalLabel(text) {
  let t = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  t = t.split(/(?<=[.!?])\s|\n/)[0] || t; // first sentence
  t = t.replace(/^(hey|hi|ok|okay|so|now|also|and|then|great|thanks)[,.!\s]+/i, "")
    .replace(/^(please\s+)?(can|could|would) you\s+(please\s+)?/i, "")
    .replace(/^(i (want|need|would like|'d like) (you )?to|let'?s|please)\s+/i, "");
  t = clip(t, 56).replace(/[.?!]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "Message";
}

// One agent action as a step label, and a key that groups repeats of the same kind.
function action(e) {
  const x = e.input && typeof e.input === "object" ? e.input : {}, t = e.tool;
  const f = base(x.file_path || x.path || x.notebook_path);
  if (["Read", "Grep", "Glob", "LS", "read_file", "list_dir", "grep"].includes(t)) return { key: "read", label: "Read", file: f || clip(x.pattern || x.query || "", 30) };
  if (["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch", "edit_file"].includes(t)) {
    const pf = f || base((/\*\*\* (?:Update|Add) File: (.+)/.exec(typeof e.input === "string" ? e.input : x.input || "") || [])[1]);
    return { key: "edit:" + pf, label: `${t === "Write" ? "Write" : "Edit"} ${pf || "files"}` };
  }
  if (["Bash", "PowerShell", "shell", "local_shell_call", "exec_command"].includes(t)) {
    // A command reads as what it runs: a leading "cd somewhere &&" is skipped.
    const parts = String(x.command || (Array.isArray(x.cmd) ? x.cmd.join(" ") : x.cmd) || (typeof e.input === "string" ? e.input : "")).split(/&&|\|\||;|\n/).map((p) => p.trim()).filter(Boolean);
    const cmd = clip(parts.find((p) => !/^(cd|pushd|set-location)\b/i.test(p)) || parts[0] || "", 34);
    return { key: "run:" + cmd, label: `Run ${cmd || "a command"}` };
  }
  if (t === "Skill") { const k = x.skill || x.command || ""; return { key: "skill:" + k, label: k ? `Use the ${k} skill` : "Use a skill" }; }
  if (t === "WebSearch" || t === "web_search") return { key: "web", label: "Search the web" };
  if (t === "WebFetch") { let h = ""; try { h = new URL(x.url).hostname.replace(/^www\./, ""); } catch {} return { key: "fetch:" + h, label: `Read ${h || "a page"}` }; }
  if (t === "Agent" || t === "Task") return { key: "agent:" + (x.description || ""), label: `Delegate: ${clip(x.description || x.prompt || "a task", 34)}` };
  if (t === "AskUserQuestion") return { key: "ask", label: `Asks: ${clip(((x.questions || [])[0] || {}).question || "a question", 70)}`, ask: true };
  if (["TodoWrite", "update_plan", "TaskCreate", "TaskUpdate"].includes(t)) return null; // the agent's own list is shown as is
  return { key: "tool:" + t, label: `Use ${t}` };
}

// working: the agent is in the middle of a turn (its last step is the current one).
// Node ids come from the conversation itself (the message's position, the tool call's id), so a node
// keeps its id as the conversation grows and the window can animate only what is new.
export function buildDraft(events, { working = false } = {}) {
  const nodes = []; let trunk = null, goal = null, last = null;
  const add = (n) => { const node = { note: "", turn: 0, ...n }; nodes.push(node); return node; };
  const steps = (g) => nodes.filter((n) => n.parent === g.id);
  events.forEach((e, i) => {
    if (e.role === "user") {
      const text = String(e.text || "").trim();
      if (!goal || !continues(text)) {
        goal = add({ id: "u" + i, parent: trunk ? trunk.id : null, kind: "goal", label: goalLabel(text), state: "done" });
        if (!trunk) trunk = goal;
      }
      last = null;
      return;
    }
    if (e.role !== "tool" || !goal) return;
    const a = action(e); if (!a) return;
    // Repeats of the same action fold into one step: "Read" counts files, edits count passes.
    if (last && last.key === a.key && last.parent === goal.id) {
      last.n = (last.n || 1) + 1;
      if (a.key === "read") { last.files.add(a.file); last.label = last.files.size > 1 ? `Read ${last.files.size} files` : `Read ${[...last.files][0] || "files"}`; }
      else last.note = `×${last.n}`;
      return;
    }
    last = add({ id: "t" + (e.id || i), parent: goal.id, kind: "step", label: a.key === "read" ? `Read ${a.file || "files"}` : a.label, state: "done", key: a.key, files: new Set(a.file ? [a.file] : []) });
  });
  // A turn that ended on a question gets its own node, so the question itself is what turns amber.
  const tail = events[events.length - 1], i = events.length - 1;
  if (!working && goal && tail && tail.role === "assistant") {
    const q = (String(tail.text || "").match(/[^.!?\n]*\?(?=\s*$)/) || [])[0];
    if (q && q.trim().length > 3) add({ id: "q" + i, parent: goal.id, kind: "step", label: `Asks: ${clip(q.trim(), 70)}`, state: "done", ask: true });
  }
  // What is happening now: the last step while the agent works (or waits on you), the latest goal when it is your turn.
  if (goal) {
    goal.state = "current";
    for (let p = goal.parent && nodes.find((n) => n.id === goal.parent); p; p = p.parent && nodes.find((n) => n.id === p.parent)) p.state = "current";
    const st = steps(goal), lastStep = st[st.length - 1];
    if (lastStep && (working || lastStep.ask)) lastStep.state = "current";
  }
  return { nodes: nodes.map(({ key, files, n, ask, ...rest }) => rest), source: "instant" };
}
