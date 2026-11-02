# Generative UI #2: Merge conflicts, light and dark (spec)

Sources: `videos/02-merge-conflicts.mp4` (light, 30.0 s) and `videos/06-merge-dark.mp4` (dark, 31.4 s). Frames: `frames/02-merge-conflicts/t001–t030`, `frames/06-merge-dark/t001–t031`. Extra full-resolution stills, contrast crops and 10–15 fps contact sheets are in each video's `extra/` folder (files prefixed `full_`, `f_`, `h_`, `dk_`, `ml_`).

This is the primary reference for GenUI Agent. Everything below is measured from pixels unless it is marked as an estimate (~).

---

## 0. Measurement basis (read first)

| | Light | Dark |
|---|---|---|
| Video size | 2808 × 2160, 60 fps | 2944 × 2160, 60 fps |
| Implied viewport | **1404 × 1080 CSS px at 2× DPR** | 1472 × 1080 CSS px at 2× DPR |
| `tNNN.jpg` frames | 1600 × 1231 | 1600 × 1174 |
| Rest zoom (camera fully out) | 1 CSS px = 1.14 frame px (= 2 video px) | ~1.09× zoom over 1:1 (card 820 frame px vs 754 expected) |
| Camera zoom range | 1.0× → ~1.55× (t012, t017–t025) | 1.0× → ~1.6× |

- The video has an editor camera (Screen-Studio style): it zooms toward the cursor and motion-blurs on pans (t014, t019 light; t010 dark). **This zoom and blur belong to the recording, not to the UI.** Don't build it.
- A 1 px `#a1a1a1` line around the whole light frame (t002, t010) is the browser window edge, not the UI.
- All CSS numbers come from the light rest frame `extra/full_10.png` (≈ t010), with video px ÷ 2. The calibration holds together: Inter cap height measures 11.75 px, which gives 16 px body text. The card radius measures 16 px, rows 32.3 px and prose line-height 26 px, all of which are standard Tailwind values. The dark layout matches the light layout to within 0.5 % (row-pitch to card-width ratio is 0.0468 in both), so the geometry below applies to both themes.

---

## 1. Canvas and layout

### 1.1 Page
- Light page background: **`#ffffff`** (pure white; sampled 40 000 px, all `#ffffff`).
- Dark page background: **`#0f0f0f`**.
- No chrome: no sidebar, no header, no logo. The canvas holds only the thread and the composer.

### 1.2 Column
- One centred column, **690 px wide** (measured 1380 video px; ≈ 688 / 43 rem if you want a round number). Centre at x = 702 in a 1404 viewport.
- Every block shares the same left and right edges: the user bubble's right edge, the card, the prose, the chip row and the composer. The card and composer measure 358 → 1048 exactly.
- **The whole stack (thread + chips + composer) is vertically centred in the viewport while it fits.** In the empty state the composer sits at the vertical centre (t001). After the first message, the bubble plus the composer is centred (t003: content centre ≈ 540 of 1080). At rest with the full card (t010), content runs from 133 to 950 with its centre at 541. So the composer is **not** pinned to the bottom: it is the last item of a centred stack, and the stack grows in both directions. When the stack overflows, the page scrolls (t021–t025 light, t021/t024 dark).

### 1.3 Vertical rhythm (CSS px, light rest frame t010)
| Block | Top | Bottom | Height | Gap to next |
|---|---|---|---|---|
| User bubble "Create PR" | 134 | 179 | ~44 | ~29 to the thinking line box |
| "Worked for 5s" disclosure line | ~208 | ~232 | 24 | ~18 |
| Card | 250.5 | 650 | ~400 | ~18 to the prose line box (16 px + line leading) |
| Prose (3 lines × 26 px) | ~668 | ~746 | 78 | ~34 (≈ 32) |
| Status chip row | 780.5 | 812 | 32 | **8** |
| Composer | 820 | 950 | 130 | (viewport bottom 1080) |

Rule of thumb: about **16 px** between a message's own parts (thinking line → card → prose), about **32 px** between the agent's reply and the chip row above the composer, about **24–28 px** between the user bubble and the agent's turn, and **8 px** between the chips and the composer.

### 1.4 How cards sit in the chat flow
Order inside the agent turn: **disclosure line ("Thinking Ns" / "Worked for Ns") → generated card → prose summary**. The card comes **before** the prose: the UI is the answer, and the prose is the caption. The prose spans the column width with no bubble or avatar. Only the user's message is in a bubble, right-aligned.

---

## 2. Typography

### 2.1 Families
- Sans: **Inter**, identified from the flat-topped `t`, double-storey `a`, straight-legged `R`, and the `#` and digit shapes. Default tracking, no negative letter-spacing anywhere. Weights used: 400 and 600, plus ~500 on buttons.
- Mono: **ui-monospace / SF Mono** (slashed zero in `d29f50` and `9c2d4a`, no foot serif on `r`, plain `f`). Used only for **machine identifiers**: commit hashes, branch names (`feat/session-refresh`, `main`), file names in prose (`auth.ts`), and the code lines in the conflict popover. Human-facing numbers (`+482 −37`, `#128`, `36/42`, `42 passed`) are **sans**, not mono.

