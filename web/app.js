// GenUI Agent — the window. Plain modules, no build step.
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
  harnesses: {}, labels: { claude: "Claude Code", codex: "Codex", grok: "Grok" }, home: "",
  live: new Map(), saved: [], registry: [],
  gens: new Map(),        // file -> generated UI
  genBusy: new Set(),     // files being generated
  genErr: new Map(),
  views: new Map(),       // file -> { events, context, title, cwd }
  liveTail: new Map(),    // live id -> { last, context, count }
  sel: null,              // { kind: 'live', id } | { kind: 'saved', file, harness } | null
  page: "overview",       // overview | session | new
  tab: "flow",
  filter: "all", search: "",
  answers: new Map(),     // cardKey -> answer text
  changeOpen: new Set(),
  sentCards: new Set(),
  side: null,
  plans: loadPlans(),
  newGoal: { goal: "", cwd: "", plan: null, busy: false, err: "", answers: {} },
};
function loadPlans() { try { return JSON.parse(localStorage.getItem("genui.plans") || "[]"); } catch { return []; } }
function savePlans() { try { localStorage.setItem("genui.plans", JSON.stringify(S.plans.slice(0, 30))); } catch {} }

const terms = new Map(); // live id -> { term, fit, el }

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
      S.live.set(msg.session.id, msg.session);
      if (msg.what === "ask" || msg.what === "permission") notify(msg.session);
      if (!prev || prev.status !== msg.session.status || msg.what !== "session") schedule();
      else scheduleSoft();
      return;
    }
    if (msg.type === "transcript") { S.liveTail.set(msg.id, { last: msg.last, context: msg.context, count: msg.count }); scheduleSoft(); return; }
    if (msg.type === "gen") { S.gens.set(msg.file, msg.gen); S.genBusy.delete(msg.file); clearSent(msg.file); schedule(); return; }
    if (msg.type === "gen-error") { return; }
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function notify(s) {
  const isOpen = S.sel && S.sel.kind === "live" && S.sel.id === s.id && document.hasFocus();
  if (!isOpen) toast(`${s.name || title(s)} needs you`, { action: "Open", onAction: () => openLive(s.id) });
}

async function refresh(force) {
  const st = await api(`/api/state${force ? "?refresh=1" : ""}`);
  S.harnesses = st.harnesses; S.labels = st.labels; S.home = st.home;
  S.saved = st.saved; S.registry = st.registry;
  for (const l of st.live) S.live.set(l.id, l);
  render();
}

// ---- Rendering (batched) -------------------------------------------------------------
let raf = 0, soft = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
function scheduleSoft() { clearTimeout(soft); soft = setTimeout(schedule, 250); }

function render() {
  renderSide();
  renderMain();
  renderDiscuss();
}

// Helpers about a session reference
const liveFor = (file) => [...S.live.values()].find((l) => l.file === file);
const genFor = (file) => (file ? S.gens.get(file) : null);
function title(l) { const g = genFor(l.file); return (g && g.title) || l.name || (l.goalHint || "").slice(0, 60) || "New session"; }
const STATUS = {
  needs: { label: "Needs you", cls: "needs" }, working: { label: "Working", cls: "run" }, starting: { label: "Starting", cls: "run" },
  idle: { label: "Your turn", cls: "idle" }, exited: { label: "Ended", cls: "off" },
};
function liveStatus(l) {
  if (l.pendingAsk || l.pendingPermission || l.terminalNeeds) return STATUS.needs;
  const g = genFor(l.file);
  if (l.status === "idle" && g && g.cards && g.cards.length && !allSent(l.file, g)) return STATUS.needs;
  return STATUS[l.status] || STATUS.idle;
}

// ---- Sidebar ---------------------------------------------------------------------
function renderSide() {
  const el = $("#side");
  const liveRows = [...S.live.values()].sort((a, b) => b.createdAt - a.createdAt);
  const liveFiles = new Set(liveRows.map((l) => l.file).filter(Boolean));
  const q = S.search.trim().toLowerCase();
  const recent = S.saved.filter((s) => !liveFiles.has(s.file) && (S.filter === "all" || s.harness === S.filter) && (!q || (s.title + " " + s.cwd).toLowerCase().includes(q))).slice(0, 60);
  const needs = liveRows.filter((l) => liveStatus(l) === STATUS.needs).length;
  const keepFocus = document.activeElement && document.activeElement.id === "side-search";
  el.innerHTML = `
    <div class="side-top">
      <div class="brand"><img src="/web/icon.svg" alt=""><span>GenUI Agent</span></div>
      <button class="btn btn-new" data-go="new"><span class="plus">+</span>New goal</button>
    </div>
    <nav class="side-nav">
      <button class="nav-item ${S.page === "overview" ? "is-on" : ""}" data-go="overview">
        <span class="nav-ic">${icon("flow")}</span><span class="nav-t">Orchestrator</span>
        ${needs ? `<span class="count needs">${needs}</span>` : ""}
      </button>
    </nav>
    ${liveRows.length ? `<div class="side-label">Running here</div>
    <div class="side-list">${liveRows.map((l) => {
      const st = liveStatus(l);
      const on = S.sel && S.sel.kind === "live" && S.sel.id === l.id && S.page === "session";
      return `<button class="row ${on ? "is-on" : ""}" data-live="${l.id}">
        <span class="dot ${st.cls}"></span>
        <span class="row-main"><span class="row-t">${esc(title(l))}</span>
        <span class="row-s"><span class="hchip">${esc(S.labels[l.harness])}</span>${esc(st.label)}</span></span></button>`;
    }).join("")}</div>` : ""}
    <div class="side-label">Saved sessions <span class="muted">· read-only</span></div>
    <div class="side-tools">
      <input id="side-search" class="search" placeholder="Search" value="${esc(S.search)}" aria-label="Search saved sessions">
      <div class="seg" role="group" aria-label="Harness">${["all", "claude", "codex", "grok"].map((f) => `<button aria-pressed="${S.filter === f}" data-filter="${f}">${f === "all" ? "All" : esc(S.labels[f] || f).replace(" Code", "")}</button>`).join("")}</div>
    </div>
    <div class="side-list saved">${recent.map((s) => {
      const on = S.sel && S.sel.kind === "saved" && S.sel.file === s.file && S.page === "session";
      return `<button class="row ${on ? "is-on" : ""}" data-file="${esc(s.file)}" data-h="${s.harness}">
        <span class="dot ${s.waiting ? "needs" : "off"}"></span>
        <span class="row-main"><span class="row-t">${esc((genFor(s.file) || {}).title || s.title)}</span>
        <span class="row-s"><span class="hchip">${esc(S.labels[s.harness]).replace(" Code", "")}</span>${esc(ago(s.mtime))} · ${esc(shortPath(s.cwd))}</span></span></button>`;
    }).join("") || `<div class="empty-s">No sessions match.</div>`}</div>`;
  el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  el.querySelectorAll("[data-live]").forEach((b) => (b.onclick = () => openLive(b.dataset.live)));
  el.querySelectorAll("[data-file]").forEach((b) => (b.onclick = () => openSaved(b.dataset.file, b.dataset.h)));
  el.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => { S.filter = b.dataset.filter; renderSide(); }));
  const si = $("#side-search");
  si.oninput = () => { S.search = si.value; renderSide(); };
  if (keepFocus) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
}
const shortPath = (p) => (p || "").split(/[\\/]/).filter(Boolean).slice(-1)[0] || "";

