# GenUI Agent design spec

The single design spec for GenUI Agent. It comes from Phil Pitus's (@pitus_) "Generative UI" series, specifically the five frame analyses in `research/analysis/` and his method notes in `research/pitus-method.md`. Where the analyses disagreed, I checked the frames again, and the outcome is recorded in section 0.

All sizes are CSS px at 100 % browser zoom. All colours are sRGB hex, light theme first, then dark.

---

## 0. Calibration and resolved disagreements

**Calibration.** The 02-merge-conflicts recording is 2808 × 2160, which is a 1404 × 1080 viewport at 2× DPR. Re-measured on `frames/02-merge-conflicts/extra/full_10.png`:
- Prose cap height is 23 native px, so Inter is 15.8 ≈ **16 px**. The card title's cap height is also 23 native px, so it is 16 px too.
- The send button measures 74 native px, so it is **36 px**.
- Commit rows have a 64.7 native px pitch, so they are **32 px**.
- The column is 1380 native px, so it is **690 px**.
- The card action button is about 68 native px, so it is **34 px**. The status chip is 63 native px, so it is **32 px**.
- The card border is about 2 native px with a peak of `#e6e6e6`–`#ededed`, so it is **1 px at about 7 % black**. The straight edge resumes about 32 native px from the corner, so the card radius is **16**.

| Topic | What the analyses said | Resolution |
|---|---|---|
| Column width | 672 (v1, db), 690 (merge), 696 (map), 746 (signing at ~125 % zoom) | **688 px (43 rem)**. All five demos give column ÷ body-size ≈ 43 em; 672 and 696 came from assuming a scale. |
| Body / prose size | 15 (v1) vs 16 (merge, db, map), 17 (signing, zoomed) | **16 / 26**. Re-measured cap height is 16 px at the verified 2× scale. Commit rows and labels are **15**. |
| Card radius | 16 (merge, v1, signing, map), 20 (db), 14 (FAQ, zoomed) | **16**. Re-measured on the merge rest frame. |
| Composer radius | 18 (merge), 20 (v1, signing), 24 (db) | **20**. |
| Text greys | `#171717/#737373/#a3a3a3` (merge, v1); `#1f1f1f/#666/#999` (signing); `#1a1a1a/#6f6f6f/#9a9a9a` (db, map) | **Tailwind neutral 900/500/400**, i.e. `#171717/#737373/#a3a3a3`. The spread is compression noise; the merge demo is the primary reference and was sampled at full resolution. |
| Accent blue | send `#2f6bea` (merge, db: sampled `#336be9`, `#326de8`) vs `#2f5bdd` (signing) | **`#2f6bea`**. Two of three demos agree, and it is the coding-agent context. |
| In-card action button height | 28 (merge), 34 (v1), 38 (signing) | **34**. Re-measured. Chips inside a card are 28; chips above the composer are 32. |
| Prose before or after the card | merge: card → prose; db and signing: prose ending in ":" → card → outcome sentence | **Both are valid; pick by purpose.** A card that asks or acts gets a lead-in sentence ending with a colon. A card that reports a surprise result comes first, followed by a sentence giving the cause. See P5. |
| What the thinking row narrates | v1 analysis: "never step text"; signing: "Reading page 3 of 5" | **The thinking row narrates only work done before a component exists** (reading, planning). Once a card exists, all progress lives in the card. |
| Stack position | merge: centred stack; db, signing: anchored to the composer | **Centred while it fits; once it overflows, the composer pins to the bottom and the thread scrolls.** Both are the same rule seen at different lengths. |
| Mono font | SF Mono class (merge, db) vs "none used" (FAQ, map) | Mono is used **only for machine strings**. The FAQ and map demos simply contain none. |
| Semantic colours | merge uses amber, green, violet; signing and map use blue only | **Use the full set, but each hue has exactly one meaning and appears only as text, 8–16 px dots, hairlines and small tints.** |

---

## 1. Principles

1. **The UI is the answer; prose is the caption.** Every agent turn is at most: one lead-in sentence, one component, one outcome sentence. The prose never restates what the card shows, and the card never re-explains the prose.
2. **One component per task, mutated in place.** A job lives in a single card from start to finish. Steps insert rows, labels re-tense and buttons morph. Clicking a card button never posts a new user bubble or a new assistant turn.
3. **One column, one edge.** The thread, cards, prose, chips and composer share the same 688 px column and the same left and right edges. Inside a card, every text row starts on the same hanging-indent x (the rail gutter).
4. **Hierarchy by grey and weight, never by size.** All conversation text is 13–16 px, in three greys and two weights (400 and 600; 500 only on controls). There is no heading larger than 16 px anywhere in the conversation.
5. **Colour is semantic and rationed.** Blue means yours or the action. Teal means someone else's. Amber means it needs you. Green means passed or ready. Violet means done or merged. Red is reserved for irreversible failure and deletions. Colour appears only as text, 8–16 px dots, 1.5 px lines and small tints. No surface larger than a chip is coloured, and nothing has a gradient.
6. **Surfaces are drawn by hairlines.** A white card on a white page, with a 1 px border at about 7 % black and a shadow you can barely see. Dark mode lifts by one fill step instead. There is one padding level (16) and no panel nested inside a card.
7. **Every wait has a shape.** Use the real skeleton (hairline rows), a spinner inside the thing that is loading, a shimmer on the gerund label, a counter (n/m), or a 2 px progress line. Never use a page spinner, a grey shimmer block or the word "Loading…".
8. **Motion explains what changed.** Content swaps use a blur crossfade (150–250 ms, ease-out). New data opens its height, blurs in and decodes. Nothing bounces, flips, slides across the screen or scales by more than 2 %.
9. **One action at a time; details on hover.** Each state has a single tinted pill button that advances as the state advances. Detail sits one hover away, in a popover or tooltip, never in a modal.
10. **Copy carries state.** Sentence case throughout. Present participles while running ("Pushing 3 commits"), past tense or adjectives when done ("Merged into main"). Numbers are digits, with real names and real counts.

---

## 2. Design tokens

**Fonts.** Use **Inter** (Google Fonts, variable, weights 400/500/600). It is Pitus's face: double-storey a, flat-topped t, straight-legged R. Use it with default tracking and no stylistic alternates. For mono, use **Geist Mono** (Google Fonts). Pitus's mono is SF Mono class (narrow, slashed zero, no slab on r), but SF Mono cannot be shipped and this is a Windows machine, where `ui-monospace` resolves to Consolas. Geist Mono is the closest freely licensed match. The same face drives the embedded terminal. Load both with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

If the app has to work offline, self-host the same files from `@fontsource-variable/inter` and `@fontsource/geist-mono`.

