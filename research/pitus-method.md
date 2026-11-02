# Phil Pitus (@pitus_): method, in his words

Collected 2026-11-02 from his posts on X (via Grok search). Paraphrase except where quoted.

## The "Generative UI" series (videos in `videos/`, frames in `frames/`)
| # | File | Post | Date |
|---|---|---|---|
| 1 | 01-map | https://x.com/pitus_/status/2110421626873643338 | 2026-10-14 |
| 2 | 02-merge-conflicts | https://x.com/pitus_/status/2111519352503873866 | 2026-10-17 |
| 3 | 03-db-migration | https://x.com/pitus_/status/2112620079678631971 | 2026-10-20 |
| 4 | 04-faq | https://x.com/pitus_/status/2113344534021124231 | 2026-10-22 |
| 5 | 05-doc-signing | https://x.com/pitus_/status/2114059171616202865 | 2026-10-24 |
| – | 06-merge-dark (dark mode of #2) | https://x.com/pitus_/status/2115019751646974021 | 2026-10-27 |
| – | 07-merge-claude-v1 (Claude's one-shot first draft of #2; "for me, just a v1") | https://x.com/pitus_/status/2111887566907802073 | 2026-10-18 |
| – | 08-built-with-claude | https://x.com/pitus_/status/2109333586251801069 | 2026-10-11 |
| – | 09-thread-opener (thinking-process clip) | https://x.com/pitus_/status/2110059026818212244 | 2026-10-13 |
| – | 10-opus-high (he rates 2/5: spacing odd, colors unbalanced, vibe-coded header) | https://x.com/pitus_/status/2111114369618911237 | 2026-10-16 |
| – | 11-opus-medium (he rates 1/5: buttons too wide, too tall, top cards, flip animation, spacing) | https://x.com/pitus_/status/2111114373036900501 | 2026-10-16 |

## How he works (thread, 2026-10-13)
1. Never starts with a prompt: picks 3–5 references (Mobbin, Pinterest, Dribbble, X) and writes what he likes and dislikes about each screenshot.
2. "I describe the action, not style or visuals. I never ask AI to 'make it look nice and clean'. It never works." Prompts describe the user's situation, e.g. "users wait here ~20 seconds for an agent…".
3. Asks the AI for direction: it's good at brainstorming solutions.
4. The first version is usually off: "spacing all over the place", "gradients… (don't get me started)", "hierarchy is bad, everything is the same size". Fixes by hand or with exact change notes.
5. Then the details AI overlooks: loading states, empty states, interactions, animations. "Predict the most absurd edge cases, and handle them."
6. "AI gets you 80% of the way, fast… The last 20% boils down to taste, ideas, experience and iteration."

Other notes: 1–3 rounds of feedback per design; very detailed prompts; sometimes designs it all and has Claude turn it into code to click around; skips Figma and describes changes by voice; reviews by serving on localhost; "Opus 5.5 is the best model to generate UI"; "Generative UI is the best alternative to a wall of text."