function go(page) { S.page = page; if (page !== "session") S.sel = null; $("#main").dataset.key = ""; render(); $("#main").scrollTop = 0; }
function openLive(id) { S.page = "session"; S.sel = { kind: "live", id }; S.tab = S.tab || "flow"; render(); ensureGen(); $("#main").scrollTop = 0; }
async function openSaved(file, harness) {
  S.page = "session"; S.sel = { kind: "saved", file, harness }; S.tab = "flow"; render(); $("#main").scrollTop = 0;
  try { const v = await api(`/api/view?harness=${harness}&file=${encodeURIComponent(file)}`); S.views.set(file, v); if (v.gen) S.gens.set(file, v.gen); render(); ensureGen(); }
  catch (e) { toast(e.message); }
}

async function ensureGen(force) {
  const ref = current();
  if (!ref || !ref.file) return;
  const g = S.gens.get(ref.file);
  if (!force && g && (g.fresh || ref.kind === "live")) return;
  if (S.genBusy.has(ref.file)) return;
  S.genBusy.add(ref.file); S.genErr.delete(ref.file); schedule();
  try { const r = await api("/api/gen", { harness: ref.harness, file: ref.file }); S.gens.set(ref.file, r); clearSent(ref.file); }
  catch (e) { S.genErr.set(ref.file, e.message); }
  S.genBusy.delete(ref.file); schedule();
}

// The selected session, normalised.
function current() {
  if (!S.sel) return null;
  if (S.sel.kind === "live") {
    const l = S.live.get(S.sel.id); if (!l) return null;
    const tail = S.liveTail.get(l.id) || {};
    return { kind: "live", l, id: l.id, harness: l.harness, file: l.file, cwd: l.cwd, context: tail.context || l.context, events: tail.last || [], alive: l.alive };
  }
  const v = S.views.get(S.sel.file) || {};
  const saved = S.saved.find((s) => s.file === S.sel.file) || {};
  return { kind: "saved", harness: S.sel.harness, file: S.sel.file, cwd: v.cwd || saved.cwd, context: v.context || saved.context, events: v.events || [], total: v.total, title: v.title || saved.title, saved, pendingAsk: v.pendingAsk, loading: !S.views.has(S.sel.file) };
}

// ---- Main column ---------------------------------------------------------------------
function renderMain() {
  const main = $("#main");
  if (S.page === "overview") { main.dataset.key = "overview"; main.innerHTML = renderOverview(); wireOverview(); return; }
  if (S.page === "new") { if (main.dataset.key !== "new") { main.dataset.key = "new"; main.innerHTML = renderNew(); } else updateNew(); wireNew(); return; }
  const ref = current();
  if (!ref) { go("overview"); return; }
  const key = ref.kind === "live" ? "L:" + ref.id : "F:" + ref.file;
  if (main.dataset.key !== key) { main.dataset.key = key; main.innerHTML = sessionSkeleton(ref); wireSkeleton(ref); }
  $("#s-head").innerHTML = sessionHead(ref);
  wireHead(ref);
  const flow = $("#s-flow");
  const keep = flow.scrollTop;
  flow.innerHTML = renderFlow(ref);
  wireFlow(ref);
  flow.scrollTop = keep;
  $("#s-flow").hidden = S.tab !== "flow";
  const tp = $("#s-term");
  if (tp) { tp.hidden = S.tab !== "terminal"; if (S.tab === "terminal") mountTerm(ref); }
  updateDock(ref);
}

function sessionSkeleton(ref) {
  return `<div class="sess">
    <header class="s-head" id="s-head"></header>
    <div class="s-body">
      <div class="s-flow" id="s-flow"></div>
      ${ref.kind === "live" ? `<div class="s-term" id="s-term" hidden><div class="term-frame"><div class="term-bar"><span class="term-dots"><i></i><i></i><i></i></span><span class="term-title">${esc(S.labels[ref.harness])} · ${esc(shortPath(ref.cwd))}</span><span class="term-hint">The real ${esc(S.labels[ref.harness])}. Type here as usual.</span></div><div class="term-host" id="term-host"></div></div></div>` : ""}
    </div>
    <div class="dock" id="dock"></div>
  </div>`;
}

function sessionHead(ref) {
  const g = genFor(ref.file);
  const name = (g && g.title) || (ref.kind === "live" ? title(ref.l) : ref.title) || "Session";
  const st = ref.kind === "live" ? liveStatus(ref.l) : null;
  const ctx = ref.context;
  return `<div class="s-head-l">
      <h1>${esc(name)}</h1>
      <span class="hchip">${esc(S.labels[ref.harness])}</span>
      ${st ? `<span class="spill ${st.cls}"><span class="dot ${st.cls}"></span>${st.label}</span>` : `<span class="spill off">Saved · read-only</span>`}
    </div>
    <div class="s-head-r">
      ${ctx ? `<span class="ctx" title="${kt(ctx.used)} of ${kt(ctx.window)} tokens in the main session's context">context ${ctx.pct}%<span class="ctx-bar"><i style="width:${ctx.pct}%"></i></span></span>` : ""}
      ${ref.kind === "live" ? `<div class="tabs" role="tablist"><button role="tab" aria-selected="${S.tab === "flow"}" data-tab="flow">Flow</button><button role="tab" aria-selected="${S.tab === "terminal"}" data-tab="terminal">Terminal</button></div>` : ""}
    </div>`;
}

function wireHead() {
  $("#s-head").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderMain(); if (S.tab === "terminal") setTimeout(() => { const t = terms.get(S.sel.id); if (t) { fitTerm(t); t.term.focus(); } }, 30); }));
}
function wireSkeleton() {}