```css
:root {
  color-scheme: light;

  /* ---------- fonts ---------- */
  --font-sans: "Inter", "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;

  /* ---------- type scale (size / line-height) ---------- */
  --fs-prose: 16px;   --lh-prose: 26px;   /* agent prose, user bubble, composer text */
  --fs-title: 16px;   --lh-title: 24px;   /* card title (600), question (600) */
  --fs-body:  15px;   --lh-body:  24px;   /* rows, labels, footer status, buttons, chips, disclosure */
  --fs-meta:  14px;   --lh-meta:  20px;   /* author · time, subtitles, sidebar rows, side chat */
  --fs-small: 13px;   --lh-small: 18px;   /* group labels, tooltips' second tier, toasts' meta */
  --fs-mono:  12.5px;                      /* hashes, branch chips, ids */
  --fs-code:  14px;                        /* inline code in prose, popover code lines */
  --fs-badge: 12px;                        /* numerals in 18 px badges */
  --fw-regular: 400; --fw-medium: 500; --fw-strong: 600;

  /* ---------- neutrals ---------- */
  --bg-page:      #ffffff;
  --bg-sidebar:   #fafafa;
  --bg-card:      #ffffff;   /* card, composer, popover, tooltip, chip */
  --bg-raised:    #f5f5f5;   /* inline code, + button, repo pill, segmented track, busy button, option row */
  --bg-bubble:    #f6f6f6;
  --bg-hover:     #efefef;   /* hover on raised things, sidebar row hover */
  --bg-active:    #ebebeb;   /* selected sidebar row */
  --bg-thumb:     #ffffff;   /* active segment */
  --bg-row-active:#fafafa;   /* row band while a step is active */
  --bg-term:      #fbfbfb;
  --border:        rgba(0,0,0,.07);   /* ≈ #ededed on white */
  --border-strong: rgba(0,0,0,.10);   /* ≈ #e5e5e5: inputs, hovered chips */
  --divider:       #f0f0f0;
  --track:         #f0f0f0;           /* progress and token-meter track */
  --text-1: #171717;   /* primary */
  --text-2: #737373;   /* secondary: meta, others' rows, done labels */
  --text-3: #a3a3a3;   /* tertiary: hashes, timers, placeholder, chevrons */
  --text-4: #d4d4d4;   /* disabled, ghost text, rails */
  --text-on-accent: #ffffff;

  /* ---------- accent: blue = yours / the action ---------- */
  --accent:       #2f6bea;   /* solid: send button, focus ring base. The only solid fill. */
  --accent-dot:   #3b82f6;   /* 8 px nodes, user lane */
  --accent-line:  #a1ccf5;   /* 1.5 px rail of your lane */
  --accent-ink:   #2b54a8;   /* text on tint: button labels, selected value */
  --accent-tint:  #edf2fc;   /* button fill */
  --accent-tint-hover: #e3ebfb;
  --accent-chip:  #f1f6fe;   /* branch chip, selected option fill */
  --accent-ring:  0 0 0 3px rgba(47,107,234,.16);

  /* ---------- teal = someone else's (teammate, other branch, sub-agent) ---------- */
  --teal-dot:  #1fd2ad;  --teal-line: #b2e7d6;  --teal-ink: #0f8a6c;  --teal-tint: #effcf8;

  /* ---------- amber = needs you / conflict / blocked (never red for these) ---------- */
  --amber-dot:  #f0a80d;  --amber-ink: #b45309;  --amber-tint: #fffbeb;
  --amber-ring: #f8d9a6;  --amber-halo: #fdeccb;  --amber-flash: #fcf3ed;  /* new-row band */
  --amber-underline: #d8b98a;

  /* ---------- green = passed / ready / applied ---------- */
  --green-dot: #22c55e;  --green-ink: #15803d;  --green-tint: #f0fdf4;  --green-ring: #bbf7d0;
  --green-progress: #4ade80;  --green-flash: #e9faee;

  /* ---------- violet = done / merged / finished goal ---------- */
  --violet-dot: #8b5cf6;  --violet-ink: #6d28d9;  --violet-tint: #f5f3ff;  --violet-flash: #f6f5ff;

  /* ---------- red = irreversible failure, deletions only ---------- */
  --red-dot: #ef4444;  --red-ink: #b91c1c;  --red-tint: #fef2f2;  --diff-del: #9f1239;  --diff-add: #15803d;
  --sq-add: #5bda7a;  --sq-del: #de4d55;  --sq-empty: #e6e5e8;

  /* ---------- grey lane (main / context / idle) ---------- */
  --grey-dot: #c0c0c0;  --grey-line: #d4d4d4;  --grey-chip: #f1f1f1;

  /* ---------- spacing (4-based with 2/6 half-steps) ---------- */
  --s-0: 2px; --s-1: 4px; --s-1h: 6px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-12: 48px; --s-16: 64px;

  /* ---------- geometry ---------- */
  --col: 688px;            /* conversation column */
  --sidebar-w: 264px;
  --side-panel-w: 360px;
  --header-h: 48px;
  --row-h: 32px;           /* commit rows, steps, sidebar rows */
  --control-h: 36px;       /* composer controls, send */
  --btn-h: 34px;           /* card action button */
  --chip-h: 32px;          /* chips above the composer */
  --chip-in-card-h: 28px;  /* check chips inside a card */
  --ref-h: 20px;           /* mono branch / ref chip */
  --badge: 18px;           /* count badge */
  --dot: 8px;  --node-lg: 16px;  --rail-w: 1.5px;
  --gutter: 66px;          /* rail gutter; lanes at 11 / 29 / 48 */
  --lane-0: 11px; --lane-1: 29px; --lane-2: 48px;

  /* ---------- radii ---------- */
  --r-code: 4px; --r-ref: 5px; --r-badge-sq: 6px; --r-row: 8px;
  --r-tooltip: 10px; --r-tile: 10px; --r-pop: 12px; --r-option: 12px;
  --r-card: 16px; --r-composer: 20px; --r-pill: 999px;

  /* ---------- borders ---------- */
  --bw: 1px;
  --hairline: var(--bw) solid var(--border);

  /* ---------- shadows (light) ---------- */
  --shadow-card:     0 1px 2px rgba(0,0,0,.02), 0 4px 16px -4px rgba(0,0,0,.04);
  --shadow-composer: 0 4px 20px rgba(0,0,0,.035);
  --shadow-chip:     0 1px 6px rgba(0,0,0,.03);
  --shadow-bubble:   0 2px 10px rgba(0,0,0,.03);
  --shadow-pop:      0 8px 24px rgba(0,0,0,.08);
  --shadow-thumb:    0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04);

  /* ---------- motion ---------- */
  --ease-out:    cubic-bezier(.2,.8,.2,1);     /* everything by default */
  --ease-in-out: cubic-bezier(.65,0,.35,1);    /* camera-like moves: re-centre, scroll-to, panel slide */
  --ease-linear: linear;                       /* spinners, shimmer, progress */
  --t-instant: 80ms;   /* press feedback, popover close */
  --t-fast:   150ms;   /* text swaps, hovers, tooltip in */
  --t-base:   220ms;   /* block enter, button morph, chip morph */
  --t-layout: 280ms;   /* height open/close, stack re-centre, panel slide */
  --t-slow:   450ms;   /* text decode, tint decay start, card build total */
  --t-shimmer: 1400ms; /* one shimmer sweep incl. pause */
  --t-spin:    800ms;  /* one spinner turn */
  --stagger-row: 50ms;  --stagger-option: 70ms;  --stagger-step: 100ms;
  --blur-in: 5px;      /* filter blur at the start of an enter / swap */

  /* ---------- z-layers ---------- */
  --z-base: 0;  --z-raised: 1;  --z-sticky: 10;   /* session header, composer dock */
  --z-sidebar: 20;  --z-side-panel: 30;  --z-popover: 40;  --z-tooltip: 50;
  --z-toast: 60;  --z-palette: 70;  /* command palette only; there are no modals */
  --z-drag: 80;
}

/* ---------- dark: explicit choice ---------- */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-page:#0f0f0f; --bg-sidebar:#121212; --bg-card:#191919; --bg-raised:#252525; --bg-bubble:#252525;
  --bg-hover:#2a2a2a; --bg-active:#2e2e2e; --bg-thumb:#3a3a3a; --bg-row-active:#1f1f1f; --bg-term:#141414;
  --border:rgba(255,255,255,.07); --border-strong:rgba(255,255,255,.11); --divider:#282828; --track:#262626;
  --text-1:#f0f0f0; --text-2:#a3a3a3; --text-3:#6e6e6e; --text-4:#3f3f3f;
  --accent:#2f5cdd; --accent-dot:#4880e8; --accent-line:#435379; --accent-ink:#b6c9f5;
  --accent-tint:#1e232e; --accent-tint-hover:#252c3a; --accent-chip:#162333; --accent-ring:0 0 0 3px rgba(72,128,232,.30);
  --teal-dot:#2de0a1; --teal-line:#406e5f; --teal-ink:#8be6c5; --teal-tint:#122f23;
  --amber-dot:#e59f1c; --amber-ink:#e9b04a; --amber-tint:#2a2112; --amber-ring:#5a4220; --amber-halo:#3a2a0f; --amber-flash:#2a211b; --amber-underline:#5f5e56;
  --green-dot:#50e359; --green-ink:#5fd16a; --green-tint:#132815; --green-ring:#1f4a26; --green-progress:#33d965; --green-flash:#16271b;
  --violet-dot:#8e3ef3; --violet-ink:#b699f9; --violet-tint:#20182f; --violet-flash:#211c2c;
  --red-dot:#f43f5e; --red-ink:#fb7185; --red-tint:#2a1418; --diff-del:#c2435b; --diff-add:#6ec271;
  --sq-add:#3fcf5f; --sq-del:#d13a50; --sq-empty:#3a3a3a;
  --grey-dot:#5e5e5e; --grey-line:#3a3a3a; --grey-chip:#252525;
  --shadow-card: inset 0 1px 0 rgba(255,255,255,.03);   /* lit top edge; elevation comes from the fill step */
  --shadow-composer: inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-chip: 0 1px 0 rgba(0,0,0,.45);
  --shadow-bubble: none;
  --shadow-pop: 0 8px 24px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-thumb: 0 1px 2px rgba(0,0,0,.4);
}

/* ---------- dark: follow the OS unless light is forced (identical declarations) ---------- */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg-page:#0f0f0f; --bg-sidebar:#121212; --bg-card:#191919; --bg-raised:#252525; --bg-bubble:#252525;
    --bg-hover:#2a2a2a; --bg-active:#2e2e2e; --bg-thumb:#3a3a3a; --bg-row-active:#1f1f1f; --bg-term:#141414;
    --border:rgba(255,255,255,.07); --border-strong:rgba(255,255,255,.11); --divider:#282828; --track:#262626;
    --text-1:#f0f0f0; --text-2:#a3a3a3; --text-3:#6e6e6e; --text-4:#3f3f3f;
    --accent:#2f5cdd; --accent-dot:#4880e8; --accent-line:#435379; --accent-ink:#b6c9f5;
    --accent-tint:#1e232e; --accent-tint-hover:#252c3a; --accent-chip:#162333; --accent-ring:0 0 0 3px rgba(72,128,232,.30);
    --teal-dot:#2de0a1; --teal-line:#406e5f; --teal-ink:#8be6c5; --teal-tint:#122f23;
    --amber-dot:#e59f1c; --amber-ink:#e9b04a; --amber-tint:#2a2112; --amber-ring:#5a4220; --amber-halo:#3a2a0f; --amber-flash:#2a211b; --amber-underline:#5f5e56;
    --green-dot:#50e359; --green-ink:#5fd16a; --green-tint:#132815; --green-ring:#1f4a26; --green-progress:#33d965; --green-flash:#16271b;
    --violet-dot:#8e3ef3; --violet-ink:#b699f9; --violet-tint:#20182f; --violet-flash:#211c2c;
    --red-dot:#f43f5e; --red-ink:#fb7185; --red-tint:#2a1418; --diff-del:#c2435b; --diff-add:#6ec271;
    --sq-add:#3fcf5f; --sq-del:#d13a50; --sq-empty:#3a3a3a;
    --grey-dot:#5e5e5e; --grey-line:#3a3a3a; --grey-chip:#252525;
    --shadow-card: inset 0 1px 0 rgba(255,255,255,.03);   /* lit top edge; elevation comes from the fill step */
    --shadow-composer: inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-chip: 0 1px 0 rgba(0,0,0,.45);
    --shadow-bubble: none;
    --shadow-pop: 0 8px 24px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-thumb: 0 1px 2px rgba(0,0,0,.4);
  }
}

/* ---------- base ---------- */
html, body { background: var(--bg-page); color: var(--text-1); }
body { font: var(--fw-regular) var(--fs-prose)/var(--lh-prose) var(--font-sans);
       -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
code, kbd, samp, .mono { font-family: var(--font-mono); font-variant-ligatures: none; }
.num { font-variant-numeric: tabular-nums; }   /* timers, counters, n/m, token meter, diffstat */
```

