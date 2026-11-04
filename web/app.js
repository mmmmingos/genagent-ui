// GenUI Agent — the window. Plain modules, no build step.
// Rendering: each region is rebuilt as an HTML string and morphed into place (morphdom), so focus,
// typed text and scroll positions survive live updates and only genuinely new elements animate in.
import morphdom from "/vendor/morphdom/morphdom-esm.js";
import { md, esc, ago, kt, plural } from "/web/util.js";

const $ = (s, r = document) => r.querySelector(s);
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && !S.authLost) { S.authLost = true; const b = document.createElement("div"); b.className = "authlost"; b.textContent = "GenUI Agent restarted. Close this window and open it again from the desktop shortcut."; document.body.appendChild(b); }
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};

// ---- State ---------------------------------------------------------------------
const S = {
  harnesses: {}, labels: { claude: "Claude Code", codex: "Codex", grok: "Grok" },
  live: new Map(), saved: [],
  gens: new Map(), genBusy: new Set(), genMid: new Set(), genErr: new Map(),
  views: new Map(), liveTail: new Map(),
  sel: null, page: "overview", tab: "flow", search: "",
  drafts: new Map(),       // field drafts and per-session composer drafts
  open: new Set(),         // opened steps and folds in the timeline
  workingSince: new Map(),
  // Needs from you: answers picked (by session|need), questions answered on the side, sent ones.
  ans: new Map(), elseOpen: new Set(), worked: new Set(), sentAsks: new Set(), doneNow: new Map(), replyEdited: new Set(), focusNeed: null,
  seen: loadSeen(), look: null, appAway: null, blurAt: 0, dashTab: "agents", viewFetch: new Set(),
  sides: new Map(), sideOpen: false,
  plans: loadPlans(),
  ng: { goal: "", cwd: "", plan: null, busy: false, err: "", answers: {}, startedAt: 0, harness: "claude", going: false },
  picker: null, toolsOpen: new Set(), inflight: new Set(), armed: null, sentItems: loadSent(), authLost: false,
};
function loadSent() { try { return new Map(JSON.parse(localStorage.getItem("genui.sent") || "[]")); } catch { return new Map(); } }
function saveSent() { try { localStorage.setItem("genui.sent", JSON.stringify([...S.sentItems].slice(-200))); } catch {} }
const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
function loadPlans() { try { return JSON.parse(localStorage.getItem("genui.plans") || "[]").filter((p) => p && Array.isArray(p.steps) && p.steps.length); } catch { return []; } }
function savePlans() { try { localStorage.setItem("genui.plans", JSON.stringify(S.plans.slice(0, 30))); } catch {} }
const terms = new Map();

// ---- Live connection -------------------------------------------------------------
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { for (const id of terms.keys()) ws.send(JSON.stringify({ type: "sub", id })); refresh().catch(() => {}); };
  ws.onclose = () => setTimeout(connect, 1200);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "pty" || msg.type === "replay") { const t = terms.get(msg.id); if (t) { if (msg.type === "replay" && msg.data) t.term.reset(); t.term.write(msg.data); } return; }
    if (msg.type === "session") {
      const prev = S.live.get(msg.session.id), s = msg.session;
      if (s.status === "working" && (!prev || prev.status !== "working")) S.workingSince.set(s.id, Date.now());
      S.live.set(s.id, s);
      if ((msg.what === "ask" || msg.what === "permission") && !isOnScreen(s.id)) notify("Needs your answer", title(s), "needs", () => openLive(s.id));
      if (msg.what === "turn-end" && !isOnScreen(s.id)) notify("Finished its turn", title(s), "ok", () => openLive(s.id), 5000);
      schedule(); return;
    }
    if (msg.type === "gone") { S.live.delete(msg.id); schedule(); return; }
    if (msg.type === "transcript") { S.liveTail.set(msg.id, { last: msg.last, context: msg.context, count: msg.count, plan: msg.plan, timeline: msg.timeline, userTurns: msg.userTurns }); schedule(); return; }
    if (msg.type === "gen-start") { (msg.midTurn ? S.genMid : S.genBusy).add(msg.file); schedule(); return; }
    if (msg.type === "gen") { mergeGen(msg.file, msg.gen); S.genBusy.delete(msg.file); S.genMid.delete(msg.file); schedule(); return; }
    if (msg.type === "gen-error") { S.genBusy.delete(msg.file); S.genMid.delete(msg.file); schedule(); return; }
    if (msg.type === "side") { for (const sd of S.sides.values()) if (sd.data && sd.data.id === msg.side.id) { sd.data = msg.side; sd.busy = msg.side.busy; sd.err = msg.side.err || ""; } schedule(); scrollSide(); }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const isOnScreen = (id) => S.page === "session" && S.sel && S.sel.kind === "live" && S.sel.id === id && document.visibilityState === "visible";

async function refresh(force) {
  const st = await api(`/api/state${force ? "?refresh=1" : ""}`);
  S.harnesses = st.harnesses; S.labels = st.labels; S.saved = st.saved;
  const seen = new Set(st.live.map((l) => l.id));
  for (const l of st.live) S.live.set(l.id, l);
  // Sessions the server no longer knows (it restarted) are shown as ended, not running.
  for (const [id, l] of S.live) if (!seen.has(id) && l.alive) S.live.set(id, { ...l, alive: false, status: "exited", pendingAsk: null, pendingPermission: null, terminalNeeds: null });
  // A new session left unused (the window closed on it) is discarded; the one on screen stays.
  for (const l of st.live) if (l.fresh && !(S.page === "session" && S.sel?.id === l.id) && Date.now() - l.createdAt > 15000) discard(l.id);
  // A session that hasn't changed since the window opened has sent no transcript yet: read it once.
  for (const l of st.live) if (l.file && !S.liveTail.has(l.id) && !S.viewFetch.has(l.id)) {
    S.viewFetch.add(l.id);
    api(`/api/view?harness=${encodeURIComponent(l.harness)}&file=${encodeURIComponent(l.file)}`).then((v) => {
      if (!S.liveTail.has(l.id)) S.liveTail.set(l.id, { last: v.events.slice(-30), context: v.context, count: v.total, plan: v.plan, timeline: v.timeline, userTurns: v.userTurns });
      if (v.gen && !S.gens.has(l.file)) S.gens.set(l.file, v.gen);
      schedule();
    }).catch(() => {}).finally(() => S.viewFetch.delete(l.id));
  }
  schedule();
}

// The AI layer's latest notes for a transcript. Mid-turn updates leave the asks as they were.
function mergeGen(file, gen) { S.gens.set(file, gen); }

// ---- Render loop -----------------------------------------------------------------
let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
const MORPH = {
  onBeforeElUpdated(from, to) {
    if (from.hasAttribute && from.hasAttribute("data-keep")) {
      // User-owned inputs keep their value; their labels still follow the state.
      for (const a of ["placeholder", "aria-label", "disabled", "title", "data-draft"]) { if (to.hasAttribute(a)) from.setAttribute(a, to.getAttribute(a)); else from.removeAttribute(a); }
      return false;
    }
    return !from.isEqualNode(to);
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
  else if (S.page === "new" || S.page === "plan") morph(view, newGoalHTML());
  else { const ref = current(); if (!ref) { S.page = "overview"; return render(); } morph(view, sessionHTML(ref)); }
  // A session is shown with its rail on the right (the flowchart, or the side chat): beside its
  // terminal when it runs here, beside the conversation when it's a saved one.
  const onSession = S.page === "session";
  $(".main").classList.toggle("agent", onSession && S.sel?.kind === "live");
  $(".main").classList.toggle("withrail", onSession);
  $(".main").classList.toggle("norail", onSession && S.sel?.kind === "live" && !railWanted(current()));
  renderTerm();
  autosizeAll();
  if (S.page === "session") { syncReply(); drawLines(); }
  const sc = $("#scroll");
  if (sc && (S.forceBottom || nearBottom)) sc.scrollTop = sc.scrollHeight;
  if (sc && S.forceBottom && sc.scrollHeight > 0) S.forceBottom = false;
  // Window title shows how many sessions need you, so it's visible from the taskbar.
  const n = [...S.live.values()].filter((l) => liveState(l) === "needs").length;
  document.title = n ? `(${n}) GenUI Agent` : "GenUI Agent";
}

// ---- Helpers ---------------------------------------------------------------------
const genFor = (file) => (file ? S.gens.get(file) : null);
const shortPath = (p) => (p || "").split(/[\\/]/).filter(Boolean).slice(-1)[0] || "";
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const hid = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
function title(l) {
  const g = genFor(l.file), tl = (S.liveTail.get(l.id) || {}).timeline, first = tl && tl.sections[0];
  return (g && g.title) || l.name || (first && first.label) || clip(l.goalHint || "", 60) || "New session";
}
const engShort = (h) => ({ claude: "Claude", codex: "Codex", grok: "Grok" }[h] || h);
const refKey = (ref) => (ref.kind === "live" ? "L:" + ref.id : "F:" + ref.file);
const nowAgo = (t) => ago(t).replace(" ago", "");

// One state per live session, used everywhere (sidebar dot, header, card status, chips, footer).
function liveState(l) {
  if (!l.alive) return "off";
  if (l.pendingAsk || l.pendingPermission || l.terminalNeeds || l.status === "needs" || l.turnError) return "needs";
  if (l.status === "working" || l.status === "starting") return "run";
  // Anything it asked over the whole session that you haven't answered.
  if (needsOf(liveRef(l)).some(replyable)) return "needs";
  // Between a turn ending and the AI reading it, the reply is still being read: not "your turn" yet.
  if (l.file && S.genBusy.has(l.file)) return "reading";
  const g = genFor(l.file);
  if (g && g.status === "done") return "done";
  return "idle";
}
const STATE_LABEL = { needs: "Needs you", run: "Running", reading: "Reading the reply", idle: "Your turn", done: "Done", off: "Ended" };
const STAT_CLS = { needs: "needs", run: "run", reading: "run", idle: "idle", done: "done", off: "idle" };

function current() {
  if (!S.sel) return null;
  if (S.sel.kind === "live") {
    const l = S.live.get(S.sel.id); if (!l) return null;
    return { ...liveRef(l), state: liveState(l) };
  }
  const v = S.views.get(S.sel.file) || {};
  const sv = S.saved.find((s) => s.file === S.sel.file) || {};
  return { kind: "saved", harness: S.sel.harness, file: S.sel.file, id: sv.id, cwd: v.cwd || sv.cwd, context: v.context || sv.context, events: v.events || [], plan: v.plan || null, timeline: v.timeline || null, total: v.total, title: v.title || sv.title, mtime: sv.mtime, pendingAsk: v.pendingAsk, loading: !S.views.has(S.sel.file), viewErr: v.error };
}
function liveRef(l) {
  const tail = S.liveTail.get(l.id) || {};
  return { kind: "live", l, id: l.id, harness: l.harness, file: l.file, cwd: l.cwd, context: tail.context || l.context, events: tail.last || [], plan: tail.plan || null, timeline: tail.timeline || null, alive: l.alive };
}
const curSide = () => { const r = current(); return S.sideOpen && r && S.sideOpen.startsWith(refKey(r) + "|") ? S.sides.get(S.sideOpen) || null : null; };

// ---- Sidebar (3.1) ---------------------------------------------------------------------
function sideHTML() {
  const live = [...S.live.values()].sort((a, b) => (b.lastActivity || b.createdAt) - (a.lastActivity || a.createdAt));
  const by = (st) => live.filter((l) => liveState(l) === st);
  const groupsLive = [["Needs you", by("needs")], ["Running", [...by("run"), ...by("reading")]], ["Your turn", [...by("idle"), ...by("done")]], ["Ended", by("off").slice(0, 6)]];
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
    const ref = liveRef(l), n = needsOf(ref).filter(replyable).length, nw = on ? 0 : newSteps(model(ref)).length;
    return `<button class="srow ${on ? "is-on" : ""}" id="sr-${esc(l.id)}" data-act="open-live" data-id="${esc(l.id)}" title="${esc(l.cwd)}"><span class="sdot ${st}"></span><span class="st">${esc(title(l))}</span><span class="sm">${n ? `<span class="badge">${n}</span>` : nw ? `<span class="newchip">${nw} new</span>` : `<span class="eng">${esc(engShort(l.harness))}</span>${st === "needs" ? "" : esc(nowAgo(l.lastActivity || l.createdAt))}`}</span></button>`;
  };
  const titleCount = new Map(); recent.forEach((x) => { const t = (genFor(x.file) || {}).title || x.title; titleCount.set(t, (titleCount.get(t) || 0) + 1); });
  const savedRow = (s) => {
    const on = S.page === "session" && S.sel?.kind === "saved" && S.sel.file === s.file;
    const t = (genFor(s.file) || {}).title || s.title, dup = titleCount.get(t) > 1;
    return `<button class="srow ${on ? "is-on" : ""}" id="ss-${hid(s.file)}" data-act="open-saved" data-file="${esc(s.file)}" data-h="${esc(s.harness)}" title="${esc(shortPath(s.cwd))} · ${esc(S.labels[s.harness])}"><span class="sdot ${s.waiting ? "needs" : "off"}"></span><span class="st">${esc(t)}${dup ? `<span class="t3"> · ${esc(shortPath(s.cwd))}</span>` : ""}</span><span class="sm"><span class="eng">${esc(shortPath(s.cwd))}</span>${esc(nowAgo(s.mtime))}</span></button>`;
  };
  const needsN = by("needs").length;
  return `
    <button class="srow srow-new" data-act="new-session">${icon("plus")}New session</button>
    <label class="srow srow-search">${icon("search")}<input id="search" data-keep placeholder="Search" aria-label="Search sessions" autocomplete="off"><kbd>Ctrl K</kbd></label>
    <button class="srow ${S.page === "overview" ? "is-on" : ""}" data-act="go" data-page="overview">${icon("flow")}<span class="st">Orchestrator</span>${needsN ? `<span class="sm"><span class="badge">${needsN}</span></span>` : ""}</button>
    ${groupsLive.filter(([, items]) => items.length).map(([name, items]) => `<div class="sgroup">${name}</div>${items.map(liveRow).join("")}`).join("")}
    ${groups.length ? groups.map(([name, items]) => `<div class="sgroup">${name}</div>${items.map(savedRow).join("")}`).join("") : `<div class="sgroup">Recent</div><div class="sempty">${q ? "Nothing matches." : "No sessions yet"}</div>`}`;
}

