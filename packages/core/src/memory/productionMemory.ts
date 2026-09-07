import type {
  CheckRecord,
  ChildProfile,
  EvalComparison,
  Provenance,
  RepairAttempt,
  Screenplay,
  ShotPlan,
  StateChange,
  StoryOutcome,
  Violation,
  WorkflowEvent,
  WorldState,
} from "../model/index.js";
import type { PartnerHealth } from "../partner/adapter.js";
import type { Repository } from "../persistence/repository.js";
import { initialKnowledge } from "./worldMemory.js";
import { newId } from "../util/hash.js";

/**
 * Production Memory is CineMemory's long-horizon store: every scene, shot, state change, knowledge
 * event, constraint, violation, agent action, generation and repair attempt, and evaluation result,
 * appended over the life of a production. Gemini reasons; production memory remembers.
 *
 * Agents retrieve scene-scoped history from here instead of receiving the whole film in every prompt.
 * `ClickHouseMemory` is the production implementation; `LocalProductionMemory` serves the same
 * interface from the local document store for tests and credential-free development.
 */
export interface MemoryTrace {
  source: "clickhouse" | "local";
  /** The SQL actually executed (ClickHouse) so the UI can show it. */
  sql?: string;
  rows: number;
  latencyMs: number;
}

export interface KnowledgeEventRow {
  factId: string;
  statement: string;
  characterId: string;
  sceneId: string;
  sceneNumber: number;
  via?: string;
}

export interface AgentActionRecord {
  projectId: string;
  actionId: string;
  task: string;
  provider: string;
  model?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  promptHash?: string;
  ok: boolean;
  error?: string;
  createdAt: string;
}

export interface GenerationAttemptRecord {
  projectId: string;
  shotId: string;
  attempt: number;
  kind: "keyframe" | "video" | "audio" | "reference";
  provider: string;
  model?: string;
  path?: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface ViolationHistoryRow {
  violationId: string;
  code: string;
  critic: string;
  status: string;
  sceneId?: string;
  shotId?: string;
  observed: string;
  detectedAt: string;
  repairAttempts: number;
}

export interface MemoryTableStat {
  table: string;
  rows: number;
}

export interface ProductionMemory {
  readonly name: string;
  readonly persistent: boolean;
  init(): Promise<void>;
  healthCheck(): Promise<PartnerHealth>;

  /* write side */
  recordEvent(event: WorkflowEvent): Promise<void>;
  recordWorld(world: WorldState): Promise<void>;
  recordScreenplay(screenplay: Screenplay): Promise<void>;
  recordStateChanges(projectId: string, changes: StateChange[], screenplayVersion: number): Promise<void>;
  recordKnowledgeEvents(projectId: string, world: WorldState, screenplay: Screenplay): Promise<void>;
  recordShots(plan: ShotPlan): Promise<void>;
  recordViolations(violations: Violation[]): Promise<void>;
  recordChecks(checks: CheckRecord[]): Promise<void>;
  recordAgentAction(action: AgentActionRecord): Promise<void>;
  recordGenerationAttempt(attempt: GenerationAttemptRecord): Promise<void>;
  recordRepairAttempt(projectId: string, violationId: string, attempt: RepairAttempt): Promise<void>;
  recordEvaluation(comparison: EvalComparison): Promise<void>;
  /** Social stories: the child's canonical profile (versioned) and what happened after the real visit. */
  recordChildProfile(profile: ChildProfile): Promise<void>;
  recordOutcome(outcome: StoryOutcome): Promise<void>;

  /* read side: what agents reason with */
  stateBefore(projectId: string, sceneNumber: number, entityIds?: string[]): Promise<{ changes: StateChange[]; trace: MemoryTrace }>;
  allChanges(projectId: string): Promise<{ changes: StateChange[]; trace: MemoryTrace }>;
  knowledgeBefore(projectId: string, sceneNumber: number): Promise<{ events: KnowledgeEventRow[]; trace: MemoryTrace }>;
  violationHistory(projectId: string, scope?: { sceneId?: string; shotId?: string }): Promise<{ violations: ViolationHistoryRow[]; trace: MemoryTrace }>;
  agentActions(projectId: string, limit?: number): Promise<AgentActionRecord[]>;
  stats(projectId?: string): Promise<{ tables: MemoryTableStat[]; trace: MemoryTrace }>;
}

/** Fold knowledge holders into per-character acquisition events (deterministic, shared by both backends). */
export function knowledgeEventsFrom(world: WorldState, screenplay: Screenplay): KnowledgeEventRow[] {
  const sceneById = new Map(screenplay.scenes.map((s) => [s.id, s]));
  const rows: KnowledgeEventRow[] = [];
  for (const f of world.knowledgeFacts) {
    for (const h of f.holders) {
      const scene = sceneById.get(h.acquiredInScene);
      rows.push({ factId: f.id, statement: f.statement, characterId: h.characterId, sceneId: h.acquiredInScene, sceneNumber: scene?.number ?? 0, via: h.via });
    }
  }
  for (const c of world.characters) {
    for (const factId of initialKnowledge(world, c.id)) {
      if (!rows.some((r) => r.factId === factId && r.characterId === c.id)) {
        rows.push({ factId, statement: world.knowledgeFacts.find((f) => f.id === factId)?.statement ?? factId, characterId: c.id, sceneId: "start", sceneNumber: 0, via: "known from the start" });
      }
    }
  }
  return rows;
}

const timed = <T>(fn: () => T): { value: T; latencyMs: number } => {
  const t = Date.now();
  const value = fn();
  return { value, latencyMs: Date.now() - t };
};

/**
 * Local implementation over the document store. Same contract and same query semantics as ClickHouse,
 * so agents behave identically; it just is not a shared, queryable, long-horizon analytics store.
 */
export class LocalProductionMemory implements ProductionMemory {
  readonly name = "local";
  readonly persistent = false;
  private knowledge = new Map<string, KnowledgeEventRow[]>();