Implementation note: plain CSS cannot share one declaration block between an attribute selector and a media query, so the dark values appear twice above. Edit both copies together, or generate them from one JS object at build time.

**Dark-mode rules beyond the swap:**
- Elevation comes from the fill step (`#0f0f0f` page → `#191919` card → `#252525` raised → `#3a3a3a` thumb), not from shadows.
- Borders read slightly brighter on the top edge.
- Tinted chips and buttons become deep tints with pastel text (blue 200, emerald 200, violet 300).
- Dots and lines keep their saturation. Hue never changes between themes, only lightness.

---

## 3. Components

The anatomy is listed left to right and top to bottom. "Column" means the 688 px conversation column. Unless stated otherwise, every text colour comes from the tokens.

### 3.1 App shell

```
┌ sidebar 264 ┬──────────────────── main ─────────────────────┬ side panel 360 (optional) ┐
│ New goal    │ session header 48 (sticky)                    │ Side chat                 │
│ Search  ^K  │                                               │ token meter               │
│ Live        │        conversation column 688, centred       │ thread                    │
│  ● row      │                                               │                           │
│ Saved       │        chips row                               │                           │
│  ○ row      │        composer (centred or pinned bottom)     │ compose / send            │
└─────────────┴───────────────────────────────────────────────┴───────────────────────────┘
```

- **Main pane:** `--bg-page`. The column is centred, `max-width: var(--col)`, with a minimum side gutter of 24. At widths under 760 the column fills the pane minus 16 gutters.
- **Stack behaviour:**
  - While the thread is shorter than the viewport, the whole stack (thread, chips, composer) is vertically centred, and it re-centres with a `--t-layout` `--ease-in-out` glide as it grows.
  - Once it overflows, the composer docks 24 px above the window's bottom edge (`position: sticky; bottom: 24px`). The thread scrolls behind it under a 32 px fade (`mask-image: linear-gradient(to top, transparent 0, #000 32px)` on the scroll area's bottom edge). A matching 24 px fade sits under the session header.
  - New content auto-scrolls only if the user was already within 80 px of the bottom.
- **Sidebar:** `--bg-sidebar`, a 1 px `--divider` right border, padding 12 8. It is collapsible to 0 with `Ctrl+B` (width `--t-layout`, `--ease-in-out`; content fades in `--t-fast`). Top to bottom:
  1. **New goal**, a 32 px row: 16 px plus icon in `--text-2`, then the label 14/500 in `--text-1`, radius `--r-row`, hover `--bg-hover`.
  2. **Search**, a 32 px row: search icon, "Search" in `--text-3`, and `Ctrl K` right-aligned in 12 px `--text-3` mono.
  3. **Groups**, each with a 13 px `--text-3` label, sentence case, 16 px above the label and 4 below:
     - "Needs you" (only when not empty)
     - "Running"
     - "Recent", which holds saved Claude Code, Codex and Grok transcripts grouped by recency ("Today", "Yesterday", "Last 7 days")
  4. **Session row:** 32 high, padding 0 8, radius 8, gap 8. Contents:
     - an 8 px state dot. Blue `--accent-dot` means running, with a 1.5 px spinner ring replacing the dot while a turn is live. Amber means it needs you. Green means the last goal finished clean. Violet means merged or shipped. Hollow grey (1.5 px `--text-3` ring) means idle or saved.
     - the title at 14/400 in `--text-1`, truncated with an ellipsis
     - meta right-aligned at 13 px in `--text-3`, tabular: relative time ("now", "6m", "2h", "Tue"), or for a running row the live counter ("3/7")
     - a 12 px engine glyph (Claude, Codex, Grok) in `--text-3`, shown only on hover, before the time.
     - Hover: `--bg-hover`. Selected: `--bg-active` and the title goes to 500.
  5. **Footer**, a 32 px row: settings icon, then the user's machine name in `--text-2`.
- There are **no logos, wordmarks or gradient avatars** in the shell.

### 3.2 Session header

- Height 48, sticky, `--z-sticky`, background `--bg-page` with no border. It separates by the 24 px scroll fade beneath it.
- **Left, inline on one baseline:** the session title at 15/500 in `--text-1`, max 40 ch, ellipsis. Then a 12 px gap and the meta at 14 in `--text-2`, with parts joined by " · ": `acme-webapp · Claude Code · Opus · 14m`. The repo name is sans (it is a human label); a branch, if shown, is mono 12.5.
- **Right**, controls 32 high with an 8 gap:
  - a **segmented control** "Chat | Terminal": track `--bg-raised` with a 2 px inset, thumb `--bg-thumb` with `--shadow-thumb`, labels 14, active label `--text-1`, inactive `--text-2`.
  - a 32 px icon button for the **side chat** (message-square icon). It is active when the panel is open, shown as a `--bg-raised` fill.
  - a 32 px **overflow** icon button for Rename, Open folder, Copy session id, Archive.
- **States:**
  - When the session is running, a 6 px blue dot sits before the title.
  - When it needs you, an amber dot appears and the meta's last part reads "waiting 2m" in `--amber-ink`.
- The title is editable on double-click: the same box becomes an input with a 1 px `--accent` border plus `--accent-ring`, Enter saves and Esc cancels.

### 3.3 Goal card with a vertical flow rail (commit-graph style)

This is the backbone component. It shows one goal and every step, sub-agent and check under it, and it is mutated in place for the life of the goal.

**Surface:** column width, `--bg-card`, `--hairline`, radius 16, `--shadow-card`, padding 16. It has no inner panels and no header divider.

**Header row (24 high):**
- **Left:** the goal title at 16/600 in `--text-1`, then a space and the goal id or PR number at 16/400 in `--text-2` (for example "#128"). The id fades in only once it exists.
- **Right:** the status as plain text with a dot, baseline-aligned: a 6 px dot, a 6 gap, then the label 14/500 in that hue. The states are "Running" (blue), "Needs you" (amber), "Ready" (green), "Done" or "Merged" (violet), and "Failed" (red). There is no pill background.
- **Header to first row:** 10.

**Rows (32 each):**
- **Rail gutter, 66 wide.** Lane centres sit at 11, 29 and 48:
  - lane 0 is the goal's trunk (grey, or the target node)
  - lane 1 is the main agent (blue)
  - lane 2 is sub-agents or a teammate (teal)
  - a fourth lane at 66 is allowed only inside an expanded thinking timeline, never in a card.
- **Text** starts at x = 66, at 15/24. The colour carries ownership:
  - the agent's own steps are `--text-1`
  - context and other people's work are `--text-2`
  - anything needing attention is `--amber-ink`
- **Optional inline tail, after the text:**
  - a mono ref chip (h 20, radius 5, padding 0 6, 12.5/500, 10 gap). It is blue for your branch on `--accent-chip`, teal for another branch on `--teal-tint`, and grey `main` on `--grey-chip`.
  - a count badge: an 18 px circle with a 1 px `--amber-ring`, `--amber-tint` fill and a 12 px numeral in `--amber-ink`. When resolved it becomes a green check circle (`--green-tint`, `--green-ring`, 10 px check), then fades out.
- **Right meta, right-aligned:** a mono hash or id at 12.5 in `--text-3`, an 8 gap, then "You · now" or "Lena · 6m" at 14 in `--text-2`.
  - While a row is active, the slot shows a tabular counter ("2/3", "36/42") in `--text-2`.
  - For a status row it shows a lowercase word: "checking" (`--text-2`), "3 conflicts" (amber), "ready" (green), "merged" (violet).
- **Active row:** a `--bg-row-active` band, full card width minus 8 each side, radius 8. The node becomes a spinner and the label shimmers. A 2 px `--green-progress` line on a `--track` runs under the text from x = 66 to the right content edge, filling in proportion to n/m.