// ---- The timeline: code's steps, the AI layer's notes, the asks, and what's new since you looked ----
const clock = (t) => {
  if (!t) return "";
  const d = new Date(t), s = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  return new Date().toDateString() === d.toDateString() ? s : `${d.toLocaleDateString([], { weekday: "short" })} ${s}`;
};
const span = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`; };
const fname = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";

// What you have seen of each session: when you last looked and how far the conversation had got.
// The session on screen is frozen at the moment you opened it, so its highlights don't move while you read.
const seenKey = (ref) => ref.file || ref.id;
function loadSeen() { try { return JSON.parse(localStorage.getItem("genui.seen") || "{}"); } catch { return {}; } }
function saveSeen() { try { const e = Object.entries(S.seen).sort((a, b) => b[1].at - a[1].at).slice(0, 300); localStorage.setItem("genui.seen", JSON.stringify(Object.fromEntries(e))); } catch {} }
function lookFor(ref) {
  const k = seenKey(ref);
  if (S.look && (S.look.key === k || S.look.key === ref.id)) { if (S.look.upto == null && ref.timeline) S.look.upto = ref.timeline.events; return S.look.from ? S.look : null; }
  const from = S.seen[k];
  return from ? { key: k, from, upto: Infinity, openedAt: Date.now() } : null;
}
function startLook() {
  const ref = current(); if (!ref) { S.look = null; return; }
  const k = seenKey(ref);
  S.look = { key: k, from: S.seen[k] || null, openedAt: Date.now(), upto: ref.timeline ? ref.timeline.events : null };
}
// Leaving a session (or the window) records that you have seen it up to now.
function markSeen() {
  if (!S.look) return;
  const ref = current(), k = ref ? seenKey(ref) : S.look.key;
  S.seen[k] = { at: Date.now(), ev: (ref && ref.timeline && ref.timeline.events) || (S.seen[k] || {}).ev || 0 };
  saveSeen();
}
function leaveSession() {
  markSeen(); if (S.look) S.doneNow.delete(S.look.key); S.look = null; S.focusNeed = null;
  const l = S.sel && S.sel.kind === "live" && S.live.get(S.sel.id);
  if (l && l.fresh) discard(l.id);
}
function discard(id) { S.live.delete(id); const t = terms.get(id); if (t) { t.term.dispose(); terms.delete(id); } api(`/api/sessions/${id}/discard`, {}).catch(() => {}); }

const modelCache = new WeakMap();
// The timeline with the AI layer's notes on it. Cached per timeline, notes and look.
function model(ref) {
  const tl = ref.timeline; if (!tl) return null;
  const g = genFor(ref.file), notes = g && g.notes, look = lookFor(ref);
  const lk = look ? `${look.from.ev}|${look.upto}` : "", hit = modelCache.get(tl);
  if (hit && hit.g === g && hit.lk === lk) return hit.m;
  const sections = tl.sections.map((sec) => ({ ...sec, kind: (notes && notes.sections[sec.id] && notes.sections[sec.id].kind) || sec.kind, steps: sec.steps.map((s) => {
    const n = notes && notes.steps[s.id];
    return { ...s, label: (n && n.label) || s.label, summary: n ? n.summary : "", dropped: notes && notes.dropped[s.id] ? notes.dropped[s.id].why : null, isNew: !!(look && s.kind !== "you" && s.ev >= look.from.ev && s.ev < look.upto) };
  }) }));
  const flat = sections.flatMap((sec, si) => sec.steps.map((s) => ({ s, sec, si })));
  const lastX = [...flat].reverse().find((x) => !x.s.dropped);
  const m = { sections, flat, last: lastX ? lastX.s : null, cursor: notes ? notes.cursor : 0 };
  modelCache.set(tl, { g, lk, m });
  return m;
}
const newSteps = (m) => (m ? m.flat.filter((x) => x.s.isNew) : []);

// Everything the session needs from you: what its terminal waits on now, its open menu question, and
// every question it asked over the whole session that you haven't answered properly.
const replyable = (n) => n.kind === "menu" || n.kind === "ask" || n.kind === "text";
const ak = (ref, n) => `${refKey(ref)}|${n.id || n}`;
function needsOf(ref) {
  const m = model(ref), l = ref.l, g = genFor(ref.file), out = [];
  const flat = m ? m.flat : [], pos = new Map(flat.map((x, i) => [x.s.id, i]));
  if (l && l.alive) {
    if (l.pendingPermission && l.pendingPermission.tool !== "AskUserQuestion") out.push({ id: "perm:" + l.pendingPermission.id, kind: "perm" });
    else if (l.native && !l.pendingAsk) out.push({ id: "native", kind: "native" });
    if (l.terminalNeeds) out.push({ id: "term:" + l.terminalNeeds.kind, kind: "term" });
    if (l.turnError) out.push({ id: "err", kind: "error" });
  }
  const menuStep = [...flat].reverse().find((x) => x.s.ask && !x.s.ask.answered);
  const menuQs = l ? (l.alive && l.pendingAsk ? (l.pendingAsk.questions || []).map((q) => ({ q: q.question, header: q.header, options: (q.options || []).map((o) => ({ label: o.label, detail: o.description || "" })) })) : []) : menuStep ? menuStep.s.ask.qs : [];
  const menuId = (l && l.pendingAsk && l.pendingAsk.id) || (menuStep && menuStep.s.id) || "menu";
  menuQs.forEach((q, i) => out.push({ id: `m:${menuId}:${i}`, kind: "menu", key: q.header || clip(q.q, 40), q: q.q, ctx: `${S.labels[ref.harness] || "The agent"} is waiting in its own question menu.`, options: q.options || [], step: menuStep && menuStep.s.id }));
  for (const a of (g && g.asks) || []) if (a.state === "open" && pos.has(a.step) && !S.sentAsks.has(ak(ref, a))) out.push({ id: a.id, kind: "ask", key: a.key, q: a.q, ctx: a.ctx, options: a.options || [], step: a.step });
  // The last turn ended on a question the AI layer hasn't read yet: code shows it straight away.
  const last = m && m.last;
  if (last && last.kind === "asktext" && (!g || !g.notes || g.notes.cursor <= last.ev) && !(l && l.status === "working") && !S.sentAsks.has(ak(ref, "f:" + last.id))) {
    const qs = (last.said.match(/[^.!?\n]*\?(?=\s|$)/g) || []).map((x) => x.replace(/^[\s*#>\d.)-]+/, "").trim()).filter((x) => x.length > 3);
    out.push({ id: "f:" + last.id, kind: "text", key: qs.length === 1 ? clip(qs[0].replace(/\?$/, ""), 40) : "Your answer", q: qs.slice(0, 3).join(" ") || last.label, ctx: "", options: [], step: last.id });
  }
  // Asked before your latest message, and still open: you moved on without answering it.
  let boundary = -1, k = 0;
  if (m) m.sections.forEach((sec, si) => { if (si) boundary = k; for (const s of sec.steps) { if (s.kind === "you") boundary = k; k++; } });
  for (const n of out) {
    const i = n.step != null ? pos.get(n.step) : null;
    n.pos = i == null ? -1 : i;
    n.t = i != null ? flat[i].s.t : null;
    n.stepLabel = i != null ? flat[i].s.label : "";
    n.old = replyable(n) && n.kind !== "menu" && i != null && i < boundary;
  }
  return out.sort((a, b) => (replyable(a) - replyable(b)) || a.pos - b.pos);
}
const answerOf = (ref, n) => S.ans.get(ak(ref, n)) || "";
// An answer "is" an option when it starts with that option's label.
const isOption = (sel, o) => !!sel && sel.toLowerCase().startsWith(o.label.toLowerCase()) && /^($|[\s,.;:—–-])/.test(sel.slice(o.label.length));

// Your reply: every answer you've picked, as one message.
function composeText(ref) {
  const done = needsOf(ref).filter((n) => replyable(n) && answerOf(ref, n).trim());
  if (!done.length) return "";
  const line = (n) => `${n.key}: ${answerOf(ref, n).trim().replace(/\.$/, "")}.`;
  return done.length === 1 ? `About your question:\n${line(done[0])}` : `About your questions:\n${done.map((n, i) => `${i + 1}. ${line(n)}`).join("\n")}`;
}

// ---- Agent view: the real terminal, with the rail beside it -----------------------------------
// A running session looks like the harness itself; the rail shows what happened while you were away,
// everything it needs from you, and the timeline of the session.
function agentHTML(ref) {
  const g = genFor(ref.file), l = ref.l, st = ref.state;
  const name = (g && g.title) || title(l);
  const ps = planStepOf(ref.id);
  const meta = [esc(shortPath(ref.cwd)), esc(S.labels[ref.harness])];
  if (ps) meta.push(`plan step ${ps.i + 1} of ${ps.plan.steps.length}`);
  const hdot = st === "run" ? "var(--accent-dot)" : st === "needs" ? "var(--amber-dot)" : "";
  const sd = curSide();
  return `
  <header class="head">
    <div class="head-t" title="${esc(g ? g.goal : "")}">${hdot ? `<span class="hdot" style="background:${hdot}"></span>` : ""}<span>${esc(name)}</span></div>
    <div class="head-meta">${meta.join(" · ")}</div>
    <div class="head-r">
      <button class="ibtn" data-act="new-here" title="New session in this folder, for something unrelated" aria-label="New session in this folder">${icon("plus")}</button>
      ${l.alive ? `<span class="stopwrap"><button class="ibtn ${S.stopAsk === l.id ? "is-on" : ""}" data-act="stop-ask" title="Stop this session" aria-label="Stop session">${icon("power")}</button>${S.stopAsk === l.id ? `<span class="stop-pop" role="dialog"><span>Stop this session? You can resume it later.</span><span class="stop-act"><button class="btn btn-text sm" data-act="stop-cancel">Cancel</button><button class="btn btn-danger sm" data-act="stop-session">Stop</button></span></span>` : ""}</span>` : ""}
    </div>
  </header>
  ${railWanted(ref) ? `<aside class="railpane" id="railpane" aria-label="${sd ? "Side chat" : "What it needs and its timeline"}">${sd ? sideChatHTML(sd) : railHTML(ref)}</aside>` : ""}`;
}
// The rail appears once there is something to show: a step, something it needs, or a side chat.
// Until then the terminal has the whole width.
function railWanted(ref) {
  if (!ref || ref.kind !== "live") return true;
  if (curSide() || [...S.sides.keys()].some((k) => k.startsWith(refKey(ref) + "|"))) return true;
  const m = model(ref);
  return !!((m && m.flat.length) || needsOf(ref).length || (ref.file && S.genErr.get(ref.file)));
}

// What the agent is doing right now, from its latest tool call.
function activity(ref) {
  const ev = ref.events || [];
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    if (e.role === "user") break;
    if (e.role === "tool") {
      const x = e.input || {}, f = shortPath(x.file_path || x.path || "");
      const verb = { Read: "Reading", Edit: "Editing", MultiEdit: "Editing", Write: "Writing", Grep: "Searching", Glob: "Searching", WebSearch: "Searching the web", WebFetch: "Reading a page", Bash: "Running", PowerShell: "Running", shell: "Running", Agent: "Delegating", Task: "Delegating" }[e.tool] || `Using ${e.tool}`;
      const what = f || (x.command ? clip(String(x.command).split("\n")[0], 40) : x.pattern || x.query || "");
      return what ? `${verb} ${what}` : verb;
    }
  }
  return "";
}

// One line saying what the agent needs from you, or "" when it needs nothing.
function needLine(ref, needs) {
  const l = ref.l, block = needs.find((n) => !replyable(n)), rep = needs.filter(replyable);
  if (block && block.kind === "perm") return `Approval to ${permTitle(l.pendingPermission.tool, l.pendingPermission.input || {}).replace(/^\w/, (c) => c.toLowerCase())}`;
  if (block && block.kind === "term") return l.terminalNeeds.kind === "trust" ? "Trust this folder?" : l.terminalNeeds.kind === "hooks" ? "Trust this project's hooks?" : "Waiting in its terminal";
  if (block && block.kind === "native") return "Waiting in its terminal";
  if (block && block.kind === "error") return "Its turn failed";
  if (!rep.length) return "";
  const keys = rep.map((n) => n.key.charAt(0).toLowerCase() + n.key.slice(1));
  return `${plural(rep.length, "answer")}: ${keys.length > 1 ? keys.slice(0, -1).join(", ") + " and " + keys.at(-1) : keys[0]}`;
}

function railHTML(ref) {
  const m = model(ref), g = genFor(ref.file), live = ref.kind === "live";
  const st = live ? ref.state : "saved", alive = live && ref.alive;
  const needs = needsOf(ref);
  const ps = live ? planStepOf(ref.id) : null;
  const busy = ref.file && (S.genBusy.has(ref.file) || S.genMid.has(ref.file));
  const err = (ref.file && S.genErr.get(ref.file)) || ref.viewErr;
  if (!m) {
    const label = err ? "" : live && !ref.file ? "Waiting for the first turn" : "Reading the session";
    // Before the first transcript line there can still be something to answer, like folder trust.
    return railShell(ref, `${needsHTML(ref, needs, !alive)}${err ? `<div class="inline-err">${icon("alert")}<span>${esc(clip(err, 160))}</span></div>` : `<div class="pl-now run"><span class="spin"></span><span class="shimmer">${esc(label)}</span></div>`}`);
  }
  const plan = ps ? `<div class="planline">${icon("flow", "s14")}<span>Plan <b>${esc(clip(ps.plan.title, 40))}</b> · step ${ps.i + 1} of ${ps.plan.steps.length}: ${esc(clip(ps.plan.steps[ps.i].label, 50))}</span></div>` : "";
  const head = `<div class="rsec-h">Flowchart <span class="t3">${plural(m.sections.length, "request")} · ${plural(m.flat.filter((x) => x.s.kind !== "you").length, "step")}</span><span class="sp"></span>${busy ? `<span class="t3 gen-note"><span class="spin"></span>AI is reading it</span>` : `<button class="ibtn sm" data-act="regen" title="Summaries and the list of asks are written by AI from the transcript${g ? `, ${esc(ago(g.at))}` : ""}. Click to read it again." aria-label="Read it again">${icon("refresh", "s14")}</button>`}</div>`;
  return railShell(ref, `${awayHTML(ref, m, needs)}${plan}${needsHTML(ref, needs, !alive)}
    <section class="tl-sec">${head}${err && !g ? `<p class="pl-note">${esc(clip(err, 140))}</p>` : ""}${treeHTML(ref, m, needs, st)}</section>`);
}

// "While you were away": what happened since you last looked, in a sentence or two.
function awayHTML(ref, m, needs) {
  const look = lookFor(ref), nw = newSteps(m);
  if (!look || !nw.length) return "";
  const news = nw.filter((x) => x.s !== m.last).map((x) => (x.s.summary || x.s.label).replace(/\.$/, "")).slice(-2);
  const asked = needs.filter((n) => replyable(n) && n.pos >= 0 && m.flat[n.pos].s.isNew).length;
  return `<div class="away" id="away"><div class="h">${icon("away", "s14")}While you were away · ${span(look.openedAt - look.from.at)}</div><p>${plural(nw.length, "new step")}. ${esc(news.join(". "))}${news.length ? "." : ""}${asked ? ` It asked ${plural(asked, "question")}.` : ""}</p></div>`;
}

// "Needs from you": every unresolved ask, oldest first, then your reply with every answer in it.
function needsHTML(ref, needs, ro) {
  const rep = needs.filter(replyable), block = needs.filter((n) => !replyable(n)), done = S.doneNow.get(seenKey(ref)) || [];
  if (!needs.length && !done.length) return "";
  const agent = S.labels[ref.harness] || "the agent";
  const tail = rep.length ? (ro ? `<p class="pl-note">${ref.kind === "saved" ? "A saved session: resume it to answer." : "This session has ended: resume it to answer."}</p>` : replyHTML(ref, rep))
    : done.length && !block.length ? `<div class="card allclear" data-anim>${icon("check", "s14")}<span>Sent to ${esc(agent)}. Nothing else needs you here.</span></div>` : "";
  return `<section class="needs-sec">
    <div class="rsec-h">Needs from you${rep.length ? ` <span class="badge">${rep.length}</span>` : ""}<span class="sp"></span><span class="t3">from the whole session</span></div>
    <div class="needs-list">${block.map((n) => blockCard(ref, n)).join("")}${rep.map((n, i) => needCard(ref, n, i, rep.length, ro)).join("")}
      ${done.map((d) => `<div class="card need done" id="nd-${hid(d.id)}"><span class="gck">${icon("check", "s12")}</span><span class="q">${esc(d.q)}</span><span class="a" title="${esc(d.answer)}">${esc(clip(d.answer, 90))}</span></div>`).join("")}${tail}</div></section>`;
}

// What its terminal is waiting on: an approval, a prompt like folder trust, or a failed turn.
function blockCard(ref, n) {
  const l = ref.l, h = `<div class="nh"><span class="old">${icon("term", "s12")}In its terminal</span><span class="sp"></span><span class="num">now</span></div>`;
  if (n.kind === "perm") {
    const p = l.pendingPermission, i = p.input || {}, cmd = i.command || i.file_path || i.url || i.pattern || "";
    return `<div class="card need block" id="need-${hid(ak(ref, n))}">${h}<div class="nq">${esc(permTitle(p.tool, i))}?</div>${cmd ? `<pre class="code">${esc(clip(String(cmd), 400))}</pre>` : ""}<div class="nfoot"><button class="btn btn-tint sm" data-act="term-open">${icon("term", "s14")}Answer in the terminal</button></div></div>`;
  }
  if (n.kind === "native") return `<div class="card need block">${h}<div class="nq">The terminal is waiting for you.</div><div class="nfoot"><button class="btn btn-tint sm" data-act="term-open">${icon("term", "s14")}Go to the terminal</button></div></div>`;
  if (n.kind === "term") {
    const t = l.terminalNeeds, k = t.kind;
    return `<div class="card need block">${h}<div class="nq">${esc(t.text)}</div>${k === "trust" || (k === "hooks" && t.detail) ? `<pre class="code">${esc(k === "trust" ? l.cwd : t.detail)}</pre>` : ""}
      <div class="nfoot">${k === "menu" ? `<button class="btn btn-tint sm" data-act="term-open">Go to the terminal</button>` : `<button class="btn btn-tint sm" data-act="term-yes">${k === "trust" ? "Trust and start" : k === "hooks" ? "Trust and continue" : "Yes"}</button><button class="btn btn-text sm" data-act="term-no">${k === "trust" ? "Exit" : k === "hooks" ? "Skip them" : "No"}</button>`}</div></div>`;
  }
  const err = (ref.events || []).slice().reverse().find((e) => e.role === "error") || { text: l.turnError.message, code: l.turnError.code };
  return errorCard(ref, err);
}

function needCard(ref, n, i, total, ro) {
  const k = ak(ref, n), sel = answerOf(ref, n), opts = n.options || [];
  const custom = sel && !opts.some((o) => isOption(sel, o)), elseOpen = S.elseOpen.has(k) || custom;
  const chat = S.sides.get(`${refKey(ref)}|need:${n.id}`), talked = chat && chat.data && (chat.data.msgs || []).length;
  const when = n.old ? `<span class="old" title="${n.t ? `Asked ${esc(clock(n.t))}. ` : ""}You've written since without answering it.">${n.t ? `open ${span(Date.now() - n.t)}` : "still open"}</span>` : n.t ? `<span class="num">${esc(clock(n.t))}</span>` : "";
  const pill = (o) => { const on = isOption(sel, o), q2 = o.recommended ? "recommended" : o.detail && o.detail.length <= 28 ? o.detail : ""; return `<button class="npill ${on ? "on" : ""}" data-act="need-opt" data-need="${esc(n.id)}" data-v="${esc(o.label)}" title="${esc(o.detail || "")}" ${ro ? "disabled" : ""}>${esc(o.label)}${q2 ? `<span class="q2">${esc(q2)}</span>` : ""}${on ? `<span class="ck">${icon("check", "s14")}</span>` : ""}</button>`; };
  const other = ro ? "" : elseOpen ? `<textarea class="elsein" rows="1" data-keep data-draft="else:${esc(k)}" data-else="${esc(n.id)}" id="else-${hid(k)}" placeholder="${opts.length ? "Type your own answer" : "Your answer"}" aria-label="Your own answer"></textarea>` : `<button class="npill else" data-act="need-else" data-need="${esc(n.id)}">${opts.length ? "Something else" : "Answer it"}</button>`;
  return `<div class="card need ${S.focusNeed === n.id ? "focus" : ""}" id="need-${hid(k)}" data-anim>
    <div class="nh"><span>${i + 1} of ${total}</span>${n.stepLabel ? `<span>·</span><button class="lnk" data-act="goto-step" data-step="${esc(n.step)}" title="Show this step in the flowchart">${esc(clip(n.stepLabel, 44))}</button>` : ""}<span class="sp"></span>${when}</div>
    <div class="nq">${esc(n.q)}</div>${n.ctx ? `<div class="nc">${esc(n.ctx)}</div>` : ""}
    ${opts.length || other ? `<div class="npills">${opts.map(pill).join("")}${other}</div>` : ""}
    ${ro ? "" : `<div class="nfoot"><button class="btn btn-neutral sm" data-act="need-discuss" data-need="${esc(n.id)}" title="Talk it through with a side agent that knows this session">${icon("chat", "s14")}${talked ? "Continue discussion" : "Discuss it"}</button>${S.worked.has(k) ? `<span class="t3 fs13">Worked out on the side</span>` : ""}<span class="sp"></span>${sel.trim() ? `<span class="t3 fs13">In your reply</span>` : ""}</div>`}
  </div>`;
}

function replyHTML(ref, rep) {
  const answered = rep.filter((n) => answerOf(ref, n).trim()).length, left = rep.length - answered;
  const menuLeft = rep.some((n) => n.kind === "menu" && !answerOf(ref, n).trim()), blocked = menuLeft && answered > 0;
  const note = blocked ? "Its question menu is open: answer that one too, so GenUI can close the menu and send everything together."
    : `${ref.l.pendingAsk ? "GenUI closes its question menu (Esc), then types this as your next message." : "Typed into the session as your next message."}${left && answered ? ` ${plural(left, "question")} left open ${left === 1 ? "stays" : "stay"} on this list.` : ""}`;
  return `<div class="card reply" id="reply">
    <div class="rh"><span>Your reply to ${esc(S.labels[ref.harness] || "the agent")}</span><span class="sp"></span><span class="num">${answered}/${rep.length} answered</span></div>
    <textarea id="replytext-${hid(refKey(ref))}" class="replytext" data-keep data-rk="${esc(refKey(ref))}" rows="3" placeholder="Pick answers above and they gather here as one message. Add anything else you want to say." aria-label="Your reply"></textarea>
    <div class="rf"><span class="note">${note}</span><button class="btn btn-tint" data-act="send-reply" id="sendbtn" data-blocked="${blocked ? 1 : 0}" disabled>${S.inflight.has("reply") ? `<span class="spin"></span>Sending` : `${icon("up", "s14")}${answered > 1 ? `Send ${answered} answers` : "Send reply"}`}</button></div>
  </div>`;
}
// The reply box fills itself from your answers until you type in it; Send follows its text.
function syncReply() {
  const ta = $(".replytext"); if (!ta) return;
  const ref = current(); if (!ref) return;
  if (!S.replyEdited.has(ta.dataset.rk)) { const t = composeText(ref); if (ta.value !== t) ta.value = t; }
  const b = $("#sendbtn"); if (b) b.disabled = !ta.value.trim() || b.dataset.blocked === "1" || S.inflight.has("reply");
  autosize(ta);
}

// ---- The flowchart: one line, top to bottom. Each message you sent starts a section; the agent's
// steps sit under it; work set aside when you changed direction steps off the line with a ×.
const EYEBROW = { start: ["chat", "You started"], new: ["chat", "You asked"], turn: ["turn", "You changed direction"] };
function treeHTML(ref, m, needs, st) {
  const rk = refKey(ref), live = ref.kind === "live";
  const asking = new Set(needs.filter(replyable).map((n) => n.step));
  const blocking = needs.some((n) => !replyable(n));
  // The step it's on: amber when it needs you, blue while it works, grey when it's your turn.
  const tone = live && !ref.alive ? "off" : blocking || (m.last && asking.has(m.last.id)) ? "needs" : st === "run" || st === "reading" ? "run" : "turn";
  const lastSi = m.sections.length - 1;
  // Older messages fold away unless something in them needs you or is new.
  const keep = (sec) => sec.steps.some((s) => asking.has(s.id) || s.isNew);
  let early = 0;
  if (m.sections.length > 4 && !S.open.has("early:" + rk)) { for (let i = 0; i < m.sections.length - 3; i++) { if (keep(m.sections[i])) break; early = i + 1; } }
  let awayShown = false, h = early ? `<button class="trow fold" data-act="tl-fold" data-k="${esc("early:" + rk)}"><span class="nd done"></span><span class="lab t2">${plural(early, "earlier message")}</span>${icon("chev", "s12 chev")}</button>` : "";
  m.sections.forEach((sec, si) => {
    if (si < early) return;
    const [ic, word] = EYEBROW[sec.kind] || EYEBROW.new;
    h += `<div class="trow goal" data-g="${si}" id="tg-${hid(rk + sec.id)}"><span class="nd goal ${si === lastSi ? "cur" : ""}"></span><span class="lab"><span class="eb">${icon(ic, "s12")}${word}${sec.t ? ` · ${esc(clock(sec.t))}` : ""}</span><span class="gq">“${esc(clip(sec.text, 180))}”</span></span></div>`;
    // A long run of steps shows its latest ones; earlier ones fold into one row you can open.
    const mk = "more:" + rk + sec.id, cap = 10, n = sec.steps.length;
    const show = (s, k) => n <= cap || S.open.has(mk) || k >= n - (cap - 2) || asking.has(s.id) || s.isNew;
    const hidden = sec.steps.filter((s, k) => !show(s, k)).length;
    if (hidden) h += `<button class="trow fold" data-act="tl-fold" data-k="${esc(mk)}"><span class="nd done"></span><span class="lab t2">${plural(hidden, "earlier step")}</span>${icon("chev", "s12 chev")}</button>`;
    sec.steps.forEach((s, k) => {
      if (!show(s, k)) return;
      if (s.isNew && !awayShown) { awayShown = true; const look = lookFor(ref); h += `<div class="awayrow">Since you were away${look ? ` · ${esc(clock(look.from.at))}` : ""}</div>`; }
      const cur = s === m.last, amber = asking.has(s.id);
      const nd = s.dropped ? "dropped" : cur ? tone : amber ? "amber" : s.kind === "you" ? "you" : "done";
      const open = S.open.has("st:" + rk + s.id);
      const cls = ["trow", "step", s.dropped ? "dropped" : "", s.kind === "you" ? "you" : "", (cur && tone === "needs") || amber ? "amber" : "", open ? "sel" : ""].join(" ");
      const label = cur && tone === "run" ? `<span class="shimmer">${esc(s.label)}</span>` : esc(s.label);
      const meta = s.dropped ? `<span>dropped</span>` : cur && tone === "run" ? `<span class="t2 act">${esc(clip(activity(ref), 32))}</span>` : `<span class="num">${esc(clock(s.t))}</span>`;
      const glyph = nd === "needs" ? `<b>!</b>` : nd === "dropped" ? icon("x", "s12") : "";
      h += `<div class="${cls}" data-act="tl-step" data-step="${esc(s.id)}" id="st-${hid(rk + s.id)}" role="button" tabindex="0" aria-expanded="${open}" data-decode>
        <span class="nd ${nd}">${glyph}</span><span class="lab">${label}</span><span class="rm">${s.isNew ? `<span class="nw" title="New since you looked"></span>` : ""}${meta}${icon("chev", "s12 chev")}</span></div>`;
      if (open) h += detailHTML(ref, m, s, needs);
    });
    if (si === lastSi && !sec.steps.length && tone === "run") h += `<div class="trow step"><span class="nd run"></span><span class="lab"><span class="shimmer">${esc(activity(ref) || "Working")}</span></span></div>`;
  });
  return `<div class="tkey"><span><span class="k-ring"></span>Your message</span><span><span class="k-dot"></span>A step</span><span title="Work set aside when you changed direction"><span class="k-x">×</span>Dropped</span></div>
    <div class="tl-tree" id="tltree"><svg class="tl-lines" id="tllines" data-keep aria-hidden="true"></svg>${h}</div>`;
}

// What happened in one step: the summary, what it touched and ran, what the agent said, what it asked.
function detailHTML(ref, m, s, needs) {
  const g = genFor(ref.file), agent = S.labels[ref.harness] || "The agent", parts = [];
  if (s.kind === "you") parts.push(`<div><div class="dk">You wrote</div><p class="said">${esc(clip(s.text, 900))}</p></div>`);
  if (s.dropped) parts.push(`<p class="dropwhy">${icon("x", "s12")}${esc(s.dropped)}</p>`);
  if (s.summary) parts.push(`<p>${esc(s.summary)}</p>`);
  if (s.files.length) parts.push(`<div><div class="dk">Touched</div><div class="refs">${s.files.map((f) => `<span class="refline" title="${esc(f.f)}"><span class="ref">${esc(clip(f.f, 56))}</span>${f.add || f.del ? `<span class="diff">+${f.add} −${f.del}</span>` : ""}</span>`).join("")}${s.kind === "read" && s.reads > s.files.length ? `<span class="t3 fs13">+${s.reads - s.files.length} more</span>` : ""}</div></div>`);
  if (s.cmds.length) parts.push(`<div><div class="dk">${s.kind === "read" ? "Searched" : "Ran"}</div><div class="refs">${s.cmds.map((c) => `<span class="refline"><span class="ref">${esc(clip(c.c, 70))}</span>${c.r ? `<span class="${c.ok ? "t2" : "fail"} fs13">${esc(clip(c.r, 90))}</span>` : ""}</span>`).join("")}</div></div>`);
  if (s.said) parts.push(`<div><div class="dk">${esc(agent)} said</div><div class="said prose-s">${md(clip(s.said, 900))}</div></div>`);
  const asks = [];
  if (s.ask) for (const [qi, q] of s.ask.qs.entries()) {
    const a = s.ask.answers.find((x) => x.q === q.q) || (s.ask.answers.length === 1 && s.ask.qs.length === 1 ? s.ask.answers[0] : null);
    asks.push(a ? `<p>${esc(q.q)}</p><p class="ans"><span class="gck">${icon("check", "s12")}</span>${esc(a.a)}</p>` : s.ask.reply ? `<p>${esc(q.q)}</p><p class="ans"><span class="gck">${icon("check", "s12")}</span>${esc(clip(s.ask.reply, 160))}</p>`
      : `<p>${esc(q.q)} <button class="lnk old" data-act="goto-need" data-need="${esc(`m:${(ref.l && ref.l.pendingAsk && ref.l.pendingAsk.id) || s.id}:${qi}`)}">Still open · answer it</button></p>`);
  }
  for (const a of ((g && g.asks) || []).filter((x) => x.step === s.id)) {
    const sent = S.sentAsks.has(ak(ref, a));
    asks.push(a.state === "open" && !sent ? `<p>${esc(a.q)} <button class="lnk old" data-act="goto-need" data-need="${esc(a.id)}">Still open · answer it</button></p>`
      : `<p>${esc(a.q)}</p><p class="ans">${a.state === "moot" ? `<span class="t3 fs13">No longer needed</span>` : `<span class="gck">${icon("check", "s12")}</span>${esc(a.answer || "Answered")}`}</p>`);
  }
  const f = needs.find((n) => n.kind === "text" && n.step === s.id);
  if (f && !asks.length) asks.push(`<p>${esc(f.q)} <button class="lnk old" data-act="goto-need" data-need="${esc(f.id)}">Still open · answer it</button></p>`);
  if (asks.length) parts.push(`<div><div class="dk">Asked</div>${asks.join("")}</div>`);
  if (!parts.length) parts.push(`<p class="t2">${g ? "Nothing more to show for this step." : "A summary arrives when the AI has read this part."}</p>`);
  const term = ref.kind === "live" && s.kind !== "you" ? `<button class="lnk" data-act="show-term" data-step="${esc(s.id)}">${icon("term", "s12")}Show in the terminal</button>` : "";
  parts.push(`<div class="dacts">${term}<span class="t3 fs13">${esc(clock(s.t))}</span></div>`);
  return `<div class="tdetail" data-anim>${parts.join("")}</div>`;
}

// The line, drawn from where the rows actually sit, so opened steps stretch it.
function drawLines() {
  const tree = $("#tltree"), svg = $("#tllines"); if (!tree || !svg) return;
  const mid = (el) => el.offsetTop + el.offsetHeight / 2;
  const rows = [...tree.querySelectorAll(":scope > .trow")], main = rows.filter((r) => !r.classList.contains("dropped"));
  let d = "";
  if (main.length > 1) {
    const top = mid(main[0]), bot = mid(main.at(-1)), cur = [...rows].reverse().find((r) => r.classList.contains("goal"));
    // The current request's stretch is blue; everything before it is grey.
    d = cur && cur !== main[0] ? `<path class="ln-grey" d="M11,${top} V${mid(cur)}"/><path class="ln-cur" d="M11,${mid(cur)} V${bot}"/>` : `<path class="ln-cur" d="M11,${top} V${bot}"/>`;
    for (const r of rows.filter((r) => r.classList.contains("dropped"))) { const y = mid(r); d += `<path class="ln-grey ln-dash" d="M11,${y - 24} C11,${y - 12} 29,${y - 14} 29,${y - 6}"/>`; }
  }
  svg.setAttribute("height", tree.offsetHeight);
  if (svg.innerHTML !== d) svg.innerHTML = d;
}

// Open a step from anywhere (a question's step link), and bring it into view.
function gotoStep(ref, id) {
  S.open.add("st:" + refKey(ref) + id); render();
  const el = $(`#st-${hid(refKey(ref) + id)}`); if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}
