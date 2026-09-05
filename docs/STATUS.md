# Status

Live checklist for the build. Updated at the end of every phase.

## Done

- [x] Monorepo (pnpm), TypeScript end to end, CI workflow, Dockerfiles for Cloud Run
- [x] Canonical data model (zod) for project, world, screenplay, shots, violations, checks, events, evaluation, film
- [x] SQLite (`node:sqlite`) + in-memory document store, typed repository, append-only event log
- [x] `PartnerAdapter` contract + `LocalPartnerAdapter`
- [x] `LLMProvider`: Gemini structured output (retries, validation re-prompt) + labelled fixture provider
- [x] Source Intelligence Agent with deterministic normalisation and constraint derivation
- [x] Adaptation Agent with must-keep enforcement and duration scaling
- [x] Screenplay Agent with id-aware schema refinements and baseline variant
- [x] World Memory: timeline folding, change log, per-scene retrieval, compact prompt rendering
- [x] CineGraph builder + neighbourhood queries; React Flow UI with inspector
- [x] Director Agent + deterministic prompt composer with inherited constraints
- [x] Narrative Continuity Critic (knowledge timeline, causal, chronology, prop possession, location)
- [x] Source Fidelity Critic (keywords, events, traits, causal order, mustKeep) with quote-verified judge hook
- [x] Visual Continuity Critic (prompt-level deterministic + Gemini vision keyframe inspection)
- [x] Repair Agent: root-cause diagnosis, targeted scene rewrite / prompt recomposition / media regeneration, bounded retries, escalation, manual override
- [x] Resumable orchestrator with stage records and reset
- [x] Media providers: Gemini (image/Imagen, Veo, TTS) and placeholder; Generation Service with status transitions and provenance
- [x] Character reference sheets generated before keyframes and passed as image references (model-generated only; placeholders are never used as references)
- [x] Film assembly: manifest, chapters, subtitles (WebVTT), browser sequencer, optional ffmpeg render
- [x] Evaluation harness: baseline vs CineMemory with metrics from records and inspectable evaluation projects
- [x] API (Hono): REST, SSE event stream, jobs, media serving, OpenAPI document
- [x] Web workspace: Dashboard, Projects, Story, CineGraph, Characters, Screenplay, Storyboard, Production, Continuity Command Center, Final Film, Evaluation
- [x] Demo project with original story and offline fixtures
- [x] Tests: 30 core + 4 API (vitest); CI runs typecheck, tests and the web build
- [x] Docs: README, ARCHITECTURE, AGENTS, DATA_MODEL, DEMO, PARTNER_INTEGRATION, BUILD_PLAN

## Not yet / needs credentials

- [ ] Live verification of Gemini text, image, Veo and TTS calls (implemented with the official SDK; untested without `GEMINI_API_KEY`)
- [ ] Partner technology selection and adapter implementation
- [ ] Optional ADK wrapper around the orchestrator's stage runners (OpenAPI tool surface exists)
- [ ] Authentication / multi-tenant deployment

## Known limitations

- Knowledge-timeline detection is phrase based (deterministic and explainable, not semantic).
- Visual media checks are skipped (reported as not evaluated) without a vision provider or with placeholder keyframes.
- The film's per-shot voice tracks are approximate in timing; subtitle cues split shot duration evenly across lines.
