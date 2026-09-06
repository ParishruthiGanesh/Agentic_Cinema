import { z } from "zod";
import { memoryLabel, type AgentContext } from "./context.js";
import { persistWorldMemory } from "../workflow/memoryStage.js";
import { SCENE_REWRITE_SYSTEM, sceneRewritePrompt } from "./prompts/repair.js";
import { retrieveSceneContext } from "../memory/worldMemory.js";
import { Scene, type Project, type RepairAttempt, type Violation, type ViolationCode, type WorldState } from "../model/index.js";
import { runVerification } from "../workflow/verification.js";
import { LLMQuotaError } from "../llm/provider.js";
import { generateShotMedia } from "../media/generation.js";

type RootCause = RepairAttempt["rootCause"];

const SCREENPLAY_CODES: ViolationCode[] = [
  "KNOWLEDGE_TIMELINE_VIOLATION",
  "CHRONOLOGY_VIOLATION",
  "CAUSAL_DEPENDENCY_VIOLATION",
  "PROP_POSSESSION_VIOLATION",
  "LOCATION_CONTINUITY_VIOLATION",
  "UNRESOLVED_DEPENDENCY",
  "REQUIRED_FACT_MISSING",
  "REQUIRED_EVENT_MISSING",
  "REQUIRED_CHARACTER_MISSING",
  "SOURCE_CONTRADICTION",
];
const MEDIA_CODES: ViolationCode[] = ["PROP_MISSING", "CHARACTER_IDENTITY_DRIFT", "CLOTHING_MISMATCH", "COLOR_MISMATCH", "LOCATION_MISMATCH", "TIME_OF_DAY_MISMATCH", "STYLE_MISMATCH", "FORBIDDEN_CONTENT"];

/** Step 1 of the repair protocol: which component caused the violation? */
export function diagnoseRootCause(v: Violation): RootCause {
  if (SCREENPLAY_CODES.includes(v.code)) return "screenplay";
  if (v.code === "PROMPT_MISSING_CONSTRAINT") return "shot_prompt";
  if (MEDIA_CODES.includes(v.code)) return "generated_media";
  return "unknown";
}

function sceneSchemaFor(world: WorldState, sceneId: string, number: number) {
  const chars = new Set(world.characters.map((c) => c.id));
  const locs = new Set(world.locations.map((l) => l.id));
  const props = new Set(world.props.map((p) => p.id));
  const events = new Set(world.events.map((e) => e.id));
  const facts = new Set(world.knowledgeFacts.map((f) => f.id));
  return Scene.superRefine((s, ctx) => {
    if (s.id !== sceneId) ctx.addIssue({ code: "custom", path: ["id"], message: `id must stay "${sceneId}"` });
    if (s.number !== number) ctx.addIssue({ code: "custom", path: ["number"], message: `number must stay ${number}` });
    s.characterIds.forEach((c) => !chars.has(c) && ctx.addIssue({ code: "custom", path: ["characterIds"], message: `unknown character "${c}"` }));
    if (!locs.has(s.locationId)) ctx.addIssue({ code: "custom", path: ["locationId"], message: `unknown location "${s.locationId}"` });
    s.propIds.forEach((p) => !props.has(p) && ctx.addIssue({ code: "custom", path: ["propIds"], message: `unknown prop "${p}"` }));
    s.eventIds.forEach((e) => !events.has(e) && ctx.addIssue({ code: "custom", path: ["eventIds"], message: `unknown event "${e}"` }));
    s.knowledgeReveals.forEach((r) => (!facts.has(r.factId) || !chars.has(r.toCharacterId)) && ctx.addIssue({ code: "custom", path: ["knowledgeReveals"], message: `unknown fact/character in reveal ${r.factId}->${r.toCharacterId}` }));
    s.lines.forEach((l, i) => l.type === "dialogue" && (!l.characterId || !s.characterIds.includes(l.characterId)) && ctx.addIssue({ code: "custom", path: ["lines", i], message: `dialogue speaker "${l.characterId}" must be in characterIds` }));
  });
}

/** Choose the scene to edit for violations that are not tied to a scene (e.g. a missing required fact). */
function chooseTargetScene(ctx: AgentContext, project: Project, v: Violation): string | undefined {
  if (v.scope.sceneId) return v.scope.sceneId;
  const sp = ctx.repo.getScreenplay(project.id);
  if (!sp || sp.scenes.length === 0) return undefined;
  const scenes = [...sp.scenes].sort((a, b) => a.number - b.number);
  const related = new Set(v.scope.entityIds);
  const scored = scenes.map((s) => ({ s, score: s.characterIds.filter((c) => related.has(c)).length + s.propIds.filter((p) => related.has(p)).length }));
  const best = scored.sort((a, b) => b.score - a.score || b.s.number - a.s.number)[0];
  return best.score > 0 ? best.s.id : scenes[scenes.length - 1].id;
}

