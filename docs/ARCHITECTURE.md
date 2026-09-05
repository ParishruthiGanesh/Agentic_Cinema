# Architecture

## Packages

| Package | Role |
|---|---|
| `packages/core` | Everything that matters: zod data model, document store + repository, `PartnerAdapter`, `LLMProvider`, `MediaGenerationProvider`, World Memory, CineGraph, agents, critics, repair, orchestrator, film assembly, evaluation harness, demo fixtures. No HTTP, no UI. Unit-tested. |
| `apps/api` | Hono server exposing the core over REST + Server-Sent Events, an in-process job runner (one job per project), static media serving, and an OpenAPI document. |
| `apps/web` | Next.js workspace: Dashboard, Story, CineGraph, Characters, Screenplay, Storyboard, Production, Continuity Command Center, Final Film, Evaluation. |

## Principles

1. **Deterministic logic is separate from LLM reasoning.** Agents ask Gemini for structured output (JSON schema constrained, zod-validated, re-prompted with validation errors). Everything after that (id normalisation, constraint enforcement, timeline folding, retrieval, checks, scoring, repair targeting) is plain code that is unit-tested.
2. **Provenance everywhere.** Every artifact carries `{provider, model, task, createdAt, latencyMs, tokens, promptHash, note}`. `fixture` (development replay) and `placeholder` (development media) are distinct providers and are flagged in the UI. Nothing is ever labelled as a model that did not produce it.
3. **Nothing is swallowed.** Stage failures are recorded on the project with the error and re-thrown; job failures are logged as events; critics record checks they could not run as `not_evaluated`.
4. **Resumable.** Each stage persists its outputs; `runPipeline` skips completed stages and retries failed ones. `resetFromStage` invalidates downstream artifacts explicitly.
5. **Bounded loops.** Repair attempts per violation are capped (`REPAIR_MAX_ATTEMPTS`); `repairAll` visits each open violation at most once per pass; escalation is a first-class status.

## Pipeline stages

| Stage | Runner | Writes |
|---|---|---|
| `source_analyzed` | Source Intelligence Agent | `WorldState`, raw analysis + normalisation report |
| `adapted` | Adaptation Agent | `AdaptationPlan` |
| `screenplay_written` | Screenplay Agent | `Screenplay` v1 |
| `memory_built` | World Memory (deterministic) | `StateChange[]`, rebuilt fact holders + scene appearances |
| `shots_planned` | Director Agent + prompt composer | `ShotPlan` |
| `narrative_verified` | Narrative + Source Fidelity critics, Repair Agent | `Violation[]`, `CheckRecord[]`, `CriticRun[]`, screenplay revisions, re-planned shots |
| `media_generated` | Generation Service | keyframes / voice / clips on disk, `Shot.status` transitions |
| `visually_verified` | Visual Critic, Repair Agent | visual violations/checks, shot statuses |
| `film_assembled` | Assembler | `FilmManifest`, WebVTT, optional MP4 |

## World Memory and retrieval

`foldScreenplay(world, screenplay)` walks scenes in order and emits a `StateChange` for every declared change: presence → `current_location`, `knowledgeReveals` → `knowledge`, `propTransfers` → `inventory`, `endEmotions` → `emotional_state`, `exitLocations` → `current_location`. It also rebuilds each `KnowledgeFact.holders` (`characterId @ sceneId`) and `Character.scene_appearances`.

`characterStateAt(world, changes, characterId, sceneNumber)` folds changes from earlier scenes onto the canonical entity.
`knowsFactAt(...)` answers the question the Narrative Critic asks for every dialogue line.
`retrieveSceneContext(world, screenplay, changes, sceneId)` builds the compact context agents receive: present characters with state at scene start, props, location, facts they know, facts they must not reference (with who does know), the visual / continuity / source constraints in force, the previous two scenes' objectives and the style guide. `renderSceneContext` turns it into a short prompt block.

## Critics

All critics use `CriticCollector`, which produces `CheckRecord`s (pass / fail / not_evaluated) and `Violation`s with stable fingerprints so re-runs update rather than duplicate. `reconcileViolations` marks violations that are no longer detected as resolved and reopens regressions.