**Rail drawing (SVG, one per card, absolutely positioned under the rows):**
- **Lines:** 1.5 px in the lane's `-line` colour. Branches leave and rejoin with cubic-Bézier S-curves spanning about 1.5 rows, never right angles.
- **Grey trunk:** dashed (3/3) above its newest commit, which means "moved on since". Below the last row it continues as a 1-row tail that fades out.

| Node | Spec | Meaning |
|---|---|---|
| Dot | 8 px filled, lane colour | completed step or commit |
| Spinner ring | 12 px, 1.5 px, 270° arc in the lane colour on a `--text-4` track, `--t-spin` per turn | in progress |
| Hollow ring | 11 px, 1.5–2 px stroke, card-coloured centre | merge point (a sub-agent rejoined) |
| Dashed circle | 12 px, 1.5 px dash 2/2, `--text-3` | unknown or pending check |
| Dead end | 10 px × glyph in `--text-3`, branch connector dashed | abandoned path; text at `--text-3` states the reason |
| Attention disc | 16 px `--amber-dot` with a white "!" (2 px stroke) and a 4 px `--amber-halo` ring | needs you |
| Success disc | 16 px `--green-dot` with a white check | ready or passed |
| Done disc | 16 px `--violet-dot` | finished or merged |
| Failure disc | 16 px `--red-dot` with a white × | irreversible failure only |

- The target node (top row, lane 0) connects to the current head with a **dashed diagonal in the state colour**: blue while checking, amber with conflicts, green when ready, solid violet when done.

**Check chips (only in the ready state):**
- They sit in a row between the last row and the footer, with 12 above.
- Each chip: h 28, pill, `--hairline`, card fill, padding 0 12, gap 8. Contents: a 12 px green check, a 6 gap, the label in `--text-1`, a space, then the value in `--text-2` ("Tests 42 passed").
- On hover a tooltip (3.18) shows the tool, the result and the duration.

**Footer row (34 high, 12–16 below the last row or the chips):**
- **Left:** a 16 px icon or spinner, an 8 gap, then the status sentence at 15/24.
  - While working, it is a present participle in `--text-1` with shimmer ("Running 36 of 42 tests").
  - When done or blocked, it is a state icon plus a sentence. A hoverable count is in its hue with a 1 px dotted underline in the `-underline` colour, 3 px below the baseline.
- **Right:** exactly one button (3.17). While the agent works, that button morphs in place into the neutral busy pill ("◌ Resolving").

**Card states:** building, running, needs you, resolving, testing (n/m), ready, finishing, done, failed. Every state must update the header status, the row meta, the footer, the node and the composer status chip **in the same frame**. A label and a visual that disagree (an amber "!" next to "Resolved") are a bug.

**Long goals:** after 12 rows, older completed rows collapse into one row that reads "14 earlier steps", in `--text-2` with a chevron-down. Click to expand, which animates height `--t-layout`.

### 3.4 "Thinking / Worked for Ns" disclosure

- **Layout:** one line, 24 high. A 12 px chevron-right in `--text-3` at x = 7. The label starts at x = 46, on the card's lane 1, so the turn shares the card's grid.
- **Live:** the label "Thinking" at 15 in `--text-1` with shimmer, an 8 gap, then the seconds counter at 15 in `--text-3`, tabular, ticking every 1 s ("1s", "2s").
  - Before any component exists, the label may narrate concrete pre-work, with a blur-swap at most every 400 ms: "Reading 6 of 7 files", "Checking your profile", "Planning the steps".
  - Once a card mounts, the label returns to "Thinking" or settles. All progress moves into the card.
- **Done:** a single string at 15 in `--text-2`. Use "Worked for 5s" if the turn acted, "Thought for 14s" if it only reasoned, and "Read for 5s" if it only read. Never use "Finished!" or "Done thinking".
- **Expanded** (click or Enter; the chevron rotates 90° in `--t-fast`): the thinking timeline opens beneath with a height animation. It has no surface.
  - **Rail:** a 1.5 px `--text-4` rail centred under the chevron. Step text starts at x = 46. The step pitch is 32, and a row of source chips adds 36.
  - **Main-lane nodes:** an 8 px `--text-3` dot when done, an orbit spinner (22 px arc around the 8 px dot) when active, and a 14 px tool icon (search, file, terminal) for tool steps.
  - **Side branches:** the node shifts to a lane 22 px right (the text does not indent) and the text is one tier lighter. A dead end gets × and a dashed connector. A merge-back gets a hollow ring.
  - **Text tiers:** the active step is `--text-1` with shimmer, a done step `--text-2` stating the finding in past tense ("Read 7 files about routing and auth"), and a branch or dead end `--text-3` ("Dead end: middleware can't read the request body").
  - **Source chips:** h 28, pill, `--bg-card` on `--bg-page`, with a `--hairline` in light mode. Each has a 14 px file-type icon and the file name in sans 14 `--text-2`. Show at most 4, then "+3 more" as plain `--text-3` text.
  - **Final row:** "Finished thinking" at 15/500 in `--text-1`, then the result summary in `--text-3` ("4 modules to deepen · 3 steps").

### 3.5 Agent prose and user bubble

- **Agent prose:** 16/26 in `--text-1`, full column width, with no bubble, avatar or name. Paragraph gap is 12.
  - `strong` is 600 and is reserved for entities and numbers ("**#128**", "**9.9s**").
  - Inline code: mono 14, `--bg-raised` fill, radius 4, padding 1 5. Use it for file names, branches and commands only.
  - Links: `--accent-ink`, with no underline until hover.
  - Lists are allowed but rare: 6 px `--text-3` bullets, 4 between items.
- **Streaming:** words arrive in groups of 2–3 at about 30 words/s. Each word enters with opacity 0 → 1 and `blur(5px)` → 0 over 300 ms, so the last 4–6 words are always slightly soft. There is no caret. Bold streams in already bold.
- **Length:** a lead-in of one sentence ending in ":", and an outcome of one or two sentences. Anything longer than about 60 words should have been a component.
- **User bubble:**
  - Shape: right-aligned, max 76 % of the column. A single line is 44 tall, padding 10 17, pill radius (22). Multi-line text keeps radius 20.
  - Surface: `--bg-bubble` with `--shadow-bubble` and no border. Text 16/24 `--text-1`.
  - No avatar or timestamp. The timestamp appears in a tooltip after 600 ms of hover, at 13 in `--text-2`.
  - Attachments sit above the bubble as tiles: 158 × 128, `--bg-raised`, radius 12, padding 10. The type label ("PDF") is 13 `--text-3` at the top-left. The name is 14 `--text-1`, 2 lines, middle-truncated.
- **Rhythm:**
  - user bubble → agent turn: 28
  - within a turn (disclosure → prose → card → prose): 16
  - between turns: 32
  - last item → chips row: 32
  - chips → composer: 8

### 3.6 Generated question cards (shared shell)

Every question the agent asks the user is a card in the flow. It is never a modal and never plain prose with "reply 1 or 2".

**Shell:** the same surface as 3.3 (radius 16, padding 16, hairline).

**Header:**
- **Eyebrow:** a 14 px kind icon in `--text-3`, a 6 gap, then a one-word noun at 14 in `--text-2` ("Address", "Teammate", "Approval", "Plan").
- **Question:** 8 below the eyebrow, at 16/24/600 in `--text-1`, phrased as a natural question ("Which branch should this go on?").
- **Optional context line:** 15 in `--text-2`, one sentence at most.
- Header to body: 16.

**Body:** depends on the kind (below).

**Footer (34 high, 16 above):**
- **Left:** "← Back" (14 in `--text-2`, from step 2 on) or a quiet skip link "Not now" (`--text-2`).
- **Centre:** the stepper, only for multi-question cards. It is four 3 px bars with radius 2 and a 5 gap: done bars 15 wide in `--accent-line`, the current bar 27 wide in `--accent-dot`, todo bars 15 wide in `--track`. There is no "Step 2 of 4" text.
- **Right:** one tinted button, only when the kind needs an explicit commit.

**Answered:** the card does not disappear. It collapses (height `--t-layout`) to a 40 high summary row: the eyebrow, the question in `--text-2`, then the answer in `--text-1` right-aligned with a 12 px green check. Click to reopen if the agent hasn't moved on. The user's answer is **not** echoed as a new bubble.

**Answering from the composer:** while a question card is open, typing in the composer and pressing Enter answers it. The card shows the typed text as its answer. The composer placeholder changes to "Answer, or ask something else".

#### a. Choice
- **Option rows:** full body width, 48 high, `--bg-raised`, radius 12, no border, padding 0 16, gap 8.
  - Left: the primary text at 15/500 in `--text-1`.
  - Right: the qualifier at 14 in `--text-2` ("Recommended", "Your company", "3 files").
  - Hover: `--bg-hover` and a pointer cursor.
  - Keyboard: 1–9 select; ↑↓ move a focus ring (2 px `--accent` outline, offset 2).