function gotoNeed(ref, id) {
  S.focusNeed = id; render();
  const el = $(`#need-${hid(ak(ref, id))}`); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  clearTimeout(S.focusTimer); S.focusTimer = setTimeout(() => { S.focusNeed = null; render(); }, 2400);
}
// "Show in the terminal": find the step's file or command in the terminal's scrollback.
function showInTerm(ref, id) {
  const t = terms.get(ref.id), m = model(ref), x = m && m.flat.find((y) => y.s.id === id); if (!t || !x) return;
  const s = x.s, needles = [s.files[0] && fname(s.files[0].f), s.cmds[0] && s.cmds[0].c.slice(0, 30), s.said && s.said.split("\n")[0].slice(0, 40), s.ask && s.ask.qs[0] && s.ask.qs[0].q.slice(0, 40)].filter((n) => n && n.length > 3);
  const buf = t.term.buffer.active;
  for (let y = buf.length - 1; y >= 0; y--) {
    const line = buf.getLine(y)?.translateToString(true) || "";
    if (needles.some((n) => line.includes(n))) { t.term.scrollToLine(Math.max(0, y - 4)); t.term.select(0, y, line.length); focusTerm(ref); return; }
  }
  toast("Not in the terminal's scrollback any more", "", "", null, 3000);
}

