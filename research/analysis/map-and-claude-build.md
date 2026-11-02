# Phil Pitus: "Generative UI #1, Map" and "Built entirely with Claude", design spec

Source videos: `videos/01-map.mp4` (2892x2160, 60 fps, 21.6 s) and `videos/08-built-with-claude.mp4` (3840x2148, 60 fps, 19.4 s).
Frames used: every `t*.jpg` and `s*.jpg` in both folders, plus contact sheets and full-resolution crops in `frames/01-map/extra/` and `frames/08-built-with-claude/extra/` (`sheet_intro_*`, `sheet_page1`, `sheet_card_swap`, `sheet_theme`, `sheet_palette_open`, `sheet_send`, `sheet_hover1`, `c_*.png`, `full_*.png`).

## 0. Measurement method and scale

- Sizes were measured on the full-resolution source frames with a pixel script (ffmpeg rgb24 + node): edge scans, dark-pixel row/column extents, colour histograms. Colours come from 4x4 to 10x10 averages or histogram modes, so they include H.264 softening. Treat them as ±3 per channel. Saturated accents read slightly duller than the real CSS.
- Both videos are screen recordings with Screen Studio-style camera zooms and motion blur (see map t006, t010, t019, t021). **The camera moves are part of the recording, not part of the UI.** Every measurement below comes from the un-zoomed rest state (map t004/t022, Claude t002/t019).
- **Scale for 01-map:** the Inter cap height of 16 px body text measures 30 source px (Inter cap height = 0.727 em), so 1 CSS px ≈ 2.58 source px ≈ **1.43 px in the 1600-wide frames**. This is cross-checked: 14 px meta text measures 26 source px of cap height, the card aspect comes out at exactly 5:3, and paddings land on 4/8/12/16.
- **Scale for 08-built-with-claude:** the title cap height is also 30 source px, and the body cap height is 27 source px. The same 2.58 src/CSS scale gives a 16 px title, 14 px body and 4/8/16/24 spacings, so I assume the same browser zoom. **1 CSS px ≈ 1.07 px in its 1600-wide frames.**
- All px values below are **CSS px at that scale**. Where I give a frame value, it is labelled.

---

## 1. Canvas and layout

### 01-map (chat with an inline generated component)
| Property | Value |
|---|---|
| Page background | pure `#FFFFFF`, with no texture, gradient or sidebar in view |
| Content column | **~696 px** wide (map card measured 695 px; use `max-width: 696px` or `44rem` = 704), centred horizontally |
| Alignment | Assistant prose and cards are flush left to the column edge. The user bubble is flush right to the same edge. |
| Top padding | ~70 px from viewport top to the user bubble |
| User bubble → assistant text | ~24-28 px from the bubble bottom to the first line box |
| Prose → card | ~20 px from the last line box to the card top |
| Card → following prose | ~16 px |
| Card width | the **full column width**. The component is the same width as the prose, so it reads as part of the message, not as a widget in a frame. |
| Card aspect | **5:3** (695 x 417). The info card overlays the map's bottom edge and does not add height. |
| Avatars, names, timestamps, message chrome | **none**. The assistant has no bubble, no avatar and no "Assistant" label. Prose sits on the page and the component sits in the prose. |

The message order is **one sentence → component → one follow-up paragraph**. The component never stands alone; prose frames it before and after.

### 08-built-with-claude (landing-page feature row)
| Property | Value |
|---|---|
| Page background | `#F5F5F5` (neutral warm-free grey) |
| Layout | 3 equal cards in a row, horizontally centred, vertically centred in the viewport |
| Card width | ~380 px; gap between cards ~18 px (source 46 px; use 16 or 20) |
| Card height | ~414 px; the illustration panel takes the top ~72% (~297 px), text the bottom ~28% |
| Row width | ~1176 px |

---

## 2. Typography

Font: **Inter**. The double-storey a, the flat-topped t, the open é accent and the straight-legged R in "Remote" all match Inter's default (no `ss01`/`cv` alternates visible). Numbers are Inter default numerals. **No monospace is used anywhere** in either video, so mono is not part of this vocabulary. SF Pro would look close but has rounder punctuation and a narrower R; this is Inter.