### 2.2 Scale (CSS px; widths cross-checked against word widths, e.g. "session" = 56.0 px in prose vs 51.5 px in a row)
| Role | Size / line-height | Weight | Light colour | Dark colour |
|---|---|---|---|---|
| Card title ("Refresh sessions in the auth middleware") | 16 / 24 | 600 | `#171717` (sampled `#191919`) | `#f5f5f5` (sampled `#f6f6f6`) |
| Card title suffix "#128" | 16 / 24 | 400 | `#737373` (sampled `#6d6d6d`) | `#a3a3a3` (sampled `#a6a6a6`) |
| Commit row text | **15** / 32 row | 400 | primary `#171717` · muted `#737373` · conflict amber `#b45309` (sampled `#ac5808`/`#b25206`) | primary `#f0f0f0` · muted `#a3a3a3` · amber `#e9b04a` (desaturated in video to `#c7ae92`) |
| Row meta "You · now", "Sam · 32m" | 14 | 400 | `#737373` (sampled `#6d6d6d`) | `#a3a3a3` |
| Commit hash `d29f50` | mono ~12.5 (7.4 px advance) | 400 | `#a3a3a3` (sampled `#9d9d9d`) | `#6e6e6e` |
| Branch chip text | mono ~12.5 | 500 | blue `#2b54a8` / teal `#0f8a6c` / grey `#737373` | blue `#b6c9f5` / teal `#8be6c5` / grey `#a8a8a8` |
| Status "Open" / "Merged" (header right) | 14 | 400–500 | green `#1f9a3e` / violet `#6d28d9` | green `#5fd16a` / violet `#b699f9` |
| Prose body | **16 / 26** | 400 | `#171717` (sampled `#1b1b1b`) | `#f0f0f0` (sampled `#f5f5f5`) |
| Prose emphasis "**#128**" | 16 / 26 | 600 | same | same |
| Inline code in prose `main`, `auth.ts` | mono 14 | 400 | `#171717` on `#f5f5f5` | `#f0f0f0` on `#252525` |
| Disclosure "Thinking" / "Worked for 5s" | ~15 | 400 | "Thinking" `#171717` (with shimmer); "Worked for 5s" `#737373` | `#e5e5e5` / `#a3a3a3` |
| Disclosure seconds "1s"…"5s" | ~15 | 400 | `#a3a3a3` | `#6e6e6e` |
| Card status line ("Pushing 3 commits to origin") | 15–16 | 400 | `#171717` (+ shimmer) | `#f0f0f0` |
| Composer placeholder | 16 | 400 | `#a3a3a3` (sampled `#9e9e9e`) | `#6e6e6e` |
| Composer toolbar labels ("acme-webapp", "Local", "Medium") | 15 | 400 | `#737373`; active segment `#171717` | `#a3a3a3`; active `#f0f0f0` |
| Chips above the composer / check chips | 15 | 400 | label `#171717`, value `#737373` | `#f0f0f0` / `#a3a3a3` |
| Buttons ("Resolve conflicts", "Merge") | ~15 | 500 | blue `#2b54a8` (sampled `#26529e`) | `#b6c9f5` |
| User bubble text | 16 | 400 | `#171717` | `#ededed` |
| Popover heading "Lena Park" | 15 | 500 | `#171717` | `#f5f5f5` |
| Popover code lines | mono ~14 / ~27 | 400 | `#111111` | `#f5f5f5` |

Hierarchy comes from **colour (three greys) and one weight step**, never from size jumps. Everything sits between 12.5 and 16 px. There is no heading larger than 16 px in the whole product.

### 2.3 Text colour tiers (light → dark)
| Token | Light | Dark |
|---|---|---|
| `text-primary` | `#171717` | `#f0f0f0` |
| `text-secondary` (muted rows, meta, labels) | `#737373` | `#a3a3a3` |
| `text-tertiary` (hash, seconds, placeholder, chevrons) | `#a3a3a3` | `#6e6e6e` |

These are the Tailwind neutral 900 / 500 / 400 values in light, and inverted to roughly neutral 100 / 400 / 500 in dark.

---

## 3. Colour tokens (every role, both themes)

Values are sampled from full-resolution frames. Text samples use the darkest (light theme) or brightest (dark theme) pixel inside the glyph. **Coloured thin text loses saturation in the video's 4:2:0 chroma**, so for those roles a "recommended" value is given next to the sample.

