import { z } from "zod";
import { Id, Provenance } from "./common.js";

/** Output of the Adaptation Agent: what survives, what is cut, what is merged, and why. */
export const AdaptationPlan = z.object({
  projectId: Id,
  logline: z.string(),
  synopsis: z.string(),
  targetDurationSec: z.number().int(),
  estimatedSceneCount: z.number().int(),
  /** Entities that MUST remain, with the constraint ids that justify it. */
  mustKeep: z.array(
    z.object({
      entityId: Id,
      entityType: z.enum(["character", "event", "prop", "location", "fact", "theme"]),
      reason: z.string(),
    }),
  ),
  removed: z.array(z.object({ entityId: Id, entityType: z.string(), reason: z.string() })).default([]),
  compressed: z.array(z.object({ entityId: Id, entityType: z.string(), how: z.string() })).default([]),
  merged: z.array(z.object({ from: z.array(Id), into: Id, entityType: z.string(), reason: z.string() })).default([]),
  /** Causal chains that cannot be broken (event ids in required order). */
  unbreakableChains: z.array(z.object({ events: z.array(Id), reason: z.string() })).default([]),
  audienceNotes: z.string().optional(),
  toneNotes: z.string().optional(),
  /** Ordered beats the screenplay must follow. */
  beatSheet: z.array(
    z.object({
      beat: z.string(),
      eventIds: z.array(Id).default([]),
      characterIds: z.array(Id).default([]),
      locationId: Id.optional(),
      approxDurationSec: z.number().int().optional(),
    }),
  ),
  provenance: Provenance,
});
export type AdaptationPlan = z.infer<typeof AdaptationPlan>;
