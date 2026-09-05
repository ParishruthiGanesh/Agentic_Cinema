import type { AgentContext } from "../agents/context.js";
import { runAdaptation } from "../agents/adaptation.js";
import { runDirector } from "../agents/director.js";
import { repairAll } from "../agents/repair.js";
import { runScreenplay } from "../agents/screenplay.js";
import { runSourceIntelligence } from "../agents/sourceIntelligence.js";
import { foldScreenplay } from "../memory/worldMemory.js";
import type { EvalComparison, EvalMetrics, EvalRunRecord, EvalVariant, Project } from "../model/index.js";
import { runVerification } from "../workflow/verification.js";
import { newId } from "../util/hash.js";

export const EVAL_PREFIX = "__eval__";

/** Metrics are computed from persisted check and violation records of the evaluation project — never typed in. */
export function computeMetrics(ctx: AgentContext, evalProjectId: string): EvalMetrics {
  const checks = ctx.repo.listChecks(evalProjectId);
  const violations = ctx.repo.listViolations(evalProjectId);
  const evaluated = checks.filter((c) => c.outcome !== "not_evaluated");
  const rate = (critic: string) => {
    const cs = evaluated.filter((c) => c.critic === critic);
    return cs.length ? cs.filter((c) => c.passed).length / cs.length : null;
  };
  const constraintKeys = new Set(evaluated.map((c) => c.constraintId ?? `${c.critic}:${c.description}`));
  return {
    constraintsEvaluated: constraintKeys.size,
    checksEvaluated: evaluated.length,
    checksNotEvaluated: checks.length - evaluated.length,
    violationsDetected: violations.length,
    violationsRepaired: violations.filter((v) => v.status === "resolved" && v.repairAttempts.length > 0).length,
    violationsUnresolved: violations.filter((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated").length,
    visualPassRate: rate("visual"),
    narrativePassRate: rate("narrative"),
    sourcePassRate: rate("source_fidelity"),
    repairAttempts: violations.reduce((s, v) => s + v.repairAttempts.length, 0),
  };
}

async function runVariant(ctx: AgentContext, source: Project, variant: EvalVariant): Promise<EvalRunRecord> {
  const startedAt = new Date().toISOString();
  const id = `${EVAL_PREFIX}${variant}_${source.id}_${Date.now().toString(36)}`;
  const notes: string[] = [];
  const project: Project = { ...source, id, title: `${source.title} [eval: ${variant}]`, isDemo: false, stage: "created", stages: [], createdAt: startedAt, updatedAt: startedAt };
  ctx.repo.saveProject(project);
  ctx.events.emit(source.id, "evaluation", "evaluation.variant.started", `Evaluation variant "${variant}" started (project ${id})`, { variant, evalProjectId: id });

  // Both variants share the same source understanding; the comparison is about what happens after.
  const world0 = ctx.repo.getWorld(source.id) ?? (await runSourceIntelligence(ctx, project));
  ctx.repo.saveWorld({ ...world0, projectId: id, version: 0 });
  const plan = await runAdaptation(ctx, project, ctx.repo.getWorld(id)!);
  const screenplay = await runScreenplay(ctx, project, ctx.repo.getWorld(id)!, plan, { baseline: variant === "baseline" });
  const folded = foldScreenplay(ctx.repo.getWorld(id)!, screenplay);
  ctx.repo.saveWorld(folded.world);
  ctx.repo.replaceStateChanges(id, folded.changes);
  await runDirector(ctx, project, ctx.repo.getWorld(id)!, screenplay, folded.changes, { injectMemory: variant === "cinememory", visualStyle: project.brief.visualStyle });

  if (variant === "baseline") {
    notes.push("Baseline: screenplay and shots generated without CineMemory retrieval or constraint injection; critics run in audit mode; no repair.");
    await runVerification(ctx, project, { critics: ["narrative", "source_fidelity", "visual"], silent: true });
  } else {
    notes.push("CineMemory: scene-scoped state retrieval, constraint-injected prompts, critics and bounded repair loop.");
    await runVerification(ctx, project, { critics: ["narrative", "source_fidelity", "visual"] });
    const r = await repairAll(ctx, project, ["narrative", "source_fidelity", "visual"]);
    notes.push(`Repair: ${r.attempted.length} attempted, ${r.resolved.length} resolved, ${r.escalated.length} escalated.`);
    await runVerification(ctx, project, { critics: ["narrative", "source_fidelity", "visual"], silent: true });
  }
  if (ctx.llm.name === "fixture") notes.push("Fixture mode: generation steps replay authored fixtures, so both variants start from the same screenplay; the measured difference comes from prompt injection, verification and repair only.");
  if (ctx.media.name === "placeholder" || !ctx.llm.supportsVision) notes.push("Visual checks are prompt-level only (no model-generated keyframes / vision provider).");

  const metrics = computeMetrics(ctx, id);
  const record: EvalRunRecord = {
    id: newId("eval"),
    projectId: source.id,
    variant,
    evalProjectId: id,
    metrics,
    violationIds: ctx.repo.listViolations(id).map((v) => v.id),
    startedAt,
    finishedAt: new Date().toISOString(),
    provenance: { provider: ctx.llm.name, model: ctx.llm.model, task: `evaluation_${variant}`, createdAt: startedAt },
    notes,
  };
  ctx.events.emit(source.id, "evaluation", "evaluation.variant.completed", `Variant "${variant}": ${metrics.violationsDetected} violations detected, ${metrics.violationsRepaired} repaired, ${metrics.violationsUnresolved} unresolved (${metrics.checksEvaluated} checks)`, { variant, metrics }, "success");
  return record;
}

/** Baseline vs CineMemory on the same project. Both runs are persisted as inspectable projects. */
export async function runEvaluation(ctx: AgentContext, projectId: string): Promise<EvalComparison> {
  const source = ctx.repo.getProject(projectId);
  if (!source) throw new Error("Project not found");
  ctx.events.emit(projectId, "evaluation", "evaluation.started", "Baseline vs CineMemory evaluation started", {});
  const baseline = await runVariant(ctx, source, "baseline");
  const cinememory = await runVariant(ctx, source, "cinememory");
  const comparison: EvalComparison = { id: newId("cmp"), projectId, baseline, cinememory, createdAt: new Date().toISOString() };
  ctx.repo.saveEvaluation(comparison);
  ctx.events.emit(projectId, "evaluation", "evaluation.completed", `Evaluation complete: baseline ${baseline.metrics.violationsUnresolved} unresolved vs CineMemory ${cinememory.metrics.violationsUnresolved} unresolved`, { comparisonId: comparison.id }, "success");
  await ctx.partner.emitMetric({ name: "eval_unresolved_violations", value: cinememory.metrics.violationsUnresolved, labels: { projectId, variant: "cinememory" }, ts: new Date().toISOString() });
  await ctx.partner.emitMetric({ name: "eval_unresolved_violations", value: baseline.metrics.violationsUnresolved, labels: { projectId, variant: "baseline" }, ts: new Date().toISOString() });
  return comparison;
}
