import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type {
  CheckRecord,
  ChildProfile,
  EvalComparison,
  RepairAttempt,
  Screenplay,
  ShotPlan,
  StateChange,
  StoryOutcome,
  Violation,
  WorkflowEvent,
  WorldState,
} from "../model/index.js";
import type { MetricSample, PartnerAdapter, PartnerEventQuery, PartnerHealth, PartnerSearchHit } from "../partner/adapter.js";
import {
  knowledgeEventsFrom,
  type AgentActionRecord,
  type GenerationAttemptRecord,
  type KnowledgeEventRow,
  type MemoryTrace,
  type ProductionMemory,
  type ViolationHistoryRow,
} from "../memory/productionMemory.js";
import { newId } from "../util/hash.js";
import { MEMORY_TABLES, schemaStatements } from "./schema.js";

export interface ClickHouseMemoryOptions {
  url: string;
  username?: string;
  password?: string;
  database?: string;
  requestTimeoutMs?: number;
}

/** ISO 8601 → ClickHouse DateTime64 literal (UTC). */
const ts = (iso: string) => iso.replace("T", " ").replace("Z", "").slice(0, 23);
/** ClickHouse DateTime64 string → ISO 8601. */
const fromTs = (v: string) => (v.includes("T") ? v : v.replace(" ", "T") + "Z");
const now = () => ts(new Date().toISOString());
const json = (v: unknown) => (v === undefined ? "null" : JSON.stringify(v));

/**
 * ClickHouse-backed production memory + partner adapter, using the official @clickhouse/client.
 * Gemini provides reasoning; this is the persistent long-horizon memory agents query for later scenes.
 */
export class ClickHouseMemory implements ProductionMemory, PartnerAdapter {
  readonly name = "clickhouse";
  readonly persistent = true;
  readonly db: string;
  private client: ClickHouseClient;
  private ready = false;
  /** Rolling log of executed retrieval queries for the UI. */
  readonly recentQueries: Array<{ sql: string; rows: number; latencyMs: number; at: string; purpose: string }> = [];

  constructor(private opts: ClickHouseMemoryOptions) {
    this.db = opts.database ?? "cinememory";
    this.client = createClient({
      url: opts.url,
      username: opts.username ?? "default",
      password: opts.password ?? "",
      request_timeout: opts.requestTimeoutMs ?? 30_000,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }

  private t(name: string) {
    return `${this.db}.${name}`;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    for (const stmt of [
      ...schemaStatements(this.db),
      `CREATE TABLE IF NOT EXISTS ${this.t("metrics")} (name LowCardinality(String), value Float64, unit String, labels String, ts DateTime64(3)) ENGINE = MergeTree ORDER BY (name, ts)`,
      `CREATE TABLE IF NOT EXISTS ${this.t("state_mirror")} (project_id String, collection String, id String, state String, recorded_at DateTime64(3)) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, collection, id)`,
    ]) {
      await this.client.command({ query: stmt });
    }
    this.ready = true;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async healthCheck(): Promise<PartnerHealth> {
    const t = Date.now();
    try {
      const r = await this.client.query({ query: "SELECT version() AS v", format: "JSONEachRow" });
      const [row] = (await r.json()) as Array<{ v: string }>;
      return { ok: true, adapter: "clickhouse", detail: `ClickHouse ${row?.v} at ${this.opts.url} (db ${this.db}, ${Date.now() - t}ms)`, checkedAt: new Date().toISOString() };
    } catch (e) {
      return { ok: false, adapter: "clickhouse", detail: `unreachable: ${(e as Error).message}`, checkedAt: new Date().toISOString() };
    }
  }

  /* ------------------------------------------------------------------ */
  /* low-level helpers                                                    */
  /* ------------------------------------------------------------------ */

  private async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    await this.init();
    await this.client.insert({ table: this.t(table), values: rows, format: "JSONEachRow" });
  }

  async select<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}, purpose = "query"): Promise<{ rows: T[]; trace: MemoryTrace }> {
    await this.init();
    const t = Date.now();
    const r = await this.client.query({ query: sql, query_params: params, format: "JSONEachRow" });
    const rows = (await r.json()) as T[];
    const trace: MemoryTrace = { source: "clickhouse", sql: renderSql(sql, params), rows: rows.length, latencyMs: Date.now() - t };
    this.recentQueries.unshift({ sql: trace.sql!, rows: rows.length, latencyMs: trace.latencyMs, at: new Date().toISOString(), purpose });
    if (this.recentQueries.length > 50) this.recentQueries.pop();
    return { rows, trace };
  }

