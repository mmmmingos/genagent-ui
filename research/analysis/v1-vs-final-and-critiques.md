# Pitus: Claude's v1 against his final merge-conflict card, and the Opus outputs he rejected

Videos covered: `07-merge-claude-v1` (Claude's one-shot draft), `02-merge-conflicts` (his final), `10-opus-high` (he rated it 2/5), `11-opus-medium` (he rated it 1/5).
Method: I read every 1 s frame and the scene frames. I extracted full-resolution stills and contact sheets into each video's `extra/` folder: `full_*.png` stills, a 15 fps strip (`sheet_rowinsert.png`) and crops. Colours were sampled from the native-resolution PNGs with the small node tools in `frames/02-merge-conflicts/extra/` (`sample.cjs`, `core.cjs`, `line.cjs`, `prof.cjs`).

---

## 0. Scale assumptions (read this before using any number)

The videos are retina screen recordings that Screen Studio zooms in and out. Pixel sizes are only comparable within the neutral (un-zoomed) shots.

| Video | Native | Frame scale in `frames/` | Neutral shots | Calibration |
|---|---|---|---|---|
| 02 final | 2808×2160 | 1600/2808 = 0.570 | t002–t003, t009–t010, t015–t016, t020, t028–t030 | The column is 787 frame px = 1381 native px. I assume a **672 px column** (Tailwind `max-w-2xl`). That gives **1 CSS px ≈ 2.06 native px ≈ 1.17 frame px**, and it makes the send button exactly 36 px, the body text 15 px and the rows 32 px, all round numbers. |
| 07 v1 | 2440×2160 | 0.656 | t002, t009, t015–t017, t019, t025 | The column is 860 frame px. With the same 672 px column, **1 CSS px ≈ 1.95 native ≈ 1.28 frame px**. |
| 10 opus-high | 2598×2160 | 0.616 | most frames | The column is 891 frame px, so 672 px gives **1 CSS px ≈ 1.33 frame px**. |
| 11 opus-medium | 2496×2160 | 0.641 | most frames | The column is 791 frame px, so 672 px gives **1 CSS px ≈ 1.18 frame px**. |

All CSS px values below are estimates on that basis (±1 px). Hex values are sampled. Text colours are the cores of glyph strokes, so antialiasing makes the true value slightly darker or more saturated, and the closest Tailwind token is given next to each one.

---

## 1. The shared chat shell (identical in 02 and 07; 10 and 11 use the same bubble and prose)

This shell is Pitus's harness, not the generated component. Both the v1 and the final sit inside it, so differences between them are purely in the component.

### Canvas and layout
- Page background: `#ffffff`, no texture or gradient. There is no visible app chrome: no sidebar, no header.
- A single centred column of **672 px**. Everything aligns to its left and right edges: user bubble (right), thinking row, card, prose, pills and composer.
- **Empty state (02 t001):** the composer sits at the vertical centre of the viewport, and the status pills sit above it. When the first message is sent, the conversation grows from the top and the composer drops to the bottom (02 t003: the composer moved about 55 CSS px down within one second; the bubble appears top-right).
- **Vertical rhythm (02 neutral frame t010, CSS px):**
  - user bubble to the "Worked for" row: about 24
  - "Worked for" row to the card: about 16 (row height about 26)
  - card to the prose: about 16–20
  - prose to the pill row: about 28
  - pill row to the composer: about 6–8
- The user bubble is right-aligned at the column edge, with `#f6f6f6`–`#f8f8f8` fill. It has **no border**, but a very faint diffuse shadow: a `#fdfdfd` halo about 10 px around it, so about `0 2px 12px rgba(0,0,0,.03)`. It is fully rounded (pill radius about 22), with padding about 10×16 and text 15 px `#171717`.

### Thinking / worked row
- Layout: a 10 px chevron `›` in `#a0a0a0` at x 0, then a gap of about 34 px, then the label. The label is indented about 50 px from the column edge, which creates a hanging-indent column.
- While running: **"Thinking"** in 15 px `#1a1a1a` plus a live counter **"1s" … "5s"** in `#a3a3a3` (neutral-400). The label carries a **shimmer**: a lighter band sweeps left to right through the letters. In t006 the "Thin" portion is darker and "king" lighter.
- When done, it collapses to **"Worked for 5s"** (02) or **"Thought for 14s"** (07), all `#737373`, with no counter styling. It can be expanded with the chevron. The final never puts step text here.

### Prose
- 15 px, line-height about 25.5 px (1.7), colour `#171717` (sampled core `#1a1a1a`–`#242424`). Inter, or a very close neo-grotesque: double-storey a, flat-topped t, open digits.
- Bold for IDs and the key noun (`#128`, "HN 27 to Tokyo"), weight about 600.
- Inline code: mono 13 px, text `#171717`, background about `#f3f3f3`, radius 4–5 px, padding about 1×5 px. It sits on the baseline, so its height (about 20 px) does not push the line-height.
- Streaming effect: new words appear with a **blur-and-fade-in**. The tail of the line is gaussian-blurred and pale (02 t009 "while we worked"; 10 t002 "window seat on"). Each word sharpens over about 150–250 ms, and the blur reads like 4–6 px going to 0.

### Pills above the composer (status rail)
- Height 28 px, fully rounded, white fill, 1 px border about `#ececec` (sampled about `#f4f4f4` with antialiasing), text 15 px, horizontal padding about 12 px, gap about 6 px.
- The final keeps them **left-aligned** with the column. The v1 right-aligns them (see §3).
- Diff pill: `+482` in green `#15803d`-ish (sampled `#298e43`), `−37` in rose `#a41d3d`. Mono-free tabular digits with a real minus sign "−". There is a 5-segment mini bar of 7×7 px rounded squares (radius 2), gap 2: green `#4ade80` ×3, red `#e5484d` ×1, grey `#e5e5e5` ×1. A chevron `⌄` in `#a3a3a3` follows.
- Status pill (left): it mirrors the component state through the whole flow:
  `Create PR` → `◌ Creating PR` → `● #128 3 conflicts` (amber dot, amber text `#b45309`) → `◌ #128 Resolving` → `● #128 Ready to merge` (green dot `#22c55e`, green text `#15803d`) → `◌ #128 Merging` → `⑂ #128 Merged` (purple merge icon and text `#6d28d9`; the diff pill disappears once merged).
  `#128` is always `#171717` and the state word is coloured.

### Composer
- 672 px wide, about 116 px tall, radius about 20 px, white, 1 px border about `#ececec`, soft drop shadow (a `#fcfcfc`–`#fdfdfd` halo extends about 12 px below, about `0 4px 16px rgba(0,0,0,.03)`).
- Placeholder "Ask anything, or type / for skills": 15 px, `#a3a3a3`, padding about 16 px top and 16 px left.
- Toolbar row, 36 px items, bottom padding about 12 px:
  - `+` in a 32–36 px circle, fill `#f8f8f8`
  - folder icon plus "acme-webapp" pill, fill `#f7f7f7`, text `#525252`
  - a segmented control on a `#f5f5f5` track, where the selected "Local" (laptop icon) is a white chip with a faint shadow and the cloud icon is unselected
  - right side: a 4-bar signal glyph (2 bars `#1d1d1d`, 2 bars `#d4d4d4`) plus "Medium" in `#737373`, then a mic icon in `#737373`
  - **send**: a 36 px circle, `#2f6ce8` (≈ blue-600 `#2563eb`), white ↑ arrow
- Icons: Lucide-style, 1.5 px stroke, 16–18 px, `#525252`–`#737373`.

---

## 2. The final component (02): full spec

### 2.1 Card surface
- Width 672 px (the full column). Radius **16 px**. Background `#ffffff`.
- Border: **1 px hairline**. The sharpest edge sample is `#e6e6e6` and the blurred edges `#f1f1f1`, so specify `rgba(0,0,0,.08)` ≈ `#ebebeb`.
- Shadow: barely there. `#fdfdfd` extends about 10 px below and is almost absent above, so roughly `0 2px 10px rgba(0,0,0,.02)`. Treat the border as the edge, not the shadow.
- Padding: **16 px** on all sides. The title cap top is 44 native px below the border, which works out to 16 px padding plus the half-leading.
- Height in the conflict state is about 389 px for 9 commit rows plus header and footer.
- **No nested panel, no icon tile, no header divider.**

### 2.2 Header row
- Left: title **"Refresh sessions in the auth middleware"**, 15 px, weight 600, `#171717`. Then `#128` in the same size and weight 400, `#737373`. Both are on one baseline.
- Right: the status as **plain text with a dot**: `●` (6 px) plus "Open", 15 px, weight 500, green (text sampled `#338d4a` ≈ `#15803d`, dot about `#22c55e`). When merged it reads "● Merged" in violet `#6d28d9`. **No pill background.**
- Header to the first row: about 10 px.

### 2.3 Commit-graph list (the core component)
A vertical git log. Each row is **32 px tall** (row pitch 64.7 native px). Left to right:

| Zone | x from card content edge | Spec |
|---|---|---|
| Lane 0 (main / target) | about 11 px | grey dots `#bdbdbd`, 8 px; grey rail `#d8d8d8` 1 px, **dashed** where it is only context |
| Lane 1 (your branch) | about 28 px | blue dots `#4a8af0` (≈ blue-500 `#3b82f6`), 8 px; rail `#a0cdf5` (≈ blue-300), 1 px solid |
| Lane 2 (other branch) | about 46 px | teal dots `#1cd3af` (≈ teal-400 `#2dd4bf`), 8 px; rail `#b3e6d5`, 1 px |
| Text column | about 65 px | the commit message |

- Lane pitch is about **17–18 px**. Branch rails join the parent lane with **smooth S-curved béziers** about 30 px tall at the fork (bottom of the graph), not right angles. Below the last row the main rail continues as a short dashed stub, meaning "history continues".
- **Status node** (top row, lane 0): a 14 px filled circle.
  - In conflict: amber `#f0a906` with a white `!` and a soft amber halo (about 4 px glow at about 25 %).
  - Ready: green `#2adb64` with a white ✓.
  - Merged: violet `#8b5cf6`, solid, larger, about 12–14 px.
  - Pending/checking: a dashed grey circle that spins.
  - It connects to the head commit with a **dashed diagonal** in the state colour: amber dashed in conflict, green dashed when ready, solid violet when merged.
- Commit message: 15 px weight 400.
  - **Your** commits are `#171717`, so they read as primary.
  - Other people's commits (Sam, Lena) and context rows are `#737373`. Hierarchy comes from text tone alone.
  - Conflicting commits turn amber `#b45309` (sampled `#af5802`).
- Inline after the message:
  - Branch-ref chip: mono 13 px, radius 4, padding about 2×6, height about 21.
    - your branch: text `#1d4ed8` on `#eff6ff`
    - other branch: text `#0f766e` (sampled `#198775`) on `#f0fdfa`
    - main: text `#737373` on `#f0f0f0`
    - merged: text `#6d28d9` on `#f5f3ff`
  - Conflict count badge: an 18 px circle with a 1 px amber border about `#f5d9a8`, fill about `#fffbeb`, and the numeral "1"/"2" in 12 px `#b45309`. It turns into a ✓ in an 18 px circle with green 1 px border `#bbf7d0`, fill `#f0fdf4` and stroke `#16a34a` when resolved.
- Right-aligned meta, in two tones:
  - mono hash `d29f50` 13 px `#a3a3a3`
  - then "You · now" / "Lena · 6m" / "Sam · 2h" at 14 px `#737373`, with a centred dot "·"
  - the right edge is at the 16 px padding
- For the status row the meta slot holds a **lowercase state word** instead: `checking` (`#737373`) → `3 conflicts` / `2 conflicts` / `1 conflict` / `resolved` (amber `#b45309`) → `ready` (green `#15803d`) → `merged` (violet). Progress rows hold a counter, `2/3` / `3/3` / `36/42`, in 15 px `#525252`.

### 2.4 Footer row (state line plus single action)
- About 16 px below the last row, 36 px tall.
- Left: an icon plus a sentence, 15 px.
  - Running: a 16 px **spinner** (a grey ring with a darker arc) and a gerund, e.g. "Committing the last changes", "Pushing 3 commits to origin", "Opening the pull request", "Fetching main", "Checking it merges cleanly", "Merging main into the branch", "Resolving conflict 2 of 3", "Running 36 of 42 tests", "Pushing the merge", "Merging into main".
  - The gerund line has the **shimmer** while running. Its tail words are lighter: "Pushing 3 commits to **origin**", "Opening the pull **request**".
  - Done states: ⚠ outline triangle in amber plus "**3 conflicts** with main". "3 conflicts" is amber with a **dotted underline** (1 px dotted `#d6a46a`), which marks it hoverable. Other done states: "✓ Ready to merge" (green check) and "⑂ Merged into main" (violet icon).
- Right: **one** action button.
  - Pill, height about 34 px, padding about 0 16 px, **tinted fill**: blue-50 `#eef4fd` with blue-700 `#1d4ed8` text, 15 px weight 500. Optional leading icon (merge glyph).
  - Labels: "Resolve conflicts" → "Merge".
  - While working, the same button morphs into a **neutral busy state**: `#f5f5f5` fill, `#737373` text, a spinner and a gerund ("Resolving", "Merging"). After the merge it becomes a ghost "GitHub" link button (logo plus text, `#f8f8f8` fill, `#171717` text).
- **Check chips** (ready state only, between the list and the footer): 32 px pills, white with a 1 px `#ececec` border, gap 8. Content: a 12 px green ✓ `#16a34a`, then the label in `#171717` and the value in `#737373` ("Tests 42 passed", "Lint passed", "Types passed", "Preview ready").

### 2.5 Popovers and tooltips
- **Conflict popover** (hover over "3 conflicts", 02 t012): white, radius about 12, 1 px `#ececec` border, shadow about `0 8px 24px rgba(0,0,0,.08)`, width about 60 % of the card, anchored above the trigger.
  - Header: "**Lena Park** changed the same lines on main" (name `#171717` 500, rest `#737373`).
  - Divider: 1 px `#f0f0f0`.
  - Per file: "**middleware.ts** line 18" (`#171717` 500 plus `#a3a3a3`), then two diff lines. Each line has a 2 px left bar (Lena: peach `#f3c9a5`; You: light blue `#bcd7f5`), a 13 px author label `#737373`, and mono 14 px code `#171717`.
  - It shows the answer (which lines) rather than a link to it.
- **Check tooltips** (hover over a chip, 02 t022–t025): a small white pill-ish box, radius 8, border plus soft shadow, 15 px. The tool and result are in `#171717` and the duration in `#737373`: "vitest · 42 passed, 0 failed  38s", "eslint · no problems  9s", "tsc --noEmit · no errors  21s", "Deployed to session-refresh.preview.acme.dev  1m 4s".
  - It appears **above** the chip and covers the row behind. It fades in (t022 caught it at about 50 % opacity), about 120–150 ms. Moving between chips swaps the content without a gap.

### 2.6 Colour roles (final)

| Role | Hex (sampled → token) |
|---|---|
| Text primary | `#171717` (neutral-900) |
| Text secondary / meta | `#737373` (neutral-500) |
| Text tertiary / hash / placeholder / timer | `#a3a3a3` (neutral-400) |
| Hairline borders | about `#ebebeb` (rgba 0,0,0,.08) |
| Neutral fills (bubble, pills, code) | `#f3f3f3`–`#f7f7f7` |
| Accent / primary action | blue-700 `#1d4ed8` text on blue-50 `#eff6ff`; send button `#2f6ce8` |
| Your-branch graph | dot `#3b82f6`, rail `#a0cdf5` |
| Other-branch graph | dot `#2dd4bf`, rail `#b3e6d5`, text `#0f766e`, chip bg `#f0fdfa` |
| Warning / conflict | text `#b45309`, node `#f0a906`, row flash `#faf3ec` |
| Success | text `#15803d`, node `#2adb64`, progress `#4ade80` |
| Merged | node `#8b5cf6`, text `#6d28d9`, chip and row tint `#f5f3fd` |
| Diff | + `#15803d`, − `#a41d3d`, bar red `#e5484d` |

Seven hues appear, but each is used only as **text or an 8–14 px dot**, plus 4 %-strength tints on small chips. No large area of the card is coloured.

### 2.7 Motion catalogue (final): timed from the 60 fps source

1. **Row insertion (the signature move).** In `sheet_rowinsert.png` (5.6–7.2 s) a new commit lands between existing rows:
   - (a) a gap opens: the rows below slide down over about 200 ms, ease-out
   - (b) the new row appears **blurred** (gaussian about 4 px) and at about 40 % opacity, and sharpens over about 150 ms
   - (c) the message **decodes**. The text scrambles through random alphanumerics and settles left to right: "Rtqiii nn" → "Rotagw w3wh" → "Rotate 6a316gh" → "Rotate sow4p3d u" → "Rotate sesrjt0 zlf" → "Rotate session keyd" → "Rotate session keys". That takes about 700–800 ms, with the correct prefix growing about 1 character every 25–35 ms.
   - (d) the row carries a **warm highlight** `#faf3ec` (full-width, radius 8 px, inset 8 px beyond the text) during the decode, which fades out about 300 ms after it settles
   - The meta (hash, author, age) fades in with the row and is not scrambled.
   - The next insertion starts about 270 ms after the previous one, so the rows **stagger**.
   - The same scramble is used for the "Merge into main" status row ("Merga ug3z 9", "Merge into lyjb") and for "Merge main into feat/session-refresh" ("cratr qw").
2. **Shimmer** on every in-progress label ("Thinking", footer gerund, active row): a highlight band about 30 % wide sweeps left to right, about 1.2–1.5 s per pass, looping.
3. **Spinners**: a 16 px ring with about a 90° dark arc, rotating at about 1 rev/0.8 s. They appear in the footer, the status pill, the busy button and the status node (dashed ring).
4. **Counters**: the "Thinking Ns" timer ticks every second. Counts change in place (3 → 2 → 1 conflict, 2/3 → 3/3, 28/42 → 36/42). There is no number-roll effect. They simply swap.
5. **Progress underline**: while tests run, a 2 px `#4ade80` line under the active row grows left to right from the text start to the right edge, in step with N/42. The track is `#f0f0f0`. It is a linear-ish tween per update.
6. **State recolour**: on a resolve, the conflicting row goes from amber text to grey `#737373`, its dot from amber to grey and its badge from numeral to ✓ (crossfade about 200 ms). On the merge, the user's commit dots and rails go from blue to violet, and a **lavender `#f5f3fd` highlight sweeps** down the merged commit rows (rows 2, 3, 5 and 7 lit in t028, gone by t029), about 100 ms apart, each fading about 400 ms.
7. **Status morphs in place**: the footer button morphs to its busy state (fill goes to neutral, a spinner fades in, the label crossfades) with no layout jump; widths animate about 200 ms. The header status word and the composer status pill change in the same frame.
8. **Card growth**: the card height animates as rows are added (02 t007 → t008: +1 row, smooth). Content above stays fixed and the composer is pushed down.
9. **Tooltip and popover**: fade plus a slight rise (about 4 px), about 150 ms ease-out. They dismiss instantly when the hover moves away.
10. **Prose stream**: per-word blur-in (see §1).

Durations are short (120–300 ms) and easing is ease-out. Nothing bounces, nothing flips, nothing scales, and the card itself never moves.

### 2.8 Interaction and flow (final)
The user's click on a suggestion chip ("Create PR") becomes the user bubble. One card then appears and **is the whole job**, from commit to merge:

| Time | What happens |
|---|---|
| 1 s | Card appears with title and git log. Footer: "Committing the last changes". The top row is "Uncommitted changes · feat/session-refresh · 4 files" with a hollow dashed node. |
| 2 s | It becomes the commit "Add session refresh tests d29f50 You · now". Footer: "Pushing 3 commits to origin". |
| 3 s | `#128` and "● Open" appear. A "Merge into main" status row is inserted on top (scramble). Footer: "Opening the pull request". |
| 4–5 s | "Fetching main". Lena's two newer main commits are inserted (scramble, stagger). Then "Checking it merges cleanly" with the row meta `checking`. |
| 5 s | Done. "Worked for 5s" collapses. The conflicting rows turn amber with numbered badges. Footer: ⚠ "3 conflicts with main" plus **Resolve conflicts**. Prose streams below: *"PR #128 is open, but `main` moved on while we worked: Lena's session key rotation changed the same lines in `auth.ts` and `middleware.ts`. I can merge `main` in and resolve them."* |
| Hover | "3 conflicts" shows the line-level popover. |
| Click Resolve | No new chat message. The same card works in place: a merge commit row is inserted, "Resolving conflict 2 of 3", badges tick to ✓, "Running 36 of 42 tests" with the underline progress, then ready: green node, "ready", four check chips, ✓ "Ready to merge" plus **Merge**. |
| Click Merge | "Merging into main" with the busy button, then the violet recolour sweep. Footer "Merged into main" plus GitHub. The composer pill ends at "#128 Merged". |

Prose and component split the work:
- The **card shows the what**: state, counts, structure.
- The **prose says the why and offers the next step** in one or two sentences.
- The prose never restates the card's numbers. It is written once and not re-streamed per step.

Small flaw kept in the final: the prose "PR #128 is open…" stays after the merge (stale).

---

## 3. Claude's v1 (07): what it did instead

### Anatomy (07 t009, conflict state)
- Card: 672 px wide, radius about 16, 1 px border, white. Height about 294 CSS px. Padding about 16 px.
- **Header block, three tiers:**
  - (1) a 32 px **round tinted icon tile** (mint `#f0fbf3` disc, green PR icon)
  - (2) the title, 15–16 px weight 500, plus `#128` in `#737373`
  - (3) a meta line of chips: `feat/session-refresh` → `main` (mono 13 px grey chips on `#f8f8f8`), "3 commits" `#737373`, "+128 −36" green/rose
  - Top-right: a **tinted badge pill**, "⑂ Open" in green on `#f4fcf4`
- **Nested grey panel** `#fbfbfb`, radius about 12, inset 16, about 160 px tall. Inside it is a **horizontal subway map**:
  - a "main" mono label chip at top-left, then a grey main line with 4 grey dots
  - the blue branch line dips down via an S-curve to 3 blue dots, labelled underneath by a centred blue mono chip "feat/session-refresh" on `#f4f8fc`
  - a dashed connector to the merge-target node at the far right
  - a floating **label chip above the node**: "Checking" (white), "3 conflicts" (amber text on `#fffbeb` with amber border), "Resolved" (white), "Ready to merge" (green tint), "Merged" (violet tint)
  - The dots carry **no information**: no messages, authors or times.
- **Footer block:**
  - a 32 px **round tinted icon tile** (amber triangle on a cream `#fefefb` disc)
  - two-line text: "3 conflicts with main" (15 px weight 500 `#171717`) and "Lena Park changed the same lines in main" (14 px `#737373`)
  - a row of **file chips**: `TS middleware.ts 1`, `TS auth.ts 2`, with a blue "TS" glyph, 32 px tall, white with a border
  - right: a **solid black pill button** `#202020` with white 15 px weight 500 text, "Resolve conflicts", about 34 px tall

### The v1 flow
- Before any card: a **right-aligned** action pair under the prose, "📄 4 files +128 −36 ■■■■■ ^" pill plus a **black** "⑂ Create PR" button (07 t002). The final moves the action into the left-aligned status rail as a neutral outline chip.
- On click, the live step text goes **into the thinking row**: "Committing the last changes 0s", "Opening the pull request 2s", "Checking it merges cleanly 4s". The card's graph extends a dotted line toward an empty node. There is no status line inside the card.
- Clicking "Resolve conflicts" **posts a new user bubble "Resolve conflicts"**. A **second** "Worked for…" row then streams "Resolving conflict 1 of 3 1s", "Merging main into the branch 0s", "Running 12 of 42 tests 3s" and "Pushing the merge 4s", and finally a **second prose paragraph**: *"Done. I kept Lena's key rotation and moved the refresh after it, so a refreshed session gets the new key. All 42 tests pass, and #128 is ready to merge."* Meanwhile the original card (now scrolled up) mutates silently.
- Merge: the button becomes a grey "◌ Merging" pill, the branch path turns violet, the branch label is ~~struck through~~, and the footer becomes a violet icon tile plus "Merged into main / `feat/session-refresh` was deleted · just now".
- State bugs visible in v1:
  - t015–t016: "Conflicts resolved" is still shown with the **amber ⚠ tile**, the target node is still the **amber "!"** while its chip says "Resolved", and the button still says "◌ Resolving".
  - "3 commits" silently becomes "4 commits".
  - The "Done… ready to merge" prose stays after the merge.

---

## 4. Every difference between v1 (07) and the final (02)

### Information design
| | v1 | Final |
|---|---|---|
| Graph | Horizontal decorative subway map. 7 anonymous dots, 2 labels. | Vertical git log. Every node is a real commit with message, branch ref, hash, author and age. |
| What the conflict is | A file list ("middleware.ts 1, auth.ts 2") plus "Lena Park changed the same lines". | The conflicting **commits** are placed in the history in amber and numbered. Hover shows the exact conflicting lines, side by side, Lena vs You. |
| Who did what | Only "Lena Park" in a subtitle. | Author on every row; your rows dark, others grey. |
| Progress | Lives in the thinking row text, outside the card. | Lives in the card: footer gerund, N/M counters on the row, progress underline, check chips with tooltips. |
| Ready state | One summary line: "No conflicts · tests, lint and preview passed". | Four check chips, each hoverable for tool, result and duration. |
| Final state | Strikethrough branch label plus "was deleted · just now". | Violet recolour of exactly the merged commits plus a GitHub link. |

### Hierarchy
- v1 stacks **three header tiers** (icon tile, title, chip meta line) and **two footer tiers** (title, subtitle, chips). Everything is 15 px weight 500 and equally loud, which is the "everything is the same size" failure he names.
- The final has **one** header line (title plus quiet `#128`, plain status at the right), then data rows, then one state line. Emphasis comes from **text tone** (`#171717` vs `#737373` vs `#a3a3a3`), not from containers.
- v1 decorates with icon tiles that repeat information the text already gives (a PR icon next to a PR title; a warning icon next to "3 conflicts"). The final uses an icon only where it carries state (the status node, ⚠ and ✓ in the footer).

### Spacing and density
- v1: about 294 px of card shows roughly 6 facts. About 160 px of that is the grey graph panel, of which more than 60 % is empty.
- Final: about 389 px shows 9 commits × 5 facts plus state. Rows are a tight 32 px with 16 px card padding, and there is **no nested padding layer**.
- v1 has padding at three nesting levels (card 16, panel about 16, chips about 8), so the content column is effectively about 600 px and things float. The final has one padding level and one hanging-indent text column at about 65 px that everything aligns to: status text, commit text, footer text after the icon.
- v1's action pair and status pills are right-aligned while the prose is left-aligned. The final aligns every element to the left edge, except the meta, which is right-aligned to the card padding.

### Colour
- v1 filled areas: mint icon disc, green badge fill, amber badge fill and border, cream icon disc, grey panel, blue chip fill, three grey chip fills, **black button**, green/violet chip fills. That is about 10 tinted surfaces per card, plus a black slab.
- Final filled areas: blue branch chip, teal branch chip, grey `main` chip, the blue-50 action pill. Everything else is white, and colour lives in dots, text and hairlines.
- v1's primary button is **black** `#202020`, a different accent family from the composer's blue send button. The final's action is **blue-tinted**, `#eff6ff`/`#1d4ed8`, matching the only other accent on screen (send) and staying quieter than the data.
- v1 colours the whole branch line violet on merge and strikes through text. The final recolours only the merged commits' dots and rails, plus a passing highlight.

### Motion
- v1: crossfades of chip labels, a dashed line drawing toward the target node, a spinner in the button, the timer in the thinking row, and the new chat turn streaming in. The card mostly **swaps states**.
- Final: rows insert with height expansion, blur-in and scramble-decode (staggered), a highlight flash on new rows, a shimmer on live labels, live counters, the progress underline, a violet sweep on merge, tooltip and popover fades, and button-state morphs. All of it happens **inside the same card, in place**. The page never scrolls to a new turn.

### Interaction model
- v1 turns every button press into a **new user message and a new assistant turn**. The chat log becomes the state machine, and the card above becomes stale or confusing.
- In the final, a button press **changes the component's own state**. The conversation stays one question, one card, one paragraph. The composer status pill gives a persistent summary even when the card is scrolled away.
- The final adds **hover depth** (popover with line-level diff, tooltips per check), so the resting card stays sparse. v1 shows everything up front (file chips, subtitle) and has nothing on hover.

### Copy
- v1 uses headline plus subtitle pairs ("3 conflicts with main / Lena Park changed the same lines in main"; "Ready to merge / No conflicts · tests, lint and preview passed"). The final uses single lines ("3 conflicts with main", "Ready to merge").
- Both use the same gerund step names. v1 just places them in the thinking row.

---

## 5. Opus outputs he rejected

### 10: Opus "high" (2/5: "spacing odd, colors unbalanced, vibe-coded header")
- **Header**: a full-bleed **navy gradient slab** (`#0f2a4a` to `#1d4f7a`) with decorative **concentric arc lines**, about 230 px tall, inside an otherwise white card. It includes an airline logo disc, "Halcyon / HN 27 · Boeing 787-9", a neon-green tinted "● On time" pill, 46 px bold white IATA codes, a dotted flight arc with a plane, "11h 20m · Nonstop", a divider, and DEPARTS/ARRIVES uppercase labels with times.
  This is the "vibe-coded header" archetype: a gradient hero panel with decorative geometry, white type on a dark slab, and glowing pills. It is the only dark mass on a white page, so the colour weight is unbalanced.
- **Body**: four stat columns (GATE / BOARDING / SEAT / GROUP) with uppercase 13 px tracked labels, 32 px bold values and vertical dividers. Then a grey strip "● Boarding starts in 42:56 | Doors close 13:00", ticket **notch cut-outs** with a dashed tear line, a "YOUR SEAT" seat map drawn as a plane silhouette, a QR code, "Tap to enlarge", the passenger name, and a **black** "Send to iPhone" pill.
- The spacing is uneven:
  - the header has about 30 px padding, the body about 30 px, and the strip has its own inset
  - the stats row has about 40 px above and 15 px below
  - the seat block mixes left text with a right QR of a different height
- Motion: IATA letters scramble ("OA I" → "SFO", "AGW" → "HND"), the plane flies along the arc, digits roll ("12:3**5**" rising), the seat map builds, and a **blue indeterminate bar** draws where the QR will be.
- Gate change: the GATE stat becomes a **peach filled tile** "● NEW GATE G12 ~~G7~~", in a different style from the rest.
- "Send to iPhone" → grey "Sending…" → a **saturated green filled** "✓ Sent to iPhone" (`#22a046`), a third button colour.
- "Tap to enlarge" opens a **modal**: a heavy blue-grey scrim plus backdrop blur over the whole page, a white 24 px-radius sheet and a giant QR.

### 11: Opus "medium" (1/5: "buttons too wide, too tall, top cards, flip animation, spacing")
- White card, about 24 px radius, a stronger drop shadow, about 30 px padding.
- Header: a **blue gradient app-icon tile** (iOS-style) "Cirrus Air / CR 418 · Fri, 16 Oct" and a green tinted "● On time" pill.
- 46 px bold SFO/JFK with times and "+1" chips, and a dotted arc with a blue plane.
- **"Top cards"**: the four stats sit inside a **grey rounded container** with dividers. The gate-change cell becomes its own amber-bordered sub-card ("D14 · ● Moved from D12"). These are cards inside a card inside a chat.
- A countdown with a **progress bar**. Under "YOUR SEAT", **four feature chips** with icons (Window, Exit row, Extra legroom, Over the wing) that restate the prose. Then a full seat-grid map with row numbers, "FRONT →", "EXIT" markers and a black "14A" tooltip.
- Passenger block with six UPPERCASE label/value pairs, and a QR inside a bordered tile.
- **Buttons**: two side-by-side, each about 304×47 CSS px, filling the card width: a black "Send to iPhone" and a grey "Show barcode". These are the "too wide, too tall" buttons. They read like mobile CTAs pasted into a chat.
- **Flip animation**: "Show barcode" rotates the **whole card in 3D** around the Y axis (t008 shows the card mid-flip in perspective) to a "back side" with a giant QR and a black "Done". Every frame the card sits in perspective the prose layout breaks and the text behind shows through.
- Other motion: digits scramble ("9:°Y" → "9:00", "1¯9" → "14A"), the seat grid fills in from the right, and the plane moves along the arc.

---

## 6. Do / don't: what separates Pitus's work from vibe-coded AI UI

### Layout and surfaces
- **Do** use one card, one padding level (16 px), one hairline border (`rgba(0,0,0,.08)`), a 16 px radius and almost no shadow. **Don't** nest panels in cards in chat (v1 grey graph panel; 11 "top cards"; 10 grey strip and stat tiles).
- **Do** use one shared text column with a hanging indent that every row's text, status line and footer aligns to. **Don't** let each block pick its own left edge (v1 icon tiles push text to different x values; 10 and 11 mix inset strips).
- **Do** make rows dense (32 px) with right-aligned meta. **Don't** pad everything to "airy" mobile proportions (11's 47 px full-width buttons; 10's 230 px header).
- **Do** keep the component the width of the column and quiet at the edges. **Don't** use ticket notches, tear lines, perspective or full-bleed hero slabs.

### Hierarchy and type
- **Do** use one size (15 px) for title, rows and prose, and build hierarchy with weight (600 vs 400) and tone (`#171717` / `#737373` / `#a3a3a3`). **Don't** use three type sizes, an uppercase tracked label above every value, and 46 px display numerals in a chat reply.
- **Do** dim what isn't the user's (Sam's and Lena's commits in grey) and darken what is. **Don't** make every element equally emphasised (v1's 500-weight headline and subtitle pairs everywhere).
- **Do** use mono only for machine strings: hashes, branch refs, file names, commands. **Don't** use mono chips as decoration.
- **Do** write status in the meta slot as a lowercase word (`checking`, `3 conflicts`, `ready`, `merged`). **Don't** use floating badge pills with tinted fills for every state.

