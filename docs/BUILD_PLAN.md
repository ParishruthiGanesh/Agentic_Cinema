# CineMemory — Build Plan

Target: Google "Agentic Cinema: The Blockbuster Hackathon".
Thesis: the hard problem in agentic filmmaking is **long-horizon consistency**, not clip generation.
CineMemory is a persistent structured world memory plus a critic/repair loop that sits between
story understanding and media generation.

## Vertical slice first (Milestone 1)

story input → Gemini extraction → persistent world state → screenplay → CineGraph → continuity check → repair

Everything after that (shots, media, film assembly, evaluation) builds on the same state and event log.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end-to-end (pnpm workspace) | one type system for agents, API and UI; zod schemas double as Gemini `responseJsonSchema` |
| Core | `packages/core` — data model, world memory, agents, critics, repair, orchestrator, providers, evaluation | pure library, unit-tested with vitest, no HTTP |
| API | `apps/api` — Hono on Node, SSE event stream | thin, runs long pipelines in-process, resumable via persisted stage state |
| Web | `apps/web` — Next.js 16, Tailwind 4, React Flow | cinematic workspace, not a chatbot |
| LLM | Gemini via `@google/genai` (`gemini-2.5-flash`, structured output) | required by hackathon |
| Media | `MediaGenerationProvider` → Gemini image / Veo / Gemini TTS, with a labelled placeholder provider | swappable; never pretends |
| Persistence | `Repository` interface → SQLite (`node:sqlite`) + in-memory | partner tech can become a first-class repository later |
| Partner | `PartnerAdapter` interface → `LocalPartnerAdapter` | selected partner plugs in without rewriting product |

## Phases

| # | Phase | Deliverable | Status |
|---|---|---|---|
| 1 | Repo + architecture | workspace, docs, providers, repository, event log | ✅ |
| 2 | Canonical data model | zod schemas for every entity, screenplay, shot, violation, event | ✅ |
| 3 | Source Intelligence Agent | structured extraction with provenance | ✅ |
| 4 | Adaptation + Screenplay agents | adaptation plan, scenes, dialogue, knowledge reveals | ✅ |
| 5 | World Memory + CineGraph + retrieval | timeline folding, scene-scoped retrieval, graph builder | ✅ |
| 6 | Shot planning | deterministic prompt composer with inherited constraints | ✅ |
| 7 | Narrative + source continuity critics | deterministic checks with evidence | ✅ |
| 8 | Repair workflow | root-cause → targeted rewrite → re-verify → escalate | ✅ |
| 9 | Media provider + visual critic | keyframes, optional Veo, Gemini vision inspection | ✅ |
| 10 | Storyboard + Continuity Command Center | UI | ✅ |
| 11 | Final film assembly | browser sequencer + manifest, ffmpeg export when available | ✅ |
| 12 | Baseline vs CineMemory evaluation | harness with real records | ✅ |
| 13 | UX polish | | 🔄 |
| 14 | Deployment, docs, tests, demo | | 🔄 |

See `docs/STATUS.md` for the live checklist.