// Questions you worked out on the side, kept with the session so you can see what you decided.
function sidesList(ref) {
  const list = [...S.sides.values()].filter((sd) => sd.key.startsWith(refKey(ref) + "|") && sd.data && (sd.data.msgs || []).length);
  if (!list.length) return "";
  return `<div class="pl-sides"><div class="pl-sides-h">${icon("chat", "s14")}On the side</div>${list.map((sd) => `<button class="pl-side" data-act="side-review" data-k="${esc(sd.key)}"><span class="tl">${esc(clip(sd.extra.question || (sd.data.msgs.find((m) => m.who === "me") || {}).text || "", 80))}</span><span class="tnote">${plural((sd.data.msgs || []).length, "message")}</span></button>`).join("")}</div>`;
}
const asideButton = () => `<button class="btn btn-neutral sm side-btn" data-act="aside" title="A side conversation about this session, as many messages as you like. It never touches the session unless you send something.">${icon("chat", "s14")}Ask on the side</button>`;
// The rail's frame: scrolling content, then the side chat button and the context meter.
function railShell(ref, inner) {
  const ctx = ref.context;
  return `<div class="pl-scroll" id="plscroll">${inner}${sidesList(ref)}</div>
    <div class="pl-foot">${asideButton()}<span class="sp"></span>${ctx ? `<span class="chip" id="chip-ctx" title="${kt(ctx.used)} of ${kt(ctx.window)} tokens in this session's context"><span class="v">Context</span><span class="ctxbar"><i style="width:${ctx.pct}%;background:${ctx.pct >= 95 ? "var(--red-dot)" : ctx.pct >= 80 ? "var(--amber-dot)" : "var(--text-3)"}"></i></span><span class="num">${ctx.pct}%</span></span>` : ""}
      </div>`;
}

// ---- Session view ---------------------------------------------------------------------
function sessionHTML(ref) {
  if (ref.kind === "live") return agentHTML(ref);
  const g = genFor(ref.file);
  const name = (g && g.title) || (ref.kind === "live" ? title(ref.l) : ref.title) || "Session";
  const st = ref.kind === "live" ? ref.state : null;
  const metaParts = [esc(shortPath(ref.cwd)), esc(S.labels[ref.harness])];
  if (ref.kind === "saved") metaParts.push("Saved", "read-only", esc(nowAgo(ref.mtime)));
  const curStep = g ? (g.steps || []).findIndex((x) => x.state === "current") : -1;
  if (g && curStep >= 0) metaParts.push(`step ${curStep + 1}/${g.steps.length}: ${esc(clip(g.steps[curStep].label, 40))}`);
  if (st === "needs" && ref.l.lastActivity) { const since = nowAgo(ref.l.lastActivity); metaParts.push(`<span class="wait">waiting${since !== "now" ? " " + esc(since) : ""}</span>`); }
  const hdot = st === "run" ? "var(--accent-dot)" : st === "needs" ? "var(--amber-dot)" : "";
  return `
  <header class="head">
    <div class="head-t" title="${esc(g ? g.goal : "")}">${hdot ? `<span class="hdot" style="background:${hdot}"></span>` : ""}<span>${esc(name)}</span></div>
    <div class="head-meta">${metaParts.filter(Boolean).join(" · ")}</div>
    <div class="head-r">
    </div>
  </header>
  <div class="scroll" id="scroll"><div class="stack">
    <div class="thread">${feed(ref)}</div>
    <div class="dock">${composer(ref)}</div>
  </div></div>
  <aside class="railpane" id="railpane" aria-label="${curSide() ? "Side chat" : "Timeline"}">${curSide() ? sideChatHTML(curSide()) : railHTML(ref)}</aside>`;
}

// The latest exchange: the user's last message, the tools used since, the agent's reply.
function feed(ref) {
  const ev = ref.events || [];
  let lastUser = -1, lastAgent = -1;
  ev.forEach((e, i) => { if (e.role === "user") lastUser = i; if (e.role === "assistant") lastAgent = i; });
  const out = [];
  if (lastUser >= 0) {
    const t = ev[lastUser].text.trim();
    // Answers sent from cards show as one quiet line, not echoed as a big bubble.
    const items = S.sentItems.get(norm(t));
    if (items) {
      const k = "sent:" + hid(norm(t)), open = S.toolsOpen.has(k);
      out.push(`<div id="fb-${hid(t.slice(0, 80))}"><button class="disc sent-line" data-act="tools" data-k="${k}" aria-expanded="${open}">${icon("check", "s12")}<span>Sent ${plural(items.length, "answer")}</span>${icon("chev", "s12")}</button>
        ${open ? `<div class="sent-list">${items.map((x) => `<div class="qsum"><span class="qq">${esc(x.title)}</span><span class="qa">${esc(x.answer)}</span></div>`).join("")}</div>` : ""}</div>`);
    }
    else out.push(`<div class="bubble" id="fb-${hid(t.slice(0, 80))}" data-anim><div class="bclamp">${md(clip(t, 1200))}</div></div>`);
  }
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
  const err = ev.slice(lastUser + 1).reverse().find((e) => e.role === "error") || (ref.l && ref.l.turnError ? { text: ref.l.turnError.message, code: ref.l.turnError.code } : null);
  if (err && !working) out.push(errorCard(ref, err));
  return out.join("");
}
// A turn that failed before replying: say why, and offer the way out.
function errorCard(ref, err) {
  const model = /model/i.test(err.code || "") || /model.*not supported|model_not_found/i.test(err.text);
  const hint = model && ref.harness === "codex" ? "Codex's model in ~/.codex/config.toml isn't available on your account. Change <code>model</code> there, or run this step with Claude Code." : "Nothing was changed. Try again, or open the terminal to see more.";
  const step = ref.kind === "live" ? planStepOf(ref.id) : null;
  return `<section class="card" id="err-${hid(err.text.slice(0, 80))}" data-anim><div class="inline-err">${icon("alert")}<span><b>${esc(S.labels[ref.harness] || "The agent")} couldn't run this turn.</b> ${esc(err.text)}</span></div>
    <p class="ctxl" style="margin:8px 0 0">${hint}</p>
    <div class="qfoot"><button class="btn btn-text" data-act="term-open">Open the terminal</button><span class="sp"></span>${step && ref.harness !== "claude" && S.harnesses.claude ? `<button class="btn btn-tint" data-act="plan-rerun" data-id="${esc(ref.id)}">Run this step with Claude Code</button>` : ""}</div></section>`;
}
// The plan step a live session was started for, if any.
function planStepOf(id) {
  for (const plan of S.plans) { const i = (plan.started || []).indexOf(id); if (i >= 0) return { plan, i }; }
  return null;
}
const TOOL_ICON = { Read: "file", Edit: "filepen", Write: "filepen", MultiEdit: "filepen", Bash: "term", PowerShell: "term", shell: "term", Grep: "search", Glob: "search", WebSearch: "globe", WebFetch: "globe", web_search: "globe", AskUserQuestion: "chat", Agent: "flow", Task: "flow", Skill: "spark" };
function toolLine(t) {
  const i = t.input || {};
  let phrase = typeof i === "string" ? i : i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.description || i.skill || (i.questions && i.questions[0] && i.questions[0].question) || "";
  if (Array.isArray(phrase)) phrase = phrase.join(" ");
  phrase = String(phrase).replace(/^C:\\Users\\[^\\]+\\/i, "~\\");
  const literal = /^(\w:|~|\/|\.)/.test(phrase) || ["Bash", "PowerShell", "shell"].includes(t.tool);
  return `<div class="tline">${icon(TOOL_ICON[t.tool] || "dot")}<span class="tn">${esc(t.tool)}</span><span class="ta">${literal && phrase ? `<code>${esc(clip(phrase, 90))}</code>` : esc(clip(phrase, 110))}</span></div>`;
}

const permTitle = (tool, i) => ({ Bash: "Run this command", PowerShell: "Run this command", Edit: `Edit ${shortPath(i.file_path)}`, MultiEdit: `Edit ${shortPath(i.file_path)}`, Write: `Write ${shortPath(i.file_path)}`, WebFetch: "Fetch this page", Read: `Read ${shortPath(i.file_path)}` }[tool] || `Use ${tool}`);

// ---- Composer ---------------------------------------------------------------------
// Saved sessions are read-only here: offer to resume or fork them into a live session.
function composer(ref) {
  const active = Date.now() - (ref.mtime || 0) < 120000;
  const act = active ? "fork" : "resume";
  const armedNow = S.armed?.act?.startsWith(act + ":");
  return `<div class="dock-note">${icon("eye")}<span>${active ? "This session is active somewhere else right now. Shown read-only." : "A saved session, shown read-only."}</span><button class="btn ${armedNow ? "btn-tint" : "btn-text"}" data-act="${act}" id="resume-btn">${armedNow ? (active ? "Click again: start a copy here" : "Click again: continue it here") : active ? "Fork it into a new session here" : "Resume it in a terminal"}</button></div>`;
}