### Colour
- **Do** keep the surface white and put colour on text and 8–14 px dots, with at most about 4 % tints on small chips. **Don't** use gradient hero headers, decorative arcs, glowing pills, gradient app icons or dark slabs (the "vibe-coded header").
- **Do** have one accent family for actions (blue-tinted button = blue send button). **Don't** mix a black primary, a green success fill and a grey secondary in one card (v1 black button; 10 black → green; 11 black plus grey).
- **Do** give state colours one fixed meaning each: amber = conflict, green = passing or ready, violet = merged, blue = mine, teal = someone else's branch. **Don't** leave a stale colour behind (v1's amber ⚠ on "Conflicts resolved").

### Icons
- **Do** use small (16 px) line icons only where they carry state (status node, ⚠, ✓, spinner, merge glyph). **Don't** put icon tiles or discs (32 px tinted circles) in front of headings that already say the same thing.

### Interaction
- **Do** let an action change the component **in place**. The button morphs into a busy state, the card works, and the composer status pill mirrors the result. **Don't** turn button clicks into new user messages and new assistant turns (v1).
- **Do** give exactly one primary action at a time, and swap it as the state advances (Resolve conflicts → Merge → GitHub). **Don't** show two equal full-width CTAs (11), or an action plus a "Tap to enlarge" plus a modal (10).
- **Do** use progressive disclosure on hover for detail: line-level conflicts, per-check tool, result and duration. **Don't** dump chips and subtitles up front, or put detail in a modal with a full-page scrim (10) or behind a card flip (11).
- **Do** keep the agent's step narration ("Fetching main", "Running 36 of 42 tests") **inside the component**, while the thinking row only shows "Thinking Ns" and then "Worked for Ns". **Don't** make the thinking row the progress UI (v1).
- **Do** end with one or two sentences of prose that explain the why and propose the next step, using inline code for identifiers. **Don't** re-describe what the card already shows (the 11 seat chips restate the prose; v1's second "Done…" paragraph restates the card).

