import { z } from "zod";
import type { AgentContext } from "../agents/context.js";
import { memoryLabel } from "../agents/context.js";
import { buildShots, type ScenePlanOutput } from "../agents/director.js";
import { keywordsFromFact } from "../agents/sourceIntelligence.js";
import { retrieveSceneContext } from "../memory/worldMemory.js";
import {
  AdaptationPlan,
  Screenplay,
  type Project,
  type Scene,
  type ShotPlan,
  type SocialStoryBrief,
  type VisualConstraint,
  type WorldState,
  slugify,
} from "../model/index.js";

/**
 * Social stories (Carol Gray-style routines for autistic children) are compiled, not adapted.
 *
 * The therapist's or parent's words are the source of truth: they are placed in the screenplay verbatim,
 * one scene per step, in the authored order. No language model rewrites them. What CineMemory adds is the
 * part generative tools get wrong: the child's identity and outfit, the companions, the rooms, the comfort
 * items and the must-not-show list become hard constraints that are injected into every image prompt and
 * verified frame by frame by the Visual Critic, with regeneration when a frame drifts.
 */

export const SOCIAL_STORY_PROVENANCE = { provider: "deterministic", model: "social-story-compiler" } as const;
export const SOCIAL_STORY_NOTE = "Compiled verbatim from the authored routine. No model rewrote the words.";

export const DEFAULT_SOCIAL_STORY_STYLE = "soft, flat, calm 2D illustration with gentle colours, clear simple shapes and uncluttered backgrounds";

export const stepEventId = (i: number) => `step_${i + 1}`;
export const stepConstraintId = (i: number) => `sc_step_${i + 1}`;
export const calmingConstraintId = (i: number) => `sc_calm_${i + 1}`;
export const childId = (brief: SocialStoryBrief) => slugify(brief.child.name) || "child";

/** Plain-text rendering of the routine, stored as the project's source so the Story page shows exactly what was authored. */
export function renderSocialStoryText(brief: SocialStoryBrief): string {
  const lines: string[] = [];
  lines.push(`${brief.child.name}: ${brief.situation}`);
  lines.push("");
  brief.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    lines.push(s.text);
    lines.push("");
  });
  if (brief.calmingRules.length) {
    lines.push("Things I can do:");
    for (const r of brief.calmingRules) lines.push(`- ${r}`);
    lines.push("");
  }
  if (brief.mustNotShow.length) lines.push(`Must never be shown: ${brief.mustNotShow.join("; ")}.`);
  return lines.join("\n").trim();
}

/** Calm reading pace for a child: ~2 words per second, at least 6 s per step. */
export function stepDurationSec(text: string, override?: number): number {
  if (override) return override;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(24, Math.max(6, Math.round(words / 2)));
}