### 3.1 Surfaces
| Token | Light | Dark |
|---|---|---|
| `bg-page` | `#ffffff` | `#0f0f0f` |
| `bg-card` (also popover, tooltip, composer) | `#ffffff` | `#191919` |
| `bg-raised` (user bubble, inline code, "+" button, repo pill, segmented track, grey "main" chip, "Resolving" and "GitHub" buttons) | `#f5f5f5`–`#f6f6f6` | `#252525` |
| `bg-thumb` (active segment "Local") | `#ffffff` + ring + shadow | `#3a3a3a` |
| `border-subtle` (card, composer, chips, popover) | 1 px ≈ `#ededed` (≈ black 7 %) | 1 px `#252525`–`#2c2c2c` (≈ white 6–8 %); brightest on the top edge |
| Divider inside the popover | `#f0f0f0` | `#282828` |
| Row highlight, pending/inserting (peach) | `#fcf3ed` | ~`#2a211b` (shown only briefly in dark) |
| Row highlight, active step | `#fafafa` | `#1f1f1f` (t018 dark) |
| Row highlight, "your commits" merge sweep (lavender) | `#f6f5ff` | ~`#211c2c` |
| Progress track | `#f0f0f0` | `#262626` |

### 3.2 Accents
| Role | Light fill / dot | Light text | Light tint bg | Dark fill / dot | Dark text | Dark tint bg |
|---|---|---|---|---|---|---|
| **Blue** (your branch, primary action) | dot `#4c8bee` (≈ `#3b82f6`) | `#2b54a8` | chip `#f1f6fe`, button `#edf2fc` | `#4880e8` | `#b6c9f5` | chip `#162333`, button `#1e232e` |
| **Teal** (other branch) | `#1fd2ad` | `#0f8a6c` | `#f3fffb` | `#2de0a1` | `#8be6c5` | `#122f23` |
| **Grey** (`main` lane) | `#c0c0c0` | `#737373` | `#f1f1f1` | `#5e5e5e` | `#a8a8a8` | `#252525` |
| **Amber** (conflict, warning) | `#f0a80d` dot, `#eca903` warn disc | `#b45309` | halo `#fdeccb` | `#e59f1c` / `#eea91a` | `#e9b04a` | halo `#3a2a0f` |
| **Green** (open, success, passed) | dot `#22a845` (Open), node `#1fe25c`, progress `#33e16b` | `#1f9a3e` | check badge `#f0fdf4` | dot `#50e359` | `#5fd16a` | `#132815` |
| **Violet** (merged) | node `#8b5cf6`→`#8e3ef3` | `#6d28d9` | chip `#f6f5fd`, row `#f6f5ff` | `#8e3ef3` | `#b699f9` | chip `#20182f` |
| **Send button** | `#306be7` (≈ `#2f6bea`), white arrow | | | `#2f5cdd` | white | |
| Diff "+482" | | `#1f8f3e` | | | `#6ec271`–`#88c389` | |
| Diff "−37" | | `#9f1239` (sampled `#9c233e`) | | | `#c2435b` | |
| Diffstat squares | green `#5bda7a`, red `#de4d55`, empty `#e6e5e8` | | | green ~`#3fcf5f`, red ~`#d13a50`, empty `#3a3a3a` | | |
| Popover "Lena" bar | `#f2bd94` | | | `#985f40` | | |
| Popover "You" bar | `#a3cbf3` | | | `#3c5085` | | |

Graph **lines** are the lane colour at about 45 % strength: light blue line `#a1ccf5`, teal line `#b2e7d6`, grey lane `#d4d4d4` (dashed above HEAD). Dark: blue line `#435379`, teal `#406e5f`, grey `#3a3a3a`.

The rule in dark mode: accents keep the same hue, chips and buttons swap their pastel tint for a **very dark tint** (about 10 % hue over `#191919`), and text inside them becomes a **light pastel** of the hue (blue 200, emerald 200, violet 300).

---

## 4. Surfaces

### 4.1 Card (the generated component)
- 690 × auto, **radius 16**, **1 px border** `#ededed` (light) / `#252525` with a slightly brighter top edge `#272727` (dark).
- Fill: same as the page in light (`#ffffff` on `#ffffff`). **The card is defined almost entirely by its hairline border plus a very soft drop shadow.** Dark: card `#191919` on page `#0f0f0f`, a lift of one surface step.
- Shadow (light): no shadow above. Below there is a faint haze about 18 px deep (`#fcfcfc` → `#fdfdfd` under the edge). ≈ `box-shadow: 0 4px 16px -4px rgba(0,0,0,.04)` or `0 2px 12px rgba(0,0,0,.02)`. In dark the shadow is invisible; the elevation comes from the fill.
- Padding: **16** all round (title cap top 21.5 px below the border, consistent with a 16 px pad and a 24 px line box). Title row height 24. Footer bottom ≈ 16 px above the border.

### 4.2 Header row
- Left: title (16 / 600) and "#128" (16 / 400, secondary) separated by a normal space. The "#128" fades in later, once the PR exists.
- Right: status "● Open": a 6–7 px dot, 6 px gap, 14 px label in the same hue. Merged: "● Merged" in violet. Baseline-aligned with the title.