- **Selected:** fill `--accent-chip`, an inset 1 px border at `--accent-dot` 60 %, the qualifier turns `--accent-ink`, and a 14 px check (2 px stroke, `--accent-ink`) appears at the far right. Height never changes.
- **Single-select commits on click.** Hold 600 ms so the selection reads, then the card collapses or advances. There is no confirm button.
- **Multi-select:** rows get a 16 px rounded-square checkbox at the left (radius 4; `--border-strong` when off, `--accent` fill with a white check when on). The footer gets a "Continue" tinted button, labelled with its count ("Continue with 2").
- **"Something else"** is always the last row, in `--text-2`. On click, the same box morphs into an input (white fill, 1 px `--accent` border plus `--accent-ring`, placeholder in `--text-3`) with a 28 px square enter key (radius 7) at the right. The key is `--bg-raised` with a grey return arrow while empty, and turns solid `--accent` with a white arrow once there is text.
- Show at most 4 options plus "Something else". The agent picks the 2–3 most likely options and marks one "Recommended".

#### b. Ask a teammate
- **Meaning:** teal (someone else).
- **To row:** a 20 px initial disc (`--teal-tint` fill, 11/600 `--teal-ink` initial), an 8 gap, the name at 15/500 in `--text-1`, then "via Slack · #eng" at 14 in `--text-2`.
- **Draft:** a `--bg-raised` block with radius 12, padding 12 14, 15/24 `--text-1`. It is editable in place (click puts a caret in; the border appears as `--border-strong`). It is never longer than 4 lines; the overflow fades out, and a "Show all" link appears in `--text-2`.
- **Footer:** left "Edit" (`--text-2` text button); right **"Send to Lena"**, tinted teal (`--teal-tint` / `--teal-ink`).
- **States:**
  - drafting: the draft lines shimmer as they decode in
  - ready
  - sending: the button becomes the busy pill
  - sent: the button is replaced by the receipt line "Sent to Lena · now" (prefix `--text-2`, name `--text-1`), fading in
  - waiting: the footer left reads "Waiting for Lena" with shimmer and a teal 14 px spinner, and the meta shows the elapsed time "4m"
  - replied: the reply appears in the body as a quoted row with a 2 px teal left bar, the author label at 14 `--text-2`, and the text at 15 `--text-1`. The agent continues, and the card collapses to its summary.

#### c. Approval list
- This is for tool calls, commands and edits that need permission, grouped into one card per turn rather than one card per request.
- **Rows (40 high, divider `--divider` between them):**
  - a 16 px icon in `--text-3` (terminal, file-pen, globe)
  - the title at 15 in `--text-1` ("Run tests", "Edit middleware.ts")
  - on a second line, or inline, a mono 12.5 detail in `--text-3`, truncated in the middle (`npm test -- auth`)
  - on hover, inline actions at the right: "Deny" as a text button in `--text-2`, and "Allow" as a 28 high tinted pill.
- **Risky rows** (anything that deletes, pushes, deploys or spends): the title is in `--amber-ink`, a 14 px triangle-alert icon sits before the detail, and the row is excluded from "Allow all".
- **Resolved rows:** the meta slot shows the lowercase word "allowed" (`--green-ink`) or "denied" (`--text-3`), and the title goes to `--text-2`.
- **Footer:** left "3 waiting" in `--text-2` (tabular); right **"Allow 2 safe ones"** (or "Allow all" when none are risky) as the tinted button. "Deny all" is a `--text-2` text link left of the button.
- **Expiry:** if the session is running unattended, the footer left shows a countdown, "Skipping in 4m", in `--text-3`.

#### d. PR / commit graph with conflicts and checks
This is the 3.3 card applied to git. Copy it exactly from the merge-conflict demo:
- **Flow:** uncommitted → committing → pushing → open → fetching main → checking → conflicts (n) → resolving k of n → testing a of b → ready (check chips) → merging → merged (GitHub link).
- **Conflict popover:** opens on hover over the dotted "3 conflicts" link (3.18).
  - Header: "**Lena Park** changed the same lines on main".
  - Per file: "**middleware.ts** line 18", then two code lines. Each line has a 2 px left bar (theirs `#f2bd94`, yours `#a3cbf3`; dark `#985f40` / `#3c5085`), an author label at 14 `--text-2`, and mono 14 code in `--text-1`.
- **Merge:** the merged commits' dots and lines recolour from blue to violet top to bottom, and a `--violet-flash` band sweeps those rows.
- **Diffstat:** shown in the composer chips (3.7), not in the card.

#### e. Freeform / info
- **Info:**
  - Optional key-value rows: 32 high, the label at 14 in `--text-2` in a 140 px column, the value at 15 in `--text-1`, with mono for machine values.
  - Then at most one paragraph at 15/24 in `--text-1`.
  - Use it for a fact the user should see but not act on. The footer is optional; when present it holds a single "Open ↗" tinted pill.
- **Freeform input:**
  - A `--bg-raised` field, radius 12, padding 12 14, min 2 lines, auto-grow to 8.
  - Placeholder in `--text-3` that names what is wanted ("The staging URL").
  - Focus: white fill, a 1 px `--accent` border and `--accent-ring`.
  - The 28 px enter key sits at the bottom-right, as in "Something else". Enter submits; Shift+Enter adds a newline.

#### f. Checklist / progress
- **Rows:** 32 high, on the 3.3 rail, with nodes only on lane 1. The node is:
  - todo: a hollow 8 px ring at 1.5 px `--text-4`, text `--text-2`
  - active: spinner, a `--bg-row-active` band, shimmer text, the counter in the meta, and the 2 px progress line if measurable
  - done: an 8 px `--text-3` dot (green only for checks that passed), text `--text-2` in past tense
  - skipped: × and `--text-3`
  - blocked: the amber attention disc, amber text, and a reason line below at 14 `--amber-ink`
- **Header right:** "3 of 7" in `--text-2`, tabular. There is no percentage and no big bar.
- When the user can edit (in the planner), each row reveals on hover a 12 px drag handle at the far left of the gutter and a × at the right.

### 3.7 Status chips above the composer

- **Position:** left-aligned to the column, 8 above the composer.
- **Chip:** h 32, pill, `--hairline`, `--bg-card` fill, `--shadow-chip`, padding 0 12, gap 6 between chips. Text is 15: the label in `--text-1`, the value in `--text-2`.
- **Kinds, in this order:**
  1. **Goal status chip**, mirroring the current goal card. It morphs through the states: a quick action ("Create PR"), then "◌ Creating PR", then "● #128 3 conflicts" (an 8 px amber dot with halo; "#128" in `--text-1`; the state word in amber), then "◌ #128 Resolving", then "● #128 Ready to merge" (green), then "⑂ #128 Merged" (violet).
  2. **Diffstat chip** ("+482 −37"): numbers in `--diff-add` / `--diff-del` (sans, tabular, true minus sign), then five 7 × 7 squares (radius 1.5, gap 1.5) in `--sq-*`, then a 12 px chevron-down in `--text-3`. It opens a popover listing the changed files. It is removed once the goal finishes.
  3. **Context chip**: a 12 px ring gauge (1.5 px, `--text-3` arc on a `--track` ring) and "62%" in `--text-2`. It turns amber at 80 % and red at 95 %. Hover shows "124k of 200k tokens · Opus".
  4. **Quick-action chips** (empty state or idle only): at most 2 contextual actions ("Create PR", "Run tests"), with a 14 px icon in `--text-2`. Clicking one sends it as a user bubble.
- At most 4 chips. Extra ones collapse into "+2" in `--text-2`.
- Chips never wrap to a second line; they truncate the first chip's label instead.

### 3.8 Composer

- **Surface:** column width, min 116 high (one text line plus toolbar). It grows with its content to at most 40 vh, then scrolls inside. Radius 20, `--hairline`, `--bg-card`, `--shadow-composer`, padding 16.
- **Text:** 16/26 in `--text-1`. The placeholder is in `--text-3`: "Ask anything, or type / for skills". It becomes "Answer, or ask something else" while a question card is open.
- **Toolbar** (36 high controls, bottom-aligned, 12 above the bottom edge, gap 8):
  - **+** button: a 36 circle in `--bg-raised` with a 16 px plus in `--text-2`. It attaches a file, image or folder.
  - **Repo pill:** h 36, pill, `--bg-raised`, padding 0 14, a 16 px folder icon, an 8 gap, then the repo name at 15 in `--text-2`. It opens a popover of recent folders.
  - **Engine segmented control:** track h 36, `--bg-raised`, 2 px inset. The thumb is `--bg-thumb` with `--shadow-thumb`. The active segment shows icon plus label ("Claude Code") in `--text-1`; inactive segments are icon-only (16 px, `--text-2`), with the label shown on hover in a tooltip.
  - Flex spacer.
  - **Effort:** a 4-bar signal icon (bars 2.5 wide, 1.5 gap, heights 4/6/8/10; active bars `--text-1`, the rest `--text-4`) and the label ("Low", "Medium", "High", "Max") at 15 in `--text-2`. It has no fill and opens a 4-row menu.
  - **Mic:** 16 px icon in `--text-2`, 36 hit area.
  - **Send:** a 36 circle, **solid `--accent`**, with a white 16 px arrow-up (2 px stroke). It is always blue, even when the input is empty.
    - While the agent is running, it morphs into **Stop**: a 36 circle in `--bg-raised` with a 10 px `--text-1` rounded square, using `--t-fast` blur-swap.
    - Enter sends; Shift+Enter adds a newline. While the agent is running, Enter queues the message and a "Queued" chip appears above.