// ---- Terminal (3.10) ---------------------------------------------------------------------
function renderTerm() {
  const wrap = $("#termwrap");
  const ref = S.page === "session" ? current() : null;
  const show = !!(ref && ref.kind === "live");
  wrap.hidden = !show;
  if (!show) return;
  const l = ref.l;
  $("#termwrap .termframe").classList.toggle("ended", !l.alive);
  morph($("#tend"), l.alive ? "" : `<span>${icon("power", "s14")}${l.stopped ? "Session stopped" : `Session ended${l.exitCode ? ` (exit code ${l.exitCode})` : ""}`}</span><span class="sp"></span>${l.harness === "claude" && l.file ? `<button class="btn btn-tint sm" data-act="resume" ${S.inflight.has("resume") ? "disabled" : ""}>Resume</button>` : ""}<button class="btn btn-neutral sm" data-act="new-here">New session here</button><button class="btn btn-text sm" data-act="session-close" title="Remove it from the running list; it stays in your saved sessions">Close</button>`);
  // Until the CLI is up, the frame says so, rather than showing an empty box.
  const boot = $("#tboot"); boot.hidden = !(l.alive && l.status === "starting");
  if (!boot.hidden) boot.innerHTML = `<span class="spin"></span>${esc(S.labels[l.harness] || "The agent")} is starting in ${esc(shortPath(l.cwd))}…`;
  morph($("#tstrip"), `${icon("term")}${l.fresh ? `<button class="tpick" data-act="fresh-harness" title="Switch to another agent">${esc(S.labels[l.harness])}${icon("chevd", "s12")}</button><button class="tpick cwd" data-act="fresh-folder" title="${esc(l.cwd)}">${icon("folder", "s14")}${esc(shortPath(l.cwd))}${icon("chevd", "s12")}</button>` : `<b>${esc(S.labels[l.harness])}</b><span class="cwd" title="${esc(l.cwd)}">${esc(l.cwd)}</span>`}<span class="sp"></span>
    ${l.alive ? `<button class="btn btn-text" data-act="term-int">Interrupt</button><button class="btn btn-text" data-act="term-clear" title="Clears this window's view of the terminal; the session is untouched">Clear screen</button>` : ""}`);
  let t = terms.get(l.id);
  if (!t) {
    const el = document.createElement("div"); el.className = "xterm-wrap";
    // The harnesses draw for a dark terminal (Claude Code's own theme), so the terminal stays dark, as it looks at home.
    const theme = { background: "#141414", foreground: "#e8e8e8", cursor: "#4880e8", cursorAccent: "#141414", selectionBackground: "#4880e84d", black: "#3a3a3a", brightBlack: "#6e6e6e", red: "#f87171", brightRed: "#fca5a5", green: "#5fd16a", brightGreen: "#86efac", yellow: "#e9b04a", brightYellow: "#fcd34d", blue: "#8fb0f2", brightBlue: "#b6c9f5", magenta: "#b699f9", brightMagenta: "#d4c2fc", cyan: "#8be6c5", brightCyan: "#99f6e4", white: "#d4d4d4", brightWhite: "#f5f5f5" };
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
// Send the user to the terminal: focus it and flash its frame so the eye lands there.
function focusTerm(ref) {
  const t = ref && terms.get(ref.id); if (!t) return;
  t.term.focus();
  const f = $("#termwrap .termframe"); if (f) { f.classList.remove("flash"); void f.offsetWidth; f.classList.add("flash"); }
}
function fitTerm(t) { try { const c = t.term.cols, r = t.term.rows; t.fit.fit(); if (c !== t.term.cols || r !== t.term.rows || !t.sized) { t.sized = true; send({ type: "resize", id: t.id, cols: t.term.cols, rows: t.term.rows }); } } catch {} }

// ---- Discuss it: a side agent for a question you can't answer yet ---------------------------
// Opened from a question in "Needs from you". A copy of the session (a fork) talks it through with you;
// "Answer with this" writes the answer into your reply, for you to check before sending. The
// discussion stays with the session, read-only, so you can see later what you decided.
const SUGG = ["What would you recommend?", "What has it built for this so far?", "What changes if I pick the other option?"];
function sideChatHTML(sd) {
  const d = sd.data, x = sd.extra;
  const msgs = d ? d.msgs || [] : sd.first ? [{ who: "me", text: sd.first }] : [];
  const busy = sd.busy || (d && d.busy);
  const agent = esc(S.labels[sd.ref.harness] || "The agent");
  const canAnswer = !sd.readonly && msgs.some((m) => m.who === "ai") && !busy;
  const aside = !!x.aside, live = !!S.live.get(sd.ref.id)?.alive;
  const title = sd.readonly ? (aside ? "Asked on the side" : "Discussed on the side") : aside ? "Ask on the side" : "Discuss it";
  return `
    <div class="sp-head"><button class="ibtn" data-act="side-close" aria-label="Back" title="Back to what it needs">${icon("back")}</button><div class="tt"><b>${title}</b><small>A side agent with a copy of this session. ${agent} won't see any of this unless you send it.</small></div>${aside && !sd.readonly ? `<button class="btn btn-text sm" data-act="aside-new" title="Start a fresh side conversation">New</button>` : ""}</div>
    ${aside ? "" : `<div class="card sp-q">${x.of ? `<div class="nh"><span>${esc(x.of)}</span></div>` : ""}<div class="nq">${esc(x.question || sd.topic)}</div>${x.ctx ? `<div class="nc">${esc(x.ctx)}</div>` : ""}${(x.options || []).length ? `<div class="npills">${x.options.map((o) => `<span class="npill static" title="${esc(o.detail || "")}">${esc(o.label)}</span>`).join("")}</div>` : ""}</div>`}
    <div class="sp-body" id="sp-body">
      ${msgs.map((m, i) => m.who === "ai" ? `<div class="sp-ai" id="sm-${i}" data-anim><div class="who">${icon("chat", "s12")}Side agent</div>${md(m.text)}</div>` : `<div class="sp-me" id="sm-${i}">${esc(m.text)}</div>`).join("")}
      ${busy ? `<div class="sp-wait" id="sp-wait"><span class="spin"></span><span class="shimmer t2">${sd.composingBusy ? "Writing your answer" : d ? "Thinking" : "Reading the session and the files"}</span></div>` : ""}
      ${sd.err ? `<div class="sp-err">${esc(sd.err)}</div>` : ""}
      ${!msgs.length && !busy && !sd.err ? `<div class="sp-empty">${aside ? `Ask anything about this session, over as many messages as you like. This agent has read the whole session and can check the project's files. Nothing reaches ${agent} unless you send it.` : "Ask anything about this question, over as many messages as you like. The side agent has read the whole session and can open the project's files. When you're ready, it writes the answer into your reply."}</div>
        ${aside || sd.readonly ? "" : `<div class="sp-sugg">${SUGG.map((t) => `<button class="npill" data-act="side-sugg" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`}` : ""}
    </div>
    <div class="sp-foot">
      ${sd.readonly ? `<div class="sp-done">${icon("check", "s14")}<span>${aside ? "Sent. Kept here for reference." : "Answered. Kept here so you can see what you decided."}</span></div>`
      : aside && sd.draft != null ? `
      <div class="sp-composed"><div class="h"><span>Message to ${agent} · editable</span></div><textarea id="sp-composed" data-keep data-draft="asidedraft:${esc(sd.key)}" aria-label="Message to send"></textarea></div>
      <div class="sp-actions"><button class="btn btn-text" data-act="aside-back">Keep talking</button><span class="sp"></span><button class="btn btn-tint" data-act="aside-send" ${live && !S.inflight.has("aside-send") ? "" : "disabled"} title="${live ? "Typed into the session as your next message" : "This session isn't running"}">Send to ${agent}</button></div>`
      : `
      <div class="sp-compose"><textarea id="sp-in" data-keep data-draft="side:${esc(sd.key)}" rows="1" placeholder="${aside ? "Ask anything about this session" : "What's unclear?"}" aria-label="Message the side agent"></textarea><button class="send sm" data-act="side-msg" aria-label="Send" ${busy ? "disabled" : ""}>${icon("up")}</button></div>
      <div class="sp-actions">${aside ? "" : `<span class="t3 fs13">${canAnswer ? "The answer goes into your reply, for you to check before sending." : ""}</span>`}<span class="sp"></span>${aside ? `<button class="btn btn-neutral" data-act="side-answer" ${canAnswer && live ? "" : "disabled"} title="Turn this into a message for ${agent}; you check it before it's sent">Write a message</button>` : `<button class="btn btn-tint" data-act="side-answer" ${canAnswer ? "" : "disabled"} title="Write the answer from this discussion into your reply">Answer with this</button>`}</div>`}
    </div>`;
}

// One side discussion per question, kept with the session. Opening needs no call: the side agent
// starts with your first message.
const sideKey = (ref, x) => `${refKey(ref)}|${x.need ? `need:${x.need}` : `aside:${x.aside}`}`;
// Ask on the side: your own side conversation about this session, any time. Reopens the one in progress.
function openAside(fresh) {
  const ref = current(); if (!ref) return;
  const open = [...S.sides.values()].filter((sd) => sd.extra.aside && sd.key.startsWith(refKey(ref) + "|") && !sd.readonly).pop();
  if (open && !fresh) { S.sideOpen = open.key; render(); setTimeout(() => { $("#sp-in")?.focus(); scrollSide(); }, 30); return; }
  openSide({ aside: Date.now().toString(36), question: "" });
}
function openSide(extra) {
  const ref = current(); if (!ref) return;
  const key = sideKey(ref, extra);
  let sd = S.sides.get(key);
  if (!sd) {
    sd = { key, ref: { kind: ref.kind, id: ref.id, harness: ref.harness, file: ref.file, cwd: ref.cwd, mainId: ref.harness === "claude" && ref.kind === "live" ? ref.id : null }, topic: extra.question, extra, data: null, busy: false, err: "" };
    S.sides.set(key, sd);
  }
  sd.extra = { ...sd.extra, ...extra };
  sd.readonly = false; S.sideOpen = key; render();
  setTimeout(() => { $("#railpane")?.scrollTo?.(0, 0); $("#sp-in")?.focus(); scrollSide(); }, 30);
}
function closeSide() { S.sideOpen = null; render(); }
function scrollSide() { setTimeout(() => { const b = $("#sp-body"); if (b) b.scrollTop = b.scrollHeight; }, 20); }

async function sideMsg() {
  const sd = curSide(); const ta = $("#sp-in"); if (!ta || !sd || sd.busy || (sd.data && sd.data.busy)) return;
  const v = ta.value.trim(); if (!v) return;
  ta.value = ""; S.drafts.delete(ta.dataset.draft); autosize(ta); sd.err = ""; sd.busy = true;
  const topic = sd.extra.aside ? "" : `${sd.extra.question}${(sd.extra.options || []).length ? ` Options: ${sd.extra.options.map((o) => o.label).join("; ")}` : ""}`;
  try {
    if (!sd.data) {
      // The first message starts the side agent (a fork of the session), with the question as its subject.
      sd.first = v; render(); scrollSide();
      sd.data = await api("/api/side", { harness: sd.ref.harness, file: sd.ref.file, mainId: sd.ref.mainId, cwd: sd.ref.cwd, topic, first: v });
      sd.busy = !!sd.data.busy;
      if (sd.busy) setTimeout(async () => { try { const d = await api(`/api/side/${sd.data.id}`); if (d && d.id && !d.busy && sd.busy) { sd.data = d; sd.busy = false; sd.err = d.err || ""; render(); scrollSide(); } } catch {} }, 5000);
    } else {
      const mine = { who: "me", text: v }; sd.data.msgs.push(mine); render(); scrollSide();
      try { sd.data = await api(`/api/side/${sd.data.id}/msg`, { text: v }); }
      catch (e) { const i = sd.data.msgs.indexOf(mine); if (i >= 0) sd.data.msgs.splice(i, 1); throw e; }
      sd.busy = false;
    }
  } catch (e) { sd.err = e.message; sd.busy = false; if (!sd.data) sd.first = ""; const t = $("#sp-in"); if (t && !t.value) t.value = v; }
  render(); scrollSide(); $("#sp-in")?.focus();
}

// "Answer with this": the side agent writes the answer in one line; it goes into your reply (as the
// option it names, or as your own answer), and the rail comes back with that question flashing.
async function sideAnswer() {
  const sd = curSide(); if (!sd || sd.busy || !sd.data) return;
  sd.busy = true; sd.composingBusy = true; render(); scrollSide();
  const ref = current();
  try {
    if (sd.extra.aside) {
      const r = await api(`/api/side/${sd.data.id}/compose`, { known: [], answerOnly: false });
      sd.data = r; const text = String(r.composed || "").trim();
      sd.draft = text; S.drafts.set(`asidedraft:${sd.key}`, text); sd.busy = false; sd.composingBusy = false; render(); setTimeout(() => $("#sp-composed")?.focus(), 30); return;
    }
    const known = needsOf(ref).filter((n) => replyable(n) && n.id !== sd.extra.need && answerOf(ref, n).trim()).map((n) => ({ title: n.key, answer: answerOf(ref, n).trim() }));
    const opts = sd.extra.options || [];
    const r = await api(`/api/side/${sd.data.id}/compose`, { known, options: opts.map((o) => o.label) });
    sd.data = r;
    const text = String(r.composed || "").trim().replace(/^["“]|["”]$/g, "");
    const k = sd.extra.akey;
    S.ans.set(k, text); S.worked.add(k);
    if (!opts.some((o) => isOption(text, o))) { S.elseOpen.add(k); S.drafts.set("else:" + k, text); } else { S.elseOpen.delete(k); S.drafts.delete("else:" + k); }
    S.sideOpen = null; sd.busy = false; sd.composingBusy = false; render();
    const el = $(`#else-${hid(k)}`); if (el && el.value !== text && S.elseOpen.has(k)) { el.value = text; autosize(el); }
    const card = $(`#need-${hid(k)}`); if (card) { card.scrollIntoView({ block: "center" }); card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    toast("Added to your reply", clip(text, 80), "ok", null, 2500);
    return;
  } catch (e) { sd.err = e.message; }
  sd.busy = false; sd.composingBusy = false; render();
}

// Send what you worked out on the side as your next message. If the agent is asking you something
// right now, that comes first (answer it, or Discuss it).
async function asideSend(ref) {
  const sd = curSide(); if (!sd) return;
  const text = (($("#sp-composed") || {}).value || S.drafts.get(`asidedraft:${sd.key}`) || "").trim(); if (!text) return;
  if (ref.l && ref.l.pendingAsk) { toast(`${S.labels[ref.harness] || "The agent"} is asking you something`, "Answer or discuss its question first, then send this.", "needs"); return; }
  await guarded("aside-send", () => api(`/api/sessions/${ref.id}/send`, { text }));
  S.drafts.delete(`asidedraft:${sd.key}`); sd.draft = null; sd.readonly = true; sd.sent = true;
  if (sd.data) api(`/api/side/${sd.data.id}/sent`, { text }).catch(() => {});
  S.sideOpen = null; render();
  toast(`Sent to ${S.labels[ref.harness] || "the agent"}`, "", "ok", null, 3000);
}

// Send your reply: every answer in one message, typed in as your next message. If its question menu
// is open, GenUI closes it first (Esc, once). Answered asks clear at once and are recorded, so they
// don't come back before the AI has read the reply.
async function sendReply(ref) {
  const ta = $(".replytext"), text = ((ta && ta.value) || "").trim();
  if (!text || !ref.l || !ref.l.alive) return;
  const done = needsOf(ref).filter((n) => replyable(n) && answerOf(ref, n).trim()).map((n) => ({ n, k: ak(ref, n), answer: answerOf(ref, n).trim() }));
  await guarded("reply", async () => {
    await api(`/api/sessions/${ref.id}/${ref.l.pendingAsk ? "answer" : "send"}`, { text });
    const list = S.doneNow.get(seenKey(ref)) || [];
    for (const { n, k, answer } of done) {
      S.sentAsks.add(k); list.push({ id: k, q: n.q, answer });
      S.ans.delete(k); S.elseOpen.delete(k); S.drafts.delete("else:" + k);
      const sd = S.sides.get(`${refKey(ref)}|need:${n.id}`);
      if (sd) { sd.readonly = true; if (sd.data) api(`/api/side/${sd.data.id}/sent`, { text: answer }).catch(() => {}); }
    }
    S.doneNow.set(seenKey(ref), list);
    S.replyEdited.delete(refKey(ref)); if (ta) ta.value = "";
    S.sentItems.set(norm(text), done.map((x) => ({ title: x.n.key, answer: x.answer }))); saveSent();
    const rec = done.filter((x) => !x.n.id.startsWith("m:")).map((x) => ({ id: x.n.id, answer: x.answer }));
    if (ref.file && rec.length) api("/api/asks", { harness: ref.harness, file: ref.file, answers: rec }).then((g) => { if (g && g.notes) mergeGen(ref.file, g); schedule(); }).catch(() => {});
  });
  toast(`Sent to ${S.labels[ref.harness] || "the agent"}`, done.length ? plural(done.length, "answer") : "", "ok", null, 3000);
}

// ---- Orchestrator: every agent at a glance, for when you come back ---------------------------------
const TONE = { needs: "needs", run: "working", reading: "working", idle: "turn", done: "turn", off: "off" };
const DASH_LABEL = { needs: "Needs you", working: "Working", turn: "Your turn", off: "Ended" };

// The session as one line of dots, oldest on the left: a ring for each of your messages, a dot for
// each step, a short spur with × for work set aside, a dashed tick where you last looked.
function miniFlow(ref, m, needs, tone) {
  const W = 236, pitch = 16, maxN = 13, y = 26;
  if (!m || !m.sections.length) return `<svg width="${W}" height="44" viewBox="0 0 ${W} 44" aria-hidden="true"><circle class="mf-work" cx="8" cy="${y}" r="4"/></svg>`;
  const asking = new Set(needs.filter(replyable).map((n) => n.step));
  const items = [];
  m.sections.forEach((sec, si) => { items.push({ sec, si, goal: true }); sec.steps.forEach((s) => items.push({ s, si, you: s.kind === "you" })); });
  const hidden = Math.max(0, items.length - maxN), vis = items.slice(hidden), x0 = hidden ? 30 : 8;
  vis.forEach((n, i) => (n.x = x0 + i * pitch));
  let svg = `<path class="mf-line" d="M${vis[0].x},${y} H${vis.at(-1).x}"/>`;
  const curStart = vis.find((n) => n.goal && n.si === m.sections.length - 1);
  if (curStart) svg += `<path class="mf-line cur" d="M${curStart.x},${y} H${vis.at(-1).x}"/>`;
  if (hidden) svg += `<text class="mf-more" x="0" y="${y + 4}">+${hidden}</text>`;
  const firstNew = vis.findIndex((n) => n.s && n.s.isNew), look = lookFor(ref);
  if (firstNew > 0 && look) { const x = vis[firstNew].x - pitch / 2; svg += `<line class="mf-look" x1="${x}" y1="6" x2="${x}" y2="42"><title>You looked at ${esc(clock(look.from.at))}</title></line>`; }
  for (const n of vis) {
    if (n.goal) { svg += `<circle class="mf-ring" cx="${n.x}" cy="${y}" r="4.5"><title>You: ${esc(clip(n.sec.text, 80))}</title></circle>`; continue; }
    const s = n.s, label = esc(s.label);
    if (n.you) { svg += `<circle class="mf-ring" cx="${n.x}" cy="${y}" r="3"><title>${label}</title></circle>`; continue; }
    if (s.dropped) { svg += `<g><title>Dropped: ${label}</title><path class="mf-spur" d="M${n.x - pitch},${y} L${n.x},${y - 13}"/><path class="mf-x" d="M${n.x - 3},${y - 16} l6,6 M${n.x + 3},${y - 16} l-6,6"/></g>`; continue; }
    if (s === m.last) {
      if (tone === "needs") svg += `<g><title>${label}</title><circle class="mf-halo" cx="${n.x}" cy="${y}" r="10"/><circle class="mf-disc" cx="${n.x}" cy="${y}" r="7"/><path class="mf-mark" d="M${n.x},${y - 3} V${y + 0.6} M${n.x},${y + 3.2} v0.1"/></g>`;
      else if (tone === "working") svg += `<g><title>${label}</title><circle class="mf-work" cx="${n.x}" cy="${y}" r="4"/><path class="mf-orbit" d="M${n.x + 8},${y} A8,8 0 1 1 ${n.x - 2.8},${y - 7.5}"><animateTransform attributeName="transform" type="rotate" from="0 ${n.x} ${y}" to="360 ${n.x} ${y}" dur="0.8s" repeatCount="indefinite"/></path></g>`;
      else svg += `<g><title>${label}</title><circle class="mf-turn" cx="${n.x}" cy="${y}" r="6"/></g>`;
      continue;
    }
    const amber = asking.has(s.id);
    svg += `<circle class="${amber ? "mf-amber" : s.isNew ? "mf-new" : "mf-done"}" cx="${n.x}" cy="${y}" r="${amber ? 4.5 : 3.5}"><title>${label}</title></circle>`;
  }
  return `<svg width="${W}" height="44" viewBox="0 0 ${W} 44" role="img" aria-label="${plural(m.sections.length, "request")}, ${plural(m.flat.length, "step")}">${svg}</svg>`;
}

// What it did lately: the AI's line, or the last step code saw.
function didLine(m, g) {
  if (g && g.did) return g.did;
  const x = m && [...m.flat].reverse().find((y) => y.s.kind !== "you" && !y.s.dropped && y.s !== m.last) ;
  return x ? x.s.summary || x.s.label : "";
}

function agentRow(x) {
  const { l, ref, st, m, needs } = x, g = genFor(l.file), tone = TONE[st] || "turn", rep = needs.filter(replyable), nw = newSteps(m).length;
  const ps = planStepOf(l.id);
  const did = didLine(m, g);
  const line2 = tone === "needs" ? `<div class="ar-l need"><span class="k">Needs</span><span class="v">${esc(needLine(ref, needs) || "Needs you")}</span></div>`
    : tone === "working" ? `<div class="ar-l now"><span class="k">Now</span><span class="v"><span class="shimmer">${esc(st === "reading" ? "Reading the reply" : activity(ref) || "Working")}</span>${rep.length ? ` <span class="old">· ${plural(rep.length, "answer")} still open</span>` : ""}</span></div>`
    : tone === "off" ? `<div class="ar-l"><span class="k">Ended</span><span class="v">${l.stopped ? "You stopped it" : "The session ended"}</span></div>`
    : `<div class="ar-l"><span class="k">Next</span><span class="v t1">${esc((g && g.now) || "Your turn")}</span></div>`;
  return `<div class="arow" role="button" tabindex="0" data-act="open-live" data-id="${esc(l.id)}" id="ov-${esc(l.id)}">
    <div class="ar-main">
      <div class="ar-t"><span class="dot ${tone}"></span><span class="tt">${esc(title(l))}</span></div>
      <div class="ar-sub">${esc(shortPath(l.cwd))} · ${esc(S.labels[l.harness])}${m ? ` · ${plural(m.sections.length, "request")}` : ""}${ps ? ` · plan step ${ps.i + 1}/${ps.plan.steps.length}` : ""}</div>
      ${did ? `<div class="ar-l"><span class="k">Did</span><span class="v">${esc(clip(did, 180))}</span></div>` : ""}
      ${line2}
    </div>
    <div class="ar-flow">${miniFlow(ref, m, needs, tone)}</div>
    <div class="ar-st">
      <span class="stl ${tone}"><span class="d"></span>${DASH_LABEL[tone]}${rep.length ? ` <span class="badge">${rep.length}</span>` : ""}</span>
      <span class="ar-meta">${nw ? `<span class="newchip">${nw} new</span>` : ""}<span class="num">${esc(nowAgo(l.lastActivity || l.createdAt))}</span></span>
    </div>
  </div>`;
}

function allNeedsHTML(rows) {
  const groups = rows.filter((x) => x.l.alive && x.needs.some(replyable));
  if (!groups.length) return `<div class="card allclear">${icon("check", "s14")}<span>Nothing needs you. Every question is answered.</span></div>`;
  return `<div class="card nlist">${groups.map((x) => { const rep = x.needs.filter(replyable); return `<div class="ngroup">
      <div class="ng-h"><span class="dot ${TONE[x.st]}"></span>${esc(title(x.l))} <span class="t2">${esc(S.labels[x.l.harness])}</span></div>
      ${rep.map((n) => `<button class="nitem" data-act="goto-need" data-id="${esc(x.l.id)}" data-need="${esc(n.id)}">
        <span class="q">${esc(n.q)}</span>${n.ctx ? `<span class="c">${esc(n.ctx)}</span>` : ""}
        <span class="w">${n.old ? `<span class="old">${n.t ? `open ${span(Date.now() - n.t)}` : "still open"}</span>` : `<span>${esc(clock(n.t))}</span>`}${icon("chev", "s12")}</span>
      </button>`).join("")}
      <div class="ng-foot"><button class="btn btn-tint sm" data-act="open-live" data-id="${esc(x.l.id)}">Answer ${rep.length > 1 ? `all ${rep.length}` : "it"}</button></div>
    </div>`; }).join("")}</div>`;
}

function overviewHTML() {
  const order = { needs: 0, idle: 1, done: 1, run: 2, reading: 2, off: 4 };
  const rows = [...S.live.values()].filter((l) => !l.fresh).map((l) => { const ref = liveRef(l); return { l, ref, st: liveState(l), m: model(ref), needs: needsOf(ref) }; });
  rows.sort((a, b) => order[a.st] - order[b.st] || b.needs.filter(replyable).length - a.needs.filter(replyable).length || (b.l.lastActivity || 0) - (a.l.lastActivity || 0));
  const running = rows.filter((x) => x.l.alive), ended = rows.filter((x) => !x.l.alive).slice(0, 6);
  const count = (t) => running.filter((x) => TONE[x.st] === t).length;
  const total = running.reduce((k, x) => k + x.needs.filter(replyable).length, 0), asking = running.filter((x) => x.needs.some(replyable)).length;
  const back = S.appAway ? `Welcome back. You were away <b>${span(S.appAway.ms)}</b>, since ${esc(clock(S.appAway.from))}.` : "Where each agent is, and what it needs from you.";
  const plans = S.plans.slice(0, 6);
  const hflow = (steps) => `<div class="hflow">${steps.slice(0, 10).map((s) => `<span class="hn ${s.state === "current" ? "current run" : s.state}" title="${esc(s.label)}"><span class="rn"></span><span class="hl">${esc(s.label)}</span></span>`).join("")}</div>`;
  const planRow = (p, pi) => {
    const started = p.started || [], done = p.done || [];
    const stepState = (i) => done[i] ? "done" : started[i] ? (S.live.get(started[i])?.alive ? "current" : "done") : "next";
    const steps = p.steps.map((s, i) => ({ label: s.label, state: stepState(i) }));
    const nextI = p.steps.findIndex((_, i) => !started[i] && !done[i]);
    const prevRunning = nextI > 0 && stepState(nextI - 1) === "current";
    const ns = nextI >= 0 ? p.steps[nextI] : null;
    const action = !ns ? `${p.steps.length}/${p.steps.length}` : ns.harness === "you"
      ? `<button class="btn btn-neutral sm" data-act="plan-done" data-p="${pi}" data-i="${nextI}">Mark ${nextI + 1} done</button>`
      : `<button class="btn ${prevRunning ? "btn-neutral" : "btn-tint"} sm" data-act="plan-start" data-p="${pi}" data-i="${nextI}" ${S.inflight.has(`plan:${pi}:${nextI}`) ? "disabled" : ""} title="${prevRunning ? "The previous step is still running" : ""}">${prevRunning ? "Start anyway" : `Start ${nextI + 1}`}</button>`;
    return `<div class="ovrow ovplan" id="pl-${pi}">
      <span class="ovt"><b>${esc(p.title)}</b><small>${esc(shortPath(p.cwd))} · plan</small></span>${hflow(steps)}
      <span class="ovnow">${ns ? `Next: ${esc(ns.label)}${ns.harness === "you" ? " (yours)" : ""}` : "All steps done or started"}</span>
      <span class="ovm">${action}</span></div>`;
  };
  const body = S.dashTab === "needs" ? allNeedsHTML(rows)
    : running.length ? `<div class="card arows">${running.map(agentRow).join("")}</div>
      <div class="dlegend"><span><span class="dot needs"></span>Needs you</span><span><span class="dot turn"></span>Your turn</span><span><span class="dot working"></span>Working</span><span><span class="lg-look"></span>Where you left off</span><span><span class="k-ring"></span>Your message</span><span><span class="k-x">×</span>Dropped</span></div>`
    : `<section class="card ovcard"><div class="ovempty"><span>No agents running. Start one from a new session.</span><button class="btn btn-tint" data-act="new-session">New session</button></div></section>`;
  return `<header class="head"><div class="head-t">Orchestrator</div><div class="head-meta">Agents started here</div><div class="head-r"><button class="btn btn-neutral sm" data-act="go" data-page="plan" title="Break a bigger goal into steps for several agents">${icon("flow", "s14")}Plan a goal</button></div></header>
  <div class="scroll"><div class="dash">
    <div class="dhead">
      <p class="back-line">${back}</p>
      <div class="dtabs" role="tablist">
        <button role="tab" class="${S.dashTab !== "needs" ? "on" : ""}" data-act="dash-tab" data-tab="agents" aria-selected="${S.dashTab !== "needs"}">Agents · ${running.length}</button>
        <button role="tab" class="${S.dashTab === "needs" ? "on" : ""}" data-act="dash-tab" data-tab="needs" aria-selected="${S.dashTab === "needs"}">All needs${total ? ` <span class="badge">${total}</span>` : ""}</button>
      </div>
    </div>
    <div class="sumline"><b class="${count("needs") ? "am" : ""}">${count("needs")} need${count("needs") === 1 ? "s" : ""} you</b>${total ? ` · ${plural(total, "answer")} across ${plural(asking, "agent")}` : ""} · <b>${count("turn")}</b> your turn · <b>${count("working")}</b> working</div>
    ${body}
    ${plans.length ? `<div class="sec">Plans</div><section class="card ovcard">${plans.map(planRow).join("")}</section>` : ""}
    ${ended.length && S.dashTab !== "needs" ? `<div class="sec">Ended</div><div class="card arows ended">${ended.map(agentRow).join("")}</div>` : ""}
  </div></div>`;
}

// ---- New goal (3.12) ---------------------------------------------------------------------
function newGoalHTML() {
  const ng = S.ng;
  const avail = ["claude", "codex", "grok"].filter((h) => S.harnesses[h]);
  const harnessOpts = (sel) => [...avail, "you"].map((h) => `<option value="${h}" ${sel === h ? "selected" : ""}>${h === "you" ? "You" : esc(S.labels[h])}</option>`).join("");
  let planHTML = "";
  if (ng.busy) {
    const secs = Math.max(1, Math.round((Date.now() - ng.startedAt) / 1000));
    planHTML = `<div class="bubble" id="plan-goal"><div class="bclamp">${esc(ng.goal)}</div></div><div class="disc" id="planning">${icon("chev")}<span class="shimmer">Planning</span><span class="t3 num">${secs}s</span></div>
      <section class="card qcard" id="plan-skel"><div class="eyebrow">${icon("list")}Plan</div><h3 class="t3">${esc(clip(ng.goal, 90))}</h3><div class="qbody">${[0, 1, 2, 3, 4].map(() => `<div class="ghost-row"></div>`).join("")}</div></section>`;
  } else if (ng.err) {
    planHTML = `<section class="card" id="plan-err"><div class="inline-err">${icon("alert")}<span>Couldn't plan it: ${esc(clip(ng.err, 200))}</span></div><div class="qfoot"><button class="btn btn-text" data-act="plan-reset">Edit the goal</button><span class="sp"></span><button class="btn btn-tint" data-act="plan">Try again</button></div></section>`;
  } else if (ng.plan) {
    const p = ng.plan;
    const first = p.steps.findIndex((s) => s.harness !== "you");
    planHTML = `<div class="bubble" id="plan-goal"><div class="bclamp">${esc(ng.goal)}</div></div>
    <section class="card qcard" id="plan-card" data-anim>
      <div class="eyebrow">${icon("list")}Plan<span class="stat idle" style="font-weight:400">${plural(p.steps.length, "step")}</span></div>
      <h3>${esc(p.title)}</h3><p class="ctxl">${esc(p.goal)}</p>
      <div class="qbody"><ol class="rail" style="margin:0">${p.steps.map((s, i) => `<li class="prow plan-step" style="animation-delay:${i * 100}ms" id="ps-${i}"><span class="rn"></span><span>${esc(s.label)}</span>
        <select data-act-change="plan-harness" data-i="${i}" aria-label="Who does step ${i + 1}">${harnessOpts(s.harness)}</select>
        ${s.why ? `<span class="pwhy">${esc(s.why)}</span>` : ""}
        ${(s.needs || []).length ? `<div class="pneeds">${s.needs.map((n) => `<div class="pneed"><span class="q"><span class="who ${n.owner === "you" ? "you" : "team"}">${n.owner === "you" ? "You" : esc(n.owner)}</span>${esc(n.question)}</span><div class="field"><input data-keep id="pn-${hid(n.question)}" data-act-input="plan-need" data-q="${esc(n.question)}" placeholder="${n.owner === "you" ? "Answer now, or leave it for later" : "If you already know it"}" aria-label="${esc(n.question)}"></div></div>`).join("")}</div>` : ""}
      </li>`).join("")}</ol>
      <div class="settings"><button class="pill" data-act="pick-folder">${icon("folder")}<span>${esc(shortPath(ng.cwd))}</span></button><span class="pill-note">A fresh worker for each step, started when you say</span></div></div>
      <div class="qfoot"><button class="btn btn-text" data-act="plan">Plan again</button><span class="sp"></span>${first >= 0 ? `<button class="btn btn-tint" data-act="plan-go" ${ng.going ? "disabled" : ""}>${ng.going ? `<span class="spin"></span>Starting` : `Start step ${first + 1}`}</button>` : ""}</div>
    </section>`;
  }
  // Sending starts the harness with exactly what you typed, as if typed into it at home. Planning a
  // goal into several agents first is a separate, optional action.
  const h = S.labels[ng.harness] || "Claude Code";
  const planning = S.page === "plan";
  return `<header class="head"><div class="head-t">${planning ? "Plan a goal" : "New session"}</div>${planning ? `<div class="head-meta">Breaks a bigger goal into steps, each run by its own agent</div>` : ""}</header>
  <div class="scroll"><div class="newgoal">
    ${planning ? planHTML : ""}
    ${planning && (ng.plan || ng.busy) ? "" : `<div class="composer" id="ng-composer"><textarea id="ng-goal" data-keep data-draft="ng-goal" rows="2" placeholder="${planning ? "Describe the goal to plan" : `Message ${esc(h)}`}" aria-label="${planning ? "Goal" : "First message"}"></textarea>
      <div class="tbar"><button class="pill" data-act="pick-folder" id="ng-folder">${icon("folder")}<span>${ng.cwd ? esc(shortPath(ng.cwd)) : "Choose a folder"}</span></button>
        <button class="pill" data-act="ng-harness" title="Which agent to start">${icon("term")}<span>${esc(h)}</span></button><span class="sp"></span>
        ${planning ? `<button class="send" data-act="plan" aria-label="Plan it" title="Plan it into steps">${icon("up")}</button>` : `<button class="send" data-act="start-now" aria-label="Start ${esc(h)}" title="Start ${esc(h)} with this message" ${S.inflight.has("start-now") ? "disabled" : ""}>${icon("up")}</button>`}</div></div>
      <div class="hint">${planning ? "Plans the goal into steps, assigns an agent to each, and asks up front what each step will need." : `Starts ${esc(h)} in that folder with your message, exactly as in your terminal.`}</div>`}
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
      case "regen": ensureGen(true); break;
      case "tools": S.toolsOpen.has(k) ? S.toolsOpen.delete(k) : S.toolsOpen.add(k); render(); break;
      case "side-close": closeSide(); break;
      case "stop-ask": S.stopAsk = S.stopAsk === ref.id ? null : ref.id; render(); break;
      case "stop-cancel": S.stopAsk = null; render(); break;
      case "stop-session": S.stopAsk = null; render(); await api(`/api/sessions/${ref.id}/stop`, {}); break;
      case "new-here": await newSession(ref.cwd, ref.harness); break;
      case "new-session": await newSession(); break;
      // Before you send anything, a new session can still move to another folder or agent.
      case "fresh-folder": openPicker(el, ref.cwd); S.picker.fresh = ref.id; break;
      case "fresh-harness": { const av = ["claude", "codex", "grok"].filter((h) => S.harnesses[h]); await newSession(ref.cwd, av[(av.indexOf(ref.harness) + 1) % av.length], ref.id); break; }
      case "session-close": { await api(`/api/sessions/${ref.id}/forget`, {}); S.live.delete(ref.id); go("overview"); refresh().catch(() => {}); break; }
      case "interrupt": await api(`/api/sessions/${ref.id}/interrupt`, { key: "esc" }); break;
      case "term-int": await api(`/api/sessions/${ref.id}/interrupt`, { key: "ctrlc" }); break;
      case "term-clear": terms.get(ref.id)?.term.clear(); break;
      case "term-yes": await api(`/api/sessions/${ref.id}/terminal`, { choice: "yes" }); break;
      case "term-no": await api(`/api/sessions/${ref.id}/terminal`, { choice: "no" }); break;
      case "term-open": focusTerm(ref); break;
      case "side-review": { const sd = S.sides.get(el.dataset.k); if (sd) { sd.readonly = sd.extra.aside ? !!sd.sent : !needsOf(ref).some((n) => n.id === sd.extra.need); S.sideOpen = sd.key; render(); scrollSide(); } break; }
      // The timeline: open a step to see what happened in it; open a fold.
      case "tl-step": { const k = "st:" + refKey(ref) + el.dataset.step; if (S.open.has(k)) S.open.delete(k); else S.open.add(k); render(); break; }
      case "tl-fold": if (S.open.has(k)) S.open.delete(k); else S.open.add(k); render(); break;
      case "goto-step": gotoStep(ref, el.dataset.step); break;
      case "show-term": showInTerm(ref, el.dataset.step); break;
      case "dash-tab": S.dashTab = el.dataset.tab; render(); break;
      case "goto-need": {
        if (el.dataset.id && !(S.page === "session" && S.sel?.id === el.dataset.id)) { openLive(el.dataset.id); setTimeout(() => { const r = current(); if (r) gotoNeed(r, el.dataset.need); }, 80); }
        else gotoNeed(ref, el.dataset.need);
        break;
      }
      // Needs from you: pick an option, write your own, or talk it through on the side.
      case "need-opt": {
        const n = needsOf(ref).find((x) => x.id === el.dataset.need); if (!n) break;
        const key = ak(ref, n), o = (n.options || []).find((x) => x.label === el.dataset.v);
        if (o && isOption(answerOf(ref, n), o)) S.ans.delete(key); else S.ans.set(key, el.dataset.v);
        S.elseOpen.delete(key); S.drafts.delete("else:" + key); render(); break;
      }
      case "need-else": { const key = ak(ref, el.dataset.need); S.elseOpen.add(key); S.ans.delete(key); render(); setTimeout(() => $(`#else-${hid(key)}`)?.focus(), 20); break; }
      case "need-discuss": {
        const rep = needsOf(ref).filter(replyable), i = rep.findIndex((x) => x.id === el.dataset.need), n = rep[i]; if (!n) break;
        openSide({ need: n.id, akey: ak(ref, n), question: n.q, ctx: n.ctx, options: n.options || [], of: `Question ${i + 1} of ${rep.length}` }); break;
      }
      case "send-reply": await sendReply(ref); break;
      case "resume": await guarded("resume", () => resume(ref, false)); break;
      case "fork": armed("fork", () => resume(ref, true)); break;
      // Side chat
      case "side-msg": sideMsg(); break;
      case "side-sugg": { const ta = $("#sp-in"); if (ta) { ta.value = el.dataset.t; sideMsg(); } break; }
      case "side-answer": await sideAnswer(); break;
      case "aside": openAside(false); break;
      case "aside-new": openAside(true); break;
      case "aside-back": { const sd = curSide(); if (sd) { sd.draft = null; render(); } break; }
      case "aside-send": await asideSend(ref); break;
      // New goal
      case "pick-folder": openPicker(el, S.ng.cwd || ""); break;
      case "pk-up": browse(S.picker.parent); break;
      case "pk-into": browse(S.picker.path.replace(/[\\/]+$/, "") + "\\" + el.dataset.d); break;
      // "Use this folder" means the path in the box, typed or not yet browsed to.
      case "pk-use": await chooseFolder(($("#pk-path")?.value || "").trim() || S.picker.path, el.dataset.sure === "1"); break;
      case "pk-pick": await chooseFolder(el.dataset.p, false); break;
      case "ng-harness": { const av = ["claude", "codex", "grok"].filter((h) => S.harnesses[h]); S.ng.harness = av[(av.indexOf(S.ng.harness) + 1) % av.length]; render(); break; }
      case "start-now": await startNow(); break;
      case "plan": await planIt(); break;
      case "plan-reset": S.ng.err = ""; render(); break;
      case "plan-go": await planGo(); break;
      case "plan-start": await startStep(S.plans[+el.dataset.p], +el.dataset.i, `plan:${el.dataset.p}:${el.dataset.i}`); break;
      case "plan-rerun": {
        const ps = planStepOf(el.dataset.id); if (!ps) break;
        ps.plan.steps[ps.i] = { ...ps.plan.steps[ps.i], harness: "claude" }; savePlans();
        await api(`/api/sessions/${el.dataset.id}/stop`, {}).catch(() => {});
        await startStep(ps.plan, ps.i, `rerun:${el.dataset.id}`); break;
      }
      case "plan-done": { const p = S.plans[+el.dataset.p]; p.done = p.done || []; p.done[+el.dataset.i] = true; savePlans(); render(); break; }
    }
  } catch (err) { toast(err.message, "", "fail"); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.draft) S.drafts.set(el.dataset.draft, el.value);
  if (el.id === "search") { S.search = el.value; render(); return; }
  if (el.id === "ng-goal") { S.ng.goal = el.value; autosize(el); return; }
  if (el.id === "sp-in") { autosize(el); return; }
  if (el.classList.contains("replytext")) {
    // Once you type in your reply it's yours; clear it and it fills from your answers again.
    if (el.value.trim() && el.value !== composeText(current())) S.replyEdited.add(el.dataset.rk); else if (!el.value.trim()) S.replyEdited.delete(el.dataset.rk);
    const b = $("#sendbtn"); if (b) b.disabled = !el.value.trim() || b.dataset.blocked === "1"; autosize(el); return;
  }
  if (el.dataset.else) { const key = ak(current(), el.dataset.else); if (el.value.trim()) S.ans.set(key, el.value); else S.ans.delete(key); autosize(el); schedule(); return; }
  if (el.id === "sp-composed") { const sd = curSide(); if (sd) sd.composed = el.value; const h = el.parentElement.querySelector(".num"); if (h) h.textContent = `~${kt(Math.round(el.value.length / 4))} tokens`; return; }
  const ai = el.dataset.actInput;
  if (ai === "plan-need") S.ng.answers[el.dataset.q] = el.value;
});
document.addEventListener("change", (e) => {
  const el = e.target, a = el.dataset.actChange;
  if (a === "plan-harness") { S.ng.plan.steps[+el.dataset.i].harness = el.value; render(); }
});
document.addEventListener("keydown", (e) => {
  const el = e.target;
  if (el.closest && el.closest(".xterm")) return; // the terminal owns its keys
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search")?.focus(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newSession().catch((x) => toast(x.message, "", "fail")); return; }
  if (e.key === "Escape") {
    if (S.picker) { closePicker(); return; }
    // Esc closes the side chat only from inside it, and never throws away typing.
    const inPanel = el.closest && el.closest("#railpane .sp-foot, #railpane .sp-body");
    if (inPanel && S.sideOpen && !(el.value || "").trim()) closeSide(false);
    return;
  }
  // Steps and dashboard rows are buttons to the keyboard too.
  if ((e.key === "Enter" || e.key === " ") && el.matches && el.matches(".trow.step, .arow")) { e.preventDefault(); el.click(); return; }
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  if (el.id === "sp-in") { e.preventDefault(); sideMsg(); }
  else if (el.id === "ng-goal") { e.preventDefault(); if (S.page === "plan") planIt(); else startNow(); }
  else if (el.id === "pk-path") { e.preventDefault(); browse(el.value.trim()).catch((x) => toast(x.message, "", "fail")); }
});
// Away and back: leaving the window records what you've seen; coming back after a while shows what
// happened since, on the Orchestrator ("Welcome back") and in the session you return to.
function awayFromWindow(on) {
  if (on) { if (S.blurAt) return; S.blurAt = Date.now(); markSeen(); try { localStorage.setItem("genui.lastSeenApp", String(Date.now())); } catch {} return; }
  const gone = S.blurAt ? Date.now() - S.blurAt : 0;
  if (gone > 10 * 60000) S.appAway = { from: S.blurAt, ms: gone };
  if (gone > 2 * 60000 && S.look) startLook();
  S.blurAt = 0; schedule();
}
window.addEventListener("blur", () => awayFromWindow(true));
window.addEventListener("focus", () => awayFromWindow(false));
window.addEventListener("resize", () => drawLines());
document.addEventListener("visibilitychange", () => awayFromWindow(document.visibilityState !== "visible"));
{ const last = +(localStorage.getItem("genui.lastSeenApp") || 0); if (last && Date.now() - last > 10 * 60000) S.appAway = { from: last, ms: Date.now() - last }; }

