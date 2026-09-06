import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus, InMemoryDocumentStore, InstrumentedLLMProvider, LocalPartnerAdapter, LocalProductionMemory, PlaceholderMediaProvider, Repository, createDemoFixtureProvider, type AgentContext } from "@cinememory/core";
import { createApp } from "../src/app.js";
import { JobRunner } from "../src/jobs.js";
import type { RuntimeInfo } from "../src/context.js";

function makeApp() {
  const store = new InMemoryDocumentStore();
  const repo = new Repository(store);
  const partner = new LocalPartnerAdapter(store);
  const memory = new LocalProductionMemory(repo);
  const events = new EventBus(repo, partner);
  events.attachMemory(memory);
  const ctx: AgentContext = {
    repo,
    llm: new InstrumentedLLMProvider(createDemoFixtureProvider(), memory, events),
    media: new PlaceholderMediaProvider(),
    partner,
    memory,
    events,
    config: { repairMaxAttempts: 2, enableVideoGeneration: false, mediaDir: mkdtempSync(join(tmpdir(), "cm-api-")) },
  };
  const info: RuntimeInfo = { llm: { name: "fixture", model: "fixture", fixtureMode: true, supportsVision: false }, media: { name: "placeholder", capabilities: { image: true, video: false, speech: false } }, partner: "local", memory: { name: "local", persistent: false }, dataDir: "/tmp", videoEnabled: false, warnings: [] };
  const jobs = new JobRunner(ctx);
  return { app: createApp(ctx, info, jobs), ctx, jobs };
}

const waitIdle = async (jobs: JobRunner, id: string) => {
  for (let i = 0; i < 200 && jobs.current(id); i++) await new Promise((r) => setTimeout(r, 25));
};

