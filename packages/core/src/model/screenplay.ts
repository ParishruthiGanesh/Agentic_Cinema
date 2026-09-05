import { z } from "zod";
import { Id, Provenance } from "./common.js";

export const LineType = z.enum(["dialogue", "narration", "action"]);
export type LineType = z.infer<typeof LineType>;

export const ScriptLine = z.object({
  type: LineType,
  /** Character id for dialogue; omitted for narration/action. */
  characterId: Id.optional(),
  text: z.string(),
  emotion: z.string().optional(),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

/** A declared knowledge transfer inside a scene (the World Memory folds these into character state). */
export const KnowledgeReveal = z.object({
  factId: Id,
  toCharacterId: Id,
  via: z.string(),
});
export type KnowledgeReveal = z.infer<typeof KnowledgeReveal>;

export const PropTransfer = z.object({
  propId: Id,
  toCharacterId: Id.optional(),
  fromCharacterId: Id.optional(),
  how: z.string(),
});

export const Scene = z.object({
  id: Id,
  number: z.number().int().positive(),
  act: z.number().int().positive(),
  title: z.string(),
  locationId: Id,
  timeOfDay: z.string(),
  objective: z.string(),
  emotionalState: z.string(),
  characterIds: z.array(Id),
  propIds: z.array(Id).default([]),
  eventIds: z.array(Id).default([]),
  durationSec: z.number().int().positive(),
  lines: z.array(ScriptLine),
  knowledgeReveals: z.array(KnowledgeReveal).default([]),
  propTransfers: z.array(PropTransfer).default([]),
  /** Where characters end up at the end of the scene, if different from the scene location. */
  exitLocations: z.record(z.string(), Id).default({}),
  /** Emotional state per character at scene end. */
  endEmotions: z.record(z.string(), z.string()).default({}),
  /** Source/continuity constraint ids this scene satisfies (declared by the agent, verified by critics). */
  satisfiesConstraints: z.array(Id).default([]),
});
export type Scene = z.infer<typeof Scene>;

export const Act = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  purpose: z.string(),
});

export const Screenplay = z.object({
  projectId: Id,
  title: z.string(),
  logline: z.string(),
  acts: z.array(Act),
  scenes: z.array(Scene),
  totalDurationSec: z.number().int(),
  version: z.number().int().default(1),
  provenance: Provenance,
  /** History of targeted rewrites applied by the Repair Agent. */
  revisions: z
    .array(
      z.object({
        version: z.number().int(),
        sceneId: Id,
        reason: z.string(),
        violationId: Id.optional(),
        provenance: Provenance,
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export type Screenplay = z.infer<typeof Screenplay>;