### 4.3 Commit rows (32 px each)
Anatomy, left to right:
1. **Graph gutter, 66 px.** Lane centres at **11, 29 and 48 px** from the content-left (≈ 18.5 px lane pitch).
2. **Title**, 15 px, starting at x = content-left + 66.
3. Optional **branch chip** (mono ~12.5 px, h 20, radius ~5, padding 0 6 px, gap 10 px after the title).
4. Optional **conflict badge**: an 18–19 px circle with a 1 px amber-200 ring (`#f8d9a6` light, `#5a4220` dark) and the amber number 12 px, 8 px after the chip. When the conflict is resolved, the badge becomes a green check circle (`#f0fdf4` fill, `#bbf7d0` ring, `#16a34a` check).
5. **Right-aligned meta**: hash (mono, tertiary), 8 px gap, author · relative time (14 px, secondary). The middle dot is "·" with spaces. During work this slot shows a **counter** instead ("2/3", "3/3", "36/42") or a word ("checking", "3 conflicts", "resolved", "ready", "merged").

Row text colour carries meaning without any icon:
- **Your commits** (You): primary `#171717`.
- **Others' commits** (Sam, Lena): secondary `#737373`.
- **Conflicting commits**: amber text, amber dot.
- **HEAD target** ("Merge into main"): secondary, with its status in the meta slot.

### 4.4 Graph rail (component, SVG)
- Commit dot: **8 px** filled circle in the lane colour.
- Lines: **1.5 px** in the lane tint (see 3.2). Branches leave and join with **smooth S-curves** (cubic Béziers spanning about 1.5 rows), never right angles. The teal branch forks off near "Bump next to 16.3" and the blue lane curves into the grey base at the bottom.
- Pending/working node: 10–12 px ring with a rotating arc (spinner) in the lane colour. Examples: the "Uncommitted changes" head, the HEAD node while the branch is pushed, and a conflicted commit while it is being resolved (amber arc).
- Merge commit: **hollow ring**, ~11 px, 1.5–2 px blue stroke, card-coloured centre.
- Target node ("Merge into main"): a **dashed circle** while checking, then a **16 px amber disc with "!"** and a soft 4 px amber halo (`#fdeccb`), then a **16 px green disc with a white check**, then a **16 px violet disc** once merged.
- The connector from the target node to the branch head is a **dashed diagonal** in the state colour (blue dashed, then amber dashed, then green dashed, then solid violet).
- The grey `main` lane continues **dashed** above its newest commit, showing it is "ahead".
- The tail extends about 1 row below the last commit and fades into the footer.

### 4.5 Card footer row (~32 px, 12–16 px below the last row)
Left: icon or spinner (16 px) plus a status sentence. Right: one action button.

**Button.** h **28**, radius full, padding 0 14 px, label ~15 / 500.
- Primary-tint variant: light bg `#edf2fc`, text `#2b54a8`; dark bg `#1e232e`, text `#b6c9f5`. It can carry a leading icon (git-merge for "Merge", GitHub mark for "GitHub").
- Busy variant: neutral `#f5f5f5` / `#252525` bg, 14 px spinner, secondary text ("Resolving", "Merging").

There are **no solid-filled buttons in the card**. The only solid fill in the product is the send button.

### 4.6 Check chips row (only in the "Ready to merge" state)
Chips are h 28, radius full, 1 px border `#ececec` (dark `#2c2c2c`), card fill, padding 0 12 px, gap 8. Content: a 12 px green check, 6 px gap, label (primary), a space, value (secondary). Example: "✓ Tests 42 passed". Hovering a chip shows a tooltip (see 4.8).

### 4.7 Conflict popover (hover on the dotted "3 conflicts" link)
- Trigger: the amber "3 conflicts" text with a **1 px dotted underline** in a lighter amber (`#d8b98a` light, `#5f5e56` dark) about 3 px below the baseline.
- Panel: ~456 × 325 px. Opens **above** the trigger with an 8 px gap and its left edge about 34 px inside the card. Radius ~12, 1 px border (`#ececec` / `#262626`), fill `#ffffff` / `#191919` (opaque, covering the graph). Shadow ≈ `0 8px 24px rgba(0,0,0,.08)` (light); in dark the content behind darkens to about `#141414` around the panel.
- Content:
  - Header line: "**Lena Park** changed the same lines on main" (name primary/500, rest secondary), then a 1 px divider, padding 16.
  - Three file sections: "**middleware.ts** line 18" (file primary/500, line secondary). Then two code lines, each with a **2 px left bar** (Lena peach, You blue), a sans author label (secondary, ~44 px column) and mono code (primary).
  - 1 px dividers between sections.
- Closing: opacity fade of about 100 ms, no scale.

### 4.8 Tooltip (hover on a check chip)
A single line about 30 px tall: radius ~10, 1 px border, white / `#1a1a1a` fill, soft shadow, padding 0 16 px. It shows the tool and outcome in primary text and the duration in secondary text, e.g. "vitest · 42 passed, 0 failed   38s", "eslint · no problems   9s", "tsc --noEmit · no errors   21s", "Deployed to session-refresh.preview.acme.dev   1m 4s". It sits 8 px above the chip, left-aligned to it, and overlaps the row above (t022). It fades and un-blurs in (~150 ms).