// ---- Actions ---------------------------------------------------------------------
function go(page) {
  // A new session starts in your most recent project unless you pick another.
  if ((page === "new" || page === "plan") && !S.ng.cwd) S.ng.cwd = recentFolders()[0] || "";
  if (S.page === "session" && page !== "session") leaveSession();
  S.page = page; if (page !== "session") S.sel = null; S.sideOpen = false; render();
  const sc = $(".scroll"); if (sc) sc.scrollTop = 0;
  if (page === "new" || page === "plan") setTimeout(() => $("#ng-goal")?.focus(), 20);
}
function askNotify() { if (!S.notifAsked && "Notification" in window && Notification.permission === "default") { S.notifAsked = true; setTimeout(() => Notification.requestPermission().catch(() => {}), 1500); } }
function openLive(id) {
  if (S.page === "session" && S.sel?.id === id) return;
  if (S.page === "session") leaveSession();
  S.armed = null; S.page = "session"; S.sel = { kind: "live", id }; S.sideOpen = false; S.forceBottom = true; startLook(); render(); ensureGen();
}
async function openSaved(file, harness) {
  if (S.page === "session") leaveSession();
  S.armed = null; S.page = "session"; S.sel = { kind: "saved", file, harness }; S.tab = "flow"; S.sideOpen = false; startLook(); render();
  try { const v = await api(`/api/view?harness=${encodeURIComponent(harness)}&file=${encodeURIComponent(file)}`); S.views.set(file, v); if (v.gen) S.gens.set(file, v.gen); S.forceBottom = true; render(); ensureGen(); }
  catch (e) { S.views.set(file, { error: e.message, events: [] }); render(); }
}