- **Narrative** (deterministic): `KNOWLEDGE_TIMELINE_VIOLATION` (trigger phrase in a line by a character who does not yet know the fact), `CAUSAL_DEPENDENCY_VIOLATION` / `UNRESOLVED_DEPENDENCY` (event `dependsOn`), `CHRONOLOGY_VIOLATION` (essential events out of source order), `PROP_POSSESSION_VIOLATION` (prop in a scene whose holder is absent, or a transfer from a non-holder), `LOCATION_CONTINUITY_VIOLATION` (unconnected location jump without a declared exit).
- **Source fidelity** (deterministic + optional quote-verified judge): required / educational facts by keyword evidence, required events by scene placement, character traits by presence + keywords, causal dependencies by order, adaptation `mustKeep` promises. When a Gemini provider is present, a keyword miss is sent to a judge that must cite a verbatim quote; the quote is verified against the text before it counts.
- **Visual**: level 1 (deterministic) every relevant visual constraint and prop must appear in the shot prompt (`PROMPT_MISSING_CONSTRAINT`); level 2 (Gemini vision) inspects the keyframe per constraint and reports `PROP_MISSING`, `CLOTHING_MISMATCH`, `COLOR_MISMATCH`, `CHARACTER_IDENTITY_DRIFT`, `LOCATION_MISMATCH`, `STYLE_MISMATCH` with the model's observation as evidence. Placeholder keyframes and missing vision providers yield `not_evaluated`.

Scores in the Continuity Command Center are `passed / evaluated` per critic from the latest run; `null` when nothing was evaluated.

## Repair protocol

1. `diagnoseRootCause(violation)` → `screenplay` | `shot_prompt` | `generated_media`.
2. Strategy: targeted scene rewrite (LLM, with the retrieved scene context and the violation), deterministic prompt recomposition, or prompt strengthening + media regeneration.
3. Re-run the relevant critics; reconcile.
4. Record a `RepairAttempt` on the violation; loop until resolved or the attempt limit is reached; then `escalated`.
5. A user-initiated retry from the UI resets the attempt budget once.

## Events

`EventBus.emit(projectId, agent, type, message, data, level)` appends to the store's event log (monotonic `seq` per project), forwards to the `PartnerAdapter`, and fans out to SSE subscribers. The UI renders the persisted log; it cannot show anything the backend did not do.

## Media generation

`MediaGenerationProvider` = `generateImage`, `generateVideo`, `generateSpeech` + `capabilities`.
- `GeminiMediaProvider`: Gemini image model or Imagen for keyframes (with character reference images when stored), Veo (long-running operation, polled) for clips, Gemini TTS (PCM → WAV) for voice. Video is off unless `ENABLE_VIDEO_GENERATION=true`.
- `PlaceholderMediaProvider`: SVG storyboard cards visibly marked as placeholders; refuses video and speech.

The Generation Service writes assets under `data/media/<project>/<shot>/` and stamps provenance and the exact prompt on each `MediaAsset`.

## Google Cloud / Agent Builder

- Gemini is the reasoning model for all agents (`GeminiLLMProvider`, JSON-schema constrained output, retries with backoff, validation re-prompt).
- Vertex AI is supported through the same SDK with ADC.
- The API is exposed as an **OpenAPI tool** (`GET /api/openapi.json`) with operations for creating projects, running the pipeline, reading world memory / continuity, repairing violations and running evaluations. Register it in Agent Builder / Gemini Enterprise as a tool so an enterprise agent ("produce a 90-second safety explainer for ages 6–8 and report continuity status") can drive CineMemory end to end. Each operation is idempotent or returns a job that can be polled.
- The orchestrator's stage runners are plain async functions over a shared `AgentContext`; wrapping them as ADK agents/tools is a thin adapter (see `docs/PARTNER_INTEGRATION.md` for the same seam pattern).

## Persistence

Two stores with different jobs:

- **Document store** (`DocumentStore`: SQLite via `node:sqlite`, or in-memory) → `Repository` (typed, zod-validated reads). Holds the *current* artifacts the UI serves: projects, world, adaptation, screenplay, shots, violations, checks, critic runs, evaluations, film, plus the append-only `events` table.
- **Production memory** (`ProductionMemory`: `ClickHouseMemory` in production, `LocalProductionMemory` for tests) holds the *history* and is what agents query: every screenplay version's scenes and state changes, knowledge events, constraints, violation history, checks, agent actions, generation and repair attempts, evaluation results. `AgentContext.memory` is passed to every agent; `persistWorldMemory` writes the fold to both stores; `runVerification`, the Director and the Repair Agent retrieve from `memory` and emit `memory.retrieved` events with the SQL. See `docs/PARTNER_INTEGRATION.md`.

## Google ADK Producer

`apps/agent` wraps the orchestrator, critics, repair loop, evaluation harness and production memory as ADK `FunctionTool`s on a Gemini `LlmAgent`, with the official ClickHouse MCP server attached as an `MCPToolset`. The API mounts it at `POST /api/agent/chat`; the Production page hosts the panel. See `docs/GOOGLE_CLOUD.md`.
