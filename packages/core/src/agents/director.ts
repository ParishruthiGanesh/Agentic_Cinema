import { z } from "zod";
import type { AgentContext } from "./context.js";
import { DIRECTOR_SYSTEM, directorPrompt } from "./prompts/director.js";
import { retrieveSceneContext, type SceneContext } from "../memory/worldMemory.js";
import { Shot, ShotPlan, type Project, type Screenplay, type StateChange, type WorldState } from "../model/index.js";

export const ShotOutput = z.object({
  index: z.number().int(),
  durationSec: z.number().positive(),
  framing: z.string(),
  cameraMovement: z.string(),
  characterIds: z.array(z.string()),
  propIds: z.array(z.string()),
  lighting: z.string(),
  action: z.string(),
  lineIndexes: z.array(z.number().int()),
  visualPromptDraft: z.string(),
  positionNotes: z.array(z.object({ characterId: z.string(), note: z.string() })),
});
export const ScenePlanOutput = z.object({ shots: z.array(ShotOutput) });
export type ScenePlanOutput = z.infer<typeof ScenePlanOutput>;

export function scenePlanSchemaFor(ctx: SceneContext) {
  const chars = new Set(ctx.scene.characterIds);
  const props = new Set(ctx.scene.propIds);
  const lineCount = ctx.scene.lines.length;
  return ScenePlanOutput.superRefine((out, zctx) => {
    const seen = new Set<number>();
    out.shots.forEach((s, si) => {
      s.characterIds.forEach((c) => !chars.has(c) && zctx.addIssue({ code: "custom", path: ["shots", si, "characterIds"], message: `"${c}" is not in this scene` }));
      s.propIds.forEach((p) => !props.has(p) && zctx.addIssue({ code: "custom", path: ["shots", si, "propIds"], message: `"${p}" is not in this scene` }));
      s.lineIndexes.forEach((li) => {
        if (li < 0 || li >= lineCount) zctx.addIssue({ code: "custom", path: ["shots", si, "lineIndexes"], message: `line index ${li} out of range (0..${lineCount - 1})` });
        if (seen.has(li)) zctx.addIssue({ code: "custom", path: ["shots", si, "lineIndexes"], message: `line index ${li} assigned to more than one shot` });
        seen.add(li);
      });
    });
    if (out.shots.length === 0) zctx.addIssue({ code: "custom", path: ["shots"], message: "at least one shot is required" });
  });
}

export interface ComposeOptions {
  /** When false (baseline evaluation), CineMemory state and constraints are NOT injected. */
  injectMemory: boolean;
  visualStyle: string;
}

/**
 * Deterministic prompt composer. This is where CineMemory's canonical state becomes part of every
 * generation request: identity, clothing, props held, location, time of day, style and explicit
 * visual constraints are appended verbatim so the Visual Critic can verify them.
 */
export function composeVisualPrompt(ctx: SceneContext, shot: z.infer<typeof ShotOutput>, opts: ComposeOptions): { prompt: string; negativePrompt: string; constraintIds: string[] } {
  const parts: string[] = [];
  parts.push(`${opts.visualStyle}.`);
  parts.push(shot.visualPromptDraft.trim());
  const constraintIds: string[] = [];
  if (opts.injectMemory) {
    for (const cid of shot.characterIds) {
      const snap = ctx.characters.find((c) => c.character.id === cid);
      if (!snap) continue;
      const ch = snap.character;
      const held = snap.inventory.map((pid) => ctx.props.find((p) => p.id === pid)?.name ?? pid);
      parts.push(`${ch.name}: ${ch.appearance.summary ?? ch.description}; wearing ${ch.clothing.summary ?? (ch.clothing.items.join(", ") || "as established")}${held.length ? `; carrying ${held.join(", ")}` : ""}; expression ${snap.emotional_state || ctx.scene.emotionalState}.`);
    }
    for (const pid of shot.propIds) {
      const p = ctx.props.find((x) => x.id === pid);
      if (p) parts.push(`${p.name}: ${p.visualSummary ?? p.description}.`);
    }
    if (ctx.location) parts.push(`Setting: ${ctx.location.visualSummary ?? ctx.location.description}, ${ctx.scene.timeOfDay}. Lighting: ${shot.lighting}.`);
    const relevant = ctx.visualConstraints.filter((v) => v.entityType === "style" || shot.characterIds.includes(v.entityId) || shot.propIds.includes(v.entityId) || v.entityId === ctx.scene.locationId);
    if (relevant.length) {
      parts.push(`Continuity requirements: ${relevant.map((v) => v.promptKeywords[0] ?? v.value).join("; ")}.`);
      constraintIds.push(...relevant.map((v) => v.id));
    }
    if (ctx.styleGuide) parts.push(`Style guide: ${ctx.styleGuide}`);
  } else {
    parts.push(`${ctx.scene.timeOfDay}. Lighting: ${shot.lighting}.`);
  }
  parts.push(`Camera: ${shot.framing}, ${shot.cameraMovement}. 16:9 cinematic frame, no text, no watermark.`);
  return { prompt: parts.join(" "), negativePrompt: "text, captions, watermark, logo, extra limbs, distorted faces, photorealistic gore", constraintIds };
}