  /* ------------------------------------------------------------------ */
  /* write side                                                           */
  /* ------------------------------------------------------------------ */

  async recordEvent(e: WorkflowEvent): Promise<void> {
    await this.insert("events", [{ project_id: e.projectId, seq: e.seq, ts: ts(e.ts), agent: e.agent, type: e.type, level: e.level, message: e.message, data: json(e.data) }]);
  }

  async recordWorld(world: WorldState): Promise<void> {
    const at = now();
    const ent = (type: string, id: string, name: string, description: string, attributes: unknown) => ({ project_id: world.projectId, world_version: world.version, entity_type: type, entity_id: id, name, description, attributes: json(attributes), recorded_at: at });
    await this.insert("entities", [
      ...world.characters.map((c) => ent("character", c.id, c.name, c.description, { appearance: c.appearance, clothing: c.clothing, voice: c.voice, personality: c.personality, relationships: c.relationships })),
      ...world.locations.map((l) => ent("location", l.id, l.name, l.description, { visualSummary: l.visualSummary, connectedTo: l.connectedTo })),
      ...world.props.map((p) => ent("prop", p.id, p.name, p.description, { visualSummary: p.visualSummary, initialOwner: p.initialOwner })),
      ...world.events.map((e) => ent("event", e.id, e.name, e.description, { order: e.order, dependsOn: e.dependsOn, participants: e.participants, importance: e.importance })),
      ...world.knowledgeFacts.map((f) => ent("knowledge", f.id, f.statement, f.statement, { isSecret: f.isSecret, triggerPhrases: f.triggerPhrases, holders: f.holders })),
    ]);
    const cst = (family: string, id: string, kind: string, statement: string, entityIds: string[], severity: string) => ({ project_id: world.projectId, world_version: world.version, constraint_id: id, family, kind, statement, entity_ids: entityIds, severity, recorded_at: at });
    await this.insert("constraints", [
      ...world.sourceConstraints.map((c) => cst("source", c.id, c.kind, c.statement, c.relatedEntities, c.importance)),
      ...world.visualConstraints.map((c) => cst("visual", c.id, c.attribute, `${c.entityId}.${c.attribute} = ${c.value}`, [c.entityId], c.severity)),
      ...world.continuityConstraints.map((c) => cst("continuity", c.id, c.kind, c.statement, c.entities, c.severity)),
    ]);
  }

  async recordScreenplay(sp: Screenplay): Promise<void> {
    const at = now();
    await this.insert(
      "scenes",
      sp.scenes.map((s) => ({ project_id: sp.projectId, screenplay_version: sp.version, scene_id: s.id, number: s.number, act: s.act, title: s.title, location_id: s.locationId, time_of_day: s.timeOfDay, objective: s.objective, emotional_state: s.emotionalState, character_ids: s.characterIds, prop_ids: s.propIds, event_ids: s.eventIds, duration_sec: s.durationSec, line_count: s.lines.length, lines: json(s.lines), recorded_at: at })),
    );
  }

  async recordStateChanges(projectId: string, changes: StateChange[], screenplayVersion: number): Promise<void> {
    const at = now();
    await this.insert(
      "state_changes",
      changes.map((c) => ({ project_id: projectId, screenplay_version: screenplayVersion, change_id: c.id, scene_id: c.sceneId, scene_number: c.sceneNumber, entity_type: c.entityType, entity_id: c.entityId, field: c.field, before: json(c.before), after: json(c.after), reason: c.reason, recorded_at: at })),
    );
  }

