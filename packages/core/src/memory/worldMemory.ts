import type {
  Character,
  ContinuityConstraint,
  KnowledgeFact,
  Location,
  Prop,
  Scene,
  Screenplay,
  SourceConstraint,
  StateChange,
  VisualConstraint,
  WorldState,
} from "../model/index.js";

/**
 * World Memory — deterministic state tracking over the screenplay timeline.
 *
 * The canonical world (characters, props, facts, constraints) comes from the Source Intelligence
 * Agent. The screenplay declares what changes in each scene (reveals, transfers, moves, emotions).
 * This module folds those declarations into a change log so any agent or critic can ask:
 * "what does character X know / hold / feel at the start of scene N?" without re-reading the script.
 */

export const START_SCENE = "start";

export interface CharacterSnapshot {
  character: Character;
  /** State as of the START of the requested scene. */
  current_location: string;
  emotional_state: string;
  knowledge: string[];
  inventory: string[];
}

export interface SceneContext {
  scene: Scene;
  location?: Location;
  characters: CharacterSnapshot[];
  props: Prop[];
  /** Facts at least one present character knows at scene start. */
  knownFacts: Array<{ fact: KnowledgeFact; knownBy: string[] }>;
  /** Facts that exist in the world but that some present characters must NOT reference yet. */
  forbiddenFacts: Array<{ fact: KnowledgeFact; unknownTo: string[]; knownBy: string[] }>;
  visualConstraints: VisualConstraint[];
  continuityConstraints: ContinuityConstraint[];
  sourceConstraints: SourceConstraint[];
  previousScenes: Array<{ id: string; number: number; title: string; objective: string }>;
  styleGuide?: string;
}

function sceneOrder(screenplay: Screenplay): Scene[] {
  return [...screenplay.scenes].sort((a, b) => a.number - b.number);
}

/** Holders known from the source ("start") — i.e. before any scene. */
export function initialKnowledge(world: WorldState, characterId: string): string[] {
  const facts = new Set<string>();
  for (const f of world.knowledgeFacts) {
    if (f.holders.some((h) => h.characterId === characterId && h.acquiredInScene === START_SCENE)) facts.add(f.id);
  }
  const ch = world.characters.find((c) => c.id === characterId);
  for (const k of ch?.knowledge ?? []) facts.add(k);
  return [...facts];
}

export function initialInventory(world: WorldState, characterId: string): string[] {
  const inv = new Set<string>();
  const ch = world.characters.find((c) => c.id === characterId);
  for (const p of ch?.inventory ?? []) inv.add(p);
  for (const p of world.props) if (p.initialOwner === characterId) inv.add(p.id);
  return [...inv];
}

/**
 * Walk the screenplay and produce the change log. Pure function: same inputs → same changes.
 * Also returns the world with knowledge-fact holders and scene appearances rebuilt from the screenplay.
 */
