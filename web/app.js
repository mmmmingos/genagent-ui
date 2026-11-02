// GenUI Agent — the window. Plain modules, no build step.
// Rendering: each region is rebuilt as an HTML string and morphed into place (morphdom), so focus,
// typed text and scroll positions survive live updates and only genuinely new elements animate in.
import morphdom from "/vendor/morphdom/morphdom-esm.js";
import { md, esc, ago, kt, plural } from "/web/util.js";

const $ = (s, r = document) => r.querySelector(s);
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};

// ---- State ---------------------------------------------------------------------
const S = {
  harnesses: {}, labels: { claude: "Claude Code", codex: "Codex", grok: "Grok" },
  live: new Map(), saved: [], registry: [],
  gens: new Map(), genBusy: new Set(), genErr: new Map(),
  views: new Map(), liveTail: new Map(),
  sel: null, page: "overview", tab: "flow", search: "",
  answers: new Map(), sentCards: new Set(), picks: new Map(), open: new Set(), reopen: new Set(),
  ask: new Map(),           // askId -> { step, picks: [Set], other: [""], elseOpen: [bool], sending }
  workingSince: new Map(),  // live id -> ms
  side: null, plans: loadPlans(),
  ng: { goal: "", cwd: "", plan: null, busy: false, err: "", answers: {}, startedAt: 0 },
  picker: null, toolsOpen: new Set(),
};
function loadPlans() { try { return JSON.parse(localStorage.getItem("genui.plans") || "[]"); } catch { return []; } }
function savePlans() { try { localStorage.setItem("genui.plans", JSON.stringify(S.plans.slice(0, 30))); } catch {} }
const terms = new Map();

// ---- Live connection -------------------------------------------------------------
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { for (const id of terms.keys()) ws.send(JSON.stringify({ type: "sub", id })); };
  ws.onclose = () => setTimeout(connect, 1200);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "pty" || msg.type === "replay") { const t = terms.get(msg.id); if (t) { if (msg.type === "replay") t.term.reset(); t.term.write(msg.data); } return; }
    if (msg.type === "session") {
      const prev = S.live.get(msg.session.id);
      const s = msg.session;
      if (s.status === "working" && (!prev || prev.status !== "working")) S.workingSince.set(s.id, Date.now());
      S.live.set(s.id, s);
      if ((msg.what === "ask" || msg.what === "permission") && !isOnScreen(s.id)) toast("Needs your answer", title(s), "needs", () => openLive(s.id));
      if (msg.what === "turn-end" && !isOnScreen(s.id)) toast("Finished its turn", title(s), "ok", () => openLive(s.id), 5000);
      schedule(); return;
    }
    if (msg.type === "transcript") { S.liveTail.set(msg.id, { last: msg.last, context: msg.context, count: msg.count }); schedule(); return; }
    if (msg.type === "gen") { S.gens.set(msg.file, msg.gen); S.genBusy.delete(msg.file); resetCards(msg.file); schedule(); }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const isOnScreen = (id) => S.page === "session" && S.sel && S.sel.kind === "live" && S.sel.id === id && document.hasFocus();

async function refresh(force) {
  const st = await api(`/api/state${force ? "?refresh=1" : ""}`);
  S.harnesses = st.harnesses; S.labels = st.labels; S.saved = st.saved; S.registry = st.registry;
  for (const l of st.live) S.live.set(l.id, l);
  schedule();
}

// ---- Render loop -----------------------------------------------------------------
let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
const MORPH = {
  onBeforeElUpdated(from, to) {
    if (from.hasAttribute && from.hasAttribute("data-keep")) return false; // user-owned inputs
    if (from.isEqualNode(to)) return false;
    return true;
  },
  onNodeAdded(node) {
    if (node.nodeType === 1) {
      if (node.hasAttribute("data-anim")) node.classList.add("enter");
      if (node.querySelectorAll) node.querySelectorAll("[data-anim]").forEach((n) => n.classList.add("enter"));
      decodeIn(node);
    }
    return node;
  },
};
function morph(el, html) { const n = el.cloneNode(false); n.innerHTML = html; morphdom(el, n, { ...MORPH, childrenOnly: true }); }

function render() {
  const sc0 = $("#scroll");
  const nearBottom = sc0 && sc0.scrollHeight - sc0.scrollTop - sc0.clientHeight < 140;
  morph($("#side"), sideHTML());
  const view = $("#view");
  if (S.page === "overview") morph(view, overviewHTML());
  else if (S.page === "new") morph(view, newGoalHTML());
  else { const ref = current(); if (!ref) { S.page = "overview"; return render(); } morph(view, sessionHTML(ref)); }
  renderTerm();
  morph($("#panel"), sideChatHTML());
  $("#panel").hidden = !S.side;
  autosizeAll();
  // Follow new content only if the reader was already at the bottom (or just opened the session).
  const sc = $("#scroll");
  if (sc && (S.forceBottom || nearBottom)) sc.scrollTop = sc.scrollHeight;
  if (sc && S.forceBottom && sc.scrollHeight > 0) S.forceBottom = false;
}

// ---- Helpers ---------------------------------------------------------------------
const genFor = (file) => (file ? S.gens.get(file) : null);
const shortPath = (p) => (p || "").split(/[\\/]/).filter(Boolean).slice(-1)[0] || "";
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const hid = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
function title(l) { const g = genFor(l.file); return (g && g.title) || l.name || clip(l.goalHint || "", 60) || "New session"; }
const engShort = (h) => ({ claude: "Claude", codex: "Codex", grok: "Grok" }[h] || h);

function openCards(file, g) { return (g && g.cards ? g.cards : []).map((c, i) => ({ c, i, key: `${file}|${i}|${c.title}` })).filter((x) => x.c.kind !== "info" && !S.sentCards.has(x.key)); }
function resetCards(file) { for (const k of [...S.answers.keys()]) if (k.startsWith(file + "|")) S.answers.delete(k); for (const k of [...S.sentCards]) if (k.startsWith(file + "|")) S.sentCards.delete(k); }

// One state per live session, used everywhere (sidebar dot, header, card status, chips).
function liveState(l) {
  if (!l.alive) return "off";
  if (l.pendingAsk || l.pendingPermission || l.terminalNeeds) return "needs";
  if (l.status === "working" || l.status === "starting") return "run";
  const g = genFor(l.file);
  if (g && openCards(l.file, g).length) return "needs";
  if (g && g.status === "done") return "done";
  return "idle";
}
const STATE_LABEL = { needs: "Needs you", run: "Running", idle: "Your turn", done: "Done", off: "Ended" };
const STAT_CLS = { needs: "needs", run: "run", idle: "idle", done: "done", off: "idle" };

function current() {
  if (!S.sel) return null;
  if (S.sel.kind === "live") {
    const l = S.live.get(S.sel.id); if (!l) return null;
    const tail = S.liveTail.get(l.id) || {};
    return { kind: "live", l, id: l.id, harness: l.harness, file: l.file, cwd: l.cwd, context: tail.context || l.context, events: tail.last || [], alive: l.alive, state: liveState(l) };
  }
  const v = S.views.get(S.sel.file) || {};
  const sv = S.saved.find((s) => s.file === S.sel.file) || {};
  return { kind: "saved", harness: S.sel.harness, file: S.sel.file, id: sv.id, cwd: v.cwd || sv.cwd, context: v.context || sv.context, events: v.events || [], total: v.total, title: v.title || sv.title, mtime: sv.mtime, pendingAsk: v.pendingAsk, loading: !S.views.has(S.sel.file) };
}