### Map video
| Role | Size / line-height | Weight | Colour | Notes |
|---|---|---|---|---|
| Assistant prose | **16 / 25-26 px** (line pitch 65 src px ≈ 25.2 px; use 1.6) | 400 | `#1A1A1A` (darkest pixel `#141414`) | letter-spacing 0 |
| Emphasised entities in prose ("Linden Park.", "The Boathouse,") | 16 | **600** | `#171717` | Bold wraps the name *and* the trailing punctuation ("Linden Park." bold), which is a markdown `**…**` artefact he kept |
| User bubble text | 16 / 25 | 400 | `#1A1A1A` | same as prose |
| Info card title ("Fern & Fig") | 16 / 20 | **500** | `#1D1D1D` | same size as body; hierarchy comes from weight and position, not size |
| Rating "★ 4.8" | 14-15 | 400 | `#6B6B6B` | star glyph is solid, same grey, ~11 px, 6 px gap before the number |
| Meta line ("Lakeside café · 5 min walk") | **14 / 20** | 400 | `#666666` | middle dot `·` with single spaces |
| Feature chips ("Quiet mornings") | 14 / 20 | 400 | `#696969` | each has a 14 px outline icon in the same grey |
| Pager "1 / 3" | 14 | 400 | `#9F9F9F` | spaces around the slash; tabular figures advisable |
| Button label "Send to iPhone" | 15 | 500 | blue, about `#3B78D8` (sampled `#4986D3`) | |
| Map pin label: name | 13 | 500 | `#1A1A1A` on white / `#FFFFFF` on dark | |
| Map pin label: time "4 min" | 13 | 400 | `#999999` on white / `#A0A0A0` on dark | 6 px gap after the name |
| Map area labels ("Linden Park", "Linden Lake") | 13 | 500 | tinted to the area: park `#4A9A2A` (sampled `#438D1E`), lake `#2A6FA0` (sampled `#23678E`) | No halo or stroke; set on flat fills |
| Street label ("North St") | ~10 | 500 | `#BDBDBD`, rotated to street angle | barely visible, only when zoomed out |
| Palette label ("Earth") | 14 | 400 | `#6B6A62` | names the hovered swatch |

### Claude feature cards
| Role | Size / line-height | Weight | Colour |
|---|---|---|---|
| Card title ("Thinks in branches") | **16 / 20** | 500 | `#0A0A0A` (darkest pixel pure `#000`) |
| Card body ("Tries ideas on the side…") | **14 / 24** (line pitch 62 src px) | 400 | `#5C5C5C` (darkest `#595959`) |
| Title → body | ~8 px gap (27 px cap-top to cap-top) |

Rules visible across both videos:
- **Only two sizes do the work: 16 and 14** (13 inside the map). There are no display sizes and no headings.
- **Only three weights: 400, 500, 600.** 600 appears only for inline emphasis in prose.
- Three text tiers: near-black (`#1A1A1A`), mid-grey (`#666`), light grey (`#999-#9F9F9F`) for counters and secondary numbers.
- No uppercase labels, no letter-spaced caps, no italics.

---

## 3. Colour

### Neutrals (light)
| Token | Hex | Use |
|---|---|---|
| `bg/page` | `#FFFFFF` (map), `#F5F5F5` (Claude page) | canvas |
| `bg/subtle` | `#F8F8F8` | user bubble |
| `bg/panel` | `#FAFAFA` | illustration panel inside the Claude card |
| `surface` | `#FFFFFF` | cards, pins, palette pill, floating info card |
| `border/hairline` | `#E0E0E0` to `#E6E6E3` (≈ `rgba(0,0,0,0.08)`) | card edges, 1 px |
| `border/faint` | `#F3F3F3` to `#F5F5F5` | info-card top edge, bubble rim |
| `text/primary` | `#1A1A1A` | |
| `text/secondary` | `#666666` | |
| `text/tertiary` | `#9A9A9A` to `#9F9F9F` | pager, pin minutes |
| `text/inverse` | `#FFFFFF` | on the dark selected pin |
| `fill/inverse` | `#1F1F1F` to `#202020` | selected map pin |

### Accent
- **One accent: blue.** Route and user dot `#4A8CF5` (sampled `#458EF6`); button text about `#3B78D8`; button fill `#EDF2FD` (a 6-8% tint of the same blue); Claude illustration highlight `#3B7BEA` (sampled `#4882E5`) with tinted fill `#D8E4FC`.
- The accent appears **only on what is live or actionable**: the active route, your location, the primary action, and the animated part of an illustration. Everything else is greyscale.
- No success/warning/danger colours appear in these two videos. "Sent" success keeps the **same blue**, with a check icon replacing the phone icon. It does not turn green.