// The flow tab: goal card with rail, the latest exchange, and the cards.
function renderFlow(ref) {
  const g = genFor(ref.file);
  const busy = ref.file && S.genBusy.has(ref.file);
  const err = ref.file && S.genErr.get(ref.file);
  let html = `<div class="col">`;
  // Goal card
  if (g) {
    html += `<section class="card goal">
      <div class="goal-top"><span class="eyebrow">Goal</span>
        <span class="gen-tag" title="Written by GenUI Agent from this session's transcript">${busy ? `<span class="spin"></span>Updating` : `✦ Generated ${esc(ago(g.at))}`}</span>
        <button class="icon-btn" data-act="regen" title="Regenerate" aria-label="Regenerate">${icon("refresh")}</button></div>
      <p class="goal-text">${esc(g.goal)}</p>
      ${rail(g.steps || [])}
      ${g.now ? `<div class="goal-now"><span class="dot ${g.status === "working" ? "run" : g.status === "waiting" ? "needs" : g.status === "done" ? "done" : "off"}"></span>${esc(g.now)}</div>` : ""}
    </section>`;
  } else if (busy || (ref.kind === "saved" && ref.loading)) {
    html += `<section class="card goal skeleton"><div class="goal-top"><span class="eyebrow">Goal</span><span class="gen-tag"><span class="spin"></span>Reading ${ref.total ? plural(ref.total, "event") : "the session"}…</span></div>
      <div class="sk sk-l"></div><div class="sk sk-m"></div><div class="sk-rail">${"<div class=\"sk-step\"><i></i><span class=\"sk sk-s\"></span></div>".repeat(4)}</div></section>`;
  } else if (err) {
    html += `<section class="card goal"><div class="goal-top"><span class="eyebrow">Goal</span></div><p class="muted">Couldn't generate this session's flow: ${esc(err)}</p><button class="btn" data-act="regen">Try again</button></section>`;
  } else if (ref.kind === "live" && !ref.file) {
    html += `<section class="card goal"><div class="goal-top"><span class="eyebrow">Goal</span><span class="gen-tag"><span class="spin"></span>Waiting for the first turn</span></div><p class="goal-text muted">${esc(ref.l.goalHint || "The goal and flow appear after the agent's first turn.")}</p></section>`;
  }

  // Latest exchange
  html += feed(ref);

  // Live blocking cards first: terminal prompt, permission, AskUserQuestion.
  if (ref.kind === "live") {
    const l = ref.l;
    if (l.terminalNeeds) html += terminalCard(l);
    if (l.pendingPermission) html += permissionCard(l);
    if (l.pendingAsk) html += askCard(l);
  } else if (ref.pendingAsk) {
    html += `<section class="card q"><div class="q-head"><h3>${esc((ref.pendingAsk.questions || [])[0]?.question || "Open question")}</h3><span class="qstat needs"><span class="dot needs"></span>Was waiting</span></div><p class="q-why">This saved session ended while the agent was asking this. Resume it in a terminal to answer.</p></section>`;
  }
  // Generated cards
  if (g && g.cards && g.cards.length) {
    const live = ref.kind === "live" && ref.alive;
    html += `<div class="cards">${g.cards.map((c, i) => genCard(ref, c, i, live)).join("")}</div>`;
    if (live) html += answerTray(ref, g);
  }
  html += `</div>`;
  return html;
}

function rail(steps) {
  return `<ol class="rail">${steps.map((s) => `<li class="step ${s.state}"><span class="node" aria-hidden="true"></span><span class="lbl">${esc(s.label)}</span>${s.note ? `<span class="meta">${esc(s.note)}</span>` : ""}</li>`).join("")}</ol>`;
}