// ---- Sidebar (3.1) ---------------------------------------------------------------------
function sideHTML() {
  const live = [...S.live.values()].sort((a, b) => b.createdAt - a.createdAt);
  const needs = live.filter((l) => liveState(l) === "needs");
  const running = live.filter((l) => liveState(l) !== "needs");
  const liveFiles = new Set(live.map((l) => l.file).filter(Boolean));
  const q = S.search.trim().toLowerCase();
  const recent = S.saved.filter((s) => !liveFiles.has(s.file) && (!q || `${s.title} ${s.cwd} ${S.labels[s.harness]}`.toLowerCase().includes(q)));
  const day = 86400000, now = Date.now(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const buckets = [["Today", (t) => t >= t0.getTime()], ["Yesterday", (t) => t >= t0.getTime() - day], ["Last 7 days", (t) => t >= now - 7 * day], ["Older", () => true]];
  const used = new Set();
  const groups = buckets.map(([name, test]) => { const items = recent.filter((s) => !used.has(s.file) && test(s.mtime)); items.forEach((s) => used.add(s.file)); return [name, items.slice(0, name === "Older" ? 40 : 80)]; }).filter(([, items]) => items.length);
  const liveRow = (l) => {
    const st = liveState(l);
    const on = S.page === "session" && S.sel?.kind === "live" && S.sel.id === l.id;
    return `<button class="srow ${on ? "is-on" : ""}" id="sr-${l.id}" data-act="open-live" data-id="${l.id}"><span class="sdot ${st}"></span><span class="st">${esc(title(l))}</span><span class="sm"><span class="eng">${esc(engShort(l.harness))}</span>${st === "needs" ? "" : esc(ago(l.lastActivity || l.createdAt).replace(" ago", ""))}</span></button>`;
  };
  const savedRow = (s) => {
    const on = S.page === "session" && S.sel?.kind === "saved" && S.sel.file === s.file;
    return `<button class="srow ${on ? "is-on" : ""}" id="ss-${hid(s.file)}" data-act="open-saved" data-file="${esc(s.file)}" data-h="${s.harness}" title="${esc(s.cwd || "")}"><span class="sdot ${s.waiting ? "needs" : "off"}"></span><span class="st">${esc((genFor(s.file) || {}).title || s.title)}</span><span class="sm"><span class="eng">${esc(engShort(s.harness))}</span>${esc(ago(s.mtime).replace(" ago", ""))}</span></button>`;
  };
  return `
    <button class="srow srow-new" data-act="go" data-page="new">${icon("plus")}New goal</button>
    <label class="srow srow-search">${icon("search")}<input id="search" data-keep placeholder="Search" aria-label="Search sessions" autocomplete="off"><kbd>Ctrl K</kbd></label>
    <button class="srow ${S.page === "overview" ? "is-on" : ""}" data-act="go" data-page="overview">${icon("flow")}<span class="st">Orchestrator</span>${needs.length ? `<span class="sm" style="color:var(--amber-ink)">${needs.length}</span>` : ""}</button>
    ${needs.length ? `<div class="sgroup">Needs you</div>${needs.map(liveRow).join("")}` : ""}
    ${running.length ? `<div class="sgroup">Running</div>${running.map(liveRow).join("")}` : ""}
    ${groups.length ? groups.map(([name, items]) => `<div class="sgroup">${name}</div>${items.map(savedRow).join("")}`).join("") : `<div class="sgroup">Recent</div><div class="sempty">${q ? "Nothing matches." : "No sessions yet"}</div>`}`;
}

// ---- Session view ---------------------------------------------------------------------
function sessionHTML(ref) {
  const g = genFor(ref.file);
  const name = (g && g.title) || (ref.kind === "live" ? title(ref.l) : ref.title) || "Session";
  const st = ref.kind === "live" ? ref.state : null;
  const metaParts = [esc(shortPath(ref.cwd)), esc(S.labels[ref.harness])];
  if (ref.kind === "saved") metaParts.push("saved, read-only", esc(ago(ref.mtime)));
  if (st === "needs") { const since = ref.l.lastActivity ? ago(ref.l.lastActivity).replace(" ago", "") : ""; metaParts.push(`<span class="wait">waiting${since && since !== "just now" ? " " + esc(since) : ""}</span>`); }
  const hdot = st === "run" ? "var(--accent-dot)" : st === "needs" ? "var(--amber-dot)" : "";
  return `
  <header class="head">
    <div class="head-t">${hdot ? `<span class="hdot" style="background:${hdot}"></span>` : ""}<span>${esc(name)}</span></div>
    <div class="head-meta">${metaParts.filter(Boolean).join(" · ")}</div>
    <div class="head-r">
      ${ref.kind === "live" ? `<div class="seg" role="group" aria-label="View"><button aria-pressed="${S.tab === "flow"}" data-act="tab" data-tab="flow">Flow</button><button aria-pressed="${S.tab === "terminal"}" data-act="tab" data-tab="terminal">Terminal</button></div>` : ""}
      <button class="ibtn ${S.side ? "is-on" : ""}" data-act="side-toggle" title="Side chat: talk it through without touching the session" aria-label="Side chat">${icon("chat")}</button>
      ${ref.kind === "live" && ref.alive ? `<button class="ibtn" data-act="stop-session" title="Stop this session" aria-label="Stop session">${icon("power")}</button>` : ""}
    </div>
  </header>
  <div class="scroll" id="scroll" ${S.tab === "terminal" && ref.kind === "live" ? "hidden" : ""}><div class="stack">
    <div class="thread">${goalCard(ref, g)}${feed(ref)}${blockingCards(ref)}${genCards(ref, g)}</div>
    <div class="dock">${chips(ref, g)}${composer(ref, g)}</div>
  </div></div>`;
}

// Goal card with the vertical flow rail (3.3).
function goalCard(ref, g) {
  const busy = ref.file && S.genBusy.has(ref.file);
  const err = ref.file && S.genErr.get(ref.file);
  if (!g) {
    if (err) return `<section class="card" id="goal"><div class="ghead"><h2>Couldn't read this session</h2></div><div class="gfoot"><span class="now inline-err">${icon("alert")}<span>${esc(clip(err, 140))}</span></span><button class="btn btn-tint" data-act="regen">Try again</button></div></section>`;
    const label = ref.kind === "live" && !ref.file ? "Waiting for the first turn" : `Reading ${ref.total ? plural(ref.total, "event") : "the session"}`;
    const widths = [62, 48, 70, 40];
    return `<section class="card skel-rail" id="goal"><div class="ghead"><h2 class="t3" style="font-weight:600">${esc(ref.kind === "live" ? clip(ref.l.goalHint || "New session", 90) : clip(ref.title || "Session", 90))}</h2></div>
      <ol class="rail">${widths.map((w) => `<li class="rrow next"><span class="rn"></span><span class="rl"><span style="display:block;width:${w}%;height:14px;border-bottom:1px solid var(--divider)"></span></span><span class="rm"></span></li>`).join("")}</ol>
      <div class="gfoot"><span class="now"><span class="spin"></span><span class="shimmer t2">${esc(label)}</span></span></div></section>`;
  }
  const status = ref.kind === "live" ? ref.state : g.status === "done" ? "done" : g.status === "waiting" ? "needs" : "idle";
  const statLabel = ref.kind === "live" ? STATE_LABEL[status] : g.status === "done" ? "Done" : g.status === "waiting" ? "Was waiting" : "Saved";
  const steps = g.steps || [];
  let rows = steps.map((s, i) => ({ s, i }));
  let hiddenCount = 0;
  if (rows.length > 12 && !S.open.has("rail:" + ref.file)) { const firstCur = Math.max(0, steps.findIndex((s) => s.state !== "done")); hiddenCount = Math.max(0, Math.min(firstCur, rows.length - 10)); rows = rows.slice(hiddenCount); }
  const cur = status === "needs" ? "needs" : status === "run" ? "run" : status === "done" ? "done" : "idle";
  const rowHTML = ({ s, i }) => {
    const state = s.state === "current" ? `current ${cur}` : s.state;
    const mono = /[#/.]/.test(s.note || "") && !/\s{1}\w+\s/.test(s.note || "");
    return `<li class="rrow ${state}" id="rr-${hid(ref.file + i + s.label)}" data-decode>${s.state === "current" ? `<span class="band"></span>` : ""}<span class="rn"></span><span class="rl ${s.state === "current" && cur === "run" ? "shimmer" : ""}">${esc(s.label)}</span><span class="rm ${mono ? "mono" : ""}">${esc(s.note || "")}</span></li>`;
  };
  const nowIcon = cur === "run" ? `<span class="spin"></span>` : cur === "needs" ? `<span style="color:var(--amber-dot);display:flex">${icon("alert")}</span>` : cur === "done" ? `<span style="color:var(--violet-dot);display:flex">${icon("check")}</span>` : icon("pause");
  return `<section class="card" id="goal">
    <div class="ghead"><h2>${esc(g.title)}</h2><span class="stat ${STAT_CLS[status] || "idle"}"><i></i>${esc(statLabel)}</span></div>
    <p class="goal-sub">${esc(g.goal)}</p>
    <ol class="rail">
      ${hiddenCount ? `<li class="rrow done"><span class="rn"></span><button class="rl collapsed-rows" data-act="rail-expand">${plural(hiddenCount, "earlier step")} ${icon("chevd", "s12")}</button><span class="rm"></span></li>` : ""}
      ${rows.map(rowHTML).join("")}
    </ol>
    <div class="gfoot"><span class="now">${nowIcon}<span class="${cur === "run" ? "shimmer" : ""}">${esc(g.now || "")}</span></span>
      <span class="gen" title="GenUI Agent wrote this goal and flow from the session's transcript">${busy ? `<span class="spin"></span>Updating` : `Generated ${esc(ago(g.at))}`}</span>
      <button class="ibtn sm" data-act="regen" title="Read the session again" aria-label="Regenerate">${icon("refresh", "s14")}</button></div>
  </section>`;
}

// The latest exchange: the user's last message, the tools used since, the agent's reply.
function feed(ref) {
  const ev = ref.events || [];
  let lastUser = -1, lastAgent = -1;
  ev.forEach((e, i) => { if (e.role === "user") lastUser = i; if (e.role === "assistant") lastAgent = i; });
  const out = [];
  if (lastUser >= 0) out.push(`<div class="bubble clamp" id="fb-${hid(ev[lastUser].text.slice(0, 80))}" data-anim>${md(clip(ev[lastUser].text, 1200))}</div>`);
  const tools = ev.slice(lastUser + 1).filter((e) => e.role === "tool");
  const working = ref.kind === "live" && ref.state === "run";
  if (tools.length) {
    const key = "tools:" + ref.file + ":" + lastUser;
    const open = S.toolsOpen.has(key) || tools.length <= 3;
    out.push(`<div id="tl-${hid(key)}">${tools.length > 3 ? `<button class="disc" data-act="tools" data-k="${esc(key)}" aria-expanded="${open}">${icon("chev")}<span>${working ? "Using" : "Ran"} ${plural(tools.length, "tool")}</span></button>` : ""}
      ${open ? `<div class="tools" ${tools.length <= 3 ? `style="padding-left:0"` : ""}>${tools.slice(-14).map((t) => toolLine(t)).join("")}</div>` : ""}</div>`);
  }
  if (working) {
    const since = S.workingSince.get(ref.id);
    out.push(`<div class="disc" id="thinking">${icon("chev")}<span class="shimmer">Working</span><span class="t3 num">${since ? Math.max(1, Math.round((Date.now() - since) / 1000)) + "s" : ""}</span></div>`);
  }
  if (lastAgent > lastUser) out.push(`<div class="prose" id="pa-${hid(ev[lastAgent].text.slice(0, 120))}" data-anim>${md(ev[lastAgent].text)}</div>`);
  return out.join("");
}
const TOOL_ICON = { Read: "file", Edit: "filepen", Write: "filepen", MultiEdit: "filepen", Bash: "term", PowerShell: "term", shell: "term", Grep: "search", Glob: "search", WebSearch: "globe", WebFetch: "globe", web_search: "globe", AskUserQuestion: "chat", Agent: "flow", Task: "flow", Skill: "spark" };
function toolLine(t) {
  const i = t.input || {};
  let phrase = typeof i === "string" ? i : i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.description || i.skill || (i.questions && i.questions[0] && i.questions[0].question) || "";
  if (Array.isArray(phrase)) phrase = phrase.join(" ");
  phrase = String(phrase).replace(/^C:\\Users\\[^\\]+\\/i, "~\\");
  const literal = /^(\w:|~|\/|\.)/.test(phrase) || (t.tool === "Bash" || t.tool === "PowerShell" || t.tool === "shell");
  return `<div class="tline">${icon(TOOL_ICON[t.tool] || "dot")}<span class="tn">${esc(t.tool)}</span><span class="ta">${literal && phrase ? `<code>${esc(clip(phrase, 90))}</code>` : esc(clip(phrase, 110))}</span></div>`;
}

// ---- Cards (3.6) ---------------------------------------------------------------------
function blockingCards(ref) {
  if (ref.kind !== "live") {
    if (!ref.pendingAsk) return "";
    const q = (ref.pendingAsk.questions || [])[0] || {};
    return `<section class="card qcard" id="saved-ask"><div class="eyebrow">${icon("chat")}Question<span class="stat needs"><i></i>Was waiting</span></div><h3>${esc(q.question || "Open question")}</h3><p class="ctxl">This saved session ended while the agent was asking this. Resume it in a terminal to answer.</p></section>`;
  }
  const l = ref.l; let h = "";
  if (l.terminalNeeds) {
    const n = l.terminalNeeds, trust = n.kind === "trust";
    h += `<section class="card qcard" id="tn-${l.id}" data-anim><div class="eyebrow">${icon("term")}Terminal<span class="stat needs"><i></i>Needs you</span></div>
      <h3>${trust ? "Trust this folder?" : "The terminal is waiting for you"}</h3><p class="ctxl">${esc(n.text)}</p>
      <div class="qbody"><div class="draft mono" style="font-size:var(--fs-mono)">${esc(l.cwd)}</div></div>
      <div class="qfoot"><button class="btn btn-text" data-act="term-open">Open the terminal</button><button class="btn btn-text" data-act="term-no">${trust ? "Exit" : "No"}</button><span class="sp"></span><button class="btn btn-tint" data-act="term-yes">${trust ? "Trust and start" : "Yes"}</button></div></section>`;
  }
  if (l.pendingPermission) {
    const p = l.pendingPermission, i = p.input || {};
    const detail = i.command || i.file_path || i.url || i.pattern || JSON.stringify(i);
    const risky = /\b(rm|del|push|deploy|drop|reset --hard|publish)\b/i.test(String(detail));
    h += `<section class="card qcard" id="perm-${p.id}" data-anim><div class="eyebrow">${icon("shield")}Approval<span class="stat needs"><i></i>Needs you</span></div>
      <h3>Allow ${esc(p.tool)}?</h3>
      <div class="qbody"><div class="permrow">${icon(TOOL_ICON[p.tool] || "term")}<div style="min-width:0;flex:1"><div class="pt" style="${risky ? "color:var(--amber-ink)" : ""}">${esc(permTitle(p.tool, i))}</div><div class="pd">${esc(clip(String(detail), 600))}</div></div></div></div>
      <div class="qfoot"><button class="btn btn-text" data-act="perm-deny">Deny</button><button class="btn btn-text" data-act="perm-term">Decide in the terminal</button><span class="sp"></span><button class="btn btn-tint" data-act="perm-allow">Allow</button></div></section>`;
  }
  if (l.pendingAsk) h += askCard(l);
  return h;
}
const permTitle = (tool, i) => ({ Bash: "Run a command", PowerShell: "Run a command", Edit: `Edit ${shortPath(i.file_path)}`, Write: `Write ${shortPath(i.file_path)}`, WebFetch: "Fetch a web page", Read: `Read ${shortPath(i.file_path)}` }[tool] || `Use ${tool}`);

function askCard(l) {
  const a = l.pendingAsk, qs = a.questions || [];
  const st = S.ask.get(a.id) || { step: 0, picks: qs.map(() => new Set()), other: qs.map(() => ""), elseOpen: qs.map(() => false), sending: false };
  S.ask.set(a.id, st);
  const qi = Math.min(st.step, qs.length - 1), q = qs[qi] || { options: [] };
  const multi = !!q.multiSelect;
  const opts = (q.options || []).map((o, j) => {
    const on = st.picks[qi].has(j);
    return `<button class="opt ${on ? "is-on" : ""}" data-act="ask-pick" data-ask="${a.id}" data-j="${j}" role="${multi ? "checkbox" : "radio"}" aria-checked="${on}" ${st.sending ? "disabled" : ""}>
      ${multi ? `<span class="box">${on ? icon("check") : ""}</span>` : ""}<span class="op"><span class="ot">${esc(o.label)}</span>${o.description ? `<span class="od">${esc(o.description)}</span>` : ""}</span>
      ${/\(recommended\)/i.test(o.label) ? `<span class="oq">Recommended</span>` : ""}${!multi ? icon("check", "ock") : ""}</button>`;
  }).join("");
  const elseRow = st.elseOpen[qi]
    ? `<div class="field"><input data-keep id="ask-else-${a.id}-${qi}" placeholder="Your answer" aria-label="Your own answer" data-act-input="ask-else" data-ask="${a.id}"><button class="enterkey ${st.other[qi] ? "ready" : ""}" data-act="ask-else-send" data-ask="${a.id}" aria-label="Send">${icon("enter")}</button></div>`
    : `<button class="opt else" data-act="ask-else-open" data-ask="${a.id}"><span class="op"><span class="ot">Something else</span></span></button>`;
  return `<section class="card qcard" id="ask-${a.id}" data-anim>
    <div class="eyebrow">${icon("chat")}${esc(q.header || "Question")}<span class="stat needs"><i></i>${st.sending ? "Sending" : "Needs you"}</span></div>
    <h3>${esc(q.question)}</h3>
    <div class="qbody"><div class="opts">${opts}${elseRow}</div></div>
    <div class="qfoot"><button class="btn btn-text" data-act="ask-discuss" data-ask="${a.id}">${icon("chat", "s14")}Discuss it first</button><button class="btn btn-text" data-act="ask-term" data-ask="${a.id}">Answer in the terminal</button><span class="sp"></span>
      ${qs.length > 1 ? `<span class="stepper">${qs.map((_, k) => `<i class="${k < qi ? "done" : k === qi ? "cur" : ""}"></i>`).join("")}</span><span class="sp"></span>` : ""}
      ${multi && !st.sending ? `<button class="btn btn-tint" data-act="ask-continue" data-ask="${a.id}" ${st.picks[qi].size ? "" : "disabled"}>Continue${st.picks[qi].size ? ` with ${st.picks[qi].size}` : ""}</button>` : ""}
      ${st.sending ? `<button class="btn btn-busy" aria-busy="true"><span class="spin"></span>Sending</button>` : ""}</div>
  </section>`;
}

const KIND = { choice: ["choice", "Choice"], approve: ["shield", "Approval"], input: ["edit", "Answer"], teammate: ["user", "Teammate"], checklist: ["list", "Checklist"], info: ["info", "Note"] };
function genCards(ref, g) {
  if (!g || !g.cards || !g.cards.length) return "";
  const live = ref.kind === "live" && ref.alive;
  return g.cards.map((c, i) => genCard(ref, c, i, live)).join("");
}
function genCard(ref, c, i, live) {
  const key = `${ref.file}|${i}|${c.title}`, id = "gc-" + hid(key);
  const ans = S.answers.get(key), sent = S.sentCards.has(key);
  const [ic, noun] = KIND[c.kind] || ["info", "Note"];
  if ((ans || sent) && !S.reopen.has(key)) {
    return `<button class="card qsum-card" id="${id}" data-act="reopen" data-k="${esc(key)}" ${sent ? "disabled" : ""}><span class="qsum">${icon(ic)}<span class="qq">${esc(c.title)}</span><span class="qa">${esc(sent && !ans ? "Sent" : ans)}</span>${icon("check", "ok")}</span></button>`;
  }
  const ro = !live;
  const stat = c.kind === "info" ? "" : c.kind === "teammate" ? `<span class="stat team"><i></i>${esc(c.owner || "Teammate")}</span>` : ro ? `<span class="stat idle"><i></i>Was asked</span>` : `<span class="stat needs"><i></i>Needs you</span>`;
  let body = "", foot = "";
  if (c.kind === "choice") {
    const picked = S.picks.get(key) || new Set();
    body = `<div class="opts">${(c.options || []).map((o, j) => `<button class="opt ${picked.has(j) ? "is-on" : ""}" data-act="pick" data-k="${esc(key)}" data-j="${j}" role="${c.multi ? "checkbox" : "radio"}" aria-checked="${picked.has(j)}" ${ro ? "disabled" : ""}>
        ${c.multi ? `<span class="box">${picked.has(j) ? icon("check") : ""}</span>` : ""}<span class="op"><span class="ot">${esc(o.label)}</span>${o.detail ? `<span class="od">${esc(o.detail)}</span>` : ""}</span>${o.recommended ? `<span class="oq">Recommended</span>` : ""}${c.multi ? "" : icon("check", "ock")}</button>`).join("")}
      ${ro ? "" : S.open.has("else:" + key) ? field(key, "Your answer", "else") : `<button class="opt else" data-act="else-open" data-k="${esc(key)}"><span class="op"><span class="ot">Something else</span></span></button>`}</div>`;
    if (c.multi && !ro) foot = `<span class="sp"></span><button class="btn btn-tint" data-act="multi-done" data-k="${esc(key)}" ${picked.size ? "" : "disabled"}>Continue${picked.size ? ` with ${picked.size}` : ""}</button>`;
  } else if (c.kind === "approve") {
    body = `${c.draft ? `<div class="draft">${md(c.draft)}</div>` : ""}${S.open.has("chg:" + key) ? `<div style="margin-top:8px">${field(key, "What should change?", "chg")}</div>` : ""}`;
    if (!ro) foot = `<button class="btn btn-text" data-act="chg-open" data-k="${esc(key)}">Ask for changes</button><span class="sp"></span><button class="btn btn-tint" data-act="approve" data-k="${esc(key)}">Approve</button>`;
  } else if (c.kind === "input") {
    body = ro ? (c.draft ? `<div class="draft">${esc(c.draft)}</div>` : "") : field(key, c.draft ? `e.g. ${c.draft}` : "Your answer", "input");
  } else if (c.kind === "teammate") {
    body = `<div class="to"><span class="initial">${esc((c.owner || "?")[0].toUpperCase())}</span><b style="font-weight:500">${esc(c.owner || "A teammate")}</b><span class="t2">only they can answer this</span></div>
      <div class="draft">${esc(c.title)}${c.why ? `<br><span class="t2">${esc(c.why)}</span>` : ""}</div>
      ${S.open.has("self:" + key) ? `<div style="margin-top:8px">${field(key, "Your answer, if you know it", "self")}</div>` : ""}`;
    if (!ro) foot = `<button class="btn btn-text" data-act="self-open" data-k="${esc(key)}">I know this</button><span class="sp"></span><button class="btn btn-teal" data-act="copy-q" data-k="${esc(key)}">${icon("copy")}Copy for ${esc((c.owner || "them").split(" ")[0])}</button>`;
  } else if (c.kind === "checklist") {
    const done = S.picks.get(key) || new Set();
    body = `<ul class="chk">${(c.items || []).map((it, j) => `<li><label><input type="checkbox" data-act-change="check" data-k="${esc(key)}" data-j="${j}" ${done.has(j) ? "checked" : ""} ${ro ? "disabled" : ""}><span>${esc(it)}</span></label></li>`).join("")}</ul>`;
    if (!ro) foot = `<span class="t2" style="font-size:var(--fs-meta)">${done.size} of ${(c.items || []).length}</span><span class="sp"></span><button class="btn btn-tint" data-act="check-done" data-k="${esc(key)}">Done</button>`;
  } else if (c.kind === "info") {
    body = c.draft ? `<div class="prose" style="font-size:var(--fs-body);line-height:var(--lh-body)">${md(c.draft)}</div>` : "";
  }
  const discuss = c.kind !== "info" ? `<button class="btn btn-text" data-act="discuss" data-k="${esc(key)}" data-i="${i}">${icon("chat", "s14")}Not sure? Discuss it</button>` : "";
  return `<section class="card qcard" id="${id}" data-anim>
    <div class="eyebrow">${icon(ic)}${noun}${stat}</div>
    <h3>${esc(c.title)}</h3>${c.why && c.kind !== "teammate" ? `<p class="ctxl">${esc(c.why)}</p>` : ""}
    ${body ? `<div class="qbody">${body}</div>` : ""}
    ${(foot || discuss) && live ? `<div class="qfoot">${discuss}${foot || ""}</div>` : ""}
  </section>`;
}
function field(key, ph, mode) {
  const v = S.answers.get("draft:" + mode + ":" + key) || "";
  return `<div class="field"><textarea rows="1" data-keep id="f-${mode}-${hid(key)}" placeholder="${esc(ph)}" data-act-input="field" data-mode="${mode}" data-k="${esc(key)}" aria-label="${esc(ph)}">${esc(v)}</textarea><button class="enterkey ${v.trim() ? "ready" : ""}" data-act="field-send" data-mode="${mode}" data-k="${esc(key)}" aria-label="Save answer">${icon("enter")}</button></div>`;
}

// ---- Chips + composer (3.7, 3.8) ---------------------------------------------------------------------
function chips(ref, g) {
  if (ref.kind !== "live") return "";
  const out = [];
  const cards = openCards(ref.file, g);
  const answered = cards.filter((x) => S.answers.get(x.key));
  if (ref.alive && cards.length) {
    out.push(`<span class="chip btnchip" id="chip-answers"><span class="cd ${answered.length === cards.length ? "ok" : "needs"}"></span><span class="num">${answered.length} of ${cards.length}</span><span class="v">answered</span><button class="btn btn-tint" data-act="send-answers" ${answered.length ? "" : "disabled"}>Send ${answered.length > 1 ? "answers" : "answer"}</button></span>`);
  } else {
    const st = ref.state;
    out.push(`<span class="chip" id="chip-state">${st === "run" ? `<span class="spin"></span>` : `<span class="cd ${st === "needs" ? "needs" : "ok"}" style="${st === "idle" || st === "off" ? "background:var(--text-3)" : ""}"></span>`}<span>${esc(STATE_LABEL[st])}</span></span>`);
  }
  if (ref.context) {
    const p = ref.context.pct, col = p >= 95 ? "var(--red-dot)" : p >= 80 ? "var(--amber-dot)" : "var(--text-3)";
    const r = 4.75, c = 2 * Math.PI * r;
    out.push(`<span class="chip" id="chip-ctx" title="${kt(ref.context.used)} of ${kt(ref.context.window)} tokens in this session's context"><svg class="gauge" viewBox="0 0 12 12"><circle cx="6" cy="6" r="${r}" fill="none" stroke="var(--track)" stroke-width="1.5"/><circle cx="6" cy="6" r="${r}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 6 6)" stroke-linecap="round"/></svg><span class="v num">${p}%</span></span>`);
  }
  return `<div class="chips">${out.join("")}</div>`;
}

function composer(ref, g) {
  if (ref.kind === "saved") return `<div class="dock-note">${icon("eye")}<span>A saved session, shown read-only.</span><button class="btn btn-text" data-act="resume" id="resume-btn">Resume it in a terminal</button></div>`;
  if (!ref.alive) return `<div class="dock-note"><span>This session has ended${ref.l.exitCode ? ` (exit code ${ref.l.exitCode})` : ""}.</span>${ref.harness === "claude" ? `<button class="btn btn-tint sm" data-act="resume" id="resume-btn">Resume it</button>` : ""}</div>`;
  const working = ref.state === "run";
  const hasCards = openCards(ref.file, g).length > 0;
  return `<div class="composer">
    <textarea id="compose" data-keep rows="2" placeholder="${hasCards ? "Answer, or ask something else" : `Reply to ${esc(S.labels[ref.harness])}`}" aria-label="Message the session"></textarea>
    <div class="tbar"><span class="pill" title="${esc(ref.cwd)}">${icon("folder")}<span>${esc(shortPath(ref.cwd))}</span></span><span class="pill">${icon("term")}<span>${esc(S.labels[ref.harness])}</span></span><span class="sp"></span>
      ${working ? `<button class="send stop" data-act="interrupt" title="Interrupt (Esc)" aria-label="Interrupt"><i></i></button>` : ""}
      <button class="send" data-act="compose-send" aria-label="Send">${icon("up")}</button></div></div>`;
}

// ---- Terminal (3.10) ---------------------------------------------------------------------
function renderTerm() {
  const wrap = $("#termwrap");
  const ref = S.page === "session" ? current() : null;
  const show = !!(ref && ref.kind === "live" && S.tab === "terminal");
  wrap.hidden = !show;
  if (!show) return;
  const l = ref.l;
  morph($("#tstrip"), `${icon("term")}<b>Terminal</b><span class="cwd" title="${esc(l.cwd)}">${esc(l.cwd)}</span><span class="sp"></span>
    ${l.alive ? `<button class="btn btn-text" data-act="term-int">Interrupt</button><button class="btn btn-text" data-act="term-clear">Clear</button>` : `<span class="exit ${l.exitCode ? "bad" : ""}">${l.exitCode ? `Exited with code ${l.exitCode}` : "Exited"}</span>`}`);
  let t = terms.get(l.id);
  if (!t) {
    const el = document.createElement("div"); el.className = "xterm-wrap";
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = dark
      ? { background: "#141414", foreground: "#e8e8e8", cursor: "#4880e8", cursorAccent: "#141414", selectionBackground: "#4880e84d", black: "#3a3a3a", brightBlack: "#6e6e6e", red: "#f87171", brightRed: "#fca5a5", green: "#5fd16a", brightGreen: "#86efac", yellow: "#e9b04a", brightYellow: "#fcd34d", blue: "#8fb0f2", brightBlue: "#b6c9f5", magenta: "#b699f9", brightMagenta: "#d4c2fc", cyan: "#8be6c5", brightCyan: "#99f6e4", white: "#d4d4d4", brightWhite: "#f5f5f5" }
      : { background: "#fbfbfb", foreground: "#171717", cursor: "#2f6bea", cursorAccent: "#fbfbfb", selectionBackground: "#2f6bea2e", black: "#171717", brightBlack: "#737373", red: "#b91c1c", brightRed: "#dc2626", green: "#15803d", brightGreen: "#16a34a", yellow: "#b45309", brightYellow: "#d97706", blue: "#2b54a8", brightBlue: "#2f6bea", magenta: "#6d28d9", brightMagenta: "#8b5cf6", cyan: "#0f8a6c", brightCyan: "#0d9488", white: "#a3a3a3", brightWhite: "#d4d4d4" };
    const term = new window.Terminal({ fontFamily: '"Geist Mono", "Cascadia Mono", Consolas, monospace', fontSize: 13, lineHeight: 1.4, letterSpacing: 0, cursorBlink: true, cursorStyle: "bar", cursorWidth: 2, scrollback: 8000, allowProposedApi: true, theme });
    const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(el);
    term.onData((d) => send({ type: "input", id: l.id, data: d }));
    t = { term, fit, el, id: l.id };
    terms.set(l.id, t); send({ type: "sub", id: l.id });
    new ResizeObserver(() => fitTerm(t)).observe(el);
  }
  const host = $("#thost");
  if (t.el.parentElement !== host) { host.innerHTML = ""; host.appendChild(t.el); setTimeout(() => { fitTerm(t); t.term.focus(); }, 30); }
}
function fitTerm(t) { try { t.fit.fit(); send({ type: "resize", id: t.id, cols: t.term.cols, rows: t.term.rows }); } catch {} }

// ---- Side chat (3.9) ---------------------------------------------------------------------
function sideChatHTML() {
  const sd = S.side; if (!sd) return "";
  const d = sd.data;
  const ref = current();
  const forked = sd.ref.harness === "claude" && sd.ref.mainId;
  const discussTok = d ? Math.round(d.msgs.reduce((n, m) => n + (m.text || "").length, 0) / 4) : 0;
  const forkCtx = d ? d.contextTokens : 0;
  const receives = sd.composing ? Math.round((sd.composed || "").length / 4) : 0;
  const mainCtx = ref && ref.context;
  const live = sd.ref.kind === "live" && (S.live.get(sd.ref.id) || {}).alive;
  return `
    <div class="sp-head"><div class="tt"><b>Side chat</b><small>${forked ? "Forked from the session · won't change it" : "Reads the session · won't change it"}</small></div><button class="ibtn" data-act="side-close" aria-label="Close side chat">${icon("x")}</button></div>
    <div class="sp-meter">
      <div class="l"><span class="num">${d ? `~${kt(discussTok)} tokens of discussion` : "Starting"}</span><span class="t3">Sonnet</span></div>
      <div class="bar" title="${d ? `The side agent's own context: ${kt(forkCtx)} of 200k tokens` : ""}"><i style="width:${Math.min(100, (forkCtx / 200000) * 100)}%;${forkCtx > 160000 ? "background:var(--amber-dot)" : ""}"></i></div>
      <div class="l"><span>${mainCtx ? `Main session ${mainCtx.pct}%` : "Main session"}</span><span class="t3 num">${receives ? `receives ~${kt(receives)} tokens` : "receives nothing until you send"}</span></div>
    </div>
    ${sd.topic ? `<div class="sp-topic">About <b>${esc(clip(sd.topic, 160))}</b></div>` : ""}
    <div class="sp-body" id="sp-body">
      ${d ? d.msgs.map((m, i) => m.who === "ai" ? `<div class="sp-ai" id="sm-${i}" data-anim>${md(m.text)}${live && i > 0 ? `<div class="use"><button class="btn btn-tint sm" data-act="side-use" data-i="${i}">Use as the answer</button></div>` : ""}</div>` : `<div class="sp-me" id="sm-${i}">${esc(m.text)}</div>`).join("") : ""}
      ${sd.busy ? `<div class="sp-wait" id="sp-wait"><span class="spin"></span><span class="shimmer t2">${d ? (sd.composingBusy ? "Writing the answer" : "Thinking") : forked ? "Forking the session" : "Reading the session"}</span></div>` : ""}
      ${sd.err ? `<div class="sp-err">${esc(sd.err)}</div>` : ""}
      ${!d && !sd.busy && !sd.err ? `<div class="sp-empty">Questions here stay out of the session.</div>` : ""}
    </div>
    <div class="sp-foot">
      ${sd.composing ? `
        <div class="sp-composed"><div class="h"><span>Answer to send · editable</span><span class="num">~${kt(receives)} tokens</span></div><textarea id="sp-composed" data-keep aria-label="Composed answer"></textarea></div>
        <div class="sp-actions"><button class="btn btn-text" data-act="side-back">Keep discussing</button><span class="sp"></span>${live ? `<button class="btn btn-tint" data-act="side-send">Send to ${esc(S.labels[sd.ref.harness])}</button>` : `<button class="btn btn-tint" data-act="side-copy">${icon("copy")}Copy</button>`}</div>`
      : `
        <div class="sp-compose"><textarea id="sp-in" data-keep rows="1" placeholder="Ask on the side" aria-label="Message the side agent"></textarea><button class="send sm" data-act="side-msg" aria-label="Send" ${sd.busy || !d ? "disabled" : ""}>${icon("up")}</button></div>
        <div class="sp-actions"><span class="t3" style="font-size:var(--fs-small)">Nothing here reaches the session until you send.</span><span class="sp"></span><button class="btn btn-tint sm" data-act="side-compose" ${sd.busy || !d ? "disabled" : ""}>Compose answer</button></div>`}
    </div>`;
}

async function openSide(topic, extra = {}) {
  const ref = current(); if (!ref) return;
  const mainId = ref.harness === "claude" ? ref.id : null;
  S.side = { ref: { kind: ref.kind, id: ref.id, harness: ref.harness, file: ref.file, cwd: ref.cwd, mainId }, topic, extra, data: null, busy: true, err: "", composing: false, composed: "" };
  render();
  const mine = S.side;
  try { const d = await api("/api/side", { harness: ref.harness, file: ref.file, mainId, cwd: ref.cwd, topic }); if (S.side === mine) mine.data = d; }
  catch (e) { if (S.side === mine) mine.err = e.message; }
  if (S.side === mine) { mine.busy = false; render(); setTimeout(() => $("#sp-in")?.focus(), 30); scrollSide(); }
}
function scrollSide() { setTimeout(() => { const b = $("#sp-body"); if (b) b.scrollTop = b.scrollHeight; }, 20); }

// ---- Overview (3.11) ---------------------------------------------------------------------
function overviewHTML() {
  const live = [...S.live.values()];
  const order = { needs: 0, run: 1, idle: 2, done: 3, off: 4 };
  live.sort((a, b) => order[liveState(a)] - order[liveState(b)] || (b.lastActivity || 0) - (a.lastActivity || 0));
  const needs = live.filter((l) => liveState(l) === "needs").length, run = live.filter((l) => liveState(l) === "run").length;
  const done = live.filter((l) => liveState(l) === "done").length;
  const hflow = (steps, cur) => `<div class="hflow">${(steps || []).slice(-24).map((s) => `<span class="hn ${s.state === "current" ? `current ${cur}` : s.state}" title="${esc(s.label)}"><span class="rn"></span></span>`).join("")}</div>`;
  const row = (l) => {
    const st = liveState(l), g = genFor(l.file);
    const cur = g && (g.steps || []).find((s) => s.state === "current");
    const nowText = st === "needs" ? (l.pendingAsk ? "Asked you a question" : l.pendingPermission ? "Needs your approval" : l.terminalNeeds ? "Waiting in its terminal" : "Has questions for you") : (g && g.now) || (st === "run" ? "Working" : st === "off" ? "Ended" : "");
    return `<button class="ovrow" id="ov-${l.id}" data-act="open-live" data-id="${l.id}">
      <span class="ovt"><b>${esc(title(l))}</b><small>${esc(shortPath(l.cwd))} · ${esc(S.labels[l.harness])}</small></span>
      ${g ? hflow(g.steps, st === "needs" ? "needs" : st === "run" ? "run" : st === "done" ? "done" : "idle") : `<div class="hflow"><span class="hn current run"><span class="rn"></span></span><span class="hn next"><span class="rn"></span></span><span class="hn next"><span class="rn"></span></span></div>`}
      <span class="ovnow ${st === "needs" ? "needs" : ""}"><span class="${st === "run" ? "shimmer t2" : ""}">${esc(nowText)}</span></span>
      <span class="ovm">${g && cur ? `${g.steps.indexOf(cur) + 1}/${g.steps.length}` : esc(ago(l.lastActivity || l.createdAt).replace(" ago", ""))}</span></button>`;
  };
  const recent = S.saved.filter((s) => genFor(s.file) && !live.some((l) => l.file === s.file)).slice(0, 8);
  const savedRow = (s) => { const g = genFor(s.file); return `<button class="ovrow" id="ovs-${hid(s.file)}" data-act="open-saved" data-file="${esc(s.file)}" data-h="${s.harness}">
      <span class="ovt"><b>${esc(g.title)}</b><small>${esc(shortPath(s.cwd))} · ${esc(S.labels[s.harness])}</small></span>${hflow(g.steps, g.status === "done" ? "done" : "idle")}
      <span class="ovnow">${esc(g.now || "")}</span><span class="ovm">${esc(ago(s.mtime).replace(" ago", ""))}</span></button>`; };
  const plans = S.plans.slice(0, 6);
  const planRow = (p, pi) => {
    const started = (p.started || []).filter(Boolean).length;
    const steps = p.steps.map((s, i) => ({ label: s.label, state: p.started && p.started[i] ? (S.live.get(p.started[i])?.alive ? "current" : "done") : "next" }));
    const nextI = p.steps.findIndex((_, i) => !(p.started && p.started[i]));
    return `<div class="ovrow" id="pl-${pi}" style="cursor:default">
      <span class="ovt"><b>${esc(p.title)}</b><small>${esc(shortPath(p.cwd))} · plan</small></span>${hflow(steps, "run")}
      <span class="ovnow">${nextI >= 0 ? `Next: ${esc(p.steps[nextI].label)}` : "All steps started"}</span>
      <span class="ovm">${nextI >= 0 ? `<button class="btn btn-tint sm" data-act="plan-start" data-p="${pi}" data-i="${nextI}">Start ${nextI + 1}</button>` : `${started}/${p.steps.length}`}</span></div>`;
  };
  return `<header class="head"><div class="head-t">Orchestrator</div><div class="head-meta">every session as a flow, generated from its transcript</div></header>
  <div class="scroll"><div class="page">
    <p class="summary"><b>${run}</b> running · <b class="${needs ? "needs" : ""}">${needs}</b> need${needs === 1 ? "s" : ""} you${done ? ` · <b>${done}</b> done` : ""}</p>
    ${live.length ? `<section class="card ovcard">${live.map(row).join("")}</section>` : `<section class="card ovcard"><div class="ovempty"><span>Nothing running. Start a goal, or open a saved session on the left to see its flow.</span><button class="btn btn-tint" data-act="go" data-page="new">New goal</button></div></section>`}
    ${plans.length ? `<div class="sec">Plans</div><section class="card ovcard">${plans.map(planRow).join("")}</section>` : ""}
    ${recent.length ? `<div class="sec">Recently opened</div><section class="card ovcard">${recent.map(savedRow).join("")}</section>` : ""}
  </div></div>`;
}

// ---- New goal (3.12) ---------------------------------------------------------------------
function newGoalHTML() {
  const ng = S.ng;
  const harnessOpts = (sel) => ["claude", "codex", "grok", "you"].filter((h) => h === "you" || S.harnesses[h]).map((h) => `<option value="${h}" ${sel === h ? "selected" : ""}>${h === "you" ? "You" : esc(S.labels[h])}</option>`).join("");
  let planHTML = "";
  if (ng.busy) {
    const secs = Math.max(1, Math.round((Date.now() - ng.startedAt) / 1000));
    planHTML = `<div class="bubble" id="plan-goal">${esc(ng.goal)}</div><div class="disc" id="planning">${icon("chev")}<span class="shimmer">Planning</span><span class="t3 num">${secs}s</span></div>
      <section class="card qcard" id="plan-skel"><div class="eyebrow">${icon("list")}Plan</div><h3 class="t3">${esc(clip(ng.goal, 90))}</h3><div class="qbody">${[0, 1, 2, 3, 4].map(() => `<div class="ghost-row"></div>`).join("")}</div></section>`;
  } else if (ng.err) {
    planHTML = `<section class="card" id="plan-err"><div class="inline-err">${icon("alert")}<span>Couldn't plan it: ${esc(clip(ng.err, 200))}</span></div><div class="qfoot"><span class="sp"></span><button class="btn btn-tint" data-act="plan">Try again</button></div></section>`;
  } else if (ng.plan) {
    const p = ng.plan;
    planHTML = `<div class="bubble" id="plan-goal">${esc(ng.goal)}</div>
    <section class="card qcard" id="plan-card" data-anim>
      <div class="eyebrow">${icon("list")}Plan<span class="stat idle" style="font-weight:400">${plural(p.steps.length, "step")}</span></div>
      <h3>${esc(p.title)}</h3><p class="ctxl">${esc(p.goal)}</p>
      <div class="qbody"><ol class="rail" style="margin:0">${p.steps.map((s, i) => `<li class="prow plan-step" style="animation-delay:${i * 100}ms" id="ps-${i}"><span class="rn"></span><span>${esc(s.label)}</span>
        <select data-act-change="plan-harness" data-i="${i}" aria-label="Who does step ${i + 1}">${harnessOpts(s.harness)}</select>
        ${s.why ? `<span class="pwhy">${esc(s.why)}</span>` : ""}
        ${(s.needs || []).length ? `<div class="pneeds">${s.needs.map((n) => `<div class="pneed"><span class="q"><span class="who ${n.owner === "you" ? "you" : "team"}">${n.owner === "you" ? "You" : esc(n.owner)}</span>${esc(n.question)}</span><div class="field"><input data-keep id="pn-${hid(n.question)}" data-act-input="plan-need" data-q="${esc(n.question)}" placeholder="${n.owner === "you" ? "Answer now, or leave it for later" : "If you already know it"}"></div></div>`).join("")}</div>` : ""}
      </li>`).join("")}</ol>
      <div class="settings"><button class="pill" data-act="pick-folder">${icon("folder")}<span>${esc(shortPath(ng.cwd))}</span></button><span class="pill">${icon("spark")}<span>A fresh worker per step</span></span></div></div>
      <div class="qfoot"><button class="btn btn-text" data-act="plan">Plan again</button><span class="sp"></span><button class="btn btn-tint" data-act="plan-go">Start step 1</button></div>
    </section>`;
  }
  return `<header class="head"><div class="head-t">New goal</div></header>
  <div class="scroll"><div class="newgoal">
    ${planHTML}
    ${ng.plan || ng.busy ? "" : `<div class="composer" id="ng-composer"><textarea id="ng-goal" data-keep rows="2" placeholder="Describe what should get done" aria-label="Goal"></textarea>
      <div class="tbar"><button class="pill" data-act="pick-folder" id="ng-folder">${icon("folder")}<span>${ng.cwd ? esc(shortPath(ng.cwd)) : "Choose a folder"}</span></button><span class="pill" title="The orchestrator plans with Claude Opus">${icon("spark")}<span>Planner</span></span><span class="sp"></span><button class="send" data-act="plan" aria-label="Plan it">${icon("up")}</button></div></div>
      <div class="hint">The orchestrator plans it into steps, picks Claude Code, Codex or Grok for each, and asks what it can up front.</div>`}
  </div></div>`;
}

// ---- Events (one delegated handler) ---------------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (S.picker && !e.target.closest(".picker") && !e.target.closest("[data-act=pick-folder]")) closePicker();
  if (!el || el.disabled) return;
  const a = el.dataset.act, k = el.dataset.k;
  const ref = current();
  try {
    switch (a) {
      case "go": go(el.dataset.page); break;
      case "open-live": openLive(el.dataset.id); break;
      case "open-saved": openSaved(el.dataset.file, el.dataset.h); break;
      case "tab": S.tab = el.dataset.tab; render(); if (S.tab === "terminal") { const t = terms.get(S.sel.id); if (t) setTimeout(() => { fitTerm(t); t.term.focus(); }, 40); } break;
      case "regen": ensureGen(true); break;
      case "rail-expand": S.open.add("rail:" + ref.file); render(); break;
      case "tools": S.toolsOpen.has(k) ? S.toolsOpen.delete(k) : S.toolsOpen.add(k); render(); break;
      case "side-toggle": if (S.side) { S.side = null; render(); } else openSide(""); break;
      case "side-close": S.side = null; render(); break;
      case "stop-session": armed(el, async () => { await api(`/api/sessions/${ref.id}/stop`, {}); }, "Click again to stop this session"); break;
      case "interrupt": send({ type: "input", id: ref.id, data: "\x1b" }); break;
      case "term-int": send({ type: "input", id: ref.id, data: "\x03" }); break;
      case "term-clear": terms.get(ref.id)?.term.clear(); break;
      case "term-yes": await api(`/api/sessions/${ref.id}/terminal`, { choice: "yes" }); break;
      case "term-no": await api(`/api/sessions/${ref.id}/terminal`, { choice: "no" }); break;
      case "term-open": S.tab = "terminal"; render(); break;
      case "perm-allow": await api(`/api/sessions/${ref.id}/permission`, { qid: ref.l.pendingPermission.id, allow: true }); break;
      case "perm-deny": await api(`/api/sessions/${ref.id}/permission`, { qid: ref.l.pendingPermission.id, allow: false }); break;
      case "perm-term": await api(`/api/sessions/${ref.id}/permission`, { qid: ref.l.pendingPermission.id, allow: null }); S.tab = "terminal"; render(); break;
      // AskUserQuestion
      case "ask-pick": askPick(ref, el.dataset.ask, +el.dataset.j); break;
      case "ask-else-open": { const st = S.ask.get(el.dataset.ask); st.elseOpen[st.step] = true; render(); $(`#ask-else-${el.dataset.ask}-${st.step}`)?.focus(); break; }
      case "ask-else-send": askElse(ref, el.dataset.ask); break;
      case "ask-continue": askAdvance(ref, el.dataset.ask); break;
      case "ask-term": await api(`/api/sessions/${ref.id}/ask`, { qid: el.dataset.ask, answers: null }); S.tab = "terminal"; render(); break;
      case "ask-discuss": { const q = ref.l.pendingAsk; openSide((q.questions || []).map((x) => `${x.question} Options: ${(x.options || []).map((o) => o.label).join("; ")}`).join(" / "), { ask: q.id }); break; }
      // Generated cards
      case "pick": pickOption(ref, k, +el.dataset.j); break;
      case "multi-done": { const g = genFor(ref.file); const c = g.cards[+k.split("|").slice(-2)[0]]; setAnswer(k, [...(S.picks.get(k) || [])].map((j) => c.options[j].label).join(", ")); break; }
      case "else-open": S.open.add("else:" + k); render(); $(`#f-else-${hid(k)}`)?.focus(); break;
      case "chg-open": S.open.add("chg:" + k); render(); $(`#f-chg-${hid(k)}`)?.focus(); break;
      case "self-open": S.open.add("self:" + k); render(); $(`#f-self-${hid(k)}`)?.focus(); break;
      case "approve": setAnswer(k, "Approved."); break;
      case "field-send": fieldSend(el.dataset.mode, k); break;
      case "check-done": { const g = genFor(ref.file); const c = g.cards[cardIndex(k)]; const done = [...(S.picks.get(k) || [])].map((j) => c.items[j]); setAnswer(k, done.length === c.items.length ? "All done." : done.length ? `Done: ${done.join("; ")}` : "None done yet."); break; }
      case "copy-q": { const g = genFor(ref.file); const c = g.cards[cardIndex(k)]; await navigator.clipboard.writeText(`${c.title}${c.why ? `\n${c.why}` : ""}`); el.innerHTML = `${icon("check")}Copied`; setTimeout(render, 1500); break; }
      case "reopen": S.reopen.add(k); S.answers.delete(k); render(); break;
      case "discuss": { const g = genFor(ref.file); const c = g.cards[+el.dataset.i]; openSide(`${c.title}${c.why ? ` (${c.why})` : ""}${c.options ? `. Options: ${c.options.map((o) => o.label).join("; ")}` : ""}`, { cardKey: k }); break; }
      case "send-answers": await sendAnswers(ref); break;
      case "compose-send": await composeSend(ref); break;
      case "resume": armed(el, () => resume(ref).catch((x) => toast(x.message, "", "fail")), "Resuming continues the original session. Click again"); break;
      // Side chat
      case "side-msg": sideMsg(); break;
      case "side-compose": sideCompose(); break;
      case "side-back": S.side.composing = false; render(); break;
      case "side-use": { const m = S.side.data.msgs[+el.dataset.i]; S.side.composed = m.text; S.side.composing = true; render(); setComposed(); break; }
      case "side-send": await sideSend(); break;
      case "side-copy": await navigator.clipboard.writeText($("#sp-composed").value); el.innerHTML = `${icon("check")}Copied`; break;
      // New goal
      case "pick-folder": openPicker(el, S.ng.cwd || ""); break;
      case "pk-up": browse(S.picker.parent); break;
      case "pk-into": browse(S.picker.path.replace(/[\\/]$/, "") + "\\" + el.dataset.d); break;
      case "pk-use": S.ng.cwd = S.picker.path; closePicker(); render(); break;
      case "plan": await planIt(); break;
      case "plan-go": await planGo(); break;
      case "plan-start": await startStep(S.plans[+el.dataset.p], +el.dataset.i); break;
    }
  } catch (err) { toast(err.message, "", "fail"); }
});
const cardIndex = (k) => +k.split("|").slice(-2)[0];
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "search") { S.search = el.value; render(); return; }
  if (el.id === "ng-goal") { S.ng.goal = el.value; autosize(el); return; }
  if (el.id === "compose" || el.id === "sp-in") { autosize(el); return; }
  if (el.id === "sp-composed") { S.side.composed = el.value; const h = el.parentElement.querySelector(".num"); if (h) h.textContent = `~${kt(Math.round(el.value.length / 4))} tokens`; return; }
  const ai = el.dataset.actInput;
  if (ai === "field") { S.answers.set("draft:" + el.dataset.mode + ":" + el.dataset.k, el.value); autosize(el); el.parentElement.querySelector(".enterkey")?.classList.toggle("ready", !!el.value.trim()); }
  if (ai === "ask-else") { const st = S.ask.get(el.dataset.ask); st.other[st.step] = el.value; el.parentElement.querySelector(".enterkey")?.classList.toggle("ready", !!el.value.trim()); }
  if (ai === "plan-need") S.ng.answers[el.dataset.q] = el.value;
});
document.addEventListener("change", (e) => {
  const el = e.target, a = el.dataset.actChange;
  if (a === "check") { const s = new Set(S.picks.get(el.dataset.k) || []); el.checked ? s.add(+el.dataset.j) : s.delete(+el.dataset.j); S.picks.set(el.dataset.k, s); render(); }
  if (a === "plan-harness") { S.ng.plan.steps[+el.dataset.i].harness = el.value; }
});
document.addEventListener("keydown", (e) => {
  const el = e.target;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search")?.focus(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); go("new"); return; }
  if (e.key === "Escape") { if (S.picker) closePicker(); else if (S.side) { S.side = null; render(); } return; }
  if (e.key !== "Enter" || e.shiftKey) return;
  if (el.id === "compose") { e.preventDefault(); composeSend(current()).catch((x) => toast(x.message, "", "fail")); }
  else if (el.id === "sp-in") { e.preventDefault(); sideMsg(); }
  else if (el.id === "ng-goal") { e.preventDefault(); planIt(); }
  else if (el.dataset.actInput === "field") { e.preventDefault(); fieldSend(el.dataset.mode, el.dataset.k); }
  else if (el.dataset.actInput === "ask-else") { e.preventDefault(); askElse(current(), el.dataset.ask); }
});

