# Partner track: ClickHouse

**Gemini provides reasoning. ClickHouse provides persistent, long-horizon production memory.**

CineMemory targets the ClickHouse partner track. ClickHouse is not an add-on store for application rows: it is the production memory that every agent writes to and queries from, using the official ClickHouse tooling required by the hackathon:

| Component | Package | Used for |
|---|---|---|
| `@clickhouse/client` (official Node client) | `packages/core/src/clickhouse/clickhouseMemory.ts` | all inserts and retrieval queries from the agents and the API |
| `mcp-clickhouse` (official ClickHouse MCP server) | `apps/agent` (ADK `MCPToolset`), `deploy/mcp/clickhouse-mcp.example.json` | ad-hoc SQL over production memory from the ADK Producer agent and any MCP client |
| ClickHouse Cloud / ClickHouse server | `CLICKHOUSE_URL` | production deployment |
| chdb (ClickHouse as a library) behind `deploy/local-clickhouse/server.py` | `pnpm clickhouse:local` | credential-free local development and CI integration tests when Docker is unavailable |

## What is stored

Database `cinememory` (configurable), one row per fact, append-only, project-keyed:

| Table | Written by | Content |
|---|---|---|
| `events` | every agent, via `EventBus` | the workflow event log (the Agent Activity screen) |
| `entities` | Source Intelligence | characters, locations, props, events, knowledge facts with attributes |
| `constraints` | Source Intelligence | source, visual and continuity constraints |
| `scenes` | Screenplay Agent, Repair Agent | every screenplay version's scenes, incl. lines |
| `state_changes` | World Memory (`persistWorldMemory`) | per-scene character state changes (location, emotion, knowledge, inventory) per screenplay version |
| `knowledge_events` | World Memory | who learns which fact in which scene (the knowledge timeline) |
| `shots` | Director, Generation | shot plan, prompt hash, keyframe path/provider, status transitions |
| `violations`, `violation_history` | critics, Repair | current status (ReplacingMergeTree) and full status history |
| `checks` | critics | every evaluated / not-evaluated check per run |
| `agent_actions` | `InstrumentedLLMProvider` | every Gemini call: task, model, latency, tokens, ok/error |
| `generation_attempts` | Generation Service | every keyframe / voice / video / reference attempt with provider and outcome |
| `repair_attempts` | Repair Agent | root cause, strategy, target, outcome per attempt |
| `evaluation_results` | evaluation harness | baseline vs CineMemory metrics per run |
| `metrics`, `state_mirror` | `PartnerAdapter` contract | stage durations, evaluation metrics, mirrored state |

## How agents use it (retrieval, not context stuffing)

The `ProductionMemory` interface (`packages/core/src/memory/productionMemory.ts`) is what agents call:

- `stateBefore(projectId, sceneNumber, entityIds)` — the Director and the Repair Agent retrieve only the state changes for the entities in the scene they are working on, from the latest screenplay version:

  ```sql
  SELECT change_id, scene_id, scene_number, entity_type, entity_id, field, before, after, reason, recorded_at
  FROM cinememory.state_changes FINAL
  WHERE project_id = 'lumi_demo'
    AND screenplay_version = (SELECT max(screenplay_version) FROM cinememory.state_changes WHERE project_id = 'lumi_demo')
    AND scene_number < 4 AND entity_id IN ['lumi', 'milo', 'broken_compass']
  ORDER BY scene_number, change_id
  ```
- `knowledgeBefore(projectId, sceneNumber)` — the Narrative Critic asks who knows which fact before a scene. For the demo this returns `lumi @ scene 3` before Scene 4, so Milo's line "the needle follows the light" in Scene 4 is flagged as `KNOWLEDGE_TIMELINE_VIOLATION`, the Repair Agent rewrites Scene 4 (retrieving the same scene-scoped history), memory is refolded to a new `screenplay_version`, and the critics re-verify against the new rows.
- `allChanges`, `violationHistory`, `agentActions`, `stats`, `analytics` — used by verification, the Memory page, and the Producer agent's `query_scene_memory` tool.

Every retrieval emits a `memory.retrieved` workflow event carrying `source: "clickhouse"`, the SQL, row count and latency, so the Agent Activity log and the Memory page show exactly when and what the agents retrieved.

`LocalProductionMemory` implements the same interface over the document store for unit tests and credential-free development. It is not persistent production memory and the UI says so.

## MCP

`mcp-clickhouse` is the official ClickHouse MCP server. CineMemory uses it in two places:

1. The ADK Producer agent attaches it as an `MCPToolset` (tools `clickhouse_list_databases`, `clickhouse_list_tables`, `clickhouse_run_query`) when `CLICKHOUSE_URL` is set, so the agent can answer questions such as "which shots were regenerated more than once?" with real SQL.
2. `deploy/mcp/clickhouse-mcp.example.json` configures any MCP client to browse production memory.

```bash
pip install mcp-clickhouse
CLICKHOUSE_HOST=127.0.0.1 CLICKHOUSE_PORT=8123 CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD= CLICKHOUSE_SECURE=false mcp-clickhouse
```

## Running with ClickHouse

```bash
# ClickHouse Cloud
CLICKHOUSE_URL=https://<host>.<region>.clickhouse.cloud:8443 CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=... pnpm dev:api

# Local engine (no Docker needed)
pip install chdb
pnpm clickhouse:local            # http://127.0.0.1:8123
CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm dev:api
```

The schema is created on first use (`CREATE TABLE IF NOT EXISTS …`). The integration test `packages/core/test/clickhouse.test.ts` runs the full demo pipeline against whatever `CLICKHOUSE_URL` points to and asserts retrieval results from SQL; CI runs it against the chdb-backed shim.
