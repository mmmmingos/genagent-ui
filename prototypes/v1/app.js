// GenAgent UI, generation one. Everything is in memory; nothing talks to a real agent.
(function () {
  const S = window.SESSIONS, Q = window.QUESTIONS, D = window.DISCUSS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tok = (text) => Math.round(String(text).length / 4);
  const kt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  const ago = (h) => (h == null ? "" : h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`);

  let view = { type: "overview" };
  let discuss = null; // { qid, msgs, step, tokens, composing, composed }
  const selfOpen = new Set();
  const expanded = new Set();

  Object.entries(Q).forEach(([id, q]) => {
    q.id = id; q.status = q.status || "open"; q.text = false;
    if (q.kind === "posts") q.ok = q.posts.map(() => false);
    if (q.kind === "pr") { q.phase = "conflict"; q.done = 0; q.pop = false; }
  });

  // ---- Derived state ---------------------------------------------------------
  const sessQs = (s) => Object.values(Q).filter((q) => q.session === s.id);
  function sessState(s) {
    const open = sessQs(s).filter((q) => q.status !== "answered");
    if (open.some((q) => q.owner === "you")) return "needs";
    if (open.length) return "team";
    if (s.flow.some((f) => f.state === "running")) return "run";
    if (s.flow.every((f) => f.state === "done")) return "done";
    return "idle";
  }
  const DOT = { needs: "d-needs", team: "d-team", run: "d-run", done: "d-done", idle: "d-idle" };
  function stateLabel(s) {
    const st = sessState(s);
    const open = sessQs(s).filter((q) => q.status !== "answered");
    if (st === "needs") return `Needs you · ${open.filter((q) => q.owner === "you").length}`;
    if (st === "team") return `${open[0].owner} owes ${open.length}`;
    if (st === "run") return `Running · ${s.flow.find((f) => f.state === "running").label}`;
    if (st === "done") return "Done";
    return "Idle";
  }
  const STATUS_CLS = { needs: "st-needs", team: "st-team", run: "st-run", done: "st-done", idle: "faint" };

  // ---- Sidebar ---------------------------------------------------------------
  function renderSide() {
    const needs = S.filter((s) => sessState(s) === "needs").length;
    const run = S.filter((s) => sessState(s) === "run").length;
    $("orch-sub").innerHTML = `<span class="dot d-needs"></span>${needs} need you · ${run} running`;
    $("nav-overview").setAttribute("aria-current", view.type === "overview");
    $("session-list").innerHTML = S.map((s) => `
      <button class="side-item" data-s="${s.id}" aria-current="${view.type === "session" && view.id === s.id}">
        <span class="si-icon"><span class="dot ${DOT[sessState(s)]}"></span></span>
        <span class="si-main">
          <span class="si-title">${esc(s.title)}</span>
          <span class="si-sub"><span class="harness">${esc(s.harness)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(stateLabel(s))}</span></span>
        </span>
      </button>`).join("");
    document.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => go({ type: "session", id: b.dataset.s })));
  }

  function go(v) { view = v; render(); $("main").scrollTop = 0; $("main").focus({ preventScroll: true }); }

  // ---- Flow rail -------------------------------------------------------------
  function needChips(s, f) {
    const chips = [];
    (f.needs || []).forEach((qid) => {
      const q = Q[qid];
      const done = q.status === "answered";
      const cls = q.owner === "you" ? "you" : "team";
      chips.push(`<span class="who ${cls}" style="${done ? "opacity:.5;text-decoration:line-through" : ""}">${q.owner === "you" ? "you" : esc(q.owner)}: ${esc(q.short || q.title)}</span>`);
    });
    (f.needsText || []).forEach(([w, t]) => chips.push(`<span class="who ${w}">${w === "you" ? "you" : ""}${w === "you" ? ": " : ""}${esc(t)}</span>`));
    return chips.length && f.state !== "done" ? `<div class="needs">${chips.join("")}</div>` : "";
  }
  function rail(s) {
    return `<div class="rail">${s.flow.map((f) => {
      let meta = esc(f.meta || "");
      if (f.state === "current" && f.needs) {
        const a = f.needs.filter((id) => Q[id].status === "answered").length;
        meta = `${a} of ${f.needs.length} answered`;
      }
      if (f.state === "running") meta = `<span class="spin"></span>${meta || "running"}`;
      return `<div class="step ${f.state}"><span class="node"></span><span class="lbl">${esc(f.label)}</span><span class="meta">${meta}</span>${needChips(s, f)}</div>`;
    }).join("")}</div>`;
  }

  // ---- Generated cards -------------------------------------------------------
  function cardHead(q, statusHTML) {
    return `<div class="gcard-head">
      <h3>${esc(q.title)}</h3>
      <span class="gen" title="The agent picked the '${q.kind}' component from the kit for this question. Text shows what it would have printed instead.">✦ ${q.kind}</span>
      <span class="view-toggle" role="group" aria-label="Show as">
        <button aria-pressed="${!q.text}" data-act="ui" data-q="${q.id}">UI</button>
        <button aria-pressed="${q.text}" data-act="text" data-q="${q.id}">Text</button>
      </span>
      ${statusHTML}
    </div>`;
  }

  function card(qid) {
    const q = Q[qid];
    if (q.status === "answered") {
      const open = expanded.has("a-" + q.id);
      return `<div class="gcard" style="box-shadow:none">
        <div class="gcard-head" style="padding-bottom:12px">
          <span class="ok-ic">✓</span><h3 style="font-weight:550">${esc(q.title)}</h3>
          <span class="status st-done">${q.via === "side" ? `answered from a side discussion · ${kt(q.sideTokens)} tokens kept out` : q.kind === "pr" ? "merged" : "answered"}</span>
        </div>
        ${q.answer ? `<div style="padding:0 16px 12px"><button class="linkish" data-act="toggle-ans" data-q="${q.id}">${open ? "Hide" : "Show"} answer</button>${open ? `<div class="via-body muted" style="margin-top:6px">${esc(q.answer)}</div>` : ""}</div>` : ""}
      </div>`;
    }
    if (q.text) {
      return `<div class="gcard">${cardHead(q, "")}<pre class="as-text">${esc(q.asText)}</pre>
        <div class="gcard-foot"><span class="faint small">This is the wall of text the agent would have printed. Switch to UI to answer.</span></div></div>`;
    }
    return ({ choice: choiceCard, teammate: teammateCard, posts: postsCard, pr: prCard })[q.kind](q);
  }

  function choiceCard(q) {
    return `<div class="gcard">${cardHead(q, `<span class="status st-needs"><span class="dot d-needs"></span>Needs you</span>`)}
      <div class="gcard-body"><div class="why">${esc(q.why)}</div>
        ${q.options.map((o, i) => `<label class="opt ${q.sel === i ? "sel" : ""}"><input type="radio" name="opt-${q.id}" data-act="pick" data-q="${q.id}" data-i="${i}" ${q.sel === i ? "checked" : ""}>
          <span><span class="ot">${esc(o.t)}</span>${o.tag ? `<span class="tag">${esc(o.tag)}</span>` : ""}<div class="os">${esc(o.s)}</div></span></label>`).join("")}
      </div>
      <div class="gcard-foot">
        <button class="btn primary" data-act="send-choice" data-q="${q.id}" ${q.sel == null ? "disabled" : ""}>Send choice</button>
        <button class="btn soft" data-act="discuss" data-q="${q.id}">Not sure? Discuss it</button>
        <span class="faint small" style="margin-left:auto">or write your own in the composer</span>
      </div></div>`;
  }

  function teammateCard(q) {
    const asked = q.asked != null;
    return `<div class="gcard">${cardHead(q, `<span class="status st-team"><span class="dot d-team"></span>${esc(q.owner)} owes this</span>`)}
      <div class="gcard-body"><div class="why">${esc(q.why)}</div>
        <div class="person"><span class="avatar">${esc(q.owner[0])}</span>
          <div><div style="font-weight:550">${esc(q.owner)} <span class="faint">· ${esc(q.role)}</span></div>
          <div class="small muted">${asked ? `Asked on Slack ${ago(q.asked)} · the companion nudges again tomorrow` : "Not asked yet"}</div></div></div>
        ${selfOpen.has(q.id) ? `<div style="margin-top:10px;display:flex;gap:8px"><input class="input" id="self-${q.id}" placeholder="Your answer, sent to the session as-is" aria-label="Your answer"><button class="btn primary" data-act="send-self" data-q="${q.id}">Send</button></div>` : ""}
      </div>
      <div class="gcard-foot">
        <button class="btn" data-act="ask" data-q="${q.id}">${asked ? "Nudge now" : `Ask ${esc(q.owner)} on Slack`}</button>
        <button class="btn" data-act="self" data-q="${q.id}">I know this</button>
        <button class="btn soft" data-act="discuss" data-q="${q.id}">Work it out from the code</button>
      </div></div>`;
  }

  function postsCard(q) {
    const n = q.ok.filter(Boolean).length;
    return `<div class="gcard">${cardHead(q, `<span class="status st-needs"><span class="dot d-needs"></span>${n} of ${q.posts.length} approved</span>`)}
      <div class="gcard-body"><div class="why">${esc(q.why)}</div>
        ${q.posts.map((p, i) => `<div class="post ${q.ok[i] ? "ok" : ""}"><span class="ph"><b style="color:var(--text)">${esc(p.who)}</b> · ${esc(p.when)}</span>
          ${q.ok[i] ? `<span class="small st-done">✓ approved</span>` : `<button class="btn sm" data-act="approve-post" data-q="${q.id}" data-i="${i}">Approve</button>`}
          <span class="pt">${esc(p.text)}</span></div>`).join("")}
      </div>
      <div class="gcard-foot">
        <button class="btn primary" data-act="approve-all" data-q="${q.id}">Approve all as written</button>
        <button class="btn soft" data-act="discuss" data-q="${q.id}">Discuss changes</button>
      </div></div>`;
  }

  function prCard(q) {
    const label = { conflict: [`${q.conflicts.length} conflicts`, "st-needs"], resolving: ["Resolving", "st-run"], checks: ["Checking", "st-run"], ready: ["Ready to merge", "st-done"], merging: ["Merging", "st-run"], merged: ["Merged", "st-done"] }[q.phase];
    const commits = q.commits.map((c) => {
      const conf = q.phase === "conflict" && c.conf;
      return `<div class="cm ${c.theirs ? "theirs" : ""} ${conf ? "conf" : ""}"><span class="cn"></span>
        <span class="ct">${esc(c.t)}${c.branch ? `<span class="branch">${esc(c.branch)}</span>` : ""}${conf ? " ⚠" : ""}</span>
        <span class="hash">${esc(c.h)}</span><span class="by">${esc(c.by)}</span></div>`;
    }).join("");
    let bottom = "";
    if (q.phase === "conflict") bottom = `<div class="conf-row">⚠ <button class="conf-link" data-act="pop" data-q="${q.id}" aria-expanded="${q.pop}">${q.conflicts.length} conflicts</button> with ${esc(q.base)}
        ${q.pop ? `<div class="pop" role="dialog" aria-label="Conflicting lines"><div class="small muted">Vinay changed the same lines on ${esc(q.base)}</div>${q.conflicts.map((c) => `<div class="fl">${esc(c.file)} <span class="faint" style="font-weight:400">line ${c.line}</span></div><div class="ln a"><span>Vinay</span>${esc(c.a)}</div><div class="ln b"><span>Codex</span>${esc(c.b)}</div>`).join("")}</div>` : ""}
        <button class="btn soft" style="margin-left:auto" data-act="resolve" data-q="${q.id}">Resolve conflicts</button></div>`;
    if (q.phase === "resolving") bottom = `<div class="conf-row"><span class="spin"></span> Resolving conflict ${q.done + 1} of ${q.conflicts.length} <span class="faint">· keeping the approved enterprise wording</span></div>`;
    if (q.phase === "checks") bottom = `<div class="conf-row"><span class="spin"></span> Running tests, lint and types</div>`;
    if (q.phase === "ready" || q.phase === "merging") bottom = `
        <div class="checks"><span><span class="ok-ic">✓</span>Tests 42 passed</span><span><span class="ok-ic">✓</span>Lint passed</span><span><span class="ok-ic">✓</span>Types passed</span><span><span class="ok-ic">✓</span>Preview ready</span></div>
        <div class="conf-row" style="margin-top:8px">${q.phase === "merging" ? `<span class="spin"></span> Merging into ${esc(q.base)}` : `<span class="ok-ic">✓</span> Ready to merge`}
        ${q.phase === "ready" ? `<button class="btn primary" style="margin-left:auto" data-act="merge" data-q="${q.id}">Merge</button>` : ""}</div>`;
    return `<div class="gcard">${cardHead(q, `<span class="status ${label[1]}">${q.phase === "conflict" ? `<span class="dot d-needs"></span>` : ""}${label[0]}</span>`)}
      <div class="gcard-body">
        <div class="small muted" style="margin-bottom:6px"><b style="color:var(--text)">${esc(q.num)}</b> · <span class="mono">${esc(q.branch)}</span> → <span class="mono">${esc(q.base)}</span> · <span style="color:var(--green)">+${q.adds}</span> <span style="color:var(--red)">−${q.dels}</span></div>
        <div class="commits">${commits}</div>
        ${bottom}
      </div>
      <div class="gcard-foot"><button class="btn soft" data-act="discuss" data-q="${q.id}">Discuss</button><span class="faint small">Merging is yours; the agent only prepares it.</span></div></div>`;
  }

  // ---- Main views ------------------------------------------------------------
  function renderOverview() {
    const order = { needs: 0, team: 1, run: 2, idle: 3, done: 4 };
    const list = [...S].sort((a, b) => order[sessState(a)] - order[sessState(b)]);
    return `<div class="col">
      <div class="sess-head"><h1>Orchestrator</h1><span class="faint small">every session as a flow · generated from its transcript</span></div>
      <p class="muted" style="margin:2px 0 16px">The orchestrator watches every session, keeps each one's goal and flow up to date, and starts fresh workers when a step has what it needs. Open one to answer it.</p>
      <div class="ov-grid">${list.map((s) => {
        const st = sessState(s);
        const open = sessQs(s).filter((q) => q.status !== "answered");
        return `<button class="ov" data-open="${s.id}">
          <div class="ov-top"><b>${esc(s.title)}</b><span class="harness">${esc(s.harness)}</span><span class="status ${STATUS_CLS[st]}"><span class="dot ${DOT[st]}"></span>${esc(stateLabel(s))}</span></div>
          <div class="hrail">${s.flow.map((f) => `<div class="hn ${f.state}" title="${esc(f.label)}"><span class="node"></span><span>${esc(f.label)}</span></div>`).join("")}</div>
          ${open.length ? `<div class="ov-q">${open.map((q) => `<span class="who ${q.owner === "you" ? "you" : "team"}">${q.owner === "you" ? "you" : esc(q.owner)}</span> ${esc(q.title)}`).join(" &nbsp;·&nbsp; ")}</div>` : `<div class="ov-q">${esc(s.goal)}</div>`}
        </button>`;
      }).join("")}</div>
    </div>`;
  }

  function feedItem(s, it) {
    if (it.type === "worked") return `<div class="worked">› ${esc(it.text)}</div>`;
    if (it.type === "agent") return `<div class="msg-agent">${it.live ? `<span class="spin" style="margin-right:6px"></span>` : ""}${it.text}</div>`;
    if (it.type === "me") return `<div class="msg-me">${esc(it.text)}</div>`;
    if (it.type === "via") {
      const open = expanded.has(it.key);
      return `<div class="msg-me via"><div class="via-head">✦ Answer from a side discussion${it.provisional ? " · provisional" : ""} <span class="faint" style="font-weight:500">· ${kt(it.kept)} tokens stayed there · ${kt(tok(it.text))} sent</span></div>
        <div class="via-body ${open ? "" : "clamp"}">${esc(it.text)}</div>
        <button class="linkish" data-act="expand" data-k="${it.key}">${open ? "Show less" : "Show full answer"}</button></div>`;
    }
    if (it.type === "card") return card(it.q);
    return "";
  }

  function renderSession(s) {
    const st = sessState(s);
    const open = sessQs(s).filter((q) => q.status !== "answered");
    const pr = sessQs(s).find((q) => q.kind === "pr");
    const pills = [];
    if (open.length) pills.push(`<span class="pill"><span class="dot ${DOT[st]}"></span>${open.length} open question${open.length > 1 ? "s" : ""}</span>`);
    if (pr) pills.push(`<span class="pill"><b>${esc(pr.num)}</b> <span class="${pr.phase === "conflict" ? "st-needs" : "st-done"}">${pr.phase === "conflict" ? `${pr.conflicts.length} conflicts` : pr.phase === "merged" ? "merged" : pr.phase}</span> <span style="color:var(--green)">+${pr.adds}</span> <span style="color:var(--red)">−${pr.dels}</span></span>`);
    if (st === "run") pills.push(`<span class="pill"><span class="spin"></span>${esc(s.flow.find((f) => f.state === "running").label)}</span>`);
    return `<div class="col">
      <div class="sess-head">
        <h1>${esc(s.title)}</h1><span class="harness">${esc(s.harness)}</span>
        <div class="ctx" title="How full the main session's context is. Compaction starts near the amber mark.">
          <span>context ${s.ctx}%</span><span class="ctx-bar"><i style="width:${s.ctx}%"></i><b style="left:80%"></b></span>
        </div>
      </div>
      <div class="goal">
        <div class="goal-top"><span class="goal-label">GOAL</span><span class="gen" title="Written by the orchestrator from ${s.turns} turns of this session's transcript">✦ generated from ${s.turns} turns · ${esc(s.goalUpdated)}</span></div>
        <p>${esc(s.goal)}</p>
        ${rail(s)}
      </div>
      <div class="feed">${s.feed.map((it) => feedItem(s, it)).join("")}</div>
      <div class="dock">
        <div class="pills">${pills.join("")}</div>
        <div class="composer">
          <textarea id="composer" rows="1" placeholder="Reply to ${esc(s.harness)}, or type / for skills" aria-label="Reply to the session"></textarea>
          <div class="row">
            <span class="chip">⌂ ${esc(s.cwd)}</span>
            <span class="chip" title="${s.attach === "terminal" ? "Running inside the companion's terminal, so replies are typed in for you" : "Read-only: the companion reads this session's transcript but can't type into it"}">${s.attach === "terminal" ? "▣ companion terminal" : "◌ read-only transcript"}</span>
            <button class="send" id="send" aria-label="Send" ${s.attach === "terminal" ? "" : "disabled title='Read-only session'"}>↑</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  let plan = null; // { shown, started }
  function renderNew() {
    const g = window.NEW_GOAL;
    const steps = plan ? g.steps.slice(0, plan.shown) : [];
    return `<div class="col">
      <div class="sess-head"><h1>New goal</h1><span class="faint small">the orchestrator plans the flow, then starts a worker per step</span></div>
      <div class="composer" style="margin:14px 0 16px">
        <textarea id="goal-in" rows="2" aria-label="Goal">${esc(g.prompt)}</textarea>
        <div class="row"><span class="chip">⌂ trillet.ai</span><span class="chip">workers: Claude Code, Codex</span>
          <button class="btn primary" id="plan" style="margin-left:auto" ${plan ? "disabled" : ""}>${plan && plan.shown < g.steps.length ? "Planning…" : "Plan it"}</button></div>
      </div>
      ${plan ? `<div class="goal">
        <div class="goal-top"><span class="goal-label">GOAL</span><span class="gen">${plan.shown < g.steps.length ? `<span class="spin"></span> orchestrator is planning` : "✦ generated plan"}</span></div>
        <p>${esc(g.goal)}</p>
        <div class="rail">${steps.map((st, i) => `<div class="step next plan-step"><span class="node"></span><span class="lbl">${esc(st.label)}</span>
          <span class="meta">${st.h === "you" ? "" : `<span class="harness">${esc(st.h)}</span>`}${st.note ? esc(st.note) : ""}</span>
          ${st.needsText ? `<div class="needs">${st.needsText.map(([w, t]) => `<span class="who ${w}">${w === "you" ? "you: " : ""}${esc(t)}</span>`).join("")}</div>` : ""}</div>`).join("")}</div>
        ${plan.shown >= g.steps.length ? `<div class="d-actions" style="margin-top:12px"><button class="btn primary" id="start">Start</button><span class="faint small">Starts a Claude Code worker on step 1. The "get answers" step will ask you predicted questions up front.</span></div>` : ""}
      </div>` : `<p class="muted">Describe what should get done. The orchestrator breaks it into steps, picks a worker for each (Claude Code, Codex, Grok), and predicts what each step will need from you and your teammates, so you can answer early.</p>`}
    </div>`;
  }

  // ---- Side discussion -------------------------------------------------------
  function openDiscuss(qid) {
    const d = D[qid] || D._generic;
    discuss = { qid, msgs: [{ who: "ai", text: d.opener }], step: 0, tokens: 4200, composing: false, composed: "" };
    renderDiscuss();
    $("discuss").hidden = false;
    setTimeout(() => $("d-in")?.focus(), 0);
  }
  function closeDiscuss() { discuss = null; $("discuss").hidden = true; }

  function renderDiscuss() {
    const el = $("discuss");
    if (!discuss) { el.hidden = true; return; }
    const q = Q[discuss.qid];
    const d = D[discuss.qid] || D._generic;
    const s = S.find((x) => x.id === q.session);
    el.innerHTML = `
      <div class="d-head">
        <div class="t"><span class="dot d-run" style="animation:none;background:var(--blue)"></span><h2>Side discussion</h2><button class="d-close" id="d-close" aria-label="Close side discussion">✕</button></div>
        <div class="small muted" style="margin-top:4px">About: <b style="color:var(--text)">${esc(q.title)}</b> in ${esc(s.title)}</div>
        <div class="reads" aria-label="What the side agent has read">${d.reads.map((r) => `<span>read: ${esc(r)}</span>`).join("")}</div>
      </div>
      <div class="d-body" id="d-body">
        ${discuss.msgs.map((m) => `<div class="d-msg ${m.who}">${m.who === "ai" ? m.text : esc(m.text)}</div>`).join("")}
        ${discuss.typing ? `<div class="d-msg ai"><span class="spin"></span></div>` : ""}
      </div>
      <div class="tokens">
        <span>This discussion</span><b>${kt(discuss.tokens)} tokens</b>
        <span>Main session receives</span><b>${discuss.composing ? `~${kt(tok(discuss.composed))} tokens` : "nothing yet"}</b>
        <span>Main session context</span><b>${s.ctx}%${discuss.composing ? ` → ${s.ctx + Math.max(1, Math.round(tok(discuss.composed) / 2000))}%` : ""}</b>
      </div>
      <div class="d-compose">
        ${discuss.composing ? `
          <div class="compose-out"><div class="small" style="color:var(--blue);font-weight:600;margin-bottom:4px">Answer for the agent · edit before sending</div>
            <textarea id="d-composed" aria-label="Composed answer">${esc(discuss.composed)}</textarea></div>
          <div class="d-actions"><button class="btn primary" id="d-send">Send to ${esc(s.harness)}</button><button class="btn" id="d-back">Keep discussing</button></div>`
        : `<div class="composer"><textarea id="d-in" rows="2" placeholder="Push back, ask why, or ask it to check something…" aria-label="Message the side agent"></textarea>
            <div class="row"><span class="faint">Nothing here reaches the main session until you send.</span><button class="send" id="d-msg" aria-label="Send to side agent">↑</button></div></div>
          <div class="d-actions"><button class="btn primary" id="d-compose" ${discuss.msgs.length < 3 ? "" : ""}>Compose answer</button><span class="faint small">Writes one full answer for the agent from this discussion.</span></div>`}
      </div>`;
    $("d-close").onclick = closeDiscuss;
    const body = $("d-body"); body.scrollTop = body.scrollHeight;
    if (discuss.composing) {
      $("d-composed").oninput = (e) => (discuss.composed = e.target.value);
      $("d-back").onclick = () => { discuss.composing = false; renderDiscuss(); };
      $("d-send").onclick = sendComposed;
    } else {
      const sendMsg = () => {
        const v = $("d-in").value.trim(); if (!v || discuss.typing) return;
        discuss.msgs.push({ who: "me", text: v }); discuss.tokens += 900; discuss.typing = true; renderDiscuss();
        setTimeout(() => {
          if (!discuss) return;
          discuss.typing = false;
          discuss.msgs.push({ who: "ai", text: d.replies[Math.min(discuss.step, d.replies.length - 1)] });
          discuss.step++; discuss.tokens += 3100; renderDiscuss(); $("d-in")?.focus();
        }, 800);
      };
      $("d-msg").onclick = sendMsg;
      $("d-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } };
      $("d-compose").onclick = () => { discuss.composing = true; discuss.composed = d.composed; discuss.tokens += 1200; renderDiscuss(); $("d-composed").focus(); };
    }
  }

  function sendComposed() {
    const q = Q[discuss.qid];
    const d = D[discuss.qid] || D._generic;
    const s = S.find((x) => x.id === q.session);
    const text = discuss.composed.trim();
    const kept = discuss.tokens;
    q.status = "answered"; q.answer = text; q.via = "side"; q.sideTokens = kept;
    if (q.kind === "posts") q.ok = q.ok.map(() => true);
    s.ctx += Math.max(1, Math.round(tok(text) / 2000));
    s.feed.push({ type: "via", key: "via-" + q.id, text, kept, provisional: d.provisional });
    closeDiscuss();
    toast(`Sent ~${kt(tok(text))} tokens to the session. ${kt(kept)} stayed in the side discussion.`);
    agentReply(s, d.reply);
    go({ type: "session", id: s.id });
  }

  // ---- Answering and progress -------------------------------------------------
  function agentReply(s, text) {
    setTimeout(() => { s.feed.push({ type: "agent", text: esc(text) }); advance(s); render(); }, 900);
  }

  // When every question on the current step is answered, that step is done and a fresh worker starts the next.
  function advance(s) {
    const cur = s.flow.find((f) => f.state === "current");
    if (!cur || !cur.needs || !cur.needs.every((id) => Q[id].status === "answered")) return;
    cur.state = "done"; cur.meta = "all answered";
    const nx = s.flow[s.flow.indexOf(cur) + 1];
    if (nx) {
      nx.state = "running"; nx.meta = "fresh worker";
      s.feed.push({ type: "worked", text: "Handed over: a fresh worker started with the answers only" });
      s.feed.push({ type: "agent", live: true, text: esc(s.nextNote || "Working on the next step.") });
    }
  }

  function answerDirect(q, text, echo = true) {
    const s = S.find((x) => x.id === q.session);
    q.status = "answered"; q.answer = text; q.via = "direct";
    s.ctx += 1;
    if (echo) s.feed.push({ type: "me", text });
    agentReply(s, q.kind === "choice" ? "Got it, using that line." : q.kind === "posts" ? "All three approved. Scheduling them in Zernio." : "Thanks, noted.");
  }

  function act(a, el) {
    const q = el.dataset.q && Q[el.dataset.q];
    const s = q && S.find((x) => x.id === q.session);
    switch (a) {
      case "ui": q.text = false; break;
      case "text": q.text = true; break;
      case "pick": q.sel = +el.dataset.i; break;
      case "send-choice": answerDirect(q, `Use: "${q.options[q.sel].t}"`); break;
      case "discuss": openDiscuss(q.id); return;
      case "ask": q.asked = 0; toast(`Asked ${q.owner} on Slack (sample: nothing sent).`); break;
      case "self": selfOpen.has(q.id) ? selfOpen.delete(q.id) : selfOpen.add(q.id); render(); $("self-" + q.id)?.focus(); return;
      case "send-self": { const v = $("self-" + q.id).value.trim(); if (!v) return; selfOpen.delete(q.id); answerDirect(q, v); break; }
      case "approve-post": q.ok[+el.dataset.i] = true; if (q.ok.every(Boolean)) answerDirect(q, "Approve all three posts as written.", false); break;
      case "approve-all": q.ok = q.ok.map(() => true); answerDirect(q, "Approve all three posts as written."); break;
      case "pop": q.pop = !q.pop; break;
      case "resolve": runPR(q, s); break;
      case "merge": q.phase = "merging"; render(); setTimeout(() => { q.phase = "merged"; q.status = "answered"; s.feed.push({ type: "agent", text: "Merged <b>#971</b> into <code>dev</code>. I'll prepare the release PR to main next." }); advance(s); render(); }, 1400); return;
      case "toggle-ans": expanded.has("a-" + q.id) ? expanded.delete("a-" + q.id) : expanded.add("a-" + q.id); break;
      case "expand": expanded.has(el.dataset.k) ? expanded.delete(el.dataset.k) : expanded.add(el.dataset.k); break;
    }
    render();
  }

  function runPR(q, s) {
    q.phase = "resolving"; q.done = 0; q.pop = false; render();
    const tick = () => {
      if (q.done < q.conflicts.length - 1) { q.done++; render(); setTimeout(tick, 1100); return; }
      q.phase = "checks"; render();
      setTimeout(() => { q.phase = "ready"; render(); }, 1400);
    };
    setTimeout(tick, 1100);
  }

  function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
  }

  // ---- Render ----------------------------------------------------------------
  function render() {
    renderSide();
    const m = $("main");
    const keepScroll = m.scrollTop;
    if (view.type === "overview") m.innerHTML = renderOverview();
    else if (view.type === "new") m.innerHTML = renderNew();
    else m.innerHTML = renderSession(S.find((x) => x.id === view.id));
    m.scrollTop = keepScroll;
    m.querySelectorAll("[data-act]").forEach((el) => {
      const ev = el.tagName === "INPUT" ? "change" : "click";
      el.addEventListener(ev, (e) => { if (el.tagName !== "INPUT") e.preventDefault(); act(el.dataset.act, el); });
    });
    m.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => go({ type: "session", id: b.dataset.open })));
    if (view.type === "session") wireComposer(S.find((x) => x.id === view.id));
    if (view.type === "new") wireNew();
    if (discuss) renderDiscuss();
  }

  function wireComposer(s) {
    const ta = $("composer"), send = $("send");
    const submit = () => {
      const v = ta.value.trim(); if (!v || s.attach !== "terminal") return;
      s.feed.push({ type: "me", text: v }); s.ctx += 1; ta.value = "";
      agentReply(s, "Noted.");
      render();
    };
    send.onclick = submit;
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };
  }

  function wireNew() {
    const g = window.NEW_GOAL;
    const p = $("plan");
    if (p) p.onclick = () => {
      plan = { shown: 0 }; render();
      const step = () => { if (!plan) return; plan.shown++; render(); if (plan.shown < g.steps.length) setTimeout(step, 450); };
      setTimeout(step, 700);
    };
    const st = $("start");
    if (st) st.onclick = () => {
      const id = "five9";
      if (!S.find((x) => x.id === id)) S.unshift({
        id, title: g.title, harness: "Claude Code", cwd: "trillet.ai", attach: "terminal", ctx: 3, turns: 1,
        goal: g.goal, goalUpdated: "just now",
        flow: g.steps.map((x, i) => ({ label: x.label, state: i === 0 ? "running" : "next", meta: i === 0 ? "started now" : x.h === "you" ? "" : x.h, needsText: x.needsText })),
        feed: [{ type: "worked", text: "Started by the orchestrator just now" }, { type: "agent", live: true, text: "Writing the brief from the ViciDial pattern. I'll ask the predicted questions as soon as I have the Five9 setup details." }]
      });
      plan = null;
      toast("Started a Claude Code worker on step 1.");
      go({ type: "session", id });
    };
  }

  $("new-goal").onclick = () => { plan = null; go({ type: "new" }); };
  $("nav-overview").onclick = () => go({ type: "overview" });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && discuss) closeDiscuss(); });

  // URL params for screenshots and links: ?s=seo&discuss=hero&text=hero&new=1
  const u = new URLSearchParams(location.search);
  if (u.get("s")) view = { type: "session", id: u.get("s") };
  if (u.get("new")) view = { type: "new" };
  if (u.get("text") && Q[u.get("text")]) Q[u.get("text")].text = true;
  render();
  if (u.get("discuss")) openDiscuss(u.get("discuss"));
  window.GENUI = { S, Q, go, openDiscuss, render };
})();
