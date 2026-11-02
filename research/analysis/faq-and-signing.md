# Phil Pitus, Generative UI #4 (FAQ) and #5 (Document signing): design spec

Sources: `videos/04-faq.mp4` (2746x2160, 60 fps, 33.2 s) and `videos/05-doc-signing.mp4` (3042x2160, 60 fps, 37.6 s); 1 fps frames in `frames/04-faq/` and `frames/05-doc-signing/`; extra frames, 10 fps contact sheets and zoomed crops in each `extra/` folder. Every colour below was read from raw pixels of the source video (ffmpeg to rgb24, then a small node script). It was not eyeballed. Read each value as "within about 2 hex steps, after H.264 compression".

---

## 0. Units and scale (read this first)

- **u** = one CSS pixel, assuming the screen was recorded at 2x device-pixel ratio (1 u = 2 source pixels). This holds up well: the FAQ card measures exactly **1282 source px = 641 u**, so a 640 px card plus a 1 px border.
- **FAQ frames** (1600 px wide, scaled down from 2746): **1 frame px = 0.858 u**. The camera zoom stays fixed after the first second. t001 is a slight zoom-in from blur, an intro "focus pull".
- **Signing frames** (1600 px wide, scaled down from 3042): at the base zoom (t001 to t007, t038), **1 frame px = 0.951 u**. Frames t008 to t037 are zoomed in by the video editor (Screen Studio-style auto zoom toward the cursor): about 1.24x at t012 to t017 and about 1.37x at t019 to t037. Divide frame measurements by that factor. All signing numbers below are already converted to base-zoom u.
- **Caution on absolute size.** FAQ type works out to 21 u for titles and 19 u for body; signing prose to 17 u. These are large for a 640 px card, so he probably recorded with the browser zoomed in (about 125%). At 125% the FAQ system snaps cleanly to **card 512, padding 16, gap 10, title 17, body 15, line-height 24**, and the signing column snaps to about 600. The proportions are what to copy. The "Build" column in each table gives the value I recommend implementing at 100% zoom.

---

## 1. Canvas and layout

### 1a. FAQ (#4): a stand-alone generative widget

