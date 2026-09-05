import type { WorkflowEvent } from "../model/index.js";
import type { DocumentStore } from "../persistence/documentStore.js";
import type {
  MetricSample,
  PartnerAdapter,
  PartnerEventQuery,
  PartnerHealth,
  PartnerSearchHit,
} from "./adapter.js";

const METRICS_COLLECTION = "partner_metrics";
const METRICS_PROJECT = "__global__";

/**
 * Local implementation of the PartnerAdapter contract backed by the same document store the
 * app uses. Events are persisted by the Repository's append-only log; this adapter mirrors the
 * contract so a partner backend can be dropped in with identical call sites.
 */
export class LocalPartnerAdapter implements PartnerAdapter {
  readonly name = "local";
  private metricSeq = 0;

  constructor(private store: DocumentStore) {}

  async storeEvent(_event: WorkflowEvent): Promise<void> {
    // Already persisted in the store's event log by Repository.appendEvent; nothing extra locally.
  }

  async queryEvents(query: PartnerEventQuery): Promise<WorkflowEvent[]> {
    if (!query.projectId) return [];
    const events = this.store.listEvents(
      query.projectId,
      query.afterSeq ?? 0,
      query.limit ?? 500,
    ) as unknown as WorkflowEvent[];
    return events.filter((e) => (!query.agent || e.agent === query.agent) && (!query.type || e.type === query.type));
  }

  async storeState(projectId: string, collection: string, id: string, state: unknown): Promise<void> {
    this.store.put(`partner_state:${collection}`, projectId, id, state);
  }

  async retrieveState<T = unknown>(projectId: string, collection: string, id: string): Promise<T | undefined> {
    return this.store.get<T>(`partner_state:${collection}`, projectId, id);
  }

  /** Substring search over stored documents. Good enough for dev; a partner can supply real search. */
  async search(projectId: string, query: string, limit = 20): Promise<PartnerSearchHit[]> {
    const q = query.toLowerCase();
    const hits: PartnerSearchHit[] = [];
    for (const collection of ["world", "screenplay", "shots", "violations"]) {
      for (const doc of this.store.listAll<unknown>(collection)) {
        if (doc.projectId !== projectId) continue;
        const text = JSON.stringify(doc.data);
        const idx = text.toLowerCase().indexOf(q);
        if (idx >= 0) {
          hits.push({
            projectId,
            collection,
            id: doc.id,
            score: 1,
            snippet: text.slice(Math.max(0, idx - 60), idx + 100),
          });
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  }

  async emitMetric(sample: MetricSample): Promise<void> {
    this.metricSeq += 1;
    const id = `${sample.ts}-${this.metricSeq}-${sample.name}`;
    this.store.put(METRICS_COLLECTION, METRICS_PROJECT, id, sample);
  }

  async listMetrics(name?: string, limit = 200): Promise<MetricSample[]> {
    return this.store
      .list<MetricSample>(METRICS_COLLECTION, METRICS_PROJECT)
      .filter((m) => !name || m.name === name)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit);
  }

  async healthCheck(): Promise<PartnerHealth> {
    return { ok: true, adapter: this.name, detail: "local document store", checkedAt: new Date().toISOString() };
  }
}
