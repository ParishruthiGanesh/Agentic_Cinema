import type { WorkflowEvent } from "../model/index.js";

/**
 * PartnerAdapter is the seam where the selected hackathon partner technology
 * (IBM, Grafana Labs, Parallel, ClickHouse or Replit) becomes a first-class component.
 *
 * Until a partner is chosen, only `LocalPartnerAdapter` exists. It is NOT a fake integration:
 * it implements the contract against the local document store so the rest of the system already
 * routes events, state, search and metrics through this interface.
 */
export interface MetricSample {
  name: string;
  value: number;
  unit?: string;
  labels?: Record<string, string>;
  ts: string;
}

export interface PartnerEventQuery {
  projectId?: string;
  agent?: string;
  type?: string;
  afterSeq?: number;
  limit?: number;
}

export interface PartnerSearchHit {
  projectId: string;
  collection: string;
  id: string;
  score: number;
  snippet: string;
}

export interface PartnerHealth {
  ok: boolean;
  adapter: string;
  detail?: string;
  checkedAt: string;
}

export interface PartnerAdapter {
  readonly name: string;
  storeEvent(event: WorkflowEvent): Promise<void>;
  queryEvents(query: PartnerEventQuery): Promise<WorkflowEvent[]>;
  storeState(projectId: string, collection: string, id: string, state: unknown): Promise<void>;
  retrieveState<T = unknown>(projectId: string, collection: string, id: string): Promise<T | undefined>;
  search(projectId: string, query: string, limit?: number): Promise<PartnerSearchHit[]>;
  emitMetric(sample: MetricSample): Promise<void>;
  listMetrics(name?: string, limit?: number): Promise<MetricSample[]>;
  healthCheck(): Promise<PartnerHealth>;
}
