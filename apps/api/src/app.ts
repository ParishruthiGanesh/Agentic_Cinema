import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import {
  ApprovalBlockedError,
  ChildProfileInput,
  ClickHouseMemory,
  CreateProjectInput,
  EVAL_PREFIX,
  MAYA_SOCIAL_STORY,
  Stage,
  approveSocialStory,
  buildCineGraph,
  buildContinuityCertificate,
  continuitySummary,
  createProject,
  draftSocialStory,
  ensureDemoProject,
  ensureSocialStoryDemo,
  generateShotMedia,
  generateAllVideos,
  assembleFilm,
  listCharacterReferences,
  listLocationReferences,
  StoryOutcomeInput,
  applyChildReferences,
  briefFromChild,
  checkPlainLanguage,
  listChildPhotos,
  recordOutcome,
  removeChildPhoto,
  revisionSeed,
  saveChildPhoto,
  storiesForChild,
  storyStatus,
  upsertChildProfile,
  visualStyleFor,
  PICTURE_STYLES,
  SocialStoryBrief,
  renderSocialStoryText,
  neighborhood,
  removeCharacterReference,
  repairViolation,
  resetFromStage,
  revokeApproval,
  runEvaluation,
  runPipeline,
  runVerification,
  retrieveSceneContext,
  saveUploadedReference,
  type AgentContext,
  type Project,
} from "@cinememory/core";
import type { RuntimeInfo } from "./context.js";
import { JobBusyError, JobRunner } from "./jobs.js";
import { openApiDocument } from "./openapi.js";
import { renderBooklet } from "./booklet.js";
import { AuthError, AuthService, publicAccount, type Account } from "./auth.js";
import type { ProducerService } from "./producer.js";

const MIME: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".vtt": "text/vtt" };

export function projectSummary(ctx: AgentContext, project: Project, jobs?: JobRunner) {
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
    story: project.mode === "social_story" ? storyStatus(project, { running: !!jobs?.current(project.id), jobError: jobs?.recent(project.id)[0]?.error }) : undefined,
    videoPath: ctx.repo.getFilm(project.id)?.renderedVideo?.path,
    clips: ctx.repo.getShotPlan(project.id)?.shots.filter((s) => s.video).length ?? 0,
    coverPath: ctx.repo.getShotPlan(project.id)?.shots.find((s) => s.keyframe && s.keyframe.provenance.provider !== "placeholder")?.keyframe?.path,
  };
}

type Vars = { Variables: { account?: Account } };