  async recordKnowledgeEvents(projectId: string, world: WorldState, screenplay: Screenplay): Promise<void> {
    const at = now();
    await this.insert(
      "knowledge_events",
      knowledgeEventsFrom(world, screenplay).map((k) => ({ project_id: projectId, screenplay_version: screenplay.version, fact_id: k.factId, character_id: k.characterId, scene_id: k.sceneId, scene_number: k.sceneNumber, via: k.via ?? "", statement: k.statement, recorded_at: at })),
    );
  }

  async recordShots(plan: ShotPlan): Promise<void> {
    const at = now();
    await this.insert(
      "shots",
      plan.shots.map((s) => ({ project_id: plan.projectId, plan_version: plan.version, shot_id: s.id, scene_id: s.sceneId, scene_number: s.sceneNumber, idx: s.index, duration_sec: s.durationSec, framing: s.framing, camera_movement: s.cameraMovement, character_ids: s.characterIds, prop_ids: s.propIds, location_id: s.locationId, time_of_day: s.timeOfDay, status: s.status, constraint_ids: s.inheritedConstraintIds, prompt_hash: s.provenance.promptHash ?? "", keyframe_path: s.keyframe?.path ?? "", keyframe_provider: s.keyframe?.provenance.provider ?? "", generation_attempts: s.generationAttempts, recorded_at: at })),
    );
  }

  async recordViolations(violations: Violation[]): Promise<void> {
    const at = now();
    await this.insert(
      "violations",
      violations.map((v) => ({ project_id: v.projectId, violation_id: v.id, fingerprint: v.fingerprint, code: v.code, critic: v.critic, constraint_id: v.constraintId ?? "", severity: v.severity, confidence: v.confidence, status: v.status, scene_id: v.scope.sceneId ?? "", scene_number: v.scope.sceneNumber ?? 0, shot_id: v.scope.shotId ?? "", line_index: v.scope.lineIndex ?? -1, expected: v.expected, observed: v.observed, evidence: v.evidence, repair_attempts: v.repairAttempts.length, detected_at: ts(v.detectedAt), recorded_at: at })),
    );
    await this.insert(
      "violation_history",
      violations.map((v) => ({ project_id: v.projectId, violation_id: v.id, code: v.code, critic: v.critic, status: v.status, scene_id: v.scope.sceneId ?? "", shot_id: v.scope.shotId ?? "", observed: v.observed, recorded_at: at })),
    );
  }

  async recordChecks(checks: CheckRecord[]): Promise<void> {
    const at = now();
    await this.insert("checks", checks.map((c) => ({ project_id: c.projectId, run_id: c.runId, check_id: c.id, critic: c.critic, constraint_id: c.constraintId ?? "", code: c.code ?? "", outcome: c.outcome, description: c.description, scene_id: c.scope.sceneId ?? "", shot_id: c.scope.shotId ?? "", recorded_at: at })));
  }

  async recordAgentAction(a: AgentActionRecord): Promise<void> {
    await this.insert("agent_actions", [{ project_id: a.projectId, action_id: a.actionId, task: a.task, provider: a.provider, model: a.model ?? "", latency_ms: Math.round(a.latencyMs), input_tokens: a.inputTokens ?? 0, output_tokens: a.outputTokens ?? 0, prompt_hash: a.promptHash ?? "", ok: a.ok ? 1 : 0, error: a.error ?? "", recorded_at: ts(a.createdAt) }]);
  }

  async recordGenerationAttempt(g: GenerationAttemptRecord): Promise<void> {
    await this.insert("generation_attempts", [{ project_id: g.projectId, shot_id: g.shotId, attempt: g.attempt, kind: g.kind, provider: g.provider, model: g.model ?? "", path: g.path ?? "", ok: g.ok ? 1 : 0, error: g.error ?? "", latency_ms: Math.round(g.latencyMs ?? 0), recorded_at: ts(g.createdAt) }]);
  }

  async recordRepairAttempt(projectId: string, violationId: string, a: RepairAttempt): Promise<void> {
    await this.insert("repair_attempts", [{ project_id: projectId, violation_id: violationId, attempt: a.attempt, root_cause: a.rootCause, strategy: a.strategy, target: a.target, outcome: a.outcome, detail: a.detail, recorded_at: ts(a.createdAt) }]);
  }