### Motion
- **Do** animate data arriving: a row opens its gap, blurs in, decodes its text left to right, flashes a warm highlight, and the next row follows about 270 ms later. **Don't** animate the container (3D flip, scaling, modal zoom).
- **Do** shimmer live labels, tick live counters and show progress as a thin 2 px underline on the row that's working. **Don't** use generic spinners alone, big indeterminate bars, or "Sending…" text swaps with colour jumps.
- **Do** keep durations at 120–300 ms with ease-out, crossfades for state words, and a highlight sweep to mark what changed (violet over merged commits). **Don't** use bounces, flips, flight paths for decoration, or animations that leave the layout in a half-state.

### States and edge cases (where v1 failed)
- **Do** cover every intermediate state with matching icon, colour, label and button:
  - uncommitted → pushing → open → fetching → checking → conflicts → resolving n/3 → testing n/42 → ready → merging → merged
- **Do** keep counts consistent everywhere at once: the header status, the row meta, the footer, the composer pill.
- **Don't** let labels and visuals disagree. v1 showed "Resolved" next to an amber "!", a "Resolving" button after the conflicts were resolved, and "3 commits" turning into "4 commits" without a visible commit.
- **Do** use real-feeling data: hashes, author names, relative ages ("6m", "2h", "now"), durations ("38s", "1m 4s"), true minus signs, `#128`. **Don't** use placeholder-ish data or the airline-brand theatre of 10 and 11.

