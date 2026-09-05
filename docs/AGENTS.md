# Agents

Every agent has a defined responsibility, a typed input, a schema-validated output, persisted state and events it must emit. None of them is "another chatbot": LLM calls are structured-output calls with a system prompt, a task-specific prompt built from retrieved state, and a zod schema that doubles as Gemini's `responseJsonSchema`.

| Agent | Kind | Input | Output | Deterministic post-processing |
|---|---|---|---|---|
| **Source Intelligence** (`agents/sourceIntelligence.ts`) | LLM | project source + brief | `SourceAnalysisOutput` | slugifies ids, drops dangling references (reported as a warning event), derives keywords for constraints, adds `educational_fact` constraints for brief facts, adds a `knowledge_order` continuity constraint for every secret, builds `WorldState` |
| **Adaptation** (`agents/adaptation.ts`) | LLM | world + brief | `AdaptationPlan` | forces entities related to `must_keep` constraints and essential events into `mustKeep`, scales beat durations to the target |
| **Screenplay** (`agents/screenplay.ts`) | LLM | world + plan | `ScreenplayOutput` | schema refinements reject unknown ids (the provider re-prompts with the exact issues), renumbers scenes, scales durations |
| **World Memory** (`memory/worldMemory.ts`) | deterministic | world + screenplay | `StateChange[]`, rebuilt holders | pure function; retrieval API for other agents |
| **Director** (`agents/director.ts`) | LLM per scene | `SceneContext` (retrieved) | `ScenePlanOutput` | validates line/character/prop membership, scales shot durations, **composes the visual prompt** from canonical state + constraints, records inherited constraint ids |
| **Generation Service** (`media/generation.ts`) | provider | `Shot` | `MediaAsset`s | status transitions PLANNED → GENERATING → VERIFYING; failures → FAILED with error |
| **Narrative Continuity Critic** (`critics/narrative.ts`) | deterministic | world + screenplay + changes | checks + violations | — |
| **Source Fidelity Critic** (`critics/sourceFidelity.ts`) | deterministic + optional judge | world + screenplay + plan | checks + violations | judge quote must exist verbatim in the text |
| **Visual Continuity Critic** (`critics/visual.ts`) | deterministic + optional vision | world + shots + media | checks + violations | placeholder / missing media → `not_evaluated` |
| **Repair** (`agents/repair.ts`) | LLM or deterministic per root cause | violation | rewritten scene / recomposed prompt / regenerated media | re-verifies, bounded retries, escalation |
| **Film Assembler** (`film/assembly.ts`) | deterministic | shots + screenplay + violations | `FilmManifest`, WebVTT, optional MP4 | — |
| **Evaluation** (`evaluation/harness.ts`) | orchestration | project | `EvalComparison` | metrics computed from records |
| **Orchestrator** (`workflow/orchestrator.ts`) | deterministic | project + target stage | stage records | resumable, resettable |

## Shared state

`AgentContext = { repo, llm, media, partner, events, config }`. Agents never hold state in memory between calls; they read and write the repository so any run can resume.

## Events emitted (examples)

```
source.analysis.started / completed / dangling_refs
memory.constraints.extracted / memory.retrieved / memory.built / memory.rebuilt
adaptation.completed / adaptation.constraints.enforced
screenplay.completed
shots.scene.planned / shots.planning.completed
verification.started / verification.completed / violation.detected
repair.initiated / repair.scene.rewritten / repair.prompt.recomposed / repair.verified / repair.attempt.failed / repair.escalated / repair.summary
shot.generation.started / shot.keyframe.generated / shot.voice.generated / shot.video.generated / shot.generation.failed
film.assembly.completed / film.rendered
evaluation.variant.completed / evaluation.completed
stage.started / stage.completed / stage.failed / pipeline.reset
violation.overridden / violation.retry (user)
```

## Prompts

Prompts live in `packages/core/src/agents/prompts/`. They are short, rule-oriented and reference world ids. The screenplay prompt has a `baseline` variant (source text + beat sheet, no canonical state or knowledge timeline) used only by the evaluation harness.

## Fixture mode

`FixtureLLMProvider` replays authored structured outputs for the bundled demo (`packages/core/src/demo/fixtures.ts`). It exists so the deterministic 80% of the system can be exercised and tested offline. It never impersonates Gemini: provenance is `fixture`, the UI shows a banner, and any prompt that is not the demo's raises `FixtureMissingError`.