  async recordEvaluation(cmp: EvalComparison): Promise<void> {
    const at = now();
    await this.insert(
      "evaluation_results",
      [cmp.baseline, cmp.cinememory].map((r) => ({ project_id: cmp.projectId, comparison_id: cmp.id, variant: r.variant, eval_project_id: r.evalProjectId, constraints_evaluated: r.metrics.constraintsEvaluated, checks_evaluated: r.metrics.checksEvaluated, checks_not_evaluated: r.metrics.checksNotEvaluated, violations_detected: r.metrics.violationsDetected, violations_repaired: r.metrics.violationsRepaired, violations_unresolved: r.metrics.violationsUnresolved, visual_pass_rate: r.metrics.visualPassRate, narrative_pass_rate: r.metrics.narrativePassRate, source_pass_rate: r.metrics.sourcePassRate, repair_attempts: r.metrics.repairAttempts, recorded_at: at })),
    );
  }

  async recordChildProfile(c: ChildProfile): Promise<void> {
    await this.insert("child_profiles", [{ project_id: "", child_id: c.id, name: c.name, age: c.age ?? "", appearance: c.appearance, outfit: c.outfit, comfort_items: c.comfortItems.map((x) => x.name), companions: c.companions.map((x) => `${x.name} (${x.role})`), places: c.places.map((x) => x.name), must_not_show: c.mustNotShow, sensory: JSON.stringify(c.sensory), profile: JSON.stringify(c), recorded_at: now() }]);
  }

  async recordOutcome(o: StoryOutcome): Promise<void> {
    await this.insert("story_outcomes", [{ project_id: o.projectId, child_id: o.childId ?? "", outcome_id: o.id, recorded_by: o.recordedBy, times_watched: o.timesWatched, visit_outcome: o.visitOutcome, notes: o.notes ?? "", anxious_steps: o.stepNotes.filter((s) => s.reaction === "anxious").map((s) => s.stepNumber), step_notes: JSON.stringify(o.stepNotes), recorded_at: now() }]);
  }

  /** Longitudinal view for a child: every story, its certificate-relevant counts and recorded outcomes. */
  async childHistory(childId: string) {
    await this.init();
    const stories = await this.select<{ project_id: string; violations: string; repairs: string; last: string }>(
      `SELECT project_id, countDistinct(violation_id) AS violations, countIf(status = 'resolved') AS repairs, max(recorded_at) AS last FROM ${this.t("violation_history")} WHERE project_id IN (SELECT DISTINCT project_id FROM ${this.t("story_outcomes")} WHERE child_id = {child:String}) GROUP BY project_id`,
      { child: childId },
      "child story history",
    );
    const outcomes = await this.select<{ project_id: string; visit_outcome: string; times_watched: string; anxious_steps: number[]; recorded_at: string }>(`SELECT project_id, visit_outcome, times_watched, anxious_steps, recorded_at FROM ${this.t("story_outcomes")} WHERE child_id = {child:String} ORDER BY recorded_at`, { child: childId }, "child outcomes");
    const versions = await this.select<{ n: string; first: string; last: string }>(`SELECT count() AS n, min(recorded_at) AS first, max(recorded_at) AS last FROM ${this.t("child_profiles")} WHERE child_id = {child:String}`, { child: childId }, "child profile versions");
    return { stories: stories.rows, outcomes: outcomes.rows, profileVersions: versions.rows[0], traces: [stories.trace, outcomes.trace, versions.trace] };
  }

  /* ------------------------------------------------------------------ */
  /* read side: retrieval for agents                                      */
  /* ------------------------------------------------------------------ */

  private mapChange(projectId: string) {
    return (r: Record<string, unknown>): StateChange => ({
      id: String(r.change_id),
      projectId,
      sceneId: String(r.scene_id),
      sceneNumber: Number(r.scene_number),
      entityType: String(r.entity_type) as StateChange["entityType"],
      entityId: String(r.entity_id),
      field: String(r.field),
      before: safeParse(String(r.before)),
      after: safeParse(String(r.after)),
      reason: String(r.reason),
      createdAt: fromTs(String(r.recorded_at)),
    });
  }

