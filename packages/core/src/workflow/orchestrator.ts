import type { AgentContext } from "../agents/context.js";
import { runAdaptation } from "../agents/adaptation.js";
import { runDirector } from "../agents/director.js";
import { repairAll } from "../agents/repair.js";
import { runScreenplay } from "../agents/screenplay.js";
import { runSourceIntelligence } from "../agents/sourceIntelligence.js";
import { assembleFilm } from "../film/assembly.js";
import { applyVerificationToShots, generateAllMedia } from "../media/generation.js";
import { persistWorldMemory } from "./memoryStage.js";
import { STAGE_ORDER, type CreateProjectInput, type Project, type Screenplay, type Stage, type StageRecord, type WorldState } from "../model/index.js";
import { runVerification } from "./verification.js";
import { slugify } from "../model/common.js";
import { compileSocialStoryAdaptation, compileSocialStoryScreenplay, compileSocialStoryWorld, runSocialStoryDirector, SOCIAL_STORY_NOTE, SOCIAL_STORY_PROVENANCE } from "../social/compile.js";

const socialBrief = (project: Project) => (project.mode === "social_story" ? project.socialStory : undefined);

/** Shot planning dispatch: the Director LLM for films, the deterministic one-shot-per-step planner for social stories. */
export async function planShots(ctx: AgentContext, project: Project, world: WorldState, screenplay: Screenplay) {
  const brief = socialBrief(project);
  if (brief) return runSocialStoryDirector(ctx, project, brief, world, screenplay);
  return runDirector(ctx, project, world, screenplay, ctx.repo.listStateChanges(project.id));
}

export type StageRunner = (ctx: AgentContext, project: Project) => Promise<void>;

/**
 * Stage implementations. Each reads what it needs from the repository and persists its outputs,
 * so a run can resume from the last completed stage after a crash or restart.
 */
