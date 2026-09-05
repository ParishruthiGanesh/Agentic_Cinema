# Partner integration

The hackathon requires one partner technology: **IBM, Grafana Labs, Parallel, ClickHouse or Replit**. The partner has not been selected yet, so CineMemory ships an abstraction and a local implementation, not a fake integration.

## The seam: `PartnerAdapter`

```ts
interface PartnerAdapter {
  readonly name: string;
  storeEvent(event: WorkflowEvent): Promise<void>;
  queryEvents(query: { projectId?, agent?, type?, afterSeq?, limit? }): Promise<WorkflowEvent[]>;
  storeState(projectId, collection, id, state): Promise<void>;
  retrieveState<T>(projectId, collection, id): Promise<T | undefined>;
  search(projectId, query, limit?): Promise<PartnerSearchHit[]>;
  emitMetric(sample: { name, value, unit?, labels?, ts }): Promise<void>;
  listMetrics(name?, limit?): Promise<MetricSample[]>;
  healthCheck(): Promise<PartnerHealth>;
}
```

Already wired call sites:

- `EventBus.emit` → `storeEvent` for every workflow event.
- `runPipeline` → `emitMetric("stage_duration_ms", …)` per stage; `runEvaluation` → `emitMetric("eval_unresolved_violations", …)` per variant.
- API: `GET /api/partner/metrics`, `GET /api/partner/search`, health in `GET /api/health`.
- `LocalPartnerAdapter` implements the contract over the local document store.

Additionally, `DocumentStore` (persistence) is an interface a partner can implement to become the system of record for all artifacts.

## How each candidate would become a first-class component

| Partner | Natural role | What changes |
|---|---|---|
| **ClickHouse** | Analytics store for events, checks, violations and metrics; time-travel queries over world state; evaluation dashboards across many projects | `ClickHousePartnerAdapter` (events/metrics/search via SQL), optional `ClickHouseDocumentStore`; evaluation harness aggregates across runs; Continuity page gains trend queries |
| **Grafana Labs** | Observability of the agent workflow: stage durations, violations per critic, repair success, model latency/tokens; alerting on escalations | `GrafanaPartnerAdapter` pushing metrics (Prometheus remote write / OTLP) and events (Loki); dashboards JSON checked into `deploy/grafana/` |
| **IBM** | watsonx.ai as an alternative `LLMProvider` for critics/judges, or Db2/Cloud Object Storage as persistence and media store | `WatsonxLLMProvider` behind the same `generateStructured` contract; `IbmPartnerAdapter` for state/search |
| **Parallel** | Web research for the Source Intelligence Agent (public-domain provenance, real-world facts for educational mode) with cited evidence stored on constraints | `search()` implemented with Parallel; a research step before extraction that attaches evidence URLs to `SourceConstraint.sourceEvidence` |
| **Replit** | Hosted deployment and collaborative workspace; Replit DB/Object Storage for persistence | `ReplitDocumentStore`; one-click run configuration |

None of these exist in the repository yet. When the partner is chosen, the plan is a single targeted change: implement the adapter (and store, if relevant), select it with `PARTNER_ADAPTER=<name>`, and extend the UI where the partner adds capability (analytics, dashboards, research evidence). Agents, critics and the repair loop do not change.
