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
  answers: new Map(),      // cardKey -> answer text (collected, not necessarily sent)
  drafts: new Map(),       // field drafts and per-session composer drafts
  sentCards: new Set(), sentPayloads: new Set(), carried: new Map(),
  picks: new Map(), open: new Set(), reopen: new Set(),
  ask: new Map(),          // askId -> { step, picks: [Set], other: [""], elseOpen: [bool], sending, timer, until }
  workingSince: new Map(),
  sides: new Map(), sideOpen: false,
  plans: loadPlans(),
  ng: { goal: "", cwd: "", plan: null, busy: false, err: "", answers: {}, startedAt: 0, harness: "claude", going: false },
  flowMode: (() => { try { return localStorage.getItem("genui.flow") || "ai"; } catch { return "ai"; } })(),
  picker: null, toolsOpen: new Set(), inflight: new Set(), armed: null, pickTimers: new Map(), sentItems: loadSent(), permShown: new Map(), authLost: false,
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
    if (msg.type === "pty" || msg.type === "replay") { const t = terms.get(msg.id); if (t) { if (msg.type === "replay") t.term.reset(); t.term.write(msg.data); } return; }
    if (msg.type === "session") {
      const prev = S.live.get(msg.session.id), s = msg.session;
      if (s.status === "working" && (!prev || prev.status !== "working")) S.workingSince.set(s.id, Date.now());
      S.live.set(s.id, s);
      if ((msg.what === "ask" || msg.what === "permission") && !isOnScreen(s.id)) notify("Needs your answer", title(s), "needs", () => openLive(s.id));
      if (msg.what === "turn-end" && !isOnScreen(s.id)) notify("Finished its turn", title(s), "ok", () => openLive(s.id), 5000);
      schedule(); return;
    }
    if (msg.type === "transcript") { S.liveTail.set(msg.id, { last: msg.last, context: msg.context, count: msg.count, plan: msg.plan, draft: msg.draft, userTurns: msg.userTurns }); schedule(); return; }
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
  schedule();
}

// New generated cards replace old ones; answers that weren't sent yet carry over by title.
function mergeGen(file, gen) {
  const old = S.gens.get(file);
  if (gen.midTurn && old) { S.gens.set(file, { ...gen, cards: old.cards || [] }); return; }
  S.gens.set(file, gen);
  if (!old) return;
  // Cards are keyed by title, so a card that survives keeps its answer, picks and drafts as is.
  const still = new Set((gen.cards || []).map((c) => c.title));
  const carried = S.carried.get(file) || [];
  (old.cards || []).forEach((c) => {
    if (still.has(c.title)) return;
    const k = cardKeyOf(file, c), a = S.answers.get(k), sent = S.sentCards.has(k);
    S.answers.delete(k); S.sentCards.delete(k); S.picks.delete(k);
    if (a && !sent) carried.push({ title: c.title, answer: a });
  });
  if (carried.length) S.carried.set(file, carried);
}

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
  else if (S.page === "new") morph(view, newGoalHTML());
  else { const ref = current(); if (!ref) { S.page = "overview"; return render(); } morph(view, sessionHTML(ref)); }
  // A session is shown with its rail on the right (the flowchart, or the side chat): beside its
  // terminal when it runs here, beside the conversation when it's a saved one.
  const onSession = S.page === "session";
  $(".main").classList.toggle("agent", onSession && S.sel?.kind === "live");
  $(".main").classList.toggle("withrail", onSession);
  renderTerm();
  autosizeAll();
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
  const g = genFor(l.file), d = (S.liveTail.get(l.id) || {}).draft, first = d && d.nodes.find((n) => n.kind === "goal");
  return (g && g.title) || l.name || (first && first.label) || clip(l.goalHint || "", 60) || "New session";
}
const engShort = (h) => ({ claude: "Claude", codex: "Codex", grok: "Grok" }[h] || h);
const refKey = (ref) => (ref.kind === "live" ? "L:" + ref.id : "F:" + ref.file);
const nowAgo = (t) => ago(t).replace(" ago", "");

const cardKeyOf = (file, c) => `${file}|${c.title}`;
// Cards are questions from the agent's latest reply; once you have written since, they are out of date.
function cardsCurrent(file, g) {
  if (!g || !g.cards || !g.cards.length) return false;
  const live = [...S.live.values()].find((l) => l.file === file), seen = live ? (S.liveTail.get(live.id) || {}).userTurns : (S.views.get(file) || {}).userTurns;
  return !(seen && g.userTurns != null && seen > g.userTurns);
}
function openCards(file, g) { return (cardsCurrent(file, g) ? g.cards : []).map((c, i) => ({ c, i, key: cardKeyOf(file, c) })).filter((x) => x.c.kind !== "info" && !S.sentCards.has(x.key)); }

// One state per live session, used everywhere (sidebar dot, header, card status, chips, footer).
function liveState(l) {
  if (!l.alive) return "off";
  if (l.pendingAsk || l.pendingPermission || l.terminalNeeds || l.status === "needs" || l.turnError) return "needs";
  if (l.status === "working" || l.status === "starting") return "run";
  // Between a turn ending and its new cards arriving, the reply is still being read: not "your turn" yet.
  if (l.file && S.genBusy.has(l.file)) return "reading";
  const g = genFor(l.file);
  if (g && (openCards(l.file, g).length || (S.carried.get(l.file) || []).length)) return "needs";
  if (g && g.status === "done") return "done";
  return "idle";
}
const STATE_LABEL = { needs: "Needs you", run: "Running", reading: "Reading the reply", idle: "Your turn", done: "Done", off: "Ended" };
const STAT_CLS = { needs: "needs", run: "run", reading: "run", idle: "idle", done: "done", off: "idle" };

function current() {
  if (!S.sel) return null;
  if (S.sel.kind === "live") {
    const l = S.live.get(S.sel.id); if (!l) return null;
    const tail = S.liveTail.get(l.id) || {};
    return { kind: "live", l, id: l.id, harness: l.harness, file: l.file, cwd: l.cwd, context: tail.context || l.context, events: tail.last || [], plan: tail.plan || null, draft: tail.draft || null, alive: l.alive, state: liveState(l) };
  }
  const v = S.views.get(S.sel.file) || {};
  const sv = S.saved.find((s) => s.file === S.sel.file) || {};
  return { kind: "saved", harness: S.sel.harness, file: S.sel.file, id: sv.id, cwd: v.cwd || sv.cwd, context: v.context || sv.context, events: v.events || [], plan: v.plan || null, draft: v.draft || null, total: v.total, title: v.title || sv.title, mtime: sv.mtime, pendingAsk: v.pendingAsk, loading: !S.views.has(S.sel.file), viewErr: v.error };
}
const curSide = () => { const r = current(); return S.sideOpen && r ? S.sides.get(refKey(r)) : null; };

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
    return `<button class="srow ${on ? "is-on" : ""}" id="sr-${esc(l.id)}" data-act="open-live" data-id="${esc(l.id)}" title="${esc(l.cwd)}"><span class="sdot ${st}"></span><span class="st">${esc(title(l))}</span><span class="sm"><span class="eng">${esc(engShort(l.harness))}</span>${st === "needs" ? "" : esc(nowAgo(l.lastActivity || l.createdAt))}</span></button>`;
  };
  const titleCount = new Map(); recent.forEach((x) => { const t = (genFor(x.file) || {}).title || x.title; titleCount.set(t, (titleCount.get(t) || 0) + 1); });
  const savedRow = (s) => {
    const on = S.page === "session" && S.sel?.kind === "saved" && S.sel.file === s.file;
    const t = (genFor(s.file) || {}).title || s.title, dup = titleCount.get(t) > 1;
    return `<button class="srow ${on ? "is-on" : ""}" id="ss-${hid(s.file)}" data-act="open-saved" data-file="${esc(s.file)}" data-h="${esc(s.harness)}" title="${esc(shortPath(s.cwd))} · ${esc(S.labels[s.harness])}"><span class="sdot ${s.waiting ? "needs" : "off"}"></span><span class="st">${esc(t)}${dup ? `<span class="t3"> · ${esc(shortPath(s.cwd))}</span>` : ""}</span><span class="sm"><span class="eng">${esc(shortPath(s.cwd))}</span>${esc(nowAgo(s.mtime))}</span></button>`;
  };
  const needsN = by("needs").length;
  return `
    <button class="srow srow-new" data-act="go" data-page="new">${icon("plus")}New session</button>
    <label class="srow srow-search">${icon("search")}<input id="search" data-keep placeholder="Search" aria-label="Search sessions" autocomplete="off"><kbd>Ctrl K</kbd></label>
    <button class="srow ${S.page === "overview" ? "is-on" : ""}" data-act="go" data-page="overview">${icon("flow")}<span class="st">Orchestrator</span>${needsN ? `<span class="sm" style="color:var(--amber-ink)">${needsN}</span>` : ""}</button>
    ${groupsLive.filter(([, items]) => items.length).map(([name, items]) => `<div class="sgroup">${name}</div>${items.map(liveRow).join("")}`).join("")}
    ${groups.length ? groups.map(([name, items]) => `<div class="sgroup">${name}</div>${items.map(savedRow).join("")}`).join("") : `<div class="sgroup">Recent</div><div class="sempty">${q ? "Nothing matches." : "No sessions yet"}</div>`}`;
}