// ---- Actions ---------------------------------------------------------------------
function go(page) {
  S.page = page; if (page !== "session") S.sel = null; render();
  const sc = $(".scroll"); if (sc) sc.scrollTop = 0;
  if (page === "new") setTimeout(() => { const g = $("#ng-goal"); if (g) { g.value = S.ng.goal; g.focus(); } }, 20);
}
function openLive(id) { S.page = "session"; S.sel = { kind: "live", id }; S.forceBottom = true; render(); ensureGen(); }
async function openSaved(file, harness) {
  S.page = "session"; S.sel = { kind: "saved", file, harness }; S.tab = "flow"; render();
  try { const v = await api(`/api/view?harness=${harness}&file=${encodeURIComponent(file)}`); S.views.set(file, v); if (v.gen) S.gens.set(file, v.gen); S.forceBottom = true; render(); ensureGen(); }
  catch (e) { toast(e.message, "", "fail"); }
}

async function ensureGen(force) {
  const ref = current(); if (!ref || !ref.file) return;
  const g = S.gens.get(ref.file);
  if (!force && g && (g.fresh || ref.kind === "live")) return;
  if (S.genBusy.has(ref.file)) return;
  S.genBusy.add(ref.file); S.genErr.delete(ref.file); render();
  try { const r = await api("/api/gen", { harness: ref.harness, file: ref.file }); S.gens.set(ref.file, r); resetCards(ref.file); }
  catch (e) { S.genErr.set(ref.file, e.message); }
  S.genBusy.delete(ref.file); render();
}

