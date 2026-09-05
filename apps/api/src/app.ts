import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import {
  CreateProjectInput,
  EVAL_PREFIX,
  Stage,
  buildCineGraph,
  continuitySummary,
  createProject,
  ensureDemoProject,
  generateShotMedia,
  neighborhood,
  repairViolation,
  resetFromStage,
  runEvaluation,
  runPipeline,
  runVerification,
  retrieveSceneContext,
  type AgentContext,
  type Project,
} from "@cinememory/core";
import type { RuntimeInfo } from "./context.js";
import { JobBusyError, JobRunner } from "./jobs.js";

const MIME: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".vtt": "text/vtt" };

export function projectSummary(ctx: AgentContext, project: Project) {
  const world = ctx.repo.getWorld(project.id);
  const screenplay = ctx.repo.getScreenplay(project.id);
  const shots = ctx.repo.getShotPlan(project.id)?.shots ?? [];
  const violations = ctx.repo.listViolations(project.id);
  const continuity = continuitySummary(ctx, project.id);
  const byStatus = shots.reduce<Record<string, number>>((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {});
  return {
    project,
    counts: {
      characters: world?.characters.length ?? 0,
      locations: world?.locations.length ?? 0,
      props: world?.props.length ?? 0,
      events: world?.events.length ?? 0,
      knowledgeFacts: world?.knowledgeFacts.length ?? 0,
      constraints: world ? world.sourceConstraints.length + world.visualConstraints.length + world.continuityConstraints.length : 0,
      scenes: screenplay?.scenes.length ?? 0,
      shots: shots.length,
      shotsByStatus: byStatus,
      generated: shots.filter((s) => s.keyframe).length,
      violations: violations.length,
      unresolved: continuity.unresolved,
    },
    continuity,
    screenplayVersion: screenplay?.version,
    durationSec: screenplay?.totalDurationSec,
    film: !!ctx.repo.getFilm(project.id),
    lastEvent: ctx.repo.listEvents(project.id).slice(-1)[0],
  };
}

export function createApp(ctx: AgentContext, info: RuntimeInfo, jobs: JobRunner) {
  const app = new Hono();
  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof JobBusyError) return c.json({ error: err.message, job: err.job }, 409);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: err.message ?? String(err) }, 500);
  });

  const getProject = (id: string) => {
    const p = ctx.repo.getProject(id);
    if (!p) throw new NotFound(`Project ${id} not found`);
    return p;
  };

  app.get("/api/health", async (c) => c.json({ ok: true, ...info, partnerHealth: await ctx.partner.healthCheck(), time: new Date().toISOString() }));

  app.get("/api/projects", (c) => {
    const includeEval = c.req.query("includeEval") === "true";
    const list = ctx.repo.listProjects().filter((p) => includeEval || !p.id.startsWith(EVAL_PREFIX));
    return c.json(list.map((p) => projectSummary(ctx, p)));
  });

  app.post("/api/projects", async (c) => {
    const input = CreateProjectInput.parse(await c.req.json());
    const project = createProject(ctx, input);
    return c.json(projectSummary(ctx, project), 201);
  });

  app.post("/api/projects/demo", (c) => c.json(projectSummary(ctx, ensureDemoProject(ctx)), 201));

  app.get("/api/projects/:id", (c) => c.json(projectSummary(ctx, getProject(c.req.param("id")))));

  app.delete("/api/projects/:id", (c) => {
    getProject(c.req.param("id"));
    ctx.repo.deleteProject(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/run", async (c) => {
    const project = getProject(c.req.param("id"));
    const body = z.object({ toStage: Stage.optional(), force: z.boolean().optional() }).parse((await c.req.json().catch(() => ({}))) ?? {});
    const job = jobs.start(project.id, "pipeline", `run to ${body.toStage ?? "narrative_verified"}`, () => runPipeline(ctx, project.id, body).then(() => undefined));
    return c.json(job, 202);
  });

  app.post("/api/projects/:id/reset", async (c) => {
    const project = getProject(c.req.param("id"));
    const body = z.object({ stage: Stage }).parse(await c.req.json());
    return c.json(resetFromStage(ctx, project.id, body.stage));
  });

  app.post("/api/projects/:id/verify", async (c) => {
    const project = getProject(c.req.param("id"));
    const body = z.object({ critics: z.array(z.enum(["narrative", "source_fidelity", "visual"])).default(["narrative", "source_fidelity", "visual"]) }).parse((await c.req.json().catch(() => ({}))) ?? {});
    const job = jobs.start(project.id, "verify", `verify ${body.critics.join(", ")}`, () => runVerification(ctx, project, { critics: body.critics }).then(() => undefined));
    return c.json(job, 202);
  });

  app.get("/api/projects/:id/job", (c) => {
    const id = c.req.param("id");
    return c.json({ current: jobs.current(id) ?? null, recent: jobs.recent(id) });
  });

  app.get("/api/projects/:id/events", (c) => {
    getProject(c.req.param("id"));
    const after = Number(c.req.query("after") ?? 0);
    return c.json(ctx.repo.listEvents(c.req.param("id"), after));
  });

  app.get("/api/projects/:id/events/stream", (c) => {
    const id = c.req.param("id");
    getProject(id);
    const after = Number(c.req.query("after") ?? 0);
    return streamSSE(c, async (stream) => {
      for (const e of ctx.repo.listEvents(id, after)) await stream.writeSSE({ event: "event", data: JSON.stringify(e), id: String(e.seq) });
      let closed = false;
      const unsubscribe = ctx.events.subscribe((e) => {
        if (e.projectId !== id || closed) return;
        void stream.writeSSE({ event: "event", data: JSON.stringify(e), id: String(e.seq) });
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });
      while (!closed) {
        await stream.writeSSE({ event: "ping", data: JSON.stringify({ job: jobs.current(id) ?? null, t: Date.now() }) });
        await stream.sleep(5000);
      }
    });
  });

  app.get("/api/projects/:id/world", (c) => c.json(ctx.repo.getWorld(getProject(c.req.param("id")).id) ?? null));
  app.get("/api/projects/:id/changes", (c) => c.json(ctx.repo.listStateChanges(getProject(c.req.param("id")).id)));
  app.get("/api/projects/:id/adaptation", (c) => c.json(ctx.repo.getAdaptation(getProject(c.req.param("id")).id) ?? null));
  app.get("/api/projects/:id/screenplay", (c) => c.json(ctx.repo.getScreenplay(getProject(c.req.param("id")).id) ?? null));
  app.get("/api/projects/:id/shots", (c) => c.json(ctx.repo.getShotPlan(getProject(c.req.param("id")).id) ?? null));
  app.get("/api/projects/:id/violations", (c) => c.json(ctx.repo.listViolations(getProject(c.req.param("id")).id)));
  app.get("/api/projects/:id/checks", (c) => c.json(ctx.repo.listChecks(getProject(c.req.param("id")).id)));
  app.get("/api/projects/:id/continuity", (c) => c.json(continuitySummary(ctx, getProject(c.req.param("id")).id)));
  app.get("/api/projects/:id/film", (c) => c.json(ctx.repo.getFilm(getProject(c.req.param("id")).id) ?? null));
  app.get("/api/projects/:id/evaluations", (c) => c.json(ctx.repo.listEvaluations(getProject(c.req.param("id")).id)));
  app.get("/api/projects/:id/source-analysis", (c) => c.json(ctx.repo.store.get("source_analysis_raw", getProject(c.req.param("id")).id, "current") ?? null));

  app.get("/api/projects/:id/scenes/:sceneId/context", (c) => {
    const project = getProject(c.req.param("id"));
    const world = ctx.repo.getWorld(project.id);
    const screenplay = ctx.repo.getScreenplay(project.id);
    if (!world || !screenplay) return c.json(null);
    return c.json(retrieveSceneContext(world, screenplay, ctx.repo.listStateChanges(project.id), c.req.param("sceneId")));
  });

  app.get("/api/projects/:id/graph", (c) => {
    const project = getProject(c.req.param("id"));
    const world = ctx.repo.getWorld(project.id);
    if (!world) return c.json({ nodes: [], edges: [], stats: {} });
    const graph = buildCineGraph(world, ctx.repo.getScreenplay(project.id), ctx.repo.listViolations(project.id));
    const focus = c.req.query("focus");
    return c.json(focus ? neighborhood(graph, focus, Number(c.req.query("depth") ?? 1)) : graph);
  });

  app.post("/api/projects/:id/violations/:vid/repair", (c) => {
    const project = getProject(c.req.param("id"));
    const vid = c.req.param("vid");
    const v = ctx.repo.getViolation(project.id, vid);
    if (!v) throw new NotFound("Violation not found");
    if (v.status === "escalated") {
      // A user-initiated retry after escalation gets a fresh attempt budget.
      ctx.repo.saveViolation({ ...v, status: "open", repairAttempts: [] });
      ctx.events.emit(project.id, "user", "violation.retry", `User requested another repair of ${v.code}`, { violationId: vid });
    }
    const job = jobs.start(project.id, "repair", `repair ${v.code}`, () => repairViolation(ctx, project, vid).then(() => undefined));
    return c.json(job, 202);
  });

  app.post("/api/projects/:id/violations/:vid/override", async (c) => {
    const project = getProject(c.req.param("id"));
    const v = ctx.repo.getViolation(project.id, c.req.param("vid"));
    if (!v) throw new NotFound("Violation not found");
    const body = z.object({ note: z.string().default("Accepted by user") }).parse((await c.req.json().catch(() => ({}))) ?? {});
    const updated = { ...v, status: "overridden" as const, resolutionNote: `Manual override: ${body.note}`, resolvedAt: new Date().toISOString() };
    ctx.repo.saveViolation(updated);
    ctx.events.emit(project.id, "user", "violation.overridden", `User overrode ${v.code}: ${body.note}`, { violationId: v.id }, "warn");
    return c.json(updated);
  });

  app.post("/api/projects/:id/shots/:shotId/generate", (c) => {
    const project = getProject(c.req.param("id"));
    const shotId = c.req.param("shotId");
    const job = jobs.start(project.id, "generate", `generate ${shotId}`, async () => {
      await generateShotMedia(ctx, project, shotId, { reason: "user request" });
      await runVerification(ctx, project, { critics: ["visual"] });
    });
    return c.json(job, 202);
  });

  app.post("/api/projects/:id/evaluate", (c) => {
    const project = getProject(c.req.param("id"));
    const job = jobs.start(project.id, "evaluate", "baseline vs CineMemory", () => runEvaluation(ctx, project.id).then(() => undefined));
    return c.json(job, 202);
  });

  app.get("/api/partner/metrics", async (c) => c.json(await ctx.partner.listMetrics(c.req.query("name") || undefined)));
  app.get("/api/partner/search", async (c) => c.json(await ctx.partner.search(c.req.query("project") ?? "", c.req.query("q") ?? "")));

  app.get("/media/*", async (c) => {
    const rel = normalize(c.req.path.replace(/^\/media\//, "")).replace(/^(\.\.[/\\])+/, "");
    if (rel.includes("..")) return c.text("forbidden", 403);
    const full = join(ctx.config.mediaDir, rel);
    try {
      const s = await stat(full);
      if (!s.isFile()) return c.text("not found", 404);
      const body = await readFile(full);
      return c.body(body, 200, { "Content-Type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    } catch {
      return c.text("not found", 404);
    }
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}

class NotFound extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NotFound";
  }
}