  async stateBefore(projectId: string, sceneNumber: number, entityIds?: string[]) {
    const entityFilter = entityIds && entityIds.length ? " AND entity_id IN ({entities:Array(String)})" : "";
    const sql = `SELECT change_id, scene_id, scene_number, entity_type, entity_id, field, before, after, reason, recorded_at
FROM ${this.t("state_changes")} FINAL
WHERE project_id = {project:String}
  AND screenplay_version = (SELECT max(screenplay_version) FROM ${this.t("state_changes")} WHERE project_id = {project:String})
  AND scene_number < {scene:UInt32}${entityFilter}
ORDER BY scene_number, change_id`;
    const { rows, trace } = await this.select(sql, { project: projectId, scene: sceneNumber, entities: entityIds ?? [] }, `state before scene ${sceneNumber}`);
    return { changes: rows.map(this.mapChange(projectId)), trace };
  }

  async allChanges(projectId: string) {
    const sql = `SELECT change_id, scene_id, scene_number, entity_type, entity_id, field, before, after, reason, recorded_at
FROM ${this.t("state_changes")} FINAL
WHERE project_id = {project:String}
  AND screenplay_version = (SELECT max(screenplay_version) FROM ${this.t("state_changes")} WHERE project_id = {project:String})
ORDER BY scene_number, change_id`;
    const { rows, trace } = await this.select(sql, { project: projectId }, "full change log");
    return { changes: rows.map(this.mapChange(projectId)), trace };
  }

  async knowledgeBefore(projectId: string, sceneNumber: number) {
    const sql = `SELECT fact_id, statement, character_id, scene_id, scene_number, via
FROM ${this.t("knowledge_events")} FINAL
WHERE project_id = {project:String}
  AND screenplay_version = (SELECT max(screenplay_version) FROM ${this.t("knowledge_events")} WHERE project_id = {project:String})
  AND scene_number < {scene:UInt32}
ORDER BY scene_number, fact_id, character_id`;
    const { rows, trace } = await this.select(sql, { project: projectId, scene: sceneNumber }, `knowledge before scene ${sceneNumber}`);
    const events: KnowledgeEventRow[] = rows.map((r) => ({ factId: String(r.fact_id), statement: String(r.statement), characterId: String(r.character_id), sceneId: String(r.scene_id), sceneNumber: Number(r.scene_number), via: String(r.via) }));
    return { events, trace };
  }

  async violationHistory(projectId: string, scope: { sceneId?: string; shotId?: string } = {}) {
    const where = [`project_id = {project:String}`];
    if (scope.sceneId) where.push(`scene_id = {scene:String}`);
    if (scope.shotId) where.push(`shot_id = {shot:String}`);
    const sql = `SELECT violation_id, code, critic, status, scene_id, shot_id, observed, detected_at, repair_attempts
FROM ${this.t("violations")} FINAL
WHERE ${where.join(" AND ")}
ORDER BY detected_at`;
    const { rows, trace } = await this.select(sql, { project: projectId, scene: scope.sceneId ?? "", shot: scope.shotId ?? "" }, "violation history");
    const violations: ViolationHistoryRow[] = rows.map((r) => ({ violationId: String(r.violation_id), code: String(r.code), critic: String(r.critic), status: String(r.status), sceneId: String(r.scene_id) || undefined, shotId: String(r.shot_id) || undefined, observed: String(r.observed), detectedAt: fromTs(String(r.detected_at)), repairAttempts: Number(r.repair_attempts) }));
    return { violations, trace };
  }