### Map themes (five, switchable)
Each theme recolours the whole component (map, route, pins, info card, button), not only the tiles. Hex values are approximate fills.

| Theme | Blocks / land | Streets | Park lawn / trees | Water | Route + user dot | Info card / button |
|---|---|---|---|---|---|---|
| **Vivid** (default) | `#F0EEEA` | `#FFFFFF` | lawn `#DEF4CD`, trees `#AFE591` | `#9DD0F1` | `#4A8CF5` | white card; button `#EDF2FD` / blue text |
| **Earth** | `#F0E5D8` warm sand | `#FAF8F1` | lawn `#E5EACA`, trees sage `#B1C587` | sea-glass `#B3D5D0` | terracotta `#C4622D` | card `#FEFCF9`; button peach `#F8EDE6` / text `#B05A35` |
| **Autumn** | `#F1ECE3` | `#FBF8F2` | lawn `#F6EACC`, trees mottled orange `#E9A15A`→`#E9B770` | `#ACD9E8` | blue (unchanged) | white |
| **Paper** | `#F3F3F1` | `#FFFFFF` | lawn `#F4F4F2`, trees `#DFE4DC` | `#E1EAEE` | **near-black `#1F1F1F`**, user dot black | button grey `#ECECEC` / text `#1A1A1A` |
| **Night** | `#222327` | `#2E3035` | lawn `#2B4C34`, trees `#366A43` | `#1E3E5F` | `#5995FF` with white ring on the user dot | card `#2C2D33`; pins `#313138` with white text; **selected pin inverts to light `#F2F2F2` with dark text**; button `#343D4C` / text `#8AB0F5`; labels park `#86C393`, lake `#8FB5E8` |

Swatch design: each swatch is a 20 px circle **split diagonally into two halves** (land colour / water colour). Night is green over navy, Paper is light grey, Autumn is orange over light blue, Earth is sage over grey-green, and Vivid is green over blue. The swatch shows the theme's two defining colours instead of a name.

### Claude illustration palette
Line art only: strokes `#B9B9B9`-`#C4C4C4` at ~1 px, top faces `#FFFFFF`, recessed faces `#F3F3F3`/`#F0F0F0`, side faces `#FAFAFA`, on a `#FAFAFA` panel. The only colour is the blue accent on the moving part.

---

## 4. Surfaces

### User bubble
- `background: #F8F8F8`; `border-radius: 20px`; `padding: 11px 16px` (2 lines = 72 px tall).
- Edge: a near-invisible 1 px rim (`#F5F5F5`) plus a very soft outer haze (pixels ~`#FDFDFD` for ~8 px around it). Use `box-shadow: 0 0 0 1px rgba(0,0,0,0.02), 0 2px 10px rgba(0,0,0,0.025)`. It barely separates from white, which is the point.
- Width hugs content up to ~528 px (≈ 76% of the column) and is right-aligned.

### Map card (the generated component)
- 696 x 417 (5:3), `border-radius: 16px`, `overflow: hidden`.
- Edge: 1 px `rgba(0,0,0,0.08)` (`#E6E6E3` on the map tint). There is no visible drop shadow on the page; the map content defines the shape.
- The bottom ~60 px of the map darkens slightly (`#F0EEEA` → `#E2E0DC`), which works as a scrim so the floating card separates.

### Floating info card (inside the map)
- Inset **12 px** from the left, right and bottom map edges; full width minus 24; height ~98 px.
- `background: #FFF`; `border-radius: 12px`; 1 px top hairline `#F3F3F3`; soft shadow below (`0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)`).
- `padding: 12px`. Thumbnail **74 x 74** (round to 72 or 76), `border-radius: 8px`, real photo, `object-fit: cover`.
- 16 px gap from the thumbnail to the text block. Text rows: title row (16/500 + ★ rating), meta row (14 grey), chips row (14 grey + icons) with ~6 px between rows. The title and meta sit at the thumbnail top; the chips align with the thumbnail bottom.
- Right column: pager top-right, primary button bottom-right, right padding 16.