export function foldScreenplay(world: WorldState, screenplay: Screenplay): { changes: StateChange[]; world: WorldState } {
  const changes: StateChange[] = [];
  const now = new Date().toISOString();
  const scenes = sceneOrder(screenplay);

  const loc: Record<string, string> = {};
  const emo: Record<string, string> = {};
  const know: Record<string, Set<string>> = {};
  const inv: Record<string, Set<string>> = {};
  const appearances: Record<string, string[]> = {};
  const holders: Record<string, Array<{ characterId: string; acquiredInScene: string; via?: string }>> = {};

  for (const c of world.characters) {
    loc[c.id] = c.current_location ?? "";
    emo[c.id] = c.emotional_state ?? "";
    know[c.id] = new Set(initialKnowledge(world, c.id));
    inv[c.id] = new Set(initialInventory(world, c.id));
    appearances[c.id] = [];
  }
  for (const f of world.knowledgeFacts) {
    holders[f.id] = f.holders.filter((h) => h.acquiredInScene === START_SCENE).map((h) => ({ ...h }));
  }

  let n = 0;
  const push = (scene: Scene, entityType: StateChange["entityType"], entityId: string, field: string, before: unknown, after: unknown, reason: string) => {
    n += 1;
    changes.push({
      id: `chg_${scene.number.toString().padStart(3, "0")}_${n.toString().padStart(4, "0")}`,
      projectId: world.projectId,
      sceneId: scene.id,
      sceneNumber: scene.number,
      entityType,
      entityId,
      field,
      before,
      after,
      reason,
      createdAt: now,
    });
  };

  for (const scene of scenes) {
    for (const cid of scene.characterIds) {
      if (!(cid in loc)) continue; // unknown character ids are reported by critics, not here
      appearances[cid].push(scene.id);
      if (loc[cid] !== scene.locationId) {
        push(scene, "character", cid, "current_location", loc[cid], scene.locationId, `present in scene ${scene.number} at ${scene.locationId}`);
        loc[cid] = scene.locationId;
      }
    }
    for (const r of scene.knowledgeReveals) {
      if (!(r.toCharacterId in know)) continue;
      if (!know[r.toCharacterId].has(r.factId)) {
        const before = [...know[r.toCharacterId]];
        know[r.toCharacterId].add(r.factId);
        push(scene, "character", r.toCharacterId, "knowledge", before, [...know[r.toCharacterId]], `learns ${r.factId} via ${r.via}`);
        holders[r.factId] = holders[r.factId] ?? [];
        holders[r.factId].push({ characterId: r.toCharacterId, acquiredInScene: scene.id, via: r.via });
      }
    }
    for (const t of scene.propTransfers) {
      if (t.fromCharacterId && inv[t.fromCharacterId]?.has(t.propId)) {
        const before = [...inv[t.fromCharacterId]];
        inv[t.fromCharacterId].delete(t.propId);
        push(scene, "character", t.fromCharacterId, "inventory", before, [...inv[t.fromCharacterId]], `gives up ${t.propId}: ${t.how}`);
      }
      if (t.toCharacterId && t.toCharacterId in inv && !inv[t.toCharacterId].has(t.propId)) {
        const before = [...inv[t.toCharacterId]];
        inv[t.toCharacterId].add(t.propId);
        push(scene, "character", t.toCharacterId, "inventory", before, [...inv[t.toCharacterId]], `acquires ${t.propId}: ${t.how}`);
      }
    }
    for (const [cid, e] of Object.entries(scene.endEmotions)) {
      if (!(cid in emo) || emo[cid] === e) continue;
      push(scene, "character", cid, "emotional_state", emo[cid], e, `end of scene ${scene.number}`);
      emo[cid] = e;
    }
    for (const [cid, l] of Object.entries(scene.exitLocations)) {
      if (!(cid in loc) || loc[cid] === l) continue;
      push(scene, "character", cid, "current_location", loc[cid], l, `exits scene ${scene.number} towards ${l}`);
      loc[cid] = l;
    }
  }

  const rebuilt: WorldState = {
    ...world,
    characters: world.characters.map((c) => ({ ...c, scene_appearances: appearances[c.id] ?? [] })),
    knowledgeFacts: world.knowledgeFacts.map((f) => ({ ...f, holders: holders[f.id] ?? [] })),
    version: world.version + 1,
    updatedAt: now,
  };
  return { changes, world: rebuilt };
}

/** Character state at the START of scene `sceneNumber` (changes from earlier scenes applied). */
export function characterStateAt(world: WorldState, changes: StateChange[], characterId: string, sceneNumber: number): CharacterSnapshot | undefined {
  const character = world.characters.find((c) => c.id === characterId);
  if (!character) return undefined;
  const snap: CharacterSnapshot = {
    character,
    current_location: character.current_location ?? "",
    emotional_state: character.emotional_state ?? "",
    knowledge: initialKnowledge(world, characterId),
    inventory: initialInventory(world, characterId),
  };
  for (const ch of changes) {
    if (ch.entityType !== "character" || ch.entityId !== characterId || ch.sceneNumber >= sceneNumber) continue;
    if (ch.field === "current_location") snap.current_location = String(ch.after);
    else if (ch.field === "emotional_state") snap.emotional_state = String(ch.after);
    else if (ch.field === "knowledge") snap.knowledge = [...(ch.after as string[])];
    else if (ch.field === "inventory") snap.inventory = [...(ch.after as string[])];
  }
  return snap;
}

/** Does `characterId` know `factId` at the start of scene `sceneNumber`, or acquire it during that scene? */
export function knowsFactAt(
  world: WorldState,
  changes: StateChange[],
  scene: Scene,
  characterId: string,
  factId: string,
): { knows: boolean; since?: string } {
  const snap = characterStateAt(world, changes, characterId, scene.number);
  if (snap?.knowledge.includes(factId)) {
    const change = changes.find((c) => c.entityId === characterId && c.field === "knowledge" && (c.after as string[]).includes(factId));
    return { knows: true, since: change ? change.sceneId : START_SCENE };
  }
  if (scene.knowledgeReveals.some((r) => r.factId === factId && r.toCharacterId === characterId)) return { knows: true, since: scene.id };
  return { knows: false };
}

/**
 * Retrieval: build the compact, scene-specific context that agents receive instead of the full
 * screenplay. This is what keeps prompts small and keeps generation anchored to CineMemory.
 */
