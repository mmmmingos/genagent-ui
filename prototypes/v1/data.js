// Sample sessions for GenAgent UI generation one. Shapes are what the companion
// would build from each session's transcript; values are illustrative.
//
// Step state: done | current (needs answers) | running | next
// Question kinds (the component kit): choice | teammate | posts | pr

window.SESSIONS = [
  {
    id: "seo",
    title: "ViciDial integration page",
    harness: "Claude Code",
    cwd: "trillet.ai",
    attach: "terminal",
    ctx: 41,
    turns: 182,
    goal: "Publish /integrations/vicidial: a feature-only integration page built from the app repos, then a PR to dev for you to merge.",
    goalUpdated: "2m ago",
    flow: [
      { label: "Read the brief and app repos", state: "done", meta: "14 files · 8m" },
      { label: "Agree the outline", state: "done", meta: "you approved" },
      { label: "Get 3 answers", state: "current", needs: ["hero", "conn", "ver"] },
      { label: "Build the mockup from trillet-frontend", state: "next" },
      { label: "Write the copy", state: "next" },
      { label: "Fact-check against product.md", state: "next", meta: "fresh worker" },
      { label: "Open a PR to dev", state: "next", needsText: [["you", "merge"]] }
    ],
    nextNote: "Building the mockup from the SIP trunk settings screen in trillet-frontend.",
    feed: [
      { type: "worked", text: "Worked for 8m · read 14 files" },
      { type: "agent", text: "I've read the brief and the SIP trunk settings in <code>trillet-frontend</code>. The outline you approved is in <code>briefs/vicidial.md</code>. Before I build the mockup I need three answers: one from you, and two only Laurence can give." },
      { type: "card", q: "hero" },
      { type: "card", q: "conn" },
      { type: "card", q: "ver" }
    ]
  },
  {
    id: "pr",
    title: "Enterprise wording PR",
    harness: "Codex",
    cwd: "trillet.ai",
    attach: "terminal",
    ctx: 22,
    turns: 64,
    goal: "Apply the approved enterprise-only wording to the 9 remaining pages, open one PR to dev, and get it merged.",
    goalUpdated: "6m ago",
    flow: [
      { label: "Edit 9 pages", state: "done", meta: "12m" },
      { label: "Run checks", state: "done", meta: "pass" },
      { label: "Open PR #971", state: "done", meta: "sample" },
      { label: "Merge into dev", state: "current", needs: ["pr"] },
      { label: "Release to main", state: "next", needsText: [["you", "merge release"]] },
      { label: "Check the live pages", state: "next" }
    ],
    nextNote: "Waiting for the release PR.",
    feed: [
      { type: "worked", text: "Worked for 41m · 9 files changed" },
      { type: "agent", text: "PR <b>#971</b> is open, but <code>dev</code> moved while I worked: Vinay's pricing update changed the same lines on two pages. I can merge <code>dev</code> in and resolve them." },
      { type: "card", q: "pr" }
    ]
  },
  {
    id: "mkt",
    title: "LinkedIn batch 0 posts",
    harness: "Claude Code",
    cwd: "PAG_trillet-ming-mkt",
    attach: "terminal",
    ctx: 58,
    turns: 240,
    goal: "Get 3 posts approved for Rob and Laurence, aimed at health software vendors, and schedule them for 7–11 Dec through Zernio.",
    goalUpdated: "11m ago",
    flow: [
      { label: "Build the lead list", state: "done", meta: "412 leads" },
      { label: "Draft 3 posts", state: "done", meta: "voice.md" },
      { label: "Approve the exact text", state: "current", needs: ["posts"] },
      { label: "Schedule in Zernio", state: "next" },
      { label: "Start the connection campaign", state: "next" }
    ],
    nextNote: "Scheduling the 3 posts in Zernio for 7, 9 and 11 Dec.",
    feed: [
      { type: "worked", text: "Worked for 22m · drafted from voice.md" },
      { type: "agent", text: "Three drafts are ready, written in Rob's and Laurence's voices. Every public post needs your approval of the exact text." },
      { type: "card", q: "posts" }
    ]
  },
  {
    id: "research",
    title: "Competitor pricing scan",
    harness: "Grok",
    cwd: "research",
    attach: "terminal",
    ctx: 12,
    turns: 31,
    goal: "Check what Retell, Vapi, Bland, Synthflow and 7 others charge per minute this week, and flag anything that contradicts our comparison pages.",
    goalUpdated: "just now",
    flow: [
      { label: "Search X for pricing changes", state: "done", meta: "18 posts" },
      { label: "Read 11 pricing pages", state: "running", meta: "6 of 11" },
      { label: "Write the digest", state: "next" }
    ],
    feed: [
      { type: "worked", text: "Working for 9m" },
      { type: "agent", text: "Retell, Vapi, Bland, Air, Thoughtly and PolyAI read. Nothing contradicts <code>/compare</code> so far. Synthflow next." }
    ]
  },
  {
    id: "firsttouch",
    title: "First-touch source gap",
    harness: "Codex",
    cwd: "trillet.ai",
    attach: "transcript",
    ctx: 34,
    turns: 77,
    goal: "Find why 11 of 31 October signups have no first-touch source, and fix it.",
    goalUpdated: "1h ago",
    flow: [
      { label: "Compare September and October signups", state: "done", meta: "PostHog" },
      { label: "Read #939 and #940", state: "done" },
      { label: "Fix and open a PR", state: "done", meta: "#972" }
    ],
    feed: [
      { type: "worked", text: "Worked for 26m" },
      { type: "agent", text: "Found it: <b>#940</b> moved the pricing CTA to PostHog but dropped the UTM capture on the signup page. I put it back and opened <b>#972</b> to dev. Done." }
    ]
  }
];