### Map pins (labels)
- Pill: height ~26 px, `border-radius: 999px`, padding `0 12px`, white with `0 1px 3px rgba(0,0,0,0.12)`. Content is name (13/500) plus minutes (13/400 grey).
- **The pill floats above its anchor.** The anchor is a separate small dot ~16 px below the pill. Unselected: 6 px white dot with a 1.5 px grey (`#BDBDBD`) ring. Selected: 5 px black dot with a white ring, which is the route's end.
- Selected pill: `#1F1F1F` fill, white name, grey `#9A9A9A` minutes.
- Night: unselected pills are dark `#313138`; the selected pill inverts to light.

### User location dot
- 9 px solid blue, 2 px white ring, and a 24 px blue halo at ~15% opacity (`#4A8CF5` @ .15). In Night the ring is white and the dot sits on a dark halo.

### Route
- Stroke ~3 px, `stroke-linecap: round`, `stroke-linejoin: round`. It follows streets with ~8 px rounded corners, never a straight "as the crow flies" line. Theme accent colour.

### Theme button and palette pill
- Closed: a 36 px white circle, `0 1px 4px rgba(0,0,0,0.12)`, holding the current 20 px split swatch. Top-right, inset 12 px.
- Open: a pill ~212 x 34 px (white, same shadow, `border-radius: 999px`, padding `0 6px 0 14px`). Left to right it holds a label (14/400 grey, ~60 px slot) and then 5 swatches of 20 px at 30 px centre spacing (10 px gaps).
- Selected swatch: 2 px `#1A1A1A` ring with a 2 px white gap (ring diameter ~28 px).
- In Night the pill is `#2F2F36` and the ring is white.

### Primary inline button ("Send to iPhone")
- Pill, height ~32 px, `border-radius: 999px`, `padding: 0 14px`, fixed width (~138 px, the width of its longest label).
- Fill: the 8% tint of the accent (`#EDF2FD`); text and icon in the accent (15/500); a 16 px outline phone icon with an 8 px gap.
- Hover: the fill deepens one step (~`#E3EBFB`). Pressed: a brief ~100 ms dim.
- It is **tinted, not solid.** There is no solid-blue primary button anywhere.

### Pager
- `‹  1 / 3  ›`: 16 px chevrons (1.5 stroke, `#6B6B6B`), counter `#9F9F9F` 14 px, ~16 px between items. There are no borders or button backgrounds; hit areas are invisible.

### Icons
- Outline style, 1.5 px stroke, round caps (Lucide/Phosphor-light family), 14 px in chips, 16 px in buttons and pager. Colour is always the text colour of their row.
- Icons seen: speaker (quiet), plug (outlets), waves (lake view), sun (bright tables), coffee cup (good espresso), wifi (fast Wi-Fi), moon (open till 9), smartphone, check, spinner.

### Claude feature card
- `background: #FFF`; 1 px border `#E0E0E0`; `border-radius: 8px`; resting shadow very soft and wide (pixels below the card are `#F2F2F2` on `#F5F5F5` for ~10 px → `0 4px 12px rgba(0,0,0,0.03)`).
- **Nested panel**: the illustration sits on a `#FAFAFA` panel **inset 4 px** from the card's top, left and right edges, with a ~4-5 px inner radius. This creates the "card inside a card" bezel.
- Text block: `padding: 20px 24px 24px`.
- Hover: the shadow grows (`0 8px 24px rgba(0,0,0,0.06)`). There is no scale, no border colour change and no lift you can see in translate.

---

## 5. Components (anatomy and states)

### 5.1 Chat turn
`UserBubble` → `AssistantProse` (markdown, bold entities, ends with ":") → `GeneratedComponent` → `AssistantProse` (alternatives + one instruction).

### 5.2 Interactive map (`MapCard`)
Anatomy, bottom to top:
1. Vector map: tilted street grid (≈ 8° rotation) and park polygon with lawn, organic tree blobs, paths and two lakes. Flat fills only, no textures, shading or 3D.
2. Area labels.
3. Route path.
4. User location dot with halo.
5. Destination anchors and floating name pills (3 places).
6. Theme button (top-right).
7. Floating info card (bottom).

States:
- **Loading/mount** (see Motion 6.1): built up in layers. There is no spinner or skeleton.
- **Selected place** (one of 3): dark pill, route drawn to it, and the camera fits route plus origin with padding. The info card shows that place.
- **Unselected places**: white pill with a grey ring anchor.
- **Theme**: 5 variants.
- Pins are clickable ("Tap one on the map to compare"); the pager and the pins drive the same selection.