| Property | Measured | Build |
|---|---|---|
| Page background | **#EBEBEB**, flat, no gradient, no texture | `#EBEBEB` |
| Column | Single centred stack, **640 u** wide (card outer edge incl. border) | `max-width: 512px` (or 640 at 1x if the type is scaled up too) |
| Vertical position | The whole stack is **vertically centred** in the viewport. As it grows, it re-centres: it moves up by half of every height change, animated, never jumping. | `display:grid; place-items:center` on a full-height container, with the stack's own height animated |
| Max height | Once the stack reaches about **570 u** (frame y 295 to 962), it stops growing. The list scrolls inside, and the composer stays pinned as the last row. | `max-height: ~70vh` with an inner scroll area |
| Top edge | **Fade mask** about 30 u tall: cards scrolling out the top dissolve into the background (#EBEBEB, then #EEEEEE, #F1F1F1, #F4F4F4 over 60 source px) | `mask-image: linear-gradient(to bottom, transparent 0, #000 32px)` |
| Bottom edge | The scroll list continues **under** the composer. The card behind it shows about 12 to 16 u, washed out by a fade (t012 to t017: "What does it cost?" ghosted above the input). | Bottom mask about 24 u, with the composer on top (higher z-index) |
| Card pitch | Card **56 u** tall (incl. 1 u border) + **12 u** gap = 68 u pitch | 44 + 10 (at 125%), or 56 + 12 |
| Composer | The last row of the stack: same width and height as a card, separated by the same 12 u gap | — |
| Nesting | Follow-up cards are indented **52 u** from the parent's left edge (frame x 425 to 485) and keep the same right edge, so they are narrower. | `margin-left: 52px` (about 40 at 125%) |

### 1b. Signing (#5): a full chat transcript

| Property | Measured (base zoom) | Build |
|---|---|---|
| Page background | **#FFFFFF**, pure white | `#FFF` |
| Content column | **746 u** wide; composer, prose and document card share exactly the same left and right edges | `max-width: 720 to 746px; margin: 0 auto` |
| Empty state | The composer alone, centred **vertically and horizontally** in the viewport (t001) | — |
| After send | The transcript stacks top-down; the composer docks at the bottom of the content, with no full-width footer bar | — |
| User message | Right-aligned to the column's right edge. The attachment tile sits above the text bubble; the gap between them is about 10 u. | `align-self:flex-end` |
| Agent turn | Left-aligned, **no avatar, no bubble**. The order is: thinking row, then prose paragraph(s), then the generated card. The card spans the full column. | — |
| Vertical rhythm | bubble to thinking row about 40 u; thinking row to prose about 44 u (row centre to first line centre); last prose line to card about 32 u; card to composer **31 u** | Use 32 between blocks and 16 inside them |

**How cards sit in the chat flow:** the generated component is not a separate panel or sidebar. It sits inline under the agent's prose sentence, which ends with a colon ("…so three things are left:"). The prose introduces the card, and the card does the work. It is the same width as the prose column, so the text and the UI read as one message.

---

## 2. Typography

**Family: Inter** (or a metric-identical clone). Evidence: the x-height to cap-height ratio measures **0.74 to 0.75** (Inter is 0.545/0.727 = 0.75), with a double-storey "a", a flat-topped "t", Inter's "@", and a straight-legged "R". Weights in use are only **400, 500 and 600**; there is no 700 except the `<strong>` in prose, which renders as 600. **No monospace font** appears in either video. The PDF render uses Times-style serif headings and an Arial/Helvetica body, which is correct for a document preview and is not UI type.

### FAQ type scale (u at 2x; build value at 125%)

| Role | Size (u) | Build | Weight | Line height | Colour | Notes |
|---|---|---|---|---|---|---|
| Question (collapsed) | **21** (cap 15.5, x-height 11.5) | 17 px | 400/450 | single line, 56 u row | **#1E1E1E** | Measured on "Who can open an account?" |
| Question (expanded) | 21 | 17 px | same | — | **#000000** | The title goes **pure black when open**: a quiet "active" signal with no bold and no colour change |
| Answer | **19** (cap 14, x-height 10.5) | 15 px | 400 | **30 u** (1.58) | **#666666** | Tracking normal, ragged right, no hyphenation |
| Placeholder | 21 | 17 px | 400 | — | **#999999** | "Type in your question..." |
| Typed input | 21 | 17 px | 400 | — | #161616 | The user's casing is kept verbatim ("do you support wire transfers?") |
| Streaming scramble chars | 21 | — | 400 | — | **#6F9BD6** (light accent) | Unresolved glyphs during the decode effect |

### Signing type scale (base-zoom u)

| Role | Size (u) | Weight | Line height | Colour |
|---|---|---|---|---|
| Agent prose | **17** (x-height 9.5, cap 12.7) | 400; emphasis 600 | **27.5 u** (1.6) | **#1F1F1F**; bold uses the same colour, weight only |
| User bubble text | 17 | 400 | — | #1D1D1D |
| Thinking label ("Reading page 3 of 5") | 16 | 400 (500 while live) | — | live #1F1F1F with shimmer; done ("Read for 5s") **#666666** |
| Thinking timer ("1s", "3s") | 16 | 400 | — | **#999999** |
| Card header filename | 16.5 | 500 | — | #1F1F1F |
| Step eyebrow ("Contractor", "Address", "Notices", "Signature") | 15 | 400 | — | #666666, with the 3x3 pixel glyph before it |
| Step question ("Who's the contractor?") | 18 | 600 | — | #1F1F1F |
| Option primary ("Acme Studio LLC", "john@acme.studio") | 17 | 500 | — | #1F1F1F |
| Option secondary, right-aligned ("Your company", "1428 Valencia St", "Work") | 16 | 400 | — | #666666 |
| "Something else" | 17 | 400 | — | #666666 (secondary, not primary) |
| Helper under the pad ("Written from your name", "Use a mouse, trackpad or finger") | 15 | 400 | — | #666666 |
| Success title ("Signed for Acme Studio LLC") | 19 | 600 | — | #1F1F1F, centred |
| Success sub ("Dana Ruiz signed for / Northwind Labs on October 22") | 16.5 | 400 | 24 u | #666666, centred, wraps to 2 lines on purpose |
| Button labels | 16.5 | 500 | — | neutral #1F1F1F; tinted **#2A44A6** |
| Composer placeholder | 17 | 400 | — | **#9A9A9A** |
| Toolbar labels ("acme-webapp", "Medium") | 16 | 400 | — | #666666; the active segment label ("Local") is #1F1F1F |
| Attachment tile: "PDF" | 13 | 400 | — | #909090 |
| Attachment tile: name ("Contractor / …Agreement") | 15 | 400 | 1.35 | #1F1F1F; middle-truncated with a leading ellipsis on line 2 |

**Text tiers (both videos):** primary **#1F1F1F** (#000 for the "open" title), secondary **#666666**, tertiary or placeholder **#999999**, disabled #C8C8C8 (the faint chevron while a card is generating). The whole design runs on these three greys plus one blue.

---

## 3. Colour

### Neutrals

| Token | Hex | Where |
|---|---|---|
| `bg-canvas-grey` | **#EBEBEB** | FAQ page |
| `bg-canvas-white` | **#FFFFFF** | Signing page; all card surfaces |
| `surface-sunken` | **#F5F5F5** (#F6F6F6 in places) | user bubble, attachment tile, option rows, chips, the "+" button, segmented track, signature pad, Download button |
| `surface-sunken-hover` | **#EEEEEE / #F1F1F1** | option row hover (t015, t017) |
| `surface-panel` | **#FBFBFB** | the PDF preview's left panel behind the white page |
| `surface-skeleton` | **#F8F8F8** (white at about 60% over #EBEBEB) | a FAQ follow-up card while it is still a skeleton |
| `border-card` (on grey) | **#DFDFDF**, 1 u | FAQ cards; reads as `rgba(0,0,0,0.055)` |
| `border-hairline` (on white) | **#E8E8E8** at 1 source px (0.5 u) | signing doc card, composer (#E0E0E0) |
| `divider` | **#F5F5F5** | doc-card header underline (barely visible) |
| `connector` | **#D6D6D6**, about 1.25 u | FAQ follow-up tree line on #EBEBEB |
| `progress-todo` | **#DFDFDF** | stepper segments not reached yet |
| `text-1/2/3` | **#1F1F1F / #666666 / #999999** | see section 2 |

### Accent (exactly one hue: an indigo-leaning royal blue)

| Token | Hex | Where |
|---|---|---|
| `accent` | **#2F5BDE** | send button, PDF field tag chip, pixel-glyph dark cells, caret square, active progress segment (#4C80E7 measured on a 3 u bar), field underline (#4C81D8) |
| `accent-ink` | **#2A44A6** (dark-measured #283E94 to #303CA1) | text on tinted buttons ("Send email", "Sign"), selected option value, success check |
| `accent-tint` | **#ECF1FB** | tinted button fill (Send email, Sign) |
| `accent-tint-2` | **#E7EEFA** | success check circle |
| `accent-selected-bg` | **#EEF6FD** | selected option row fill |
| `accent-field-bg` | **#E8EEFA** | active PDF field highlight |
| `accent-progress-done` | **#9BC8F6** | completed stepper segments |
| `accent-focus-border` | about **#5A80D0** (H.264 shifts it; implement as `accent` at 75%) | FAQ input focus, inline "Something else" input, selected option border |
| `accent-focus-ring` | **#D2D9E8** on #EBEBEB; about 3 u wide | the soft halo outside the focus border; implement `0 0 0 3px rgba(47,91,222,.14)` |
| `accent-light` | **#6F9BD6** | scrambled glyphs in the decode animation |
| Pixel-glyph cell tiers | **#2E5BDC** (deep), **#4A7FEE** (mid), **#6AA6EC** (light), **#C5DAF5** (pale), **#EAF3FD** (ghost) | the 3x3 brand glyph |
| `ink-signature` | **#25358F** (navy) | generated and drawn signatures. Pending preview in the PDF: the same navy at about 45% opacity on the field tint. |

**No semantic colours are used.** There is no green success, no red, no amber. Success is **blue**: a blue-tint circle with a blue check. Errors never appear in either demo. When I extrapolate success, warning and danger roles, I keep them as ink colour on a pale tint, the same way `accent-ink` sits on `accent-tint`, and never as saturated fills.

**Dark mode** is not shown in these two videos. Video 06 covers it for the merge-conflict demo.

---

## 4. Surfaces

### FAQ accordion card

| Property | Value (u) |
|---|---|
| Size | 640 x 56 collapsed |
| Fill | #FFFFFF |
| Border | 1 u #DFDFDF (a ring at about rgba(0,0,0,.055)) |
| Radius | **about 14 u** (straight edge resumes 11 to 13 u from the corner; it reads as a soft "squircle"-ish 14) |
| Shadow | Very soft: the background right outside the card is #E7E7E7 to #E8E8E8 versus #EBEBEB further out, for about 20 u. Composer gets a slightly larger falloff (#E8E8E8, then #EAEAEA, out to 30 u). Implement `0 1px 2px rgba(0,0,0,.03), 0 4px 16px rgba(0,0,0,.03)`. |
| Padding | **20 u** left/right (glyph left edge at border + 21), vertical centring in the 56 row |
| Header anatomy | [3x3 glyph 16 u] gap 14 u [question text] … [chevron 16 u box, glyph about 10 x 6 u, stroke about 1.5 u, #666666, right inset 24 u from the outer edge] |
| Body | Answer starts at the **same x as the glyph** (not under the text). It is a hanging layout: the answer is wider than the title column. About 12 u between the title row and the first answer line; about 20 u bottom padding. |

### Signing document card ("Contractor Services Agreement.pdf")

| Property | Value (u, base zoom) |
|---|---|
| Width | 746 (= column) |
| Border | 0.5 u hairline #E8E8E8 |
| Radius | about 16 u |
| Shadow | Large and faint: #F9F9F9, then #FBFBFB, then #FDFDFD over about 28 u below. `0 8px 28px rgba(0,0,0,.035)` |
| Header | 50 u tall, a 1 u #F5F5F5 divider below, 16 u side padding. Accent-blue **signature scribble icon** (pen squiggle with underline, about 20 u), 12 u gap, filename 500 #1F1F1F. Far right: **maximize-2 icon** (two diagonal arrows), 16 u, #666. |
| Body | Two columns of about 50/50. **Left:** the PDF viewport on #FBFBFB with the white page (soft drop shadow, no border). **Right:** a white question panel, 16 to 18 u padding, with its footer pinned to the bottom (Back, stepper, action). Fixed height (about 330 u at base zoom), so steps never change the card's height. |

### Composer (signing)

| Property | Value |
|---|---|
| Size | 746 x about 150 u (empty); grows upward when an attachment is added (t003: attachment tile row on top) |
| Fill/border/radius | #FFF, 0.5 u #E0E0E0 hairline, about **20 u radius**, faint shadow below |
| Padding | 18 u; placeholder at top-left ("Ask anything, or drop a PDF to sign"), toolbar at the bottom |
| Toolbar (left to right) | **"+" circle** 38 u, #F5F5F5, plus icon #666 · **project chip** 38 u tall, pill, #F5F5F5, folder icon + "acme-webapp" #666 · **segmented "Local / Cloud"** 38 u track #F5F5F5; active thumb white pill with tiny shadow (`0 1px 2px rgba(0,0,0,.06)`) holding laptop icon + "Local" #1F1F1F; inactive segment is icon-only (cloud) · *(spacer)* · **effort control** "Medium" with a 4-bar signal icon (2 bars #1F1F1F, 2 bars #C8C8C8), plain text with no chip · **mic** icon #666 · **send** 40 u circle **#2F5BDE**, white arrow-up |
| Gaps | about 8 u between chips, about 24 u between Medium, mic and send |

### FAQ composer (input row)

56 u row, same card styling. Placeholder #999. **Focus:** the border becomes accent (about 1 u) with a **3 u soft accent halo**, and a **↵ (corner-down-left)** glyph in #5E5E5E fades in at the right edge (24 u inset). There is no send button. Enter is the only affordance, which matches the "type a question" mental model.

### Nested and secondary surfaces

- **Option row** (question panel): full panel width, about **51 u** tall, fill #F5F5F5, **no border**, radius **12 u**, padding 20 u x. Primary text on the left, secondary text right-aligned. Gap between rows **8 u**. Hover: fill goes to #EEEEEE; the cursor is a pointer.
- **Selected option:** fill **#EEF6FD**, 1 u accent border (about #5A86C0 measured), the secondary text turns **accent-ink** and a **check** (accent, about 14 u, 2 u stroke) appears at the far right. The row height does not change.
- **"Something else" to inline input:** the same row box morphs into an input: white fill, 1 u accent border + 3 u halo, placeholder "An email address" (#999), and a **28 u square enter key** at the right (radius about 7 u). It is #F0F0F0 with a grey ↵ while empty, and turns **filled accent #2F5BDE with a white ↵** once there is text.
- **Segmented control (Generate / Draw / Upload):** track #F5F5F5, pill, about 48 u tall, full panel width, 3 equal segments, each with a 16 u icon (sparkle / pencil / upload-arrow) + label 500. Active: white pill thumb + micro shadow. Keyboard focus: **2 u accent outline** around the thumb (t022).
- **Signature pad:** #F5F5F5, radius 14 u, about 210 u tall. A dotted baseline (#CFCFCF, 1 u, dash 2/3) at about 70% height, a small "×" (#999, 10 u) at its left end, and a ghost "Sign here" (#E0E0E0) centred on the baseline when empty. Top-right utility pill (**"Another style"** with a refresh icon, or **"Clear"** with an eraser icon): white, hairline #E5E5E5 border, pill, about 32 u tall, 15 u text #1F1F1F, tiny shadow.
- **Buttons:**
  - *Neutral* ("Download"): #F5F5F5, pill, about 38 u tall, 16 u x-padding, icon 16 u + 8 u gap, 500 #1F1F1F.
  - *Tinted* ("Send email", "Sign"): **#ECF1FB** fill, **#2A44A6** 500/600 text, same geometry.
  - *Primary* (only the composer send): solid #2F5BDE circle.
  - Hover is a slightly deeper tint, and press scale is about 0.98.
  - **There are no solid full-width CTAs anywhere.** The strongest in-card action is the tinted pill.
- **User bubble:** #F5F5F5, radius about 22 u (near-pill at 50 u tall), padding 18 u x / 13 u y, no tail, no border.
- **Attachment tile:** 158 x 129 u, #F6F6F6, radius 14 u, padding 10 u. "PDF" eyebrow top-left (13 u #909090); filename bottom-left, 2 lines, middle-truncated. **Uploading:** contents fade to about 50%, and a **ring spinner** (about 14 u, 2 u stroke, accent arc on a #D0D0D0 track) sits top-right (t002).
- **PDF field highlight:** the active field row gets an **#E8EEFA** fill, a **2 u accent underline**, and a small **solid accent tag chip** (radius 4 u, 13 u 600 white text: "Contractor", "Address", "Email", "Sign here") at its top-left. The chip goes 50% transparent ("Sign here" ghost) while waiting on pad input.
- **Icons:** a Lucide-style outline set: **1.5 u stroke, rounded caps and joins, 16 to 20 u**, colour #666 (or #1F1F1F when active). Only two icons are filled or coloured: the accent signature scribble in the doc header, and the 3x3 pixel glyph.

---

## 5. Components (inventory and anatomy)

1. **3x3 pixel glyph (the "generative" mark).** 16 u square: 9 cells of about 4 u with about 2.25 u gaps, sharp corners. Each cell takes one of 5 blue tiers (deep to ghost), so the pattern reads as "computed". It is used as the leading icon of every FAQ question, every follow-up and every step eyebrow.
   - **Idle:** static, with a rare single-frame twinkle.
   - **Working:** cells flicker and shuffle through tiers. It looks like a scan: only the bottom row lit, then a "+" shape, then a ring of 4. It is the loading indicator, so no separate spinner is needed.
   - **Done:** settles to a random static pattern, different per card.
2. **FAQ accordion card.** Header row (glyph, question, chevron) plus an answer body. The question is always visible.
   - **States:** collapsed · pressed (scale about 0.985) · expanding/thinking (body opens to one line holding just the accent caret square) · streaming · open (title #000) · re-collapsed.
3. **Follow-up tree.** Child cards are indented 52 u. A **1.25 u #D6D6D6 connector** runs down from under the parent (x = parent left + about 30 u), then a square elbow (no radius) runs right into each child's vertical centre. The vertical line extends as children are added. Children are full cards: they expand and spawn their own answers. **Each answer spawns exactly one follow-up**, which is a deliberate, bounded choice.
4. **Skeleton follow-up card.** The same box at #F8F8F8 (translucent), glyph in ghost tiers, a single **rounded bar** (about 200 x 8 u, #E4ECF3 core, #E9EDF1 edges, a blue-grey shimmer sweep) where the text will go, and the chevron at 30% opacity.
5. **Decode text (question generation).** Text resolves left to right. The resolved prefix is in #1F1F1F, and a trailing window of **2 to 5 random letters** is in light accent (#6F9BD6), e.g. "What docu**rvyr**", "Ca**loe**", "How does the 2% cash**fthy**". The window rides ahead until the string completes.
6. **Streaming answer text.** Word-by-word. Each word enters with **opacity 0 to 1 + blur about 4 to 6 px to 0** (the "focus-in" word reveal; a couple of words are always mid-blur at the tail). A **6 u accent square caret** sits at the end of the stream, and before the first word it sits alone at the start of the empty body line.
7. **Composer, FAQ variant** (input row, ↵ hint) and **chat variant** (multi-line; attachment row; toolbar; send).
8. **Attachment tile** (idle / uploading with ring spinner) and the **sent attachment** (the same tile, right-aligned in the transcript).
9. **User bubble.**
10. **Thinking row.** A chevron-right (#999, 16 u), then a ~24 u gap, then a **live label** with a shimmer sweep and a **seconds counter** in #999. The label steps through concrete activities: "Thinking 0s", "Reading page 1 of 5", "…page 5 of 5", "Reading the Statement of Work 2s", "Checking your profile 3s", "Writing the questions 4s". On completion it collapses to the **past-tense summary "Read for 5s"** in #666. The chevron means it can expand to show the steps; it is never expanded in the video.
11. **Document card**, built from the header, PDF viewport and question panel below.
12. **PDF viewport.** It renders the real page. **It zooms and pans to the field the current step fills** (about 3x zoom, field near the top third), shows the field highlight and tag chip, **types the chosen value into the field live**, and zooms out to the whole page on completion.
13. **Step panel (wizard)**, built from the eyebrow (glyph + noun), the question (600) and 2 suggested options + "Something else". The options are inferred from context: the user's company, home or studio addresses, work or personal email, each with a right-aligned qualifier.
14. **Stepper.** 4 short rounded bars, bottom-centre: done #9BC8F6 (15 x 3 u), **current #4C80E7 and wider (27 x 3 u)**, todo #DFDFDF (15 x 3 u), with a 5 u gap. It has no numbers and no "Step 2 of 4" text.
15. **Back link.** Arrow-left + "Back", #666 text, 16 u, bottom-left; it appears from step 2 on.
16. **Signature step.** Segmented Generate/Draw/Upload, then the pad, then the helper line, then the footer [Back · stepper · **Sign**].
    - **Generate:** writes "John Doe" in a script face with a stroke-draw animation. "Another style" redraws it in a different script.
    - **Draw:** freehand canvas with a crosshair cursor. Ink is navy, about 2.5 u, round caps, with light smoothing. It mirrors live into the PDF field at about 45% opacity.
17. **Success state** (replaces the step panel). A 48 u **#E7EEFA circle** with a 2.5 u accent-ink **check**, then the title (600), then the 2-line grey sub, then [Download (neutral)] [Send email (tinted)], centred with a 12 u gap.
    - After Send: the button shows an inline spinner, then the label is replaced by a check, then a **receipt line "Sent to dana@northwindlabs.com"** (prefix #666, email #1F1F1F) fades in below. The button later reverts to "Send email".
18. **Toolbar controls:** "+" button, project chip, Local/Cloud segmented toggle, effort selector ("Medium" + signal bars), mic, send.

---

## 6. Motion

Times come from 10 fps contact sheets (`extra/sheet_*.png`), so they are about ±50 ms. Overall character: **fast, physical, and quiet.** Nothing bounces, nothing slides more than about 12 u, and everything that changes size animates its height so the layout never jumps. Easing reads as a strong ease-out, e.g. `cubic-bezier(.2,.8,.2,1)` or a critically damped spring.

| What | How | Duration / timing |
|---|---|---|
| Card press (FAQ) | scale to about **0.985** on mousedown, back on release | about 100 ms |
| Chevron | rotates **180°**, down to up (t+0.7 s shows it mid-turn pointing left) | about 200 ms |
| Accordion open | the body **height** opens immediately to a one-line "thinking" body. The stack re-centres in the same frame range. | about 250 ms ease-out |
| Thinking (FAQ) | the glyph shuffles; a lone **accent caret square** sits in the body | about 400 to 600 ms |
| Answer stream | words fade in with a **blur-to-sharp** reveal (about 300 ms per word, overlapping) at **about 30 to 40 words/s**. The caret square trails the last word. The card height grows line by line and smoothly. | a 3-line answer takes about 0.7 s |
| Follow-up spawn | (1) about **300 ms** after the answer ends, the gap below the parent opens (height animation) and the **connector line draws downward**; (2) the skeleton card fades in from scale about 0.98 (t+0.6 s), and the bar shimmers for about 400 ms; (3) the question **decodes** left to right at about 30 to 40 chars/s with a scrambled tail; (4) the chevron and glyph go to full opacity on completion | the whole sequence is about **1.5 s** |
| New typed question | on Enter, the input clears and a new card is appended **already expanded**, so the same think, stream and follow-up sequence plays. The list auto-scrolls so the new card sits just above the composer. | — |
| Scroll overflow | content slides under the top fade mask and the pinned composer | continuous |
| Send (signing) | the attachment tile and text **fly from the composer to their transcript positions** (shared-element, right-aligned). The composer shrinks back to its empty height and drops to its docked position. | about 300 to 400 ms |
| Thinking row | the label text **swaps in place** every 0.2 to 0.6 s with a shimmer sweep over the label; the counter ticks once per second; at the end it collapses to the "Read for 5s" summary | 5 s total |
| Prose stream | the same blurred word reveal as the FAQ, about 25 words/s | about 1.5 s |
| Card entrance | the doc card fades and rises (about 8 u), and the PDF page and question panel fade in. The **options stagger** top to bottom by about 60 to 80 ms each. | about 400 ms |
| Option select | the selection styles apply instantly. The **value types into the PDF field** (character fade, about 300 ms), and the tag chip fades out. Then **hold about 600 ms** so the user sees the result. Then the step content crossfades (old fades out about 100 ms, new eyebrow and question fade in, options stagger in at about 70 ms), the PDF **pans or zooms to the next field**, the stepper bar **morphs width** to the next segment, and Back fades in. | about 1.1 s per step |
| Segmented switch | the white thumb **slides** between segments (t026 catches it mid-travel) | about 200 ms |
| Generate signature | the script signature **draws on** like a pen stroke (path-length reveal) and mirrors into the PDF at low opacity | about 800 ms |
| Sign | an inline spinner in the button (about 750 ms). Then **the PDF zooms out** from the signature field to the full page (about 450 ms) while the panel crossfades to success. The check circle scales in (about 0.8 to 1) and the check draws. The buttons fade in. | about 1.3 s |
| Send email | spinner in the button (about 500 ms), then the label becomes a check, then "Sent to …" fades in below | about 900 ms |
| Upload | a ring spinner on the tile and contents at 50%, then the tile settles to full opacity | about 1 s |

**Morph-in-place rule:** every state change happens **inside the same box**.
- The FAQ card grows; it is not replaced.
- The skeleton becomes the real card.
- "Something else" becomes the input.
- The Sign button becomes a spinner.
- "Send email" becomes a check and then a receipt line.
- The question panel becomes the success panel.
- The card never closes, opens a modal, or navigates.

---

## 7. Interaction patterns

- **Progressive disclosure, driven by the user.** The FAQ shows only questions. Answers stream on demand, and each answer offers one deeper question as a child. The tree grows where the user's curiosity went, which is the core "generative UI" idea here.
- **Pre-filled, not blank.** The agent reads the document, then *fills what it can* ("I've filled in your name, title and the date") and asks only what it can't know ("so three things are left:"). Each question offers the 2 most likely answers from the user's profile, plus an escape hatch ("Something else") that turns into a free-text field in place.
- **One question at a time**, with constant context: the live PDF on the left shows exactly where each answer will land, and fills it as you choose.
- **Immediate commit, no confirm buttons on steps.** Clicking an option *is* the answer; it advances automatically after a short hold. The only explicit commit is **Sign**, the one irreversible action.
- **Prose and component relationship.** About 2 to 3 sentences of plain prose state the facts (who, what, price, start date, counterparty status), say what was already done, and end with a colon that hands off to the component. The prose never repeats what the UI shows, and the UI never re-explains the prose.
- **"Thinking / Worked for Ns" pattern.** A single collapsed row: a chevron plus a live activity label with a seconds counter. While live, it narrates *specific* actions ("Reading page 3 of 5", "Checking your profile"). When done, it becomes a past-tense, duration-only summary ("Read for 5s") that stays in the transcript in the secondary colour. The FAQ uses no text at all for thinking: only the animated glyph and the caret square.
- **Loading states are local and shaped like the result.** The skeleton is the card's own shape. Spinners live *inside* the button that was pressed (Sign, Send email) or on the tile being uploaded. The pixel glyph doubles as a spinner. There is never a page-level spinner or overlay.
- **Empty states.**
  - Signing: a single centred composer whose placeholder tells you what's possible ("Ask anything, or drop a PDF to sign").
  - FAQ: 3 seed questions plus an input.
  - Signature pad: a ghost "Sign here" on the baseline.
- **Error states:** none are shown. Extrapolate in the same idiom: inline, in place, in the same box (e.g., the button returns from spinner to label with a short grey reason line under it, the way "Sent to …" appears).
- **Keyboard:** visible focus rings (accent outline on the segmented thumb, a halo on inputs), and Enter to submit (↵ hints).
- **The user's words stay theirs:** the typed question "do you support wire transfers?" becomes a card title with its lowercase intact.

---

## 8. Microcopy

- **Tone:** plain, specific, friendly-competent, no hype. Short declaratives: "They've signed." "Transfers between accounts here are instant."
- **Length:** FAQ answers run 1 to 3 sentences (about 20 to 40 words). Prose is 2 to 3 sentences. Labels are 1 to 3 words.
- **Capitalisation:** **sentence case everywhere** ("Who's the contractor?", "Sign it your way", "Another style", "Send email", "Something else"). Proper nouns are capitalised; there is no Title Case on UI controls. The only uppercase is inside the PDF ("CONTRACTOR"), which is document content.
- **Questions as headings:** each step is a natural question ("Which address goes on it?", "Where should notices go?"), and each eyebrow is a one-word noun ("Address", "Notices").
- **Numbers and time:** numerals throughout ("30+ other countries", "200+ countries", "2%", "$95 an hour", "$5", "25% or more"). Durations are written as words when conversational ("about ten minutes", "one or two business days"). Dates are spelled out: "November 3", "October 22", and in-document "October 24, 2026". Timers are compact: "1s", "5s". Pages: "Reading page 3 of 5".
- **Qualifiers instead of explanations:** "Your company", "As yourself", "Work", "Personal", "Written from your name", "Use a mouse, trackpad or finger" (no Oxford comma).
- **Outcome-first confirmations:** "Signed for Acme Studio LLC", then who else signed and when, then "Sent to dana@northwindlabs.com". Every one names the actual entity, never "Success!" or "Done!".
- Placeholders end with an ellipsis in the FAQ ("Type in your question..."), and with none in the chat ("Ask anything, or drop a PDF to sign").

---

## 9. What makes it feel clean (and what "vibe-coded" looks like)

**Clean, because:**
1. **One accent, used sparingly.** Blue appears only where something is live, selected or actionable, at three strengths (solid / ink-on-tint / pale tint). Everything else is 3 greys on white or #EBEBEB.
2. **Hierarchy through weight and grey, not size.** Title vs answer differ by about 2 px of size and a lot of value (#000 vs #666). Size jumps stay small, so nothing shouts.
3. **Surfaces separated by value, not lines.** Sunken #F5F5F5 rows and pills sit on white cards; borders are hairlines (0.5 to 1 u at about 5% black), and shadows are almost invisible. There is no heavy border plus heavy shadow, and no gradients anywhere except the shimmer.
4. **Generous, consistent radii** (12 to 22 u, with pills for every button or chip) and a strict spacing set (8 / 12 / 16 / 20 / 32).
5. **Identical edges.** Prose, card and composer share one column edge, and child cards share the parent's right edge.
6. **State changes morph in place** with height animation, so the eye never loses its anchor and the layout never jumps.
7. **Loading is designed**: shaped skeletons, decode text, blur-in words, a branded glyph spinner, and a narrated thinking row with real step names.
8. **Edge cases are handled, not ignored**: "Something else" for any answer, Back on every step, Draw / Generate / Upload for signatures, "Another style", Clear, an inline sending state, a receipt line after sending, and the user's own casing kept.
9. **Copy does real work**: specific facts and numbers, sentence case, no filler.

**Vibe-coded (the anti-patterns these designs avoid; see his own critiques of videos 07, 10 and 11):** spacing that changes between siblings; several accent colours or rainbow status badges; gradients on buttons or headers; everything at the same size and weight; buttons that are too wide and too tall (full-width solid CTAs); heavy borders and drop shadows at once; a "header" banner on a card; flip or bounce animations; spinners blocking the whole card; a confirm button after every choice; and generic copy ("Success!", "Please select an option").

---

## 10. Quick build tokens (recommended, normalised to 100% zoom)

```css
:root{
  --font: "Inter", ui-sans-serif, system-ui, sans-serif;
  --bg-grey:#EBEBEB; --bg:#FFFFFF; --sunken:#F5F5F5; --sunken-hover:#EEEEEE; --panel:#FBFBFB;
  --text-1:#1F1F1F; --text-strong:#000000; --text-2:#666666; --text-3:#999999; --text-disabled:#C8C8C8;
  --border:rgba(0,0,0,.055); --hairline:#E8E8E8; --divider:#F5F5F5; --connector:#D6D6D6;
  --accent:#2F5BDE; --accent-ink:#2A44A6; --accent-tint:#ECF1FB; --accent-tint-2:#E7EEFA;
  --accent-selected:#EEF6FD; --accent-field:#E8EEFA; --accent-done:#9BC8F6; --accent-light:#6F9BD6;
  --ring:0 0 0 3px rgba(47,91,222,.14);
  --shadow-card:0 1px 2px rgba(0,0,0,.03),0 4px 16px rgba(0,0,0,.03);
  --shadow-float:0 8px 28px rgba(0,0,0,.035);
  --r-row:12px; --r-card:14px; --r-doc:16px; --r-composer:20px; --r-pill:999px;
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px; --s-6:24px; --s-8:32px;
  --ease:cubic-bezier(.2,.8,.2,1); --t-fast:120ms; --t-base:220ms; --t-slow:400ms;
  /* type: title 17/24 400 · body 15/24 400 (FAQ) | prose 16-17/1.6 · question 17 600 · label 14 · meta 15 */
}
```
