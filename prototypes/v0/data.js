// Sample data for the prototypes. Shapes are what a coordinator would keep on disk;
// the values are illustrative, loosely based on the Trillet ledger on 2026-11-02.
//
// Step states: done | running | you (needs you) | team (needs a teammate)
//              | sched (waiting on a date) | wait (waiting on an earlier step)
// Need status: approved | iterating | draft | missing

window.PIPELINES = [
  {
    id: "vicidial",
    name: "ViciDial integration page",
    agent: "SEO agent",
    goal: "Publish /integrations/vicidial as a feature-only integration page, built from the app repos.",
    steps: [
      { id: "brief", label: "Brief", state: "done", note: "ops/seo/briefs/vicidial.md" },
      {
        id: "inputs", label: "Inputs", state: "you",
        note: "The writer can't start until all 6 are locked.",
        needs: [
          { id: "v1", title: "Approve the page outline", kind: "approval", from: "You", status: "approved",
            why: "Sections and order for the page.", answer: "Approved as briefed: hero, how it connects, setup steps, FAQ." },
          { id: "v2", title: "Customer proof: can we name anyone?", kind: "decision", from: "You", status: "approved",
            why: "Named customers need sign-off.", answer: "No names. Say \"outbound call centers\"." },
          { id: "v3", title: "Setup screenshot", kind: "asset", from: "You", status: "approved",
            why: "Mockups are built from the app repos.", answer: "Use the SIP trunk settings screen from trillet-frontend." },
          { id: "v4", title: "Hero claim wording", kind: "decision", from: "You", status: "iterating", since: 26,
            why: "The one line every other section hangs off.",
            draft: "Put an AI voice agent on your ViciDial campaigns in an afternoon.",
            thread: [
              { who: "agent", v: "v1", text: "Draft: \"The AI dialer for ViciDial.\"" },
              { who: "me", text: "Too generic. We don't replace the dialer." },
              { who: "agent", v: "v2", text: "Draft: \"Add AI voice agents to ViciDial without replacing it.\"" },
              { who: "me", text: "Closer. Say how fast setup is." },
              { who: "agent", v: "v3", text: "Draft: \"Put an AI voice agent on your ViciDial campaigns in an afternoon.\"" }
            ],
            threadTokens: 14200 },
          { id: "v5", title: "Native connector or SIP trunk?", kind: "fact", from: "Laurence", status: "missing", since: 50,
            why: "Decides whether the page says \"integration\" or \"works with\". Only engineering knows." },
          { id: "v6", title: "Supported ViciDial versions", kind: "fact", from: "Laurence", status: "missing", since: 50,
            why: "Goes in the setup section and the FAQ." }
        ]
      },
      { id: "mockup", label: "Mockup", state: "wait" },
      { id: "copy", label: "Copy", state: "wait" },
      { id: "fact", label: "Fact check", state: "wait" },
      { id: "pr", label: "PR to dev", state: "wait" },
      { id: "merge", label: "You merge", state: "wait" },
      { id: "live", label: "Live check", state: "wait" }
    ]
  },
  {
    id: "batch0",
    name: "LinkedIn batch 0: health software vendors",
    agent: "Marketing agent",
    goal: "Post 3 times a week from Rob and Laurence to health software vendors (US + AU), 7–18 Dec.",
    steps: [
      { id: "leads", label: "Lead list", state: "done", note: "412 leads via Treg" },
      {
        id: "posts", label: "Approve posts", state: "you",
        note: "You approve each post's exact text.",
        needs: [
          { id: "b1", title: "Post 1 (Rob): why clinics miss calls", kind: "approval", from: "You", status: "draft", since: 3,
            why: "Exact text, scheduled 7 Dec.", draft: "Most clinics we talk to miss 1 in 5 calls after 4pm..." },
          { id: "b2", title: "Post 2 (Laurence): PHI handling", kind: "approval", from: "You", status: "draft", since: 3,
            why: "Exact text, scheduled 9 Dec.", draft: "Three questions to ask any voice AI vendor about PHI..." },
          { id: "b3", title: "Post 3 (Rob): white label for EHR vendors", kind: "approval", from: "You", status: "draft", since: 3,
            why: "Exact text, scheduled 11 Dec.", draft: "If you sell software to clinics, your customers already..." }
        ]
      },
      { id: "connect", label: "Connect", state: "wait" },
      { id: "post", label: "Post", state: "wait" },
      { id: "message", label: "Message", state: "wait" }
    ]
  },
  {
    id: "claims3",
    name: "Enterprise-only wording: remaining pages",
    agent: "SEO agent",
    goal: "Apply the owner-approved enterprise wording to the remaining unscoped pages, one PR to dev, then release.",
    steps: [
      { id: "edit", label: "Edit pages", state: "done", note: "9 pages" },
      { id: "pr", label: "PR to dev", state: "done", note: "Checks pass" },
      {
        id: "merge", label: "You merge", state: "you",
        note: "Merging is yours; nothing else waits on you here.",
        needs: [
          { id: "m1", title: "Merge the wording PR to dev", kind: "merge", from: "You", status: "draft", since: 7,
            why: "9 pages changed. Reviewer agent checked each against the approved wording.",
            draft: "9 files · tests pass · reviewer agent: no issues · preview links in the PR" }
        ]
      },
      { id: "release", label: "Release", state: "wait" },
      { id: "live", label: "Live check", state: "wait" }
    ]
  },
  {
    id: "prune",
    name: "Release R3: prune batch 1",
    agent: "SEO agent",
    goal: "Remove the pages pruned in #931, about a week after #952 is recrawled.",
    steps: [
      { id: "prep", label: "Prune PR ready", state: "done", note: "#931" },
      { id: "recrawl", label: "Wait for recrawl", state: "sched", note: "Opens 5 Nov" },
      {
        id: "approve", label: "You approve (irreversible)", state: "wait",
        needs: [
          { id: "p1", title: "Merge the irreversible release", kind: "approval", from: "You", status: "missing", opensOn: "5 Nov",
            why: "Deletes pages. Opens on 5 Nov once recrawl is confirmed." }
        ]
      },
      { id: "verify", label: "Live check", state: "wait" }
    ]
  },
  {
    id: "firsttouch",
    name: "First-touch source gap",
    agent: "SEO agent",
    goal: "Find why 11 of 31 October signups have no first-touch source.",
    steps: [
      { id: "investigate", label: "Investigate", state: "running", note: "Reading #939/#940, 6 min" },
      { id: "fix", label: "Propose fix", state: "wait" },
      { id: "pr", label: "PR to dev", state: "wait" }
    ]
  },
  {
    id: "callreview",
    name: "/platform/call-review launch",
    agent: "SEO agent",
    goal: "Confirm the new feature page is indexed and getting impressions.",
    steps: [
      { id: "live", label: "Live", state: "done", note: "30 Oct" },
      { id: "index", label: "Indexing check", state: "sched", note: "7 Nov" },
      { id: "close", label: "Close", state: "wait" }
    ]
  }
];

window.STATE_LABEL = {
  done: "Done", running: "Running", you: "Needs you", team: "Needs a teammate",
  sched: "Scheduled", wait: "Waiting"
};