export const STAGE_RUNNERS: Record<Exclude<Stage, "created">, StageRunner> = {
  source_analyzed: async (ctx, project) => {
    const brief = socialBrief(project);
    if (!brief) {
      await runSourceIntelligence(ctx, project);
      return;
    }
    // Social story: the routine IS the canonical world. Compiled deterministically; nothing is inferred by a model.
    ctx.events.emit(project.id, "source_intelligence", "source.analysis.started", `Compiling the authored routine for ${brief.child.name} (${brief.steps.length} steps) into canonical world memory`, { deterministic: true });
    const world = compileSocialStoryWorld(project, brief);
    ctx.repo.saveWorld(world);
    await ctx.memory.recordWorld(world);
    ctx.repo.store.put("source_analysis_raw", project.id, "current", { output: brief, provenance: { ...SOCIAL_STORY_PROVENANCE, task: "source_intelligence", createdAt: new Date().toISOString(), note: SOCIAL_STORY_NOTE }, report: { droppedReferences: [], addedConstraints: world.visualConstraints.map((v) => v.id) } });
    const constraintCount = world.sourceConstraints.length + world.visualConstraints.length + world.continuityConstraints.length;
    ctx.events.emit(project.id, "source_intelligence", "source.analysis.completed", `Routine compiled: ${world.characters.length} people, ${world.locations.length} settings, ${world.props.length} comfort items, ${world.events.length} steps`, { deterministic: true }, "success");
    ctx.events.emit(project.id, "world_memory", "memory.constraints.extracted", `${constraintCount} constraints locked (${world.sourceConstraints.length} source, ${world.visualConstraints.length} visual incl. ${brief.mustNotShow.length} must-not-show, ${world.continuityConstraints.length} continuity)`, { added: world.visualConstraints.map((v) => v.id) });
  },
  adapted: async (ctx, project) => {
    const world = ctx.repo.getWorld(project.id);
    if (!world) throw new Error("World memory missing; run source analysis first");
    const brief = socialBrief(project);
    if (!brief) {
      await runAdaptation(ctx, project, world);
      return;
    }
    const plan = compileSocialStoryAdaptation(project, brief, world);
    ctx.repo.saveAdaptation(plan);
    ctx.events.emit(project.id, "adaptation", "adaptation.completed", `Social story: ${plan.beatSheet.length} beats = ${brief.steps.length} authored steps, all must-keep, order unbreakable`, { deterministic: true }, "success");
  },
  screenplay_written: async (ctx, project) => {
    const world = ctx.repo.getWorld(project.id);
    const plan = ctx.repo.getAdaptation(project.id);
    if (!world || !plan) throw new Error("Adaptation plan missing");
    const brief = socialBrief(project);
    if (!brief) {
      await runScreenplay(ctx, project, world, plan);
      return;
    }
    const screenplay = compileSocialStoryScreenplay(project, brief, world);
    ctx.repo.saveScreenplay(screenplay);
    await ctx.memory.recordScreenplay(screenplay);
    ctx.events.emit(project.id, "screenplay", "screenplay.completed", `Screenplay compiled verbatim: ${screenplay.scenes.length} scenes (one per step), ${screenplay.totalDurationSec}s, words unchanged`, { deterministic: true }, "success");
  },
  memory_built: async (ctx, project) => {
    const world = ctx.repo.getWorld(project.id);
    const screenplay = ctx.repo.getScreenplay(project.id);
    if (!world || !screenplay) throw new Error("Screenplay missing");
    await persistWorldMemory(ctx, project.id, world, screenplay);
  },
  shots_planned: async (ctx, project) => {
    const world = ctx.repo.getWorld(project.id);
    const screenplay = ctx.repo.getScreenplay(project.id);
    if (!world || !screenplay) throw new Error("Screenplay missing");
    await planShots(ctx, project, world, screenplay);
  },
  narrative_verified: async (ctx, project) => {
    await runVerification(ctx, project, { critics: ["narrative", "source_fidelity"] });
    const open = ctx.repo.listViolations(project.id).filter((v) => v.status === "open" && v.critic !== "visual");
    if (open.length) {
      const r = await repairAll(ctx, project, ["narrative", "source_fidelity"]);
      ctx.events.emit(project.id, "repair", "repair.summary", `Repair pass: ${r.attempted.length} attempted, ${r.resolved.length} resolved, ${r.escalated.length} escalated`, { ...r }, r.escalated.length ? "warn" : "success");
      // Shots planned before a rewrite are stale: re-plan the affected scenes' shots deterministically from the new screenplay.
      if (r.resolved.length && ctx.repo.getShotPlan(project.id)) {
        const world = ctx.repo.getWorld(project.id)!;
        const screenplay = ctx.repo.getScreenplay(project.id)!;
        await planShots(ctx, project, world, screenplay);
      }
    }
  },
  media_generated: async (ctx, project) => {
    const r = await generateAllMedia(ctx, project);
    ctx.events.emit(project.id, "generation", "generation.summary", `Media generation: ${r.generated.length} shots generated, ${r.failed.length} failed`, r, r.failed.length ? "warn" : "success");
    if (r.failed.length && r.generated.length === 0) throw new Error(`All shots failed to generate: ${r.failed[0].error}`);
  },
  visually_verified: async (ctx, project) => {
    await runVerification(ctx, project, { critics: ["visual"] });
    const open = ctx.repo.listViolations(project.id).filter((v) => v.status === "open" && v.critic === "visual");
    if (open.length) {
      const r = await repairAll(ctx, project, ["visual"]);
      ctx.events.emit(project.id, "repair", "repair.summary", `Visual repair pass: ${r.attempted.length} attempted, ${r.resolved.length} resolved, ${r.escalated.length} escalated`, { ...r }, r.escalated.length ? "warn" : "success");
    }
    const s = applyVerificationToShots(ctx, project.id);
    ctx.events.emit(project.id, "visual_critic", "shots.status.updated", `${s.verified} shots verified, ${s.failed} with open visual violations`, s, s.failed ? "warn" : "success");
  },
  film_assembled: async (ctx, project) => {
    await assembleFilm(ctx, project);
  },
};

function stageIndex(s: Stage) {
  return STAGE_ORDER.indexOf(s);
}

function record(project: Project, stage: Stage): StageRecord | undefined {
  return project.stages.find((s) => s.stage === stage);
}

function upsertStage(project: Project, rec: StageRecord): Project {
  const stages = project.stages.filter((s) => s.stage !== rec.stage);
  stages.push(rec);
  stages.sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));
  return { ...project, stages };
}

export function createProject(ctx: AgentContext, input: CreateProjectInput, opts: { id?: string; isDemo?: boolean } = {}): Project {
  const base = opts.id ?? slugify(input.title);
  let id = base;
  let n = 2;
  while (ctx.repo.getProject(id)) id = `${base}_${n++}`;
  const now = new Date().toISOString();
  const project: Project = {
    id,
    title: input.title,
    mode: input.mode,
    source: input.source,
    brief: input.brief,
    stage: "created",
    stages: [{ stage: "created", status: "complete", startedAt: now, finishedAt: now }],
    llmProvider: ctx.llm.name,
    mediaProvider: ctx.media.name,
    isDemo: opts.isDemo ?? false,
    socialStory: input.mode === "social_story" ? input.socialStory : undefined,
    childId: input.childId,
    revisionOf: input.revisionOf,
    createdAt: now,
    updatedAt: now,
  };
  ctx.repo.saveProject(project);
  ctx.events.emit(project.id, "orchestrator", "project.created", `Project "${project.title}" created (${project.mode === "social_story" ? "social story" : project.mode} mode, source: ${project.source.kind.replace("_", " ")})`, { llmProvider: ctx.llm.name, mediaProvider: ctx.media.name }, "success");
  return project;
}

