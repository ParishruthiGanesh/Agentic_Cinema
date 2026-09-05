# CineMemory

**The memory & verification layer for agentic filmmaking.**
Built for Google's *Agentic Cinema: The Blockbuster Hackathon*.

CineMemory turns a story into a short film through an orchestrated multi-agent workflow:

`UNDERSTAND → ADAPT → PLAN → GENERATE → INSPECT → DETECT → REPAIR → VERIFY`

The innovation is not "generate AI movies". It is the persistent, structured **world memory** every agent reads from and writes to, the **critics** that check every scene and shot against that memory with evidence, and the **bounded repair loop** that fixes only the component that broke.

---

## Problem

Generative video models produce impressive individual clips and fall apart across many of them: character identity drift, changing clothes, props that vanish, locations and times of day that shift, characters who reference things they cannot know yet, chronology breaks, and required facts that silently disappear from an adaptation. Stuffing the whole screenplay into every prompt does not fix this; it makes prompts huge and still verifies nothing.

## Solution

| Layer | What it does |
|---|---|
| **World Memory** | Canonical characters, locations, props, events, relationships, knowledge facts, source / visual / continuity constraints, extracted from the source by Gemini and stored with provenance. A deterministic change log records what each scene changes (who learns what, who holds what, where everyone is, how they feel). |
| **Retrieval** | Agents receive a scene-scoped context: character state *at the start of that scene*, facts present characters must not reference yet, and only the constraints in force. Not the whole script. |
| **Critics** | Narrative Continuity, Source Fidelity and Visual Continuity critics produce structured violations (`constraint / expected / observed / severity / confidence / evidence`). Deterministic checks carry confidence 1.0; model-assisted checks must cite evidence a rule can verify (a quote that exists, an image that was inspected). Checks that cannot run are recorded as *not evaluated*, never as passes. |
| **Repair** | Diagnoses the root cause (screenplay, shot prompt, generated media), rewrites or regenerates only the affected component, re-verifies, retries up to a configurable limit, then escalates to the user. |
| **CineGraph** | Interactive graph of Character → Scene → Event → Prop → Location → Knowledge → Constraint, including who knows a secret from which scene and who still does not. |
| **Evaluation** | A harness runs the same project as *baseline* (no retrieval, no constraints, no repair) and as *CineMemory*, and computes metrics from the persisted check and violation records of each run. |

Two workflows are supported: **Creator / Filmmaker** (original, public-domain, licensed material, screenplay, idea) and **Kids / Educational** (lesson, concept, facts; required facts become must-keep source constraints that the Source Fidelity Critic verifies in the final screenplay).

## Architecture

```
apps/web        Next.js 16 + Tailwind 4 + React Flow   cinematic workspace (no chatbot)
apps/api        Hono on Node 22                          REST + SSE, in-process job runner, OpenAPI tool surface
packages/core   TypeScript library                       data model (zod), world memory, agents, critics, repair,
                                                         orchestrator, media providers, evaluation, demo fixtures
```

```
                ┌──────────────┐    ┌────────────┐    ┌────────────┐    ┌──────────────┐
 source text ──▶│ Source Intel │───▶│ Adaptation │───▶│ Screenplay │───▶│ World Memory │──┐
                └──────────────┘    └────────────┘    └────────────┘    │  fold + log  │  │ retrieveSceneContext()
                                                                        └──────────────┘  ▼
                ┌───────────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────┐  ┌──────────┐
   film  ◀──────│ Film Assembler│◀──│ Visual Critic│◀──│  Generation   │◀──│ Director │◀─┤ Critics  │
                └───────────────┘   └──────────────┘   │(Gemini/Imagen │   └──────────┘  │ narrative│
                          ▲               │            │ Veo / TTS)    │                  │ source   │
                          └── Repair ◀────┴────────────┴───────────────┴──────────────────┤ visual   │
                              (bounded, root-cause targeted, escalates)                   └──────────┘
```

Every agent action is written to an append-only **event log** (`WorkflowEvent`) and mirrored through the `PartnerAdapter` interface. The UI's activity log renders these records verbatim.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/AGENTS.md](docs/AGENTS.md) · [docs/DATA_MODEL.md](docs/DATA_MODEL.md) · [docs/DEMO.md](docs/DEMO.md) · [docs/PARTNER_INTEGRATION.md](docs/PARTNER_INTEGRATION.md) · [docs/STATUS.md](docs/STATUS.md)

## Setup

Requirements: Node ≥ 22.13 (uses the built-in `node:sqlite`), pnpm 10.

```bash
pnpm install
cp .env.example .env          # add GEMINI_API_KEY for live agents
pnpm --filter @cinememory/core build
```

### Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key. Enables live Gemini agents, Gemini/Imagen keyframes, Gemini TTS, Gemini vision inspection. |
| `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Use Vertex AI with Application Default Credentials instead of an API key. |
| `LLM_PROVIDER` | `gemini` (default when a key is present) or `fixture` (development replay for the bundled demo only). |
| `GEMINI_TEXT_MODEL` | default `gemini-2.5-flash` |
| `MEDIA_PROVIDER` | `gemini` or `placeholder` (labelled SVG storyboard cards, no video/audio). |
| `GEMINI_IMAGE_MODEL`, `GEMINI_VIDEO_MODEL`, `GEMINI_TTS_MODEL` | defaults `gemini-2.5-flash-image`, `veo-3.0-fast-generate-001`, `gemini-2.5-flash-preview-tts`. An `imagen-*` image model switches to the Imagen API. |
| `ENABLE_VIDEO_GENERATION` | `true` to call Veo (billable, slow). Keyframes and voice are generated regardless. |
| `CINEMEMORY_DATA_DIR` | SQLite database + media directory (default `./data`). |
| `REPAIR_MAX_ATTEMPTS` | Repair retries per violation before escalation (default 2). |
| `FFMPEG_PATH` | Optional ffmpeg binary for rendering a single MP4 when every shot has a clip. |
| `PARTNER_ADAPTER` | `local` until the hackathon partner is selected. |
| `API_PORT`, `NEXT_PUBLIC_API_URL` | API port (default 8787) and the URL the web app calls. |

### Google Cloud setup

1. Create a project and enable the **Generative Language API** (AI Studio key) or **Vertex AI API** (ADC).
2. For AI Studio: create a key at <https://aistudio.google.com/apikey> and set `GEMINI_API_KEY`.
3. For Vertex AI: `gcloud auth application-default login`, then set `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.
4. Veo and Imagen require billing; keep `ENABLE_VIDEO_GENERATION=false` until you want clips.
5. Deploy: `deploy/Dockerfile.api` and `deploy/Dockerfile.web` are Cloud Run-ready (the API reads `PORT`; mount a volume or use Cloud Storage FUSE at `/data`).
6. Agent Builder / Gemini Enterprise: the API publishes `GET /api/openapi.json`; register it as an OpenAPI tool so an enterprise agent can create projects, run the pipeline, read continuity status and trigger repairs (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#google-cloud-agent-builder)).

## How to run

```bash
pnpm dev:api        # http://localhost:8787
pnpm dev:web        # http://localhost:3000
pnpm demo:seed      # create the demo project and run it to "narrative_verified" from the CLI
pnpm eval           # baseline vs CineMemory on the demo project
pnpm test           # core (30 tests) + api (4 tests)
```

Without a Gemini key the API starts in **development mode**: the bundled demo project runs against authored fixtures (stamped `provider: "fixture"` everywhere, with a banner in the UI), keyframes are labelled placeholder cards, and any other project fails loudly instead of pretending. With a key, the same pipeline runs against Gemini.

## Demo workflow

1. Open the dashboard → **Create demo project** ("Lumi and the Broken Compass", an original story written for this project).
2. **Production**: watch the stages run and the activity log fill with real events (source analyzed, 14 constraints extracted, scene planned, violation detected, repair initiated, scene rewritten, verification passed…).
3. **Continuity**: the critics catch `KNOWLEDGE_TIMELINE_VIOLATION` (Milo mentions the compass secret in Scene 4 before Lumi tells him in Scene 5) and `REQUIRED_FACT_MISSING` (the bioluminescence fact). Open the evidence, see the repair attempts, or override.
4. **CineGraph**: click the knowledge node to see *Lumi knows: Scene 3 · Milo knows: Scene 5 · Pip: UNKNOWN*.
5. **Screenplay**: open "retrieved memory" on Scene 4 to see exactly what agents are given for that scene.
6. **Storyboard → Final Film**: generate keyframes, inspect expected vs generated state, play the assembled film with chapters and subtitles.
7. **Evaluation**: run baseline vs CineMemory and inspect the two evaluation projects behind the numbers.

Full walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Limitations

- Live Gemini, Imagen, Veo and TTS calls are implemented with the official `@google/genai` SDK but were developed without credentials; expect to adjust model names/quotas for your project.
- Visual media inspection needs a vision-capable provider and model-generated keyframes; otherwise those checks are reported as *not evaluated*.
- The film player sequences clips/keyframes in the browser; a single rendered MP4 requires ffmpeg and a clip for every shot.
- Narrative knowledge checks rely on trigger phrases extracted by the Source Intelligence Agent (deterministic, explainable, but not semantic). A quote-verified Gemini judge backs the Source Fidelity Critic when a key is configured.
- No authentication; single-tenant local deployment.

## Partner integration

Not selected yet. The `PartnerAdapter` contract (`storeEvent`, `queryEvents`, `storeState`, `retrieveState`, `search`, `emitMetric`, `healthCheck`) already routes every event, state mirror, search and metric; `LocalPartnerAdapter` implements it against the local store. See [docs/PARTNER_INTEGRATION.md](docs/PARTNER_INTEGRATION.md).

## Rights

Source material must be original, licensed, or public domain. No copyrighted novels ship in this repository. Generated previews use fictional characters; real actors are never synthesized.

License: MIT.