async function rewriteScene(ctx: AgentContext, project: Project, v: Violation, sceneId: string, attempt: number): Promise<{ ok: boolean; detail: string; provenance?: RepairAttempt["provenance"] }> {
  const { repo, llm, events, memory } = ctx;
  const world = repo.getWorld(project.id)!;
  const screenplay = repo.getScreenplay(project.id)!;
  const scene0 = screenplay.scenes.find((s) => s.id === sceneId)!;
  const { changes, trace } = await memory.stateBefore(project.id, scene0.number, [...scene0.characterIds, ...scene0.propIds]);
  events.emit(project.id, "repair", "memory.retrieved", `Retrieved scene ${scene0.number} history from ${memoryLabel(ctx)} for repair: ${trace.rows} state changes (${trace.latencyMs}ms)`, { sceneId, source: trace.source, sql: trace.sql, rows: trace.rows, latencyMs: trace.latencyMs });
  const sceneCtx = retrieveSceneContext(world, screenplay, changes, sceneId);
  const scene = sceneCtx.scene;
  const extra = v.code === "REQUIRED_FACT_MISSING" && v.constraintId ? `Add the required fact ("${v.constraint}") to this scene's dialogue or narration and include "${v.constraintId}" in satisfiesConstraints.` : v.code === "REQUIRED_EVENT_MISSING" ? `Dramatize the missing event in this scene and add its id to eventIds.` : v.code === "REQUIRED_CHARACTER_MISSING" ? `Include the missing character in this scene with at least one line or action.` : undefined;
  const res = await llm.generateStructured({
    task: "scene_rewrite",
    fixtureKey: `scene_rewrite:${v.code}:${sceneId}:${attempt}`,
    system: SCENE_REWRITE_SYSTEM,
    prompt: sceneRewritePrompt(project, sceneCtx, v, extra),
    schema: sceneSchemaFor(world, scene.id, scene.number),
    temperature: 0.3,
  });
  const rewritten = Scene.parse({ ...res.data, id: scene.id, number: scene.number, act: scene.act, durationSec: scene.durationSec });
  const version = screenplay.version + 1;
  const updated = {
    ...screenplay,
    version,
    scenes: screenplay.scenes.map((s) => (s.id === sceneId ? rewritten : s)),
    revisions: [...screenplay.revisions, { version, sceneId, reason: `${v.code}: ${v.constraint}`, violationId: v.id, provenance: res.provenance, createdAt: new Date().toISOString() }],
  };
  updated.totalDurationSec = updated.scenes.reduce((s, sc) => s + sc.durationSec, 0);
  repo.saveScreenplay(updated);
  await memory.recordScreenplay(updated);
  // Refold memory so critics see the new state (and production memory gets the new version).
  const folded = await persistWorldMemory(ctx, project.id, world, updated);
  const changedLines = Math.max(scene.lines.length, rewritten.lines.length) - scene.lines.filter((l, i) => rewritten.lines[i]?.text === l.text).length;
  events.emit(project.id, "repair", "repair.scene.rewritten", `Scene ${scene.number} rewritten (v${version}): ${changedLines} line${changedLines === 1 ? "" : "s"} changed`, { sceneId, violationId: v.id, version, provenance: res.provenance });
  // Shots derived from the old scene are stale; mark them for re-planning.
  const plan = repo.getShotPlan(project.id);
  if (plan) {
    const stale = plan.shots.filter((s) => s.sceneId === sceneId);
    if (stale.length) {
      repo.saveShotPlan({ ...plan, shots: plan.shots.map((s) => (s.sceneId === sceneId ? { ...s, status: "PLANNED", dialogue: rewritten.lines.filter((l) => l.type !== "action").map((l) => ({ characterId: l.characterId, text: l.text, type: l.type as "dialogue" | "narration" })) } : s)) });
    }
  }
  return { ok: true, detail: `Scene ${scene.number} rewritten; ${changedLines} lines changed`, provenance: res.provenance };
}