### 4.9 Disclosure line ("Thinking Ns" → "Worked for Ns")
- Chevron-right, 12 px, tertiary, at x ≈ 7 px inside the column, followed by a ~32 px gap. The label starts at the second graph lane (x + 46), so it lines up with the card's graph.
- While running: "Thinking" in primary with a moving shimmer, plus a tertiary seconds counter that ticks once a second ("1s", "2s" …).
- When done: one secondary-tone string, "Worked for 5s". It is collapsible; the expanded state is never shown.

### 4.10 User bubble
Right-aligned. h ~44, padding ~10 / 17, radius full. Fill `#f6f6f6` with a faint 6–8 px halo shadow (light) / `#252525` with no shadow (dark). Text 16 px primary. No avatar, no timestamp.

### 4.11 Chips above the composer ("context chips")
- h **32**, radius full, 1 px border `#ececec`, white fill, a faint halo shadow, padding 0 12 px, gap ~4–6 px between chips. Dark: fill `#191919`, border `#2c2c2c` (lighter on top), a dark drop shadow below.
- **Chip 1, the PR status chip** (it morphs through every state): quick action "Create PR" → "◌ Creating PR" → "● #128 3 conflicts" (amber 8 px dot with halo, "#128" primary, state word in amber) → "◌ #128 Resolving" → "● #128 Ready to merge" (green) → "◌ #128 Merging" → "⑂ #128 Merged" (violet git-merge icon and word).
- **Chip 2, the diffstat chip**: "+482 −37 ▪▪▪▪▪ ⌄". Green and red numbers (sans), then five ~7 × 7 px squares with radius 1.5 and a ~1.5 px gap (3 green, 1 red, 1 empty, GitHub-style), then a 12 px chevron-down in tertiary. **It is removed once the PR is merged.**

### 4.12 Composer
- 690 × 130, radius ~18, 1 px border `#ededed` with a soft halo shadow (light). Dark: `#191919` fill with a `#252525` top highlight.
- Padding 16. Placeholder "Ask anything, or type / for skills" (16 px, tertiary), with roughly two lines of empty space before the toolbar.
- Toolbar (36 px controls, aligned to the bottom):
  - **+** button: 36 px circle, `#f5f5f5` / `#252525`, 12 px plus in secondary.
  - **Repo pill**: h 36, ~143 wide, radius full, raised fill, 15 px folder icon + 8 px gap + "acme-webapp" (secondary).
  - **Segmented control**: track ~124 × 36, raised fill, radius full, 2 px inset. Active thumb "laptop-icon Local" is white with a hairline ring and a 1 px shadow (light) or `#3a3a3a` (dark), with primary text. The inactive cloud-icon segment is ~44 wide.
  - Right group: **effort** = a 4-bar signal icon (bars 2.5 px wide, 1.5 px gap, rising height; the first 2 bars primary, the last 2 tertiary, meaning "medium") + "Medium" (15, secondary). Then a 16 px **mic** icon (secondary). Then the **send button**: 36 px blue circle with a 2 px white arrow-up.

### 4.13 Icons
Lucide-style outline icons at 1.5 px stroke, 14–16 px, in the secondary text colour unless the icon carries state (amber triangle-alert, green check, violet git-merge). Used: chevron-right, chevron-down, plus, folder, laptop, cloud, mic, arrow-up, triangle-alert, check, git-merge, GitHub mark. The spinner is a 270° thin arc (1.5 px), rotating continuously at about 0.8–1 s per turn.

---

## 5. Component inventory and states