export function compileSocialStoryWorld(project: Project, brief: SocialStoryBrief): WorldState {
  const cid = childId(brief);
  const now = new Date().toISOString();
  const firstSetting = brief.steps[0]?.settingId ?? brief.settings[0]?.id ?? "";

  const characters: WorldState["characters"] = [
    {
      id: cid,
      name: brief.child.name,
      role: "protagonist",
      description: `${brief.child.name}${brief.child.age ? `, ${brief.child.age}` : ""}: the child this story is for.`,
      appearance: { age: brief.child.age, distinguishingFeatures: [], summary: brief.child.appearance },
      clothing: { items: [brief.child.outfit], colors: [], summary: brief.child.outfit },
      voice: { description: "calm, gentle, slow and clear, like a child telling their own story", pitch: "medium-high", pace: "slow" },
      personality: ["calm"],
      goals: [brief.situation],
      fears: [],
      relationships: brief.companions.map((c) => c.id),
      current_location: firstSetting,
      emotional_state: "calm",
      knowledge: [],
      inventory: brief.comfortItems.map((c) => c.id),
      continuity_constraints: [],
      scene_appearances: [],
      sourceEvidence: `Child: ${brief.child.appearance}; wears ${brief.child.outfit}`,
    },
    ...brief.companions.map((c) => ({
      id: c.id,
      name: c.name,
      role: "supporting" as const,
      description: `${c.name} (${c.role})`,
      appearance: { distinguishingFeatures: [], summary: c.appearance },
      clothing: { items: [c.outfit], colors: [], summary: c.outfit },
      voice: { description: "warm, calm adult voice", pitch: "medium", pace: "slow" },
      personality: ["kind", "calm"],
      goals: [],
      fears: [],
      relationships: [cid],
      current_location: "",
      emotional_state: "calm",
      knowledge: [],
      inventory: [],
      continuity_constraints: [],
      scene_appearances: [],
      sourceEvidence: `${c.role}: ${c.appearance}; wears ${c.outfit}`,
    })),
  ];

  // Consecutive steps in different settings are "connected" so the location-continuity check knows the move is authored.
  const connected = new Map<string, Set<string>>();
  brief.steps.forEach((s, i) => {
    const prev = brief.steps[i - 1];
    if (!prev || prev.settingId === s.settingId) return;
    (connected.get(prev.settingId) ?? connected.set(prev.settingId, new Set()).get(prev.settingId)!).add(s.settingId);
    (connected.get(s.settingId) ?? connected.set(s.settingId, new Set()).get(s.settingId)!).add(prev.settingId);
  });
  const locations: WorldState["locations"] = brief.settings.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    visualSummary: s.description,
    timeOfDayDefault: "daytime",
    keyFeatures: [],
    connectedTo: [...(connected.get(s.id) ?? [])],
    sourceEvidence: s.description,
  }));

  const props: WorldState["props"] = brief.comfortItems.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    visualSummary: c.description,
    significance: "comfort item the child keeps with them",
    initialOwner: cid,
    sourceEvidence: c.description,
  }));

  const events: WorldState["events"] = brief.steps.map((s, i) => ({
    id: stepEventId(i),
    name: s.title,
    description: s.text,
    order: i + 1,
    participants: [cid, ...s.companionIds],
    location: s.settingId,
    dependsOn: i > 0 ? [stepEventId(i - 1)] : [],
    consequences: [],
    importance: "essential" as const,
    sourceEvidence: s.text,
  }));

  const sourceConstraints: WorldState["sourceConstraints"] = [
    ...brief.steps.map((s, i) => ({
      id: stepConstraintId(i),
      kind: "required_event" as const,
      statement: `Step ${i + 1} "${s.title}" happens, in order`,
      importance: "must_keep" as const,
      keywords: [],
      relatedEntities: [stepEventId(i)],
      sourceEvidence: s.text,
    })),
    ...brief.calmingRules.map((r, i) => ({
      id: calmingConstraintId(i),
      kind: "required_fact" as const,
      statement: r,
      importance: "must_keep" as const,
      keywords: keywordsFromFact(r),
      relatedEntities: [cid],
      sourceEvidence: r,
    })),
  ];

  const visualConstraints: VisualConstraint[] = [];
  const vc = (entityType: VisualConstraint["entityType"], entityId: string, attribute: string, value: string, severity: VisualConstraint["severity"], keywords?: string[]) =>
    visualConstraints.push({ id: `vc_${slugify(entityId)}_${slugify(attribute)}`, entityType, entityId, attribute, value, severity, promptKeywords: keywords ?? [value] });
  vc("character", cid, "identity", brief.child.appearance, "critical");
  vc("character", cid, "outfit", brief.child.outfit, "critical");
  for (const c of brief.companions) {
    vc("character", c.id, "identity", c.appearance, "high");
    vc("character", c.id, "outfit", c.outfit, "high");
  }
  for (const s of brief.settings) vc("location", s.id, "setting", s.description, "high");
  for (const c of brief.comfortItems) vc("prop", c.id, "appearance", c.description, "high");
  brief.mustNotShow.forEach((item, i) => vc("style", "style", `must_not_show_${i + 1}`, `nothing showing ${item}`, "critical", [`no ${item}`]));
  const style = project.brief.visualStyle || DEFAULT_SOCIAL_STORY_STYLE;
  vc("style", "style", "style", style, "medium", [style]);

  const continuityConstraints: WorldState["continuityConstraints"] = [
    { id: "cc_step_order", kind: "event_order", statement: `The ${brief.steps.length} steps happen in the authored order, nothing added or skipped.`, entities: events.map((e) => e.id), severity: "critical", params: { order: events.map((e) => e.id) } },
    { id: "cc_child_present", kind: "character_presence", statement: `${brief.child.name} is in every scene.`, entities: [cid], severity: "critical", params: {} },
    { id: "cc_one_outfit", kind: "character_presence", statement: `${brief.child.name} wears the same outfit in every scene: ${brief.child.outfit}.`, entities: [cid], severity: "critical", params: {} },
    ...brief.steps.map((s, i) => ({ id: `cc_setting_step_${i + 1}`, kind: "location_persistence" as const, statement: `Step ${i + 1} takes place in ${brief.settings.find((x) => x.id === s.settingId)?.name ?? s.settingId}.`, entities: [s.settingId, stepEventId(i)], severity: "high" as const, params: { sceneNumber: i + 1 } })),
  ];
  for (const c of characters) c.continuity_constraints = continuityConstraints.filter((cc) => cc.entities.includes(c.id)).map((cc) => cc.id);

  return {
    projectId: project.id,
    characters,
    locations,
    props,
    events,
    relationships: brief.companions.map((c, i) => ({ id: `rel_${i + 1}_${cid}_${c.id}`, from: cid, to: c.id, type: c.role, description: `${c.name} is ${brief.child.name}'s ${c.role}`, sentiment: "positive" as const })),
    knowledgeFacts: [],
    sourceConstraints,
    visualConstraints,
    continuityConstraints,
    themes: ["predictability", "reassurance", "I can do this"],
    timeline: brief.steps.map((s, i) => `${i + 1}. ${s.title}`),
    styleGuide: `${style}. Calm, literal, uncluttered compositions at the child's eye level; soft even daylight; the same faces, clothes and rooms in every scene; nothing unexpected in frame.`,
    version: 1,
    updatedAt: now,
  };
}