  constructor(private repo: Repository) {}

  async init(): Promise<void> {}
  async healthCheck(): Promise<PartnerHealth> {
    return { ok: true, adapter: "local-memory", detail: "document store (not persistent production memory)", checkedAt: new Date().toISOString() };
  }

  async recordEvent(): Promise<void> {}
  async recordWorld(): Promise<void> {}
  async recordScreenplay(): Promise<void> {}
  async recordStateChanges(): Promise<void> {
    /* the Repository already holds the current change log */
  }
  async recordKnowledgeEvents(projectId: string, world: WorldState, screenplay: Screenplay): Promise<void> {
    this.knowledge.set(projectId, knowledgeEventsFrom(world, screenplay));
  }
  async recordShots(): Promise<void> {}
  async recordViolations(): Promise<void> {}
  async recordChecks(): Promise<void> {}
  async recordAgentAction(a: AgentActionRecord): Promise<void> {
    this.repo.store.put("agent_actions", a.projectId, a.actionId, a);
  }
  async recordGenerationAttempt(g: GenerationAttemptRecord): Promise<void> {
    this.repo.store.put("generation_attempts", g.projectId, `${g.shotId}_${g.kind}_${g.attempt}_${newId("g")}`, g);
  }
  async recordRepairAttempt(): Promise<void> {}
  async recordEvaluation(): Promise<void> {}
  async recordChildProfile(): Promise<void> {}
  async recordOutcome(): Promise<void> {}

  async stateBefore(projectId: string, sceneNumber: number, entityIds?: string[]) {
    const { value, latencyMs } = timed(() => this.repo.listStateChanges(projectId).filter((c) => c.sceneNumber < sceneNumber && (!entityIds || entityIds.includes(c.entityId))));
    return { changes: value, trace: { source: "local" as const, rows: value.length, latencyMs } };
  }
  async allChanges(projectId: string) {
    const { value, latencyMs } = timed(() => this.repo.listStateChanges(projectId));
    return { changes: value, trace: { source: "local" as const, rows: value.length, latencyMs } };
  }
  async knowledgeBefore(projectId: string, sceneNumber: number) {
    const { value, latencyMs } = timed(() => {
      let rows = this.knowledge.get(projectId);
      if (!rows) {
        const world = this.repo.getWorld(projectId);
        const sp = this.repo.getScreenplay(projectId);
        rows = world && sp ? knowledgeEventsFrom(world, sp) : [];
      }
      return rows.filter((r) => r.sceneNumber < sceneNumber);
    });
    return { events: value, trace: { source: "local" as const, rows: value.length, latencyMs } };
  }
  async violationHistory(projectId: string, scope: { sceneId?: string; shotId?: string } = {}) {
    const { value, latencyMs } = timed(() =>
      this.repo
        .listViolations(projectId)
        .filter((v) => (!scope.sceneId || v.scope.sceneId === scope.sceneId) && (!scope.shotId || v.scope.shotId === scope.shotId))
        .map((v) => ({ violationId: v.id, code: v.code, critic: v.critic, status: v.status, sceneId: v.scope.sceneId, shotId: v.scope.shotId, observed: v.observed, detectedAt: v.detectedAt, repairAttempts: v.repairAttempts.length })),
    );
    return { violations: value, trace: { source: "local" as const, rows: value.length, latencyMs } };
  }
  async agentActions(projectId: string, limit = 50): Promise<AgentActionRecord[]> {
    return this.repo.store
      .list<AgentActionRecord>("agent_actions", projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async stats(projectId?: string) {
    const t = Date.now();
    const count = (col: string) => (projectId ? this.repo.store.list(col, projectId).length : this.repo.store.listAll(col).length);
    const tables = [
      { table: "events", rows: projectId ? this.repo.listEvents(projectId).length : 0 },
      { table: "state_changes", rows: count("state_changes") },
      { table: "violations", rows: count("violations") },
      { table: "checks", rows: count("checks") },
      { table: "agent_actions", rows: count("agent_actions") },
      { table: "generation_attempts", rows: count("generation_attempts") },
    ];
    return { tables, trace: { source: "local" as const, rows: tables.length, latencyMs: Date.now() - t } };
  }
}

export const provenanceForMemory = (memory: ProductionMemory, task: string): Provenance => ({ provider: memory.name === "clickhouse" ? "clickhouse" : "local", task, createdAt: new Date().toISOString() });