| Component | States seen |
|---|---|
| PR card | building (no "#128", no status) → open/checking → conflicts → resolving (n/3) → testing (n/42) → ready → merging → merged |
| Commit row | entering (peach band, scrambled text) · normal · active (light band, spinner node, shimmer text, counter, progress underline) · conflicted (amber) · resolving (amber spinner node, text goes to primary) · resolved (muted, green check badge, then the badge disappears) · merged sweep (lavender band) |
| Graph node | dot · spinner ring · hollow ring · dashed circle · warn disc + halo · success disc · merged disc |
| Branch chip | blue (yours) · teal (other) · grey `main` · violet (merged). **The blue chip moves to the new HEAD commit** when the merge commit is created. |
| Conflict badge | amber number → green check → removed |
| Header status | none → "● Open" (green) → "● Merged" (violet) |
| Footer | live step + nothing → summary + action → live step + busy button → checks + "✓ Ready to merge" + Merge → "Merging into main" + busy → "⑂ Merged into main" + GitHub |
| Progress | 2 px green bar under the active row title, from the text start to the right content edge, on a grey track; the counter on the right ticks |
| Popover | closed / open (hover) |
| Tooltip | per check chip |
| Disclosure | Thinking (shimmer, ticking) → Worked for Ns |
| Prose | streaming (word blur-in) → static |
| Status chip | 7 states (see 4.11) |
| Diffstat chip | present → removed on merge |
| Composer | idle (unchanged throughout; the agent's state is never shown inside the input) |

---

## 6. Motion

Times below come from 10–15 fps sheets (`extra/ml_sheet_*.png`). "~" means the estimate is accurate to within one sample.

| Event | What happens | Timing / easing |
|---|---|---|
| Click the quick-action chip "Create PR" | The chip text swaps to "◌ Creating PR" with a **blur-crossfade**. The user bubble appears above at the right. The stack re-centres, so the composer glides down. | swap ~100 ms; layout glide ~250–300 ms, ease-out |
| Disclosure appears | "Thinking 0s" fades and un-blurs in above the composer, ~1 s after send | ~200 ms |
| Card enters | Border and title fade in first, then **rows reveal bottom-up** (oldest commit first, so history "builds up" to HEAD): opacity 0→1, blur ~4 px → 0, slight upward drift | ~40–60 ms stagger per row, ~400 ms total |
| Step label in footer | Text changes in place with a blur-crossfade. While active, a **shimmer** (a lighter band ~40 px wide moving left to right) sweeps the glyphs, e.g. "Pushing 3 commits to origin" with "origin" lighter | shimmer period ~1.2–1.5 s, linear, looping |
| Commit lands | The spinner ring on the head node becomes a solid dot | crossfade ~150 ms |
| **Row insert at top** | Rows below push down (height 0→32), the dashed connector draws, a ghost of scrambled text blurs in, then a **peach band** appears behind the new row | open ~150–200 ms (ease-out) |
| **Text decode (scramble)** | Random alphanumerics resolve **left to right** into the final string: "Mxwzx ae2" → "Merge gv9y ch" → "Merge into lyjb" → "Merge into maix" → "Merge into main". Used for every new row title and for "Merged into main". | ~450–500 ms, about 30 ms per locked character |
| Header meta | "#128" and "● Open" fade and un-blur in once the PR exists | ~200 ms |
| Peach band | Stays on the inserting row and moves to the next inserted row (t007 "Rotate session keys"), then fades | fade ~300 ms |
| Conflict found | The target node morphs dashed circle → amber disc with halo. Two `main` commits are inserted between yours (rows push down) with amber text and badges. The meta becomes "3 conflicts". The footer swaps to "⚠ 3 conflicts with main" + "Resolve conflicts". The chip morphs. The disclosure becomes "Worked for 5s". | each ~150–250 ms, sequenced ~100 ms apart |
| Prose streams | Words appear in small groups (2–3 words). Each fades in from blur (~6 px → 0) and opacity 0 → 1; the leading edge is visibly blurred (t009). | ~60–80 ms per word, fade ~250 ms |
| Popover | Fades in above the trigger; closes with ~100 ms opacity | ~120 ms in |
| Click "Resolve conflicts" | The button morphs in place: same pill, the fill goes blue-tint → neutral, the label blur-swaps to "◌ Resolving". The footer label becomes "Merging main into the branch" with shimmer. | ~150 ms |
| Each conflict resolved | The conflicted node becomes an amber spinner, the row text animates amber → primary, then → muted with a green check badge. The meta counts down "3 conflicts → 2 conflicts → 1 conflict → resolved". The new merge row's counter goes "1/3 → 2/3 → 3/3". | ~0.8–1 s per conflict |
| Tests | 2 px green progress bar fills under the merge row; counter "32/42 → 36/42"; footer "Running 36 of 42 tests" | linear fill, ~1.5 s |
| Ready | The check-chip row expands (height) above the footer, chips fading in; the node turns green; meta "ready"; the button becomes "⑂ Merge"; badges vanish | ~250 ms |
| Tooltip | Fade/blur-in above the chip on hover; moves chip to chip | ~150 ms |
| Click "Merge" | Button → "◌ Merging". Then the **check row collapses**, the head node becomes a large violet disc, "Merged into main" decodes in, a **lavender band sweeps your commit rows** (fading out ~1 s later), blue dots and lines **recolour to violet top-to-bottom**, the blue chip turns violet, and the footer swaps to "⑂ Merged into main" + "GitHub". The diffstat chip collapses away and the status chip becomes "⑂ #128 Merged". | whole choreography ~1.2 s; cascade ~40 ms per row |
| Content swaps in general | **blur(4–6 px) + opacity crossfade** (dark t028 shows the old footer label and button blurred mid-swap). No slides, no bounces, no scale pops. | 150–250 ms, ease-out (≈ `cubic-bezier(.2,.8,.2,1)`) |

Things that never animate: the composer, the card's outer frame (it only grows in height), and the page background. Numbers change by **swapping** with the blur crossfade, not by rolling digits.

---

## 7. Interaction patterns

1. **One card, mutated in place, for the entire task.** Creating the PR, detecting conflicts, resolving, testing, and merging all happen inside the same card. The agent never posts a new card per step; the card **is** the state of the PR. (Contrast: a log of messages.)
2. **The card's footer is the agent's "now" line.** Left: what it is doing right now (shimmering present participle). Right: the single next action. When the agent is busy, the action button turns into a disabled busy pill in the same place, so the click target and the feedback occupy the same pixels.
3. **Prose after, not before.** The summary sentence explains *why* (Lena's key rotation touched the same lines) and offers the action ("I can merge main in and resolve them"). The card shows *what*. The prose is written once and **is not rewritten** as the state changes afterwards: it stays as the historical explanation.
4. **Progressive disclosure on hover, never on click.** The details of the conflicts live in a hover popover on the dotted "3 conflicts" link, and the check details live in chip tooltips. The main surface stays at one line per commit.
5. **Mirrored state outside the card.** The chip row above the composer repeats the PR state (status chip) and the diff size, so the state stays visible when the card scrolls out of view (t021). The composer itself never changes.
6. **Thinking timer.** "Thinking Ns" ticks while working and settles to "Worked for Ns". The timer tells you that the agent is alive without spinners in the prose.
7. **Loading states are real.** Every pending thing has a shape: dashed node (unknown), spinner node (in progress), counter (n/m), progress bar (measurable), shimmer text (unmeasurable step). Nothing is a full-card skeleton or an overlay spinner.
8. **Edge cases handled in copy**: singular/plural ("1 conflict" vs "3 conflicts"), relative times down to "now", the counter swapped in for hash/author while a row is active, and `main` moving underneath you during the operation.
9. **Error state = amber, not red.** A merge conflict is shown as warning amber with a clear next step. Red appears only in the diffstat (deletions).
10. **Empty state**: just the composer, centred, with one contextual quick action ("Create PR") and the diffstat of the working tree. No greeting, no suggestions grid.

---

## 8. Microcopy

- Sentence case everywhere ("Resolve conflicts", "Ready to merge", "Merged into main"). No title case, no ALL-CAPS labels, no exclamation marks, no emoji in the UI.
- Status lines are **present participles + object**, short and concrete: "Committing the last changes", "Pushing 3 commits to origin", "Opening the pull request", "Fetching main", "Checking it merges cleanly", "Merging main into the branch", "Resolving conflict 2 of 3", "Running 36 of 42 tests", "Pushing the merge", "Merging into main".
- Results are past tense or adjectives: "ready", "resolved", "merged", "passed", "no problems", "no errors".
- Meta words in the meta slot are lowercase ("checking", "ready", "merged", "resolved"); badge-like headers are capitalised ("Open", "Merged").
- Numbers are written as digits: "3 conflicts", "42 passed", "36/42", "+482 −37", "#128". The minus is a true minus (−). Durations are compact with a space between units ("38s", "9s", "21s", "1m 4s"). Relative times are "now", "6m", "25m", "2h", "3h", joined to the author with " · ".
- People: "You" for the user, first names in rows ("Lena", "Sam"), full name in the popover ("Lena Park").
- Agent prose: first person, plain, about 40 words, one idea per sentence. It names the cause and offers the fix: "PR **#128** is open, but `main` moved on while we worked: Lena's session key rotation changed the same lines in `auth.ts` and `middleware.ts`. I can merge `main` in and resolve them." Note the "we".
- Composer placeholder teaches one feature: "Ask anything, or type / for skills".

---

## 9. Why it feels clean (and what would make it "vibe-coded")

What makes it clean:
1. **One column, one width, one left edge.** Every element starts at x = 358 and ends at x = 1048. Inside the card, the graph lanes and the "Thinking" label share an x grid.
2. **No size hierarchy, only colour hierarchy.** Text sits at 12.5–16 px with three greys and one weight step, so nothing shouts.
3. **Border-defined surfaces on an identical fill** (white on white in light; one step lighter in dark) with almost invisible shadows. There are no gradients, no glass, no coloured backgrounds on large areas.
4. **Colour is semantic and sparse.** Blue = yours / action, teal = someone else's branch, grey = main, amber = needs attention, green = good, violet = done. Each colour appears in small doses (8 px dots, chip text, one button).
5. **Fixed rhythm**: 32 px rows, 16 px padding, 8 px gaps, 28 / 32 / 36 px control heights (card buttons / chips / composer controls), and full radius on every control with 16 px on the large surfaces.
6. **The UI mutates instead of appending.** Rows insert, labels decode, chips migrate and buttons morph in place. The history is *in the component*, not in a scrolling log.
7. **Motion is quiet and consistent**: the same blur-crossfade for every swap, with small decode and shimmer accents for "work in progress". Nothing bounces, flips or slides across the screen.
8. **Mono only for machine strings**, so code-ish things read as code and the rest reads as language.
9. **Details are one hover away**, so the surface stays scannable.

What would make it look vibe-coded (the opposite of each, consistent with Pitus's critiques in `pitus-method.md`: "spacing all over the place", "gradients", "hierarchy is bad, everything is the same size", "buttons too wide/tall", "flip animation"):
- Mixed widths (card wider than the prose or composer), uneven gaps, or rows of different heights.
- Big bold headers inside the card, coloured header bars, gradient fills, or heavy drop shadows.
- Every status as a coloured pill with a bg; red for a merge conflict; emoji status icons.
- Full-width or tall solid primary buttons; several buttons per state.
- A new card or message per step, with a log of "✅ Done: …" lines.
- Flip, slide or bounce animations; spinners overlaid on the whole card; skeleton blocks.
- Mono font used for everything "techy", including numbers and labels.

---

## 10. Light ↔ dark token map (implementation-ready)

```css
:root {
  --bg-page: #ffffff;   --bg-card: #ffffff;   --bg-raised: #f5f5f5;  --bg-thumb: #ffffff;
  --border: #ededed;    --border-strong: #e5e5e5; --divider: #f0f0f0;
  --text-1: #171717;    --text-2: #737373;    --text-3: #a3a3a3;
  --blue: #3b82f6;      --blue-line: #a1ccf5; --blue-text: #2b54a8; --blue-tint: #edf2fc;   --blue-chip: #f1f6fe;
  --teal: #1fd2ad;      --teal-line: #b2e7d6; --teal-text: #0f8a6c; --teal-tint: #f3fffb;
  --grey-dot: #c0c0c0;  --grey-line: #d4d4d4; --grey-chip: #f1f1f1;
  --amber: #f0a80d;     --amber-text: #b45309; --amber-halo: #fdeccb; --amber-ring: #f8d9a6; --row-peach: #fcf3ed;
  --green: #22c55e;     --green-node: #1fe25c; --green-text: #1f9a3e; --green-tint: #f0fdf4; --progress: #33e16b; --track: #f0f0f0;
  --violet: #8b5cf6;    --violet-text: #6d28d9; --violet-tint: #f6f5fd; --row-lavender: #f6f5ff;
  --diff-add: #1f8f3e;  --diff-del: #9f1239;   --sq-add: #5bda7a; --sq-del: #de4d55; --sq-empty: #e6e5e8;
  --send: #2f6bea;      --pop-lena: #f2bd94;   --pop-you: #a3cbf3;
  --shadow-card: 0 4px 16px -4px rgba(0,0,0,.04);
  --shadow-pop: 0 8px 24px rgba(0,0,0,.08);
}
[data-theme="dark"] {
  --bg-page: #0f0f0f;   --bg-card: #191919;   --bg-raised: #252525;  --bg-thumb: #3a3a3a;
  --border: #252525;    --border-strong: #2c2c2c; --divider: #282828;   /* top edge reads ~#272727 */
  --text-1: #f0f0f0;    --text-2: #a3a3a3;    --text-3: #6e6e6e;
  --blue: #4880e8;      --blue-line: #435379; --blue-text: #b6c9f5; --blue-tint: #1e232e;   --blue-chip: #162333;
  --teal: #2de0a1;      --teal-line: #406e5f; --teal-text: #8be6c5; --teal-tint: #122f23;
  --grey-dot: #5e5e5e;  --grey-line: #3a3a3a; --grey-chip: #252525;
  --amber: #e59f1c;     --amber-text: #e9b04a; --amber-halo: #3a2a0f; --amber-ring: #5a4220; --row-peach: #2a211b;
  --green: #50e359;     --green-node: #3ddc5f; --green-text: #5fd16a; --green-tint: #132815; --progress: #33d965; --track: #262626;
  --violet: #8e3ef3;    --violet-text: #b699f9; --violet-tint: #20182f; --row-lavender: #211c2c;
  --diff-add: #6ec271;  --diff-del: #c2435b;   --sq-add: #3fcf5f; --sq-del: #d13a50; --sq-empty: #3a3a3a;
  --send: #2f5cdd;      --pop-lena: #985f40;   --pop-you: #3c5085;
  --shadow-card: none;  /* elevation = fill step; borders brighter on top */
  --shadow-pop: 0 8px 24px rgba(0,0,0,.5);
}
```

Geometry tokens (both themes): column 690; card radius 16, padding 16; row 32; graph gutter 66 with lanes at 11 / 29 / 48; dot 8; target node 16; line 1.5; branch chip h 20, r 5, px 6; badge 18; card button h 28; chips h 28 (check) and 32 (context); composer 130 tall, r ~18, controls 36; gaps 8 (chips → composer), ~16 (inside a turn), ~32 (prose → chips).

Dark-mode specifics beyond the token swap:
- Card and composer use a fill step (`#191919` on `#0f0f0f`) rather than shadow. The border is about 1 px lighter on the top edge, which reads as a lit edge.
- Chips above the composer get a **dark** drop shadow below (`#0b0b0b` under the edge), not a halo.
- The active segment "Local" is lighter (`#3a3a3a`) than its track (`#252525`). In light the thumb is white on `#f5f5f5`.
- Tinted chips and buttons go to deep tints with pastel text. Saturation is kept in the dots and lines, while text inside chips is desaturated pastel.
- The user bubble loses its halo; it is just `#252525`.
- Accent hues are unchanged; only lightness shifts. This keeps the semantic colour map identical across themes.
