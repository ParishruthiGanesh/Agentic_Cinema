import { memoryLabel, type AgentContext } from "../agents/context.js";
import type { CriticResult } from "../critics/common.js";
import { runNarrativeCritic } from "../critics/narrative.js";
import { runSourceFidelityCritic } from "../critics/sourceFidelity.js";
import { runVisualCritic } from "../critics/visual.js";
import type { CriticName, Project, Violation } from "../model/index.js";

/**
 * Reconcile a fresh critic run with the persisted, stateful violations:
 * - violations still detected stay (status untouched unless they were "repairing" → back to "open")
 * - violations no longer detected become "resolved"
 * - new fingerprints are inserted as "open"
 * Returns the ids that are newly detected / resolved for event reporting.
 */
export function reconcileViolations(ctx: AgentContext, projectId: string, result: CriticResult): { newIds: string[]; resolvedIds: string[]; stillOpen: string[] } {
  const { repo } = ctx;
  const existing = repo.listViolations(projectId).filter((v) => v.critic === result.critic);
  const fresh = new Map(result.violations.map((v) => [v.fingerprint, v]));
  const newIds: string[] = [];
  const resolvedIds: string[] = [];
  const stillOpen: string[] = [];
  const now = new Date().toISOString();

  for (const old of existing) {
    const again = fresh.get(old.fingerprint);
    if (again) {
      fresh.delete(old.fingerprint);
      if (old.status === "resolved") {
        // regression: it came back
        repo.saveViolation({ ...old, status: "open", resolvedAt: undefined, resolutionNote: undefined, observed: again.observed, evidence: again.evidence, detectedAt: now });
        newIds.push(old.id);
      } else if (old.status === "overridden") {
        /* user accepted it; keep quiet */
      } else {
        repo.saveViolation({ ...old, status: old.status === "repairing" ? "open" : old.status, observed: again.observed, evidence: again.evidence });
        if (old.status !== "escalated") stillOpen.push(old.id);
      }
    } else if (old.status === "open" || old.status === "repairing" || old.status === "escalated") {
      repo.saveViolation({ ...old, status: "resolved", resolvedAt: now, resolutionNote: old.resolutionNote ?? "No longer detected on re-verification" });
      resolvedIds.push(old.id);
    }
  }
  for (const v of fresh.values()) {
    repo.saveViolation(v);
    newIds.push(v.id);
  }
  repo.replaceChecksForCritic(projectId, result.critic, result.checks);
  void ctx.memory.recordViolations(repo.listViolations(projectId).filter((v) => v.critic === result.critic)).catch(() => undefined);
  void ctx.memory.recordChecks(result.checks).catch(() => undefined);
  repo.saveCriticRun({
    id: result.runId,
    projectId,
    critic: result.critic,
    startedAt: result.provenance.createdAt,
    finishedAt: new Date().toISOString(),
    checksEvaluated: result.checks.filter((c) => c.outcome !== "not_evaluated").length,
    violationsFound: result.violations.length,
    notEvaluated: result.checks.filter((c) => c.outcome === "not_evaluated").length,
    provenance: result.provenance,
  });
  return { newIds, resolvedIds, stillOpen };
}

export interface VerificationOptions {
  critics: CriticName[];
  /** Evaluation baseline: audit only, do not feed into repair. */
  silent?: boolean;
}