function feed(ref) {
  const ev = ref.events || [];
  if (!ev.length) return "";
  // Show the last user message, a "worked" disclosure for tool use, and the agent's last message.
  let lastUser = -1, lastAgent = -1;
  ev.forEach((e, i) => { if (e.role === "user") lastUser = i; if (e.role === "assistant") lastAgent = i; });
  const tools = ev.slice(Math.max(0, lastUser + 1)).filter((e) => e.role === "tool");
  const parts = [];
  if (lastUser >= 0) parts.push(`<div class="msg-me">${md(clip(ev[lastUser].text, 900))}</div>`);
  if (tools.length) parts.push(`<details class="worked"><summary>${icon("chev")}<span>Worked · ${plural(tools.length, "step")}</span></summary><ul>${tools.slice(-12).map((t) => `<li><span class="tool">${esc(t.tool)}</span> ${esc(toolHint(t))}</li>`).join("")}</ul></details>`);
  if (lastAgent > lastUser) parts.push(`<div class="msg-agent">${md(ev[lastAgent].text)}</div>`);
  return `<div class="feed">${parts.join("")}</div>`;
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
function toolHint(t) {
  const i = t.input || {};
  if (typeof i === "string") return clip(i, 80);
  return clip(i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.description || i.skill || (i.questions && i.questions[0] && i.questions[0].question) || "", 80);
}

// ---- Cards ---------------------------------------------------------------------
const cardKey = (ref, c, i) => `${ref.file}|${i}|${c.title}`;
function clearSent(file) { for (const k of [...S.sentCards]) if (k.startsWith(file + "|")) S.sentCards.delete(k); for (const k of [...S.answers.keys()]) if (k.startsWith(file + "|")) S.answers.delete(k); }
function allSent(file, g) { return g.cards.every((c, i) => c.kind === "info" || S.sentCards.has(`${file}|${i}|${c.title}`)); }

function genCard(ref, c, i, live) {
  const key = cardKey(ref, c, i);
  const ans = S.answers.get(key);
  const sent = S.sentCards.has(key);
  const kindLabel = { choice: "Choice", approve: "Approval", input: "Answer", teammate: "Teammate", checklist: "Checklist", info: "Note" }[c.kind] || c.kind;
  const stat = sent ? `<span class="qstat done">Sent</span>` : ans ? `<span class="qstat done">${icon("check")}Answered</span>` : c.kind === "info" ? "" : c.kind === "teammate" ? `<span class="qstat team"><span class="dot team"></span>${esc(c.owner || "Teammate")} owes this</span>` : `<span class="qstat needs"><span class="dot needs"></span>Needs you</span>`;
  let body = "";
  const ro = !live || sent;
  if (c.kind === "choice") {
    const picked = ans ? ans.split(" | ") : [];
    body = `<div class="opts" role="${c.multi ? "group" : "radiogroup"}">${(c.options || []).map((o, j) => `
      <button class="opt ${picked.includes(o.label) ? "is-on" : ""}" data-pick="${j}" data-k="${esc(key)}" ${ro ? "disabled" : ""} role="${c.multi ? "checkbox" : "radio"}" aria-checked="${picked.includes(o.label)}">
        <span class="opt-mark ${c.multi ? "sq" : ""}"></span>
        <span class="opt-main"><span class="opt-t">${esc(o.label)}${o.recommended ? `<span class="rec">Recommended</span>` : ""}</span>${o.detail ? `<span class="opt-d">${esc(o.detail)}</span>` : ""}</span>
      </button>`).join("")}</div>`;
  } else if (c.kind === "approve") {
    body = `${c.draft ? `<div class="draft">${md(c.draft)}</div>` : ""}<div class="row-actions">
      <button class="btn ${ans === "Approved." ? "btn-primary" : ""}" data-approve="yes" data-k="${esc(key)}" ${ro ? "disabled" : ""}>Approve</button>
      <button class="btn" data-approve="change" data-k="${esc(key)}" ${ro ? "disabled" : ""}>Ask for changes</button></div>
      ${S.changeOpen.has(key) && ans !== "Approved." ? `<div class="inline-in"><textarea rows="1" data-change="${esc(key)}" placeholder="What should change?" ${ro ? "disabled" : ""}>${esc((ans || "").replace(/^Changes needed: /, ""))}</textarea></div>` : ""}`;
  } else if (c.kind === "input" || c.kind === "teammate") {
    body = `${c.draft ? `<div class="hint-line">Suggested: ${esc(c.draft)}</div>` : ""}
      <div class="inline-in"><textarea rows="1" data-text="${esc(key)}" placeholder="${c.kind === "teammate" ? `Your answer, if you know it` : "Your answer"}" ${ro ? "disabled" : ""}>${esc(ans || "")}</textarea></div>
      ${c.kind === "teammate" ? `<div class="row-actions"><button class="btn" data-copyq="${esc(key)}">Copy question for ${esc(c.owner || "them")}</button></div>` : ""}`;
  } else if (c.kind === "checklist") {
    const done = ans ? ans.split(" | ") : [];
    body = `<ul class="check">${(c.items || []).map((it) => `<li><label><input type="checkbox" data-check="${esc(key)}" value="${esc(it)}" ${done.includes(it) ? "checked" : ""} ${ro ? "disabled" : ""}><span>${esc(it)}</span></label></li>`).join("")}</ul>`;
  } else if (c.kind === "info") {
    body = c.draft ? `<div class="draft">${md(c.draft)}</div>` : "";
  }
  return `<section class="card q ${sent ? "is-sent" : ""}" data-card="${esc(key)}">
    <div class="q-head"><h3>${esc(c.title)}</h3><span class="kind">${esc(kindLabel)}</span>${stat}</div>
    ${c.why ? `<p class="q-why">${esc(c.why)}</p>` : ""}
    ${body}
    ${c.kind !== "info" ? `<div class="q-foot"><button class="btn btn-soft" data-discuss="${i}">${icon("chat")}Not sure? Discuss it</button></div>` : ""}
  </section>`;
}

function answerTray(ref, g) {
  const keys = g.cards.map((c, i) => [c, cardKey(ref, c, i)]).filter(([c]) => c.kind !== "info");
  if (!keys.length) return "";
  const done = keys.filter(([, k]) => S.answers.get(k)).length;
  const sent = keys.every(([, k]) => S.sentCards.has(k));
  if (sent) return "";
  return `<div class="tray"><span class="tray-t"><b>${done} of ${keys.length}</b> answered${done < keys.length ? " · send now or wait for the rest" : ""}</span>
    <button class="btn btn-primary" data-act="send-answers" ${done ? "" : "disabled"}>Send ${done > 1 ? "answers" : "answer"} to ${esc(S.labels[ref.harness])}</button></div>`;
}

function askCard(l) {
  const qs = l.pendingAsk.questions || [];
  return `<section class="card q ask" data-ask="${l.pendingAsk.id}">
    <div class="q-head"><h3>${esc(qs.length === 1 ? qs[0].question : `${qs.length} questions`)}</h3><span class="kind">Asked in ${esc(S.labels[l.harness])}</span><span class="qstat needs"><span class="dot needs"></span>Waiting on you</span></div>
    ${qs.map((q, qi) => `<div class="ask-q">${qs.length > 1 ? `<div class="ask-qt">${esc(q.question)}</div>` : ""}
      <div class="opts" role="${q.multiSelect ? "group" : "radiogroup"}">${(q.options || []).map((o, j) => `
        <button class="opt" data-askpick="${qi}:${j}" role="${q.multiSelect ? "checkbox" : "radio"}" aria-checked="false"><span class="opt-mark ${q.multiSelect ? "sq" : ""}"></span>
        <span class="opt-main"><span class="opt-t">${esc(o.label)}</span>${o.description ? `<span class="opt-d">${esc(o.description)}</span>` : ""}</span></button>`).join("")}
        <div class="opt other"><span class="opt-mark"></span><input data-askother="${qi}" placeholder="Something else…" aria-label="Other answer"></div>
      </div></div>`).join("")}
    <div class="q-foot">
      <button class="btn btn-primary" data-act="ask-send" disabled>Send</button>
      <button class="btn btn-soft" data-act="ask-discuss">${icon("chat")}Discuss it first</button>
      <button class="btn btn-ghost" data-act="ask-term">Answer in the terminal</button>
    </div></section>`;
}

function permissionCard(l) {
  const p = l.pendingPermission;
  const i = p.input || {};
  const what = i.command || i.file_path || i.url || JSON.stringify(i).slice(0, 220);
  return `<section class="card q perm"><div class="q-head"><h3>Allow ${esc(p.tool)}?</h3><span class="qstat needs"><span class="dot needs"></span>Permission</span></div>
    <pre class="code">${esc(what)}</pre>
    <div class="q-foot"><button class="btn btn-primary" data-act="perm-allow">Allow</button><button class="btn" data-act="perm-deny">Deny</button><button class="btn btn-ghost" data-act="perm-term">Decide in the terminal</button></div></section>`;
}

function terminalCard(l) {
  const n = l.terminalNeeds;
  const lbl = n.kind === "trust" ? ["Trust this folder", "Exit"] : ["Yes", "No"];
  return `<section class="card q term-need"><div class="q-head"><h3>${n.kind === "trust" ? "Trust this folder?" : "The terminal needs you"}</h3><span class="qstat needs"><span class="dot needs"></span>In the terminal</span></div>
    <p class="q-why">${esc(n.text)} <span class="mono">${esc(l.cwd)}</span></p>
    <div class="q-foot"><button class="btn btn-primary" data-act="term-yes">${lbl[0]}</button><button class="btn" data-act="term-no">${lbl[1]}</button><button class="btn btn-ghost" data-act="term-open">Open the terminal</button></div></section>`;
}

function wireFlow(ref) {
  const f = $("#s-flow");
  f.querySelectorAll("[data-act=regen]").forEach((b) => (b.onclick = () => ensureGen(true)));
  const g = genFor(ref.file);
  // Generated cards
  f.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
    const key = b.dataset.k; const i = +key.split("|")[1]; const c = g.cards[i]; const o = c.options[+b.dataset.pick];
    let cur = (S.answers.get(key) || "").split(" | ").filter(Boolean);
    if (c.multi) cur = cur.includes(o.label) ? cur.filter((x) => x !== o.label) : [...cur, o.label]; else cur = [o.label];
    cur.length ? S.answers.set(key, cur.join(" | ")) : S.answers.delete(key); renderMain();
  }));
  f.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => {
    const key = b.dataset.k;
    if (b.dataset.approve === "yes") S.answers.set(key, "Approved.");
    else { S.changeOpen.add(key); if (S.answers.get(key) === "Approved.") S.answers.delete(key); }
    renderMain();
    if (b.dataset.approve !== "yes") setTimeout(() => $(`[data-change="${CSS.escape(key)}"]`)?.focus(), 0);
  }));
  f.querySelectorAll("[data-text]").forEach((t) => {
    autosize(t);
    t.oninput = () => { autosize(t); t.value.trim() ? S.answers.set(t.dataset.text, t.value.trim()) : S.answers.delete(t.dataset.text); updateTray(ref); };
  });
  f.querySelectorAll("[data-change]").forEach((t) => {
    autosize(t);
    t.oninput = () => { autosize(t); t.value.trim() ? S.answers.set(t.dataset.change, "Changes needed: " + t.value.trim()) : S.answers.delete(t.dataset.change); updateTray(ref); };
  });
  f.querySelectorAll("[data-check]").forEach((c) => (c.onchange = () => {
    const key = c.dataset.check; const vals = [...f.querySelectorAll(`[data-check="${CSS.escape(key)}"]:checked`)].map((x) => x.value);
    vals.length ? S.answers.set(key, vals.join(" | ")) : S.answers.delete(key); renderMain();
  }));
  f.querySelectorAll("[data-copyq]").forEach((b) => (b.onclick = async () => {
    const i = +b.dataset.copyq.split("|")[1]; const c = g.cards[i];
    try { await navigator.clipboard.writeText(`${c.title}${c.why ? `\n(${c.why})` : ""}`); toast("Copied. Paste it to " + (c.owner || "them") + "."); } catch { toast("Couldn't copy"); }
  }));
  f.querySelectorAll("[data-discuss]").forEach((b) => (b.onclick = () => {
    const c = g.cards[+b.dataset.discuss];
    openSide(ref, c.title + (c.why ? ` (${c.why})` : "") + (c.options ? `. Options: ${c.options.map((o) => o.label).join("; ")}` : ""), { cardKey: cardKey(ref, c, +b.dataset.discuss) });
  }));
  f.querySelectorAll("[data-act=send-answers]").forEach((b) => (b.onclick = () => sendAnswers(ref)));
  if (ref.kind !== "live") return;
  const l = ref.l;
  // AskUserQuestion
  const ask = f.querySelector("[data-ask]");
  if (ask) {
    const qs = l.pendingAsk.questions || [];
    const picks = qs.map(() => new Set()), other = qs.map(() => "");
    const sync = () => {
      ask.querySelectorAll("[data-askpick]").forEach((b) => { const [qi, j] = b.dataset.askpick.split(":").map(Number); const on = picks[qi].has(j); b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on); });
      ask.querySelector("[data-act=ask-send]").disabled = !qs.every((q, qi) => picks[qi].size || other[qi].trim());
    };
    ask.querySelectorAll("[data-askpick]").forEach((b) => (b.onclick = () => {
      const [qi, j] = b.dataset.askpick.split(":").map(Number);
      if (qs[qi].multiSelect) picks[qi].has(j) ? picks[qi].delete(j) : picks[qi].add(j); else { picks[qi].clear(); picks[qi].add(j); other[qi] = ""; ask.querySelector(`[data-askother="${qi}"]`).value = ""; }
      sync();
    }));
    ask.querySelectorAll("[data-askother]").forEach((inp) => (inp.oninput = () => { const qi = +inp.dataset.askother; other[qi] = inp.value; if (inp.value && !qs[qi].multiSelect) picks[qi].clear(); sync(); }));
    ask.querySelector("[data-act=ask-send]").onclick = async () => {
      const answers = {};
      qs.forEach((q, qi) => { const labels = [...picks[qi]].map((j) => q.options[j].label); if (other[qi].trim()) labels.push(other[qi].trim()); answers[q.question] = labels.join(", "); });
      try { await api(`/api/sessions/${l.id}/ask`, { qid: l.pendingAsk.id, answers }); toast("Answer sent."); } catch (e) { toast(e.message); }
    };
    ask.querySelector("[data-act=ask-term]").onclick = async () => { try { await api(`/api/sessions/${l.id}/ask`, { qid: l.pendingAsk.id, answers: null }); S.tab = "terminal"; renderMain(); } catch (e) { toast(e.message); } };
    ask.querySelector("[data-act=ask-discuss]").onclick = () => openSide(ref, qs.map((q) => `${q.question} Options: ${(q.options || []).map((o) => o.label).join("; ")}`).join(" / "), { ask: true });
  }
  const on = (sel, fn) => f.querySelectorAll(sel).forEach((b) => (b.onclick = fn));
  on("[data-act=perm-allow]", () => api(`/api/sessions/${l.id}/permission`, { qid: l.pendingPermission.id, allow: true }).catch((e) => toast(e.message)));
  on("[data-act=perm-deny]", () => api(`/api/sessions/${l.id}/permission`, { qid: l.pendingPermission.id, allow: false }).catch((e) => toast(e.message)));
  on("[data-act=perm-term]", () => api(`/api/sessions/${l.id}/permission`, { qid: l.pendingPermission.id, allow: null }).then(() => { S.tab = "terminal"; renderMain(); }).catch((e) => toast(e.message)));
  on("[data-act=term-yes]", () => api(`/api/sessions/${l.id}/terminal`, { choice: "yes" }).catch((e) => toast(e.message)));
  on("[data-act=term-no]", () => api(`/api/sessions/${l.id}/terminal`, { choice: "no" }).catch((e) => toast(e.message)));
  on("[data-act=term-open]", () => { S.tab = "terminal"; renderMain(); });
}