- **Slash and mention menu:** opens above the composer, left-aligned, width 360, radius 12, `--shadow-pop`. Rows are 40 high: a 16 px icon, the name at 15/500 and a description at 14 `--text-2`. The typed prefix shows inline ghost completion in `--text-3`. An accepted mention becomes a token (radius 6, `--accent-chip`, `--accent-ink`, 15/500).
- **Voice:** clicking the mic swaps the toolbar in place for:
  - a waveform strip (2 px bars on a 4 px pitch, `--text-2`, heights 4–24, scrolling right to left, with a 40 px fade on the left)
  - a cancel button (a 36 `--bg-raised` circle with ×)
  - a confirm button (a 36 `--accent` circle with a check)
  - Provisional text is italic in `--text-3`; confirmed text is upright in `--text-1`.
- **The composer never shows agent state.** No spinner and no "Agent is typing" ever appear inside it.

### 3.9 Side-discussion panel

A second, lightweight chat beside the session. It is for asking questions without touching the main session's context.

- **Surface:**
  - Right edge of the window, width 360 (resizable 300–520 by dragging the 4 px left edge, which shows a `--accent` 1 px line on hover).
  - Background `--bg-page`, 1 px `--divider` left border, `--z-side-panel`.
  - It opens by sliding its width from 0 (`--t-layout`, `--ease-in-out`) while the main column re-centres. On windows under 1200 px it overlays with `--shadow-pop` instead.
- **Header (48):**
  - "Side chat" at 15/500 in `--text-1`.
  - Below it, at 13 in `--text-3`: "Won't change the session". When the panel can read the session, this reads "Reads the session, won't change it".
  - Right: a 32 icon button with ×.
- **Token meter**, a row under the header with padding 0 16 and 12 below:
  - "12.4k of 200k tokens" at 13 in `--text-2`, tabular, and the model name right-aligned at 13 in `--text-3`.
  - Under it, a 2 px bar (radius 1) on `--track`, with the fill in `--text-3`.
  - The fill turns `--amber-dot` above 80 % and `--red-dot` above 95 %, and the text says why ("Near the limit; older turns will be summarised").
  - The number changes by blur-swap, never by rolling digits.
- **Thread:** padding 16, the same grammar as the main chat at a smaller scale:
  - prose 14/22, bubbles 14/20 with radius 18 and padding 8 14, gap 12, between turns 20
  - its own "Thought for 3s" disclosure at 14
  - generated components are allowed but must be compact (radius 12, padding 12)
- **Message actions**, revealed on hover under each agent message: "Send to session ↗" (a 28 high tinted pill) and Copy (a 28 icon button, `--text-2`). "Send to session" places the text in the main composer; it does not send it.
- **Compose:**
  - The box is docked at the bottom with a 12 px inset: radius 16, `--hairline`, `--bg-card`, min-h 44, padding 10 12, with a single row of textarea plus send.
  - The send button is a 28 circle in `--accent` with a 14 px arrow, and becomes Stop while running.
  - Placeholder: "Ask on the side".
- **Empty state:** the composer and one line at 14 in `--text-3`: "Questions here stay out of the session."

### 3.10 Embedded terminal tab

The raw xterm must look like a quiet document surface, not a black slab dropped into a white app.

- **Placement:** the "Terminal" segment of the session header swaps the main pane content with a 150 ms blur crossfade. The terminal is wider than the chat column: `max-width: 1104px`, side gutters 24, and it fills the height under the header with 24 below.
- **Frame:** radius 16, `--hairline`, `--bg-term`, `--shadow-card`, overflow hidden.
  - **Header strip (36):** padding 0 12 0 16, a 1 px `--divider` below. On the left, a 14 px terminal icon in `--text-3`, "Terminal" at 14/500 in `--text-1`, then the cwd in mono 12.5 `--text-3` (middle-truncated). On the right, text buttons at 14 in `--text-2`: "Interrupt" (sends Ctrl+C), "Clear", and a copy-all icon. Every control is 28 high, and hover fills `--bg-raised`.
  - **Body:** padding 12 16. Font `--font-mono` 13 px, xterm `lineHeight: 1.4`, `letterSpacing: 0`. Cursor: a 2 px bar in `--accent`, blinking at 1 s.
  - Scrollbar: 6 px, thumb `rgba(0,0,0,.15)` (dark `rgba(255,255,255,.15)`), radius 3, with no track.
  - Selection: `rgba(47,107,234,.18)`.
  - Status line, inside the strip on the right: when the process exits, it reads "Exited with code 1" (`--red-ink` for a non-zero exit) or "Exited" (`--text-2`), with "Restart" as a tinted pill.
- **xterm theme**, mapped to tokens so the ANSI output belongs to the palette:

| xterm key | Light | Dark |
|---|---|---|
| background | `#fbfbfb` | `#141414` |
| foreground | `#171717` | `#e8e8e8` |
| cursor / cursorAccent | `#2f6bea` / `#fbfbfb` | `#4880e8` / `#141414` |
| selectionBackground | `#2f6bea2e` | `#4880e84d` |
| black / brightBlack | `#171717` / `#737373` | `#3a3a3a` / `#6e6e6e` |
| red / brightRed | `#b91c1c` / `#dc2626` | `#f87171` / `#fca5a5` |
| green / brightGreen | `#15803d` / `#16a34a` | `#5fd16a` / `#86efac` |
| yellow / brightYellow | `#b45309` / `#d97706` | `#e9b04a` / `#fcd34d` |
| blue / brightBlue | `#2b54a8` / `#2f6bea` | `#8fb0f2` / `#b6c9f5` |
| magenta / brightMagenta | `#6d28d9` / `#8b5cf6` | `#b699f9` / `#d4c2fc` |
| cyan / brightCyan | `#0f8a6c` / `#0d9488` | `#8be6c5` / `#99f6e4` |
| white / brightWhite | `#a3a3a3` / `#d4d4d4` | `#d4d4d4` / `#f5f5f5` |

- Claude Code's TUI draws its own borders and colours, and the palette above keeps them legible on both themes. Do not override the agent's own UI inside the terminal.
- **Live link to chat:** when the terminal is not visible and the PTY prints a permission prompt or needs input, the session gets the amber state and an approval card (3.6c) appears in the chat. Answering it writes to the PTY.

### 3.11 Orchestrator overview (horizontal flows)

The home view when more than one session is running. Each goal is one horizontal flow, and it uses the same rail vocabulary as 3.3, rotated.

- **Surface:** one card spanning the main pane (max 1104), radius 16, hairline, with no padding around the rows.
- **Summary line** above the card, at 15 in `--text-2`: "3 running · 1 needs you · 5 done today". The counts are `--text-1`, and the "needs you" count is amber.
- **Rows:** 56 high, padding 0 16, a 1 px `--divider` between rows, hover `--bg-row-active`. Clicking a row opens the session.
  - **Title block (240 wide):** the goal title at 15/500 in `--text-1` (1 line, ellipsis); below it, at 13 in `--text-2`, "acme-webapp · Claude Code".
  - **Flow (flex 1):** a horizontal 1.5 px line in the lane colour through the vertical centre.
    - Nodes sit on a 28 px pitch with the same node vocabulary (8 px dots, 12 px spinner, 16 px discs).
    - A sub-agent branches **below** the line on an S-curve 12 px down, rejoining at a hollow ring.
    - Completed segments use the lane colour; the not-yet part is dashed in `--text-4`, ending at a dashed target circle.
    - Hovering a node shows its step label in a tooltip ("Running 36 of 42 tests · 21s").
    - The active node is always fully in view; older nodes compress into "+12" at the left in `--text-3`.
  - **Now (220 wide):** the current step at 14, shimmering if live ("Fetching main"), or the state sentence in its hue ("Needs your approval", "Merged into main").
  - **Meta (72 wide, right-aligned):** elapsed time or "3/7" at 14 in `--text-2`, tabular.
- **Sort order:** needs you, then running (most recent activity first), then done. A row that changes group moves with a FLIP height animation (`--t-layout`), not a jump.
- **Empty:** "Nothing running" at 15 in `--text-2` and a "New goal" tinted pill.

### 3.12 New-goal planner

- **Entry:** "New goal" (sidebar, `Ctrl N`) opens an empty main pane with the composer vertically centred. Above it sit at most 2 quick-action chips taken from the repo's state ("Fix the failing test in auth", "Finish #128"). There is no greeting, no logo and no suggestion grid.
- **On send:** the goal text becomes the user bubble. The disclosure shows "Planning 3s", and the planner card mounts.
- **Planner card** (a 3.6 question card with eyebrow "Plan"):
  - **Question line:** the goal restated as a title at 16/600 ("Refresh sessions in the auth middleware"). It is editable inline.
  - **Steps:** a 3.6f checklist in the editable state. Rows decode in with a 100 ms stagger as the plan streams. Each row is editable on click, can be dragged by its handle, and removed with ×. "Add a step" sits at the end in `--text-3` with a plus icon.
  - **Settings row** (16 above the footer): small pills, h 28, `--bg-raised`, 14 `--text-2`. "acme-webapp", "Claude Code", "Medium" effort, "Local", and "Ask before pushing" (a toggle pill whose on state is `--accent-chip` / `--accent-ink`).
  - **Footer:** left "Plan again" (`--text-2` text button); right **"Start"**, the tinted button.