  async agentActions(projectId: string, limit = 50): Promise<AgentActionRecord[]> {
    const { rows } = await this.select(`SELECT * FROM ${this.t("agent_actions")} WHERE project_id = {project:String} ORDER BY recorded_at DESC LIMIT {limit:UInt32}`, { project: projectId, limit }, "agent actions");
    return rows.map((r) => ({ projectId, actionId: String(r.action_id), task: String(r.task), provider: String(r.provider), model: String(r.model), latencyMs: Number(r.latency_ms), inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), promptHash: String(r.prompt_hash), ok: Number(r.ok) === 1, error: String(r.error) || undefined, createdAt: fromTs(String(r.recorded_at)) }));
  }

  async stats(projectId?: string) {
    await this.init();
    const t = Date.now();
    const unions = MEMORY_TABLES.map((name) => `SELECT '${name}' AS table, count() AS rows FROM ${this.t(name)}${projectId ? ` WHERE project_id = {project:String}` : ""}`).join("\nUNION ALL\n");
    const { rows } = await this.select<{ table: string; rows: string | number }>(unions, { project: projectId ?? "" }, "table stats");
    const order = new Map(MEMORY_TABLES.map((n, i) => [n, i]));
    const tables = rows.map((r) => ({ table: r.table, rows: Number(r.rows) })).sort((a, b) => (order.get(a.table as (typeof MEMORY_TABLES)[number]) ?? 0) - (order.get(b.table as (typeof MEMORY_TABLES)[number]) ?? 0));
    return { tables, trace: { source: "clickhouse" as const, sql: unions, rows: tables.length, latencyMs: Date.now() - t } };
  }

  /** Per-project analytics for the Memory page: activity by agent, violations by code, repair outcomes. */
  async analytics(projectId: string) {
    const byAgent = await this.select<{ agent: string; n: string }>(`SELECT agent, count() AS n FROM ${this.t("events")} FINAL WHERE project_id = {project:String} GROUP BY agent ORDER BY n DESC`, { project: projectId }, "events by agent");
    const byCode = await this.select<{ code: string; status: string; n: string }>(`SELECT code, status, count() AS n FROM ${this.t("violations")} FINAL WHERE project_id = {project:String} GROUP BY code, status ORDER BY code`, { project: projectId }, "violations by code");
    const repairs = await this.select<{ outcome: string; n: string }>(`SELECT outcome, count() AS n FROM ${this.t("repair_attempts")} WHERE project_id = {project:String} GROUP BY outcome`, { project: projectId }, "repair outcomes");
    const llm = await this.select<{ provider: string; model: string; calls: string; avg_ms: number; input_tokens: string; output_tokens: string; failures: string }>(`SELECT provider, model, count() AS calls, round(avg(latency_ms)) AS avg_ms, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, countIf(ok = 0) AS failures FROM ${this.t("agent_actions")} WHERE project_id = {project:String} GROUP BY provider, model ORDER BY calls DESC`, { project: projectId }, "llm usage");
    const timeline = await this.select<{ fact_id: string; character_id: string; scene_number: string; via: string }>(`SELECT fact_id, character_id, scene_number, via FROM ${this.t("knowledge_events")} FINAL WHERE project_id = {project:String} AND screenplay_version = (SELECT max(screenplay_version) FROM ${this.t("knowledge_events")} WHERE project_id = {project:String}) ORDER BY fact_id, scene_number`, { project: projectId }, "knowledge timeline");
    return {
      eventsByAgent: byAgent.rows.map((r) => ({ agent: r.agent, count: Number(r.n) })),
      violationsByCode: byCode.rows.map((r) => ({ code: r.code, status: r.status, count: Number(r.n) })),
      repairOutcomes: repairs.rows.map((r) => ({ outcome: r.outcome, count: Number(r.n) })),
      llmUsage: llm.rows.map((r) => ({ provider: r.provider, model: r.model, calls: Number(r.calls), avgMs: Number(r.avg_ms), inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), failures: Number(r.failures) })),
      knowledgeTimeline: timeline.rows.map((r) => ({ factId: r.fact_id, characterId: r.character_id, sceneNumber: Number(r.scene_number), via: r.via })),
      traces: [byAgent.trace, byCode.trace, repairs.trace, llm.trace, timeline.trace],
    };
  }

  /* ------------------------------------------------------------------ */
  /* PartnerAdapter contract                                              */
  /* ------------------------------------------------------------------ */

  async storeEvent(event: WorkflowEvent): Promise<void> {
    await this.recordEvent(event);
  }

  async queryEvents(q: PartnerEventQuery): Promise<WorkflowEvent[]> {
    const where = ["1 = 1"];
    if (q.projectId) where.push("project_id = {project:String}");
    if (q.agent) where.push("agent = {agent:String}");
    if (q.type) where.push("type = {type:String}");
    if (q.afterSeq) where.push("seq > {after:UInt64}");
    const { rows } = await this.select(`SELECT project_id, seq, ts, agent, type, level, message, data FROM ${this.t("events")} FINAL WHERE ${where.join(" AND ")} ORDER BY project_id, seq LIMIT {limit:UInt32}`, { project: q.projectId ?? "", agent: q.agent ?? "", type: q.type ?? "", after: q.afterSeq ?? 0, limit: q.limit ?? 500 }, "events");
    return rows.map((r) => ({ id: `evt_${r.project_id}_${r.seq}`, projectId: String(r.project_id), seq: Number(r.seq), ts: fromTs(String(r.ts)), agent: String(r.agent) as WorkflowEvent["agent"], type: String(r.type), level: String(r.level) as WorkflowEvent["level"], message: String(r.message), data: safeParse(String(r.data)) as Record<string, unknown> }));
  }

  async storeState(projectId: string, collection: string, id: string, state: unknown): Promise<void> {
    await this.insert("state_mirror", [{ project_id: projectId, collection, id, state: json(state), recorded_at: now() }]);
  }

  async retrieveState<T = unknown>(projectId: string, collection: string, id: string): Promise<T | undefined> {
    const { rows } = await this.select(`SELECT state FROM ${this.t("state_mirror")} FINAL WHERE project_id = {project:String} AND collection = {collection:String} AND id = {id:String} LIMIT 1`, { project: projectId, collection, id }, "state mirror");
    return rows[0] ? (safeParse(String(rows[0].state)) as T) : undefined;
  }

  async search(projectId: string, query: string, limit = 20): Promise<PartnerSearchHit[]> {
    const like = `%${query}%`;
    const sql = `SELECT 'scenes' AS collection, scene_id AS id, substring(lines, 1, 200) AS snippet FROM ${this.t("scenes")} FINAL WHERE project_id = {project:String} AND (title ILIKE {q:String} OR lines ILIKE {q:String})
UNION ALL SELECT 'violations', violation_id, observed FROM ${this.t("violations")} FINAL WHERE project_id = {project:String} AND (observed ILIKE {q:String} OR evidence ILIKE {q:String})
UNION ALL SELECT 'entities', entity_id, description FROM ${this.t("entities")} FINAL WHERE project_id = {project:String} AND (name ILIKE {q:String} OR description ILIKE {q:String})
LIMIT {limit:UInt32}`;
    const { rows } = await this.select(sql, { project: projectId, q: like, limit }, "search");
    return rows.map((r) => ({ projectId, collection: String(r.collection), id: String(r.id), score: 1, snippet: String(r.snippet) }));
  }

  async emitMetric(m: MetricSample): Promise<void> {
    await this.insert("metrics", [{ name: m.name, value: m.value, unit: m.unit ?? "", labels: json(m.labels ?? {}), ts: ts(m.ts) }]);
  }

  async listMetrics(name?: string, limit = 200): Promise<MetricSample[]> {
    const { rows } = await this.select(`SELECT name, value, unit, labels, ts FROM ${this.t("metrics")} WHERE {name:String} = '' OR name = {name:String} ORDER BY ts DESC LIMIT {limit:UInt32}`, { name: name ?? "", limit }, "metrics");
    return rows.map((r) => ({ name: String(r.name), value: Number(r.value), unit: String(r.unit) || undefined, labels: safeParse(String(r.labels)) as Record<string, string>, ts: fromTs(String(r.ts)) }));
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Substitute parameters into SQL for display only (never executed). */
function renderSql(sql: string, params: Record<string, unknown>): string {
  return sql.replace(/\{(\w+):[^}]+\}/g, (_, k) => {
    const v = params[k];
    if (Array.isArray(v)) return `[${v.map((x) => `'${x}'`).join(", ")}]`;
    return typeof v === "number" ? String(v) : `'${String(v ?? "")}'`;
  });
}

export const newActionId = () => newId("act");
