import { CriticCollector, DETERMINISTIC, type CriticResult } from "./common.js";
import { characterStateAt, knowsFactAt } from "../memory/worldMemory.js";
import type { Screenplay, StateChange, WorldState } from "../model/index.js";
import { findPhrase, truncate } from "../util/text.js";

/**
 * Narrative Continuity Critic — deterministic checks over the screenplay and the World Memory change log.
 * Every violation carries the exact line, phrase and timeline evidence that triggered it.
 */
export function runNarrativeCritic(world: WorldState, screenplay: Screenplay, changes: StateChange[]): CriticResult {
  const started = new Date().toISOString();
  const col = new CriticCollector(world.projectId, "narrative", { ...DETERMINISTIC, task: "narrative_critic", createdAt: started });
  const scenes = [...screenplay.scenes].sort((a, b) => a.number - b.number);
  const sceneOf = (eventId: string) => scenes.find((s) => s.eventIds.includes(eventId));
  const name = (id: string) => world.characters.find((c) => c.id === id)?.name ?? id;

  /* 1. Knowledge timeline: nobody references a fact before learning it. */
  for (const scene of scenes) {
    for (const fact of world.knowledgeFacts) {
      if (fact.triggerPhrases.length === 0) continue;
      const restricted = scene.characterIds.filter((cid) => !knowsFactAt(world, changes, scene, cid, fact.id).knows);
      if (restricted.length === 0) continue; // everyone present already knows it — nothing to check
      const constraintId = world.continuityConstraints.find((c) => c.kind === "knowledge_order" && (c.params as { factId?: string }).factId === fact.id)?.id;
      let failed = false;
      scene.lines.forEach((line, lineIndex) => {
        if (line.type !== "dialogue" || !line.characterId) return;
        if (!restricted.includes(line.characterId)) return;
        // A reveal *within this scene* by another character before this line is legitimate; knowsFactAt already allows same-scene reveals.
        const phrase = findPhrase(line.text, fact.triggerPhrases);
        if (!phrase) return;
        failed = true;
        const learns = fact.holders.find((h) => h.characterId === line.characterId);
        const learnScene = learns ? scenes.find((s) => s.id === learns.acquiredInScene) : undefined;
        col.violation({
          code: "KNOWLEDGE_TIMELINE_VIOLATION",
          constraintId,
          constraint: `${name(line.characterId)} must not reference "${fact.statement}" before learning it`,
          expected: learnScene ? `${name(line.characterId)} learns this in Scene ${learnScene.number} (${learns?.via ?? "reveal"})` : `${name(line.characterId)} never learns this fact in the screenplay`,
          observed: `${name(line.characterId)} references it in Scene ${scene.number}, line ${lineIndex}: "${truncate(line.text, 140)}"`,
          severity: fact.isSecret ? "high" : "medium",
          confidence: 1,
          evidence: `Trigger phrase "${phrase}" matched in dialogue. Knowledge state at start of Scene ${scene.number}: ${name(line.characterId)} knows [${characterStateAt(world, changes, line.characterId, scene.number)?.knowledge.join(", ") || "nothing"}]. Fact holders: ${fact.holders.map((h) => `${name(h.characterId)}@${h.acquiredInScene}`).join(", ") || "none"}.`,
          scope: { sceneId: scene.id, sceneNumber: scene.number, lineIndex, entityIds: [line.characterId, fact.id] },
        });
      });
      if (!failed) col.pass(constraintId, `Scene ${scene.number}: no premature reference to "${fact.statement}" by ${restricted.map(name).join(", ")}`, { sceneId: scene.id, sceneNumber: scene.number, entityIds: [fact.id] }, "KNOWLEDGE_TIMELINE_VIOLATION");
    }
  }

  /* 2. Causal dependencies between events. */
  for (const ev of world.events) {
    const where = sceneOf(ev.id);
    if (!where) continue;
    for (const depId of ev.dependsOn) {
      const dep = world.events.find((e) => e.id === depId);
      const depScene = sceneOf(depId);
      const scope = { sceneId: where.id, sceneNumber: where.number, entityIds: [ev.id, depId] };
      const desc = `"${ev.name}" (Scene ${where.number}) depends on "${dep?.name ?? depId}"`;
      if (!depScene) {
        col.violation({
          code: "UNRESOLVED_DEPENDENCY",
          constraint: desc,
          expected: `"${dep?.name ?? depId}" happens in an earlier scene`,
          observed: `"${dep?.name ?? depId}" does not occur in any scene`,
          severity: dep?.importance === "essential" ? "high" : "medium",
          confidence: 1,
          evidence: `Event ${ev.id}.dependsOn includes ${depId}; no scene lists ${depId} in eventIds.`,
          scope,
        });
      } else if (depScene.number > where.number) {
        col.violation({
          code: "CAUSAL_DEPENDENCY_VIOLATION",
          constraint: desc,
          expected: `"${dep?.name ?? depId}" before Scene ${where.number}`,
          observed: `"${dep?.name ?? depId}" occurs in Scene ${depScene.number}, after its consequence`,
          severity: "high",
          confidence: 1,
          evidence: `Scene ${where.number}.eventIds contains ${ev.id}; Scene ${depScene.number}.eventIds contains ${depId}.`,
          scope,
        });
      } else {
        col.pass(undefined, desc, scope, "CAUSAL_DEPENDENCY_VIOLATION");
      }
    }
  }

  /* 3. Chronology of essential events (source order preserved). */
  const kept = world.events.filter((e) => e.importance === "essential" && sceneOf(e.id)).sort((a, b) => a.order - b.order);
  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1];
    const cur = kept[i];
    const ps = sceneOf(prev.id)!;
    const cs = sceneOf(cur.id)!;
    const scope = { sceneId: cs.id, sceneNumber: cs.number, entityIds: [prev.id, cur.id] };
    const desc = `Essential event order: "${prev.name}" before "${cur.name}"`;
    if (cs.number < ps.number) {
      col.violation({ code: "CHRONOLOGY_VIOLATION", constraint: desc, expected: `"${prev.name}" (source order ${prev.order}) before "${cur.name}" (source order ${cur.order})`, observed: `"${cur.name}" in Scene ${cs.number} precedes "${prev.name}" in Scene ${ps.number}`, severity: "medium", confidence: 1, evidence: `Source order ${prev.order} < ${cur.order} but scene order ${ps.number} > ${cs.number}.`, scope });
    } else col.pass(undefined, desc, scope, "CHRONOLOGY_VIOLATION");
  }

  /* 4. Prop possession: a prop in a scene must be with a present holder (or transferred in that scene). */
  for (const scene of scenes) {
    for (const pid of scene.propIds) {
      const prop = world.props.find((p) => p.id === pid);
      if (!prop) continue;
      const holders = world.characters.filter((c) => characterStateAt(world, changes, c.id, scene.number)?.inventory.includes(pid)).map((c) => c.id);
      const transferred = scene.propTransfers.some((t) => t.propId === pid);
      const scope = { sceneId: scene.id, sceneNumber: scene.number, entityIds: [pid, ...holders] };
      const desc = `Scene ${scene.number}: "${prop.name}" is with a present character`;
      if (holders.length && !holders.some((h) => scene.characterIds.includes(h)) && !transferred) {
        col.violation({ code: "PROP_POSSESSION_VIOLATION", constraint: desc, expected: `${holders.map(name).join(", ")} (current holder) present, or a prop transfer declared`, observed: `Holder absent; scene characters: ${scene.characterIds.map(name).join(", ")}`, severity: "medium", confidence: 1, evidence: `Inventory state before Scene ${scene.number}: ${holders.map((h) => `${name(h)} holds ${pid}`).join(", ")}.`, scope });
      } else col.pass(undefined, desc, scope, "PROP_POSSESSION_VIOLATION");
    }
    for (const t of scene.propTransfers) {
      if (!t.fromCharacterId) continue;
      const has = characterStateAt(world, changes, t.fromCharacterId, scene.number)?.inventory.includes(t.propId);
      const scope = { sceneId: scene.id, sceneNumber: scene.number, entityIds: [t.propId, t.fromCharacterId] };
      const desc = `Scene ${scene.number}: ${name(t.fromCharacterId)} can give "${t.propId}"`;
      if (!has) col.violation({ code: "PROP_POSSESSION_VIOLATION", constraint: desc, expected: `${name(t.fromCharacterId)} holds ${t.propId} before Scene ${scene.number}`, observed: `${name(t.fromCharacterId)} does not hold it`, severity: "medium", confidence: 1, evidence: `No inventory change gives ${t.propId} to ${t.fromCharacterId} before Scene ${scene.number}.`, scope });
      else col.pass(undefined, desc, scope, "PROP_POSSESSION_VIOLATION");
    }
  }

  /* 5. Location continuity for consecutive scenes when the world declares a location graph. */
  const hasGraph = world.locations.some((l) => l.connectedTo.length > 0);
  if (hasGraph) {
    for (let i = 1; i < scenes.length; i++) {
      const a = scenes[i - 1];
      const b = scenes[i];
      if (a.locationId === b.locationId) continue;
      const la = world.locations.find((l) => l.id === a.locationId);
      const lb = world.locations.find((l) => l.id === b.locationId);
      const connected = la?.connectedTo.includes(b.locationId) || lb?.connectedTo.includes(a.locationId);
      for (const cid of b.characterIds.filter((c) => a.characterIds.includes(c))) {
        const exit = a.exitLocations[cid];
        const scope = { sceneId: b.id, sceneNumber: b.number, entityIds: [cid, a.locationId, b.locationId] };
        const desc = `${name(cid)} moves ${la?.name ?? a.locationId} → ${lb?.name ?? b.locationId} between Scenes ${a.number}-${b.number}`;
        if (!connected && exit !== b.locationId) {
          col.violation({ code: "LOCATION_CONTINUITY_VIOLATION", constraint: desc, expected: `A connected location or a declared exit towards ${lb?.name ?? b.locationId}`, observed: `Locations are not connected and Scene ${a.number} declares no exit for ${name(cid)}`, severity: "low", confidence: 0.8, evidence: `${a.locationId}.connectedTo=[${la?.connectedTo.join(", ")}], ${b.locationId}.connectedTo=[${lb?.connectedTo.join(", ")}].`, scope });
        } else col.pass(undefined, desc, scope, "LOCATION_CONTINUITY_VIOLATION");
      }
    }
  }

  return col.result({ ...DETERMINISTIC, task: "narrative_critic", createdAt: started, latencyMs: Date.now() - Date.parse(started) });
}
