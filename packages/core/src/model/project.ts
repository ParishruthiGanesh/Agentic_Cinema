import { z } from "zod";
import { Id, Provenance } from "./common.js";

export const ProjectMode = z.enum(["creator", "kids", "social_story"]);
export type ProjectMode = z.infer<typeof ProjectMode>;

export const SourceKind = z.enum(["original", "public_domain", "licensed", "screenplay", "idea", "lesson", "social_story"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceMaterial = z.object({
  kind: SourceKind,
  title: z.string(),
  author: z.string().optional(),
  text: z.string().min(1),
  rightsNote: z.string().optional(),
});
export type SourceMaterial = z.infer<typeof SourceMaterial>;

export const ProductionBrief = z.object({
  genre: z.string(),
  audience: z.string(),
  ageRange: z.string().optional(),
  targetDurationSec: z.number().int().positive(),
  language: z.string().default("English"),
  visualStyle: z.string(),
  tone: z.string().optional(),
  format: z.string().default("animated short"),
  adaptationInstructions: z.string().optional(),
  /** Kids/educational mode: facts that MUST survive adaptation, verified by the Source Fidelity Critic. */
  requiredFacts: z.array(z.string()).default([]),
});
export type ProductionBrief = z.infer<typeof ProductionBrief>;

/* ------------------------------------------------------------------ */
/* Social stories: a therapist/parent-authored routine for an autistic  */
/* child. The words are exact and never rewritten by a model; CineMemory */
/* guarantees identity, outfit, setting and step order across the film.  */
/* ------------------------------------------------------------------ */

export const SocialStoryPerson = z.object({
  id: Id,
  name: z.string().min(1),
  /** e.g. "parent", "dentist", "teacher" */
  role: z.string().default("companion"),
  appearance: z.string().min(1),
  outfit: z.string().min(1),
});
export type SocialStoryPerson = z.infer<typeof SocialStoryPerson>;

export const SocialStoryComfortItem = z.object({ id: Id, name: z.string().min(1), description: z.string().min(1) });
export type SocialStoryComfortItem = z.infer<typeof SocialStoryComfortItem>;

export const SocialStorySetting = z.object({ id: Id, name: z.string().min(1), description: z.string().min(1) });
export type SocialStorySetting = z.infer<typeof SocialStorySetting>;

export const SocialStoryStep = z.object({
  title: z.string().min(1),
  /** First-person text read to the child, exactly as written. */
  text: z.string().min(1),
  settingId: Id,
  companionIds: z.array(Id).default([]),
  comfortItemIds: z.array(Id).default([]),
  /** What the picture should show (optional; defaults to the step text). */
  visual: z.string().optional(),
  durationSec: z.number().int().positive().optional(),
});
export type SocialStoryStep = z.infer<typeof SocialStoryStep>;

export const SocialStoryBrief = z.object({
  child: z.object({
    name: z.string().min(1),
    age: z.string().optional(),
    appearance: z.string().min(1),
    /** ONE outfit for the whole story. Changing clothes between scenes is exactly the drift social stories cannot tolerate. */
    outfit: z.string().min(1),
  }),
  situation: z.string().min(1),
  companions: z.array(SocialStoryPerson).default([]),
  comfortItems: z.array(SocialStoryComfortItem).default([]),
  settings: z.array(SocialStorySetting).min(1),
  steps: z.array(SocialStoryStep).min(1),
  /** Things that must never appear in any frame (e.g. needles, crying faces). Verified visually. */
  mustNotShow: z.array(z.string()).default([]),
  /** Reassurances the child should hear (appended as their own lines to the step they belong to, or as a final step). */
  calmingRules: z.array(z.string()).default([]),
  /** Who wrote the routine (shown on the certificate). */
  authoredBy: z.string().optional(),
});
export type SocialStoryBrief = z.infer<typeof SocialStoryBrief>;

/** Human sign-off recorded on the project (therapist / parent) before the film is shared with the child. */
export const Approval = z.object({
  approvedBy: z.string().min(1),
  note: z.string().optional(),
  approvedAt: z.string(),
  /** Certificate status at the moment of approval. */
  certificateStatus: z.string(),
  /** Screenplay + shot plan versions that were approved; a later regeneration invalidates the approval. */
  screenplayVersion: z.number().int().optional(),
  shotPlanVersion: z.number().int().optional(),
});
export type Approval = z.infer<typeof Approval>;

export const Stage = z.enum([
  "created",
  "source_analyzed",
  "adapted",
  "screenplay_written",
  "memory_built",
  "shots_planned",
  "narrative_verified",
  "media_generated",
  "visually_verified",
  "film_assembled",
]);
export type Stage = z.infer<typeof Stage>;

/** Ordered list; stage N implies all stages < N are complete. */
export const STAGE_ORDER: Stage[] = Stage.options;

export const StageStatus = z.enum(["pending", "running", "complete", "failed"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const StageRecord = z.object({
  stage: Stage,
  status: StageStatus,
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  provenance: Provenance.optional(),
});
export type StageRecord = z.infer<typeof StageRecord>;

export const Project = z.object({
  id: Id,
  title: z.string(),
  mode: ProjectMode,
  source: SourceMaterial,
  brief: ProductionBrief,
  stage: Stage,
  stages: z.array(StageRecord).default([]),
  /** Which LLM provider produced this project's artifacts, so the UI can flag fixture mode. */
  llmProvider: z.string().optional(),
  mediaProvider: z.string().optional(),
  isDemo: z.boolean().default(false),
  /** Present for mode "social_story". */
  socialStory: SocialStoryBrief.optional(),
  approval: Approval.optional(),
  /** Child profile this story was created from (social stories). */
  childId: Id.optional(),
  /** Earlier story this one revises (after feedback). */
  revisionOf: Id.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectInput = z
  .object({
    title: z.string().min(1),
    mode: ProjectMode,
    source: SourceMaterial,
    brief: ProductionBrief,
    socialStory: SocialStoryBrief.optional(),
    childId: Id.optional(),
    revisionOf: Id.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === "social_story" && !input.socialStory) ctx.addIssue({ code: "custom", path: ["socialStory"], message: "mode social_story requires a socialStory brief" });
    if (input.socialStory) {
      const settings = new Set(input.socialStory.settings.map((s) => s.id));
      const companions = new Set(input.socialStory.companions.map((c) => c.id));
      const items = new Set(input.socialStory.comfortItems.map((c) => c.id));
      input.socialStory.steps.forEach((st, i) => {
        if (!settings.has(st.settingId)) ctx.addIssue({ code: "custom", path: ["socialStory", "steps", i, "settingId"], message: `unknown setting "${st.settingId}"` });
        st.companionIds.forEach((c) => !companions.has(c) && ctx.addIssue({ code: "custom", path: ["socialStory", "steps", i, "companionIds"], message: `unknown companion "${c}"` }));
        st.comfortItemIds.forEach((c) => !items.has(c) && ctx.addIssue({ code: "custom", path: ["socialStory", "steps", i, "comfortItemIds"], message: `unknown comfort item "${c}"` }));
      });
    }
  });
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;
