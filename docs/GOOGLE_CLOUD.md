# Google Cloud and Gemini in CineMemory

## Where Gemini runs

| Path | Model (env) | Code |
|---|---|---|
| Source understanding, adaptation, screenplay, shot planning, scene rewrite (repair) | `GEMINI_TEXT_MODEL` (default `gemini-2.5-flash`), JSON-schema constrained output | `packages/core/src/llm/gemini.ts` + `agents/*` |
| Continuity reasoning: source-fidelity judge (quote-verified), visual keyframe inspection | same text model with vision | `critics/sourceFidelity.ts`, `critics/visual.ts` |
| Keyframes and character reference sheets | `GEMINI_IMAGE_MODEL` (`gemini-2.5-flash-image`; `imagen-*` uses the Imagen API) | `media/gemini.ts` |
| Video clips | `GEMINI_VIDEO_MODEL` (`veo-3.0-fast-generate-001`), `ENABLE_VIDEO_GENERATION=true` | `media/gemini.ts` |
| Voice | `GEMINI_TTS_MODEL` (`gemini-2.5-flash-preview-tts`) | `media/gemini.ts` |
| Producer agent | ADK `LlmAgent` on Gemini | `apps/agent` |

All calls go through the official `@google/genai` SDK. API-key mode (`GEMINI_API_KEY`) and Vertex AI mode (`GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_CLOUD_PROJECT` + ADC) use the same code.

Every call is instrumented (`InstrumentedLLMProvider`): it is emitted as an `agent.llm.call` workflow event with model, latency and tokens, and stored in ClickHouse `agent_actions`. Failures are emitted as `agent.llm.failed` with the API message and stored with `ok = 0`. Nothing falls back silently; `pnpm gemini:smoke` exercises each path and prints exactly which service/model failed.

## Agent architecture (Google ADK)

CineMemory's multi-agent workflow is:

`Source Intelligence → Adaptation → Screenplay → World Memory → Director/Shot planning → Generation → Continuity Critics → Repair → Verification → Film assembly`

Two layers make it agentic rather than a set of API routes:

1. **Stage agents** (`packages/core/src/agents`, `critics`, `workflow`): each has a defined responsibility, typed input, schema-validated Gemini output, deterministic post-processing, shared state in the repository and in ClickHouse production memory, and emits workflow events. The orchestrator is resumable and the Repair Agent runs a bounded diagnose → fix → re-verify → escalate loop.
2. **Producer agent** (`apps/agent`, Google ADK for JavaScript `@google/adk`): an `LlmAgent` on Gemini whose tools are CineMemory's capabilities — `create_project`, `run_pipeline`, `get_project_status`, `list_violations`, `query_scene_memory` (ClickHouse retrieval), `repair_violation`, `run_critics`, `run_evaluation` — plus the official ClickHouse MCP server as an `MCPToolset`. The Producer decides what to run, retrieves scene-scoped history before reasoning about a violation, invokes repair and reports outcomes from tool results only. It is exposed in the product (Production page → "Producer agent") through `POST /api/agent/chat`, and every tool call it makes is a real workflow event (`agent.producer.tool`).

`apps/agent/src/chat.ts` runs the same agent in a terminal (`pnpm --filter @cinememory/agent chat`).

## Agent Builder / Gemini Enterprise

- **Vertex AI Agent Engine**: the Producer is a standard ADK agent (`createProducerAgent(ctx)` returns the `LlmAgent`); deploy it with the ADK deployment flow for Agent Engine and point it at the CineMemory API + ClickHouse by environment variables. Session state can use `VertexAiSessionService` instead of the in-memory service.
- **OpenAPI tool**: the API publishes `GET /api/openapi.json`. Register it as an OpenAPI tool in Agent Builder / Gemini Enterprise so an enterprise agent can create projects, run the pipeline, read continuity status and trigger repairs without the ADK package.

## Setup

1. Create a Google Cloud project; enable the Generative Language API (AI Studio key) or the Vertex AI API (ADC).
2. AI Studio key: <https://aistudio.google.com/apikey> → put it in `.env` as `GEMINI_API_KEY=...` (never commit `.env`; `.gitignore` excludes it).
3. Vertex AI: `gcloud auth application-default login`, then `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.
4. `pnpm gemini:smoke` (add `--video` for Veo) to verify every model path with your quota before running productions.
5. Cloud Run: build `deploy/Dockerfile.api` and `deploy/Dockerfile.web`; set the environment variables from `.env.example` as Cloud Run variables/secrets (`GEMINI_API_KEY`, `CLICKHOUSE_*`, `MEDIA_PROVIDER=gemini`); mount a Cloud Storage FUSE volume at `/data` for generated media, and set `NEXT_PUBLIC_API_URL` at web build time.