/** Reset a stage and everything after it (used when the user re-runs an earlier stage). */
export function resetFromStage(ctx: AgentContext, projectId: string, stage: Stage): Project {
  let project = ctx.repo.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const idx = stageIndex(stage);
  project = { ...project, stages: project.stages.filter((s) => stageIndex(s.stage) < idx), stage: STAGE_ORDER[Math.max(0, idx - 1)], approval: undefined };
  // Downstream artifacts are invalidated.
  if (idx <= stageIndex("source_analyzed")) ctx.repo.store.deleteCollection("world", projectId);
  if (idx <= stageIndex("adapted")) ctx.repo.store.deleteCollection("adaptation", projectId);
  if (idx <= stageIndex("screenplay_written")) ctx.repo.store.deleteCollection("screenplay", projectId);
  if (idx <= stageIndex("memory_built")) ctx.repo.store.deleteCollection("state_changes", projectId);
  if (idx <= stageIndex("shots_planned")) ctx.repo.store.deleteCollection("shots", projectId);
  if (idx <= stageIndex("narrative_verified")) {
    ctx.repo.deleteViolations(projectId);
    ctx.repo.store.deleteCollection("checks", projectId);
    ctx.repo.store.deleteCollection("critic_runs", projectId);
  }
  if (idx <= stageIndex("film_assembled")) ctx.repo.store.deleteCollection("film", projectId);
  ctx.repo.saveProject(project);
  ctx.events.emit(projectId, "orchestrator", "pipeline.reset", `Pipeline reset from stage "${stage}"`, { stage }, "warn");
  return project;
}

export interface RunOptions {
  /** Run up to and including this stage. Defaults to narrative_verified (the cheap, credential-light slice). */
  toStage?: Stage;
  /** Re-run stages even if complete. */
  force?: boolean;
}

/**
 * Run the pipeline. Stages already complete are skipped (resumable); a failed stage is retried.
 * Errors are recorded on the stage and re-thrown — nothing is swallowed.
 */
export async function runPipeline(ctx: AgentContext, projectId: string, opts: RunOptions = {}): Promise<Project> {
  let project = ctx.repo.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const target = opts.toStage ?? "narrative_verified";
  const targetIdx = stageIndex(target);
  (ctx.llm as { setProject?: (id: string) => void }).setProject?.(project.id);
  ctx.events.emit(project.id, "orchestrator", "pipeline.started", `Pipeline run to "${target}"`, { toStage: target, force: !!opts.force });

  for (const stage of STAGE_ORDER) {
    if (stage === "created") continue;
    if (stageIndex(stage) > targetIdx) break;
    const rec = record(project, stage);
    if (rec?.status === "complete" && !opts.force) continue;
    const startedAt = new Date().toISOString();
    project = upsertStage(project, { stage, status: "running", startedAt });
    ctx.repo.saveProject(project);
    ctx.events.emit(project.id, "orchestrator", "stage.started", `Stage "${stage}" started`, { stage });
    try {
      await STAGE_RUNNERS[stage](ctx, project);
      project = ctx.repo.getProject(project.id)!;
      project = upsertStage(project, { stage, status: "complete", startedAt, finishedAt: new Date().toISOString() });
      project.stage = stage;
      ctx.repo.saveProject(project);
      ctx.events.emit(project.id, "orchestrator", "stage.completed", `Stage "${stage}" complete`, { stage }, "success");
      await ctx.partner.emitMetric({ name: "stage_duration_ms", value: Date.now() - Date.parse(startedAt), unit: "ms", labels: { stage, projectId: project.id }, ts: new Date().toISOString() });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      project = ctx.repo.getProject(project.id)!;
      project = upsertStage(project, { stage, status: "failed", startedAt, finishedAt: new Date().toISOString(), error: message });
      ctx.repo.saveProject(project);
      ctx.events.emit(project.id, "orchestrator", "stage.failed", `Stage "${stage}" failed: ${message}`, { stage, error: message }, "error");
      throw err;
    }
  }
  ctx.events.emit(project.id, "orchestrator", "pipeline.completed", `Pipeline reached "${project.stage}"`, { stage: project.stage }, "success");
  return project;
}