// ---- Agent view: the real terminal, with the plan beside it -----------------------------------
// A running session looks like the harness itself; the rail adds where the plan stands, what the
// agent is doing, and what it needs. Questions and approvals stay in the harness's own menus.
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
      ${l.alive ? `<button class="ibtn ${S.armed?.act?.startsWith("stop-session:") ? "armed" : ""}" data-act="stop-session" title="${S.armed?.act?.startsWith("stop-session:") ? "Click again to stop this session" : "Stop this session"}" aria-label="Stop session">${icon("power")}</button>` : ""}
    </div>
  </header>
  <aside class="railpane" id="railpane" aria-label="${sd ? "Side chat" : "Plan"}">${sd ? sideChatHTML(sd) : railHTML(ref, g, ps)}</aside>`;
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
function needLine(ref, g) {
  const l = ref.l;
  if (l.pendingAsk) { const qs = l.pendingAsk.questions || []; return qs.length > 1 ? `${qs.length} questions for you` : `Asking: ${(qs[0] || {}).question || "a question"}`; }
  if (l.pendingPermission) return `Wants to ${permTitle(l.pendingPermission.tool, l.pendingPermission.input || {}).replace(/^\w/, (c) => c.toLowerCase())}`;
  if (l.native) return "Waiting in its terminal";
  if (l.terminalNeeds) return l.terminalNeeds.kind === "trust" ? "Trust this folder?" : l.terminalNeeds.kind === "hooks" ? "Trust this project's hooks?" : "Waiting in its terminal";
  if (l.turnError) return "Couldn't run this turn";
  const n = openCards(ref.file, g).length + (S.carried.get(ref.file) || []).length;
  return n ? `${plural(n, "question")} in its reply` : "";
}

function railHTML(ref, g, ps) {
  const l = ref.l, st = ref.state;
  const tone = st === "needs" ? "needs" : st === "run" || st === "reading" ? "run" : st === "done" ? "done" : "idle";
  const own = (ref.plan && ref.plan.length ? ref.plan.map((p) => ({ label: p.label, state: p.state })) : (g && g.steps) || []);
  const need = st === "needs" ? needLine(ref, g) : "";
  const open = S.open.has("attn:" + ref.id) || S.open.has("attn-all");
  // The line under the current step: what it's doing, or what it needs (click to answer).
  const nowLine = need
    ? `<button class="pl-now needs" data-act="attn" aria-expanded="${open}">${icon("alert", "s14")}<span>${esc(clip(need, 90))}</span>${icon(open ? "chevd" : "chev", "s12")}</button>`
    : `<div class="pl-now ${tone}">${tone === "run" ? `<span class="spin"></span><span class="shimmer">${esc(activity(ref) || (st === "reading" ? "Reading the reply" : "Working"))}</span>` : esc(!l.alive ? "Session ended" : tone === "done" ? "Done. Your turn" : "Your turn. Type in the terminal")}</div>`;
  const attn = need && open ? `<div class="attn" id="attn-${esc(ref.id)}" data-anim>${attnHTML(ref, g)}</div>` : "";
  const sub = (steps) => steps.length ? `<ol class="pl-sub">${steps.map((s, i) => `<li class="pl-s ${s.state}${s.state === "current" ? " " + tone : ""}" id="pls-${hid(i + s.label)}"><span class="pl-sd"></span><span>${esc(s.label)}</span></li>`).join("")}</ol>` : "";
  // The flowchart read from the conversation, when there is one; the agent's own task list sits under its current step.
  const tree = pickTree(ref, g);
  const live = nowLine + attn + (ref.plan && ref.plan.length ? sub(own) : "");
  if (tree && !ps) {
    const aiWait = S.flowMode === "ai" && !(g && g.tree && g.tree.nodes.length);
    const head = `<div class="pl-eyebrow">${icon("flow", "s14")}Flowchart${flowToggle(ref, g)}</div>${aiWait ? `<p class="pl-note">The AI view arrives when this turn ends; until then this is the instant one.</p>` : ""}<h3 class="pl-title">${esc((g && g.title) || title(l))}</h3>${g && g.goal ? `<p class="pl-goal">${esc(g.goal)}</p>` : ""}`;
    return railShell(ref, `${head}<div class="tree">${treeHTML(tree, hid(ref.file || ref.id), tone, `<div class="t-live">${live}</div>`)}</div>`);
  }
  const row = (label, state, who, extra, k) => `<li class="pl-row ${state}${state === "current" ? " " + tone : ""}" id="plr-${hid(k + label)}"><span class="pl-dot"></span><div class="pl-body"><div class="pl-label"><span>${esc(label)}</span>${who ? `<span class="pl-who">${esc(who)}</span>` : ""}</div>${extra || ""}</div></li>`;
  let head, rows;
  if (ps) {
    const p = ps.plan, started = p.started || [], done = p.done || [];
    head = `<div class="pl-eyebrow">${icon("flow", "s14")}Plan<span class="pl-count">step ${ps.i + 1} of ${p.steps.length}</span></div><h3 class="pl-title">${esc(p.title)}</h3>`;
    rows = p.steps.map((s, i) => {
      const state = i === ps.i ? "current" : done[i] ? "done" : started[i] ? (S.live.get(started[i])?.alive ? "other" : "done") : "next";
      const who = s.harness === "you" ? "You" : engShort(s.harness);
      return row(s.label, state, who, i === ps.i ? (tree ? `<div class="tree in-plan">${treeHTML(tree, hid(ref.file || ref.id), tone, `<div class="t-live">${live}</div>`)}</div>` : nowLine + attn + sub(own)) : "", i);
    }).join("");
  } else {
    const cur = own.findIndex((s) => s.state === "current");
    head = `<div class="pl-eyebrow">${icon("flow", "s14")}Flow${own.length ? `<span class="pl-count">${cur >= 0 ? `step ${cur + 1} of ${own.length}` : `${own.filter((s) => s.state === "done").length} of ${own.length} done`}</span>` : ""}</div><h3 class="pl-title">${esc((g && g.title) || title(l))}</h3>${g && g.goal ? `<p class="pl-goal">${esc(g.goal)}</p>` : ""}`;
    // The current step carries the live line; with no current step it sits after the last one.
    rows = own.map((s, i) => row(s.label, s.state, "", s.state === "current" ? nowLine + attn : "", i)).join("");
    if (cur < 0) rows += row(own.length ? "Now" : clip(l.goalHint || "Starting", 60), "current", "", nowLine + attn, "now");
  }
  return railShell(ref, `${head}<ol class="pl">${rows}</ol>`);
}
// A side agent you can ask anything, any time: it reads the session but never touches it.
const sideButton = () => `<button class="btn btn-neutral sm side-btn" data-act="side-toggle" title="Talk something through with a separate agent. It knows this session; nothing reaches the session unless you send it.">${icon("chat", "s14")}Side chat</button>`;
// The rail's frame: scrolling content, then the side chat button and the context meter (and Resume once it has ended).
function railShell(ref, inner) {
  const l = ref.l, ctx = ref.context;
  return `<div class="pl-scroll">${inner}</div>
    <div class="pl-foot">${sideButton()}<span class="sp"></span>${ctx ? `<span class="chip" id="chip-ctx" title="${kt(ctx.used)} of ${kt(ctx.window)} tokens in this session's context"><span class="v">Context</span><span class="ctxbar"><i style="width:${ctx.pct}%;background:${ctx.pct >= 95 ? "var(--red-dot)" : ctx.pct >= 80 ? "var(--amber-dot)" : "var(--text-3)"}"></i></span><span class="num">${ctx.pct}%</span></span>` : ""}
      ${!l.alive && ref.harness === "claude" ? `<button class="btn btn-tint sm" data-act="resume" id="resume-btn">${S.armed?.act?.startsWith("resume:") ? "Click again to resume" : "Resume it"}</button>` : ""}</div>`;
}

// Which flowchart to draw: the AI one (grouped and labelled by a model) or the instant one (built by
// code from the transcript, always up to date). In AI mode the instant one shows until the AI one arrives.
function pickTree(ref, g) {
  const ai = g && g.tree && g.tree.nodes.length ? g.tree : null, instant = ref.draft && ref.draft.nodes.length ? ref.draft : null;
  return S.flowMode === "instant" ? instant || ai : ai || instant;
}
function flowToggle(ref, g) {
  const waiting = S.flowMode === "ai" && !(g && g.tree && g.tree.nodes.length);
  return `<span class="seg flowseg" role="group" aria-label="Flowchart source"><button aria-pressed="${S.flowMode === "ai"}" data-act="flow-mode" data-mode="ai" title="A model groups the conversation into goals and steps. Updates when a turn ends.">AI${waiting ? ` <span class="spin"></span>` : ""}</button><button aria-pressed="${S.flowMode === "instant"}" data-act="flow-mode" data-mode="instant" title="Built by code from the conversation as it happens. Instant, no model.">Instant</button></span>`;
}

// The conversation's flowchart as a branching tree. Settled branches fold to one line (click to
// open them); the current step carries the live line and, when needed, what the agent needs.
function treeHTML(tree, key, tone, atCurrent) {
  const kids = (id) => tree.nodes.filter((n) => n.parent === id);
  const final = (n) => n.state === "done" || n.state === "dropped";
  const settled = (n) => final(n) && kids(n.id).every(settled);
  const count = (n) => kids(n.id).reduce((k, c) => k + 1 + count(c), 0);
  const leaf = tree.nodes.find((n) => n.state === "current" && !kids(n.id).some((c) => c.state === "current"));
  const branch = (n) => n.kind === "goal" && n.parent ? `<span class="tbranch" title="A new request, branching off">${icon("branch")}</span>` : "";
  const mark = (n) => n.state === "done" ? `<span class="tm done">${icon("check")}</span>` : n.state === "dropped" ? `<span class="tm dropped">${icon("x")}</span>`
    : n.state === "current" ? `<span class="tm current ${n === leaf ? tone : ""}"></span>` : `<span class="tm next"></span>`;
  const node = (n) => {
    const ch = kids(n.id), k = `tree:${key}:${n.id}`;
    // The trunk stays open so the shape shows; finished branches fold. A click flips either.
    const folded = ch.length && settled(n) && (n.parent ? !S.open.has(k) : S.open.has(k));
    const label = `${branch(n)}<span class="tl">${esc(n.label)}</span>${n.note ? `<span class="tnote">${esc(n.note)}</span>` : ""}`;
    const head = ch.length && settled(n)
      ? `<button class="th" data-act="tree-fold" data-k="${esc(k)}" aria-expanded="${!folded}">${mark(n)}${label}<span class="tcount">${plural(count(n), "step")}</span>${icon(folded ? "chev" : "chevd", "s12")}</button>`
      : `<div class="th">${mark(n)}${label}</div>`;
    // A long run of steps shows its latest ones; the earlier ones fold into one line you can open.
    const more = `more:${key}:${n.id}`, cap = 12, hidden = ch.length > cap && !S.open.has(more) ? ch.length - (cap - 1) : 0;
    const fold = hidden ? `<li class="tn step done" id="tn-${esc(key)}-${esc(n.id)}-more"><button class="th" data-act="tree-fold" data-k="${esc(more)}">${mark({ state: "done" })}<span class="tl">${hidden} earlier steps</span>${icon("chev", "s12")}</button></li>` : "";
    return `<li class="tn ${n.kind} ${n.state}${n === leaf ? " leaf " + tone : ""}" id="tn-${esc(key)}-${esc(n.id)}" data-decode>${head}${n === leaf ? atCurrent : ""}${ch.length && !folded ? `<ul class="tr">${fold}${ch.slice(hidden).map(node).join("")}</ul>` : ""}</li>`;
  };
  return `<ul class="tr root">${kids(null).map(node).join("")}</ul>${leaf ? "" : atCurrent}`;
}

// What the agent needs, opened from its step: its question (answered in the terminal, or worked
// out in a side chat), an approval, a terminal prompt, an error, or questions read from its reply.
function attnHTML(ref, g) {
  const l = ref.l;
  if (l.pendingAsk) {
    const qs = l.pendingAsk.questions || [];
    return qs.map((q, qi) => `<div class="at-q">
      ${qs.length > 1 ? `<div class="at-h">${esc(q.header || `Question ${qi + 1}`)}</div>` : ""}<div class="at-qt">${esc(q.question)}</div>
      <div class="at-opts">${(q.options || []).map((o, j) => `<span class="at-o" title="${esc(o.description || "")}"><span class="num">${j + 1}</span>${esc(o.label)}</span>`).join("")}</div>
      <div class="at-act"><button class="btn btn-tint sm" data-act="discuss-ask" data-qi="${qi}">${icon("chat", "s14")}Discuss it</button><span class="t3">or pick it in the terminal</span></div></div>`).join("");
  }
  if (l.pendingPermission) {
    const p = l.pendingPermission, i = p.input || {}, cmd = i.command || i.file_path || i.url || i.pattern || "";
    return `<div class="at-q"><div class="at-qt">${esc(permTitle(p.tool, i))}?</div>${cmd ? `<pre class="code">${esc(clip(String(cmd), 400))}</pre>` : ""}<div class="at-act"><button class="btn btn-tint sm" data-act="term-open">${icon("term", "s14")}Answer in the terminal</button></div></div>`;
  }
  if (l.native) return `<div class="at-q"><div class="at-qt">The terminal is waiting for you.</div><div class="at-act"><button class="btn btn-tint sm" data-act="term-open">${icon("term", "s14")}Go to the terminal</button></div></div>`;
  if (l.terminalNeeds) {
    const n = l.terminalNeeds, k = n.kind;
    return `<div class="at-q"><div class="at-qt">${esc(n.text)}</div>${k === "trust" || (k === "hooks" && n.detail) ? `<pre class="code">${esc(k === "trust" ? l.cwd : n.detail)}</pre>` : ""}
      <div class="at-act">${k === "menu" ? `<button class="btn btn-tint sm" data-act="term-open">Go to the terminal</button>` : `<button class="btn btn-tint sm" data-act="term-yes">${k === "trust" ? "Trust and start" : k === "hooks" ? "Trust and continue" : "Yes"}</button><button class="btn btn-text sm" data-act="term-no">${k === "trust" ? "Exit" : k === "hooks" ? "Skip them" : "No"}</button>`}</div></div>`;
  }
  const err = (ref.events || []).slice().reverse().find((e) => e.role === "error") || (l.turnError ? { text: l.turnError.message, code: l.turnError.code } : null);
  if (err) return errorCard(ref, err);
  return `${genCards(ref, g)}${answerBar(ref, g)}`;
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
    <div class="thread">${feed(ref)}${blockingCards(ref)}${genCards(ref, g)}</div>
    <div class="dock">${composer(ref)}</div>
  </div></div>
  <aside class="railpane" id="railpane" aria-label="${curSide() ? "Side chat" : "Flowchart"}">${curSide() ? sideChatHTML(curSide()) : `<div class="pl-scroll">${goalCard(ref, g)}</div><div class="pl-foot">${sideButton()}</div>`}</aside>`;
}