### 5.3 Place info card (`PlaceCard`, inside the map)
Thumbnail · Title + ★ rating · type · walk time · 3 feature chips (icon + 1-2 words) · pager `n / 3` · primary action.
The three places each have their own 3 chips, chosen to answer the user's need ("work for a few hours" → outlets, quiet, Wi-Fi, bright tables). The chips are the reasoning, shown as data.

### 5.4 Action button with async states
`idle` "Send to iPhone" (phone icon) → `hover` (deeper tint) → `pending` "Sending..." (14 px ring spinner replaces the icon; the label dims slightly) → `done` "Sent to iPhone" (check icon that draws on). Width stays fixed in every state, so nothing next to it shifts. In the video the pending state lasts ~0.9 s and done persists.

### 5.5 Theme picker (`SwatchPopover`)
Closed circle → expands into a pill. The label shows **the hovered swatch's name** (hover previews the name; only a click applies). Moving the pointer off the pill collapses it back to the circle.

### 5.6 Feature card with "explaining" illustration (Claude video)
Isometric line illustration on an inset panel, then title, then 2-line body. Each illustration has an idle state (all grey) and a **hover loop that acts out the sentence below it**:
- *Thinks in branches*: a board with a branching groove. On hover a blue ball leaves a dispenser, runs up the side branch (a dashed blue "preview" line shows the branch being tried), retracts from the dead end, then travels the main channel and settles in the end hole with a ring pulse. ~4 s, then it holds. That is the copy ("tries ideas on the side, drops the dead ends and merges back") turned into motion.
- *Local or remote*: laptop and server tower joined by an arm-mounted tube. On hover the base slider moves, the tube fills blue as if liquid is flowing to the server, a server slot outlines blue with a status dot, and the laptop's first code line turns blue.
- *Effort you can dial*: a box with gears, a slider track and a gauge. On hover the slider knob (blue ball) slides from Low to Max and leaves a blue filled track, the gauge needle sweeps, and the gears turn.

---

## 6. Motion

### 6.1 Assistant turn mount (map; t = video seconds)
| t (s) | What happens |
|---|---|
| 0.8-1.55 | **Prose streams word by word.** Each word fades from 0 to 1 opacity over ~150 ms, so there is a soft ~3-word gradient tail (t002: "from you:" visibly grey). ~29 words in 0.75 s ≈ 40 words/s. There is no cursor or caret. |
| 1.6 | Card frame appears as a faint 1 px outline on white (no fill yet) |
| 1.7 | A single dot at the map centre (the destination) |
| 1.8-1.9 | Park polygon fades and scales in (from ~0.85, slightly smaller and rotated), then the lake fills |
| 2.0-2.2 | Street blocks appear **radiating outward from the park**, staggered by distance (~150 ms spread) |
| 2.2-2.4 | Trees, paths and the second lake detail fade in |
| 2.4-2.6 | Area labels, then pin pills fade in with a slight blur-to-sharp (~120 ms) |
| 2.7 | Location dot pops in |
| 2.8-3.0 | **Route draws** from origin to destination (stroke-dashoffset, ~250 ms, ease-out) |
| 3.0-3.2 | Info card slides up ~8 px and fades in (~200 ms ease-out) |
| 3.2 | Theme button fades in last |
| 3.2-3.6 | Map "camera" eases in ~6-8% (zoom to fit), ease-out |
| 3.5-4.2 | Follow-up paragraph streams with the same word fade |

Principle: **the component builds in its own semantic order** (place → context → options → answer → actions). Each layer is 100-200 ms with ~100 ms stagger, so the whole build takes ~1.5 s. There are no spinners or skeleton blocks.

### 6.2 Changing selection (pager next, ~6.5 s)
- t+0: the old route **disappears instantly**. The old selected pill fades to white (~70 ms through grey).
- t+0-60 ms: info-card content clears; for a single frame the card is empty white.
- t+70-200 ms: new content fades in from ~30% opacity and **slides ~4 px from the right** (direction of travel), ease-out ~150 ms. The thumbnail fades in parallel. The counter text swaps.
- t+70 ms: the new pill turns dark.
- t+70-300 ms: the new route draws from the user dot to the new destination.
- t+0-600 ms: the **map pans and zooms to fit the new route** (ease-in-out, ~500-600 ms). Fern & Fig is close, so it zooms in; Lumen Coffee is far, so it pans right and zooms out. The camera always frames origin plus destination with padding, so the "North St" label scrolls into view.