function strengthenPrompt(ctx: AgentContext, project: Project, v: Violation): { ok: boolean; detail: string } {
  const { repo } = ctx;
  const plan = repo.getShotPlan(project.id);
  const world = repo.getWorld(project.id);
  if (!plan || !world || !v.scope.shotId) return { ok: false, detail: "no shot plan / shot id" };
  const shot = plan.shots.find((s) => s.id === v.scope.shotId);
  if (!shot) return { ok: false, detail: `shot ${v.scope.shotId} not found` };
  const constraint = v.constraintId ? world.visualConstraints.find((c) => c.id === v.constraintId) : undefined;
  let addition: string;
  if (constraint) {
    const entity = world.characters.find((c) => c.id === constraint.entityId)?.name ?? world.props.find((p) => p.id === constraint.entityId)?.name ?? world.locations.find((l) => l.id === constraint.entityId)?.name ?? constraint.entityId;
    addition = `${entity} ${constraint.attribute}: ${constraint.promptKeywords[0] ?? constraint.value} (must be clearly visible).`;
  } else {
    const prop = world.props.find((p) => v.scope.entityIds.includes(p.id));
    if (!prop) return { ok: false, detail: "cannot determine what to add to the prompt" };
    addition = `${prop.name}: ${prop.visualSummary ?? prop.description} (clearly visible in frame).`;
  }
  const visualPrompt = `${shot.visualPrompt} Continuity emphasis: ${addition}`;
  const inherited = constraint && !shot.inheritedConstraintIds.includes(constraint.id) ? [...shot.inheritedConstraintIds, constraint.id] : shot.inheritedConstraintIds;
  repo.saveShotPlan({ ...plan, version: plan.version + 1, shots: plan.shots.map((s) => (s.id === shot.id ? { ...s, visualPrompt, inheritedConstraintIds: inherited, status: s.keyframe ? "REPAIRING" : "PLANNED" } : s)) });
  return { ok: true, detail: `Prompt for ${shot.id} strengthened with: ${addition}` };
}

/**
 * Repair one violation following the protocol: diagnose → targeted fix → re-verify → retry up to the
 * limit → escalate. The violation is updated in place with every attempt.
 */
export async function repairViolation(ctx: AgentContext, project: Project, violationId: string): Promise<Violation> {
  const { repo, events, config } = ctx;
  let v = repo.getViolation(project.id, violationId);
  if (!v) throw new Error(`Violation ${violationId} not found`);
  if (v.status === "resolved" || v.status === "overridden") return v;
  const rootCause = diagnoseRootCause(v);
  events.emit(project.id, "repair", "repair.initiated", `Repair initiated for ${v.code}${v.scope.sceneNumber ? ` (Scene ${v.scope.sceneNumber})` : ""}${v.scope.shotId ? ` (${v.scope.shotId})` : ""} — root cause: ${rootCause}`, { violationId: v.id, rootCause });
  repo.saveViolation({ ...v, status: "repairing" });

  while (true) {
    v = repo.getViolation(project.id, violationId)!;
    const attemptNo = v.repairAttempts.length + 1;
    // Attempts after the last successful repair count against the budget (a regression gets a fresh budget once).
    const lastResolved = v.repairAttempts.map((a) => a.outcome).lastIndexOf("resolved");
    const sinceResolved = v.repairAttempts.length - (lastResolved + 1);
    if (sinceResolved >= config.repairMaxAttempts) {
      const escalated: Violation = { ...v, status: "escalated", resolutionNote: `Unresolved after ${config.repairMaxAttempts} repair attempt${config.repairMaxAttempts === 1 ? "" : "s"}; needs manual review` };
      repo.saveViolation(escalated);
      await ctx.memory.recordViolations([escalated]).catch(() => undefined);
      events.emit(project.id, "repair", "repair.escalated", `${v.code} escalated to user after ${config.repairMaxAttempts} attempts`, { violationId: v.id }, "error");
      return escalated;
    }
    const attempt: RepairAttempt = { attempt: attemptNo, rootCause, strategy: "", target: "", outcome: "error", detail: "", createdAt: new Date().toISOString() };
    try {
      if (rootCause === "screenplay") {
        const sceneId = chooseTargetScene(ctx, project, v);
        if (!sceneId) throw new Error("no scene to rewrite");
        attempt.strategy = "targeted scene rewrite";
        attempt.target = sceneId;
        const r = await rewriteScene(ctx, project, v, sceneId, attemptNo);
        attempt.detail = r.detail;
        attempt.provenance = r.provenance;
        await runVerification(ctx, project, { critics: ["narrative", "source_fidelity"] });
      } else if (rootCause === "shot_prompt") {
        attempt.strategy = "deterministic prompt recomposition";
        attempt.target = v.scope.shotId ?? "";
        const r = strengthenPrompt(ctx, project, v);
        if (!r.ok) throw new Error(r.detail);
        attempt.detail = r.detail;
        events.emit(project.id, "repair", "repair.prompt.recomposed", r.detail, { violationId: v.id, shotId: v.scope.shotId });
        await runVerification(ctx, project, { critics: ["visual"] });
      } else if (rootCause === "generated_media") {
        attempt.strategy = "strengthen prompt + regenerate shot media";
        attempt.target = v.scope.shotId ?? "";
        const r = strengthenPrompt(ctx, project, v);
        if (!r.ok) throw new Error(r.detail);
        const shotId = v.scope.shotId;
        const shot = repo.getShotPlan(project.id)?.shots.find((s) => s.id === shotId);
        if (!shot) throw new Error("shot missing");
        await generateShotMedia(ctx, project, shot.id, { reason: `repair ${v.code}` });
        attempt.detail = `${r.detail}; media regenerated`;
        await runVerification(ctx, project, { critics: ["visual"] });
      } else {
        throw new Error(`No repair strategy for ${v.code}`);
      }
      const after = repo.getViolation(project.id, violationId)!;
      attempt.outcome = after.status === "resolved" ? "resolved" : "still_failing";
      const withAttempt: Violation = { ...after, repairAttempts: [...after.repairAttempts, attempt] };
      await ctx.memory.recordRepairAttempt(project.id, violationId, attempt).catch(() => undefined);
      if (after.status === "resolved") {
        const done = { ...withAttempt, resolutionNote: `Repaired: ${attempt.strategy} (${attempt.target})` };
        repo.saveViolation(done);
        await ctx.memory.recordViolations([done]).catch(() => undefined);
        events.emit(project.id, "repair", "repair.verified", `Verification passed: ${v.code}${v.scope.sceneNumber ? ` in Scene ${v.scope.sceneNumber}` : ""} resolved on attempt ${attemptNo}`, { violationId: v.id, attempt: attemptNo }, "success");
        return done;
      }
      repo.saveViolation({ ...withAttempt, status: "repairing" });
      events.emit(project.id, "repair", "repair.attempt.failed", `Attempt ${attemptNo} did not resolve ${v.code}; ${attemptNo < config.repairMaxAttempts ? "retrying" : "limit reached"}`, { violationId: v.id, attempt: attemptNo }, "warn");
    } catch (err) {
      if (err instanceof LLMQuotaError) {
        // Infrastructure, not a failed repair: leave the violation open so the run can resume later.
        repo.saveViolation({ ...repo.getViolation(project.id, violationId)!, status: "open" });
        events.emit(project.id, "repair", "repair.paused", `Repair of ${v.code} paused: ${err.message}`, { violationId: v.id }, "error");
        throw err;
      }
      attempt.outcome = "error";
      attempt.detail = `${attempt.detail} error: ${(err as Error).message}`.trim();
      const cur = repo.getViolation(project.id, violationId)!;
      repo.saveViolation({ ...cur, status: "repairing", repairAttempts: [...cur.repairAttempts, attempt] });
      await ctx.memory.recordRepairAttempt(project.id, violationId, attempt).catch(() => undefined);
      events.emit(project.id, "repair", "repair.attempt.error", `Repair attempt ${attemptNo} for ${cur.code} failed: ${(err as Error).message}`, { violationId: v.id, attempt: attemptNo }, "error");
    }
  }
}

