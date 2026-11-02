// Shared behaviour for the views: derived state, the inputs drawer, the side
// thread, automatic hand-off and undo. Everything is in memory.

(function () {
  const P = window.PIPELINES;
  const listeners = [];
  const onChange = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => fn());

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const find = (pid, sid) => {
    const p = P.find((x) => x.id === pid);
    return { p, s: p && p.steps.find((x) => x.id === sid) };
  };
  const nextStep = (p, s) => p.steps[p.steps.indexOf(s) + 1];
  const owner = (n) => (n.from === "You" ? "you" : n.from);

  // A step with needs takes its state from them: anything of yours open -> you,
  // else anything a teammate owes -> team. All locked -> ready (hand-off is automatic).
  function stepState(s) {
    if (!s.needs || ["wait", "done", "running", "sched"].includes(s.state)) return s.state;
    const open = s.needs.filter((n) => n.status !== "approved");
    if (!open.length) return "ready";
    if (open.some((n) => n.from === "You")) return "you";
    return "team";
  }
  const counts = (s) => ({ ok: s.needs.filter((n) => n.status === "approved").length, total: s.needs.length });
  const currentStep = (p) => p.steps.find((s) => s.state !== "done") || p.steps[p.steps.length - 1];
  const pipelineState = (p) => stepState(currentStep(p));

  // Who still owes what on a step, e.g. "You 1 · Laurence 2".
  function owed(s) {
    const o = {};
    s.needs.filter((n) => n.status !== "approved").forEach((n) => (o[n.from] = (o[n.from] || 0) + 1));
    return o;
  }
  function owedHTML(s) {
    const o = owed(s);
    return Object.entries(o).map(([w, k]) =>
      `<b style="color:var(${w === "You" ? "--you" : "--team"})">${esc(w)} ${k}</b>`).join(" · ");
  }

  const age = (h) => (h == null ? "" : h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
  const ageHTML = (n) => (n.since == null ? "" : `<span class="age ${n.since >= 24 ? "old" : ""}" title="Waiting since ${age(n.since)} ago">waiting ${age(n.since)}</span>`);
  const oldest = (s) => Math.max(0, ...s.needs.filter((n) => n.status !== "approved").map((n) => n.since || 0));

  // Every open need, with where it lives and what answering it unlocks.
  function openNeeds() {
    const out = [];
    P.forEach((p) => p.steps.forEach((s) => (s.needs || []).forEach((n) => {
      if (n.status === "approved" || s.state === "done") return;
      const c = counts(s);
      const remaining = c.total - c.ok;
      const nx = nextStep(p, s);
      const upcoming = s.state === "wait" || s.state === "sched";
      out.push({
        p, s, n, upcoming,
        group: upcoming ? "later" : n.from === "You" ? "now" : "team",
        unlockNote: upcoming ? `Opens ${n.opensOn || "after the earlier step"}`
          : remaining === 1 ? `Last one: starts ${nx ? nx.label : "the next step"}`
          : `${c.ok} of ${c.total} locked`,
        remaining
      });
    })));
    const order = { now: 0, team: 1, later: 2 };
    return out.sort((a, b) => order[a.group] - order[b.group] || a.remaining - b.remaining || (b.n.since || 0) - (a.n.since || 0));
  }

  function summary() {
    const needs = openNeeds();
    return {
      active: P.filter((p) => currentStep(p).state !== "done").length,
      you: needs.filter((x) => x.group === "now").length,
      team: needs.filter((x) => x.group === "team").length,
      running: P.filter((p) => pipelineState(p) === "running").length
    };
  }

  function renderCoord(el) {
    const s = summary();
    el.innerHTML = `
      <span><b>${s.active}</b> pipelines</span>
      <span><span class="dot s-you" style="display:inline-block"></span> <b>${s.you}</b> need you</span>
      <span><span class="dot s-team" style="display:inline-block"></span> <b>${s.team}</b> on teammates</span>
      <span><span class="dot s-running" style="display:inline-block"></span> <b>${s.running}</b> running</span>
      <span class="wide">Coordinator using <b>9%</b> of its context</span>
      <span class="sample-tag wide">sample data</span>`;
  }

  // Green = locked, orange = owed by you, purple = owed by a teammate; stripes = a draft exists.
  function meter(s) {
    return `<span class="meter" aria-hidden="true">${s.needs.map((n) =>
      `<i class="${n.status === "approved" ? "ok" : n.from === "You" ? "you" : "team"} ${n.draft ? "draft" : ""}"></i>`).join("")}</span>`;
  }

  function chip(state) {
    const label = state === "ready" ? "Starting next step" : window.STATE_LABEL[state];
    return `<span class="chip s-${state}"><span class="dot s-${state}"></span>${label}</span>`;
  }

  function toast(msg, undo) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status");
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
    if (undo) t.querySelector("button").onclick = () => { undo(); t.remove(); };
    document.body.appendChild(t);
    setTimeout(() => t.remove(), undo ? 6000 : 2800);
  }

  // Snapshot a pipeline so any lock or hand-off can be undone.
  const snap = (p) => JSON.stringify(p.steps);
  const restorer = (p, before) => () => { p.steps = JSON.parse(before); renderDrawer(); emit(); toast("Undone."); };

  // Lock one need. If it was the last open one, hand over automatically.
  function lock(p, s, n, answer, verb = "Locked") {
    const before = snap(p);
    n.answer = answer; n.status = "approved"; n.pending = false;
    if (n.thread) n.note = `Decided after ${n.thread.filter((m) => m.who === "agent").length} drafts`;
    if (stepState(s) === "ready") {
      s.state = "done";
      const nx = nextStep(p, s);
      if (nx) { nx.state = "running"; nx.note = "Fresh worker, started just now"; }
      toast(`${verb}. All ${s.needs.length} inputs locked, so a fresh ${nx ? nx.label : "worker"} started with them.`, restorer(p, before));
    } else {
      toast(`${verb}.`, restorer(p, before));
    }
  }
  function lockAllDrafts(p, s) {
    const before = snap(p);
    const ds = s.needs.filter((n) => n.status === "draft");
    ds.forEach((n) => { n.answer = n.draft; n.status = "approved"; });
    if (stepState(s) === "ready") {
      s.state = "done";
      const nx = nextStep(p, s);
      if (nx) { nx.state = "running"; nx.note = "Fresh worker, started just now"; }
    }
    toast(`Locked ${ds.length} drafts.`, restorer(p, before));
  }

  // ---- Drawer ---------------------------------------------------------------
  let drawerFor = null; // {pid, sid}
  let opener = null;
  const openThreads = new Set();
  const selfOpen = new Set();
  const typed = {}; // unsaved text by input id, survives re-renders and closing

  function ensureDrawer() {
    if (document.getElementById("drawer")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="drawer-backdrop" id="drawer-bg" hidden></div>
      <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" hidden></aside>`);
    document.getElementById("drawer-bg").onclick = closeDrawer;
    document.addEventListener("keydown", (e) => {
      if (!drawerFor) return;
      if (e.key === "Escape") closeDrawer();
      if (e.key === "Tab") trapFocus(e);
    });
  }

  function trapFocus(e) {
    const f = [...document.getElementById("drawer").querySelectorAll("button:not([disabled]), textarea:not([hidden]), input, summary, [tabindex='-1']")]
      .filter((el) => el.offsetParent !== null && el.tabIndex !== -1);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openStep(pid, sid, focusNeed, opts = {}) {
    ensureDrawer();
    opener = document.activeElement;
    drawerFor = { pid, sid };
    if (focusNeed) {
      const { s } = find(pid, sid);
      const n = s.needs.find((x) => x.id === focusNeed);
      if (n && n.status === "iterating") openThreads.add(n.id);
      if (opts.thread && n) startThread(n);
      if (opts.self && n) selfOpen.add(n.id);
    }
    renderDrawer();
    document.getElementById("drawer-bg").hidden = false;
    document.getElementById("drawer").hidden = false;
    focusIn(focusNeed);
  }

  function focusIn(nid) {
    const target = nid && document.getElementById("need-" + nid);
    if (target) {
      target.scrollIntoView({ block: "nearest" });
      (target.querySelector("textarea:not([hidden]), input, button.primary, button") || target).focus();
    } else document.getElementById("drawer-close").focus();
  }

  function closeDrawer() {
    drawerFor = null;
    document.getElementById("drawer").hidden = true;
    document.getElementById("drawer-bg").hidden = true;
    if (opener && document.contains(opener)) opener.focus();
  }

  function startThread(n) {
    if (n.status === "iterating") { openThreads.add(n.id); return; }
    n.status = "iterating";
    n.thread = n.thread || (n.draft ? [{ who: "agent", v: "v1", text: n.draft }] : []);
    n.threadTokens = n.threadTokens || 1800;
    openThreads.add(n.id);
    if (!n.draft) {
      n.pending = true;
      setTimeout(() => {
        n.pending = false;
        n.draft = `First take on "${n.title.replace(/\?$/, "")}" from the brief`;
        n.thread.push({ who: "agent", v: "v1", text: "Draft: " + n.draft });
        renderDrawer(); emit();
      }, 900);
    }
  }

  function needHTML(p, s, n) {
    const done = s.state === "done";
    const statusChip = {
      approved: `<span class="chip s-done">Locked</span>`,
      iterating: `<span class="chip s-you">In side thread</span>`,
      draft: `<span class="chip s-you">Draft ready</span>`,
      missing: n.from === "You" ? `<span class="chip s-you">Owed by you</span>`
        : n.askedAt != null ? `<span class="chip s-team">Asked ${esc(n.from)}</span>`
        : `<span class="chip s-team">Owed by ${esc(n.from)}</span>`
    }[n.status];
    const icon = n.status === "approved" ? "✓" : n.from === "You" ? "●" : "◐";
    const iconColor = n.status === "approved" ? "var(--done)" : n.from === "You" ? "var(--you)" : "var(--team)";
    const locked = s.state === "wait" || s.state === "sched";
    const lockLabel = n.kind === "merge" ? "Merge" : "Lock";
    let body = "";

    if (n.status === "approved") {
      body = `<div class="answer">${esc(n.answer)}${n.note ? ` <span class="faint">· ${esc(n.note)}</span>` : ""}</div>
        ${done ? "" : `<div class="actions"><button class="btn small" data-act="reopen" data-n="${n.id}">Reopen</button></div>`}`;
    } else if (locked) {
      body = `<div class="actions muted">Opens ${esc(n.opensOn || "when the earlier step finishes")}.</div>`;
    } else if (n.status === "iterating") {
      const open = openThreads.has(n.id);
      body = `<div class="answer"><span class="faint">Latest draft:</span> ${n.draft ? esc(n.draft) : "<i>The agent is writing a first draft…</i>"}</div>
        <div class="actions">
          <button class="btn small primary" data-act="lock-draft" data-n="${n.id}" ${n.draft && !n.pending ? "" : "disabled"}>${lockLabel} this draft</button>
          <button class="btn small" data-act="toggle-thread" data-n="${n.id}" aria-expanded="${open}">${open ? "Hide" : "Show"} side thread (${n.thread.length})</button>
        </div>
        ${open ? threadHTML(n) : ""}`;
    } else if (n.status === "draft") {
      body = `<div class="answer">${esc(n.draft)}</div>
        <div class="actions">
          <button class="btn small primary" data-act="lock-draft" data-n="${n.id}">${lockLabel}${n.kind === "merge" ? "" : " as written"}</button>
          <button class="btn small" data-act="start-thread" data-n="${n.id}">Change it in a side thread</button>
        </div>`;
    } else if (n.from === "You" || selfOpen.has(n.id)) {
      body = `<textarea id="ta-${n.id}" aria-label="Answer for ${esc(n.title)}" placeholder="Type the answer, or work it out in a side thread">${esc(typed["ta-" + n.id] || "")}</textarea>
        <div class="actions">
          <button class="btn small primary" data-act="lock-text" data-n="${n.id}">Lock</button>
          ${n.from === "You" ? `<button class="btn small" data-act="start-thread" data-n="${n.id}">Work it out in a side thread</button>`
            : `<button class="btn small" data-act="unself" data-n="${n.id}">Leave it to ${esc(n.from)}</button>`}
        </div>`;
    } else {
      body = `${n.askedAt != null ? `<div class="answer">Asked ${esc(n.from)} on Slack ${age(n.askedAt)}${n.askedAt < 1 ? "" : " ago"}. The coordinator nudges again tomorrow, and locks the answer when they reply.</div>` : ""}
        <div class="actions">
          <button class="btn small" data-act="ask" data-n="${n.id}">${n.askedAt != null ? "Nudge now" : `Ask ${esc(n.from)} on Slack`}</button>
          <button class="btn small" data-act="self" data-n="${n.id}">I know this</button>
        </div>`;
    }

    return `<div class="need" id="need-${n.id}" tabindex="-1">
      <span style="color:${iconColor};font-weight:700" aria-hidden="true">${icon}</span>
      <span class="title">${esc(n.title)}</span>
      <span style="display:flex;gap:6px;align-items:center">${n.status !== "approved" ? ageHTML(n) : ""}${statusChip}</span>
      <div class="why">${esc(n.why)} <span class="faint">· ${esc(n.kind)} · owed by ${esc(owner(n))}</span></div>
      ${body}
    </div>`;
  }

  function threadHTML(n) {
    const kt = (n.threadTokens / 1000).toFixed(1);
    return `<div class="thread">
      <div class="head"><span>Side thread · ${kt}k tokens · never sent to the worker</span><span>Only the locked line goes on</span></div>
      <div class="msgs" id="msgs-${n.id}">${n.thread.map((m) => `<div class="msg ${m.who}">${m.v ? `<span class="v">${m.v}</span>` : ""}${esc(m.text)}</div>`).join("")}${n.pending ? `<div class="msg agent"><i>writing…</i></div>` : ""}</div>
      <div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--line)">
        <input id="reply-${n.id}" aria-label="Reply in side thread" value="${esc(typed["reply-" + n.id] || "")}" placeholder="Push back or ask for another version…" style="flex:1;min-width:0;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text)">
        <button class="btn small" data-act="reply" data-n="${n.id}">Send</button>
      </div>
    </div>`;
  }

  function renderDrawer() {
    if (!drawerFor) return;
    const { p, s } = find(drawerFor.pid, drawerFor.sid);
    const st = stepState(s);
    const c = counts(s);
    const nx = nextStep(p, s);
    const nxl = nx ? nx.label : "the next step";
    const drafts = s.needs.filter((n) => n.status === "draft").length;
    const footText = s.state === "done"
      ? `Handed over. ${esc(nxl)} is running with these ${c.total} inputs.`
      : c.ok === c.total ? "All locked."
      : `${esc(nxl)} starts by itself once all ${c.total} are locked. Still owed: ${owedHTML(s)}`;
    const el = document.getElementById("drawer");
    el.innerHTML = `
      <header>
        <div style="flex:1">
          <div class="muted" style="font-size:12px">${esc(p.name)} · ${esc(p.agent)}</div>
          <h2 id="drawer-title" style="font-size:18px;margin-top:2px">${esc(s.label)}</h2>
          <div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${chip(st)} ${meter(s)} <span class="muted">${c.ok} of ${c.total} locked</span></div>
        </div>
        <button class="btn small" id="drawer-close" aria-label="Close">✕</button>
      </header>
      <div class="body">
        <p class="muted" style="margin-top:0">${esc(s.note || "")} Answers collect here. ${esc(nxl)} gets a fresh worker with only the locked answers, so working things out here never uses up its context.</p>
        ${s.needs.map((n) => needHTML(p, s, n)).join("")}
        <details style="margin-top:14px">
          <summary class="muted" style="cursor:pointer">What ${esc(nxl)} will receive</summary>
          <div class="packet" style="margin-top:8px">${esc(packet(p, s))}</div>
        </details>
      </div>
      <footer>
        <div class="muted" style="flex:1;font-size:12px">${footText}</div>
        ${drafts > 1 && s.state !== "done" ? `<button class="btn primary" data-act="lock-all">Lock all ${drafts} drafts</button>` : ""}
      </footer>`;
    el.querySelector("#drawer-close").onclick = closeDrawer;
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act, b.dataset.n)));
    el.querySelectorAll("textarea, input").forEach((i) => i.addEventListener("input", () => (typed[i.id] = i.value)));
    el.querySelectorAll("input[id^=reply-]").forEach((i) => i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") act("reply", i.id.slice(6));
    }));
    el.querySelectorAll(".msgs").forEach((m) => (m.scrollTop = m.scrollHeight));
  }

  function packet(p, s) {
    const lines = s.needs.map((n) => `  - ${n.title}: ${n.status === "approved" ? n.answer : "[open]"}`);
    return `goal: ${p.goal}\nlocked inputs:\n${lines.join("\n")}\nfiles: brief + repo paths only\nnext step: ${(nextStep(p, s) || {}).label || "finish"}\nnot included: side threads, earlier drafts`;
  }

  function act(kind, nid) {
    const { p, s } = find(drawerFor.pid, drawerFor.sid);
    const n = nid && s.needs.find((x) => x.id === nid);
    if (kind === "reopen") { n.status = n.draft ? "draft" : "missing"; }
    if (kind === "lock-draft") { if (!n.draft || n.pending) return; openThreads.delete(n.id); lock(p, s, n, n.draft, n.kind === "merge" ? "Merged" : "Locked"); }
    if (kind === "lock-all") lockAllDrafts(p, s);
    if (kind === "lock-text") {
      const v = (typed["ta-" + n.id] || "").trim();
      if (!v) { toast("Type an answer first."); document.getElementById("ta-" + n.id).focus(); return; }
      delete typed["ta-" + n.id]; selfOpen.delete(n.id);
      lock(p, s, n, v);
    }
    if (kind === "toggle-thread") { openThreads.has(n.id) ? openThreads.delete(n.id) : openThreads.add(n.id); }
    if (kind === "start-thread") startThread(n);
    if (kind === "reply") {
      const text = (typed["reply-" + n.id] || "").trim(); if (!text || n.pending) return;
      delete typed["reply-" + n.id];
      n.thread.push({ who: "me", text });
      const v = "v" + (n.thread.filter((m) => m.who === "agent").length + 1);
      n.draft = `${n.draft.replace(/\s*\(revised.*\)$/, "")} (revised: ${text.toLowerCase()})`;
      n.thread.push({ who: "agent", v, text: "Draft: " + n.draft });
      n.threadTokens += 2600;
    }
    if (kind === "ask") { n.askedAt = 0; toast(`Asked ${n.from} on Slack (sample: nothing sent).`); }
    if (kind === "self") selfOpen.add(n.id);
    if (kind === "unself") { selfOpen.delete(n.id); delete typed["ta-" + n.id]; }
    renderDrawer(); emit();
    focusIn(kind === "reply" ? null : nid);
    if (kind === "reply") document.getElementById("reply-" + nid)?.focus();
  }

  // ?open=pipeline/step[/need] opens the drawer on load (for screenshots and links).
  window.addEventListener("load", () => {
    const o = new URLSearchParams(location.search).get("open");
    if (o) { const [pid, sid, nid] = o.split("/"); openStep(pid, sid, nid); }
  });

  window.AC = { P, find, onChange, emit, esc, stepState, counts, currentStep, pipelineState, openNeeds, renderCoord,
    meter, chip, owedHTML, ageHTML, age, oldest, openStep, toast, lock, lockAllDrafts, nextStep };
})();
