# Phil Pitus design spec, part: "Generative UI #3: Database migration" + thread-opener "thinking process"

Sources analysed:
- `videos/03-db-migration.mp4`: 2746×2160, 60 fps, 29.0 s, light mode. A chat agent with a Supabase connector runs a 4-table migration inside a live, generated card.
- `videos/09-thread-opener.mp4`: 3840×2160, 60 fps, 19.4 s. A 2×2 grid of four separate UI demos on light grey: (TL) the **Thinking** timeline, (TR) the **composer with voice dictation**, (BL) **feature cards with isometric illustrations**, (BR) **token-usage chart card**. The thread it opens is "Here's how I use AI to create designs that don't look vibe-coded".

Frames read: all `t0xx.jpg` of both videos, plus extra native-resolution crops, 10–20 fps contact sheets and pixel sampling (ffmpeg rgb24 + node). The extras are in `frames/<video>/extra/` (`sheet_*.jpg`, `seq_*.jpg`, `shimmer*.jpg`, `c_*.png`, `full_*.png`, `thinking_final.png`, `rail_zoom.png`, `voice.png`, `chart.png`, `features.png`, `badge_null_scan.png`, `stream_text.jpg`, `toolline.jpg`).

---

## 0. Scale assumptions (read before using any number)

| Video | Native → CSS | 1600-px frame → CSS | How it was derived |
|---|---|---|---|
| 03-db-migration | ≈2.55–2.78 native px per CSS px (it varies: the recording has Screen-Studio-style **camera zoom** that changes between shots) | Steady shots t010–t016: **1 CSS px ≈ 1.61 frame px**. Shots t017–t020 and t024–t029: **1 CSS px ≈ 1.48 frame px**. Start t001–t008: ≈1.49 | I assumed **body text = 16 px Inter**. Cap height of "I"/"D" = 30–33 native px gives em ≈ 41–44 native px, and the composer then measures **41–42 em ≈ 660–680 CSS px**, i.e. a **672 px (Tailwind `max-w-2xl`) column**. Table rows come out at exactly 36 px on that scale, which supports it. |
| 09-thread-opener | Each 1920×1080 quadrant is one UI; **1 CSS px ≈ 2.1 native px** | **1 CSS px ≈ 0.875 frame px** (so frame px × 1.14 = CSS px) | The cap height of "R" is 25 native px, so 16 px text is ≈2.1×. The top-right composer is 1414 native px = 41.6 em, the same component and the same ~670 px width as in 03. |

All px values below are **CSS px at 1×**, ±1–2 px. Colours are sampled sRGB from H.264 video, so allow ±2 per channel; very light tints may be slightly washed out by compression.

---

## 1. Canvas and layout

