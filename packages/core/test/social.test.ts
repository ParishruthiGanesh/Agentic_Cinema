import { describe, expect, it } from "vitest";
import { runPipeline, createProject } from "../src/workflow/orchestrator.js";
import { continuitySummary } from "../src/workflow/verification.js";
import { compileSocialStoryScreenplay, compileSocialStoryWorld, renderSocialStoryText, wordsUnchanged } from "../src/social/compile.js";
import { ApprovalBlockedError, approveSocialStory, buildContinuityCertificate } from "../src/social/certificate.js";
import { MAYA_DEMO_INPUT, MAYA_SOCIAL_STORY, ensureSocialStoryDemo } from "../src/demo/index.js";
import { saveUploadedReference } from "../src/media/generation.js";
import { CreateProjectInput } from "../src/model/index.js";
import { makeTestContext } from "./helpers.js";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("Social story compiler", () => {
  it("locks identity, outfit, settings, comfort items and the must-not-show list as constraints", () => {
    const project = { ...MAYA_DEMO_INPUT, id: "maya", stage: "created" as const, stages: [], isDemo: true, createdAt: "", updatedAt: "" };
    const world = compileSocialStoryWorld(project, MAYA_SOCIAL_STORY);
    expect(world.characters.map((c) => c.id)).toEqual(["maya", "mum", "dr_lee"]);
    expect(world.characters[0].clothing.summary).toBe(MAYA_SOCIAL_STORY.child.outfit);
    expect(world.props[0].initialOwner).toBe("maya");
    expect(world.events).toHaveLength(7);
    expect(world.events[3].dependsOn).toEqual(["step_3"]);
    expect(world.events.every((e) => e.importance === "essential")).toBe(true);
    const forbidden = world.visualConstraints.filter((v) => v.attribute.startsWith("must_not_show"));
    expect(forbidden).toHaveLength(4);
    expect(forbidden[0].promptKeywords[0]).toBe("no needles or syringes");
    expect(world.visualConstraints.find((v) => v.entityId === "maya" && v.attribute === "outfit")?.severity).toBe("critical");
    expect(world.locations.find((l) => l.id === "hallway")?.connectedTo).toContain("waiting_room");
    expect(world.sourceConstraints.filter((c) => c.kind === "required_event")).toHaveLength(7);
    expect(world.sourceConstraints.filter((c) => c.kind === "required_fact")).toHaveLength(2);
  });

  it("compiles the authored words verbatim, one scene per step, calming rules at the end", () => {
    const project = { ...MAYA_DEMO_INPUT, id: "maya", stage: "created" as const, stages: [], isDemo: true, createdAt: "", updatedAt: "" };
    const world = compileSocialStoryWorld(project, MAYA_SOCIAL_STORY);
    const sp = compileSocialStoryScreenplay(project, MAYA_SOCIAL_STORY, world);
    expect(sp.scenes).toHaveLength(7);
    expect(sp.scenes[1].lines.find((l) => l.type === "dialogue")?.text).toBe(MAYA_SOCIAL_STORY.steps[1].text);
    expect(sp.scenes[6].lines.filter((l) => l.type === "dialogue")).toHaveLength(3);
    expect(sp.provenance.provider).toBe("deterministic");
    expect(wordsUnchanged(MAYA_SOCIAL_STORY, sp)).toBe(true);
    expect(renderSocialStoryText(MAYA_SOCIAL_STORY)).toContain("1. Getting ready");
  });

  it("rejects a brief whose steps reference unknown settings or people", () => {
    const bad = structuredClone(MAYA_DEMO_INPUT);
    bad.socialStory!.steps[0].settingId = "moon";
    expect(() => CreateProjectInput.parse(bad)).toThrow(/unknown setting/);
    const noBrief = { ...MAYA_DEMO_INPUT, socialStory: undefined };
    expect(() => CreateProjectInput.parse(noBrief)).toThrow(/requires a socialStory/);
  });
});