function pickOption(ref, key, j) {
  const g = genFor(ref.file); const c = g.cards[cardIndex(key)];
  const s = new Set(S.picks.get(key) || []);
  if (c.multi) { s.has(j) ? s.delete(j) : s.add(j); S.picks.set(key, s); render(); return; }
  S.picks.set(key, new Set([j])); render();
  // Single-select commits on click; hold briefly so the selection reads.
  setTimeout(() => { if ((S.picks.get(key) || new Set()).has(j)) setAnswer(key, c.options[j].label); }, 600);
}
function setAnswer(key, text) { S.answers.set(key, text); S.reopen.delete(key); for (const m of ["else", "chg", "self"]) S.open.delete(m + ":" + key); render(); }
function fieldSend(mode, key) {
  const v = (S.answers.get("draft:" + mode + ":" + key) || "").trim(); if (!v) return;
  setAnswer(key, mode === "chg" ? `Changes needed: ${v}` : v);
}
async function sendAnswers(ref) {
  const g = genFor(ref.file);
  const items = openCards(ref.file, g).filter((x) => S.answers.get(x.key));
  if (!items.length) return;
  const text = items.length === 1 ? `${items[0].c.title}\n${S.answers.get(items[0].key)}` : `Answers to your questions:\n${items.map((x, n) => `${n + 1}. ${x.c.title}\n   ${S.answers.get(x.key)}`).join("\n")}`;
  await api(`/api/sessions/${ref.id}/send`, { text });
  items.forEach((x) => S.sentCards.add(x.key));
  render();
}
async function composeSend(ref) {
  const ta = $("#compose"); if (!ta || !ref) return;
  const v = ta.value.trim(); if (!v) return;
  await api(`/api/sessions/${ref.id}/send`, { text: v });
  ta.value = ""; autosize(ta);
}
async function resume(ref) {
  const s = await api("/api/resume", { harness: ref.harness, id: ref.id, cwd: ref.cwd, confirm: true });
  S.live.set(s.id, s); openLive(s.id);
}

