import { describe, expect, it } from "vitest";
import { runPipeline, resetFromStage } from "../src/workflow/orchestrator.js";
import { continuitySummary } from "../src/workflow/verification.js";
import { runEvaluation } from "../src/evaluation/harness.js";
import { buildCineGraph } from "../src/graph/cineGraph.js";
import { repairViolation } from "../src/agents/repair.js";
import { FixtureMissingError } from "../src/llm/fixture.js";
import { createProject } from "../src/workflow/orchestrator.js";
import { ensureDemoProject, makeTestContext } from "./helpers.js";

describe("End-to-end pipeline (fixture mode)", () => {
  it("runs story → memory → screenplay → shots → verification → repair, and every step is logged", async () => {
    const ctx = makeTestContext();
    const project = ensureDemoProject(ctx);
    const done = await runPipeline(ctx, project.id, { toStage: "narrative_verified" });
    expect(done.stage).toBe("narrative_verified");
    expect(done.stages.every((s) => s.status === "complete")).toBe(true);

    const world = ctx.repo.getWorld(project.id)!;
    expect(world.characters).toHaveLength(3);
    expect(world.sourceConstraints.some((c) => c.kind === "educational_fact" && c.importance === "must_keep")).toBe(true);

    const screenplay = ctx.repo.getScreenplay(project.id)!;
    expect(screenplay.scenes).toHaveLength(6);
    expect(screenplay.provenance.provider).toBe("fixture");
    expect(ctx.repo.getShotPlan(project.id)!.shots.length).toBeGreaterThanOrEqual(12);

    // Both intentional faults were detected, repaired and re-verified.
    const violations = ctx.repo.listViolations(project.id);
    const kv = violations.find((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION")!;
    const fv = violations.find((v) => v.code === "REQUIRED_FACT_MISSING")!;
    expect(kv.status).toBe("resolved");
    expect(kv.repairAttempts).toHaveLength(1);
    expect(kv.repairAttempts[0]).toMatchObject({ rootCause: "screenplay", strategy: "targeted scene rewrite", target: "scene_4", outcome: "resolved" });
    expect(fv.status).toBe("resolved");
    expect(violations.filter((v) => v.status === "open" || v.status === "escalated")).toHaveLength(0);

    // Screenplay carries the revision history and the fix.
    const after = ctx.repo.getScreenplay(project.id)!;
    expect(after.version).toBe(3);
    expect(after.revisions).toHaveLength(2);
    expect(after.scenes[3].lines[2].text).not.toContain("needle follows");
    expect(JSON.stringify(after.scenes).toLowerCase()).toContain("bioluminescence");

    // Scores derive from real checks.
    const summary = continuitySummary(ctx, project.id);
    expect(summary.narrative.passRate).toBe(1);
    expect(summary.source.passRate).toBe(1);
    expect(summary.narrative.checksEvaluated).toBeGreaterThan(5);
    expect(summary.unresolved).toBe(0);

    // Activity log reflects the actual workflow.
    const types = ctx.repo.listEvents(project.id).map((e) => e.type);
    for (const t of ["source.analysis.completed", "memory.constraints.extracted", "screenplay.completed", "memory.built", "shots.scene.planned", "violation.detected", "repair.initiated", "repair.scene.rewritten", "repair.verified", "stage.completed"]) {
      expect(types).toContain(t);
    }
    const graph = buildCineGraph(ctx.repo.getWorld(project.id)!, after, violations);
    expect(graph.stats.violation).toBe(0); // resolved violations are not drawn
  });

  it("is resumable: completed stages are skipped on a second run", async () => {
    const ctx = makeTestContext();
    const project = ensureDemoProject(ctx);
    await runPipeline(ctx, project.id, { toStage: "screenplay_written" });
    const before = ctx.llm as unknown as { history: unknown[] };
    const calls = before.history.length;
    await runPipeline(ctx, project.id, { toStage: "screenplay_written" });
    expect(before.history.length).toBe(calls);
    await runPipeline(ctx, project.id, { toStage: "memory_built" });
    expect(ctx.repo.listStateChanges(project.id).length).toBeGreaterThan(5);
    const reset = resetFromStage(ctx, project.id, "screenplay_written");
    expect(reset.stage).toBe("adapted");
    expect(ctx.repo.getScreenplay(project.id)).toBeUndefined();
  });

  it("escalates after the configured retry limit instead of looping forever", async () => {
    const ctx = makeTestContext();
    ctx.config.repairMaxAttempts = 1;
    // Resolver that never fixes anything: returns the current scene unchanged.
    const stubborn = ctx.llm as unknown as { resolver: (l: { task: string; prompt: string; fixtureKey: string }) => unknown };
    const original = stubborn.resolver;
    stubborn.resolver = (l) => (l.task === "scene_rewrite" ? JSON.parse(l.prompt.slice(l.prompt.indexOf("CURRENT SCENE JSON:") + 19, l.prompt.indexOf("CURRENT LINES:"))) : original(l));
    const project = ensureDemoProject(ctx);
    await runPipeline(ctx, project.id, { toStage: "narrative_verified" });
    const kv = ctx.repo.listViolations(project.id).find((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION")!;
    expect(kv.status).toBe("escalated");
    expect(kv.repairAttempts).toHaveLength(1);
    expect(ctx.repo.listEvents(project.id).some((e) => e.type === "repair.escalated")).toBe(true);
    // A manual retry after escalation is still bounded.
    const again = await repairViolation(ctx, project, kv.id);
    expect(again.status).toBe("escalated");
  });

  it("refuses to fake results for projects without fixtures", async () => {
    const ctx = makeTestContext();
    const p = createProject(ctx, {
      title: "Unknown story",
      mode: "creator",
      source: { kind: "original", title: "x", text: "Once upon a time." },
      brief: { genre: "drama", audience: "adults", targetDurationSec: 60, language: "English", visualStyle: "noir", format: "live-action style", requiredFacts: [] },
    });
    await expect(runPipeline(ctx, p.id, { toStage: "source_analyzed" })).rejects.toBeInstanceOf(FixtureMissingError);
    const project = ctx.repo.getProject(p.id)!;
    expect(project.stages.find((s) => s.stage === "source_analyzed")?.status).toBe("failed");
  });
});

describe("Baseline vs CineMemory evaluation", () => {
  it("computes metrics from persisted records, and CineMemory resolves what the baseline leaves open", async () => {
    const ctx = makeTestContext();
    const project = ensureDemoProject(ctx);
    await runPipeline(ctx, project.id, { toStage: "source_analyzed" });
    const cmp = await runEvaluation(ctx, project.id);
    const b = cmp.baseline.metrics;
    const c = cmp.cinememory.metrics;
    expect(b.violationsDetected).toBeGreaterThan(0);
    expect(b.violationsRepaired).toBe(0);
    expect(b.violationsUnresolved).toBe(b.violationsDetected);
    expect(c.violationsRepaired).toBeGreaterThan(0);
    expect(c.violationsUnresolved).toBe(0);
    expect(b.visualPassRate).not.toBeNull();
    expect(b.visualPassRate!).toBeLessThan(c.visualPassRate!);
    expect(c.narrativePassRate).toBe(1);
    // Evidence: the evaluation projects exist and hold the violations the metrics were computed from.
    expect(ctx.repo.listViolations(cmp.baseline.evalProjectId).length).toBe(b.violationsDetected);
    expect(ctx.repo.listViolations(cmp.cinememory.evalProjectId).length).toBe(c.violationsDetected);
    expect(cmp.baseline.notes.join(" ")).toContain("Fixture mode");
  });
});