async function ensureGen(force) {
  const ref = current(); if (!ref || !ref.file) return;
  const g = S.gens.get(ref.file);
  if (!force && g && (g.fresh || ref.kind === "live")) return;
  if (S.genBusy.has(ref.file)) return;
  S.genBusy.add(ref.file); S.genErr.delete(ref.file); render();
  try { const r = await api("/api/gen", { harness: ref.harness, file: ref.file, force: !!force }); mergeGen(ref.file, r); }
  catch (e) { S.genErr.set(ref.file, e.message); }
  S.genBusy.delete(ref.file); render();
}

async function guarded(key, fn) {
  if (S.inflight.has(key)) return;
  S.inflight.add(key); render();
  try { return await fn(); } finally { S.inflight.delete(key); render(); }
}
async function resume(ref, fork) {
  const s = await api("/api/resume", { harness: ref.harness, id: ref.id, cwd: ref.cwd, confirm: true, fork, file: ref.file });
  S.live.set(s.id, s); openLive(s.id);
}

// Side chat actions
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
// New session: the real terminal at once, in your most recent project (or the one given). You type
// your first message straight into it. Left without sending anything, it is discarded.
async function newSession(cwd, harness, replace) {
  cwd = cwd || S.ng.cwd || recentFolders()[0]; harness = harness || S.ng.harness || "claude";
  if (!cwd) { go("new"); return; }
  S.ng.cwd = cwd; S.ng.harness = harness;
  const same = [...S.live.values()].find((l) => l.alive && l.fresh && l.id !== replace && l.cwd === cwd && l.harness === harness);
  if (same) { openLive(same.id); return; }
  await guarded("new-session", async () => {
    const s = await api("/api/sessions", { harness, cwd });
    S.live.set(s.id, s);
    if (replace && S.sel && S.sel.id === replace) { S.sel = null; S.page = "overview"; S.look = null; discard(replace); }
    openLive(s.id); askNotify();
  });
}
async function startNow() {
  const ng = S.ng;
  const g = $("#ng-goal"); if (g) ng.goal = g.value;
  if (!ng.cwd) { openPicker($("#ng-folder"), ""); return; }
  await guarded("start-now", async () => {
    const s = await api("/api/sessions", { harness: ng.harness, cwd: ng.cwd, prompt: ng.goal.trim() || undefined, goalHint: ng.goal.trim() });
    S.live.set(s.id, s); S.ng.goal = ""; S.drafts.delete("ng-goal"); openLive(s.id); askNotify();
  });
}
async function planGo() {
  const ng = S.ng; if (!ng.plan || ng.going) return;
  ng.going = true; render();
  const plan = { ...ng.plan, cwd: ng.cwd, answers: { ...ng.answers }, started: [], done: [], at: Date.now() };
  try {
    const first = plan.steps.findIndex((s) => s.harness !== "you");
    // Your own steps before the first worker were settled by the answers you just gave.
    for (let i = 0; i < first; i++) plan.done[i] = true;
    S.plans.unshift(plan); savePlans();
    await startStep(plan, first, "plan-go");
    S.ng = { goal: "", cwd: ng.cwd, plan: null, busy: false, err: "", answers: {}, startedAt: 0, harness: ng.harness, going: false };
    S.drafts.delete("ng-goal");
  } finally { ng.going = false; }
}
async function startStep(plan, i, key) {
  await guarded(key || `step:${i}`, async () => {
    const s = await api("/api/plan/start", { plan, index: i, cwd: plan.cwd, answers: plan.answers || {} });
    plan.started = plan.started || []; plan.started[i] = s.id; savePlans();
    S.live.set(s.id, s); openLive(s.id); askNotify();
  });
}
async function openPicker(anchor, path) { S.picker = { anchor }; await browse(path); }
// Folders your sessions already ran in, newest first: the quickest way to pick a project.
function recentFolders() {
  const seen = new Set(), out = [];
  const add = (cwd) => { if (!cwd || /\\sandbox(\\|$)|\\Temp\\|\\AppData\\/i.test(cwd)) return; const k = cwd.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(cwd); } };
  [...S.live.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).forEach((l) => add(l.cwd));
  S.saved.forEach((x) => add(x.cwd));
  return out.slice(0, 6);
}
async function browse(path) {
  const r = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  if (path && !r.exists) { toast("That folder doesn't exist", path, "fail"); return; }
  S.picker = { ...S.picker, ...r };
  let pk = $(".picker");
  if (!pk) { pk = document.createElement("div"); pk.className = "picker"; document.body.appendChild(pk); }
  const recent = S.picker.showRecent !== false ? recentFolders() : [];
  pk.innerHTML = `
    ${recent.length ? `<div class="pk-sec">Recent projects</div><div class="pk-recent">${recent.map((d) => `<button class="pk-item" data-act="pk-pick" data-p="${esc(d)}" title="${esc(d)}">${icon("folder")}<span class="pk-name">${esc(shortPath(d))}</span><span class="pk-full">${esc(d)}</span></button>`).join("")}</div>` : ""}
    <div class="pk-head"><button class="ibtn sm" data-act="pk-up" aria-label="Up one folder" title="Up one folder">${icon("back")}</button><input class="pk-path-in" id="pk-path" value="${esc(r.path)}" aria-label="Folder path" spellcheck="false" title="Type or paste a path, then Enter"><button class="btn btn-tint sm" data-act="pk-use" title="Use ${esc(r.path)}">Use this folder</button></div>
    <div class="pk-list">${r.dirs.map((d) => `<div class="pk-row"><button class="pk-item" data-act="pk-pick" data-p="${esc(r.path.replace(/[\\/]+$/, "") + "\\" + d)}" title="Use this folder">${icon("folder")}<span class="pk-name">${esc(d)}</span></button><button class="ibtn sm pk-open" data-act="pk-into" data-d="${esc(d)}" aria-label="Open ${esc(d)}" title="Look inside">${icon("chev")}</button></div>`).join("") || `<div class="sempty">No folders inside. Use this one, or go up.</div>`}</div>`;
  const a = S.picker.anchor && S.picker.anchor.getBoundingClientRect();
  // Keep the picker on screen: above the button if it fits, else below, else clamped and scrollable.
  pk.style.maxHeight = `${innerHeight - 32}px`;
  if (a) {
    const h = Math.min(pk.offsetHeight || 330, innerHeight - 32);
    let top = a.top - 8 - h;
    if (top < 16) top = a.bottom + 8 + h <= innerHeight - 16 ? a.bottom + 8 : Math.max(16, innerHeight - 16 - h);
    pk.style.left = `${Math.max(16, Math.min(a.left, innerWidth - pk.offsetWidth - 16))}px`;
    pk.style.top = `${top}px`;
  }
}
function closePicker() { $(".picker")?.remove(); S.picker = null; }
// Check a folder before using it: it must exist, and a folder that holds many projects (GitHub
// itself) gets a warning first, because a plan or a worker started there guesses which project you meant.
async function chooseFolder(p, sure) {
  const r = await api(`/api/folders?path=${encodeURIComponent(p)}`);
  if (!r.exists) { toast("That folder doesn't exist", p, "fail"); return; }
  if (!sure && !r.project && r.dirs.length >= 8) {
    await browse(r.path);
    const pk = $(".picker"), name = shortPath(r.path);
    pk?.querySelector(".pk-head")?.insertAdjacentHTML("afterend", `<div class="pk-warn" role="alert">${icon("alert")}<span><b>${esc(name)}</b> holds ${r.dirs.length} folders and isn't a project itself. Pick the project inside it.</span><button class="btn btn-text sm" data-act="pk-use" data-sure="1">Use it anyway</button></div>`);
    return;
  }
  const fresh = S.picker && S.picker.fresh && S.live.get(S.picker.fresh);
  closePicker();
  if (fresh) { await newSession(r.path, fresh.harness, fresh.id); return; }
  S.ng.cwd = r.path; render(); $("#ng-goal")?.focus();
}