// AskUserQuestion: single-select commits on click (after a short hold); multi needs Continue; several questions step through.
function askPick(ref, askId, j) {
  const a = ref.l.pendingAsk; if (!a || a.id !== askId) return;
  const st = S.ask.get(askId), qi = st.step, q = a.questions[qi];
  if (q.multiSelect) { st.picks[qi].has(j) ? st.picks[qi].delete(j) : st.picks[qi].add(j); render(); return; }
  st.picks[qi] = new Set([j]); st.other[qi] = ""; render();
  setTimeout(() => askAdvance(ref, askId), 600);
}
function askElse(ref, askId) { const st = S.ask.get(askId); if (!st.other[st.step].trim()) return; st.picks[st.step] = new Set(); askAdvance(ref, askId); }
async function askAdvance(ref, askId) {
  const l = S.live.get(ref.id); const a = l && l.pendingAsk; if (!a || a.id !== askId) return;
  const st = S.ask.get(askId);
  if (st.step < a.questions.length - 1) { st.step++; render(); return; }
  st.sending = true; render();
  const answers = {};
  a.questions.forEach((q, i) => { const labels = [...st.picks[i]].map((j) => q.options[j].label); if (st.other[i].trim()) labels.push(st.other[i].trim()); answers[q.question] = labels.join(", "); });
  try { await api(`/api/sessions/${ref.id}/ask`, { qid: askId, answers }); } catch (e) { st.sending = false; toast(e.message, "", "fail"); render(); }
}