// Goal card with the vertical flow rail (3.3). The footer follows the live state, not stale text.
function goalCard(ref, g) {
  const busy = ref.file && S.genBusy.has(ref.file);
  const err = (ref.file && S.genErr.get(ref.file)) || ref.viewErr;
  if (!g && ref.draft && ref.draft.nodes.length) {
    return `<section class="card" id="goal"><div class="ghead"><h2>${esc(clip(ref.title || "Session", 90))}</h2></div><div class="pl-eyebrow" style="margin-top:6px">${icon("flow", "s14")}Flowchart${flowToggle(ref, g)}</div>
      <div class="tree">${treeHTML(ref.draft, hid(ref.file), "idle", "")}</div>${busy ? `<div class="gfoot"><span class="now"><span class="spin"></span><span class="shimmer t2">AI is reading the conversation</span></span></div>` : ""}</section>`;
  }
  if (!g) {
    if (err) return `<section class="card" id="goal"><div class="ghead"><h2>Couldn't read this session</h2></div><div class="gfoot"><span class="now inline-err">${icon("alert")}<span>${esc(clip(err, 140))}</span></span><button class="btn btn-tint" data-act="regen">Try again</button></div></section>`;
    const label = ref.kind === "live" && !ref.file ? "Waiting for the first turn" : `Reading ${ref.total ? plural(ref.total, "event") : "the session"}`;
    return `<section class="card skel-rail" id="goal"><div class="ghead"><h2 class="t3">${esc(ref.kind === "live" ? clip(ref.l.goalHint || "New session", 90) : clip(ref.title || "Session", 90))}</h2></div>
      <ol class="rail">${[62, 48, 70, 40].map((w) => `<li class="rrow next"><span class="rn"></span><span class="rl"><span style="display:block;width:${w}%;height:14px;border-bottom:1px solid var(--divider)"></span></span><span class="rm"></span></li>`).join("")}</ol>
      <div class="gfoot"><span class="now"><span class="spin"></span><span class="shimmer t2">${esc(label)}</span></span></div></section>`;
  }
  const stale = ref.kind === "live" ? (busy || (ref.l.lastActivity || 0) > (g.at || 0) + 1000) && ref.state !== "needs" && ref.state !== "run" : busy;
  const status = ref.kind === "live" ? (ref.state === "reading" ? "run" : ref.state) : g.status === "done" ? "done" : g.status === "waiting" ? "needs" : "idle";
  const statLabel = ref.kind === "live" ? STATE_LABEL[ref.state] : g.status === "done" ? "Done" : g.status === "waiting" ? "Was waiting" : "Saved";
  // The agent's own task list wins when it keeps one: exact, and updated the moment it changes.
  const steps = ref.plan && ref.plan.length ? ref.plan.map((p) => ({ label: p.label, state: p.state, note: "" })) : g.steps || [];
  let rows = steps.map((s, i) => ({ s, i }));
  let hiddenCount = 0;
  if (rows.length > 12 && !S.open.has("rail:" + ref.file)) { const firstCur = Math.max(0, steps.findIndex((s) => s.state !== "done")); hiddenCount = Math.max(0, Math.min(firstCur, rows.length - 10)); rows = rows.slice(hiddenCount); }
  const cur = status === "needs" ? "needs" : status === "run" ? "run" : status === "done" ? "done" : "idle";
  const rowHTML = ({ s, i }) => {
    const state = s.state === "current" ? `current ${stale ? "idle" : cur}` : s.state;
    const mono = /^[\w.\/#@:+-]+$/.test(s.note || "") && /[#/.]/.test(s.note || "");
    return `<li class="rrow ${state}" id="rr-${hid(ref.file + i + s.label)}" data-decode>${s.state === "current" ? `<span class="band"></span>` : ""}<span class="rn"></span><span class="rl ${s.state === "current" && cur === "run" ? "shimmer" : ""}">${esc(s.label)}</span><span class="rm ${mono ? "mono" : ""}">${esc(s.note || "")}</span></li>`;
  };
  // The footer sentence comes from the live state whenever that is newer than the generation.
  let nowText = g.now || "";
  if (ref.kind === "live") {
    const l = ref.l, n = openCards(ref.file, g).length;
    if (ref.state === "reading") nowText = "Reading the reply";
    else if (status === "run") { const c = steps.find((s) => s.state === "current"); nowText = l.lastActivity > g.at || !c ? "Working" : `Working on: ${c.label}`; }
    else if (status === "needs") nowText = l.pendingAsk ? "Waiting for your answer to its question" : l.pendingPermission ? "Waiting for your approval" : l.terminalNeeds ? l.terminalNeeds.text : n ? `Waiting for ${plural(n, "answer")} from you` : nowText;
    else if (status === "off") nowText = "Session ended";
    else if (ref.state === "reading" || stale) nowText = "Reading the reply";
    else if (status === "idle") nowText = g.status === "done" ? "Done. Your turn" : "Your turn";
  } else if (stale) nowText = "Out of date · reading it again";
  const nowIcon = cur === "run" ? `<span class="spin"></span>` : cur === "needs" ? `<span style="color:var(--amber-dot);display:flex">${icon("alert")}</span>` : cur === "done" ? `<span style="color:var(--violet-dot);display:flex">${icon("check")}</span>` : icon("pause");
  return `<section class="card" id="goal">
    <div class="ghead"><h2 title="${esc(g.goal)}">${esc(g.title)}</h2>
      <span class="stat ${STAT_CLS[status] || "idle"}"><i></i>${esc(statLabel)}</span>
      <button class="ibtn sm" data-act="regen" title="${busy || S.genMid.has(ref.file) ? "Reading the session again" : `${ref.plan ? "Steps from the agent's own task list. Goal" : "Goal and flow"} written by GenUI Agent from the transcript, ${esc(ago(g.at))}. Click to read it again.`}" aria-label="Regenerate">${busy || S.genMid.has(ref.file) ? `<span class="spin"></span>` : icon("refresh", "s14")}</button></div>
    <p class="goal-sub" title="${esc(g.goal)}">${esc(g.goal)}</p>
    ${pickTree(ref, g) ? `<div class="tree">${treeHTML(pickTree(ref, g), hid(ref.file), cur, "")}</div>` : `<ol class="rail">
      ${hiddenCount ? `<li class="rrow done"><span class="rn"></span><button class="rl collapsed-rows" data-act="rail-expand">${plural(hiddenCount, "earlier step")} ${icon("chevd", "s12")}</button><span class="rm"></span></li>` : ""}
      ${rows.map(rowHTML).join("")}
    </ol>`}
    <div class="gfoot"><span class="now">${stale || ref.state === "reading" ? `<span class="spin"></span>` : nowIcon}<span class="${cur === "run" || stale ? "shimmer" : ""}">${esc(nowText)}</span></span></div>
  </section>`;
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

// ---- Cards (3.6) ---------------------------------------------------------------------
function blockingCards(ref) {
  if (ref.kind !== "live") {
    if (!ref.pendingAsk) return "";
    const q = (ref.pendingAsk.questions || [])[0] || {};
    return `<section class="card qcard" id="saved-ask"><div class="eyebrow">${icon("chat")}Question<span class="stat needs"><i></i>Was waiting</span></div><h3>${esc(q.question || "Open question")}</h3><p class="ctxl">This saved session ended while the agent was asking this. Resume it in a terminal to answer.</p></section>`;
  }
  return "";
}
const permTitle = (tool, i) => ({ Bash: "Run this command", PowerShell: "Run this command", Edit: `Edit ${shortPath(i.file_path)}`, MultiEdit: `Edit ${shortPath(i.file_path)}`, Write: `Write ${shortPath(i.file_path)}`, WebFetch: "Fetch this page", Read: `Read ${shortPath(i.file_path)}` }[tool] || `Use ${tool}`);

const KIND = { choice: ["choice", "Choice"], approve: ["shield", "Approval"], input: ["edit", "Answer"], teammate: ["user", "Teammate"], checklist: ["list", "Checklist"], info: ["info", "Note"] };
function genCards(ref, g) {
  if (!cardsCurrent(ref.file, g)) return "";
  const live = ref.kind === "live" && ref.alive;
  return g.cards.map((c, i) => (S.sentCards.has(cardKeyOf(ref.file, c)) ? "" : genCard(ref, c, i, live))).join("");
}
function genCard(ref, c, i, live) {
  const key = cardKeyOf(ref.file, c), id = "gc-" + hid(key);
  const ans = S.answers.get(key), sent = S.sentCards.has(key);
  const [ic, noun] = KIND[c.kind] || ["info", "Note"];
  if ((ans || sent) && !S.reopen.has(key)) {
    return `<button class="card qsum-card ${sent ? "is-sent" : ""}" id="${id}" data-act="reopen" data-k="${esc(key)}" ${sent ? "disabled" : ""} title="${sent ? "Sent to the agent" : "Collected, not sent yet. Click to change it."}"><span class="qsum">${icon(ic)}<span class="qq">${esc(c.title)}</span><span class="qa">${esc(ans || "Sent")}</span>${sent ? icon("check", "ok") : `<span class="unsent">not sent yet</span>`}</span></button>`;
  }
  const ro = !live;
  const sd0 = S.sides.get(refKey(ref)), inSide0 = !!(sd0 && sd0.extra && sd0.extra.cardKey === key);
  const stat = c.kind === "info" ? "" : inSide0 ? `<span class="stat run"><i></i>In side chat</span>` : c.kind === "teammate" ? `<span class="stat team"><i></i>${esc(c.owner || "Teammate")}</span>` : ro ? `<span class="stat idle"><i></i>Was asked</span>` : `<span class="stat needs"><i></i>Needs you</span>`;
  let body = "", foot = "";
  if (c.kind === "choice") {
    const picked = S.picks.get(key) || new Set();
    body = `<div class="opts">${(c.options || []).map((o, j) => `<button class="opt ${picked.has(j) ? "is-on" : ""}" data-act="pick" data-k="${esc(key)}" data-i="${i}" data-j="${j}" role="${c.multi ? "checkbox" : "radio"}" aria-checked="${picked.has(j)}" ${ro ? "disabled" : ""}>
        ${c.multi ? `<span class="box">${picked.has(j) ? icon("check") : ""}</span>` : ""}<span class="op"><span class="ot">${esc(o.label)}</span>${o.detail ? `<span class="od">${esc(o.detail)}</span>` : ""}</span>${o.recommended ? `<span class="oq">Recommended</span>` : ""}${c.multi ? "" : icon("check", "ock")}</button>`).join("")}
      ${ro ? "" : S.open.has("else:" + key) ? field(key, "Your answer", "else") : `<button class="opt else" data-act="else-open" data-k="${esc(key)}"><span class="op"><span class="ot">Something else</span></span></button>`}</div>`;
    if (c.multi && !ro) foot = `<span class="sp"></span><button class="btn btn-tint" data-act="multi-done" data-k="${esc(key)}" data-i="${i}" ${picked.size ? "" : "disabled"}>Continue${picked.size ? ` with ${picked.size}` : ""}</button>`;
  } else if (c.kind === "approve") {
    body = `${c.draft ? `<div class="draft">${md(c.draft)}</div>` : ""}${S.open.has("chg:" + key) ? `<div style="margin-top:8px">${field(key, "What should change?", "chg")}</div>` : ""}`;
    if (!ro) foot = `<button class="btn btn-text" data-act="chg-open" data-k="${esc(key)}">Ask for changes</button><span class="sp"></span><button class="btn btn-tint" data-act="approve" data-k="${esc(key)}">Approve</button>`;
  } else if (c.kind === "input") {
    body = ro ? (c.draft ? `<div class="draft">${esc(c.draft)}</div>` : "") : field(key, c.draft ? `e.g. ${c.draft}` : "Your answer", "input");
  } else if (c.kind === "teammate") {
    body = `<div class="to"><span class="initial">${esc((c.owner || "?")[0].toUpperCase())}</span><b style="font-weight:500">${esc(c.owner || "A teammate")}</b><span class="t2">only they can answer this</span></div>
      <div class="draft">${esc(c.title)}${c.why ? `<br><span class="t2">${esc(c.why)}</span>` : ""}</div>
      ${S.open.has("self:" + key) ? `<div style="margin-top:8px">${field(key, "Your answer, if you know it", "self")}</div>` : ""}`;
    if (!ro) foot = `<button class="btn btn-text" data-act="self-open" data-k="${esc(key)}">I know this</button><span class="sp"></span><button class="btn btn-teal" data-act="copy-q" data-i="${i}">${icon("copy")}Copy for ${esc((c.owner || "them").split(" ")[0])}</button>`;
  } else if (c.kind === "checklist") {
    const done = S.picks.get(key) || new Set();
    body = `<ul class="chk">${(c.items || []).map((it, j) => `<li><label><input type="checkbox" data-act-change="check" data-k="${esc(key)}" data-j="${j}" ${done.has(j) ? "checked" : ""} ${ro ? "disabled" : ""}><span>${esc(it)}</span></label></li>`).join("")}</ul>`;
    if (!ro) foot = `<span class="t2 num" style="font-size:var(--fs-meta)">${done.size}/${(c.items || []).length}</span><span class="sp"></span><button class="btn btn-tint" data-act="check-done" data-k="${esc(key)}" data-i="${i}">Done</button>`;
  } else if (c.kind === "info") {
    body = c.draft ? `<div class="prose" style="font-size:var(--fs-body);line-height:var(--lh-body)">${md(c.draft)}</div>` : "";
  }
  const sdc = S.sides.get(refKey(ref)), inSide = !!(sdc && sdc.extra && sdc.extra.cardKey === key);
  const discuss = c.kind === "info" ? "" : inSide ? `<button class="btn btn-text" data-act="side-toggle" style="color:var(--accent-ink)">Back to side chat</button>` : `<button class="btn btn-neutral sm" data-act="discuss" data-k="${esc(key)}" data-i="${i}">${icon("chat", "s14")}Discuss it</button>`;
  return `<section class="card qcard" id="${id}" data-anim>
    <div class="eyebrow">${icon(ic)}${noun}<span class="tag" title="GenUI Agent read this question from the agent's reply. Answers are collected here and sent together.">From the reply</span>${stat}</div>
    <h3>${esc(c.title)}</h3>${c.why && c.kind !== "teammate" ? `<p class="ctxl">${esc(c.why)}</p>` : ""}
    ${body ? `<div class="qbody">${body}</div>` : ""}
    ${(foot || discuss) && live ? `<div class="qfoot">${discuss}${foot || ""}</div>` : ""}
  </section>`;
}
function field(key, ph, mode) {
  const v = S.drafts.get(`${mode}:${key}`) || "";
  return `<div class="field"><textarea rows="1" data-keep id="f-${mode}-${hid(key)}" data-draft="${esc(`${mode}:${key}`)}" placeholder="${esc(ph)}" data-act-input="field" data-mode="${mode}" data-k="${esc(key)}" aria-label="${esc(ph)}"></textarea><button class="enterkey ${v.trim() ? "ready" : ""}" data-act="field-send" data-mode="${mode}" data-k="${esc(key)}" aria-label="Use this answer">${icon("enter")}</button></div>`;
}

// The one action that sends collected answers: a 34 px button right under the cards.
function answerBar(ref, g) {
  if (ref.kind !== "live" || !ref.alive) return "";
  const cards = openCards(ref.file, g), carried = S.carried.get(ref.file) || [];
  const answered = cards.filter((x) => S.answers.get(x.key)).length;
  const ready = answered + carried.length;
  if (!cards.length && !carried.length) return "";
  const left = cards.length - answered;
  return `<div class="answerbar" id="answerbar">
    ${carried.length ? `<span class="t2" style="font-size:var(--fs-meta)">${plural(carried.length, "earlier answer")} not sent yet: ${esc(carried.map((c) => clip(c.title, 40)).join("; "))}</span><button class="btn btn-text" data-act="carried-drop">Drop ${carried.length === 1 ? "it" : "them"}</button>` : ""}
    <span class="sp"></span>${left && ready ? `<span class="t3" style="font-size:var(--fs-meta)">${left} still open · you can send now</span>` : ""}
    ${ready ? `<button class="btn btn-tint" data-act="send-answers" ${S.inflight.has("answers") ? "disabled" : ""}>${S.inflight.has("answers") ? `<span class="spin"></span>Sending` : `Send ${ready === 1 ? "answer" : `${ready} answers`}`}</button>` : ""}
  </div>`;
}

// ---- Chips + composer (3.7, 3.8) ---------------------------------------------------------------------
function chips(ref, g) {
  if (ref.kind !== "live") return "";
  const out = [];
  const st = ref.state;
  const cards = openCards(ref.file, g);
  const answered = cards.filter((x) => S.answers.get(x.key)).length;
  if (ref.alive && cards.length) out.push(`<span class="chip" id="chip-answers"><span class="cd ${answered === cards.length ? "ok" : "needs"}"></span><span class="num">${answered}/${cards.length}</span><span class="${answered === cards.length ? "ok-t" : "needs-t"}">answered</span></span>`);
  else out.push(`<span class="chip" id="chip-state">${st === "run" ? `<span class="spin"></span>` : `<span class="cd ${st === "needs" ? "needs" : st === "done" ? "ok" : "idle"}"></span>`}<span class="${st === "needs" ? "needs-t" : st === "done" ? "ok-t" : ""}">${esc(STATE_LABEL[st])}</span></span>`);
  if (ref.context) {
    const p = ref.context.pct, col = p >= 95 ? "var(--red-dot)" : p >= 80 ? "var(--amber-dot)" : "var(--text-3)";
    out.push(`<span class="chip" id="chip-ctx" title="${kt(ref.context.used)} of ${kt(ref.context.window)} tokens in this session's context"><span class="v">Context</span><span class="ctxbar"><i style="width:${p}%;background:${col}"></i></span><span class="num">${p}%</span></span>`);
  }
  return `<div class="chips">${out.join("")}</div>`;
}

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
  morph($("#tstrip"), `${icon("term")}<b>${esc(S.labels[l.harness])}</b><span class="cwd" title="${esc(l.cwd)}">${esc(l.cwd)}</span><span class="sp"></span>
    ${l.alive ? `<button class="btn btn-text" data-act="term-int">Interrupt</button><button class="btn btn-text" data-act="term-clear" title="Clears this window's view of the terminal; the session is untouched">Clear screen</button>` : `<span class="exit ${l.exitCode ? "bad" : ""}">${l.exitCode ? `Exited with code ${l.exitCode}` : "Exited"}</span>`}`);
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

// ---- Side chat (3.9) ---------------------------------------------------------------------
function sideChatHTML(sd) {
  const d = sd.data;
  const forked = sd.ref.harness === "claude" && sd.ref.mainId;
  const receives = sd.composing ? Math.round((sd.composed || "").length / 4) : 0;
  const mainRef = sd.ref.kind === "live" ? S.live.get(sd.ref.id) : null;
  const live = !!(mainRef && mainRef.alive);
  const forCard = !!(sd.extra.cardKey || sd.extra.ask);
  const busy = sd.busy || (d && d.busy);
  return `
    <div class="sp-head">${live ? `<button class="ibtn" data-act="side-close" aria-label="Back to the plan" title="Back to the plan">${icon("back")}</button>` : ""}<div class="tt"><b>Side chat</b><small>${esc(S.labels[sd.ref.harness] || "The agent")} won't see this unless you send it</small></div>${live ? "" : `<button class="ibtn" data-act="side-close" aria-label="Close side chat">${icon("x")}</button>`}</div>
    ${sd.topic ? `<div class="sp-topic">About <b>${esc(clip(sd.topic, 160))}</b></div>` : ""}
    <div class="sp-body" id="sp-body">
      ${d ? (d.msgs || []).map((m, i) => m.who === "ai" ? `<div class="sp-ai" id="sm-${i}" data-anim>${md(m.text)}${i > 0 && (live || forCard) ? `<div class="use"><button class="btn btn-tint sm" data-act="side-use" data-i="${i}">Use this as the answer</button></div>` : ""}</div>` : `<div class="sp-me" id="sm-${i}">${esc(m.text)}</div>`).join("") : ""}
      ${busy ? `<div class="sp-wait" id="sp-wait"><span class="spin"></span><span class="shimmer t2">${d && (d.msgs || []).length ? (sd.composingBusy ? "Writing the answer" : "Thinking") : forked ? "Forking the session" : "Reading the session"}</span></div>` : ""}
      ${sd.err ? `<div class="sp-err">${esc(sd.err)} <button class="btn btn-text" data-act="side-retry">Try again</button></div>` : ""}
      ${!d && !busy && !sd.err ? `<div class="sp-empty">Questions here stay out of the session.</div>` : ""}
    </div>
    <div class="sp-foot">
      ${sd.composing ? `
        ${sd.extra.ask && mainRef && mainRef.pendingAsk ? `<div class="sp-hint">${icon("alert", "s14")}<span>${esc(S.labels[sd.ref.harness] || "Claude Code")}'s question is still open. Answer it there, or press Esc (or pick “Chat about this”), and this goes in as your next message.</span></div>` : ""}
        <div class="sp-composed"><div class="h"><span>${sd.extra.ask ? "Answer to its question" : forCard ? "Answer for the card" : "Message to send"}</span><span class="num">~${kt(receives)} tokens</span></div><textarea id="sp-composed" data-keep data-draft="composed:${esc(d.id)}" aria-label="Composed answer"></textarea></div>
        <div class="sp-actions"><button class="btn btn-text" data-act="side-back">Keep discussing</button><span class="sp"></span>${forCard ? `<button class="btn btn-tint" data-act="side-use-composed" ${S.inflight.has("side-use") ? "disabled" : ""}>${sd.extra.ask ? `Send to ${esc(S.labels[sd.ref.harness] || "Claude Code")}` : "Use as the answer"}</button>` : live ? `<button class="btn btn-tint" data-act="side-send">Send to ${esc(S.labels[sd.ref.harness])}</button>` : `<button class="btn btn-tint" data-act="side-copy">${icon("copy")}Copy</button>`}</div>`
      : `
        <div class="sp-compose"><textarea id="sp-in" data-keep data-draft="side:${esc(d ? d.id : "new")}" rows="1" placeholder="Ask on the side" aria-label="Message the side agent"></textarea><button class="send sm" data-act="side-msg" aria-label="Send" ${busy || !d ? "disabled" : ""}>${icon("up")}</button></div>
        <div class="sp-actions"><span class="sp"></span><button class="btn btn-tint" data-act="side-compose" ${busy || !d || !(d.msgs || []).length ? "disabled" : ""} title="Write the one message to send back, from this discussion">Compose answer</button></div>`}
    </div>`;
}

async function openSide(topic, extra = {}) {
  const ref = current(); if (!ref) return;
  const key = refKey(ref);
  const old = S.sides.get(key);
  if (old && old.data && (old.busy || old.data.busy)) api(`/api/side/${old.data.id}/cancel`, {}).catch(() => {});
  const mainId = ref.harness === "claude" ? ref.id : null;
  const sd = { ref: { kind: ref.kind, id: ref.id, harness: ref.harness, file: ref.file, cwd: ref.cwd, mainId }, topic, extra, data: null, busy: true, err: "", composing: false, composed: "" };
  S.sides.set(key, sd); S.sideOpen = true; render();
  try {
    sd.data = await api("/api/side", { harness: ref.harness, file: ref.file, mainId, cwd: ref.cwd, topic });
    sd.busy = !!sd.data.busy; sd.err = sd.data.err || "";
    // In case the opener finished before this window saw the update.
    if (sd.busy) setTimeout(async () => { try { const d = await api(`/api/side/${sd.data.id}`); if (d && d.id && !d.busy && sd.busy) { sd.data = d; sd.busy = false; sd.err = d.err || ""; render(); scrollSide(); } } catch {} }, 4000);
  } catch (e) { sd.err = e.message; sd.busy = false; }
  render(); setTimeout(() => $("#sp-in")?.focus(), 30);
}
function closeSide(cancelIt) {
  const ref = current(); const key = ref && refKey(ref); const sd = key && S.sides.get(key);
  if (cancelIt && sd) { if (sd.data && (sd.busy || sd.data.busy)) api(`/api/side/${sd.data.id}/cancel`, {}).catch(() => {}); S.sides.delete(key); }
  S.sideOpen = false; render();
}
function scrollSide() { setTimeout(() => { const b = $("#sp-body"); if (b) b.scrollTop = b.scrollHeight; }, 20); }

// ---- Overview (3.11) ---------------------------------------------------------------------
function overviewHTML() {
  const live = [...S.live.values()];
  const order = { needs: 0, run: 1, reading: 1, idle: 2, done: 3, off: 4 };
  live.sort((a, b) => order[liveState(a)] - order[liveState(b)] || (b.lastActivity || 0) - (a.lastActivity || 0));
  const count = (st) => live.filter((l) => liveState(l) === st).length;
  const win = (steps) => { steps = steps || []; const c = steps.findIndex((x) => x.state === "current"); const start = c < 0 ? Math.max(0, steps.length - 10) : Math.max(0, Math.min(c - 3, steps.length - 10)); return steps.slice(start, start + 10); };
  const hflow = (steps, cur) => `<div class="hflow">${win(steps).map((s) => `<span class="hn ${s.state === "current" ? `current ${cur}` : s.state}" title="${esc(s.label)}"><span class="rn"></span><span class="hl">${esc(s.label)}</span></span>`).join("")}</div>`;
  const row = (l) => {
    const st = liveState(l), g = genFor(l.file);
    const cur = g && (g.steps || []).find((s) => s.state === "current");
    const lref = { l, file: l.file, events: (S.liveTail.get(l.id) || {}).last || [] }, ps = planStepOf(l.id);
    const nowText = st === "needs" ? needLine(lref, g) || "Needs you" : st === "run" ? activity(lref) || (cur ? `Working on: ${cur.label}` : "Working") : st === "reading" ? "Reading the reply" : st === "off" ? "Ended" : st === "idle" ? "Your turn" : (g && g.now) || "";
    return `<button class="ovrow" id="ov-${esc(l.id)}" data-act="open-live" data-id="${esc(l.id)}">
      <span class="ovt"><b>${esc(title(l))}</b><small>${ps ? `${esc(clip(ps.plan.title, 28))} · step ${ps.i + 1}/${ps.plan.steps.length}` : esc(shortPath(l.cwd))} · ${esc(engShort(l.harness))}</small></span>
      ${g ? hflow(g.steps, st === "needs" ? "needs" : st === "run" ? "run" : st === "done" ? "done" : "idle") : `<div class="hflow"><span class="hn current run"><span class="rn"></span><span class="hl">Starting</span></span><span class="hn next"><span class="rn"></span><span class="hl"></span></span><span class="hn next"><span class="rn"></span><span class="hl"></span></span></div>`}
      <span class="ovnow ${st === "needs" ? "needs" : st === "run" || st === "reading" ? "run" : ""}"><span class="${st === "run" || st === "reading" ? "shimmer" : ""}">${esc(nowText)}</span></span>
      <span class="ovm ${st === "needs" ? "needs" : ""}">${esc(STATE_LABEL[st] || "")}</span></button>`;
  };
  const plans = S.plans.slice(0, 6);
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
    return `<div class="ovrow ovplan" id="pl-${pi}" style="cursor:default">
      <span class="ovt"><b>${esc(p.title)}</b><small>${esc(shortPath(p.cwd))} · plan</small></span>${hflow(steps, "run")}
      <span class="ovnow">${ns ? `Next: ${esc(ns.label)}${ns.harness === "you" ? " (yours)" : ""}` : "All steps done or started"}</span>
      <span class="ovm">${action}</span></div>`;
  };
  const needs = count("needs"), run = count("run") + count("reading"), turn = count("idle"), done = count("done");
  const running = live.filter((l) => l.alive), ended = live.filter((l) => !l.alive).slice(0, 6);
  return `<header class="head"><div class="head-t">Orchestrator</div><div class="head-meta">Agents started here: where each one is, and what it needs</div></header>
  <div class="scroll"><div class="page">
    <p class="summary"><b class="${needs ? "needs" : ""}">${needs}</b> need${needs === 1 ? "s" : ""} you · <b>${run}</b> running · <b>${turn}</b> your turn${done ? ` · <b>${done}</b> done` : ""}</p>
    <div class="sec">Active</div>
    ${running.length ? `<section class="card ovcard">${running.map(row).join("")}</section>` : `<section class="card ovcard"><div class="ovempty"><span>No agents running. Start one from a new session.</span><button class="btn btn-tint" data-act="go" data-page="new">New session</button></div></section>`}
    ${plans.length ? `<div class="sec">Plans</div><section class="card ovcard">${plans.map(planRow).join("")}</section>` : ""}
    ${ended.length ? `<div class="sec">Ended</div><section class="card ovcard ovended">${ended.map(row).join("")}</section>` : ""}
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
  return `<header class="head"><div class="head-t">New session</div></header>
  <div class="scroll"><div class="newgoal">
    ${planHTML}
    ${ng.plan || ng.busy ? "" : `<div class="composer" id="ng-composer"><textarea id="ng-goal" data-keep data-draft="ng-goal" rows="2" placeholder="Message ${esc(h)}" aria-label="First message"></textarea>
      <div class="tbar"><button class="pill" data-act="pick-folder" id="ng-folder">${icon("folder")}<span>${ng.cwd ? esc(shortPath(ng.cwd)) : "Choose a folder"}</span></button>
        <button class="pill" data-act="ng-harness" title="Which agent to start">${icon("term")}<span>${esc(h)}</span></button><span class="sp"></span>
        <button class="btn btn-text" data-act="plan" title="Break it into steps, each run by its own agent">Plan it first</button>
        <button class="send" data-act="start-now" aria-label="Start ${esc(h)}" title="Start ${esc(h)} with this message" ${S.inflight.has("start-now") ? "disabled" : ""}>${icon("up")}</button></div></div>
      <div class="hint">Starts ${esc(h)} in that folder with your message, exactly as in your terminal. “Plan it first” breaks a bigger goal into steps for several agents.</div>`}
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
      case "rail-expand": S.open.add("rail:" + ref.file); render(); break;
      case "tools": S.toolsOpen.has(k) ? S.toolsOpen.delete(k) : S.toolsOpen.add(k); render(); break;
      case "side-toggle": if (S.sideOpen) closeSide(false); else if (S.sides.has(refKey(ref))) { S.sideOpen = true; render(); scrollSide(); } else openSide(""); break;
      case "side-close": closeSide(true); break;
      case "stop-session": armed("stop-session", () => api(`/api/sessions/${ref.id}/stop`, {})); break;
      case "interrupt": await api(`/api/sessions/${ref.id}/interrupt`, { key: "esc" }); break;
      case "term-int": await api(`/api/sessions/${ref.id}/interrupt`, { key: "ctrlc" }); break;
      case "term-clear": terms.get(ref.id)?.term.clear(); break;
      case "term-yes": await api(`/api/sessions/${ref.id}/terminal`, { choice: "yes" }); break;
      case "term-no": await api(`/api/sessions/${ref.id}/terminal`, { choice: "no" }); break;
      case "term-open": focusTerm(ref); break;
      // What the agent needs opens under its step in the plan.
      case "attn": { const k = "attn:" + ref.id; if (S.open.has(k)) S.open.delete(k); else S.open.add(k); render(); break; }
      case "flow-mode": S.flowMode = el.dataset.mode; try { localStorage.setItem("genui.flow", S.flowMode); } catch {} render(); break;
      case "tree-fold": { const k = el.dataset.k; if (S.open.has(k)) S.open.delete(k); else S.open.add(k); render(); break; }
      // A question in Claude Code's own menu: talk it through on the side; the answer goes back into the menu.
      case "discuss-ask": { const qi = +el.dataset.qi, x = (ref.l.pendingAsk.questions || [])[qi] || {}; openSide(`${x.question} Options: ${(x.options || []).map((o) => o.label).join("; ")}`, { ask: ref.l.pendingAsk.id, qi, question: x.question }); break; }
      // Generated cards
      case "pick": pickOption(ref, k, +el.dataset.i, +el.dataset.j); break;
      case "multi-done": { const c = genFor(ref.file).cards[+el.dataset.i]; setAnswer(k, [...(S.picks.get(k) || [])].map((j) => c.options[j].label).join(", ")); break; }
      case "else-open": S.open.add("else:" + k); render(); $(`#f-else-${hid(k)}`)?.focus(); break;
      case "chg-open": S.open.add("chg:" + k); render(); $(`#f-chg-${hid(k)}`)?.focus(); break;
      case "self-open": S.open.add("self:" + k); render(); $(`#f-self-${hid(k)}`)?.focus(); break;
      case "approve": setAnswer(k, "Approved."); break;
      case "field-send": fieldSend(el.dataset.mode, k); break;
      case "check-done": { const c = genFor(ref.file).cards[+el.dataset.i]; const done = [...(S.picks.get(k) || [])].map((j) => c.items[j]); setAnswer(k, done.length === c.items.length ? "All done." : done.length ? `Done: ${done.join("; ")}` : "None done yet."); break; }
      case "copy-q": { const c = genFor(ref.file).cards[+el.dataset.i]; await navigator.clipboard.writeText(`${c.title}${c.why ? `\n${c.why}` : ""}`); el.innerHTML = `${icon("check")}Copied`; setTimeout(render, 1500); break; }
      case "reopen": S.reopen.add(k); S.drafts.set(`input:${k}`, S.answers.get(k) || ""); S.answers.delete(k); render(); break;
      case "discuss": { const c = genFor(ref.file).cards[+el.dataset.i]; openSide(`${c.title}${c.why ? ` (${c.why})` : ""}${c.options ? `. Options: ${c.options.map((o) => o.label).join("; ")}` : ""}`, { cardKey: k }); break; }
      case "send-answers": await sendAnswers(ref); break;
      case "carried-drop": S.carried.delete(ref.file); render(); break;
      case "resume": armed("resume", () => resume(ref, false)); break;
      case "fork": armed("fork", () => resume(ref, true)); break;
      // Side chat
      case "side-msg": sideMsg(); break;
      case "side-compose": sideCompose(); break;
      case "side-back": curSide().composing = false; render(); break;
      case "side-retry": { const sd = curSide(); openSide(sd.topic, sd.extra); break; }
      case "side-use": { const sd = curSide(); const m = sd.data.msgs[+el.dataset.i]; sd.composed = m.text; sd.composing = true; S.drafts.set(`composed:${sd.data.id}`, m.text); render(); focusComposed(); break; }
      case "side-use-composed": sideUse(); break;
      case "side-send": await sideSend(); break;
      case "side-copy": await navigator.clipboard.writeText($("#sp-composed").value); el.innerHTML = `${icon("check")}Copied`; break;
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
  if (el.id === "sp-composed") { const sd = curSide(); if (sd) sd.composed = el.value; const h = el.parentElement.querySelector(".num"); if (h) h.textContent = `~${kt(Math.round(el.value.length / 4))} tokens`; return; }
  const ai = el.dataset.actInput;
  if (ai === "field") { autosize(el); el.parentElement.querySelector(".enterkey")?.classList.toggle("ready", !!el.value.trim()); }
  if (ai === "plan-need") S.ng.answers[el.dataset.q] = el.value;
});
document.addEventListener("change", (e) => {
  const el = e.target, a = el.dataset.actChange;
  if (a === "check") { const s = new Set(S.picks.get(el.dataset.k) || []); el.checked ? s.add(+el.dataset.j) : s.delete(+el.dataset.j); S.picks.set(el.dataset.k, s); render(); }
  if (a === "plan-harness") { S.ng.plan.steps[+el.dataset.i].harness = el.value; render(); }
});
document.addEventListener("keydown", (e) => {
  const el = e.target;
  if (el.closest && el.closest(".xterm")) return; // the terminal owns its keys
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search")?.focus(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); go("new"); return; }
  if (e.key === "Escape") {
    if (S.picker) { closePicker(); return; }
    // Esc closes the side chat only from inside it, and never throws away typing.
    const inPanel = el.closest && el.closest("#railpane .sp-foot, #railpane .sp-body");
    if (inPanel && S.sideOpen && !(el.value || "").trim()) closeSide(false);
    return;
  }
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  if (el.id === "sp-in") { e.preventDefault(); sideMsg(); }
  else if (el.id === "ng-goal") { e.preventDefault(); startNow(); }
  else if (el.id === "pk-path") { e.preventDefault(); browse(el.value.trim()).catch((x) => toast(x.message, "", "fail")); }
  else if (el.dataset.actInput === "field") { e.preventDefault(); fieldSend(el.dataset.mode, el.dataset.k); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(); });

// ---- Actions ---------------------------------------------------------------------
function go(page) {
  // A new session starts in your most recent project unless you pick another.
  if (page === "new" && !S.ng.cwd) S.ng.cwd = recentFolders()[0] || "";
  S.page = page; if (page !== "session") S.sel = null; S.sideOpen = false; render();
  const sc = $(".scroll"); if (sc) sc.scrollTop = 0;
  if (page === "new") setTimeout(() => $("#ng-goal")?.focus(), 20);
}
function askNotify() { if (!S.notifAsked && "Notification" in window && Notification.permission === "default") { S.notifAsked = true; setTimeout(() => Notification.requestPermission().catch(() => {}), 1500); } }
function openLive(id) { S.armed = null; S.page = "session"; S.sel = { kind: "live", id }; S.sideOpen = false; S.forceBottom = true; render(); ensureGen(); }
async function openSaved(file, harness) {
  S.armed = null; S.page = "session"; S.sel = { kind: "saved", file, harness }; S.tab = "flow"; S.sideOpen = false; render();
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

function pickOption(ref, key, i, j) {
  const c = genFor(ref.file).cards[i];
  const s = new Set(S.picks.get(key) || []);
  if (c.multi) { s.has(j) ? s.delete(j) : s.add(j); S.picks.set(key, s); render(); return; }
  S.picks.set(key, new Set([j])); render();
  // Single-select collects on click; hold briefly so the selection reads. Nothing is sent yet.
  clearTimeout(S.pickTimers.get(key));
  S.pickTimers.set(key, setTimeout(() => { S.pickTimers.delete(key); if ((S.picks.get(key) || new Set()).has(j)) setAnswer(key, c.options[j].label); }, 600));
}
function setAnswer(key, text) { S.answers.set(key, text); S.reopen.delete(key); for (const m of ["else", "chg", "self", "input"]) { S.open.delete(m + ":" + key); S.drafts.delete(`${m}:${key}`); } render(); }
function fieldSend(mode, key) {
  const v = (S.drafts.get(`${mode}:${key}`) || "").trim(); if (!v) return;
  setAnswer(key, mode === "chg" ? `Changes needed: ${v}` : v);
}
async function guarded(key, fn) {
  if (S.inflight.has(key)) return;
  S.inflight.add(key); render();
  try { return await fn(); } finally { S.inflight.delete(key); render(); }
}
async function sendAnswers(ref) {
  await guarded("answers", async () => {
    const g = genFor(ref.file);
    const items = openCards(ref.file, g).filter((x) => S.answers.get(x.key)).map((x) => ({ key: x.key, title: x.c.title, answer: S.answers.get(x.key) }));
    const carried = S.carried.get(ref.file) || [];
    const all = [...carried, ...items];
    if (!all.length) return;
    const text = all.length === 1 ? `${all[0].title}\n${all[0].answer}` : `Answers to your questions:\n${all.map((x, n) => `${n + 1}. ${x.title}\n   ${x.answer}`).join("\n")}`;
    items.forEach((x) => S.sentCards.add(x.key)); // optimistic, so a double-click can't send twice
    try { await api(`/api/sessions/${ref.id}/send`, { text }); S.sentItems.set(norm(text), all.map((x) => ({ title: x.title, answer: x.answer }))); saveSent(); S.carried.delete(ref.file); }
    catch (e) { items.forEach((x) => S.sentCards.delete(x.key)); throw e; }
  });
}
async function resume(ref, fork) {
  const s = await api("/api/resume", { harness: ref.harness, id: ref.id, cwd: ref.cwd, confirm: true, fork, file: ref.file });
  S.live.set(s.id, s); openLive(s.id);
}

// Side chat actions
async function sideMsg() {
  const sd = curSide(); const ta = $("#sp-in"); if (!ta || !sd || sd.busy || !sd.data || sd.data.busy) return;
  const v = ta.value.trim(); if (!v) return;
  const mine = { who: "me", text: v };
  sd.data.msgs.push(mine); ta.value = ""; S.drafts.delete(ta.dataset.draft); autosize(ta); sd.busy = true; sd.err = ""; render(); scrollSide();
  try { sd.data = await api(`/api/side/${sd.data.id}/msg`, { text: v }); }
  catch (e) { sd.err = e.message; const i = sd.data.msgs.indexOf(mine); if (i >= 0) sd.data.msgs.splice(i, 1); const t = $("#sp-in"); if (t && !t.value) t.value = v; }
  sd.busy = false; render(); scrollSide(); $("#sp-in")?.focus();
}
async function sideCompose() {
  const sd = curSide(); if (!sd || sd.busy) return;
  sd.busy = true; sd.composingBusy = true; render(); scrollSide();
  const ref = current(), g = ref && genFor(ref.file);
  const known = ref ? openCards(ref.file, g).filter((x) => x.key !== sd.extra.cardKey && S.answers.get(x.key)).map((x) => ({ title: x.c.title, answer: S.answers.get(x.key) })) : [];
  try { const r = await api(`/api/side/${sd.data.id}/compose`, { known, answerOnly: !!(sd.extra.ask || sd.extra.cardKey) }); sd.data = r; sd.composed = r.composed; sd.composing = true; S.drafts.set(`composed:${r.id}`, r.composed); } catch (e) { sd.err = e.message; }
  sd.busy = false; sd.composingBusy = false; render(); focusComposed();
}
function focusComposed() { const t = $("#sp-composed"); if (t) { const sd = curSide(); if (sd && !t.value) t.value = sd.composed || ""; autosize(t); t.focus({ preventScroll: true }); t.setSelectionRange(0, 0); t.scrollTop = 0; } }
// From a card: the composed text becomes that card's answer (sent with the others). From an agent's question: it answers that question.
async function sideUse() {
  const sd = curSide(); if (!sd) return;
  const text = ($("#sp-composed")?.value || sd.composed || "").trim(); if (!text) return;
  if (sd.extra.cardKey) { S.answers.set(sd.extra.cardKey, text); S.reopen.delete(sd.extra.cardKey); }
  else if (sd.extra.ask) {
    // The answer goes in as your next message, typed into Claude Code's prompt, once its question menu
    // is closed (you answered there, pressed Esc, or picked "Chat about this"). We never press keys in its menus.
    const l = S.live.get(sd.ref.id);
    if (l && l.pendingAsk && !S.armed?.act?.startsWith("send-anyway:")) { armed("send-anyway", () => {}); toast("Claude Code's question is still open", "Answer it there, or press Esc (or pick \u201cChat about this\u201d), then send. Click again to send anyway.", "needs"); return; }
    const q = sd.extra.question ? `About your question "${sd.extra.question}":\n\n` : "";
    await guarded("side-use", () => api(`/api/sessions/${sd.ref.id}/send`, { text: q + text }));
  }
  api(`/api/side/${sd.data.id}/sent`, { text }).catch(() => {});
  S.sideOpen = false; S.sides.delete(refKey(current())); render();
}
async function sideSend() {
  const sd = curSide(); const text = ($("#sp-composed")?.value || "").trim(); if (!text || !sd) return;
  await guarded("side-send", async () => {
    await api(`/api/sessions/${sd.ref.id}/send`, { text });
    await api(`/api/side/${sd.data.id}/sent`, { text }).catch(() => {});
    S.sides.delete(refKey(current())); S.sideOpen = false;
  });
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
  S.ng.cwd = r.path; closePicker(); render(); $("#ng-goal")?.focus();
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
    const lbl = row.querySelector(":scope > .rl, :scope > .th > .tl"); if (!lbl || lbl.dataset.decoded || lbl.classList.contains("shimmer")) return;
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
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9a6 6 0 0 1-6 6H8"/>',
  }[n] || "";
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Tick live timers (Working Ns, Planning Ns) once a second while something is running on screen.
setInterval(() => { const r = current(); if (document.visibilityState === "visible" && ((r && r.kind === "live" && r.state === "run") || (S.page === "new" && S.ng.busy))) schedule(); }, 1000);
connect();
refresh().catch((e) => toast(e.message, "", "fail"));
setInterval(() => refresh().catch(() => {}), 30000);
window.GENUI = { S, render, openLive, openSaved, go, current };