function updateTray(ref) {
  const g = genFor(ref.file); const tray = $("#s-flow .tray");
  if (!g || !tray) return;
  const tmp = document.createElement("div"); tmp.innerHTML = answerTray(ref, g);
  if (tmp.firstElementChild) { tray.replaceWith(tmp.firstElementChild); $("#s-flow [data-act=send-answers]").onclick = () => sendAnswers(ref); }
}

async function sendAnswers(ref) {
  const g = genFor(ref.file);
  const lines = [];
  g.cards.forEach((c, i) => { const k = cardKey(ref, c, i); const a = S.answers.get(k); if (a && !S.sentCards.has(k)) lines.push({ c, a, k }); });
  if (!lines.length) return;
  const text = lines.length === 1 ? `${lines[0].c.title}\n${lines[0].a}` : `Answers to your questions:\n${lines.map((x, n) => `${n + 1}. ${x.c.title}\n   ${x.a}`).join("\n")}`;
  try { await api(`/api/sessions/${ref.id}/send`, { text }); lines.forEach((x) => S.sentCards.add(x.k)); toast(`Sent ${plural(lines.length, "answer")}.`); renderMain(); }
  catch (e) { toast(e.message); }
}

// ---- Dock (composer) ---------------------------------------------------------------------
function updateDock(ref) {
  const dock = $("#dock");
  const key = (ref.kind === "live" ? "L:" + ref.id + ":" + ref.alive : "F:" + ref.file);
  if (dock.dataset.key !== key) {
    dock.dataset.key = key;
    if (ref.kind === "live" && ref.alive) {
      dock.innerHTML = `<div class="composer"><textarea id="compose" rows="1" placeholder="Reply to ${esc(S.labels[ref.harness])}" aria-label="Message the session"></textarea>
        <div class="composer-row"><span class="chip">${icon("folder")}${esc(shortPath(ref.cwd))}</span><span class="chip" title="Runs in a real ${esc(S.labels[ref.harness])} terminal inside GenUI Agent">${icon("term")}${esc(S.labels[ref.harness])}</span>
        <button class="btn btn-ghost sm" id="stop-sess">Stop</button><button class="send" id="send-btn" aria-label="Send">${icon("up")}</button></div></div>`;
      const ta = $("#compose");
      const submit = async () => { const v = ta.value.trim(); if (!v) return; try { await api(`/api/sessions/${ref.id}/send`, { text: v }); ta.value = ""; autosize(ta); } catch (e) { toast(e.message); } };
      ta.oninput = () => autosize(ta);
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };
      $("#send-btn").onclick = submit;
      armed($("#stop-sess"), "Stop session?", () => api(`/api/sessions/${ref.id}/stop`, {}).catch((e) => toast(e.message)));
    } else if (ref.kind === "live") {
      dock.innerHTML = `<div class="dock-note">This session has ended. ${ref.harness === "claude" ? `<button class="btn" id="resume-btn">Resume it in a terminal</button>` : ""}</div>`;
      const rb = $("#resume-btn"); if (rb) armed(rb, "Resume: continues the original session", () => resume(ref.harness, ref.id, ref.cwd));
    } else {
      dock.innerHTML = `<div class="dock-note">${icon("eye")}Read-only view of a saved session. <button class="btn btn-ghost sm" id="resume-btn">Resume it in a terminal…</button></div>`;
      armed($("#resume-btn"), "Resume: continues the original session", () => resume(ref.harness, ref.saved.id, ref.cwd));
    }
  }
}