- **On Start:** the planner card morphs into the goal card (3.3). The checklist rows become rail rows in place, the settings row collapses, and the footer becomes the now-line. It is the same box and is never replaced.

### 3.13 Toasts

Inline feedback always comes first. A toast exists only for events in a session **that is not on screen** (a background session needs you, finished, or failed).

- **Position:** bottom-right, 16 from the window edges, above the side panel. Max width 360. They stack upward with gap 8, at most 3; older ones collapse into "+2 more".
- **Surface:** radius 12, `--hairline`, `--bg-card`, `--shadow-pop`, padding 12 14, min-h 44.
- **Content:**
  - an 8 px state dot (amber, green, violet or red)
  - the event at 14 in `--text-1` ("Needs your approval")
  - the session name at 13 in `--text-2` on the second line
  - one action at the right as a text button at 14/500 in `--accent-ink` ("Open")
- **Timing:** "needs you" and "failed" stay until opened or dismissed. "Finished" auto-dismisses after 5 s, and hover pauses the timer.
- **Motion:** enter is opacity 0 → 1, blur 5 → 0, translateY 6 → 0, `--t-base` `--ease-out`. Exit is opacity only, `--t-fast`.
- There is no close button until hover (a 12 px ×, `--text-3`, top-right).

### 3.14 Empty, loading and error states

**Empty states:**
- **App with no sessions:** the centred composer only, plus one line under it at 14 in `--text-3`: "Your Claude Code sessions will show up here." The sidebar shows "No sessions yet" at 14 in `--text-3`.
- **Recent group** while transcripts are being read: hairline-only skeleton rows (32 high, a `--divider` underline, no grey blocks), which fill in with a 50 ms stagger.
- **A saved transcript:** it opens straight into its thread. Old tool calls render as collapsed one-line rows (tool icon, name at 15/500 `--text-1`, action at 15 `--text-2`, green check) and can be expanded.

**Loading states:**
- **Inside a card:** the skeleton is the real structure (header text present, rows drawn as hairline dividers, the rail drawn dashed). The spinner sits in the node, the tab or the button that is waiting.
- **Text that is not known yet:** decode it in (3.15) instead of showing a placeholder bar.
- **Waits over 10 s:** the shimmer label gains a counter or an elapsed time ("Installing dependencies 14s").
- **Never:** a centred page spinner, a full-card overlay, or "Loading…".

**Error states:** inline, in the same box that failed. Each one gives a cause sentence and one action.
- **Recoverable** (amber): "Couldn't reach Claude Code. Retrying in 4s", with a counting-down countdown and a "Retry now" text button in `--text-2`.
- **Terminal** (red, irreversible only): "Session exited with code 1" with an "Open terminal" tinted button.
- **Failed tool step:** the rail node becomes the matching disc, and the row's meta word becomes "failed" in `--red-ink`.
- **Never** use a red banner across the top, an error modal, or a toast for an error in the session on screen.

### 3.15 Shared micro-components

- **Shimmer label:**
  ```css
  background: linear-gradient(90deg, var(--c) 0 40%, var(--shine) 50%, var(--c) 60% 100%);
  background-size: 300% 100%;
  background-clip: text;
  color: transparent;
  animation: shimmer var(--t-shimmer) linear infinite;
  ```
  - `--c` is the label colour. `--shine` is `#c8c8c8` on `--text-1` light, or `#6e6e6e` on `--text-1` dark.
  - The sweep goes left to right.
  - It stops (cross-fading to the static colour) when the step settles.
- **Spinner:** an SVG 270° arc, 1.5 px stroke, round caps, in the context colour, on a `--text-4` track. Sizes are 12, 14 and 16. One turn takes `--t-spin`, linear.
- **Decode text:** used for every row title that appears while work happens and for the result labels ("Merged into main"). Random lowercase alphanumerics settle left to right at one locked character per 30 ms, capped at 500 ms total. The unresolved tail is in `--text-3`. Meta text (hash, author) fades in and does not decode. Under `prefers-reduced-motion`, use a plain fade.
- **Blur-swap:** the old content goes to opacity 0 and `blur(5px)` in 100 ms. The new content comes from opacity 0 and `blur(5px)` in 150 ms, on the same baseline. The box animates its width or height in `--t-base` if it changes.

### 3.16 Icons

- **Set:** Lucide (outline), stroke 1.5, round caps and joins. Sizes: 12 inside rows, 14 in chips, 16 in buttons and the composer, 18 at most.
- **Colour:** icons are one tier lighter than their label (a `--text-3` icon next to a `--text-2` label). An icon is coloured only when it carries state (amber triangle-alert, green check, violet git-merge).
- **No icon tiles:** no 32 px tinted circles behind icons, and no icon that only repeats the heading next to it.
- Brand marks (Claude, Codex, Grok, GitHub, Slack) are monochrome in `--text-2`. The only exception is when the brand mark is the connector speaking in a tool line, as in the db demo's Supabase mark.

### 3.17 Buttons

| Variant | Spec | Use |
|---|---|---|
| **Tinted** (default action) | h 34, pill, padding 0 16, 15/500, `--accent-tint` / `--accent-ink`; optional 16 px leading icon, gap 8; hover `--accent-tint-hover`; press `scale(.98)` over 80 ms | The one action in a card footer. Use a teal variant for teammate sends. |
| **Busy** | same box, `--bg-raised`, `--text-2`, a 14 px spinner and a gerund label ("Merging"); `aria-busy`; not clickable | Replaces the tinted button while its action runs |
| **Neutral** | same geometry, `--bg-raised` / `--text-1`; hover `--bg-hover` | Secondary actions such as "Download" and "GitHub" |
| **Text** | 14/400 `--text-2`, no fill, 28 hit height; hover goes to `--text-1` | Back, Deny, Edit, Not now |
| **Icon** | 32 (header) or 28 (rows) square hit, radius 8, 16 px icon in `--text-2`; hover `--bg-raised` | Header and toolbar utilities |
| **Solid accent** | 36 circle only | Send, and the enter key on an input that has text. There is no solid rectangular button anywhere. |

- **Width:** buttons hug their longest label (fixed width across states), so a state swap never reflows the row. There are no full-width buttons.
- **Focus:** a 2 px `--accent` outline at offset 2, shown with `:focus-visible` only.

### 3.18 Popovers and tooltips

- **Popover:**
  - Surface: radius 12, `--hairline`, `--bg-card` (opaque), `--shadow-pop`, padding 16, width 320–460.
  - Placement: it opens above its trigger with an 8 gap, left-aligned to the trigger, and flips below only when there's no room.
  - Content: a header line at 15 (the entity at 500 `--text-1`, the rest `--text-2`), then a 1 px `--divider`, then the sections.
  - Behaviour: it opens on hover after 120 ms, or on focus or click. It closes 100 ms after the pointer leaves, fading opacity only.
- **Tooltip:**
  - Surface: one line, h 30, radius 10, `--hairline`, `--bg-card`, `--shadow-pop`, padding 0 12, 8 above the target.
  - Content: the primary part at 14 in `--text-1`, 12 gap, then the secondary part (duration, shortcut) in `--text-2` ("vitest · 42 passed, 0 failed   38s").
  - Behaviour: it appears after 400 ms of hover, but instantly when moving between adjacent tooltip targets. Enter is a fade with blur 4 → 0 in `--t-fast`.

---

## 4. Motion spec

The default easing is `--ease-out` (`cubic-bezier(.2,.8,.2,1)`). Camera-like moves use `--ease-in-out`. Loops are linear. **Allowed:** opacity, blur, small translate (8 px or less), height and width, colour, stroke-dashoffset, rotation for spinners and chevrons only. **Never:** bounce or overshoot, 3D flips, scale beyond 0.98–1.02, sliding across the screen, number-roll digits.

