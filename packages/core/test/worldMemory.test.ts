import { describe, expect, it } from "vitest";
import { characterStateAt, foldScreenplay, knowsFactAt, retrieveSceneContext, renderSceneContext } from "../src/memory/worldMemory.js";
import { buildCineGraph, neighborhood } from "../src/graph/cineGraph.js";
import { demoArtifacts } from "./helpers.js";

describe("World Memory", () => {
  const { world, screenplay } = demoArtifacts();
  const { changes, world: folded } = foldScreenplay(world, screenplay);

  it("records knowledge acquisition per scene", () => {
    const fact = folded.knowledgeFacts.find((f) => f.id === "fact_compass_points_to_light")!;
    expect(fact.holders.map((h) => `${h.characterId}@${h.acquiredInScene}`)).toEqual(["lumi@scene_3", "milo@scene_5"]);
    expect(fact.holders.some((h) => h.characterId === "pip")).toBe(false);
  });

  it("answers 'who knows what at scene N' from the change log", () => {
    const s3 = screenplay.scenes[2];
    const s4 = screenplay.scenes[3];
    const s5 = screenplay.scenes[4];
    expect(knowsFactAt(folded, changes, s3, "lumi", "fact_compass_points_to_light").knows).toBe(true); // same-scene reveal
    expect(knowsFactAt(folded, changes, s4, "lumi", "fact_compass_points_to_light")).toEqual({ knows: true, since: "scene_3" });
    expect(knowsFactAt(folded, changes, s4, "milo", "fact_compass_points_to_light").knows).toBe(false);
    expect(knowsFactAt(folded, changes, s5, "milo", "fact_compass_points_to_light").knows).toBe(true);
  });

  it("tracks prop possession through transfers", () => {
    expect(characterStateAt(folded, changes, "milo", 1)!.inventory).toEqual(["broken_compass"]);
    expect(characterStateAt(folded, changes, "milo", 2)!.inventory).toEqual([]);
    expect(characterStateAt(folded, changes, "lumi", 4)!.inventory).toEqual(["broken_compass"]);
    expect(characterStateAt(folded, changes, "milo", 6)!.inventory).toEqual(["broken_compass"]);
    expect(characterStateAt(folded, changes, "lumi", 6)!.inventory).toEqual([]);
  });

  it("tracks location and emotional state over time", () => {
    expect(characterStateAt(folded, changes, "pip", 3)!.current_location).toBe("old_stump");
    expect(characterStateAt(folded, changes, "lumi", 2)!.emotional_state).toBe("afraid");
    expect(characterStateAt(folded, changes, "lumi", 4)!.emotional_state).toBe("brave");
  });

  it("retrieves a scene-scoped context with forbidden facts instead of the whole screenplay", () => {
    const ctx = retrieveSceneContext(folded, screenplay, changes, "scene_4");
    expect(ctx.characters.map((c) => c.character.id)).toEqual(["lumi", "milo"]);
    expect(ctx.forbiddenFacts).toHaveLength(1);
    expect(ctx.forbiddenFacts[0].unknownTo).toEqual(["milo"]);
    expect(ctx.forbiddenFacts[0].knownBy).toEqual(["lumi"]);
    expect(ctx.visualConstraints.map((v) => v.entityId)).toEqual(expect.arrayContaining(["lumi", "milo", "broken_compass", "style"]));
    expect(ctx.previousScenes.map((p) => p.number)).toEqual([2, 3]);
    const text = renderSceneContext(ctx);
    expect(text).toContain("MUST NOT REFERENCE");
    expect(text.length).toBeLessThan(JSON.stringify(screenplay).length / 2);
  });

  it("is deterministic", () => {
    const again = foldScreenplay(world, screenplay);
    expect(again.changes.map((c) => [c.sceneId, c.entityId, c.field, c.after])).toEqual(changes.map((c) => [c.sceneId, c.entityId, c.field, c.after]));
  });
});

describe("CineGraph", () => {
  const { world, screenplay } = demoArtifacts();
  const { world: folded } = foldScreenplay(world, screenplay);
  const graph = buildCineGraph(folded, screenplay);

  it("connects characters, scenes, events, props, locations, knowledge and constraints", () => {
    expect(graph.stats.character).toBe(3);
    expect(graph.stats.scene).toBe(6);
    expect(graph.stats.knowledge).toBe(1);
    expect(graph.stats.constraint).toBeGreaterThan(5);
    const knows = graph.edges.filter((e) => e.type === "knows");
    expect(knows.map((e) => `${e.source}:${e.label}`)).toEqual(["character:lumi:Scene 3", "character:milo:Scene 5"]);
    expect(graph.edges.some((e) => e.type === "unknown_to" && e.source === "character:pip")).toBe(true);
  });

  it("supports neighbourhood inspection", () => {
    const n = neighborhood(graph, "knowledge:fact_compass_points_to_light", 1);
    expect(n.nodes.map((x) => x.id)).toEqual(expect.arrayContaining(["character:lumi", "character:milo", "character:pip", "scene:scene_3", "scene:scene_5"]));
  });
});
