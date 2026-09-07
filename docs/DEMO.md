# Demo: "Lumi and the Broken Compass"

An original story written for this project (`packages/core/src/demo/story.ts`). Ages 6–9, animated short, ~75 seconds, kids/educational mode with one required fact.

## Why this story

It is engineered to exercise CineMemory:

| Continuity requirement | Where it lives |
|---|---|
| Lumi: tiny firefly, **blue scarf**, **warm yellow glow** | visual constraints `vc_1_lumi_scarf`, `vc_2_lumi_glow_color` injected into every shot prompt containing Lumi |
| Milo: young rabbit, **green satchel**, long ears | visual constraints |
| The **broken compass**: brass, cracked glass, wobbling needle | prop visual constraint; possession tracked Milo → (dropped) → Lumi → Milo |
| The compass **points to the brightest light** | knowledge fact `fact_compass_points_to_light`, secret; Lumi learns it in Scene 3, Milo in Scene 5, Pip never |
| Milo must not know the secret before Scene 5 | continuity constraint `cc_knowledge_fact_compass_points_to_light` (knowledge_order) |
| Fireflies make their own light (bioluminescence) | required educational fact → `edu_bioluminescence` (must_keep) |
| Discovery before sharing; guided home by Lumi's light | causal dependency + required event constraints |

## What the demo shows

Running the pipeline to `narrative_verified` on the demo (fixture mode or live Gemini):

1. **Source analyzed**: 3 characters, 4 locations, 1 prop, 7 events, 1 knowledge fact; 14 constraints extracted (5 source, 6 visual, 3 continuity).
2. **Adaptation**: 6 beats, unbreakable chain `ev_compass_dropped → ev_secret_discovered → ev_secret_shared → ev_guided_home`.
3. **Screenplay**: 6 scenes, 75 s. In fixture mode the authored screenplay deliberately contains two faults so the critics have something real to catch. With live Gemini the faults are whatever the model actually produces.
4. **Memory built**: 27 state changes (locations, knowledge, inventory, emotions).
5. **Shots planned**: 13 shots with composed prompts carrying the constraints.
6. **Verification**: `KNOWLEDGE_TIMELINE_VIOLATION` in Scene 4 line 2 (Milo says "the needle follows the light" before Lumi tells him) and `REQUIRED_FACT_MISSING` (no line mentions bioluminescence).
7. **Repair**: Scene 6 rewritten to add the fact (v2), Scene 4 rewritten to fix Milo's line (v3); memory refolded; critics re-run; both violations resolved; shots re-planned from the revised screenplay.

Then to `film_assembled`: keyframes (placeholder cards without a media key, Gemini images with one), visual checks (prompt-level always; real-frame vision inspection when keyframes are real), film manifest with chapters and subtitle cues.

## Baseline vs CineMemory (fixture mode, from actual records)

| Metric | Baseline | CineMemory |
|---|---|---|
| Constraints evaluated | 56 | 56 |
| Violations detected | 50 | 2 |
| Violations repaired | 0 | 2 |
| Unresolved | 50 | 0 |
| Visual pass rate (prompt-level) | 28% | 100% |
| Narrative pass rate | 97% | 100% |
| Source pass rate | 94% | 100% |

In fixture mode both variants start from the same authored screenplay, so the difference measures prompt composition from memory, the critics and the repair loop. With live Gemini the baseline screenplay is generated from the source text and beat sheet alone, without the knowledge timeline or constraints.

## Live Gemini run (measured, 2026-09-05)

Same project, live `gemini-3.6-flash` → `3.7` → `3.8` → `3.5` → `3-flash-preview` pool on a free-tier key (20 requests/day/model, failovers logged), ClickHouse memory (local engine). Image models had no quota, so visual checks are prompt-level only.

| Metric | Baseline | CineMemory |
|---|---|---|
| Constraints evaluated | 94 | 80 |
| Checks evaluated / not evaluated | 200 / 113 | 178 / 106 |
| Violations detected | 55 (53 `PROMPT_MISSING_CONSTRAINT`, 1 `REQUIRED_FACT_MISSING`, 1 `SOURCE_CONTRADICTION`) | 2 |
| Violations repaired | 0 | 1 |
| Unresolved | 55 | 1 (a second rewrite of Scene 6 regressed the fact the first repair added; the regression is now retried in a bounded second pass) |
| Visual (prompt-level) pass rate | 64% | 100% |
| Narrative pass rate | 100% | 100% |
| Source pass rate | 87% | 93% |

The live run of the main project itself (`pnpm demo:seed`) produced a 6-scene screenplay in which Lumi learns the secret in Scene 4 and Milo in Scene 5, detected one `SOURCE_CONTRADICTION`, repaired it with a Gemini scene rewrite, refolded memory to v2 and re-verified; 19 model calls are recorded in ClickHouse `agent_actions`.

## Live media run (measured, 2026-09-05, paid tier)

`pnpm demo:seed film_assembled` on the same project with `gemini-3.1-flash-image` for keyframes, `gemini-2.5-flash-preview-tts` for voice and `gemini-3.6-flash` vision for inspection. Wall time 22:59 → 23:13 (14 min). Veo was left off.