export interface RepairAllResult {
  attempted: string[];
  resolved: string[];
  escalated: string[];
}

/**
 * Repair every open violation for the given critics, most severe first. Bounded by the per-violation
 * attempt limit and by `maxPasses`: a second pass only runs when the first pass resolved something and
 * a repair regressed another violation (e.g. two rewrites of the same scene), so the loop always ends.
 */
export async function repairAll(ctx: AgentContext, project: Project, critics: Array<Violation["critic"]>, maxPasses = 2): Promise<RepairAllResult> {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const out: RepairAllResult = { attempted: [], resolved: [], escalated: [] };
  for (let pass = 1; pass <= maxPasses; pass++) {
    const seen = new Set<string>();
    let resolvedThisPass = 0;
    // Re-read after every repair: fixing one violation can resolve (or create) others.
    for (let guard = 0; guard < 50; guard++) {
      const next = ctx.repo
        .listViolations(project.id)
        .filter((v) => critics.includes(v.critic) && v.status === "open" && !seen.has(v.id))
        .sort((a, b) => order[a.severity] - order[b.severity] || (a.scope.sceneNumber ?? 0) - (b.scope.sceneNumber ?? 0))[0];
      if (!next) break;
      seen.add(next.id);
      out.attempted.push(next.id);
      const result = await repairViolation(ctx, project, next.id);
      if (result.status === "resolved") {
        out.resolved.push(next.id);
        resolvedThisPass += 1;
      } else if (result.status === "escalated") out.escalated.push(next.id);
    }
    const regressed = ctx.repo.listViolations(project.id).filter((v) => critics.includes(v.critic) && v.status === "open").length;
    if (resolvedThisPass === 0 || regressed === 0) break;
    ctx.events.emit(project.id, "repair", "repair.regression", `${regressed} violation${regressed === 1 ? "" : "s"} reopened by other repairs; running pass ${pass + 1} of ${maxPasses}`, { pass: pass + 1, regressed }, "warn");
  }
  return out;
}
