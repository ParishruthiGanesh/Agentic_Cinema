import type { LLMProvider } from "../llm/provider.js";
import type { MediaGenerationProvider } from "../media/provider.js";
import type { ProductionMemory } from "../memory/productionMemory.js";
import type { AgentName, WorkflowEvent } from "../model/index.js";
import type { PartnerAdapter } from "../partner/adapter.js";
import type { Repository } from "../persistence/repository.js";
import { newId } from "../util/hash.js";

export interface CineMemoryConfig {
  repairMaxAttempts: number;
  enableVideoGeneration: boolean;
  /** Directory where generated media files are written. */
  mediaDir: string;
}

export const DEFAULT_CONFIG: CineMemoryConfig = {
  repairMaxAttempts: 2,
  enableVideoGeneration: false,
  mediaDir: "./data/media",
};

export type EventListener = (event: WorkflowEvent) => void;

/**
 * Event bus: persists every workflow event, forwards it to the partner adapter, and fans out to
 * live subscribers (the API's SSE stream). This is the only way agents report activity, so the
 * UI activity log is always a faithful record of what the backend did.
 */
export class EventBus {
  private listeners = new Set<EventListener>();
  private memory?: ProductionMemory;
  constructor(
    private repo: Repository,
    private partner?: PartnerAdapter,
  ) {}

  /** Production memory receives every event too (ClickHouse `events` table). */
  attachMemory(memory: ProductionMemory) {
    this.memory = memory;
  }

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(
    projectId: string,
    agent: AgentName,
    type: string,
    message: string,
    data: Record<string, unknown> = {},
    level: WorkflowEvent["level"] = "info",
  ): WorkflowEvent {
    const event = this.repo.appendEvent({
      id: newId("evt"),
      projectId,
      ts: new Date().toISOString(),
      agent,
      type,
      level,
      message,
      data,
    });
    void this.partner?.storeEvent(event).catch(() => undefined);
    // When the partner adapter IS the memory (ClickHouse), avoid a duplicate insert.
    if (this.memory && (this.memory as unknown) !== (this.partner as unknown)) void this.memory.recordEvent(event).catch(() => undefined);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* listener errors must never break the pipeline */
      }
    }
    return event;
  }
}

export interface AgentContext {
  repo: Repository;
  llm: LLMProvider;
  media: MediaGenerationProvider;
  partner: PartnerAdapter;
  /** Long-horizon production memory (ClickHouse in production, local in tests). */
  memory: ProductionMemory;
  events: EventBus;
  config: CineMemoryConfig;
}

/** Human-readable label for retrieval events. */
export const memoryLabel = (ctx: AgentContext) => (ctx.memory.name === "clickhouse" ? "ClickHouse" : "local memory");