export function compileSocialStoryAdaptation(project: Project, brief: SocialStoryBrief, world: WorldState): AdaptationPlan {
  const cid = childId(brief);
  const now = new Date().toISOString();
  return AdaptationPlan.parse({
    projectId: project.id,
    logline: `${brief.child.name}: ${brief.situation}`,
    synopsis: `A ${brief.steps.length}-step social story, told in the first person by ${brief.child.name}, previewing exactly what will happen.`,
    targetDurationSec: project.brief.targetDurationSec,
    estimatedSceneCount: brief.steps.length,
    mustKeep: [
      { entityId: cid, entityType: "character", reason: "the child the story is for" },
      ...brief.companions.map((c) => ({ entityId: c.id, entityType: "character" as const, reason: `${c.role} named in the routine` })),
      ...brief.comfortItems.map((c) => ({ entityId: c.id, entityType: "prop" as const, reason: "comfort item the child expects to have" })),
      ...world.events.map((e) => ({ entityId: e.id, entityType: "event" as const, reason: "authored step; nothing may be skipped or reordered" })),
    ],
    removed: [],
    compressed: [],
    merged: [],
    unbreakableChains: [{ events: world.events.map((e) => e.id), reason: "social stories rehearse a fixed sequence" }],
    audienceNotes: "Autistic child; literal language, no surprises, one idea per scene.",
    toneNotes: "calm, reassuring, matter-of-fact",
    beatSheet: brief.steps.map((s, i) => ({ beat: `${s.title}: ${s.text}`, eventIds: [stepEventId(i)], characterIds: [cid, ...s.companionIds], locationId: s.settingId, approxDurationSec: stepDurationSec(s.text, s.durationSec) })),
    provenance: { ...SOCIAL_STORY_PROVENANCE, task: "adaptation", createdAt: now, note: SOCIAL_STORY_NOTE },
  });
}

export function compileSocialStoryScreenplay(project: Project, brief: SocialStoryBrief, world: WorldState): Screenplay {
  const cid = childId(brief);
  const now = new Date().toISOString();
  const last = brief.steps.length - 1;
  const scenes: Scene[] = brief.steps.map((s, i) => {
    const lines: Scene["lines"] = [];
    if (s.visual) lines.push({ type: "action", text: s.visual });
    lines.push({ type: "dialogue", characterId: cid, text: s.text, emotion: "calm" });
    const satisfies = [stepConstraintId(i)];
    if (i === last) {
      brief.calmingRules.forEach((r, ri) => {
        lines.push({ type: "dialogue", characterId: cid, text: r, emotion: "calm" });
        satisfies.push(calmingConstraintId(ri));
      });
    }
    const spoken = lines.filter((l) => l.type === "dialogue").map((l) => l.text).join(" ");
    return {
      id: `scene_${i + 1}`,
      number: i + 1,
      act: 1,
      title: s.title,
      locationId: s.settingId,
      timeOfDay: "daytime",
      objective: s.title,
      emotionalState: "calm",
      characterIds: [cid, ...s.companionIds],
      propIds: s.comfortItemIds,
      eventIds: [stepEventId(i)],
      durationSec: stepDurationSec(spoken, s.durationSec),
      lines,
      knowledgeReveals: [],
      propTransfers: [],
      exitLocations: {},
      endEmotions: { [cid]: "calm" },
      satisfiesConstraints: satisfies,
    };
  });
  return Screenplay.parse({
    projectId: project.id,
    title: project.title,
    logline: `${brief.child.name}: ${brief.situation}`,
    acts: [{ number: 1, title: "The routine", purpose: "Preview each step in order so nothing is a surprise." }],
    scenes,
    totalDurationSec: scenes.reduce((a, s) => a + s.durationSec, 0),
    version: 1,
    provenance: { ...SOCIAL_STORY_PROVENANCE, task: "screenplay", createdAt: now, note: SOCIAL_STORY_NOTE },
    revisions: [],
  });
}