| Step | Result |
|---|---|
| Reference sheets | 3 (Lumi, Milo, Pip), used as image references for every keyframe |
| Media generation | 15 shots: 15 keyframes + 11 voice tracks, 0 failed |
| Visual inspection pass 1 | 195 checks on real frames, 2 violations: `CHARACTER_IDENTITY_DRIFT` (shot 2.2: Milo's head and ears cropped out) and `PROP_MISSING` (shot 5.1: compass glass shows no cracks) |
| Repairs | 4 regenerations, each verified by a fresh inspection pass: `PROP_MISSING` 5.1 → resolved; `PROP_MISSING` 1.1 (surfaced on pass 2) → resolved; `CHARACTER_IDENTITY_DRIFT` 2.2 → resolved, but the new frame put the satchel on the grass (`CLOTHING_MISMATCH`) → regenerated again → resolved |
| Final inspection | 195 checks, 0 violations; 15 shots verified, 4 attempted / 4 resolved / 0 escalated |
| Film | 15 segments, 75 s, chapters + subtitles; 251 checks, 7 violations resolved over the whole production, 0 unresolved; warning: segments play as keyframes (no Veo clips) |
| ClickHouse | 292 events, 1146 checks, 37 generation attempts, 7 repair attempts, 94 model calls (92 on `gemini-3.6-flash`, 2 on `gemini-3.7-flash` after a failover), 125k input / 58k output tokens |

The before/after frames are kept as versions (`data/media/lumi_demo/shot_2_2/keyframe_v1.jpg` → `keyframe_v3.jpg`), so the Storyboard shows the crop that was rejected and the frame that replaced it.

## Social story demo: "Maya goes to the dentist" (measured live, 2026-09-06)

`tsx src/cli.ts seed-social film_assembled` on Gemini (paid tier) with local ClickHouse. Wall time 02:25:36 → 02:29:20 (under 4 minutes).

| Step | Result |
|---|---|
| Story path (compile world, adaptation, screenplay, memory, shots) | deterministic, **0 model calls**; 7 steps → 7 scenes → 7 static eye-level shots; 34 constraints locked (4 must-not-show) |
| Narrative + source fidelity | 25 + 20 checks, 0 violations (step order and calming rules verified) |
| Media | 3 reference sheets + 7 keyframes (`gemini-3.1-flash-image`) + 7 voice tracks (TTS), 0 failed |
| Vision inspection (`gemini-3.6-flash`) | 7 inspections, 177 media-level checks: identity, outfit, setting, comfort item, 4 forbidden-content and style constraints per frame; **0 violations on the first pass**, so no regeneration was needed |
| Certificate | `verified`: words unchanged, 12/12 order checks, 7/7 real frames inspected, 222/222 checks passed, 0 unresolved |
| Film | 7 segments, 93 s, keyframes + voice |
| ClickHouse | 92 events, 222 checks, 17 generation attempts, 7 model calls (12k in / 8.7k out tokens) |

Same key, same day, the Lumi film needed 4 visual repairs. The social story needed none: locking one outfit, static shots and reference sheets removes most of the drift before it happens, and the certificate is the proof that it was checked rather than assumed. Approval was left unsigned on purpose; the therapist or parent signs on the Certificate page.

### Second story from the same profile: "Maya gets a haircut" (measured live, 2026-09-07)

Created from Maya's child profile through the API (identity, outfit, Bun, Mum and the hallway inherited; the salon and the hairdresser Sam added for this story), with the Gemini Director composing each step.

| Step | Result |
|---|---|
| Story path | 4 steps → 4 scenes → 4 shots; composition by `gemini-3.6-flash` per step under the locks (static, eye level, whole figures); one Director output was rejected by the pre-image validator for naming a must-not-show item and re-requested |
| Media | 3 reference sheets + 4 keyframes + 4 voice tracks, 0 failed |
| Vision inspection | 96 media-level checks, 0 violations on the first pass |
| Certificate | `verified`: 120/120 checks, words unchanged, order kept, plain-language critic 6/6 clean |
| Cross-story consistency | Maya, her outfit, Bun and Mum are visually the same as in the dentist story without restating them |
| Wall time | 2 min 22 s from planning to film |

### Moving pictures (measured live, 2026-09-07)

"Add moving pictures" on the finished dentist story: a Veo clip (`veo-3.1-fast-generate-preview`, 8 s, 720p) per step from its verified keyframe, about 50–60 s each. First pass: 5 of 7 clips (one empty response, one Veo internal error); the retry filled both. The Visual Critic then inspected the first **and last** frame of every clip: two clips had drifted by the end (Bun's nose colour in step 4; in step 7 Bun ends up covering the star on Maya's t-shirt). The Repair Agent regenerates only the clip for in-clip drift. The Assembler rendered one MP4 (1 min 43 s, 7 clips, voice mixed in, clip audio dropped) with ffmpeg.

## ClickHouse in the demo

With `CLICKHOUSE_URL` set, the same run writes ~600 rows across 14 tables for this production. The Memory page shows the tables, the SQL each agent ran, and the knowledge timeline (`lumi @ scene 3`, `milo @ scene 5`). Selecting "before scene 4" in the retrieval explorer shows exactly the rows the Narrative Critic used to flag Milo's line, and the violation history for Scene 4 (`KNOWLEDGE_TIMELINE_VIOLATION · resolved · 1 repair attempt`).

## Steps for a judge

1. `pnpm install && pnpm --filter @cinememory/core build && pnpm dev:api` and, in another terminal, `pnpm dev:web`.
2. Open <http://localhost:3000>, click **Create demo project**. The pipeline runs to *Narrative verified* (seconds in fixture mode).
3. **Production**: read the activity log (real events).
4. **Continuity**: switch the filter to *all*, open `KNOWLEDGE_TIMELINE_VIOLATION`, read the evidence and the repair attempt.
5. **Screenplay**: see revisions v2/v3, the highlighted line, and *retrieved memory* for Scene 4 (Milo must not reference the secret).
6. **CineGraph**: click the knowledge node.
7. **Production** → run to *Film assembled*, then **Storyboard** and **Final Film**.
8. **Evaluation** → *Run evaluation*.
9. **New project** → *Fill kids / educational example* to try the educational workflow (requires a Gemini key; without one the API refuses instead of faking).