### 6.3 Theme picker open
- Click on the circle: the pill **grows leftward out of the circle** (width animation, ~150 ms, ease-out). The swatches fade and scale in right to left with ~20 ms stagger. The label fades in last (~70 ms after).
- Selected ring: the ring moves between swatches as a ~100 ms cross-fade. There is no sliding indicator.

### 6.4 Theme change (the signature transition)
- On click, the chrome (palette pill colour) cross-fades over ~150 ms first.
- Then the new theme is revealed through a **circular mask that expands from the centre of the map** (not from the cursor). It starts as a dot and the radius grows ~0 → 100% over **~450-500 ms**, accelerating slightly (ease-in-out, close to `cubic-bezier(0.65,0,0.35,1)`).
- The mask edge is **feathered** (~20-30 px soft gradient) and passes over everything in the component, including pins, info card and button. Under the circle the whole component is already the new theme (s002, t017).
- Implementation: render the next theme on a stacked layer and animate `mask-image: radial-gradient(circle at 50% 50%, #000 calc(var(--r) - 24px), transparent var(--r))`, or animate `clip-path: circle()` with a blur filter edge. The View Transitions API also works.

### 6.5 Async button
- Label swaps by cross-fade (~120 ms, with a slight blur on the outgoing label). The spinner is a 14 px 1.5 px-stroke ring rotating continuously (~800 ms/turn).
- On success the check icon **draws on** (stroke-dashoffset ~200 ms; t+1.4 s frame shows a half-drawn "v") while "Sent to iPhone" fades in. Width never changes.

### 6.6 Claude cards
- Page mount: cards fade in and rise (~8 px, ~300 ms ease-out) staggered left→right by ~100 ms. Titles and text are present before the illustrations. Illustrations then assemble: the base plate first, then the parts fade in over ~400 ms, also staggered per card.
- Hover: the shadow deepens (~200 ms). The illustration's blue story loop starts on hover and **finishes and holds its end state** rather than looping endlessly. Leaving the card reverts to grey (fade ~300 ms).
- Easing everywhere: smooth ease-out with no bounce, overshoot, spring wobble or flip.

---

## 7. Interaction patterns

- **Prose recommends; the component lets you verify.** "My pick is The Boathouse" lands in the first sentence, and the map shows why (route length, location on the lake). The closing paragraph gives the alternatives and **one verb** for the user: "Tap one on the map to compare."
- **Progressive disclosure:** one place is detailed in the card; the other two are only pins with minutes. Paging or tapping swaps detail, never stacking three cards.
- **Every control is in context.** The theme picker lives on the map, and the action ("Send to iPhone") lives on the place. There are no toolbars or settings panels.
- **Hover means preview, click means commit** (palette label vs applied theme).
- **Spatial continuity:** the camera re-frames instead of cutting, the route redraws from your location, and the card content slides in the direction you paged.
- **Async feedback is inline and stable:** the button itself carries pending and done. There are no toasts or modals.
- **Loading state = progressive construction**, never a spinner over a blank card. **Empty or error states are not shown** in these two clips. Following his method notes, design them, but in the same voice: inline, small and grey.
- **No "Thinking / Worked for Ns" pattern** appears in these two videos. The answer starts streaming immediately after the user bubble.
- On the Claude page, hover is the whole interaction: there are no CTAs or links. The illustration rewards attention by explaining itself.

---

## 8. Microcopy

