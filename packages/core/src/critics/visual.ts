import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lastFrame, resolveFfmpeg } from "../media/ffmpeg.js";
import { CriticCollector, DETERMINISTIC, type CriticResult } from "./common.js";
import type { LLMProvider } from "../llm/provider.js";
import type { Shot, ShotPlan, VisualConstraint, WorldState } from "../model/index.js";
import { findPhrase, containsPhrase, truncate } from "../util/text.js";

const InspectionOutput = z.object({
  observations: z.array(
    z.object({
      constraintId: z.string(),
      expected: z.string(),
      observed: z.string(),
      satisfied: z.boolean(),
      confidence: z.number().min(0).max(1),
      /** What in the image supports the verdict (colors, shapes, positions). */
      evidence: z.string(),
    }),
  ),
  overallDescription: z.string(),
});

const INSPECT_SYSTEM = `You are the Visual Continuity Critic of CineMemory. You inspect a generated keyframe against the expected canonical state
of the shot. For EACH listed constraint, report what you actually observe in the image and whether it is satisfied. Be literal and
specific (colors, items, counts, position). If the element is not visible, say so and mark unsatisfied with your confidence.
Do not assume anything not visible.
Constraints whose attribute starts with "must_not_show" are ABSENCE constraints: they are satisfied only when nothing of that kind is
visible anywhere in the frame; if you see it, mark unsatisfied and describe exactly where.`;

export interface VisualCriticOptions {
  mediaDir: string;
  llm?: LLMProvider;
  /** Skip media-level inspection (prompt-level checks only). */
  promptOnly?: boolean;
}

function relevantConstraints(world: WorldState, shot: Shot): VisualConstraint[] {
  return world.visualConstraints.filter((v) => v.entityType === "style" || shot.characterIds.includes(v.entityId) || shot.propIds.includes(v.entityId) || v.entityId === shot.locationId);
}

const CODE_FOR_ATTRIBUTE = (attr: string, entityType: VisualConstraint["entityType"]) => {
  const a = attr.toLowerCase();
  if (a.startsWith("must_not_show")) return "FORBIDDEN_CONTENT" as const;
  if (entityType === "prop") return "PROP_MISSING" as const;
  if (entityType === "location") return "LOCATION_MISMATCH" as const;
  if (entityType === "style") return "STYLE_MISMATCH" as const;
  if (/cloth|scarf|hat|satchel|shirt|dress|wear|outfit|jacket|coat|shoe|glove|bag/.test(a)) return "CLOTHING_MISMATCH" as const;
  if (/colou?r|glow|hue/.test(a)) return "COLOR_MISMATCH" as const;
  return "CHARACTER_IDENTITY_DRIFT" as const;
};

/**
 * Visual Continuity Critic.
 * Level 1 (deterministic): every visual constraint relevant to a shot must be present in its generation prompt.
 * Level 2 (model-assisted): when a keyframe exists and a vision-capable provider is available, inspect the image.
 * Constraints that cannot be inspected are recorded as not_evaluated — never as passes.
 */