async function resume(harness, id, cwd) {
  try { const s = await api("/api/resume", { harness, id, cwd, confirm: true }); S.live.set(s.id, s); openLive(s.id); } catch (e) { toast(e.message); }
}

// ---- Terminal --------------------------------------------------------------------
function mountTerm(ref) {
  const host = $("#term-host");
  if (!host) return;
  let t = terms.get(ref.id);
  if (!t) {
    const el = document.createElement("div"); el.className = "xterm-wrap";
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const term = new window.Terminal({ fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, allowProposedApi: true, scrollback: 5000,
      theme: dark ? { background: "#0e0e10", foreground: "#e4e4e7", cursor: "#e4e4e7", selectionBackground: "#3f3f46" } : { background: "#fbfbfa", foreground: "#18181b", cursor: "#18181b", selectionBackground: "#dbeafe", black: "#18181b", brightBlack: "#71717a", white: "#e4e4e7", brightWhite: "#fafafa" } });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.onData((d) => send({ type: "input", id: ref.id, data: d }));
    t = { term, fit, el };
    terms.set(ref.id, t);
    send({ type: "sub", id: ref.id });
    new ResizeObserver(() => fitTerm(t)).observe(el);
  }
  if (t.el.parentElement !== host) { host.innerHTML = ""; host.appendChild(t.el); }
  setTimeout(() => fitTerm(t), 0);
}
function fitTerm(t) { try { t.fit.fit(); send({ type: "resize", id: [...terms.entries()].find(([, v]) => v === t)[0], cols: t.term.cols, rows: t.term.rows }); } catch {} }

// ---- Side discussion ---------------------------------------------------------------------
async function openSide(ref, topic, extra = {}) {
  S.side = { ref: { kind: ref.kind, id: ref.id, harness: ref.harness, file: ref.file, cwd: ref.cwd }, topic, extra, data: null, busy: true, err: "", composing: false, composed: "" };
  renderDiscuss();
  try {
    S.side.data = await api("/api/side", { harness: ref.harness, file: ref.file, mainId: ref.kind === "live" && ref.harness === "claude" ? ref.id : (ref.harness === "claude" ? (S.saved.find((s) => s.file === ref.file) || {}).id : null), cwd: ref.cwd, topic });
  } catch (e) { S.side.err = e.message; }
  S.side.busy = false; renderDiscuss();
  setTimeout(() => $("#side-in")?.focus(), 30);
}