// Side chat actions
async function sideMsg() {
  const ta = $("#sp-in"); const sd = S.side; if (!ta || !sd || sd.busy || !sd.data) return;
  const v = ta.value.trim(); if (!v) return;
  sd.data.msgs.push({ who: "me", text: v }); ta.value = ""; autosize(ta); sd.busy = true; render(); scrollSide();
  try { const d = await api(`/api/side/${sd.data.id}/msg`, { text: v }); if (S.side === sd) sd.data = d; } catch (e) { sd.err = e.message; sd.data.msgs.pop(); }
  sd.busy = false; render(); scrollSide(); $("#sp-in")?.focus();
}
async function sideCompose() {
  const sd = S.side; if (!sd || sd.busy) return;
  sd.busy = true; sd.composingBusy = true; render(); scrollSide();
  try { const r = await api(`/api/side/${sd.data.id}/compose`, {}); if (S.side === sd) { sd.data = r; sd.composed = r.composed; sd.composing = true; } } catch (e) { sd.err = e.message; }
  sd.busy = false; sd.composingBusy = false; render(); setComposed();
}
function setComposed() { const t = $("#sp-composed"); if (t && S.side) { t.value = S.side.composed; autosize(t); t.focus(); } }
async function sideSend() {
  const sd = S.side; const text = ($("#sp-composed")?.value || "").trim(); if (!text) return;
  const l = S.live.get(sd.ref.id);
  if (sd.extra.ask && l && l.pendingAsk && l.pendingAsk.id === sd.extra.ask) {
    const answers = {}; (l.pendingAsk.questions || []).forEach((q) => (answers[q.question] = text));
    await api(`/api/sessions/${l.id}/ask`, { qid: l.pendingAsk.id, answers });
  } else await api(`/api/sessions/${sd.ref.id}/send`, { text });
  await api(`/api/side/${sd.data.id}/sent`, { text }).catch(() => {});
  if (sd.extra.cardKey) { S.answers.set(sd.extra.cardKey, "Answered from the side chat"); S.sentCards.add(sd.extra.cardKey); }
  S.side = null; render();
}

