import { z } from "zod";
import { Id } from "./common.js";
import { SocialStoryComfortItem, SocialStoryPerson, SocialStorySetting } from "./project.js";

/** How the child prefers to watch. Applied automatically by the child-facing player. */
export const SensoryProfile = z.object({
  reducedMotion: z.boolean().default(true),
  sound: z.enum(["on", "off"]).default("on"),
  showText: z.boolean().default(true),
  largeText: z.boolean().default(false),
  /** "slow" holds each step until the child taps; "normal" auto-advances after the voice line. */
  pacing: z.enum(["slow", "normal"]).default("slow"),
  notes: z.string().optional(),
});
export type SensoryProfile = z.infer<typeof SensoryProfile>;

/**
 * A child's profile, stored once and reused by every story: the same look, the same outfit, the same comfort
 * item, the same parent and the same familiar places, month after month. This is the long-horizon memory the
 * social-story mode is built around.
 */
export const ChildProfile = z.object({
  id: Id,
  name: z.string().min(1),
  age: z.string().optional(),
  appearance: z.string().min(1),
  outfit: z.string().min(1),
  comfortItems: z.array(SocialStoryComfortItem).default([]),
  companions: z.array(SocialStoryPerson).default([]),
  /** Familiar places (home hallway, classroom, the clinic) that stories can reuse. */
  places: z.array(SocialStorySetting).default([]),
  mustNotShow: z.array(z.string()).default([]),
  calmingRules: z.array(z.string()).default([]),
  sensory: SensoryProfile.default({ reducedMotion: true, sound: "on", showText: true, largeText: false, pacing: "slow" }),
  /** How the pictures should look: a calm illustration guided by the photos, or a photograph-like image. */
  style: z.enum(["illustrated", "photo"]).default("illustrated"),
  /** Owning account (family or clinic). Undefined for the bundled example until someone claims it. */
  accountId: Id.optional(),
  /** Who maintains the profile (parent, therapist). */
  guardian: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChildProfile = z.infer<typeof ChildProfile>;

export const ChildProfileInput = ChildProfile.omit({ id: true, createdAt: true, updatedAt: true }).extend({ id: Id.optional() });
export type ChildProfileInput = z.infer<typeof ChildProfileInput>;

/** What happened after the child watched the story and faced the real situation. */
export const StoryOutcome = z.object({
  id: Id,
  projectId: Id,
  childId: Id.optional(),
  recordedBy: z.string().min(1),
  recordedAt: z.string(),
  timesWatched: z.number().int().min(0).default(0),
  visitOutcome: z.enum(["went_well", "some_difficulty", "difficult", "did_not_happen"]),
  notes: z.string().optional(),
  stepNotes: z
    .array(
      z.object({
        stepNumber: z.number().int().positive(),
        reaction: z.enum(["calm", "unsure", "anxious"]),
        note: z.string().optional(),
      }),
    )
    .default([]),
});
export type StoryOutcome = z.infer<typeof StoryOutcome>;
export const StoryOutcomeInput = StoryOutcome.omit({ id: true, projectId: true, recordedAt: true, childId: true });
export type StoryOutcomeInput = z.infer<typeof StoryOutcomeInput>;

/** Prompt fragments for the two picture styles. */
export const PICTURE_STYLES: Record<"illustrated" | "photo", { label: string; prompt: string; description: string }> = {
  illustrated: { label: "Illustrated", prompt: "soft, flat, calm 2D illustration with gentle colours, clear simple shapes and uncluttered backgrounds; likeness guided by the reference photos", description: "A calm drawing that looks like your child and your rooms. Small differences are less upsetting than in a photo." },
  photo: { label: "Photo", prompt: "natural, calm, photograph-like image in soft even daylight, real-looking people and rooms matching the reference photos exactly, no text", description: "Looks like a real photo of your child in the real place. Faces can be slightly off; check every picture before approving." },
};