/** Does every authored step appear verbatim as a line in its scene? (The certificate reports this.) */
export function wordsUnchanged(brief: SocialStoryBrief, screenplay: Screenplay): boolean {
  return brief.steps.every((s, i) => {
    const scene = screenplay.scenes.find((sc) => sc.number === i + 1);
    return !!scene && scene.lines.some((l) => l.type === "dialogue" && l.text === s.text);
  });
}

/**
 * Deterministic shot planning for social stories: one calm, static, eye-level shot per step. The Director LLM is
 * deliberately not used here because reinterpretation (a dramatic close-up, a new angle, an added detail) is the
 * thing a social story must avoid. Prompt composition, memory retrieval and constraints are the same as for films.
 */
export async function runSocialStoryDirector(ctx: AgentContext, project: Project, brief: SocialStoryBrief, world: WorldState, screenplay: Screenplay): Promise<ShotPlan> {
  const { events, repo, memory } = ctx;
  const style = project.brief.visualStyle || DEFAULT_SOCIAL_STORY_STYLE;
  events.emit(project.id, "director", "shots.planning.started", `Planning ${screenplay.scenes.length} social-story shots (one static eye-level shot per step; deterministic)`, { injectMemory: true, memory: memory.name, deterministic: true });
  const shots: ShotPlan["shots"] = [];
  for (const scene of [...screenplay.scenes].sort((a, b) => a.number - b.number)) {
    const step = brief.steps[scene.number - 1];
    const entityIds = [...scene.characterIds, ...scene.propIds];
    const { changes, trace } = await memory.stateBefore(project.id, scene.number, entityIds);
    const sceneCtx = retrieveSceneContext(world, screenplay, changes, scene.id);
    events.emit(project.id, "world_memory", "memory.retrieved", `Retrieved step ${scene.number} state from ${memoryLabel(ctx)}: ${trace.rows} state changes for ${entityIds.length} entities (${trace.latencyMs}ms) → ${sceneCtx.visualConstraints.length} visual constraints`, { sceneId: scene.id, source: trace.source, sql: trace.sql, rows: trace.rows, latencyMs: trace.latencyMs });
    const who = sceneCtx.characters.map((c) => c.character.name).join(" and ");
    const draft = step?.visual ?? `${who} ${scene.title.toLowerCase()}. ${step?.text ?? ""}`;
    const out: ScenePlanOutput = {
      shots: [
        {
          index: 1,
          durationSec: scene.durationSec,
          framing: "medium wide shot at the child's eye level, whole figures visible",
          cameraMovement: "static",
          characterIds: scene.characterIds,
          propIds: scene.propIds,
          lighting: "soft, even daylight, no harsh shadows",
          action: draft,
          lineIndexes: scene.lines.map((_, i) => i),
          visualPromptDraft: `${draft} A calm, literal picture of exactly this moment and nothing else; everyone relaxed; faces fully visible.`,
          positionNotes: [],
        },
      ],
    };
    const sceneShots = buildShots(project, sceneCtx, out, { injectMemory: true, visualStyle: style, avoid: brief.mustNotShow }, { ...SOCIAL_STORY_PROVENANCE, task: "shot_planning", createdAt: new Date().toISOString(), note: SOCIAL_STORY_NOTE });
    shots.push(...sceneShots);
    events.emit(project.id, "director", "shots.scene.planned", `Step ${scene.number} planned: ${sceneShots.length} shot`, { sceneId: scene.id, shotIds: sceneShots.map((s) => s.id) });
  }
  const previous = repo.getShotPlan(project.id);
  const plan: ShotPlan = { projectId: project.id, shots, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
  repo.saveShotPlan(plan);
  await memory.recordShots(plan);
  events.emit(project.id, "director", "shots.planning.completed", `${shots.length} shots planned across ${screenplay.scenes.length} steps`, {}, "success");
  return plan;
}

/** Shape of the brief the web form and the draft helper exchange (re-exported for convenience). */
export const SocialStoryDraftSchema = z.object({
  situation: z.string(),
  steps: z.array(z.object({ title: z.string(), text: z.string(), settingName: z.string(), visual: z.string().optional(), companions: z.array(z.string()).default([]) })),
  settings: z.array(z.object({ name: z.string(), description: z.string() })),
  companions: z.array(z.object({ name: z.string(), role: z.string(), appearance: z.string(), outfit: z.string() })),
  comfortItems: z.array(z.object({ name: z.string(), description: z.string() })),
  mustNotShow: z.array(z.string()),
  calmingRules: z.array(z.string()),
});
export type SocialStoryDraft = z.infer<typeof SocialStoryDraftSchema>;
