# Data model

All schemas are zod objects in `packages/core/src/model/`. Types are inferred from them; the same schemas validate persisted documents on read and Gemini output on write.

## Project (`project.ts`)

`Project { id, title, mode: creator|kids, source: {kind, title, author?, text, rightsNote?}, brief: {genre, audience, ageRange?, targetDurationSec, language, visualStyle, tone?, format, adaptationInstructions?, requiredFacts[]}, stage, stages: StageRecord[], llmProvider, mediaProvider, isDemo }`

`Stage` order: created → source_analyzed → adapted → screenplay_written → memory_built → shots_planned → narrative_verified → media_generated → visually_verified → film_assembled.

## World (`world.ts`)

```json
{
  "id": "lumi", "name": "Lumi", "role": "protagonist", "description": "...",
  "appearance": { "species": "firefly", "distinguishingFeatures": ["warm yellow glow"], "summary": "..." },
  "clothing": { "items": ["tiny blue scarf"], "colors": ["blue"], "summary": "a tiny blue knitted scarf" },
  "voice": { "description": "small, bright", "pitch": "high", "pace": "quick" },
  "personality": ["timid", "kind"], "goals": [], "fears": ["the dark"], "relationships": ["milo"],
  "current_location": "willow_meadow", "emotional_state": "anxious",
  "knowledge": [], "inventory": [], "continuity_constraints": ["cc_knowledge_fact_compass_points_to_light"],
  "scene_appearances": ["scene_1", "scene_3"], "sourceEvidence": "..."
}
```

- `Location { id, name, description, visualSummary, timeOfDayDefault?, keyFeatures[], connectedTo[] }`
- `Prop { id, name, description, visualSummary, significance, initialOwner? }`
- `StoryEvent { id, name, description, order, participants[], location?, dependsOn[], consequences[], importance }`
- `Relationship { id, from, to, type, description, sentiment }`
- `KnowledgeFact { id, statement, isSecret, triggerPhrases[], holders: [{characterId, acquiredInScene, via}], expectedLearners[] }`
- `SourceConstraint { id, kind: required_fact|educational_fact|required_event|character_trait|causal_dependency|theme|tone, statement, importance: must_keep|should_keep|nice_to_have, keywords[], relatedEntities[] }`
- `VisualConstraint { id, entityType, entityId, attribute, value, severity, promptKeywords[] }`
- `ContinuityConstraint { id, kind: knowledge_order|event_order|prop_possession|location_persistence|character_presence|time_of_day, statement, entities[], severity, params }`
- `WorldState { projectId, characters[], locations[], props[], events[], relationships[], knowledgeFacts[], sourceConstraints[], visualConstraints[], continuityConstraints[], themes[], timeline[], styleGuide, version }`
- `StateChange { id, sceneId, sceneNumber, entityType, entityId, field, before, after, reason }` — the change log

## Screenplay (`screenplay.ts`)

`Scene { id, number, act, title, locationId, timeOfDay, objective, emotionalState, characterIds[], propIds[], eventIds[], durationSec, lines: [{type: dialogue|narration|action, characterId?, text, emotion?}], knowledgeReveals: [{factId, toCharacterId, via}], propTransfers: [{propId, from?, to?, how}], exitLocations {charId: locId}, endEmotions {charId: mood}, satisfiesConstraints[] }`

`Screenplay { projectId, title, logline, acts[], scenes[], totalDurationSec, version, provenance, revisions: [{version, sceneId, reason, violationId, provenance}] }`

## Shots (`shot.ts`)

`Shot { id, sceneId, sceneNumber, index, durationSec, framing, cameraMovement, characterIds[], characterStates: [{characterId, appearance, clothing, emotionalState, position?, holding[]}], propIds[], locationId, lighting, timeOfDay, dialogue[], action, visualPrompt, negativePrompt, inheritedConstraintIds[], status: PLANNED|GENERATING|VERIFYING|FAILED|REPAIRING|VERIFIED, keyframe?, video?, audio?: MediaAsset, generationAttempts, lastError?, provenance }`

`MediaAsset { kind, path, mimeType, durationSec?, width?, height?, provenance, prompt }`

## Verification (`violation.ts`)

```json
{
  "id": "vio_…", "code": "KNOWLEDGE_TIMELINE_VIOLATION", "critic": "narrative",
  "constraintId": "cc_knowledge_fact_compass_points_to_light",
  "constraint": "Milo must not reference \"…\" before learning it",
  "expected": "Milo learns this in Scene 5 (Lumi tells him)",
  "observed": "Milo references it in Scene 4, line 2: \"…\"",
  "severity": "high", "confidence": 1,
  "evidence": "Trigger phrase \"follows the light\" matched … Knowledge state at start of Scene 4: Milo knows [nothing] …",
  "scope": { "sceneId": "scene_4", "sceneNumber": 4, "lineIndex": 2, "entityIds": ["milo", "fact_compass_points_to_light"] },
  "status": "resolved", "repairAttempts": [{ "attempt": 1, "rootCause": "screenplay", "strategy": "targeted scene rewrite", "target": "scene_4", "outcome": "resolved" }],
  "fingerprint": "…", "provenance": { "provider": "deterministic", "model": "rule-engine" }
}
```

- `CheckRecord { id, critic, constraintId?, code?, description, passed, outcome: pass|fail|not_evaluated, scope, runId }`
- `CriticRun { id, critic, startedAt, finishedAt, checksEvaluated, violationsFound, notEvaluated, provenance }`

## Events (`event.ts`)

`WorkflowEvent { id, projectId, seq, ts, agent, type, level: info|warn|error|success, message, data }`

## Evaluation (`evaluation.ts`)

`EvalMetrics { constraintsEvaluated, checksEvaluated, checksNotEvaluated, violationsDetected, violationsRepaired, violationsUnresolved, visualPassRate|null, narrativePassRate|null, sourcePassRate|null, repairAttempts }`
`EvalRunRecord { variant: baseline|cinememory, evalProjectId, metrics, violationIds[], notes[], provenance }`
`EvalComparison { baseline, cinememory }`

## Film (`film.ts`)

`FilmManifest { title, totalDurationSec, segments: [{shotId, sceneId, startSec, durationSec, video?, keyframe?, audio?}], chapters[], subtitles: [{startSec, endSec, text, speaker}], renderedVideo?, verification: {checksEvaluated, violationsResolved, violationsUnresolved, warnings[]} }`

## Provenance (`common.ts`)

`Provenance { provider: gemini|fixture|placeholder|deterministic|ffmpeg, model?, task, createdAt, latencyMs?, inputTokens?, outputTokens?, promptHash?, note? }`