// New goal actions
async function planIt() {
  const ng = S.ng;
  const g = $("#ng-goal"); if (g) ng.goal = g.value;
  if (!ng.goal.trim()) { $("#ng-goal")?.focus(); return; }
  if (!ng.cwd) { openPicker($("#ng-folder") || $("[data-act=pick-folder]"), ""); return; }
  ng.busy = true; ng.err = ""; ng.plan = null; ng.startedAt = Date.now(); ng.answers = {}; render();
  try { ng.plan = await api("/api/plan", { goal: ng.goal, cwd: ng.cwd }); } catch (e) { ng.err = e.message; }
  ng.busy = false; render();
}
async function planGo() {
  const ng = S.ng;
  const plan = { ...ng.plan, cwd: ng.cwd, answers: { ...ng.answers }, started: [], at: Date.now() };
  S.plans.unshift(plan); savePlans();
  S.ng = { goal: "", cwd: ng.cwd, plan: null, busy: false, err: "", answers: {}, startedAt: 0 };
  await startStep(plan, 0);
}
async function startStep(plan, i) {
  const s = await api("/api/plan/start", { plan, index: i, cwd: plan.cwd, answers: plan.answers || {} });
  plan.started = plan.started || []; plan.started[i] = s.id; savePlans();
  S.live.set(s.id, s); openLive(s.id);
}
async function openPicker(anchor, path) { S.picker = { anchor }; await browse(path); }
async function browse(path) {
  const r = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  S.picker = { ...S.picker, ...r };
  let pk = $(".picker");
  if (!pk) { pk = document.createElement("div"); pk.className = "picker"; document.body.appendChild(pk); }
  pk.innerHTML = `<div class="pk-head"><button class="ibtn sm" data-act="pk-up" aria-label="Up one folder">${icon("back")}</button><span class="pk-path" title="${esc(r.path)}">${esc(r.path)}</span><button class="btn btn-tint sm" data-act="pk-use">Use this folder</button></div>
    <div class="pk-list">${r.dirs.map((d) => `<button class="pk-item" data-act="pk-into" data-d="${esc(d)}">${icon("folder")}${esc(d)}</button>`).join("") || `<div class="sempty">No folders here.</div>`}</div>`;
  const a = S.picker.anchor && S.picker.anchor.getBoundingClientRect();
  if (a) { const h = pk.offsetHeight || 330; const top = a.top - 8 - h; pk.style.left = `${Math.max(16, Math.min(a.left, innerWidth - 436))}px`; pk.style.top = `${top > 16 ? top : a.bottom + 8}px`; }
}
function closePicker() { $(".picker")?.remove(); S.picker = null; }