| # | Transition | How | Duration / easing | When |
|---|---|---|---|---|
| 1 | Block enter | opacity 0→1, blur 5→0, translateY 4→0 | 220 ms, ease-out | prose paragraph, disclosure line, card mount, tool line, chip |
| 2 | Word stream | per word: opacity 0→1, blur 5→0, words in groups of 2–3 at ~30 words/s | 300 ms per word, ease-out | agent prose, side chat |
| 3 | Blur-swap (in place) | old: opacity→0, blur→5 (100 ms); new: from blur 5 (150 ms); the box tweens width or height | 250 ms total, ease-out | status labels, button morphs, chip morphs, numbers, meta words, tense changes |
| 4 | Row insert | height 0→32 (the rows below push down), then the row blurs in, its title decodes, and a flash band (`--amber-flash` for new incoming work, `--green-flash` for success) fades out 300 ms after the decode settles | open 180 ms; decode ≤500 ms; band fade 400 ms; consecutive inserts 270 ms apart | new steps, commits, approvals arriving |
| 5 | Card build | the frame and header appear first, then rows reveal bottom to top (oldest first) | stagger 50 ms per row, ≤400 ms total | goal card, history-like lists |
| 6 | Option stagger | option rows fade and blur in top to bottom | stagger 70 ms, each 220 ms | question card body, step change |
| 7 | Step advance (multi-question) | hold 600 ms after a selection; old content fades out in 100 ms; new eyebrow and question fade in; options stagger; the stepper's current bar morphs its width | ~1.1 s total, ease-out | 3.6 cards |
| 8 | Card collapse to summary | height to 40, body opacity→0 in 120 ms, summary fades in | 280 ms, ease-out | answered question cards |
| 9 | Height open / close | `height` (or `grid-template-rows: 0fr→1fr`) plus fade | 280 ms, ease-out | disclosure expand, check-chip row, "14 earlier steps", footers |
| 10 | Stack re-centre / composer glide | translateY of the stack | 280 ms, ease-in-out | thread growth while centred |
| 11 | Auto-scroll to the new item | smooth scroll | 300 ms, ease-in-out | only when the user is already at the bottom |
| 12 | Shimmer | gradient band sweeping left to right across the text | 1.4 s per loop, linear | any live gerund label, "Thinking" |
| 13 | Spinner | rotate 360° | 800 ms per turn, linear | inside nodes, buttons, chips, tabs |
| 14 | Timer and counter tick | digit blur-swap, tabular numbers | 150 ms; thinking timer 1 s, operation timer 100 ms | "Thinking 4s", "36/42", "Running 3.0s" |
| 15 | Progress line | width tween to n/m | 300 ms per update, linear | active measurable step |
| 16 | Node morph | crossfade between node shapes; discs scale 0.9→1 | 180 ms, ease-out | spinner→dot, dashed→amber→green→violet |
| 17 | Recolour cascade | dot, line and ref chip colour tweens, top to bottom, plus a band sweep (`--violet-flash`) | 200 ms each, 40 ms per row, band fades in 400 ms | merge or done |
| 18 | Popover in / out | fade + rise 4 px + blur 4→0 / opacity only | 150 ms in, 100 ms out | hover detail |
| 19 | Tooltip | fade + blur 4→0 | 150 ms | chips, nodes, icons |
| 20 | Chevron | rotate 90° (disclosure) or 180° (menu) | 150 ms, ease-out | expand and collapse |
| 21 | Segmented thumb | translateX and width of the thumb | 200 ms, ease-out | Chat/Terminal, engine, Local/Cloud |
| 22 | Panel open / close | width 0↔360 with content fade, while the main column re-centres | 280 ms, ease-in-out | side chat, sidebar |
| 23 | Tab swap (chat ↔ terminal) | blur-swap of the main pane | 150 ms out + 150 ms in | header segmented control |
| 24 | Toast | rule 1 in; opacity out | 220 ms in, 150 ms out | background-session events |
| 25 | Press | `scale(.98)` | 80 ms down, 120 ms up | buttons, option rows |
| 26 | Check draw | stroke-dashoffset on the check path | 200 ms, ease-out | done states, sent receipts |
| 27 | Reorder (overview) | FLIP translateY | 280 ms, ease-in-out | row changes group |

**Reduced motion:** under `@media (prefers-reduced-motion: reduce)`, keep opacity fades (at most 150 ms) and colour changes. Remove blur, translate, decode, shimmer (use a static `--text-2` label with an elapsed time instead) and cascades. Spinners stay, slowed to 1.5 s per turn.

**Things that never animate:** the page background, the composer's frame, a card's position (it only grows in height), and the sidebar during a turn.

---

## 5. Do / Don't

**Layout and surfaces**
- **Do:** one column, one width, one edge; one card per task, with padding 16, radius 16, a 7 % hairline and a near-invisible shadow.
- **Don't:** panels inside cards, "top cards", stat tiles, a grey inner panel holding the real content, or mixed widths (a card wider than the prose or composer).
- **Do:** dense 32 px rows with right-aligned meta and a shared hanging indent at 66.
- **Don't:** airy mobile proportions, a 230 px hero header, ticket notches, perspective, full-bleed slabs.
- **Do:** a dark mode that lifts by fill steps.
- **Don't:** a black terminal slab in a light UI, or a dark header on a white card ("the vibe-coded header").

**Type and hierarchy**
- **Do:** 13–16 px only, three greys, and 400/600 (500 on controls); dim other people's work and darken the user's.
- **Don't:** 46 px numerals, uppercase tracked labels above every value, three header tiers, or everything at 500 weight.
- **Do:** mono for hashes, branches, files and commands only.
- **Don't:** mono for numbers, labels or "techy" decoration.

**Colour**
- **Do:** colour on text, 8–16 px dots and 1.5 px lines, plus small tints on chips; one accent family for actions (a tinted pill matching the blue send).
- **Don't:** gradients, glow, purple-blue heroes, gradient app icons; black, green and grey buttons side by side; rainbow status badges.
- **Do:** amber for conflicts and blocks, red only for irreversible failure.
- **Don't:** red for a merge conflict, or stale colours left behind (an amber "!" next to "Resolved").

**Interaction**
- **Do:** let actions mutate the card in place, with the button morphing to busy at the same pixels.
- **Don't:** turn clicks into new user bubbles and new assistant turns, or log "Done: …" lines.
- **Do:** one action per state, advancing as the state does (Resolve conflicts → Merge → GitHub).
- **Don't:** two equal full-width CTAs, a confirm button after every choice, or "Tap to enlarge" opening a modal.
- **Do:** detail on hover (popovers, tooltips).
- **Don't:** modals, scrims, card flips, or dumping every chip and subtitle up front.
- **Do:** keep progress inside the component and keep the thinking row to "Thinking Ns" → "Worked for Ns".
- **Don't:** make the thinking row the progress UI once a card exists.
- **Do:** keep prose to an intro with a colon and an outcome with the cause and a number.
- **Don't:** prose that re-describes the card ("Here is a table showing…"), "Great!", or a closing list of options.

**Motion**
- **Do:** animate data arriving: open the gap, blur in, decode, flash, stagger.
- **Don't:** animate containers: flips, zooms, bouncy springs, number rolls, sliding cards.
- **Do:** use a shimmer, a counter, or a 2 px progress line for waits.
- **Don't:** big indeterminate bars, overlay spinners, grey skeleton blocks, "Sending…" with colour jumps.

**States**
- **Do:** design every intermediate state and keep counts consistent across header, row, footer and chip in the same frame.
- **Don't:** let labels and visuals disagree, or let numbers change without a visible cause ("3 commits" becoming "4 commits").
- **Do:** use real data: hashes, names, "6m", "1m 4s", the true minus sign.
- **Don't:** placeholders, "Lorem", "Feature 1", or brand theatre.

---

## 6. Microcopy rules

1. **Sentence case** everywhere, including buttons, headers, chips and menu items. No Title Case, no ALL CAPS (except literals such as `NULL`), no exclamation marks, no emoji.
2. **Tense carries state.**
   - Running: a present participle plus a concrete object ("Pushing 3 commits to origin", "Resolving conflict 2 of 3", "Running 36 of 42 tests").
   - Done: past tense with the finding ("Read 7 files about routing and auth", "Merged into main").
   - Status words: adjectives ("ready", "resolved", "passed").
3. **Meta words are lowercase** ("checking", "3 conflicts", "ready", "allowed"). Status labels that act as a heading are capitalised once ("Open", "Merged", "Needs you").
4. **Numbers:**
   - Use digits in the UI ("3 conflicts", "42 passed", "#128"), with thousands separators ("48,213").
   - Use the true minus sign in diffs ("+482 −37").
   - Write counts as "n of m" in sentences and "n/m" in meta.
   - Get the plural right ("1 conflict" vs "2 conflicts").
5. **Time:**
   - Durations are compact with no space ("5s", "38s", "1m 4s", "9.9s" with one decimal for operations, whole seconds for thinking).
   - Relative ages read "now", "6m", "2h", "Tue", then a date "Oct 22".
   - Meta parts are joined with " · ".
6. **People:**
   - "You" for the user.
   - First names in rows ("Lena"), full names in popovers ("Lena Park").
   - The agent speaks in the first person and says "we" for shared work ("main moved on while we worked").
7. **Agent prose:**
   - One idea per sentence. Name the cause, then offer the next step ("I can merge `main` in and resolve them.").
   - Write about 40 words, 60 at most.
   - Never open with "Great", "Sure" or "Certainly", and never end with a menu of options.
8. **Questions** are natural questions ("Which branch should this go on?") under a one-word noun eyebrow ("Branch"). Qualifiers are short facts ("Recommended", "Your company", "3 files"), never explanations.
9. **Buttons:**
   - A verb plus an object, in at most 3 words ("Resolve conflicts", "Send to Lena", "Allow 2 safe ones").
   - The busy label is the participle of the same verb ("Resolving").
   - A result names the entity ("Sent to Lena · now"), never "Success!".
10. **Errors** give the cause, then the action ("Couldn't reach Claude Code. Retrying in 4s"). Never "Something went wrong" or "Oops".
11. **Placeholders** teach one thing ("Ask anything, or type / for skills"), with no trailing ellipsis.
12. **Keep the user's own words.** A typed goal becomes the card title with its casing intact.