// ---- Bits ---------------------------------------------------------------------
// Two-step buttons: the first click arms (shown in the button itself), the second acts. Kept in state so renders don't drop it.
function armed(act, fn) {
  const r = current(); act = `${act}:${r ? r.id || r.file : ""}`;
  if (S.armed && S.armed.act === act && Date.now() < S.armed.until) { S.armed = null; render(); Promise.resolve(fn()).catch((e) => toast(e.message, "", "fail")); return; }
  S.armed = { act, until: Date.now() + 3500 }; render();
  setTimeout(() => { if (S.armed && S.armed.act === act && Date.now() >= S.armed.until) { S.armed = null; render(); } }, 3600);
}
function autosize(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, t.id === "sp-composed" ? 360 : 260) + "px"; }
// Inputs marked data-keep are owned by the user; when one appears, refill it from its saved draft.
function autosizeAll() {
  document.querySelectorAll("textarea[data-draft], input[data-draft]").forEach((t) => { if (!t.value && S.drafts.get(t.dataset.draft)) t.value = S.drafts.get(t.dataset.draft); });
  document.querySelectorAll("textarea").forEach((t) => { if (t.value) autosize(t); });
}
function notify(msg, sub, kind, onOpen, ttl) {
  if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification(msg, { body: sub, tag: sub, icon: "/web/icon.svg" });
    n.onclick = () => { window.focus(); onOpen(); n.close(); };
  }
  toast(msg, sub, kind, onOpen, ttl);
}
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
    const lbl = row.querySelector(":scope > .lab"); if (!lbl || lbl.dataset.decoded || lbl.classList.contains("shimmer")) return;
    lbl.dataset.decoded = "1";
    const text = lbl.textContent, n = text.length; if (!n) return;
    const per = Math.max(1, Math.ceil(n / 33)), chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let locked = 0;
    setTimeout(function tick() {
      if (!lbl.isConnected) return;
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
    turn: '<path d="M5 20v-6a5 5 0 0 1 5-5h9"/><path d="m15 5 4 4-4 4"/>', away: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  }[n] || "";
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Tick live timers (Working Ns, Planning Ns) once a second while something is running on screen.
setInterval(() => { const r = current(); if (document.visibilityState === "visible" && ((r && r.kind === "live" && r.state === "run") || (S.page === "new" && S.ng.busy))) schedule(); }, 1000);
connect();
refresh().catch((e) => toast(e.message, "", "fail"));
setInterval(() => { refresh().catch(() => {}); if (document.hasFocus()) { try { localStorage.setItem("genui.lastSeenApp", String(Date.now())); } catch {} } }, 30000);
window.GENUI = { S, render, openLive, openSaved, go, current };