export function retrieveSceneContext(world: WorldState, screenplay: Screenplay, changes: StateChange[], sceneId: string): SceneContext {
  const scene = screenplay.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found`);
  const present = scene.characterIds;
  const characters = present
    .map((cid) => characterStateAt(world, changes, cid, scene.number))
    .filter((c): c is CharacterSnapshot => !!c);

  const knownFacts: SceneContext["knownFacts"] = [];
  const forbiddenFacts: SceneContext["forbiddenFacts"] = [];
  for (const fact of world.knowledgeFacts) {
    const knownBy = characters.filter((c) => c.knowledge.includes(fact.id)).map((c) => c.character.id);
    const unknownTo = characters.filter((c) => !c.knowledge.includes(fact.id)).map((c) => c.character.id);
    const anyHolder = fact.holders.length > 0 || knownBy.length > 0;
    if (knownBy.length) knownFacts.push({ fact, knownBy });
    if (anyHolder && unknownTo.length) forbiddenFacts.push({ fact, unknownTo, knownBy });
  }

  const entityIds = new Set<string>([...present, ...scene.propIds, scene.locationId]);
  const visualConstraints = world.visualConstraints.filter((v) => v.entityType === "style" || entityIds.has(v.entityId));
  const continuityConstraints = world.continuityConstraints.filter((c) => c.entities.length === 0 || c.entities.some((e) => entityIds.has(e)));
  const sourceConstraints = world.sourceConstraints.filter(
    (s) =>
      scene.satisfiesConstraints.includes(s.id) ||
      s.importance === "must_keep" ||
      s.relatedEntities.some((e) => entityIds.has(e)),
  );
  const previousScenes = sceneOrder(screenplay)
    .filter((s) => s.number < scene.number)
    .slice(-2)
    .map((s) => ({ id: s.id, number: s.number, title: s.title, objective: s.objective }));

  return {
    scene,
    location: world.locations.find((l) => l.id === scene.locationId),
    characters,
    props: world.props.filter((p) => scene.propIds.includes(p.id)),
    knownFacts,
    forbiddenFacts,
    visualConstraints,
    continuityConstraints,
    sourceConstraints,
    previousScenes,
    styleGuide: world.styleGuide,
  };
}

/** Render a scene context as compact text for an LLM prompt. Deterministic and small. */
export function renderSceneContext(ctx: SceneContext): string {
  const lines: string[] = [];
  lines.push(`SCENE ${ctx.scene.number} "${ctx.scene.title}" — location: ${ctx.location?.name ?? ctx.scene.locationId} (${ctx.scene.timeOfDay})`);
  if (ctx.location?.visualSummary) lines.push(`Location look: ${ctx.location.visualSummary}`);
  lines.push(`Objective: ${ctx.scene.objective}; emotional state: ${ctx.scene.emotionalState}`);
  for (const c of ctx.characters) {
    const ch = c.character;
    lines.push(
      `CHARACTER ${ch.name} (${ch.id}): ${ch.appearance.summary ?? ch.description}; clothing: ${ch.clothing.summary ?? (ch.clothing.items.join(", ") || "n/a")}; ` +
        `mood at scene start: ${c.emotional_state || "unspecified"}; holding: ${c.inventory.join(", ") || "nothing"}; knows: ${c.knowledge.join(", ") || "nothing special"}`,
    );
  }
  for (const p of ctx.props) lines.push(`PROP ${p.name} (${p.id}): ${p.visualSummary ?? p.description}`);
  for (const f of ctx.forbiddenFacts) {
    lines.push(`MUST NOT REFERENCE: "${f.fact.statement}" — unknown to ${f.unknownTo.join(", ")}${f.knownBy.length ? ` (known only to ${f.knownBy.join(", ")})` : ""}`);
  }
  for (const v of ctx.visualConstraints) lines.push(`VISUAL CONSTRAINT [${v.id}] ${v.entityId}.${v.attribute} = ${v.value}`);
  for (const c of ctx.continuityConstraints) lines.push(`CONTINUITY CONSTRAINT [${c.id}] ${c.statement}`);
  for (const s of ctx.sourceConstraints) lines.push(`SOURCE CONSTRAINT [${s.id}] (${s.importance}) ${s.statement}`);
  if (ctx.previousScenes.length) lines.push(`Previously: ${ctx.previousScenes.map((p) => `S${p.number} ${p.title}: ${p.objective}`).join(" | ")}`);
  if (ctx.styleGuide) lines.push(`STYLE: ${ctx.styleGuide}`);
  return lines.join("\n");
}