export async function runVerification(ctx: AgentContext, project: Project, opts: VerificationOptions): Promise<Record<string, { newIds: string[]; resolvedIds: string[]; stillOpen: string[]; checks: number; notEvaluated: number }>> {
  const { repo, events, llm, config, memory } = ctx;
  const world = repo.getWorld(project.id);
  const screenplay = repo.getScreenplay(project.id);
  // The change log the critics reason over comes from production memory.
  const { changes, trace } = await memory.allChanges(project.id);
  if (!opts.silent && opts.critics.includes("narrative")) {
    const k = await memory.knowledgeBefore(project.id, Number.MAX_SAFE_INTEGER);
    events.emit(project.id, "narrative_critic", "memory.retrieved", `Loaded production history from ${memoryLabel(ctx)}: ${trace.rows} state changes, ${k.events.length} knowledge events (${trace.latencyMs + k.trace.latencyMs}ms)`, { source: trace.source, sql: k.trace.sql ?? trace.sql, rows: trace.rows, knowledgeEvents: k.events.length, latencyMs: trace.latencyMs + k.trace.latencyMs });
  }
  const out: Record<string, { newIds: string[]; resolvedIds: string[]; stillOpen: string[]; checks: number; notEvaluated: number }> = {};
  if (!world || !screenplay) throw new Error("Verification requires world memory and a screenplay");

  for (const critic of opts.critics) {
    let result: CriticResult;
    const agent = critic === "narrative" ? "narrative_critic" : critic === "source_fidelity" ? "source_fidelity_critic" : "visual_critic";
    if (!opts.silent) events.emit(project.id, agent, "verification.started", `${label(critic)} started`, {});
    if (critic === "narrative") result = runNarrativeCritic(world, screenplay, changes);
    else if (critic === "source_fidelity") result = await runSourceFidelityCritic(world, screenplay, repo.getAdaptation(project.id), llm);
    else {
      const plan = repo.getShotPlan(project.id);
      if (!plan) {
        out[critic] = { newIds: [], resolvedIds: [], stillOpen: [], checks: 0, notEvaluated: 0 };
        continue;
      }
      result = await runVisualCritic(world, plan, { mediaDir: config.mediaDir, llm });
    }
    const rec = reconcileViolations(ctx, project.id, result);
    const notEvaluated = result.checks.filter((c) => c.outcome === "not_evaluated").length;
    out[critic] = { ...rec, checks: result.checks.length - notEvaluated, notEvaluated };
    if (!opts.silent) {
      const open = rec.newIds.length + rec.stillOpen.length;
      events.emit(project.id, agent, "verification.completed", `${label(critic)}: ${result.checks.length - notEvaluated} checks evaluated, ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"} (${rec.newIds.length} new, ${rec.resolvedIds.length} resolved${notEvaluated ? `, ${notEvaluated} not evaluated` : ""})`, { runId: result.runId, newIds: rec.newIds, resolvedIds: rec.resolvedIds, notEvaluated }, open ? "warn" : "success");
      for (const id of rec.newIds) {
        const v = repo.getViolation(project.id, id);
        if (v) events.emit(project.id, agent, "violation.detected", `${v.code}${v.scope.sceneNumber ? ` in Scene ${v.scope.sceneNumber}` : ""}${v.scope.shotId ? ` (${v.scope.shotId})` : ""}: ${v.observed}`, { violationId: v.id, code: v.code, severity: v.severity }, "warn");
      }
    }
  }
  return out;
}

function label(c: CriticName) {
  return c === "narrative" ? "Narrative continuity check" : c === "source_fidelity" ? "Source fidelity check" : "Visual continuity check";
}

/** Derived scores for the Continuity Command Center. Null when nothing was evaluated. */
export function continuitySummary(ctx: AgentContext, projectId: string) {
  const checks = ctx.repo.listChecks(projectId);
  const violations = ctx.repo.listViolations(projectId);
  const per = (critic: CriticName) => {
    const cs = checks.filter((c) => c.critic === critic);
    const evaluated = cs.filter((c) => c.outcome !== "not_evaluated");
    const passed = evaluated.filter((c) => c.passed).length;
    const open = violations.filter((v) => v.critic === critic && (v.status === "open" || v.status === "repairing" || v.status === "escalated"));
    return {
      critic,
      checksEvaluated: evaluated.length,
      checksPassed: passed,
      notEvaluated: cs.length - evaluated.length,
      passRate: evaluated.length ? passed / evaluated.length : null,
      openViolations: open.length,
      resolvedViolations: violations.filter((v) => v.critic === critic && v.status === "resolved").length,
      overridden: violations.filter((v) => v.critic === critic && v.status === "overridden").length,
    };
  };
  const unresolved = violations.filter((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated");
  return {
    visual: per("visual"),
    narrative: per("narrative"),
    source: per("source_fidelity"),
    unresolved: unresolved.length,
    escalated: violations.filter((v) => v.status === "escalated").length,
    total: violations.length,
    resolved: violations.filter((v) => v.status === "resolved").length,
    lastRuns: ctx.repo.listCriticRuns(projectId).slice(-3),
  };
}
export type ContinuitySummary = ReturnType<typeof continuitySummary>;
