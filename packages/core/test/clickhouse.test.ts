import { beforeAll, describe, expect, it } from "vitest";
import { ClickHouseMemory } from "../src/clickhouse/clickhouseMemory.js";
import { runPipeline } from "../src/workflow/orchestrator.js";
import { runEvaluation } from "../src/evaluation/harness.js";
import { ensureDemoProject, makeTestContext } from "./helpers.js";

/**
 * Integration test against a real ClickHouse (ClickHouse Cloud, a server, or the local chdb shim:
 * `pnpm clickhouse:local`). Skipped when CLICKHOUSE_URL is unreachable so unit runs stay offline.
 */
const url = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";
const db = `cm_test_${Date.now().toString(36)}`;
let available = false;

beforeAll(async () => {
  const probe = new ClickHouseMemory({ url, username: process.env.CLICKHOUSE_USER, password: process.env.CLICKHOUSE_PASSWORD, database: db, requestTimeoutMs: 5000 });
  available = (await probe.healthCheck()).ok;
  await probe.close();
});

describe("ClickHouse production memory", () => {
  it("records the whole production and serves scene-scoped retrieval from SQL", async (t) => {
    if (!available) return t.skip();
    const ch = new ClickHouseMemory({ url, username: process.env.CLICKHOUSE_USER, password: process.env.CLICKHOUSE_PASSWORD, database: db });
    const ctx = makeTestContext(() => ch);
    const project = ensureDemoProject(ctx);
    await runPipeline(ctx, project.id, { toStage: "film_assembled" });

    // Retrieval: who knows the compass secret before Scene 4? Only Lumi (learned in Scene 3).
    const k4 = await ch.knowledgeBefore(project.id, 4);
    expect(k4.trace.source).toBe("clickhouse");
    expect(k4.trace.sql).toContain("knowledge_events");
    expect(k4.events.map((e) => `${e.characterId}@${e.sceneNumber}`)).toEqual(["lumi@3"]);
    const k6 = await ch.knowledgeBefore(project.id, 6);
    expect(k6.events.map((e) => e.characterId).sort()).toEqual(["lumi", "milo"]);

    // State before Scene 4 for Milo only: the compass left his inventory in Scene 1.
    const s4 = await ch.stateBefore(project.id, 4, ["milo"]);
    expect(s4.changes.every((c) => c.entityId === "milo" && c.sceneNumber < 4)).toBe(true);
    expect(s4.changes.some((c) => c.field === "inventory" && (c.after as string[]).length === 0)).toBe(true);

    // Latest screenplay version wins after repairs (v3), older versions are filtered out.
    const all = await ch.allChanges(project.id);
    expect(all.changes.length).toBeGreaterThan(20);
    expect(new Set(all.changes.map((c) => c.id)).size).toBe(all.changes.length);

    // Everything landed in the tables.
    const stats = await ch.stats(project.id);
    const rows = Object.fromEntries(stats.tables.map((s) => [s.table, s.rows]));
    for (const table of ["events", "entities", "constraints", "scenes", "state_changes", "knowledge_events", "shots", "violations", "violation_history", "checks", "agent_actions", "generation_attempts", "repair_attempts"]) {
      expect(rows[table], table).toBeGreaterThan(0);
    }
    const history = await ch.violationHistory(project.id, { sceneId: "scene_4" });
    expect(history.violations.some((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION" && v.status === "resolved")).toBe(true);
    const actions = await ch.agentActions(project.id);
    expect(actions.some((a) => a.task === "scene_rewrite" && a.ok)).toBe(true);

    // The activity log shows retrieval from ClickHouse, with the SQL that ran.
    const retrievals = ctx.repo.listEvents(project.id).filter((e) => e.type === "memory.retrieved" && e.data.source === "clickhouse");
    expect(retrievals.length).toBeGreaterThan(6);
    expect(String(retrievals[0].data.sql)).toContain("SELECT");

    // Partner adapter contract over ClickHouse.
    const found = await ch.search(project.id, "compass");
    expect(found.length).toBeGreaterThan(0);
    const evts = await ch.queryEvents({ projectId: project.id, type: "repair.verified" });
    expect(evts.length).toBe(2);

    // Evaluation results are recorded too.
    await runEvaluation(ctx, project.id);
    const after = await ch.stats(project.id);
    expect(after.tables.find((s) => s.table === "evaluation_results")?.rows).toBe(2);
    await ch.close();
  }, 120_000);
});
