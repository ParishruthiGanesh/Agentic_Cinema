import { FunctionTool } from "@google/adk";
import { z } from "zod";
import {
  CreateProjectInput,
  EVAL_PREFIX,
  Stage,
  continuitySummary,
  createProject,
  ensureDemoProject,
  repairViolation,
  retrieveSceneContext,
  runEvaluation,
  runPipeline,
  runVerification,
  type AgentContext,
} from "@cinememory/core";

/**
 * CineMemory capabilities exposed to the ADK Producer agent as FunctionTools.
 * The tools are thin and deterministic: they call the same orchestrator, critics, repair loop and
 * production memory the UI uses, so whatever the agent decides is executed by CineMemory and logged.
 */
export function createCineMemoryTools(ctx: AgentContext) {
  const note = (projectId: string, message: string, data: Record<string, unknown> = {}) => ctx.events.emit(projectId, "orchestrator", "agent.producer.tool", message, { ...data, via: "adk-producer" });

  const listProjects = new FunctionTool({
    name: "list_projects",
    description: "List CineMemory projects with their production stage and continuity status.",
    execute: async () =>
      ctx.repo
        .listProjects()
        .filter((p) => !p.id.startsWith(EVAL_PREFIX))
        .map((p) => ({ id: p.id, title: p.title, mode: p.mode, stage: p.stage, continuity: continuitySummary(ctx, p.id) })),
  });

  const createDemo = new FunctionTool({
    name: "create_demo_project",
    description: "Create (or return) the bundled demo project 'Lumi and the Broken Compass' and return its id.",
    execute: async () => {
      const p = ensureDemoProject(ctx);
      return { projectId: p.id, title: p.title, stage: p.stage };
    },
  });

  const create = new FunctionTool({
    name: "create_project",
    description: "Create a new CineMemory project from source material and a production brief. Returns the project id. Do not run stages here.",
    parameters: z.object({
      title: z.string(),
      mode: z.enum(["creator", "kids"]),
      sourceKind: z.enum(["original", "public_domain", "licensed", "screenplay", "idea", "lesson"]),
      sourceTitle: z.string(),
      sourceText: z.string().describe("The full story, lesson or screenplay text"),
      genre: z.string(),
      audience: z.string(),
      ageRange: z.string().optional(),
      targetDurationSec: z.number().int().min(20).max(600),
      language: z.string().default("English"),
      visualStyle: z.string(),
      tone: z.string().optional(),
      adaptationInstructions: z.string().optional(),
      requiredFacts: z.array(z.string()).default([]),
    }),
    execute: async (input) => {
      const parsed = CreateProjectInput.parse({
        title: input.title,
        mode: input.mode,
        source: { kind: input.sourceKind, title: input.sourceTitle, text: input.sourceText },
        brief: { genre: input.genre, audience: input.audience, ageRange: input.ageRange, targetDurationSec: input.targetDurationSec, language: input.language, visualStyle: input.visualStyle, tone: input.tone, format: "animated short", adaptationInstructions: input.adaptationInstructions, requiredFacts: input.requiredFacts },
      });
      const p = createProject(ctx, parsed);
      note(p.id, `Producer agent created project "${p.title}"`);
      return { projectId: p.id, stage: p.stage };
    },
  });

  const runStage = new FunctionTool({
    name: "run_pipeline",
    description:
      "Run the CineMemory agent pipeline for a project up to a stage (resumable; completed stages are skipped). Stages in order: source_analyzed, adapted, screenplay_written, memory_built, shots_planned, narrative_verified (critics + autonomous repair), media_generated, visually_verified, film_assembled. Returns the stage reached and the continuity summary.",
    parameters: z.object({ projectId: z.string(), toStage: Stage.default("narrative_verified"), force: z.boolean().default(false) }),
    execute: async (input) => {
      note(input.projectId, `Producer agent requested pipeline run to "${input.toStage}"`, { toStage: input.toStage });
      const p = await runPipeline(ctx, input.projectId, { toStage: input.toStage, force: input.force });
      return { stage: p.stage, stages: p.stages.map((s) => ({ stage: s.stage, status: s.status, error: s.error })), continuity: continuitySummary(ctx, p.id) };
    },
  });

  const status = new FunctionTool({
    name: "get_project_status",
    description: "Get a project's stage, scene/shot counts and continuity scores (pass ÷ evaluated checks per critic).",
    parameters: z.object({ projectId: z.string() }),
    execute: async ({ projectId }) => {
      const p = ctx.repo.getProject(projectId);
      if (!p) return { error: `project ${projectId} not found` };
      const sp = ctx.repo.getScreenplay(projectId);
      const shots = ctx.repo.getShotPlan(projectId)?.shots ?? [];
      return { id: p.id, title: p.title, stage: p.stage, scenes: sp?.scenes.length ?? 0, screenplayVersion: sp?.version, shots: shots.length, shotsByStatus: shots.reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {}), continuity: continuitySummary(ctx, projectId), memory: ctx.memory.name };
    },
  });

  const violations = new FunctionTool({
    name: "list_violations",
    description: "List continuity violations for a project with code, status, expected/observed and evidence. Filter by status: open, repairing, resolved, escalated, overridden.",
    parameters: z.object({ projectId: z.string(), status: z.enum(["open", "repairing", "resolved", "escalated", "overridden"]).optional() }),
    execute: async ({ projectId, status: st }) =>
      ctx.repo
        .listViolations(projectId)
        .filter((v) => !st || v.status === st)
        .map((v) => ({ id: v.id, code: v.code, critic: v.critic, status: v.status, severity: v.severity, scene: v.scope.sceneNumber, shot: v.scope.shotId, expected: v.expected, observed: v.observed, evidence: v.evidence, repairAttempts: v.repairAttempts.length })),
  });

  const repair = new FunctionTool({
    name: "repair_violation",
    description: "Run the Repair Agent on one violation: diagnose the root cause, rewrite only the affected scene / prompt / media, re-verify, retry up to the limit, then escalate. Returns the final status.",
    parameters: z.object({ projectId: z.string(), violationId: z.string() }),
    execute: async ({ projectId, violationId }) => {
      const p = ctx.repo.getProject(projectId);
      if (!p) return { error: "project not found" };
      note(projectId, `Producer agent requested repair of ${violationId}`, { violationId });
      const v = await repairViolation(ctx, p, violationId);
      return { id: v.id, code: v.code, status: v.status, attempts: v.repairAttempts.map((a) => ({ attempt: a.attempt, strategy: a.strategy, target: a.target, outcome: a.outcome })), resolutionNote: v.resolutionNote };
    },
  });

  const verify = new FunctionTool({
    name: "run_critics",
    description: "Re-run the continuity critics (narrative, source_fidelity, visual) for a project and return the continuity summary.",
    parameters: z.object({ projectId: z.string(), critics: z.array(z.enum(["narrative", "source_fidelity", "visual"])).default(["narrative", "source_fidelity", "visual"]) }),
    execute: async ({ projectId, critics }) => {
      const p = ctx.repo.getProject(projectId);
      if (!p) return { error: "project not found" };
      await runVerification(ctx, p, { critics });
      return continuitySummary(ctx, projectId);
    },
  });

  const sceneMemory = new FunctionTool({
    name: "query_scene_memory",
    description: "Retrieve from production memory (ClickHouse) what is true BEFORE a given scene: which characters know which facts (and since which scene), character state changes, facts that must not be referenced yet, and the violation history for that scene.",
    parameters: z.object({ projectId: z.string(), sceneNumber: z.number().int().min(1) }),
    execute: async ({ projectId, sceneNumber }) => {
      const world = ctx.repo.getWorld(projectId);
      const sp = ctx.repo.getScreenplay(projectId);
      const scene = sp?.scenes.find((s) => s.number === sceneNumber);
      const entityIds = scene ? [...scene.characterIds, ...scene.propIds] : undefined;
      const [state, knowledge, history] = await Promise.all([ctx.memory.stateBefore(projectId, sceneNumber, entityIds), ctx.memory.knowledgeBefore(projectId, sceneNumber), ctx.memory.violationHistory(projectId, scene ? { sceneId: scene.id } : {})]);
      const context = world && sp && scene ? retrieveSceneContext(world, sp, state.changes, scene.id) : null;
      note(projectId, `Producer agent queried ${ctx.memory.name === "clickhouse" ? "ClickHouse" : "local"} memory before scene ${sceneNumber}: ${knowledge.events.length} knowledge events, ${state.changes.length} state changes`, { sceneNumber, source: state.trace.source, sql: knowledge.trace.sql, rows: state.trace.rows + knowledge.trace.rows });
      return {
        source: state.trace.source,
        knowledge: knowledge.events.map((e) => ({ character: e.characterId, fact: e.statement, sinceScene: e.sceneNumber, via: e.via })),
        mustNotReference: context?.forbiddenFacts.map((f) => ({ fact: f.fact.statement, unknownTo: f.unknownTo, knownBy: f.knownBy })) ?? [],
        characters: context?.characters.map((c) => ({ id: c.character.id, location: c.current_location, mood: c.emotional_state, holding: c.inventory, knows: c.knowledge })) ?? [],
        stateChanges: state.changes.map((c) => ({ scene: c.sceneNumber, entity: c.entityId, field: c.field, before: c.before, after: c.after })),
        violationHistory: history.violations,
        sql: knowledge.trace.sql,
      };
    },
  });

  const evaluate = new FunctionTool({
    name: "run_evaluation",
    description: "Run the baseline-vs-CineMemory evaluation harness for a project and return the measured metrics of both variants.",
    parameters: z.object({ projectId: z.string() }),
    execute: async ({ projectId }) => {
      const cmp = await runEvaluation(ctx, projectId);
      return { baseline: cmp.baseline.metrics, cinememory: cmp.cinememory.metrics, notes: [...cmp.baseline.notes, ...cmp.cinememory.notes] };
    },
  });

  return { listProjects, createDemo, create, runStage, status, violations, repair, verify, sceneMemory, evaluate };
}

export type CineMemoryTools = ReturnType<typeof createCineMemoryTools>;
