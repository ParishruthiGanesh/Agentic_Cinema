# Status

Live checklist for the build. Updated at the end of every phase.

## Runtime truth (what actually executed in this environment)

| Integration | State | Evidence |
|---|---|---|
| ClickHouse production memory (`@clickhouse/client`) | **executed** against a real ClickHouse engine (chdb 26.7 behind `deploy/local-clickhouse/server.py`) | `packages/core/test/clickhouse.test.ts` passes: full pipeline recorded, scene-scoped retrieval from SQL, 14 tables populated; API `/api/projects/:id/memory` |
| Official ClickHouse MCP server (`mcp-clickhouse`) | **executed** (list_databases / list_tables / run_query against the same engine) | attached to the ADK Producer as `MCPToolset` when `CLICKHOUSE_URL` is set |
| Google ADK Producer agent (`@google/adk` LlmAgent + FunctionTools) | **constructed and tool-tested** (tools drive the real pipeline, retrieval and repair); the LLM turn itself needs a Gemini key | `apps/agent/test/tools.test.ts`; API `/api/agent/chat` returns a clear 503 without a key |
| Gemini text (structured JSON), continuity reasoning, vision, TTS (`@google/genai`) | **executed** on a live key: smoke test 4/5, full demo pipeline to `narrative_verified`, baseline-vs-CineMemory evaluation (see DEMO.md) | model pool with quota/overload failover; every call in ClickHouse `agent_actions` |
| Gemini image models, Veo | **blocked by billing**: every image model returns quota 0 on the free tier; Veo not attempted | needs a billing-enabled project |
| Development fixtures + placeholder media | used only when no key is configured; every artifact is stamped `fixture` / `placeholder` and the UI shows a banner | `packages/core/src/demo/fixtures.ts`, `media/placeholder.ts` |

## Done

- [x] Monorepo (pnpm), TypeScript end to end, CI (typecheck, tests incl. real ClickHouse, web build), Dockerfiles for Cloud Run
- [x] Canonical data model (zod) for project, world, screenplay, shots, violations, checks, events, evaluation, film
- [x] SQLite document store for the app, typed repository, append-only event log
- [x] **ClickHouse production memory**: `ProductionMemory` contract, `ClickHouseMemory` (events, entities, constraints, scenes, state changes, knowledge events, shots, violations + history, checks, agent actions, generation attempts, repair attempts, evaluation results, metrics), `PartnerAdapter` implemented by the same class
- [x] Scene-scoped retrieval from ClickHouse in the Director, the critics and the Repair Agent; every retrieval logged with its SQL
- [x] `InstrumentedLLMProvider`: every model call becomes an `agent.llm.call` event and an `agent_actions` row
- [x] Gemini providers (text with JSON-schema output, vision, image/Imagen, Veo, TTS) via the official SDK, with retries and validation re-prompt
- [x] Source Intelligence, Adaptation, Screenplay, World Memory, Director (deterministic prompt composer), Generation, Narrative / Source Fidelity / Visual critics, Repair (bounded, escalating), Film assembly, Evaluation harness
- [x] **ADK Producer agent** with CineMemory tools + ClickHouse MCP toolset; terminal chat and in-product panel
- [x] Web workspace: Dashboard, Story, CineGraph, Characters, Screenplay, Storyboard, Production (+ Producer agent), Continuity Command Center, **Memory (ClickHouse)**, Final Film, Evaluation
- [x] Demo project (original story) with two engineered continuity faults; offline fixtures for tests
- [x] Tests: 31 core (incl. ClickHouse integration) + 4 API + 2 agent
- [x] Docs: README, ARCHITECTURE, AGENTS, DATA_MODEL, DEMO, PARTNER_INTEGRATION (ClickHouse), GOOGLE_CLOUD, BUILD_PLAN

## Needs credentials / accounts (cannot be finished from inside the build sandbox)

- [ ] Billing on the Gemini key's Google Cloud project → image quota (keyframes, real-frame vision inspection), Veo, and more than 20 requests/day/model
- [ ] ClickHouse Cloud service → set `CLICKHOUSE_URL/USER/PASSWORD`; schema is created on first use
- [ ] Google Cloud project for Cloud Run (API + web) and optional Vertex AI Agent Engine deployment of the Producer
- [ ] Public hosted URL (Cloud Run) and public GitHub repository visibility

## Known limitations

- Knowledge-timeline detection is phrase based (deterministic and explainable, not semantic); the Producer agent and the source-fidelity judge add Gemini reasoning on top, but never replace the deterministic check.
- Visual media checks are skipped (reported as not evaluated) without a vision provider or with placeholder keyframes.
- The local ClickHouse shim implements the subset of the HTTP interface used by the official clients; production must use ClickHouse Cloud or a ClickHouse server.
- Subtitle timing splits each shot's duration evenly across its lines.
