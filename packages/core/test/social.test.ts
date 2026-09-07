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

describe("Plain-language critic, child profile, outcomes", () => {
  it("flags the things a therapist would flag and passes Maya's steps cleanly enough", async () => {
    const { checkPlainLanguage, checkStepText } = await import("../src/social/language.js");
    const r = checkStepText(1, "Ravi went to the shop and it was a piece of cake, wasn't it? The teacher said don't run.");
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toContain("first_person");
    expect(rules).toContain("past_tense");
    expect(rules).toContain("idiom");
    expect(rules).toContain("question");
    expect(rules).toContain("negative_phrasing");
    const maya = checkPlainLanguage(MAYA_SOCIAL_STORY);
    expect(maya.summary.medium).toBe(0);
    expect(maya.steps).toHaveLength(9);
  });

  it("builds every story from the same child profile and records outcomes into memory", async () => {
    const { briefFromChild, recordOutcome, revisionSeed, saveChildPhoto, applyChildReferences } = await import("../src/social/child.js");
    const { MAYA_CHILD_PROFILE } = await import("../src/demo/index.js");
    const ctx = makeTestContext();
    const project = ensureSocialStoryDemo(ctx);
    const child = ctx.repo.getChild("maya")!;
    expect(child.outfit).toBe(MAYA_SOCIAL_STORY.child.outfit);
    expect(project.childId).toBe("maya");
    // A second situation reuses identity, outfit, Bun and Mum without restating them.
    const haircut = briefFromChild(child, { situation: "getting a haircut", settings: [{ id: "salon", name: "Hair salon", description: "a bright salon with a big chair and a mirror" }], steps: [{ title: "The chair", text: "I sit in the big chair. I hold Bun.", settingId: "salon", companionIds: ["mum"], comfortItemIds: ["bun"] }] });
    expect(haircut.child.outfit).toBe(MAYA_CHILD_PROFILE.outfit);
    expect(haircut.comfortItems.map((c) => c.id)).toEqual(["bun"]);
    expect(haircut.companions.map((c) => c.id)).toEqual(["mum"]);
    expect(haircut.settings.map((s) => s.id)).toEqual(["hallway", "salon"]);
    expect(haircut.calmingRules.length).toBe(2);
    // Photos on the profile flow into every story as references.
    await saveChildPhoto(ctx, "maya", "maya", "character", { mimeType: "image/png", data: PNG_1x1 });
    await saveChildPhoto(ctx, "maya", "hallway", "location", { mimeType: "image/png", data: PNG_1x1 });
    await expect(saveChildPhoto(ctx, "maya", "nobody", "character", { mimeType: "image/png", data: PNG_1x1 })).rejects.toThrow(/not part of/);
    expect(await applyChildReferences(ctx, project)).toBe(2);
    expect(ctx.repo.store.get<{ provenance: { provider: string } }>("location_refs", project.id, "hallway")?.provenance.provider).toBe("upload");
    // Outcome after the real visit.
    const o = recordOutcome(ctx, project, { recordedBy: "Mum", timesWatched: 4, visitOutcome: "some_difficulty", stepNotes: [{ stepNumber: 5, reaction: "anxious", note: "the light was too bright" }] });
    expect(ctx.repo.listOutcomes(project.id)).toHaveLength(1);
    expect(ctx.repo.listEvents(project.id).some((e) => e.type === "social_story.outcome")).toBe(true);
    const seed = revisionSeed(ctx, project);
    expect(seed.notes[0]).toMatchObject({ stepNumber: 5, reaction: "anxious" });
    expect(seed.brief.steps).toHaveLength(7);
    void o;
  });
});

describe("Video path", () => {
  it("skips clips gracefully when the media provider cannot make video, and never renders placeholders", async () => {
    const { generateAllVideos } = await import("../src/media/generation.js");
    const ctx = makeTestContext();
    const project = ensureSocialStoryDemo(ctx);
    await runPipeline(ctx, project.id, { toStage: "film_assembled" });
    const r = await generateAllVideos(ctx, ctx.repo.getProject(project.id)!);
    expect(r.generated).toHaveLength(0);
    expect(r.failed).toHaveLength(7);
    expect(r.failed[0].error).toMatch(/no generated keyframe|cannot generate video/);
    // Placeholder cards are never rendered into an MP4.
    expect(ctx.repo.getFilm(project.id)?.renderedVideo).toBeUndefined();
    const types = ctx.repo.listEvents(project.id).map((e) => e.type);
    expect(types).toContain("video.summary");
  });
});
