// The session as one timeline, built by code from the transcript: no model call, so it is current the
// moment the agent does anything. Each message you send that asks for something starts a section,
// headed by your own words; the agent's actions under it become steps, grouped so they read like work
// ("Read 4 files", "Edit NavbarV3.tsx ×3", "Run npm test"), each with the files it touched, the
// commands it ran and what the agent said. A short reply or an answer to the agent continues the
// section. Ids come from the conversation itself (the message's position, the tool call's id), so they
// stay put as it grows: the AI layer (genui.js) annotates them and the window animates only what is new.
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const base = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
const lines = (s) => { s = String(s || ""); return s ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0; };
const when = (t) => { const n = Date.parse(t || ""); return Number.isFinite(n) ? n : null; };

// A whole-message approval or a short answer continues the section; "no, …", "actually …" and the like
// change direction; anything else is a new request, even right after the agent asked "Want me to …?".
const APPROVE = /^(y|yes|yep|yeah|no|nope|ok|okay|sure|go|go ahead|do it|continue|carry on|proceed|sounds good|looks good|lgtm|approved?|thanks?|thank you|perfect|great|nice|please do|keep going|next)\b/i;
const TURN = /^(no|nope|actually|instead|wait|hold on|scratch that|don'?t|stop|rather|not that|change of plan|forget (it|that))\b/i;
export function messageKind(text, first) {
  if (first) return "start";
  if (/^about your question/i.test(text)) return "answer";
  if (TURN.test(text) && text.replace(/^\W*\w+\W*/, "").length > 8) return "turn";
  if (APPROVE.test(text) && text.length <= 60) return "answer";
  return "new";
}

export function goalLabel(text) {
  let t = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  t = t.split(/(?<=[.!?])\s|\n/)[0] || t; // first sentence
  t = t.replace(/^(hey|hi|ok|okay|so|now|also|and|then|great|thanks)[,.!\s]+/i, "")
    .replace(/^(please\s+)?(can|could|would) you\s+(please\s+)?/i, "")
    .replace(/^(i (want|need|would like|'d like) (you )?to|let'?s|please)\s+/i, "");
  t = clip(t, 56).replace(/[.?!]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "Message";
}

// The questions Claude Code's AskUserQuestion asked, and the answers its result records.
function askOf(x) {
  return (x.questions || []).map((q) => ({ q: String(q.question || ""), header: String(q.header || ""), options: (q.options || []).map((o) => ({ label: String(o.label || ""), detail: String(o.description || "") })) }));
}
function askAnswers(text) {
  const out = []; const re = /"([^"]+)"\s*=\s*"([^"]*)"/g; let m;
  while ((m = re.exec(text || ""))) out.push({ q: m[1], a: m[2] });
  return out;
}

// What an edit changed, in lines: Claude's Edit/MultiEdit/Write and Codex's apply_patch.
function editsOf(e) {
  const x = e.input && typeof e.input === "object" ? e.input : {};
  if (e.tool === "Write") return [{ f: x.file_path, add: lines(x.content), del: 0 }];
  if (e.tool === "Edit") return [{ f: x.file_path, add: lines(x.new_string), del: lines(x.old_string) }];
  if (e.tool === "MultiEdit") return [{ f: x.file_path, add: (x.edits || []).reduce((k, d) => k + lines(d.new_string), 0), del: (x.edits || []).reduce((k, d) => k + lines(d.old_string), 0) }];
  if (e.tool === "NotebookEdit") return [{ f: x.notebook_path, add: lines(x.new_source), del: 0 }];
  const patch = typeof e.input === "string" ? e.input : x.input || x.patch || "";
  const out = []; let cur = null;
  for (const l of String(patch).split("\n")) {
    const m = /^\*\*\* (Update|Add|Delete) File: (.+)/.exec(l);
    if (m) { cur = { f: m[2].trim(), add: 0, del: 0 }; out.push(cur); continue; }
    if (!cur || /^(\+\+\+|---|\*\*\*)/.test(l)) continue;
    if (l.startsWith("+")) cur.add++; else if (l.startsWith("-")) cur.del++;
  }
  return out.length ? out : [{ f: x.file_path || x.path || "", add: 0, del: 0 }];
}

// One agent action: its kind, the key that groups repeats, and what goes in the step's detail.
function action(e) {
  const x = e.input && typeof e.input === "object" ? e.input : {}, t = e.tool;
  if (["Read", "read_file", "view_image"].includes(t)) return { key: "read", kind: "read", file: x.file_path || x.path || "" };
  if (["Grep", "Glob", "LS", "list_dir", "grep", "glob"].includes(t)) return { key: "read", kind: "read", search: clip(x.pattern || x.query || x.path || "", 60) };
  if (["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch", "edit_file"].includes(t)) {
    const ed = editsOf(e), f = base(ed[0].f);
    return { key: "edit:" + f, kind: "edit", verb: t === "Write" ? "Write" : "Edit", edits: ed, name: f || "files" };
  }
  if (["Bash", "PowerShell", "shell", "local_shell_call", "exec_command", "shell_command"].includes(t)) {
    const full = String(x.command || (Array.isArray(x.cmd) ? x.cmd.join(" ") : x.cmd) || (Array.isArray(x.command) ? x.command.join(" ") : "") || (typeof e.input === "string" ? e.input : ""));
    // A command reads as what it runs: a leading "cd somewhere &&" is skipped.
    const parts = full.split(/&&|\|\||;|\n/).map((p) => p.trim()).filter(Boolean);
    const cmd = parts.find((p) => !/^(cd|pushd|set-location)\b/i.test(p)) || parts[0] || "";
    return { key: "run:" + clip(cmd, 34), kind: "run", cmd: clip(cmd, 120), name: clip(cmd, 34) };
  }
  if (t === "Skill") { const k = x.skill || x.command || ""; return { key: "skill:" + k, kind: "tool", label: k ? `Use the ${k} skill` : "Use a skill" }; }
  if (t === "WebSearch" || t === "web_search") return { key: "web", kind: "web", label: "Search the web", search: clip(x.query || "", 80) };
  if (t === "WebFetch") { let h = ""; try { h = new URL(x.url).hostname.replace(/^www\./, ""); } catch {} return { key: "fetch:" + h, kind: "web", label: `Read ${h || "a page"}`, url: clip(x.url || "", 120) }; }
  if (t === "Agent" || t === "Task") return { key: "agent:" + (x.description || ""), kind: "agent", label: `Delegate: ${clip(x.description || x.prompt || "a task", 40)}` };
  if (t === "AskUserQuestion") return { key: "ask:" + (e.id || Math.random()), kind: "ask", qs: askOf(x) };
  if (["TodoWrite", "update_plan", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "ExitPlanMode"].includes(t)) return null; // the agent's own list is shown as is
  return { key: "tool:" + t, kind: "tool", label: `Use ${t}` };
}

// A tool's result, as one short line: Codex wraps it in JSON with an exit code.
function resultLine(r) {
  if (!r) return { text: "", ok: true };
  let text = String(r.text || ""), ok = !r.error;
  try { const j = JSON.parse(text); if (j && typeof j === "object") { if (typeof j.output === "string") text = j.output; const code = j.metadata && j.metadata.exit_code; if (code != null && code !== 0) ok = false; } } catch {}
  const first = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (/^(Exit code|exit code) [1-9]/.test(first[0] || "")) ok = false;
  return { text: clip(first.slice(0, 2).join(" · "), 100), ok };
}

// The step's last word from the agent ends in a question: the turn ended waiting on you.
const endsAsking = (s) => !!(s && s.said && s.saidEv != null && !["asktext", "you", "ask"].includes(s.kind) && /\?\s*\**\s*$/.test(s.said.trim()));

const FILES_MAX = 12, CMDS_MAX = 6, SAID_MAX = 900;

// cwd: shown paths are relative to it. working: the agent is in the middle of a turn, so its last
// message isn't final yet (a question at the end of a finished turn becomes its own step).
export function buildTimeline(events, { cwd = "", working = false } = {}) {
  const root = String(cwd || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const rel = (p) => { const s = String(p || "").replace(/\\/g, "/"); return root && s.toLowerCase().startsWith(root + "/") ? s.slice(root.length + 1) : s.replace(/^[A-Za-z]:\/Users\/[^/]+\//, "~/"); };
  const results = new Map();
  for (const e of events) if (e.role === "tool_result" && e.id) results.set(e.id, e);
  const sections = [];
  let sec = null, last = null, said = null; // said: agent text no step has taken yet
  const steps = () => sec.steps;
  const addStep = (s) => { const st = { files: [], cmds: [], said: "", n: 1, ...s }; if (said && st.kind !== "you") { st.said = said.text; said = null; } sec.steps.push(st); last = st; return st; };
  // A turn ends at your next message (or at the end, when the agent isn't working): text nothing took
  // becomes its own step, and a final question becomes an "Asks" step so it can turn amber.
  const endTurn = (i, final) => {
    if (!sec || !said) { said = null; return; }
    const text = said.text, qs = (text.match(/[^.!?\n]*\?(?=\s|$)/g) || []).map((q) => q.trim()).filter((q) => q.length > 3);
    const isAsk = final && /\?\s*\**\s*$/.test(text.trim()) && qs.length;
    addStep({ id: (isAsk ? "q" : "a") + said.i, kind: isAsk ? "asktext" : "say", t: said.t, ev: said.i, label: isAsk ? (qs.length > 1 ? `Asks ${qs.length} questions` : `Asks: ${clip(qs[0], 70)}`) : `Says: ${clip(text.split(/(?<=[.!?])\s|\n/)[0], 60)}` }).said = text.slice(0, SAID_MAX);
    said = null;
  };
  events.forEach((e, i) => {
    if (e.role === "user") {
      const text = String(e.text || "").trim();
      if (sec) {
        // The agent's last message before you spoke: if it asked something, it was waiting on you.
        if (said) endTurn(i, true);
        else if (endsAsking(last)) { said = { text: last.said, t: last.saidT, i: last.saidEv }; last.said = ""; endTurn(i, true); }
      }
      const kind = messageKind(text, !sec);
      if (kind === "answer" && sec) { addStep({ id: "u" + i, kind: "you", t: when(e.t), ev: i, label: `You replied: ${clip(text.replace(/^about your questions?[^:]*:\s*/i, ""), 60)}`, text: text.slice(0, SAID_MAX) }); last = null; return; }
      sec = { id: "u" + i, kind: kind === "answer" ? "new" : kind, label: goalLabel(text), text: clip(text, 400), t: when(e.t), ev: i, steps: [] };
      sections.push(sec); last = null;
      return;
    }
    if (!sec) return;
    if (e.role === "assistant") {
      const text = String(e.text || "").trim(); if (!text) return;
      if (last && last.kind !== "you") Object.assign(last, { said: text.slice(0, SAID_MAX), saidEv: i, saidT: when(e.t) }); else said = { text, t: when(e.t), i };
      return;
    }
    if (e.role !== "tool") return;
    const a = action(e); if (!a) return;
    const r = resultLine(e.id && results.get(e.id));
    // Repeats of the same action fold into one step: reads count files, edits and runs count passes.
    let s = last && last.key === a.key && last.kind !== "you" ? last : null;
    if (!s) {
      s = addStep({ id: "t" + (e.id || i), key: a.key, kind: a.kind, t: when(e.t), ev: i, label: a.label || "" });
    } else s.n++;
    s.end = i;
    if (a.kind === "read") {
      if (a.file && !s.files.some((f) => f.f === rel(a.file)) && s.files.length < FILES_MAX) s.files.push({ f: rel(a.file) });
      if (a.search && s.cmds.length < CMDS_MAX) s.cmds.push({ c: `Search ${a.search}`, r: r.text, ok: r.ok });
      s.reads = (s.reads || 0) + (a.file ? 1 : 0);
      const n = s.files.length;
      s.label = n > 1 ? `Read ${n} files` : n ? `Read ${base(s.files[0].f)}` : "Search the code";
    } else if (a.kind === "edit") {
      for (const d of a.edits) {
        const f = rel(d.f), had = s.files.find((x) => x.f === f);
        if (had) { had.add += d.add; had.del += d.del; } else if (s.files.length < FILES_MAX) s.files.push({ f, add: d.add, del: d.del });
      }
      s.label = `${a.verb} ${a.name}${s.n > 1 ? ` ×${s.n}` : ""}`;
    } else if (a.kind === "run") {
      if (s.cmds.length < CMDS_MAX) s.cmds.push({ c: a.cmd, r: r.text, ok: r.ok });
      s.label = `Run ${a.name}${s.n > 1 ? ` ×${s.n}` : ""}`;
    } else if (a.kind === "web") {
      if (s.cmds.length < CMDS_MAX) s.cmds.push({ c: a.search || a.url || "", r: r.text, ok: r.ok });
      if (a.key === "web" && s.n > 1) s.label = `Search the web ×${s.n}`;
    } else if (a.kind === "ask") {
      // Answered in the menu: its result has the answers. Cancelled (Esc, as GenAgent UI does before typing
      // your answer): your next message is the answer.
      const res = e.id && results.get(e.id), got = res && !res.error ? askAnswers(res.text) : [];
      s.ask = { qs: a.qs, answered: !!res, answers: got, cancelled: !!(res && (res.error || !got.length)) };
      s.label = a.qs.length > 1 ? `Asks ${a.qs.length} questions` : `Asks: ${clip((a.qs[0] || {}).q || "a question", 70)}`;
    } else if (s.n > 1 && !/×\d+$/.test(s.label)) s.label += ` ×${s.n}`;
  });
  if (sec && said) endTurn(events.length, !working);
  else if (sec && !working && endsAsking(last)) { said = { text: last.said, t: last.saidT, i: last.saidEv }; last.said = ""; endTurn(events.length, true); }
  // A question cancelled with Esc was answered by the message that followed it.
  for (const sc of sections) sc.steps.forEach((s, k) => {
    if (!s.ask || !s.ask.cancelled) return;
    const next = sc.steps.slice(k + 1).find((x) => x.kind === "you") || sections[sections.indexOf(sc) + 1];
    if (next) s.ask.reply = clip(next.text || "", 300);
  });
  for (const sc of sections) for (const s of sc.steps) { delete s.key; delete s.saidEv; delete s.saidT; }
  return { sections, events: events.length };
}

// Every step, in order, with its section.
export function allSteps(tl) { return tl.sections.flatMap((sec) => sec.steps.map((s) => ({ ...s, section: sec.id }))); }

// The timeline as the AI layer reads it: ids, labels, what each step touched and what the agent said.
export function timelineText(tl, fromEv = 0) {
  const out = [];
  for (const sec of tl.sections) {
    const fresh = sec.ev >= fromEv;
    if (fresh) out.push(`\n[${sec.id}] USER (${sec.kind}): ${sec.text}`);
    for (const s of sec.steps) {
      if ((s.end ?? s.ev) < fromEv) continue;
      if (!fresh && !out.some((l) => l.includes(`[${sec.id}]`))) out.push(`\n[${sec.id}] (earlier message, continued) ${clip(sec.text, 120)}`);
      if (s.kind === "you") { out.push(`  [${s.id}] USER replied: ${clip(s.text, 600)}`); continue; }
      const det = [...s.files.map((f) => f.f + (f.add || f.del ? ` +${f.add} -${f.del}` : "")), ...s.cmds.map((c) => `${c.c}${c.r ? ` → ${c.r}` : ""}`)].slice(0, 8).join("; ");
      out.push(`  [${s.id}] ${s.label}${det ? ` (${clip(det, 400)})` : ""}`);
      if (s.ask) out.push(`    asked in a menu: ${s.ask.qs.map((q) => q.q).join(" / ")}${s.ask.answers.length ? ` → answered: ${s.ask.answers.map((x) => x.a).join("; ")}` : s.ask.reply ? ` → answered in the next message` : " → not answered yet"}`);
      if (s.said) out.push(`    AGENT: ${clip(s.said, 1400)}`);
    }
  }
  return out.join("\n").trim();
}