describe("Social story pipeline (fixture mode, placeholder media)", () => {
  it("runs to film_assembled without any model call before media, verifies the sequence, and injects every lock into the prompts", async () => {
    const ctx = makeTestContext();
    const project = ensureSocialStoryDemo(ctx);
    const done = await runPipeline(ctx, project.id, { toStage: "film_assembled" });
    expect(done.stage).toBe("film_assembled");
    // No LLM was needed for the story path (words are authored, shots are deterministic).
    expect((ctx.llm as unknown as { history: unknown[] }).history).toHaveLength(0);
    const plan = ctx.repo.getShotPlan(project.id)!;
    expect(plan.shots).toHaveLength(7);
    for (const s of plan.shots) {
      expect(s.visualPrompt).toContain(MAYA_SOCIAL_STORY.child.outfit);
      expect(s.visualPrompt).toContain("no needles or syringes");
      expect(s.negativePrompt).toContain("dental drills");
      expect(s.cameraMovement).toBe("static");
    }
    const summary = continuitySummary(ctx, project.id);
    expect(summary.narrative.passRate).toBe(1);
    expect(summary.source.passRate).toBe(1);
    expect(summary.unresolved).toBe(0);
    // Prompt-level visual checks pass; media checks are not evaluated on placeholders and never counted as passes.
    expect(summary.visual.passRate).toBe(1);
    expect(summary.visual.notEvaluated).toBeGreaterThan(0);

    const cert = await buildContinuityCertificate(ctx, project.id);
    expect(cert.status).toBe("incomplete");
    expect(cert.wordsUnchanged).toBe(true);
    expect(cert.sequence.ordered).toBe(true);
    expect(cert.steps).toHaveLength(7);
    expect(cert.steps[0].categories.outfit.state).toBe("not_evaluated");
    expect(cert.reasons.join(" ")).toMatch(/placeholders/);
    await expect(approveSocialStory(ctx, project.id, { approvedBy: "Therapist" })).rejects.toBeInstanceOf(ApprovalBlockedError);
    const forced = await approveSocialStory(ctx, project.id, { approvedBy: "Therapist", note: "reviewed placeholders only", force: true });
    expect(forced.project.approval?.approvedBy).toBe("Therapist");
    expect(forced.certificate.approvalValid).toBe(false);
    expect(ctx.repo.listEvents(project.id).some((e) => e.type === "social_story.approved")).toBe(true);
  });

  it("stores an uploaded photo as the identity reference and refuses unknown people", async () => {
    const ctx = makeTestContext();
    const project = ensureSocialStoryDemo(ctx);
    const ref = await saveUploadedReference(ctx, project, "maya", { mimeType: "image/png", data: PNG_1x1 }, "Mum");
    expect(ref.provenance.provider).toBe("upload");
    expect(ctx.repo.store.get("character_refs", project.id, "maya")).toMatchObject({ characterId: "maya" });
    await expect(saveUploadedReference(ctx, project, "stranger", { mimeType: "image/png", data: PNG_1x1 })).rejects.toThrow(/not part of this project/);
    await expect(saveUploadedReference(ctx, project, "mum", { mimeType: "image/gif", data: PNG_1x1 })).rejects.toThrow(/Unsupported/);
    await runPipeline(ctx, project.id, { toStage: "media_generated" });
    // The uploaded reference survives generation (it is never overwritten by a generated sheet).
    expect(ctx.repo.store.get<{ provenance: { provider: string } }>("character_refs", project.id, "maya")?.provenance.provider).toBe("upload");
    const cert = await buildContinuityCertificate(ctx, project.id);
    expect(cert.media.references.find((r) => r.characterId === "maya")?.provider).toBe("upload");
  });

  it("a creator project is unaffected by the social-story path", async () => {
    const ctx = makeTestContext();
    const p = createProject(ctx, { title: "Plain", mode: "creator", source: { kind: "original", title: "x", text: "Once." }, brief: { genre: "drama", audience: "adults", targetDurationSec: 60, language: "English", visualStyle: "noir", format: "short", requiredFacts: [] } });
    expect(p.socialStory).toBeUndefined();
    await expect(buildContinuityCertificate(ctx, p.id)).rejects.toThrow(/social-story projects only/);
  });
});