export function createApp(ctx: AgentContext, info: RuntimeInfo, jobs: JobRunner, producer?: ProducerService, auth: AuthService = new AuthService(ctx, process.env.GOOGLE_OAUTH_CLIENT_ID)) {
  const app = new Hono<Vars>();
  app.use("*", cors());
  app.use("*", auth.middleware());

  app.onError((err, c) => {
    if (err instanceof JobBusyError) return c.json({ error: err.message, job: err.job }, 409);
    if (err instanceof AuthError) return c.json({ error: err.message }, 401);
    if (err instanceof ApprovalBlockedError) return c.json({ error: err.message, certificate: err.certificate }, 409);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: err.message ?? String(err) }, 500);
  });

  const getProject = (id: string) => {
    const p = ctx.repo.getProject(id);
    if (!p) throw new NotFound(`Project ${id} not found`);
    return p;
  };

  app.get("/api/openapi.json", (c) => c.json(openApiDocument(new URL(c.req.url).origin)));

  /* ---- accounts (family app) ---- */
  app.get("/api/auth/config", (c) => c.json({ googleClientId: auth.googleClientId ?? null, localAccounts: true }));
  app.post("/api/auth/register", async (c) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1), name: z.string().max(80).default("") }).parse(await c.req.json());
    const r = auth.register(b.email, b.password, b.name);
    return c.json({ account: publicAccount(r.account), token: r.token }, 201);
  });
  app.post("/api/auth/login", async (c) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await c.req.json());
    const r = auth.login(b.email, b.password);
    return c.json({ account: publicAccount(r.account), token: r.token });
  });
  app.post("/api/auth/google", async (c) => {
    const b = z.object({ credential: z.string().min(10) }).parse(await c.req.json());
    const r = await auth.loginWithGoogle(b.credential);
    return c.json({ account: publicAccount(r.account), token: r.token });
  });
  app.post("/api/auth/logout", (c) => {
    const t = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (t) auth.logout(t);
    return c.json({ ok: true });
  });
  app.get("/api/auth/me", (c) => {
    const a = c.get("account");
    return a ? c.json({ account: publicAccount(a) }) : c.json({ account: null }, 401);
  });
  const requireAccount = (c: { get(k: "account"): Account | undefined }) => {
    const a = c.get("account");
    if (!a) throw new AuthError("Please sign in");
    return a;
  };

  app.get("/api/health", async (c) => c.json({ ok: true, ...info, partnerHealth: await ctx.partner.healthCheck(), time: new Date().toISOString() }));

  app.get("/api/projects", (c) => {
    const includeEval = c.req.query("includeEval") === "true";
    const list = ctx.repo.listProjects().filter((p) => includeEval || !p.id.startsWith(EVAL_PREFIX));
    return c.json(list.map((p) => projectSummary(ctx, p, jobs)));
  });

  app.post("/api/projects", async (c) => {
    const input = CreateProjectInput.parse(await c.req.json());
    if (input.childId && !ctx.repo.getChild(input.childId)) return c.json({ error: `Child profile ${input.childId} not found` }, 400);
    const project = createProject(ctx, input);
    if (project.childId) await applyChildReferences(ctx, project);
    return c.json(projectSummary(ctx, project), 201);
  });

  /* ---- children: one profile, many stories ---- */
  app.get("/api/children", (c) => {
    const account = c.get("account");
    const mine = c.req.query("mine") === "1";
    const list = ctx.repo.listChildren().filter((ch) => !mine || (account && ch.accountId === account.id));
    return c.json(list.map((ch) => ({ ...ch, stories: storiesForChild(ctx, ch.id).length, photos: listChildPhotos(ctx, ch.id).length, previews: ctx.repo.store.list<{ childId: string; style: string }>("child_previews", "_children").filter((p) => p.childId === ch.id).length })));
  });
  app.post("/api/children", async (c) => {
    const account = c.get("account");
    const input = ChildProfileInput.parse(await c.req.json());
    return c.json(upsertChildProfile(ctx, { ...input, accountId: input.accountId ?? account?.id }), 201);
  });
  /** The signed-in family takes the bundled example child (and her stories) into their account, if nobody has yet. */
  app.post("/api/children/claim-demo", (c) => {
    const account = requireAccount(c);
    ensureSocialStoryDemo(ctx);
    const maya = ctx.repo.getChild("maya")!;
    if (maya.accountId && maya.accountId !== account.id) return c.json({ error: "The example child already belongs to another account. Create your own child profile instead." }, 409);
    upsertChildProfile(ctx, { ...maya, accountId: account.id });
    return c.json(ctx.repo.getChild("maya"), 200);
  });
  /** Generate a preview of how the child will look in the chosen style (from the profile text and photo), so the adult can check the likeness before any story is made. */
  app.post("/api/children/:id/preview", async (c) => {
    const child = ctx.repo.getChild(c.req.param("id"));
    if (!child) throw new NotFound("Child not found");
    const body = z.object({ style: z.enum(["illustrated", "photo"]).optional() }).parse((await c.req.json().catch(() => ({}))) ?? {});
    const style = body.style ?? child.style;
    const photo = listChildPhotos(ctx, child.id).find((p) => p.entityId === child.id.replace(/[^a-z0-9_]/g, "") || p.kind === "character" && p.entityId === child.name.toLowerCase());
    const references: Array<{ mimeType: string; data: string; label: string }> = [];
    if (photo) {
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        references.push({ mimeType: photo.mimeType, data: (await readFile(join(ctx.config.mediaDir, photo.path))).toString("base64"), label: child.name });
      } catch { /* no photo */ }
    }
    const prompt = `${PICTURE_STYLES[style].prompt}. ${child.name}: ${child.appearance}; wearing ${child.outfit}. Front view, calm neutral expression, full body, plain light background, soft even light. No text.`;
    try {
      const img = await ctx.media.generateImage({ prompt, aspectRatio: "1:1", references, label: `${child.name} · look preview` });
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join, dirname } = await import("node:path");
      const ext = img.mimeType === "image/png" ? "png" : img.mimeType === "image/svg+xml" ? "svg" : "jpg";
      const path = `children/${child.id}/preview_${style}.${ext}`;
      await mkdir(dirname(join(ctx.config.mediaDir, path)), { recursive: true });
      await writeFile(join(ctx.config.mediaDir, path), img.bytes);
      const preview = { childId: child.id, style, path, mimeType: img.mimeType, provenance: img.provenance, fromPhoto: !!photo, createdAt: new Date().toISOString() };
      ctx.repo.store.put("child_previews", "_children", `${child.id}:${style}`, preview);
      return c.json(preview, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
  /** One call for the family wizard: build the brief from the profile, create the story, attach photos, and start making it. */
  app.post("/api/children/:id/stories", async (c) => {
    const child = ctx.repo.getChild(c.req.param("id"));
    if (!child) throw new NotFound("Child not found");
    const body = z.object({ title: z.string().max(120).optional(), situation: z.string().min(1), steps: z.array(z.any()).min(1), settings: z.array(z.any()).optional(), companions: z.array(z.any()).optional(), comfortItems: z.array(z.any()).optional(), mustNotShow: z.array(z.string()).optional(), calmingRules: z.array(z.string()).optional(), authoredBy: z.string().optional(), style: z.enum(["illustrated", "photo"]).optional(), revisionOf: z.string().optional(), video: z.boolean().default(false), start: z.boolean().default(true) }).parse(await c.req.json());
    const brief = SocialStoryBrief.parse(briefFromChild(child, body));
    const title = body.title?.trim() || `${child.name}: ${body.situation}`;
    const project = createProject(ctx, CreateProjectInput.parse({
      title,
      mode: "social_story",
      source: { kind: "social_story", title: `${title} (routine)`, author: brief.authoredBy, text: renderSocialStoryText(brief) },
      brief: { genre: "social story", audience: "an autistic child", ageRange: child.age, targetDurationSec: Math.max(30, brief.steps.length * 12), language: "English", visualStyle: visualStyleFor(child, body.style), tone: "calm, literal, reassuring", format: "social story film", requiredFacts: [] },
      socialStory: brief,
      childId: child.id,
      revisionOf: body.revisionOf,
      video: body.video,
    }));
    await applyChildReferences(ctx, project);
    const job = body.start ? jobs.start(project.id, "pipeline", "make the story", () => runPipeline(ctx, project.id, { toStage: "film_assembled" }).then(() => undefined)) : null;
    return c.json({ ...projectSummary(ctx, project, jobs), job }, 201);
  });
  app.get("/api/children/:id", async (c) => {
    const child = ctx.repo.getChild(c.req.param("id"));
    if (!child) throw new NotFound("Child not found");
    const stories = storiesForChild(ctx, child.id).map((p) => ({ ...projectSummary(ctx, p, jobs), outcomes: ctx.repo.listOutcomes(p.id) }));
    const history = ctx.memory instanceof ClickHouseMemory ? await ctx.memory.childHistory(child.id).catch(() => null) : null;
    const previews = ctx.repo.store.list<{ childId: string; style: string; path: string; provenance: unknown; fromPhoto: boolean; createdAt: string }>("child_previews", "_children").filter((p) => p.childId === child.id);
    return c.json({ child, stories, photos: listChildPhotos(ctx, child.id), previews, history, styles: PICTURE_STYLES });
  });
  app.put("/api/children/:id", async (c) => {
    const existing = ctx.repo.getChild(c.req.param("id"));
    if (!existing) throw new NotFound("Child not found");
    const input = ChildProfileInput.parse({ ...(await c.req.json()), id: existing.id });
    return c.json(upsertChildProfile(ctx, input));
  });
  app.delete("/api/children/:id", (c) => {
    ctx.repo.deleteChild(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/children/:id/photos/:entityId", async (c) => {
    const body = z.object({ mimeType: z.string(), data: z.string().min(1), kind: z.enum(["character", "location"]).default("character") }).parse(await c.req.json());
    try {
      return c.json(await saveChildPhoto(ctx, c.req.param("id"), c.req.param("entityId"), body.kind, body), 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.delete("/api/children/:id/photos/:entityId", (c) => c.json({ removed: removeChildPhoto(ctx, c.req.param("id"), c.req.param("entityId")) }));
  /** Build a full brief from a child's profile plus the story-specific parts (used by the form's preview and by agents). */
  app.post("/api/children/:id/brief", async (c) => {
    const child = ctx.repo.getChild(c.req.param("id"));
    if (!child) throw new NotFound("Child not found");
    const body = z.object({ situation: z.string().min(1), steps: z.array(z.any()).default([]), settings: z.array(z.any()).optional(), companions: z.array(z.any()).optional(), comfortItems: z.array(z.any()).optional(), mustNotShow: z.array(z.string()).optional(), calmingRules: z.array(z.string()).optional(), authoredBy: z.string().optional() }).parse(await c.req.json());
    return c.json(briefFromChild(child, body));
  });

  app.post("/api/projects/demo", (c) => c.json(projectSummary(ctx, ensureDemoProject(ctx)), 201));
  app.post("/api/projects/social-story-demo", (c) => c.json(projectSummary(ctx, ensureSocialStoryDemo(ctx)), 201));

  app.get("/api/social-stories/example", (c) => c.json(MAYA_SOCIAL_STORY));

  /* ---- social stories: Gemini-assisted first draft (the adult edits it; the film uses their final words verbatim) ---- */
  /** Plain-language critic on a brief (used by the form before submitting; also part of the certificate). */
  app.post("/api/social-stories/lint", async (c) => {
    const body = z.object({ steps: z.array(z.object({ text: z.string() })), calmingRules: z.array(z.string()).default([]) }).parse(await c.req.json());
    return c.json(checkPlainLanguage({ steps: body.steps as never, calmingRules: body.calmingRules }));
  });
  app.post("/api/social-stories/draft", async (c) => {
    if (ctx.llm.name === "fixture") return c.json({ error: "Drafting needs a Gemini key (LLM_PROVIDER=fixture). You can still write the steps yourself." }, 503);
    const body = z.object({ situation: z.string().min(3).max(500), childName: z.string().min(1).max(60), childAge: z.string().max(20).optional(), notes: z.string().max(2000).optional(), language: z.string().max(40).optional() }).parse(await c.req.json());
    const res = await draftSocialStory(ctx.llm, body);
    return c.json({ draft: res.data, provenance: res.provenance });
  });

  app.get("/api/projects/:id", (c) => c.json(projectSummary(ctx, getProject(c.req.param("id")), jobs)));

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
  app.get("/api/projects/:id/references", (c) => {
    const id = getProject(c.req.param("id")).id;
    return c.json(c.req.query("kind") === "location" ? listLocationReferences(ctx, id) : listCharacterReferences(ctx, id));
  });
  app.post("/api/projects/:id/references/:characterId", async (c) => {
    const project = getProject(c.req.param("id"));
    const body = z.object({ mimeType: z.string(), data: z.string().min(1), uploadedBy: z.string().max(80).optional(), kind: z.enum(["character", "location"]).default("character") }).parse(await c.req.json());
    try {
      const ref = await saveUploadedReference(ctx, project, c.req.param("characterId"), { mimeType: body.mimeType, data: body.data }, body.uploadedBy, body.kind);
      return c.json(ref, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.delete("/api/projects/:id/references/:characterId", (c) => {
    const project = getProject(c.req.param("id"));
    return c.json({ removed: removeCharacterReference(ctx, project.id, c.req.param("characterId"), c.req.query("kind") === "location" ? "location" : "character") });
  });

  /* ---- social stories: continuity certificate + human sign-off ---- */
  app.get("/api/projects/:id/certificate", async (c) => {
    const project = getProject(c.req.param("id"));
    if (project.mode !== "social_story") return c.json({ error: "Certificates are produced for social-story projects" }, 400);
    return c.json(await buildContinuityCertificate(ctx, project.id));
  });
  app.post("/api/projects/:id/approve", async (c) => {
    const project = getProject(c.req.param("id"));
    if (project.mode !== "social_story") return c.json({ error: "Approval applies to social-story projects" }, 400);
    const body = z.object({ approvedBy: z.string().min(1).max(80), note: z.string().max(500).optional(), force: z.boolean().optional() }).parse(await c.req.json());
    const r = await approveSocialStory(ctx, project.id, body);
    return c.json(r);
  });
  app.delete("/api/projects/:id/approve", (c) => c.json(revokeApproval(ctx, getProject(c.req.param("id")).id)));

  /* ---- social stories: booklet, outcomes, revision ---- */
  app.get("/api/projects/:id/booklet.pdf", async (c) => {
    const project = getProject(c.req.param("id"));
    if (project.mode !== "social_story") return c.json({ error: "Booklets are produced for social-story projects" }, 400);
    const bytes = await renderBooklet(ctx, project.id);
    return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${project.id}-booklet.pdf"` });
  });
  app.get("/api/projects/:id/outcomes", (c) => c.json(ctx.repo.listOutcomes(getProject(c.req.param("id")).id)));
  app.post("/api/projects/:id/outcomes", async (c) => {
    const project = getProject(c.req.param("id"));
    if (project.mode !== "social_story") return c.json({ error: "Outcomes are recorded for social-story projects" }, 400);
    const input = StoryOutcomeInput.parse(await c.req.json());
    return c.json(recordOutcome(ctx, project, input), 201);
  });
  app.get("/api/projects/:id/revision-seed", (c) => c.json(revisionSeed(ctx, getProject(c.req.param("id")))));
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

  /** Moving pictures for a story whose pictures already exist: a Veo clip per shot from its verified keyframe, re-check, re-assemble (renders the MP4). */
  app.post("/api/projects/:id/video", (c) => {
    const project = getProject(c.req.param("id"));
    if (!ctx.media.capabilities.video) return c.json({ error: `${ctx.media.name} cannot generate video (configure Gemini)` }, 400);
    if (!ctx.repo.getShotPlan(project.id)?.shots.some((s) => s.keyframe)) return c.json({ error: "Make the pictures first" }, 400);
    ctx.repo.saveProject({ ...project, video: true, approval: undefined });
    const job = jobs.start(project.id, "generate", "moving pictures", async () => {
      const p = ctx.repo.getProject(project.id)!;
      await generateAllVideos(ctx, p);
      await runVerification(ctx, p, { critics: ["visual"] });
      await assembleFilm(ctx, p);
    });
    return c.json(job, 202);
  });

  app.post("/api/projects/:id/evaluate", (c) => {
    const project = getProject(c.req.param("id"));
    if (project.mode === "social_story") return c.json({ error: "The baseline-vs-CineMemory evaluation compares model-written screenplays; a social story's words are authored, so use the Continuity Certificate instead." }, 400);
    const job = jobs.start(project.id, "evaluate", "baseline vs CineMemory", () => runEvaluation(ctx, project.id).then(() => undefined));
    return c.json(job, 202);
  });

  /* ---- ADK Producer agent ---- */
  app.get("/api/agent/status", (c) => c.json(producer ? producer.status() : { available: false, reason: "Producer agent not mounted" }));
  app.post("/api/agent/chat", async (c) => {
    if (!producer) return c.json({ error: "Producer agent not mounted" }, 503);
    if (!producer.available) return c.json({ error: producer.reason }, 503);
    const body = z.object({ sessionId: z.string().min(1).max(80).default("web"), message: z.string().min(1).max(4000) }).parse(await c.req.json());
    const steps = await producer.chat(body.sessionId, body.message);
    return c.json({ sessionId: body.sessionId, steps });
  });

  /* ---- production memory (ClickHouse) ---- */
  app.get("/api/memory/status", async (c) => {
    const health = await ctx.memory.healthCheck();
    const stats = await ctx.memory.stats().catch((e) => ({ tables: [], trace: { source: ctx.memory.name as "local" | "clickhouse", rows: 0, latencyMs: 0, sql: undefined }, error: (e as Error).message }));
    const recent = ctx.memory instanceof ClickHouseMemory ? ctx.memory.recentQueries.slice(0, 20) : [];
    return c.json({ ...info.memory, health, ...stats, recentQueries: recent });
  });
  app.get("/api/projects/:id/memory", async (c) => {
    const project = getProject(c.req.param("id"));
    const stats = await ctx.memory.stats(project.id);
    const analytics = ctx.memory instanceof ClickHouseMemory ? await ctx.memory.analytics(project.id) : null;
    const actions = await ctx.memory.agentActions(project.id, 30);
    const retrievals = ctx.repo.listEvents(project.id).filter((e) => e.type === "memory.retrieved").slice(-30).reverse();
    return c.json({ name: ctx.memory.name, persistent: ctx.memory.persistent, stats: stats.tables, trace: stats.trace, analytics, agentActions: actions, retrievals });
  });
  app.get("/api/projects/:id/memory/scene/:n", async (c) => {
    const project = getProject(c.req.param("id"));
    const n = Number(c.req.param("n"));
    const world = ctx.repo.getWorld(project.id);
    const screenplay = ctx.repo.getScreenplay(project.id);
    const scene = screenplay?.scenes.find((s) => s.number === n);
    const entityIds = scene ? [...scene.characterIds, ...scene.propIds] : undefined;
    const [state, knowledge, history] = await Promise.all([ctx.memory.stateBefore(project.id, n, entityIds), ctx.memory.knowledgeBefore(project.id, n), ctx.memory.violationHistory(project.id, scene ? { sceneId: scene.id } : {})]);
    const context = world && screenplay && scene ? retrieveSceneContext(world, screenplay, state.changes, scene.id) : null;
    return c.json({ sceneNumber: n, state, knowledge, history, context });
  });
  app.post("/api/memory/query", async (c) => {
    if (!(ctx.memory instanceof ClickHouseMemory)) return c.json({ error: "ClickHouse memory is not configured" }, 400);
    const body = z.object({ sql: z.string().min(1).max(4000) }).parse(await c.req.json());
    if (!/^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i.test(body.sql)) return c.json({ error: "Only read-only queries are allowed" }, 400);
    const { rows, trace } = await ctx.memory.select(body.sql, {}, "user query");
    return c.json({ rows: rows.slice(0, 500), trace });
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