function renderDiscuss() {
  const el = $("#discuss");
  const sd = S.side;
  if (!sd) { el.hidden = true; document.body.classList.remove("has-side"); return; }
  el.hidden = false; document.body.classList.add("has-side");
  const d = sd.data;
  const mainCtx = (current() || {}).context;
  const receives = sd.composed ? Math.round(sd.composed.length / 4) : 0;
  const forked = sd.ref.harness === "claude";
  const keepDraft = $("#side-in") ? $("#side-in").value : "";
  const keepComposed = $("#side-composed") ? $("#side-composed").value : null;
  el.innerHTML = `
    <header class="d-head">
      <div class="d-title"><span class="dot run"></span><h2>Side discussion</h2><button class="icon-btn" id="side-close" aria-label="Close">${icon("x")}</button></div>
      <p class="d-topic">${esc(clip(sd.topic, 220))}</p>
      <div class="d-reads">${forked ? `<span>${icon("branch")}Forked from this session: full context, original untouched</span>` : `<span>${icon("eye")}Reads this session's transcript</span>`}<span>${icon("lock")}Read-only tools</span></div>
    </header>
    <div class="d-body" id="side-body">
      ${(d ? d.msgs : []).map((m) => `<div class="d-msg ${m.who}">${m.who === "ai" ? md(m.text) : esc(m.text)}</div>`).join("")}
      ${sd.busy ? `<div class="d-msg ai pending"><span class="spin"></span>${d ? "Thinking…" : forked ? "Forking the session…" : "Reading the session…"}</div>` : ""}
      ${sd.err ? `<div class="d-err">${esc(sd.err)}</div>` : ""}
    </div>
    <div class="d-meter">
      <span>This discussion</span><b title="${d ? `The side agent's whole context is ${kt(d.contextTokens)} tokens, including its copy of the session` : ""}">${d ? `~${kt(discussTokens(d))} tokens` : "—"} <span class="muted">· kept out</span></b>
      <span>Main session receives</span><b>${receives ? `~${kt(receives)} tokens` : "nothing yet"}</b>
      ${mainCtx ? `<span>Main session context</span><b>${mainCtx.pct}%${receives ? ` → ${Math.min(100, mainCtx.pct + Math.max(1, Math.round((receives / mainCtx.window) * 100)))}%` : ""}</b>` : ""}
    </div>
    <div class="d-foot">
      ${sd.composing ? `
        <div class="composed"><div class="composed-h">Answer for the agent · edit before sending</div><textarea id="side-composed" aria-label="Composed answer">${esc(sd.composed)}</textarea></div>
        <div class="d-actions">${sd.ref.kind === "live" && (S.live.get(sd.ref.id) || {}).alive ? `<button class="btn btn-primary" id="side-send">Send to ${esc(S.labels[sd.ref.harness])}</button>` : `<button class="btn btn-primary" id="side-copy">Copy answer</button>`}<button class="btn" id="side-back">Keep discussing</button></div>`
      : `<div class="composer small"><textarea id="side-in" rows="2" placeholder="Push back, ask why, or ask it to check something" aria-label="Message the side agent" ${sd.busy || !d ? "disabled" : ""}></textarea>
          <div class="composer-row"><span class="muted xs">Nothing here reaches the main session until you send.</span><button class="send" id="side-msg" aria-label="Send" ${sd.busy || !d ? "disabled" : ""}>${icon("up")}</button></div></div>
        <div class="d-actions"><button class="btn btn-primary" id="side-compose" ${sd.busy || !d ? "disabled" : ""}>Compose answer</button><span class="muted xs">Writes one complete answer from this discussion.</span></div>`}
    </div>`;
  const body = $("#side-body"); body.scrollTop = body.scrollHeight;
  $("#side-close").onclick = () => { S.side = null; renderDiscuss(); };
  if (sd.composing) {
    const ta = $("#side-composed"); if (keepComposed !== null) ta.value = keepComposed;
    ta.oninput = () => { sd.composed = ta.value; };
    $("#side-back").onclick = () => { sd.composing = false; renderDiscuss(); };
    const sb = $("#side-send");
    if (sb) sb.onclick = async () => {
      const text = ta.value.trim(); if (!text) return;
      try {
        if (sd.extra.ask) { const l = S.live.get(sd.ref.id); if (l && l.pendingAsk) { const answers = {}; (l.pendingAsk.questions || []).forEach((q) => (answers[q.question] = text)); await api(`/api/sessions/${l.id}/ask`, { qid: l.pendingAsk.id, answers }); } else await api(`/api/sessions/${sd.ref.id}/send`, { text }); }
        else await api(`/api/sessions/${sd.ref.id}/send`, { text });
        await api(`/api/side/${d.id}/sent`, { text });
        if (sd.extra.cardKey) { S.answers.set(sd.extra.cardKey, "(answered from a side discussion)"); S.sentCards.add(sd.extra.cardKey); }
        toast(`Sent ~${kt(Math.round(text.length / 4))} tokens. ~${kt(discussTokens(d))} tokens of discussion stayed out of the session.`);
        S.side = null; render();
      } catch (e) { toast(e.message); }
    };
    const cb = $("#side-copy");
    if (cb) cb.onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch { toast("Couldn't copy"); } };
  } else {
    const ta = $("#side-in"); ta.value = keepDraft; autosize(ta);
    const msg = async () => {
      const v = ta.value.trim(); if (!v || sd.busy) return;
      sd.busy = true; d.msgs.push({ who: "me", text: v }); ta.value = ""; renderDiscuss();
      try { const r = await api(`/api/side/${d.id}/msg`, { text: v }); sd.data = r; } catch (e) { sd.err = e.message; d.msgs.pop(); }
      sd.busy = false; renderDiscuss(); $("#side-in")?.focus();
    };
    ta.oninput = () => autosize(ta);
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); msg(); } };
    $("#side-msg").onclick = msg;
    $("#side-compose").onclick = async () => {
      sd.busy = true; renderDiscuss();
      try { const r = await api(`/api/side/${d.id}/compose`, {}); sd.data = r; sd.composed = r.composed; sd.composing = true; } catch (e) { sd.err = e.message; }
      sd.busy = false; renderDiscuss(); $("#side-composed")?.focus();
    };
  }
}

// What the back-and-forth itself weighs (the part a normal reply would have added to the main session).
function discussTokens(d) { return Math.round((d.msgs || []).reduce((n, m) => n + (m.text || "").length, 0) / 4) + (d.toolTokens || 0); }

// ---- Orchestrator overview -------------------------------------------------------------
function renderOverview() {
  const liveRows = [...S.live.values()].sort((a, b) => (liveStatus(b) === STATUS.needs) - (liveStatus(a) === STATUS.needs) || b.createdAt - a.createdAt);
  const recent = S.saved.filter((s) => genFor(s.file) && !liveRows.some((l) => l.file === s.file)).slice(0, 8);
  const flowRow = (steps) => `<div class="hrail">${(steps || []).map((s) => `<div class="hn ${s.state}" title="${esc(s.label)}"><span class="node"></span><span class="hl">${esc(s.label)}</span></div>`).join("")}</div>`;
  const card = (t, sub, st, g, attrs) => `<button class="card ov" ${attrs}>
    <div class="ov-top"><b>${esc(t)}</b>${sub}${st}</div>
    ${g ? flowRow(g.steps) : `<div class="ov-empty muted">${S.genBusy.size ? "" : "Flow appears after the first turn."}</div>`}
    ${g && g.now ? `<div class="ov-now">${esc(g.now)}</div>` : ""}</button>`;
  return `<div class="col wide">
    <header class="page-head"><h1>Orchestrator</h1><p class="muted">Every session as a flow, generated from its transcript. Sessions that need you come first.</p></header>
    ${S.plans.length ? `<h2 class="sec">Plans</h2><div class="ov-list">${S.plans.slice(0, 6).map((p, pi) => `
      <div class="card ov plan"><div class="ov-top"><b>${esc(p.title)}</b><span class="muted xs">${esc(shortPath(p.cwd))}</span></div>
      <ol class="hrail">${p.steps.map((s, i) => `<li class="hn ${p.started && p.started[i] ? (S.live.get(p.started[i]) && S.live.get(p.started[i]).alive ? "current" : "done") : "next"}"><span class="node"></span><span class="hl">${esc(s.label)}</span></li>`).join("")}</ol>
      <div class="row-actions">${p.steps.map((s, i) => (p.started && p.started[i]) ? `<button class="btn sm" data-planopen="${pi}:${i}">Open step ${i + 1}</button>` : `<button class="btn sm ${i === (p.started || []).filter(Boolean).length ? "btn-primary" : ""}" data-planstart="${pi}:${i}">Start step ${i + 1}${s.harness !== "you" ? ` · ${esc(S.labels[s.harness] || s.harness)}` : ""}</button>`).join("")}</div></div>`).join("")}</div>` : ""}
    <h2 class="sec">Running here</h2>
    ${liveRows.length ? `<div class="ov-list">${liveRows.map((l) => { const st = liveStatus(l); return card(title(l), `<span class="hchip">${esc(S.labels[l.harness])}</span>`, `<span class="spill ${st.cls}"><span class="dot ${st.cls}"></span>${st.label}</span>`, genFor(l.file), `data-live="${l.id}"`); }).join("")}</div>`
      : `<div class="empty card"><p><b>Nothing running yet.</b> Start a goal and the orchestrator plans it into steps, or open a saved session on the left to see its flow.</p><button class="btn btn-primary" data-go="new">New goal</button></div>`}
    ${recent.length ? `<h2 class="sec">Recently viewed</h2><div class="ov-list">${recent.map((s) => card(genFor(s.file).title || s.title, `<span class="hchip">${esc(S.labels[s.harness])}</span>`, `<span class="spill off">${esc(ago(s.mtime))}</span>`, genFor(s.file), `data-file="${esc(s.file)}" data-h="${s.harness}"`)).join("")}</div>` : ""}
  </div>`;
}
function wireOverview() {
  const m = $("#main");
  m.querySelectorAll("[data-live]").forEach((b) => (b.onclick = () => openLive(b.dataset.live)));
  m.querySelectorAll("[data-file]").forEach((b) => (b.onclick = () => openSaved(b.dataset.file, b.dataset.h)));
  m.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  m.querySelectorAll("[data-planstart]").forEach((b) => (b.onclick = () => { const [pi, i] = b.dataset.planstart.split(":").map(Number); startStep(S.plans[pi], i); }));
  m.querySelectorAll("[data-planopen]").forEach((b) => (b.onclick = () => { const [pi, i] = b.dataset.planopen.split(":").map(Number); openLive(S.plans[pi].started[i]); }));
}

// ---- New goal ---------------------------------------------------------------------
function renderNew() {
  return `<div class="col">
    <header class="page-head"><h1>New goal</h1><p class="muted">Describe what should get done. The orchestrator plans it into steps, picks a harness for each, and predicts what each step will need from you.</p></header>
    <div class="composer big"><textarea id="ng-goal" rows="3" placeholder="e.g. Add dark mode to the settings page and open a PR" aria-label="Goal"></textarea>
      <div class="composer-row"><button class="chip chip-btn" id="ng-folder">${icon("folder")}<span id="ng-folder-t">Choose a folder</span></button><span class="muted xs" id="ng-avail"></span><button class="btn btn-primary" id="ng-plan">Plan it</button></div></div>
    <div id="ng-picker" class="picker" hidden></div>
    <div id="ng-out"></div>
  </div>`;
}
function updateNew() {
  const ng = S.newGoal;
  const out = $("#ng-out"); if (!out) return;
  $("#ng-folder-t").textContent = ng.cwd ? shortPath(ng.cwd) : "Choose a folder";
  $("#ng-plan").disabled = ng.busy;
  $("#ng-plan").innerHTML = ng.busy ? `<span class="spin light"></span>Planning…` : ng.plan ? "Plan again" : "Plan it";
  $("#ng-avail").textContent = Object.entries(S.harnesses).filter(([, v]) => v).map(([k]) => S.labels[k]).join(" · ");
  if (ng.err) { out.innerHTML = `<div class="card"><p class="muted">${esc(ng.err)}</p></div>`; return; }
  if (ng.busy && !ng.plan) { out.innerHTML = `<section class="card goal skeleton"><div class="goal-top"><span class="eyebrow">Plan</span><span class="gen-tag"><span class="spin"></span>The orchestrator is planning</span></div><div class="sk sk-l"></div><div class="sk-rail">${"<div class=\"sk-step\"><i></i><span class=\"sk sk-s\"></span></div>".repeat(5)}</div></section>`; return; }
  const p = ng.plan; if (!p) { out.innerHTML = ""; return; }
  out.innerHTML = `<section class="card goal plan-card">
    <div class="goal-top"><span class="eyebrow">Plan</span><span class="gen-tag">✦ Generated</span></div>
    <h2 class="plan-t">${esc(p.title)}</h2><p class="goal-text">${esc(p.goal)}</p>
    <ol class="rail">${p.steps.map((s, i) => `<li class="step next plan-step" style="animation-delay:${i * 60}ms">
      <span class="node"></span><span class="lbl">${esc(s.label)}</span>
      <span class="meta"><select data-harness="${i}" aria-label="Harness for step ${i + 1}">${["claude", "codex", "grok", "you"].filter((h) => h === "you" || S.harnesses[h]).map((h) => `<option value="${h}" ${s.harness === h ? "selected" : ""}>${h === "you" ? "You" : esc(S.labels[h])}</option>`).join("")}</select></span>
      ${s.why ? `<span class="why">${esc(s.why)}</span>` : ""}
      ${(s.needs || []).length ? `<div class="needs">${s.needs.map((n, j) => `<label class="need"><span class="who ${n.owner === "you" ? "you" : "team"}">${n.owner === "you" ? "You" : esc(n.owner)}</span><span class="need-q">${esc(n.question)}</span><input data-need="${esc(n.question)}" placeholder="${n.owner === "you" ? "Answer now (optional)" : "If you know it"}" value="${esc(ng.answers[n.question] || "")}"></label>`).join("")}</div>` : ""}
    </li>`).join("")}</ol>
    <div class="row-actions"><button class="btn btn-primary" id="ng-start">Start step 1 · ${esc(S.labels[p.steps[0].harness] || "Claude Code")}</button><span class="muted xs">Answers you give now go to each step's worker up front.</span></div>
  </section>`;
}
function wireNew() {
  const ng = S.newGoal;
  const goal = $("#ng-goal");
  if (goal && !goal.dataset.w) { goal.dataset.w = 1; goal.value = ng.goal; goal.oninput = () => { ng.goal = goal.value; autosize(goal); }; goal.focus(); }
  updateNew();
  $("#ng-plan").onclick = async () => {
    if (!ng.goal.trim()) return toast("Describe the goal first.");
    if (!ng.cwd) return toast("Choose the project folder first.");
    ng.busy = true; ng.err = ""; ng.plan = null; updateNew();
    try { ng.plan = await api("/api/plan", { goal: ng.goal, cwd: ng.cwd }); } catch (e) { ng.err = e.message; }
    ng.busy = false; updateNew(); wireNew();
  };
  $("#ng-folder").onclick = () => browse(ng.cwd || "");
  $("#main").querySelectorAll("[data-harness]").forEach((s) => (s.onchange = () => { ng.plan.steps[+s.dataset.harness].harness = s.value; updateNew(); wireNew(); }));
  $("#main").querySelectorAll("[data-need]").forEach((i) => (i.oninput = () => { ng.answers[i.dataset.need] = i.value; }));
  const st = $("#ng-start");
  if (st) st.onclick = async () => {
    const plan = { ...ng.plan, cwd: ng.cwd, answers: { ...ng.answers }, started: [], at: Date.now() };
    S.plans.unshift(plan); savePlans();
    await startStep(plan, 0);
    S.newGoal = { goal: "", cwd: ng.cwd, plan: null, busy: false, err: "", answers: {} };
  };
}
async function startStep(plan, i) {
  try {
    const s = await api("/api/plan/start", { plan, index: i, cwd: plan.cwd, answers: plan.answers || {} });
    plan.started = plan.started || []; plan.started[i] = s.id; savePlans();
    S.live.set(s.id, s); toast(`Started step ${i + 1} in ${S.labels[s.harness]}.`); openLive(s.id);
  } catch (e) { toast(e.message); }
}
async function browse(path) {
  const pk = $("#ng-picker");
  const r = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  pk.hidden = false;
  pk.innerHTML = `<div class="pk-head"><button class="icon-btn" data-up aria-label="Up">${icon("back")}</button><span class="mono pk-path">${esc(r.path)}</span><button class="btn btn-primary sm" data-use>Use this folder</button></div>
    <div class="pk-list">${r.dirs.map((d) => `<button class="pk-item" data-d="${esc(d)}">${icon("folder")}${esc(d)}</button>`).join("") || `<div class="muted xs" style="padding:10px">No folders here.</div>`}</div>`;
  pk.querySelector("[data-up]").onclick = () => browse(r.parent);
  pk.querySelector("[data-use]").onclick = () => { S.newGoal.cwd = r.path; pk.hidden = true; updateNew(); };
  pk.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => browse(r.path.replace(/[\\/]$/, "") + "\\" + b.dataset.d)));
}

// ---- Bits ---------------------------------------------------------------------
// Two-step buttons instead of browser dialogs: the first click asks, the second acts.
function armed(btn, askLabel, fn) {
  const orig = btn.innerHTML;
  btn.onclick = () => {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = orig; btn.classList.remove("is-armed"); fn(); return; }
    btn.dataset.armed = "1"; btn.innerHTML = esc(askLabel); btn.classList.add("is-armed");
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = orig; btn.classList.remove("is-armed"); } }, 4000);
  };
}
function autosize(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; }
function toast(msg, opts = {}) {
  const box = $("#toasts");
  const t = document.createElement("div"); t.className = "toast";
  t.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button>${esc(opts.action)}</button>` : ""}`;
  if (opts.action) t.querySelector("button").onclick = () => { opts.onAction(); t.remove(); };
  box.appendChild(t);
  setTimeout(() => t.classList.add("out"), 4200); setTimeout(() => t.remove(), 4600);
}
function icon(n) {
  const p = {
    flow: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10"/><path d="M11 5h8M11 12h6M11 19h8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', check: '<path d="m5 12 5 5 9-10"/>', chat: '<path d="M5 18 3 21V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', term: '<path d="m5 8 4 4-4 4M12 16h7"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4-6 3-11 6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
  }[n] || "";
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.side) { S.side = null; renderDiscuss(); } });
connect();
refresh().catch((e) => toast(e.message));
setInterval(() => refresh().catch(() => {}), 30000);
window.GENUI = { S, render, openLive, openSaved, go };