describe("API", () => {
  it("reports health with fixture-mode flags", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llm.fixtureMode).toBe(true);
    expect(body.partnerHealth.ok).toBe(true);
  });

  it("creates the demo, runs the pipeline as a job, and exposes every artifact", async () => {
    const { app, jobs } = makeApp();
    const created = await app.request("/api/projects/demo", { method: "POST" });
    expect(created.status).toBe(201);
    const id = (await created.json()).project.id;
    const run = await app.request(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({ toStage: "film_assembled" }), headers: { "content-type": "application/json" } });
    expect(run.status).toBe(202);
    // A second job while one is running is rejected, not queued silently.
    const busy = await app.request(`/api/projects/${id}/run`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(busy.status).toBe(409);
    await waitIdle(jobs, id);
    const job = await (await app.request(`/api/projects/${id}/job`)).json();
    expect(job.current).toBeNull();
    expect(job.recent[0].status).toBe("complete");

    const summary = await (await app.request(`/api/projects/${id}`)).json();
    expect(summary.project.stage).toBe("film_assembled");
    expect(summary.counts.shots).toBeGreaterThan(10);
    expect(summary.counts.unresolved).toBe(0);
    expect(summary.continuity.narrative.passRate).toBe(1);

    for (const path of ["world", "screenplay", "shots", "violations", "checks", "continuity", "film", "graph", "changes", "adaptation"]) {
      const r = await app.request(`/api/projects/${id}/${path}`);
      expect(r.status, path).toBe(200);
      expect(await r.json()).not.toBeNull();
    }
    const graph = await (await app.request(`/api/projects/${id}/graph?focus=knowledge:fact_compass_points_to_light`)).json();
    expect(graph.nodes.length).toBeGreaterThan(3);
    const events = await (await app.request(`/api/projects/${id}/events`)).json();
    expect(events.map((e: { type: string }) => e.type)).toContain("repair.verified");
    const ctxRes = await (await app.request(`/api/projects/${id}/scenes/scene_4/context`)).json();
    expect(ctxRes.forbiddenFacts.length).toBeGreaterThan(0);

    // Media is served from the media directory.
    const shots = await (await app.request(`/api/projects/${id}/shots`)).json();
    const media = await app.request(`/media/${shots.shots[0].keyframe.path}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toContain("image/svg+xml");
    expect(await (await app.request(`/media/../etc/passwd`)).status).not.toBe(200);
  });

  it("supports manual override and repair of a violation", async () => {
    const { app, ctx, jobs } = makeApp();
    const id = (await (await app.request("/api/projects/demo", { method: "POST" })).json()).project.id;
    ctx.config.repairMaxAttempts = 0; // force escalation on the first pass
    await app.request(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({ toStage: "narrative_verified" }), headers: { "content-type": "application/json" } });
    await waitIdle(jobs, id);
    const violations = await (await app.request(`/api/projects/${id}/violations`)).json();
    const escalated = violations.filter((v: { status: string }) => v.status === "escalated");
    expect(escalated.length).toBe(2);
    const over = await app.request(`/api/projects/${id}/violations/${escalated[0].id}/override`, { method: "POST", body: JSON.stringify({ note: "director accepts" }), headers: { "content-type": "application/json" } });
    expect((await over.json()).status).toBe("overridden");
    ctx.config.repairMaxAttempts = 2;
    const rep = await app.request(`/api/projects/${id}/violations/${escalated[1].id}/repair`, { method: "POST" });
    expect(rep.status).toBe(202);
    await waitIdle(jobs, id);
    const after = await (await app.request(`/api/projects/${id}/violations`)).json();
    expect(after.find((v: { id: string }) => v.id === escalated[1].id).status).toBe("resolved");
  });

  it("validates project input and serves the OpenAPI document", async () => {
    const { app } = makeApp();
    const bad = await app.request("/api/projects", { method: "POST", body: JSON.stringify({ title: "" }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const spec = await (await app.request("/api/openapi.json")).json();
    expect(spec.openapi).toBe("3.0.3");
    expect(Object.keys(spec.paths)).toContain("/api/projects/{id}/run");
  });

  it("social story: demo, certificate gating, photo upload and approval", async () => {
    const { app, jobs } = makeApp();
    const created = await app.request("/api/projects/social-story-demo", { method: "POST" });
    expect(created.status).toBe(201);
    const id = (await created.json()).project.id;
    expect((await (await app.request(`/api/projects/${id}`)).json()).project.mode).toBe("social_story");
    // Uploading before analysis works for people named in the routine; strangers are refused.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const up = await app.request(`/api/projects/${id}/references/maya`, { method: "POST", body: JSON.stringify({ mimeType: "image/png", data: png, uploadedBy: "Mum" }), headers: { "content-type": "application/json" } });
    expect(up.status).toBe(201);
    expect((await up.json()).provenance.provider).toBe("upload");
    const bad = await app.request(`/api/projects/${id}/references/stranger`, { method: "POST", body: JSON.stringify({ mimeType: "image/png", data: png }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    await app.request(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({ toStage: "film_assembled" }), headers: { "content-type": "application/json" } });
    await waitIdle(jobs, id);
    const cert = await (await app.request(`/api/projects/${id}/certificate`)).json();
    expect(cert.status).toBe("incomplete");
    expect(cert.steps).toHaveLength(7);
    expect(cert.wordsUnchanged).toBe(true);
    const blocked = await app.request(`/api/projects/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy: "Therapist" }), headers: { "content-type": "application/json" } });
    expect(blocked.status).toBe(409);
    const forced = await app.request(`/api/projects/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy: "Therapist", note: "placeholder review", force: true }), headers: { "content-type": "application/json" } });
    expect(forced.status).toBe(200);
    expect((await (await app.request(`/api/projects/${id}`)).json()).project.approval.approvedBy).toBe("Therapist");
    const evalRes = await app.request(`/api/projects/${id}/evaluate`, { method: "POST" });
    expect(evalRes.status).toBe(400);
    const draft = await app.request("/api/social-stories/draft", { method: "POST", body: JSON.stringify({ situation: "haircut", childName: "Sam" }), headers: { "content-type": "application/json" } });
    expect(draft.status).toBe(503);
    const revoked = await app.request(`/api/projects/${id}/approve`, { method: "DELETE" });
    expect((await revoked.json()).approval).toBeUndefined();
  });
});