### Microcopy
- Sentence case everywhere; no Title Case and no exclamation marks.
- Live steps are gerund phrases of 2–5 words ("Pushing 3 commits to origin", "Checking it merges cleanly").
- Final states use short past or adjective forms ("Merged into main", "Ready to merge", "42 passed", "no problems").
- Numbers are numerals with counts in plain words ("3 conflicts", "Resolving conflict 2 of 3", "2/3", "36 of 42 tests").
- Time is compact ("5s", "25m", "2h", "1m 4s", "Worked for 5s").
- Meta is joined with " · ".
- Prose is conversational and causal ("main moved on while we worked: Lena's session key rotation changed the same lines…"), first person for the offer ("I can merge `main` in and resolve them."). It does not open with "Great!" and does not end with a list of options.

---

## 7. Minimal token sheet for reproducing the final look

```css
:root{
  --col: 672px;
  --bg: #ffffff;
  --text: #171717; --text-2: #737373; --text-3: #a3a3a3;
  --hair: rgba(0,0,0,.08);          /* ≈ #ebebeb on white */
  --fill: #f5f5f5; --fill-2: #f7f7f7; --code-bg: #f3f3f3;
  --accent: #1d4ed8; --accent-bg: #eff6ff; --send: #2f6ce8;
  --mine-dot: #3b82f6; --mine-rail: #a0cdf5;
  --other-dot: #2dd4bf; --other-rail: #b3e6d5; --other-text: #0f766e; --other-bg: #f0fdfa;
  --main-dot: #bdbdbd; --main-rail: #d8d8d8;
  --warn: #b45309; --warn-node: #f0a906; --warn-flash: #faf3ec;
  --ok: #15803d; --ok-node: #2adb64; --ok-bar: #4ade80;
  --merged: #6d28d9; --merged-node: #8b5cf6; --merged-bg: #f5f3ff;
  --add: #15803d; --del: #a41d3d; --del-bar: #e5484d;
  --r-card: 16px; --r-chip: 4px; --r-pop: 12px;
  --font: Inter, ui-sans-serif, system-ui; --mono: ui-monospace, "SF Mono", Menlo;
  --fs: 15px; --lh-prose: 1.7; --fs-meta: 14px; --fs-mono: 13px;
  --row: 32px; --pad: 16px; --lane: 17px; --dot: 8px; --node: 14px;
  --ease: cubic-bezier(.2,.8,.2,1); --t-fast: 150ms; --t: 220ms;
}
.card{border:1px solid var(--hair);border-radius:var(--r-card);padding:var(--pad);box-shadow:0 2px 10px rgba(0,0,0,.02)}
.btn-action{height:34px;padding:0 16px;border-radius:999px;background:var(--accent-bg);color:var(--accent);font-weight:500}
.btn-action[aria-busy=true]{background:var(--fill);color:var(--text-2)}
```
