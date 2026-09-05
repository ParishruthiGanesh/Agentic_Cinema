import { describe, expect, it } from "vitest";
import { runNarrativeCritic } from "../src/critics/narrative.js";
import { runSourceFidelityCritic } from "../src/critics/sourceFidelity.js";
import { runVisualCritic } from "../src/critics/visual.js";
import { foldScreenplay, retrieveSceneContext } from "../src/memory/worldMemory.js";
import { buildShots } from "../src/agents/director.js";
import { DEMO_FIXTURES } from "../src/demo/index.js";
import { demoArtifacts } from "./helpers.js";
import type { Screenplay, ShotPlan } from "../src/model/index.js";

describe("Narrative Continuity Critic", () => {
  const { world, screenplay } = demoArtifacts();
  const { changes, world: folded } = foldScreenplay(world, screenplay);

  it("flags a character referencing a secret before learning it, with evidence", () => {
    const result = runNarrativeCritic(folded, screenplay, changes);
    const kv = result.violations.filter((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION");
    expect(kv).toHaveLength(1);
    expect(kv[0].scope).toMatchObject({ sceneId: "scene_4", sceneNumber: 4, lineIndex: 2 });
    expect(kv[0].expected).toContain("Scene 5");
    expect(kv[0].evidence).toMatch(/Trigger phrase "(follows the light|needle follows)"/);
    expect(kv[0].confidence).toBe(1);
    expect(kv[0].provenance.provider).toBe("deterministic");
    expect(result.checks.some((c) => c.outcome === "pass" && c.code === "KNOWLEDGE_TIMELINE_VIOLATION")).toBe(true);
  });

  it("does not flag the line once it is rewritten", () => {
    const fixed: Screenplay = structuredClone(screenplay);
    fixed.scenes[3].lines[2].text = "Lumi! You came! Is that your glow?";
    const refolded = foldScreenplay(world, fixed);
    const result = runNarrativeCritic(refolded.world, fixed, refolded.changes);
    expect(result.violations.filter((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION")).toHaveLength(0);
  });

  it("flags causal dependency and chronology breaks", () => {
    const broken: Screenplay = structuredClone(screenplay);
    // Move the "secret shared" event before "secret discovered".
    broken.scenes[1].eventIds = ["ev_friends_lost", "ev_secret_shared"];
    broken.scenes[4].eventIds = [];
    const r = foldScreenplay(world, broken);
    const result = runNarrativeCritic(r.world, broken, r.changes);
    expect(result.violations.map((v) => v.code)).toEqual(expect.arrayContaining(["CAUSAL_DEPENDENCY_VIOLATION", "CHRONOLOGY_VIOLATION"]));
  });

  it("flags a prop used by a character who does not hold it", () => {
    const broken: Screenplay = structuredClone(screenplay);
    broken.scenes[4].propTransfers = [{ propId: "broken_compass", fromCharacterId: "milo", toCharacterId: "lumi", how: "wrong direction" }];
    const r = foldScreenplay(world, broken);
    const result = runNarrativeCritic(r.world, broken, r.changes);
    expect(result.violations.some((v) => v.code === "PROP_POSSESSION_VIOLATION" && v.scope.sceneId === "scene_5")).toBe(true);
  });

  it("flags unconnected location jumps without a declared exit", () => {
    const broken: Screenplay = structuredClone(screenplay);
    broken.scenes[0].exitLocations = {};
    const r = foldScreenplay(world, broken);
    const result = runNarrativeCritic(r.world, broken, r.changes);
    expect(result.violations.some((v) => v.code === "LOCATION_CONTINUITY_VIOLATION")).toBe(true);
  });
});

describe("Source Fidelity Critic", () => {
  const { world, screenplay } = demoArtifacts();

  it("flags a missing required educational fact and passes present constraints", async () => {
    const result = await runSourceFidelityCritic(world, screenplay, undefined);
    const missing = result.violations.filter((v) => v.code === "REQUIRED_FACT_MISSING");
    expect(missing).toHaveLength(1);
    expect(missing[0].constraintId).toBe("edu_bioluminescence");
    expect(missing[0].severity).toBe("high");
    expect(result.checks.find((c) => c.constraintId === "sc_guided_home")?.outcome).toBe("pass");
    expect(result.checks.find((c) => c.constraintId === "sc_secret_order")?.outcome).toBe("pass");
    expect(result.checks.find((c) => c.constraintId === "sc_lumi_fear_arc")?.outcome).toBe("pass");
  });

  it("passes once the fact is present in narration", async () => {
    const fixed: Screenplay = structuredClone(screenplay);
    fixed.scenes[5].lines.push({ type: "narration", text: "Fireflies make their own light. It is called bioluminescence." });
    const result = await runSourceFidelityCritic(world, fixed, undefined);
    expect(result.violations.filter((v) => v.code === "REQUIRED_FACT_MISSING")).toHaveLength(0);
  });

  it("flags a required event that was cut", async () => {
    const cut: Screenplay = structuredClone(screenplay);
    cut.scenes[5].eventIds = [];
    const result = await runSourceFidelityCritic(world, cut, undefined);
    expect(result.violations.some((v) => v.code === "REQUIRED_EVENT_MISSING" && v.constraintId === "sc_guided_home")).toBe(true);
  });
});

describe("Visual Continuity Critic (prompt level)", () => {
  const { project, world, screenplay } = demoArtifacts();
  const { changes, world: folded } = foldScreenplay(world, screenplay);
  const prov = { provider: "fixture", task: "shot_planning", createdAt: new Date().toISOString() };

  function plan(injectMemory: boolean): ShotPlan {
    const shots = screenplay.scenes.flatMap((s) => buildShots(project, retrieveSceneContext(folded, screenplay, changes, s.id), DEMO_FIXTURES.SHOT_PLANS[s.id], { injectMemory, visualStyle: project.brief.visualStyle }, prov));
    return { projectId: project.id, shots, version: 1, updatedAt: new Date().toISOString() };
  }

  it("finds constraints missing from prompts when memory is not injected (baseline)", async () => {
    const result = await runVisualCritic(folded, plan(false), { mediaDir: "/nonexistent", promptOnly: true });
    expect(result.violations.filter((v) => v.code === "PROMPT_MISSING_CONSTRAINT").length).toBeGreaterThan(3);
  });

  it("passes every prompt-level constraint when CineMemory composes the prompt", async () => {
    const result = await runVisualCritic(folded, plan(true), { mediaDir: "/nonexistent", promptOnly: true });
    expect(result.violations).toHaveLength(0);
    expect(result.checks.filter((c) => c.outcome === "pass").length).toBeGreaterThan(20);
  });

  it("records media checks as not_evaluated when there is no keyframe", async () => {
    const result = await runVisualCritic(folded, plan(true), { mediaDir: "/nonexistent" });
    expect(result.checks.filter((c) => c.outcome === "not_evaluated").length).toBeGreaterThan(0);
  });
});