// ---- Bits ---------------------------------------------------------------------
function armed(btn, fn, ask = "Click again to confirm") {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove("armed"); document.getElementById("armed-tip")?.remove(); fn(); return; }
  btn.dataset.armed = "1"; btn.classList.add("armed");
  document.getElementById("armed-tip")?.remove();
  const tip = document.createElement("div"); tip.id = "armed-tip"; tip.className = "toast";
  tip.innerHTML = `<span class="td needs"></span><span class="tb"><b>${esc(ask)}</b></span>`;
  $("#toasts").appendChild(tip);
  setTimeout(() => { delete btn.dataset.armed; btn.classList.remove("armed"); tip.remove(); }, 3500);
}
function autosize(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, t.id === "sp-composed" ? 360 : 260) + "px"; }
function autosizeAll() { document.querySelectorAll("textarea").forEach((t) => { if (t.value) autosize(t); }); }
function toast(msg, sub = "", kind = "", onOpen, ttl) {
  const box = $("#toasts");
  const t = document.createElement("div"); t.className = "toast";
  t.innerHTML = `<span class="td ${kind}"></span><span class="tb"><b>${esc(msg)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${onOpen ? `<button class="ta">Open</button>` : ""}`;
  if (onOpen) t.querySelector(".ta").onclick = () => { onOpen(); t.remove(); };
  box.appendChild(t);
  const life = ttl || (kind === "needs" || kind === "fail" ? 12000 : 5000);
  const out = () => { t.classList.add("out"); setTimeout(() => t.remove(), 200); };
  let timer = setTimeout(out, life);
  t.onmouseenter = () => clearTimeout(timer);
  t.onmouseleave = () => { timer = setTimeout(out, 2000); };
  while (box.children.length > 3) box.firstElementChild.remove();
}
// New rail rows decode in: random characters settle left to right, ~30 ms per character, capped at 1 s.
function decodeIn(node) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rows = node.matches && node.matches("[data-decode]") ? [node] : [...(node.querySelectorAll ? node.querySelectorAll("[data-decode]") : [])];
  rows.forEach((row, ri) => {
    const lbl = row.querySelector(".rl"); if (!lbl || lbl.dataset.decoded || lbl.classList.contains("shimmer")) return;
    lbl.dataset.decoded = "1";
    const text = lbl.textContent, n = text.length; if (!n) return;
    const per = Math.max(1, Math.ceil(n / 33)), chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let locked = 0;
    setTimeout(function tick() {
      locked = Math.min(n, locked + per);
      const tail = text.slice(locked).replace(/\S/g, () => chars[(Math.random() * chars.length) | 0]);
      lbl.innerHTML = `${esc(text.slice(0, locked))}<span style="color:var(--text-3)">${esc(tail)}</span>`;
      if (locked < n) setTimeout(tick, 30); else lbl.textContent = text;
    }, ri * 50);
  });
}
function icon(n, cls = "") {
  const p = {
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flow: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 8v8"/><path d="M11 6h8M11 12h6M11 18h8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', chev: '<path d="m9 6 6 6-6 6"/>', chevd: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 5 5 9-10"/>', chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    term: '<path d="m4 17 6-6-6-6M12 19h8"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    back: '<path d="m15 18-6-6 6-6"/>', power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    filepen: '<path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>', dot: '<circle cx="12" cy="12" r="3"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>', edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', choice: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  }[n] || "";
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Tick live timers (Working Ns, Planning Ns) once a second while something is running on screen.
setInterval(() => { const r = current(); if ((r && r.kind === "live" && r.state === "run") || (S.page === "new" && S.ng.busy)) schedule(); }, 1000);
connect();
refresh().catch((e) => toast(e.message, "", "fail"));
setInterval(() => refresh().catch(() => {}), 30000);
window.GENUI = { S, render, openLive, openSaved, go, current };