export async function runVisualCritic(world: WorldState, plan: ShotPlan, opts: VisualCriticOptions): Promise<CriticResult> {
  const started = new Date().toISOString();
  const col = new CriticCollector(world.projectId, "visual", { ...DETERMINISTIC, task: "visual_critic", createdAt: started });
  const canInspect = !!opts.llm?.supportsVision && !opts.promptOnly;
  const name = (id: string) => world.characters.find((c) => c.id === id)?.name ?? world.props.find((p) => p.id === id)?.name ?? world.locations.find((l) => l.id === id)?.name ?? id;

  for (const shot of plan.shots) {
    const constraints = relevantConstraints(world, shot);
    const scope = { sceneId: shot.sceneId, sceneNumber: shot.sceneNumber, shotId: shot.id, entityIds: [] as string[] };

    /* Level 1: prompt carries the constraint */
    for (const v of constraints) {
      const found = findPhrase(shot.visualPrompt, v.promptKeywords.length ? v.promptKeywords : [v.value]);
      const s = { ...scope, entityIds: [v.entityId] };
      if (found) col.pass(v.id, `Shot ${shot.id} prompt includes ${name(v.entityId)} ${v.attribute} = ${v.value}`, s, "PROMPT_MISSING_CONSTRAINT");
      else
        col.violation({
          code: "PROMPT_MISSING_CONSTRAINT",
          constraintId: v.id,
          constraint: `${name(v.entityId)} ${v.attribute} must be "${v.value}" in every shot with ${name(v.entityId)}`,
          expected: `Prompt mentions one of [${(v.promptKeywords.length ? v.promptKeywords : [v.value]).join(", ")}]`,
          observed: `Prompt for ${shot.id} does not mention it: "${truncate(shot.visualPrompt, 160)}"`,
          severity: v.severity,
          confidence: 1,
          evidence: `Deterministic scan of shot.visualPrompt (${shot.visualPrompt.length} chars).`,
          scope: s,
        });
    }
    for (const pid of shot.propIds) {
      const p = world.props.find((x) => x.id === pid);
      if (!p) continue;
      const s = { ...scope, entityIds: [pid] };
      if (containsPhrase(shot.visualPrompt, p.name)) col.pass(undefined, `Shot ${shot.id} prompt mentions prop "${p.name}"`, s, "PROMPT_MISSING_CONSTRAINT");
      else col.violation({ code: "PROMPT_MISSING_CONSTRAINT", constraint: `Prop "${p.name}" is in shot ${shot.id} and must be described in its prompt`, expected: `Prompt mentions "${p.name}"`, observed: "Prop absent from prompt", severity: "medium", confidence: 1, evidence: `shot.propIds includes ${pid}; prompt text lacks "${p.name}".`, scope: s });
    }

    /* Level 2: inspect the generated keyframe */
    if (constraints.length === 0) continue;
    if (!shot.keyframe) {
      for (const v of constraints) col.notEvaluated(v.id, `Media check for ${name(v.entityId)} ${v.attribute} in ${shot.id}: no keyframe generated yet`, { ...scope, entityIds: [v.entityId] }, CODE_FOR_ATTRIBUTE(v.attribute, v.entityType));
      continue;
    }
    if (shot.keyframe.provenance.provider === "placeholder") {
      for (const v of constraints) col.notEvaluated(v.id, `Media check for ${name(v.entityId)} ${v.attribute} in ${shot.id}: keyframe is a development placeholder, not inspectable`, { ...scope, entityIds: [v.entityId] }, CODE_FOR_ATTRIBUTE(v.attribute, v.entityType));
      continue;
    }
    if (!canInspect || !opts.llm) {
      for (const v of constraints) col.notEvaluated(v.id, `Media check for ${name(v.entityId)} ${v.attribute} in ${shot.id}: no vision-capable provider configured`, { ...scope, entityIds: [v.entityId] }, CODE_FOR_ATTRIBUTE(v.attribute, v.entityType));
      continue;
    }
    let image: Buffer;
    try {
      image = await readFile(join(opts.mediaDir, shot.keyframe.path));
    } catch (e) {
      for (const v of constraints) col.notEvaluated(v.id, `Media check for ${v.id} in ${shot.id}: keyframe file unreadable (${String(e)})`, { ...scope, entityIds: [v.entityId] });
      continue;
    }
    const expected = constraints.map((v) => `- [${v.id}] ${name(v.entityId)} (${v.entityType}) ${v.attribute}: ${v.value}`).join("\n");
    // A clip can drift after its first frame: when the shot has a video and ffmpeg is available, the last frame is inspected too.
    const images = [{ mimeType: shot.keyframe.mimeType, data: image.toString("base64") }];
    let clipNote = "";
    if (shot.video) {
      const bin = await resolveFfmpeg();
      if (bin) {
        try {
          const out = join(opts.mediaDir, shot.video.path.replace(/\.[a-z0-9]+$/i, "_last.jpg"));
          await lastFrame(bin, join(opts.mediaDir, shot.video.path), out);
          images.push({ mimeType: "image/jpeg", data: (await readFile(out)).toString("base64") });
          clipNote = "\nTwo images are attached: the FIRST frame and the LAST frame of the clip. A constraint is satisfied only if it holds in BOTH; if the last frame drifted, mark it unsatisfied and say what changed.";
        } catch {
          /* no last frame: keyframe only */
        }
      }
    }
    const res = await opts.llm.generateStructured({
      task: "visual_inspection",
      fixtureKey: `visual_inspection:${shot.id}`,
      system: INSPECT_SYSTEM,
      prompt: `SHOT ${shot.id}: ${shot.framing}, ${shot.action}\nLocation: ${name(shot.locationId)}, ${shot.timeOfDay}\nCharacters: ${shot.characterIds.map(name).join(", ") || "none"}\nProps: ${shot.propIds.map(name).join(", ") || "none"}\n\nCONSTRAINTS TO VERIFY:\n${expected}${clipNote}\n\nInspect the attached image${images.length > 1 ? "s" : ""} and report one observation per constraint id.`,
      schema: InspectionOutput,
      temperature: 0,
      images,
    });
    const byId = new Map(res.data.observations.map((o) => [o.constraintId, o]));
    for (const v of constraints) {
      const o = byId.get(v.id);
      const s = { ...scope, entityIds: [v.entityId] };
      const code = CODE_FOR_ATTRIBUTE(v.attribute, v.entityType);
      if (!o) {
        col.notEvaluated(v.id, `Media check for ${v.id} in ${shot.id}: inspector returned no observation`, s, code);
        continue;
      }
      if (o.satisfied) col.check({ constraintId: v.id, code, description: `Keyframe ${shot.id}: ${name(v.entityId)} ${v.attribute} = ${v.value} (observed: ${truncate(o.observed, 80)})`, outcome: "pass", scope: s });
      else
        col.violation({
          code,
          constraintId: v.id,
          constraint: `${name(v.entityId)} ${v.attribute} must be "${v.value}"`,
          expected: o.expected || v.value,
          observed: o.observed,
          severity: v.severity,
          confidence: o.confidence,
          evidence: `${res.provenance.model} inspection of ${shot.keyframe.path}: ${o.evidence}. Overall: ${truncate(res.data.overallDescription, 200)}`,
          scope: s,
          provenance: res.provenance,
        });
    }
  }

  return col.result({ ...DETERMINISTIC, task: "visual_critic", createdAt: started, latencyMs: Date.now() - Date.parse(started), note: canInspect ? `prompt checks + ${opts.llm?.model} image inspection` : "prompt checks only (no vision provider)" });
}
