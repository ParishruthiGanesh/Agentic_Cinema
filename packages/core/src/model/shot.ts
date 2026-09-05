import { z } from "zod";
import { Id, Provenance } from "./common.js";

export const ShotStatus = z.enum(["PLANNED", "GENERATING", "VERIFYING", "FAILED", "REPAIRING", "VERIFIED"]);
export type ShotStatus = z.infer<typeof ShotStatus>;

export const CharacterShotState = z.object({
  characterId: Id,
  appearance: z.string(),
  clothing: z.string(),
  emotionalState: z.string(),
  position: z.string().optional(),
  holding: z.array(Id).default([]),
});

export const MediaAsset = z.object({
  kind: z.enum(["image", "video", "audio"]),
  /** Relative path under the media directory, served by the API. */
  path: z.string(),
  mimeType: z.string(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  provenance: Provenance,
  /** Prompt actually sent to the generator, for the evidence viewer. */
  prompt: z.string().optional(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

export const Shot = z.object({
  id: Id,
  sceneId: Id,
  sceneNumber: z.number().int(),
  index: z.number().int(),
  durationSec: z.number().positive(),
  framing: z.string(),
  cameraMovement: z.string(),
  characterIds: z.array(Id),
  characterStates: z.array(CharacterShotState),
  propIds: z.array(Id),
  locationId: Id,
  lighting: z.string(),
  timeOfDay: z.string(),
  dialogue: z.array(z.object({ characterId: Id.optional(), text: z.string(), type: z.enum(["dialogue", "narration"]) })),
  action: z.string(),
  visualPrompt: z.string(),
  negativePrompt: z.string().optional(),
  /** Ids of visual/continuity constraints inherited from CineMemory for this shot. */
  inheritedConstraintIds: z.array(Id),
  status: ShotStatus.default("PLANNED"),
  keyframe: MediaAsset.optional(),
  video: MediaAsset.optional(),
  audio: MediaAsset.optional(),
  generationAttempts: z.number().int().default(0),
  lastError: z.string().optional(),
  provenance: Provenance,
});
export type Shot = z.infer<typeof Shot>;

export const ShotPlan = z.object({
  projectId: Id,
  shots: z.array(Shot),
  version: z.number().int().default(1),
  updatedAt: z.string(),
});
export type ShotPlan = z.infer<typeof ShotPlan>;