### 1.1 Chat canvas (03)
- **Page background:** pure white `#FFFFFF`. No sidebar, no header and no chrome at all: the demo is the conversation and nothing else.
- **Single centred column ≈672 px wide** (composer outer width = column width). Everything (the user bubble, agent prose, cards and composer) shares the same left and right edges. The bubble is right-aligned to the column's right edge, and agent content is left-aligned to the column's left edge. Nothing breaks out of the column.
- **Empty state (t001–t003):** only the composer, vertically centred on the page (its centre sits ≈52% down). There is no greeting, logo, suggestions or "How can I help?".
- **After send:** the conversation sits **above** the composer and the stack stays **vertically anchored to the composer** (content grows upward and the viewport auto-scrolls), so the newest thing is always just above the input. The composer stays as the last element of the column, with ≈24–32 px gap above it (measured 28 px from the last prose line box to the composer's top edge).
- **Vertical rhythm (measured at t027):**

| From → to | Gap |
|---|---|
| User bubble bottom → tool-call line top | ~32 px |
| Tool-call line → first prose line | ~16 px |
| Prose last line → card top | 16 px |
| Card bottom → next prose paragraph | 16 px |
| Last prose → composer | ~28 px |

  The rhythm is essentially **16 px between blocks inside one agent turn and 32 px between turns**.
- Cards sit **in the prose flow** like a paragraph: full column width, no indent and no avatar gutter. The agent has **no avatar or name row**. The only "who is speaking" marker is the connector tool line (logo + "Supabase").

### 1.2 Thread-opener canvas (09)
- Four tiles on **`#EBEBEB`** (neutral light grey), separated by **white gutters ≈8 CSS px** (presentation framing for the post, not product UI).
- The Thinking timeline is left-aligned in its tile with its content block vertically centred, so as steps are added **the whole block slides up** to stay centred (smoothly, ~200 ms ease-out). In the product this means "pin to bottom / keep the active step in view".

---

## 2. Typography

### 2.1 Families
- **Sans: Inter** (or an Inter-metric clone such as "Inter Display"/SF-like). Tells: double-storey `a`, flat-topped `t`, `1` with flag, open `g`, ~0.727 em cap height, tight default tracking. Weights used: **400** (body), **500** (titles, labels, active states, bold-ish prose), **600** for the strong spans in prose (`acme-prod`, `9.9s`).
- **Mono: a modern grotesque mono (SF Mono / Geist Mono / JetBrains Mono class)**, narrow and light-grey. It is used **only for machine identifiers**: row ids (`8c1f02ab`), column types (`uuid`, `text`, `timestamptz`), timestamps (`2026-10-20 09:14`), SQL in the card footer, `NULL` badges and row numbers. Human names, emails and message bodies stay in sans.
- Numbers that change (timers, counts, stats) use **tabular figures** (`font-variant-numeric: tabular-nums`). The "Running 0.0s → 9.9s" counter never jitters horizontally.

### 2.2 Scale (03, body = 16 px)

| Role | Size / line-height | Weight | Colour | Example |
|---|---|---|---|---|
| Prose body (agent) | 16 / ~24–25 | 400 | `#1F1F1F` (darkest `#181818`) | "It's safe to run, so I'm applying it…" |
| Prose strong | 16 | 600 | `#1D1D1D` | **acme-prod**, **9.9s** |
| User bubble text | 16 / 24 | 400 | `#1F1F1F` | "Can we run this migration on" |
| Composer placeholder | 15–16 | 400 | `#A2A2A2` | "Ask anything, or type @ for connectors" |
| Tool-call line: service name | 14–15 | 500 | `#1E1E1E` | "Supabase" |
| Tool-call line: action | 14–15 | 400 | `#6F6F6F` | "Dry-ran it on acme-prod" |
| Card title | 14 | 500 | `#1E1E1E` | "add_workspaces" |
| Card subtitle / meta | 13 | 400 | `#707070` | "acme-prod · 4 tables" (middle-dot separator with spaces) |
| Card status (running) | 14 | 400 label `#6E6E6E` + 500 number `#1F1F1F` | | "Running **3.0s**" |
| Card status (done) | 14 | 500 | green `#1E805A` | "✓ Applied in 9.9s" |
| Tab label, inactive | 13–14 | 400 | `#6E6E6E` | "workspaces" |
| Tab label, active | 13–14 | 500 | `#1F1F1F` | "messages" |
| Column header name | 13 | 500 | `#6D6D6D` | "email" |
| Column header type | 11–12 mono | 400 | `#B9B9B9` | "text", "uuid" |
| Changed-column header | 13 | 500 | green `#1E805A` | "workspace_id", "created_by" |
| Cell text | 14 | 400 | `#1F1F1F` | "Ava Chen" |
| Cell secondary (email) | 14 | 400 | `#6F6F6F` | "ava@acme.co" |
| Id/hash cell | 12 mono | 400 | `#969696` | "5d2e8a10" |
| Row number | 11–12 mono, right-aligned | 400 | `#BCBCBC` | "1", "20,477" |
| Footer SQL | 13 mono | 400 | `#7C7C7C` | "alter table users add column…" (truncated with "…") |
| Footer summary | 14 | 400 | `#6F6F6F` | "48,213 messages moved in, and indexed" |
| Pill button label | 13 | 500 | green `#22815A` | "Open in Supabase ↗" |
| Composer chip label | 13–14 | 400 | `#707070`; active segment `#212121` | "acme-webapp", "Local", "Medium" |

### 2.3 Scale (09 Thinking timeline, 16 px)

| Role | Size | Weight | Colour |
|---|---|---|---|
| Header "Thinking" / "Thought for 14s" | 16 | 400 | live: shimmering `#1A1A1A`↔`#8A8A8A`; done: `#616161` |
| Header timer "4s" | 16 | 400 | `#9A9A9A` (lighter than the word) |
| Active step ("Reading 6 of 7 files") | 16 | 400 | `#1A1A1A` + shimmer band |
| Completed main step ("Read 7 files about routing and auth") | 16 | 400 | `#606060` |
| Branch / dead-end step | 16 | 400 | `#959595` |
| Final step "Finished thinking" | 16 | 500 | `#181818` |
| Final meta "4 modules to deepen · 3 steps" | 16 | 400 | `#969696` |
| Source chip label | 14–15 | 400 | `#5F5F5F` |
| "+3 more" | 14–15 | 400 | `#959595` (plain text, no chip) |

**Hierarchy is carried by colour tiers, not by size.** In the whole thinking component everything is 16 px. Only the grey value changes: active = near-black, done = 38% grey, side-branch/meta = 58% grey. This is the single most important typographic trait.

---

## 3. Colour

### 3.1 Neutrals (light)

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FFFFFF` | page (03), cards, composer, active tab, table body |
| `bg-canvas-alt` | `#EBEBEB` | page in 09 tiles |
| `fill-subtle` | `#F6F6F6` | user bubble (gradient `#F8F8F8` top → `#F6F6F6` bottom), card tab strip, composer chips, segmented-control track, "+" button (`#F7F7F7`) |
| `fill-muted` | `#F4F4F4` / `#EEEEEE` | feature card body / feature illustration well (09) |
| `fill-hover` | `#EFEFEF`–`#F0F0F0` | hovered inactive tab pill |
| `border` | `#EBEBEB`–`#EDEDED` (≈ `rgba(0,0,0,.07)`) | 1 px card and composer border |
| `divider` | `#F0F0F0`–`#F2F2F2` | table row dividers, header/tab-strip hairline `#EEEEEE` |
| `tab-divider` | `#E1E1E1` | 1 px × ~16 px vertical separators between inactive tabs |
| `text-1` | `#1A1A1A`–`#1F1F1F` | primary (never pure black in 03; pure `#000` appears only in the 09 chart/feature-card titles) |
| `text-2` | `#6E6E6E`–`#707070` | secondary: meta, tab labels, chips, emails |
| `text-2b` | `#606060` | completed thinking steps (on grey) |
| `text-3` | `#959595`–`#9C9C9C` | timers, branch steps, mono ids (`#969696`) |
| `text-4` | `#A2A2A2`–`#BCBCBC` | placeholder, column types, row numbers, inactive tab icons (`#A1A1A1`) |
| `rail` | `#CBCBCB` | timeline rail on `#EBEBEB` |
| `node` | `#B5B5B5` | completed step dot |

### 3.2 Accent and semantic

| Role | Hex | Notes |
|---|---|---|
| Primary action (send, confirm dictation, finished check) | **`#306BE7`** (sampled; ≈ Tailwind blue-600 `#2563EB`) | Solid circle. It is the **only saturated blue** on the page. |
| Mention while typing | `#4A86E8` typed part, `#A9C6F0` ghost autocomplete | "@Supa" + "base" |
| Mention token in composer | bg `#F1F5FC`, text `#6088C0`, plus a brand icon | |
| Supabase brand mark | green gradient `#3ECF8E`→`#249361` | bolt logo |
| Success text and icons | **`#1E7D5B`–`#1E805A`** (darkest `#177D5B`) | ✓, "Applied in 9.9s", changed-column headers, "Data" badge text, "Open in Supabase" |
| Success tint (fills) | `#EEFAF1` pill button bg; `#E5F1E9` mention chip in bubble; `#F7FCF8` changed-column tint; `#E9FAEE` row just inserted/updated | |
| Scan line | core `#64D797` (2 px), glow `#E6F9EE` → `#F7FCF8` over ~20 px above it | |
| Spinner arc (in a table tab) | `#3ECF8E`-ish green arc on `#E6E6E6` track | |
| Spinner arc (header "Running") | `#9A9A9A` arc on `#E3E3E3` track | neutral, not green |
| Entity dots (categorical) | acme `#4A8BF0` blue, globex `#E1950F` amber, initech `#9058F0` violet | 6 px dots before the workspace name |
| Chart series 2 | `#3B6FD8` line + `rgba(59,111,216,.12)` fill | "Cached" |
| Chart series 1 | `#B7B7B7` line + `#F5F5F5` fill | "Tokens" |
| TS file badge | `#6394A4` (muted teal) | "TS" glyph in chips; React atom icon in the same colour |

There is **no red/orange "danger" colour in either video**. A failed path (the dead end) is shown by **dimming and a × glyph in grey**, not by red. Warnings are never shouted.

### 3.3 Dark mode
Not shown in these two videos (see `06-merge-dark`).

---

## 4. Surfaces

### 4.1 Card (the generated component), from 03
- **Shape:** radius **≈20 px**, 1 px border `#EBEBEB`, background white.
- **Shadow:** barely there: `0 2px 12px rgba(0,0,0,.025), 0 1px 2px rgba(0,0,0,.02)`. Measured, it extends ~12 px below at `#FBFBFB`→`#FDFDFD`. It reads as "lifted 1 mm", never as floating.
- **Overflow hidden.** The tab strip and table run edge to edge inside the border, with no inner margin.
- **Anatomy, top to bottom:**
  1. **Header**, 68 px tall, padding 16 px (left) / 18–20 px (right).
     - **Icon tile:** 36×36, radius 10, white, 1 px `#EDEDED` border, soft 1 px shadow, connector logo 20 px centred.
     - **Gap 12 px**, then the **title stack**: title 14/20 medium + subtitle 13/18 grey, 2 lines.
     - **Status**, right-aligned and vertically centred: spinner 14 px + 6 px gap + "Running" grey + **tabular number** dark. When done it becomes "✓ Applied in 9.9s" all green medium.
  2. **Tab strip**, 44 px, bg `#F6F6F6`, 1 px hairline `#EEEEEE` on top.
     - **Tabs** 36 px tall (the strip has ~8 px top padding), padding-x 14 px, radius 10 px top-only.
     - **Active tab** is **white and merges into the white table below** (a "folder tab" with small inverse/flared corners at its bottom outside edges, like Chrome tabs).
     - **Inactive tabs** are transparent, with 1 px `#E1E1E1` vertical separators (~16 px tall) between adjacent inactive tabs. The separator disappears next to the active or hovered tab.
     - **Each tab:** table icon 16 px (inactive `#A1A1A1`, active `#1F1F1F`), 8 px gap, label, 8 px gap, state glyph (spinner 14 px or ✓ green 12 px).
  3. **Table**: header row 36–38 px, then body rows **36 px**, 1 px `#F0F0F0` dividers. The viewport shows exactly **5 rows** (≈180 px), with a top and bottom **fade mask** (~16 px) when scrolling.
     - **Columns:** row-number gutter (right-aligned, ~32 px) → mono id (~110 px) → sans columns sized to content (~160–250 px) → changed column (~140 px) → empty remainder.
     - **The primary key header** has a small key icon (12 px, `#ADADAD`).
     - **Foreign/changed columns** have a 12 px link icon in green. Once the column is indexed, the icon becomes ⚡ (a bolt), in green.
  4. **Footer**, 60 px, padding 16 px, white with no top border (it's separated by the table's last divider/whitespace).
     - **While running:** a **badge** ("Schema": bg `#F2F2F2`, text `#4A4A4A`; or "Data": bg `#E8F6EC`, text `#1E805A`; 13 px medium, padding 2×8, radius 6) + 12 px gap + **mono SQL** single line, ellipsised with "…".
     - **When done:** "✓" green + summary sentence in grey on the left; on the right a **pill button** "Open in Supabase ↗" (height 28–30, padding-x 14, radius 999, bg `#EEFAF1`, text green 13 medium, arrow 12 px).

### 4.2 User bubble
- Right-aligned, max width ≈ 75% of the column, **height 44 (1 line)**, padding 10 × 16, **radius ≈22 (pill)**.
- bg `#F6F6F6` with a faint top-to-bottom lightness gradient (`#F8F8F8` → `#F6F6F6`) and an extremely soft shadow edge. **No border.**
- An inline **mention** inside the bubble renders as a **green text chip**: bg `#E5F1E9`, text `#188257` medium, radius 6, padding 2×6. (In the composer the token is blue-tinted with the logo; once sent it becomes a green, logo-less tag.)

### 4.3 Composer
- Width = column (≈672); height ≈124 (1 text line + toolbar). Radius **≈24**, 1 px `#EBEBEB` border, white.
- **Shadow** slightly stronger than a card's (≈ `0 4px 20px rgba(0,0,0,.03)`); measured it extends ~17 px below.
- **Padding 16.** The text area starts at the top-left inset (placeholder baseline ~27 px from the top edge). The toolbar is 36 px tall, pinned to the bottom with a 16 px inset.
- **Toolbar, left to right:**
  - **"+"** 36×36 circle, `#F7F7F7`, icon `#6E6E6E` 18 px.
  - Then a **6–8 px gap** and the **project chip** "📁 acme-webapp": 36 px tall pill, padding-x 14, bg `#F6F6F6`, icon 18 px outline, label `#707070`.
  - Then the **segmented control** "💻 Local | ☁": a 36 px pill track `#F6F6F6` with 3 px inner padding. The active segment is a **white pill** (subtle 1 px shadow) with a dark label. The inactive segment is icon-only and grey.
  - (flex spacer)
  - **Effort selector**: a 4-bar **signal icon** (bars 2 px wide, rising heights 4/6/8/10 px; first two bars `#1F1F1F`, last two `#CFCFCF` = "Medium") + label "Medium" `#6F6F6F`. There is no chip background, so it's text-button style.
  - **Mic** icon button (18 px outline, `#6E6E6E`, 36 px hit area, no fill).
  - **Send**: **36×36 solid blue circle `#306BE7`** with a white 18 px up-arrow (2 px stroke).
- The send button is **always blue**, even when the input is empty. No disabled grey state is shown.

### 4.4 Mention popover (03, t004)
- It appears **directly above the composer**, left-aligned with it, width ≈ 55% of the composer, radius ≈16, bg `#FBFBFB`, 1 px border `#EDEDED`, soft shadow.
- **Single item:** brand icon 20 px + name 16 medium dark; next line description 14 `#6F6F6F` ("Databases, auth and storage"). Padding 16.
- **The composer's text shows inline ghost-completion:** typed "@Supa" in blue, the remaining "base" in pale blue.
- On accept, the text becomes a **token** (logo + "Supabase", light blue bg, radius 6).

### 4.5 Thinking timeline (09): no surface at all
It sits directly on the canvas. There's no card, border or background. Only the source chips have surfaces: **height 30, radius 999, bg `#FFFFFF`**, no visible border (or a hairline at best), padding-x 12, 8 px gap between chips. Each chip has an 14 px icon (TS badge / React atom / globe), a 6 px gap and a label.

### 4.6 Other 09 surfaces
- **Voice composer:** the same composer shell (radius 24 → here ~20, white, on grey). See 5.10.
- **Chart card:** white, radius ≈10, border none or hairline, shadow `0 1px 3px rgba(0,0,0,.06)`, padding 20–24.
  - **Tooltip:** white, radius 10, 1 px `#E8E8E8`, shadow `0 4px 12px rgba(0,0,0,.06)`, padding 10×12.
- **Feature cards:** radius ≈8, bg `#F4F4F4`, 1 px `#E6E6E6`, shadow `0 1px 2px rgba(0,0,0,.05)`.
  - **Illustration well** (`#EEEEEE`): the top 70% of the card, flush.
  - **Text block** below: padding 20; title 14 medium `#000`; 2-line body 13 `#5A5A5A`.

### 4.7 Icons
- **Style:** Lucide/Phosphor-like **outline, 1.5 px stroke, rounded caps**, 16–18 px. Inside the table they're smaller (12–14 px) and lighter grey.
- **Colour:** icons are always one step *lighter* than the text they accompany (e.g. a `#A1A1A1` tab icon next to a `#6E6E6E` label).
- **Checks:** a bare ✓ glyph (1.75 px stroke) in green, with **no circle** in 03. In 09 the final step uses a **filled blue circle 18 px with a white check**.
- **Brand logos:** used only for the connector (Supabase bolt) and for file types (TS, React).

---

## 5. Components (anatomy and states)

### 5.1 Connector tool-call line ("Supabase · Reading acme-prod's schema")
- **Row:** 20 px brand logo, 8 px gap, service name (medium, dark), 8 px gap, action phrase (grey).
- **States:**
  1. **Running:** a present-progressive phrase ("Reading acme-prod's schema") with a **shimmer sweep** over the grey text. No spinner.
  2. **Done:** a past-tense, result-bearing phrase ("Dry-ran it on acme-prod") + a green ✓ 12 px after the text. The swap is a blur crossfade (~150–200 ms).
- It is a single line with no box and no expand chevron.

### 5.2 Streaming prose
- Text arrives in **word chunks, ~25–30 words/s**. The last 4–6 words form a **"blur tail"**: each new word enters at opacity 0 + `blur(4–6px)` and resolves to crisp over **~350–400 ms**, so the leading edge looks like ink settling.
- Strong spans (**acme-prod**) stream in already bold.
- The sentence that introduces a card ends with a **colon** ("…one table at a time:"). The card then appears **~150–250 ms after** the last word.

### 5.3 Migration card: the full state machine
1. **Mount, skeleton (t009):**
   - The card fades in (opacity 0 → 1, slight blur → 0, ~250 ms), already at full height.
   - The header shows title + subtitle and "Running 0.0s". The first tab appears with a spinner.
   - The table area shows **5 empty rows, drawn only as hairline dividers** (a ghost grid, no grey shimmer blocks). The footer shows the "Schema" badge + SQL.
   - The viewport scrolls up smoothly so the whole card is visible.
2. **Columns appear (≈+0.7 s):** header cells fade/blur in **left to right with ~60 ms stagger** (key icon + "id uuid", "name text", "created_at timestamptz").
3. **Rows insert:**
   - Each new row slides/fades in with a **green row highlight `#E9FAEE`** that decays to white over ~400–600 ms.
   - Within the row, the id and timestamp appear first; the categorical cell (dot + "acme") pops ~100 ms later.
   - The footer badge crossfades "Schema" → "Data" and swaps its SQL (blur crossfade ~200 ms).
4. **Tab complete:**
   - The spinner morphs to a green ✓.
   - The tab becomes inactive (bg out, text grey, icon grey), and a separator appears.
   - The **next tab slides in from the right** (opacity + 8 px x-offset, ~250 ms) as the new white active tab with its spinner. The table body crossfades to the new table.
5. **Schema change on a populated table (users, projects, messages):**
   - **Add column:** a new column materialises on the right with a **green header (link icon + name)**, a full-height **green tint `#F7FCF8`** and 1 px green-tinted vertical borders. Every cell shows a **dashed `NULL` badge**: mono 11 px, `#C4C4C4` text, 1 px dashed `#D7D9D6`, radius 6, padding 2×6.
   - **Rename column:** the header text is replaced in green ("owner" → "created_by") with a link icon.
6. **Backfill:**
   - A **scan line** (2 px `#64D797`, fading in from the left ~20% of its width) **sweeps downward through the rows**, about **one row per ~120–150 ms**. It drags a ~20 px green glow gradient behind (above) it.
   - Each `NULL` the line passes is replaced by "● name" (dot colour per workspace), fading in over ~200 ms.
   - For large tables the body **auto-scrolls quickly** through the data. The row numbers become 5–6 digit with thousands separators ("20,477", "48,209"), the row-number gutter widens, and the top/bottom of the viewport are **feathered** with a fade mask.
   - The footer shows "Data" + `update … set workspace_id = …`.
7. **Index:** the footer shows "Schema" + `create index concurrently on messages (workspace_id)`. When done, the column header icon changes link → ⚡.
8. **Done:**
   - The header status morphs "◌ Running 9.9s" → "✓ Applied in 9.9s" (the colour shifts to green; a blur crossfade, ~200 ms, on the same baseline).
   - The footer morphs to "✓ 48,213 messages moved in, and indexed" + the "Open in Supabase ↗" pill.
   - All tabs show ✓, and **the last table stays selected**.
9. **Post-completion follow-up prose** streams below the card: "Done in **9.9s**. Every user, project and message now belongs to a workspace."
10. **Interactive afterwards:**
    - **Tabs are clickable.** Hover shows a `#EFEFEF` rounded pill behind the inactive tab plus a pointer cursor.
    - **Click:** the table body crossfades (blur-out/in ~200 ms), the rows of the new table **re-play a brief green reveal tint**, and the **footer summary changes per table**:
      - workspaces → "New table, with a workspace for each organisation"
      - users → "1,284 users, each in their workspace"
      - projects → "312 projects moved in; owner is now created_by"
      - messages → "48,213 messages moved in, and indexed"
    - Each summary has its own ✓ and the same "Open in Supabase" button.

### 5.4 Spinners
- **Ring spinner** (card header, tabs): 14 px, 2 px stroke, track `#E6E6E6`, a 90°–120° arc (grey in the header, green in tabs), rotating **~0.8 s per turn**, linear.
- **Orbit spinner** (Thinking timeline, active step): the step's own icon (magnifier, or a filled 8 px dark dot) **stays still**, and a **thin (1.5 px) open arc, ~240° of a 22 px circle, rotates around it** (~0.7–0.9 s per turn). When the step completes the arc vanishes and the icon greys out (the dot becomes the 8 px `#B5B5B5` node). Branch steps use a smaller version (6 px dot, 16 px arc).
- A **hollow arc spinner without a centre** ("Merging the test results", t011) is used for merge steps. It resolves to a hollow **ring node** (12 px, 1.5 px stroke `#A0A0A0`).

### 5.5 Thinking timeline ("Thinking 4s" → "Thought for 14s"): commit-graph rail

**Geometry (CSS px):**
- **Rail column:** 24 px wide. The rail is 1.5–2 px `#CBCBCB`, centred under the header chevron.
- **Text column** starts **38 px** right of the rail centre.
- **Step pitch 40 px** (16/24 text + 16 gap). A chip row adds 38 px (30 chip + 8 gap).

**Header:**
- A chevron-down 14 px `#959595` in the rail column, then "Thinking" + timer (integer seconds, `#9A9A9A`, 8 px gap).
- While live, the word "Thinking" **shimmers**.
- When done the header becomes "Thought for 14s" in `#616161`, with no shimmer and the timer folded into the sentence.

**Node vocabulary (meaning is encoded by node shape):**

| Node | Size | Meaning |
|---|---|---|
| Tool icon (magnifier) | 14 px `#656565` | a tool step (search). The rail starts below it. |
| Solid dot `#B5B5B5` | 8 px | completed main-line step |
| Orbit spinner around an icon or dot | 22 px | active step |
| Branch lane dot (lighter, `#CFCFCF`) | 6 px | a side-exploration step, offset **+22 px** right on a second lane |
| × glyph `#C3C3C3` | 10 px | **dead end**. Its branch connector is **dashed**. |
| Hollow ring | 12 px | **merge point**: the solid side-branch curves back into the main rail here |
| Blue filled circle + white check | 18 px | finished |

**Branch drawing:**
- The side lane leaves the main rail with a **smooth S-curve** (radius ~12 px) from just below the parent node, runs parallel 22 px to the right, then either:
  - **Dead end:** the dashed curve terminates at the ×.
  - **Merge:** the curve returns into the main rail at the hollow ring ("Merged the test results").
- **Branch step text is NOT indented.** Only the node moves to the second lane, so the text stays left-aligned (clean scanning). Branch text is one grey tier lighter (`#959595`).

**Source chips under a tool step:** max 4 visible ("router.ts", "auth.ts", "Button.tsx", "Routing – Next.js docs"), then "+3 more" as plain grey text.

**Live label rewriting:**
- An active step is phrased as a **gerund with a live counter**: "Reading **1** of 7 files" → "Reading **7** of 7 files" (the digit increments every ~200–300 ms).
- On completion it is **rewritten as a past-tense summary that states the finding**: "Read 7 files about routing and auth", "Mapped 12 module dependencies", "Ran 42 auth tests", "4 tests touch session.ts", "Found 4 shallow modules", "Drafted a 3-step refactor plan".
- Dead ends state the reason: "Dead end: middleware can't read the request body".

**Final row:** "**Finished thinking**" (medium, near-black) + a lighter inline result summary "4 modules to deepen · 3 steps".

**Collapsible** via the header chevron. Expanded is shown throughout.

### 5.6 Table cells and badges
- **Categorical cell:** 6 px dot + 8 px gap + label (14 px dark).
- **NULL badge:** dashed outline mono (see 5.3).
- **Code badges in the footer:** "Schema" (neutral) and "Data" (green). These are the only filled tags inside the card.

### 5.7 Pill button (secondary action inside a card)
- Height 28–30, radius 999, tinted bg of the semantic colour (`#EEFAF1`) and text in the same hue (`#22815A`, 13 medium), with a trailing ↗ (external) arrow. **No border, no shadow.**
- Hover (inferred): bg one step darker (`#E3F5E9`).

### 5.8 Composer chips / segmented control / effort selector
See 4.3. All controls are **36 px** tall and **fully rounded**; the circle buttons are 36×36. A consistent control height is a big part of the calm look.

### 5.9 Mention popover + token
See 4.4.

### 5.10 Voice dictation composer (09, TR)
1. Clicking the mic **swaps the toolbar in place**. The chips are replaced by a **live waveform strip** + **cancel** (36 px `#EFEFEF` circle, × `#6E6E6E`) + **confirm** (36 px blue circle, white ✓).
2. **Waveform:** vertical bars **2 px wide on a 4 px pitch**, `#6E6E6E`, heights 4–24 px by amplitude; silence is a **dotted baseline** (1 px dots on a 4 px pitch, `#C8C8C8`). The strip **scrolls right-to-left** (newest at the right, by the buttons), and its **left edge fades out** (~40 px mask).
3. **Text area:** "Listening…" placeholder with a caret. The transcription streams in **italic, `#9A9A9A`** (provisional) and wraps the composer to 2 lines (height grows smoothly).
4. **On confirm:** the text turns **upright `#1F1F1F`** (now committed) and the normal toolbar returns. The send button then sends.

### 5.11 Token-usage chart card (09, BR)
- **Header:** title "Token usage" 15–16 medium `#000`, then a sentence subtitle 13 `#5E5E5E` that **includes the live range** ("See your token usage from 27 Jun - 22 September.").
- **Chart:**
  - **Step-line** (`curveStepAfter`) series "Tokens": 1.5 px `#B7B7B7` stroke with a `#F5F5F5` area.
  - Series "Cached": 1.5 px `#3B6FD8` stroke with a light blue area.
  - No axes, no gridlines, no y labels.
- **Hover:**
  - A 1 px vertical crosshair `#D0D0D0` and hollow 6 px ring markers on each series.
  - Tooltip: date (`#9A9A9A`, 12 px) + a legend row per series (8 px rounded-square swatch outlined in the series colour, label `#5F5F5F`, value right-aligned dark tabular), with "—" for a missing value.
  - **The data right of the cursor fades to ~35% opacity** and the subtitle's end date updates to the hovered date.
- **Stats row:** 3 equal columns. Each has a label 12–13 `#959595` and a value 18 medium `#121212` (tabular): "Total usage 439.19 M", "Avg. daily spend 511.2 K", "Est. cost $1,543.86".
- **The stats are cumulative up to the hovered date** and **update live as the cursor moves**. The hover scrubs the whole card.
- **Mount:** the line draws left-to-right from a single hollow point at the left baseline (t001/t011 show only "o" at the start). The stats count up from the first value ("107.52 M", "24.4 K", "$0.00") to the totals.

### 5.12 Feature cards with isometric illustrations (09, BL)
- **A horizontal carousel of cards**, ~290 px wide, gap ~16. It scrolls horizontally with snap; the active card is scaled ~1.05 and its shadow is stronger.
- **Illustrations** are monochrome isometric line art (1 px `#BDBDBD` lines on `#EEEEEE`, white faces) with a **single blue accent element that animates**. Examples: a blue path drawing along a circuit trace ("Thinks in branches"), a blue cable lighting up ("Local or remote"), a blue slider knob travelling along a track with a gauge needle moving ("Effort you can dial").
- **Copy:** title 14 medium (3 words) + 2 short sentences in grey.

---

## 6. Motion

General character: **fast, short, ease-out, blur-assisted**. Nothing bounces. Nothing scales more than ~2–5%. State changes **morph in place** (the same box and baseline, with the content crossfading through a blur), so the layout never jumps.

| What | How | Duration / easing (est.) |
|---|---|---|
| Any new block enters (tool line, step row, prose word, card, column header, footer badge) | opacity 0→1 + `filter: blur(6px)`→0 + `translateY(4–6px)`→0 | 200–300 ms, `cubic-bezier(.2,.8,.2,1)` (ease-out) |
| Text/value swap in place (present → past tense, Schema → Data, Running → Applied, step rewrite) | crossfade with blur: old blurs out + fades (120 ms) while new blurs in (180 ms); same baseline | ~200 ms total |
| Streaming prose | word-level blur-in tail; ~25–30 words/s; each word resolves over ~350 ms | |
| Shimmer on live labels ("Thinking", active step, connector action) | `background-clip:text` linear gradient: base = the label colour, a **lighter band ~60–80 px wide** (light: `#C8C8C8` on `#6F6F6F` text; on grey: `#9A9A9A` on `#1A1A1A`), sweeping **left→right** | one sweep ≈0.6 s across ~360 px, repeating every ≈1.0–1.4 s, linear |
| Spinners | rotate 360° linear | 0.7–0.9 s/turn |
| Timers | "Running 0.0s" updates every 100 ms (1 decimal); "Thinking Ns" every 1 s (integer); tabular nums so there's no jitter | |
| Counters inside labels | "Reading 1 of 7" increments every ~200–300 ms; the digit swaps without motion | |
| Row insert | fade/slide 4 px + green row tint fades out | tint decay 400–600 ms |
| Header columns appear | staggered fade/blur, left→right | ~60 ms stagger |
| Tab added | slides in from +8 px x, fades in; the previous tab's bg animates white → transparent | ~250 ms |
| Scan line | translateY across rows, constant speed; trailing glow | ~120–150 ms per row |
| Data scrolling through 48k rows | smooth auto-scroll at high speed; feathered top/bottom masks | |
| Card mount | fade + blur in, full height immediately (skeleton ghost-grid rows), page auto-scrolls to keep the card in view | ~250 ms |
| Page auto-scroll as content grows | smooth, ease-out | ~250–300 ms |
| Composer → bubble on send | the message leaves the composer and the bubble appears above (blur/fade); the composer resets to the placeholder | ~250 ms |
| Mention popover | fades/rises 4 px above the composer | ~150 ms |
| Branch connector | the line/curve draws (stroke-dashoffset) from the parent node to the new node as the step appears; the rail extends downward to the next node | ~200–300 ms |
| Finished check | scales 0.8→1 and fades in (appears pale first, then full blue) | ~200 ms |
| Chart scrub | stats update instantly per hovered point; the tooltip follows the cursor with a slight lag; the right side dims | |
| Voice waveform | bars scroll at a constant speed; heights follow amplitude | 60 fps |
| Illustrations | slow looping path draw / knob travel | 1.5–3 s loops, ease-in-out |

Stagger is used sparingly: column headers, the reveal of chips one by one (in t012 the chips appear left→right ~80 ms apart), and step rows. Everything else happens at once.

---

## 7. Interaction patterns

1. **Prose frames the component.** The order is one sentence that says *what is about to happen and why it's safe* ("It's safe to run, so I'm applying it to **acme-prod** now. It moves everything into workspaces, one table at a time:"), then the live component, then one sentence with the *outcome and the number* ("Done in **9.9s**. Every user, project and message now belongs to a workspace."). The card carries the detail, so the prose never repeats it.
2. **Show work as it happens, then let it settle into a record.** The same card is the progress UI, the result and an explorable artefact (clickable tabs with per-table summaries). There's no separate "results" message.
3. **Progressive disclosure:**
   - Tool calls collapse to one line with a ✓.
   - The Thinking timeline is collapsible under a one-line header that ends as "Thought for 14s".
   - Long SQL is ellipsised to one line.
   - Sources are 4 chips + "+3 more".
   - The table is 5 rows tall.
4. **Status is always explicit and numeric:** "Running 3.0s", "Reading 6 of 7 files", "Thinking 4s", "Applied in 9.9s", "48,213 messages". Waiting feels short because something always visibly counts.
5. **Loading states are structural, not generic.**
   - **The skeleton is the real table grid**, empty, with hairline rows. There are no grey shimmer bars.
   - **Spinners live inside the thing that's loading** (a tab, a step icon), never as page-level overlays.
6. **Hover reveals:** tab hover pill; a chart hover that scrubs the whole card; a pointer cursor only on actionable things.
7. **Failure/side paths are first-class but quiet.** The dead end is shown, dimmed, with a reason, and the branch merges back. That builds trust without alarm colours.
8. **Composer as a control surface.** Context (project), environment (Local/Cloud), effort (Low/Medium/Max signal bars), voice and send all live in one row. Mentions route the request to a connector, and the connector then "speaks" in the transcript with its logo.
9. **Empty state** = just the composer, centred. **Error state** isn't shown, but by extension it would follow the dead-end pattern: grey ×, a reason sentence, no red banner.

---

## 8. Microcopy

- **Sentence case everywhere** ("Open in Supabase", "Finished thinking", "Token usage"). No Title Case and no ALL CAPS, except `NULL` (a literal) and code.
- **Very short, concrete, result-bearing.** Labels state *what was found*, not *what was done*: "Mapped 12 module dependencies", "4 tests touch session.ts", "Dead end: middleware can't read the request body".
- **Tense carries state.** Present progressive while running ("Reading acme-prod's schema", "Checking if middleware can handle the session", "Merging the test results"); simple past when done ("Dry-ran it on acme-prod", "Merged the test results").
- **Human verbs for technical work:** "moves everything into workspaces", "each in their workspace", "owner is now created_by".
- **Numbers:**
  - Digits always, never spelled out ("4 tables", "3 steps", "12 module dependencies").
  - **Thousands separators** ("48,213", "1,284", "20,477").
  - **Durations as compact seconds with one decimal for operations** ("0.5s", "9.9s") and **integer seconds for thinking** ("4s", "14s"), with no space between number and unit.
  - Large metrics are abbreviated with a space before the unit ("439.19 M", "511.2 K"); money is "$1,543.86".
  - Dates are short ("27 Jun", "Tue 22 Sept", ISO "2026-10-20 09:14" inside data).
- **Separators:** a middle dot with spaces (" · ") for metadata ("acme-prod · 4 tables", "4 modules to deepen · 3 steps"); an en dash in titles ("Routing – Next.js docs").
- **Tone:** calm, first person, confident, no hedging, no emoji, no exclamation marks ("It's safe to run, so I'm applying it…").
- **British spelling** appears ("organisation", "Help centre").

---

## 9. What makes it feel clean (and what "vibe-coded" looks like)

**Clean, because:**
1. **One column, one alignment edge, one gap scale (8/16/32).** Every block in an agent turn is 16 px apart, and every control is 36 px tall.
2. **Hierarchy by grey tier, not by size.** Primary text sits at ~#1F1F1F, secondary at ~#6F6F6F, tertiary at ~#9A9A9A and quaternary at ~#BBBBBB. Sizes only step 16 → 14 → 13 → 12.
3. **Colour is semantic and rationed.** Blue appears only on the primary action and on the "finished" check. Green appears only for "this changed / succeeded" (Supabase context). Categorical colours are confined to 6 px dots. There are no gradients on UI chrome (the only gradients are functional: the scan glow, shimmer and fade masks).
4. **Surfaces are almost flat.** Borders are 1 px at ~7% black and shadows at ~2–3% black. Tints signal state (a green column = changed), not decoration.
5. **Mono only where the content is machine data**, and it's set lighter and smaller than the human data next to it.
6. **States morph in place** with short blur crossfades. Nothing jumps, flips or bounces, and layout height is reserved in advance (skeleton grid).
7. **Every waiting moment shows real, specific progress** (timers, counters, the scan line, gerund labels), and the summary rewrites itself into a past-tense finding.
8. **Edge cases are designed:** 5-digit row numbers widen the gutter, long SQL truncates, extra sources become "+3 more", dead ends get their own glyph and connector style, and data with NULLs is visibly NULL until backfilled.
9. **Copy is part of the design:** short, numeric, sentence case, with tense encoding state.

**"Vibe-coded" anti-patterns these designs avoid** (from his thread, `pitus-method.md`, and the contrast with these clips; see the `10-opus-high` and `11-opus-medium` analyses for concrete negatives):
- Spacing "all over the place": mixed gaps of 12/20/24 within one block, controls of different heights.
- Gradients on headers, buttons and cards; purple-blue hero gradients.
- "Everything the same size": no grey tiers, bold everywhere, big headers on small cards.
- Generic grey shimmer skeleton bars instead of the real structure; page-level spinners; "Loading…".
- Over-wide or over-tall buttons, flip/rotate animations, bouncy springs.
- Status shown only with colour (red/green badges) instead of words + numbers.
- Repeating the component's content in the prose ("Here is a table showing…").

---

## 10. Reproduction tokens (starting point)

```css
:root{
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono","SF Mono",ui-monospace,monospace;
  --bg:#FFFFFF; --bg-alt:#EBEBEB; --fill:#F6F6F6; --fill-hover:#EFEFEF;
  --border:#EBEBEB; --divider:#F0F0F0; --tab-sep:#E1E1E1;
  --text-1:#1F1F1F; --text-2:#6F6F6F; --text-2b:#606060; --text-3:#9A9A9A; --text-4:#BBBBBB;
  --accent:#306BE7; --success:#1E805A; --success-bg:#EEFAF1; --success-tint:#F7FCF8; --success-row:#E9FAEE;
  --scan:#64D797; --mention-bg:#F1F5FC; --mention-tx:#4A86E8;
  --dot-blue:#4A8BF0; --dot-amber:#E1950F; --dot-violet:#9058F0;
  --rail:#CBCBCB; --node:#B5B5B5;
  --r-card:20px; --r-composer:24px; --r-tile:10px; --r-badge:6px; --r-pill:999px;
  --shadow-card:0 1px 2px rgba(0,0,0,.02),0 2px 12px rgba(0,0,0,.025);
  --shadow-composer:0 4px 20px rgba(0,0,0,.03);
  --control-h:36px; --row-h:36px; --step-pitch:40px; --col-w:672px;
  --ease-out:cubic-bezier(.2,.8,.2,1); --t-fast:150ms; --t-base:220ms; --t-slow:400ms;
}
.enter{animation:enter var(--t-base) var(--ease-out) both}
@keyframes enter{from{opacity:0;filter:blur(6px);transform:translateY(5px)}to{opacity:1;filter:none;transform:none}}
.shimmer{background:linear-gradient(90deg,currentColor 0 40%,rgba(255,255,255,.6) 50%,currentColor 60% 100%);
  background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:shimmer 1.2s linear infinite} /* tune the band colour per surface: lighter band over dark text */
@keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}
```

(When using `.shimmer`, apply the base colour via a CSS variable instead of `currentColor` with transparent text: e.g. `--c:#1A1A1A; background-image:linear-gradient(90deg,var(--c) 40%,#9A9A9A 50%,var(--c) 60%)`.)
