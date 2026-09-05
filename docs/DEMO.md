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

Then to `film_assembled`: keyframes (placeholder cards without a media key, Gemini/Imagen images with one), prompt-level visual checks, film manifest with 6 chapters and 16 subtitle cues.

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