window.QUESTIONS = {
  hero: {
    short: "hero line",
    session: "seo", kind: "choice", owner: "you",
    title: "Which hero line?",
    why: "Every other section hangs off this line.",
    options: [
      { t: "Add AI voice agents to ViciDial without replacing it.", s: "Safe and clear. Gives no reason to act now." },
      { t: "Put an AI voice agent on your ViciDial campaigns in an afternoon.", s: "Strongest, but \"an afternoon\" is a setup-time claim nobody has confirmed.", tag: "agent's pick" },
      { t: "The AI voice layer for ViciDial call centers.", s: "Shortest. Reads like a category claim." }
    ],
    asText: "I need you to choose the hero line. Option 1: \"Add AI voice agents to ViciDial without replacing it.\" This is safe and clear but gives no reason to act now. Option 2: \"Put an AI voice agent on your ViciDial campaigns in an afternoon.\" This is the strongest, but \"in an afternoon\" is a setup-time claim that nobody has confirmed yet, so it may not survive the fact check. Option 3: \"The AI voice layer for ViciDial call centers.\" This is the shortest, but it reads like a category claim. I'd lean towards option 2. Which would you like, or should I write another?"
  },
  conn: {
    short: "connector type",
    session: "seo", kind: "teammate", owner: "Laurence", role: "CTO", asked: 50,
    title: "Native connector, or through a SIP trunk?",
    why: "Decides whether the page says \"integration\" or \"works with\". Only engineering knows.",
    asText: "Laurence needs to tell us whether ViciDial connects through a native connector or through a SIP trunk. This decides whether the page can say \"integration\" or should say \"works with\". I can't tell from the docs. Could you ask him?"
  },
  ver: {
    short: "supported versions",
    session: "seo", kind: "teammate", owner: "Laurence", role: "CTO", asked: null,
    title: "Which ViciDial versions are supported?",
    why: "Goes in the setup section and the FAQ.",
    asText: "I also need the supported ViciDial versions for the setup section and FAQ. Only Laurence would know."
  },
  posts: {
    short: "approve 3 posts",
    session: "mkt", kind: "posts", owner: "you",
    title: "Approve 3 posts",
    why: "Exact text. Scheduled 7, 9 and 11 Dec.",
    posts: [
      { who: "Rob", when: "7 Dec", text: "Most clinics we talk to miss 1 in 5 calls after 4pm. Not because nobody cares: the front desk has gone home. Here's what changed when three of them put a voice agent on the after-hours line…" },
      { who: "Laurence", when: "9 Dec", text: "Three questions to ask any voice AI vendor about PHI before you sign: where is the audio stored, who can hear it, and how fast can you delete it on request?" },
      { who: "Rob", when: "11 Dec", text: "If you sell software to clinics, your customers already want AI on the phones. The question is whether it ships under your brand or someone else's." }
    ],
    asText: "Here are the three posts for approval.\n\nPost 1 (Rob, 7 Dec): \"Most clinics we talk to miss 1 in 5 calls after 4pm…\"\nPost 2 (Laurence, 9 Dec): \"Three questions to ask any voice AI vendor about PHI…\"\nPost 3 (Rob, 11 Dec): \"If you sell software to clinics…\"\n\nPlease reply with approve, or tell me what to change in each."
  },
  pr: {
    short: "merge #971",
    session: "pr", kind: "pr", owner: "you",
    title: "Scope enterprise-only claims", num: "#971", branch: "seo/enterprise-wording-3", base: "dev",
    adds: 214, dels: 61,
    commits: [
      { t: "Scope residency claims on healthcare pages", h: "a41c9e2", by: "Codex · 12m", conf: true },
      { t: "Scope SSO claim on financial services", h: "7d03b18", by: "Codex · 18m", conf: true },
      { t: "Update pricing table copy", h: "c2e7f40", by: "Vinay · 25m", theirs: true, branch: "dev" },
      { t: "Refresh enterprise FAQ", h: "9b1a5dd", by: "Codex · 31m" },
      { t: "Fix PHI wording on contact-center pages", h: "e58f213", by: "Codex · 40m" },
      { t: "Bump next to 16.3", h: "3fd9c07", by: "Faizan · 3h", theirs: true, branch: "dev" }
    ],
    conflicts: [
      { file: "healthcare.mdx", line: 42, a: "Enterprise plans include data residency in any region.", b: "Data residency in any region is available on Enterprise." },
      { file: "financial-services.mdx", line: 17, a: "SSO and SCIM on every plan from $299.", b: "SSO and SCIM are available on Enterprise." }
    ],
    asText: "PR #971 is open, but dev moved while I worked: Vinay's pricing update (c2e7f40) changed the same lines in healthcare.mdx line 42 and financial-services.mdx line 17. On dev the healthcare line reads \"Enterprise plans include data residency in any region.\" and mine reads \"Data residency in any region is available on Enterprise.\". On dev the financial-services line reads \"SSO and SCIM on every plan from $299.\" and mine reads \"SSO and SCIM are available on Enterprise.\". I can merge dev in and resolve both, keeping the approved enterprise wording. Then I'll rerun tests, lint and types, and it'll be ready to merge. Should I go ahead?"
  }
};