export function buildShots(project: Project, ctx: SceneContext, out: ScenePlanOutput, opts: ComposeOptions, provenance: Shot["provenance"]): Shot[] {
  const scene = ctx.scene;
  const ordered = [...out.shots].sort((a, b) => a.index - b.index);
  const total = ordered.reduce((s, x) => s + x.durationSec, 0);
  const scale = total > 0 ? scene.durationSec / total : 1;
  return ordered.map((s, i) => {
    const { prompt, negativePrompt, constraintIds } = composeVisualPrompt(ctx, s, opts);
    const continuityIds = ctx.continuityConstraints.filter((c) => c.entities.some((e) => s.characterIds.includes(e) || s.propIds.includes(e))).map((c) => c.id);
    return Shot.parse({
      id: `shot_${scene.number}_${i + 1}`,
      sceneId: scene.id,
      sceneNumber: scene.number,
      index: i + 1,
      durationSec: Math.max(1, Math.round(s.durationSec * scale * 10) / 10),
      framing: s.framing,
      cameraMovement: s.cameraMovement,
      characterIds: s.characterIds,
      characterStates: s.characterIds.map((cid) => {
        const snap = ctx.characters.find((c) => c.character.id === cid);
        return {
          characterId: cid,
          appearance: snap?.character.appearance.summary ?? snap?.character.description ?? "",
          clothing: snap?.character.clothing.summary ?? snap?.character.clothing.items.join(", ") ?? "",
          emotionalState: snap?.emotional_state || scene.emotionalState,
          position: s.positionNotes.find((p) => p.characterId === cid)?.note,
          holding: snap?.inventory ?? [],
        };
      }),
      propIds: s.propIds,
      locationId: scene.locationId,
      lighting: s.lighting,
      timeOfDay: scene.timeOfDay,
      dialogue: s.lineIndexes
        .sort((a, b) => a - b)
        .map((li) => scene.lines[li])
        .filter((l) => l && l.type !== "action")
        .map((l) => ({ characterId: l.characterId, text: l.text, type: l.type as "dialogue" | "narration" })),
      action: s.action,
      visualPrompt: prompt,
      negativePrompt,
      inheritedConstraintIds: opts.injectMemory ? [...constraintIds, ...continuityIds] : [],
      status: "PLANNED",
      generationAttempts: 0,
      provenance,
    });
  });
}

export async function runDirector(ctx: AgentContext, project: Project, world: WorldState, screenplay: Screenplay, changes: StateChange[], opts: ComposeOptions = { injectMemory: true, visualStyle: project.brief.visualStyle }): Promise<ShotPlan> {
  const { events, llm, repo } = ctx;
  events.emit(project.id, "director", "shots.planning.started", `Planning shots for ${screenplay.scenes.length} scenes`, { provider: llm.name, injectMemory: opts.injectMemory });
  const shots: Shot[] = [];
  for (const scene of [...screenplay.scenes].sort((a, b) => a.number - b.number)) {
    const sceneCtx = retrieveSceneContext(world, screenplay, changes, scene.id);
    events.emit(project.id, "world_memory", "memory.retrieved", `Retrieved state for scene ${scene.number}: ${sceneCtx.characters.length} characters, ${sceneCtx.forbiddenFacts.length} forbidden facts, ${sceneCtx.visualConstraints.length} visual constraints`, { sceneId: scene.id });
    const result = await llm.generateStructured({
      task: "shot_planning",
      fixtureKey: `shot_planning:${scene.id}`,
      system: DIRECTOR_SYSTEM,
      prompt: directorPrompt(project, sceneCtx),
      schema: scenePlanSchemaFor(sceneCtx),
      temperature: 0.5,
    });
    const sceneShots = buildShots(project, sceneCtx, result.data, opts, result.provenance);
    shots.push(...sceneShots);
    events.emit(project.id, "director", "shots.scene.planned", `Scene ${scene.number} planned: ${sceneShots.length} shots`, { sceneId: scene.id, shotIds: sceneShots.map((s) => s.id), provenance: result.provenance });
  }
  const plan: ShotPlan = { projectId: project.id, shots, version: 1, updatedAt: new Date().toISOString() };
  repo.saveShotPlan(plan);
  events.emit(project.id, "director", "shots.planning.completed", `${shots.length} shots planned across ${screenplay.scenes.length} scenes`, {}, "success");
  return plan;
}