- Sentence case everywhere ("Thinks in branches", "Send to iPhone", "Open till 9").
- The prose is conversational and decisive, with first-person opinion: "My pick is…". It gives concrete sensory reasons ("big windows, plenty of tables") and states distance relative to the user ("a five-minute walk from you").
- Numbers: **written out in prose** ("three good spots", "five-minute walk") but **numerals in UI** ("5 min", "4 min walk", "4.8", "1 / 3", "Open till 9", "9 min"). The unit is always "min" with a space, and there is no "mins".
- Chips are 1-2 word facts: "Quiet mornings", "Outlets", "Lake view", "Bright tables", "Good espresso", "Fast Wi-Fi", "Open till 9".
- Meta uses a middot: "Lakeside café · 5 min walk", "Bakery café · 4 min walk", "Coffee shop · 9 min walk".
- Button states are verb, then progressive with an ellipsis, then past tense with the same object: "Send to iPhone" → "Sending..." → "Sent to iPhone".
- Place names are believable and specific: The Boathouse, Fern & Fig, Lumen Coffee, Linden Park/Lake, North St.
- Claude cards: a 3-word title, then two short sentences (≤ ~45 characters per line, 2 lines), concrete and unhyped: "Runs on this Mac or in a cloud environment. One switch, and the session follows." "Quick answers on Low, deep work on Max. Set it for each prompt." There are no exclamation marks, emojis or "powerful/seamless" adjectives.

---

## 9. Why it feels clean

1. **Restraint in type:** two sizes (16/14) and three weights. Hierarchy comes from weight, grey tier and position, so "everything the same size" (his complaint about AI output) never happens, because the differences are deliberate and few.
2. **One accent, used semantically:** blue only on the live path, your position and the action. Everything else is neutral or the content's own colour (map greens, photos).
3. **No chrome around the AI:** no assistant bubble, avatar, header bar or gradient. The component is full column width and sits in the reading flow.
4. **Soft edges at low contrast:** 1 px borders at ~8% black, shadows under 6% opacity, bubble `#F8F8F8` on white. Shapes are implied, not outlined.
5. **Consistent radii in a family:** pills 999, info card 12, map 16, bubble 20, thumbnail 8, Claude card 8 with a 4 px inner bezel. Nested radius equals outer radius minus inset (map 16 − 12 inset ≈ card 12).
6. **A 4/8 spacing grid** with generous breathing room: 12 px insets inside the map, 16 px text gaps and 24 px card padding.
7. **Real content:** real photos, plausible names, specific numbers. Nothing reads "Lorem" or "Feature 1".
8. **Motion explains state:** each animation answers "what changed?" (route redraw, camera fit, directional slide, radial theme reveal). Durations are short (100-500 ms), easing is smooth, and nothing bounces.
9. **Fixed geometry under change:** the button width is fixed and the card size is fixed, so nothing reflows when the state changes.
10. **The illustration literally performs the sentence** (the Claude cards), so decoration carries meaning.

Signs of "vibe-coded" output this design avoids, as he lists them (method notes, and his 1/5 and 2/5 ratings of Opus outputs): spacing that varies at random; gradients used as decoration; every element at the same size and weight; buttons that are too wide or too tall; extra top cards and headers; flip animations; unbalanced colours; a generic "make it look nice" aesthetic. For contrast with these two clips, the AI-typical version would add a solid gradient primary button, a heading above the map ("📍 Nearby Cafés"), three stacked cards instead of one pager, a spinner instead of the layered build, a toast for "Sent!", and a hard cut on theme change.

## 10. Reproduction tokens (summary)

```css
:root{
  --font: "Inter", system-ui, sans-serif;
  --fs-body:16px; --lh-body:1.6; --fs-sm:14px; --lh-sm:20px; --fs-xs:13px;
  --text-1:#1A1A1A; --text-2:#666666; --text-3:#9A9A9A;
  --bg:#FFFFFF; --bg-subtle:#F8F8F8; --bg-panel:#FAFAFA; --page-grey:#F5F5F5;
  --hairline:rgba(0,0,0,.08); --hairline-faint:rgba(0,0,0,.04);
  --accent:#4A8CF5; --accent-text:#3B78D8; --accent-tint:#EDF2FD; --accent-tint-hover:#E3EBFB;
  --inverse:#1F1F1F;
  --r-pill:999px; --r-bubble:20px; --r-card-lg:16px; --r-card:12px; --r-card-sm:8px; --r-thumb:8px;
  --col:696px; --inset:12px;
  --shadow-float:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04);
  --shadow-pin:0 1px 3px rgba(0,0,0,.12);
  --shadow-rest:0 4px 12px rgba(0,0,0,.03); --shadow-hover:0 8px 24px rgba(0,0,0,.06);
  --ease-out:cubic-bezier(.2,.8,.2,1); --ease-inout:cubic-bezier(.65,0,.35,1);
  --dur-fast:120ms; --dur:200ms; --dur-slow:500ms;
}
```