// Scripted side discussions. The side agent reads the whole session; nothing here goes to the main session until you send.
window.DISCUSS = {
  hero: {
    reads: ["session · 182 turns", "briefs/vicidial.md", "product.md", "/integrations/servicetitan"],
    opener: "I've read the whole session, the brief and <code>product.md</code>. Short version: the agent likes option 2, but \"in an afternoon\" is a setup-time claim nobody has confirmed, and Laurence still owes the connector answer. What's bothering you about the three?",
    replies: [
      "Fair. Option 2 is the only one that gives a reason to act now. If we keep the speed but tie it to something we can stand behind, like \"same day\", it can survive the fact check whatever Laurence says. Want me to look at how the ServiceTitan page handled the same problem?",
      "The ServiceTitan page avoided a time claim and led with \"no rip-and-replace\". It gets 2.1% CTR against 1.4% across the integration pages, so the keep-what-you-have angle earns its place. I'd combine them: lead with keeping ViciDial, put the speed in the subhead.",
      "I think we're there. Press <b>Compose answer</b> and I'll write the full answer for the agent, including the rules it should carry into the copy."
    ],
    composed: "Hero line: \"Add AI voice agents to your ViciDial campaigns, without replacing ViciDial.\"\nSubhead: \"Most teams are live the same day: connect over SIP, pick an agent, assign it to a campaign.\"\n\nWhy: option 2 gave a reason to act, but \"in an afternoon\" is an unconfirmed setup-time claim. Keeping ViciDial answers the first objection buyers raise (the ServiceTitan page pattern, 2.1% CTR).\n\nCarry into the copy:\n- Never say Trillet replaces the dialer.\n- Only say \"same day\" if Laurence confirms setup time; otherwise drop the subhead's first clause.\n- Don't use the word \"integration\" in the H1 until Laurence answers the connector question.\n\nUnchanged: no customer names; say \"outbound call centers\".",
    reply: "Clear. Hero and subhead are in, and I'll hold \"integration\" out of the H1 until Laurence answers."
  },
  conn: {
    reads: ["session · 182 turns", "trillet-backend/sip/", "trillet-frontend/settings/trunks"],
    opener: "Laurence hasn't replied (asked 2 days ago). From the code: <code>trillet-backend</code> has a SIP trunk handler ViciDial can dial into, and no ViciDial API client. That points to \"works with ViciDial over SIP\", not a native connector. I can't be certain without him.",
    replies: [
      "Agreed, a provisional answer is better than a blocked writer. I'd send it marked as provisional, so the fact-check step re-asks Laurence before the PR.",
      "Ready when you are. Press <b>Compose answer</b>."
    ],
    composed: "Provisional, until Laurence confirms: ViciDial connects through a SIP trunk. There's no native connector.\n\nEvidence: trillet-backend has a SIP trunk handler and no ViciDial API client.\n\nSo: say \"works with ViciDial\", not \"ViciDial integration\", and describe setup as \"connect your ViciDial carrier to a Trillet SIP trunk\".\n\nThe fact-check step must re-ask Laurence before the PR opens. If he says it's native, swap the wording back.",
    reply: "Got it: SIP trunk, provisional. I'll write \"works with\" and flag it for the fact check.",
    provisional: true
  },
  posts: {
    reads: ["session · 240 turns", "voice.md", "Rob's last 20 posts", "marketing RULES"],
    opener: "I've read the session, <code>voice.md</code> and Rob's last 20 posts. Post 1 opens with a stat we can't source: \"1 in 5 calls after 4pm\". Keep it, soften it, or swap it for a story?",
    replies: [
      "A story fits Rob better: his three best posts this year each open with one specific clinic. I'd open with the after-hours front desk and drop the number.",
      "Done in my head. Press <b>Compose answer</b> and I'll write the change and the rule for all three posts."
    ],
    composed: "Post 1: replace the opening stat with a story. New first line: \"A dental clinic in Parramatta told us their phones go quiet at 4pm. Their patients don't.\" Keep the rest as written.\n\nRule for all three posts: no numbers we can't source. Post 2 and Post 3 are approved as written.",
    reply: "Updated Post 1's opening, and posts 2 and 3 are approved. Scheduling all three in Zernio."
  },
  _generic: {
    reads: ["whole session", "repo files it touched"],
    opener: "I've read the whole session. What do you want to work through?",
    replies: ["Understood. Anything else, or shall I compose the answer?", "Press <b>Compose answer</b> when you're happy."],
    composed: "Answer from the side discussion: (the side agent writes the full answer here).",
    reply: "Thanks, continuing with that."
  }
};

window.NEW_GOAL = {
  prompt: "Publish the Five9 integration page, same pattern as ViciDial",
  title: "Five9 integration page",
  goal: "Publish /integrations/five9 using the ViciDial page as the pattern: brief, answers, mockup, copy, fact check, PR to dev.",
  steps: [
    { label: "Write the brief", h: "Claude Code" },
    { label: "Read the Five9 setup in the app repos", h: "Claude Code" },
    { label: "Get answers", h: "you", needsText: [["you", "hero line"], ["team", "Laurence: connector type"]] },
    { label: "Build the mockup", h: "Claude Code" },
    { label: "Write the copy", h: "Claude Code" },
    { label: "Fact-check", h: "Claude Code", note: "fresh worker" },
    { label: "Open a PR to dev", h: "Codex", needsText: [["you", "merge"]] }
  ]
};
