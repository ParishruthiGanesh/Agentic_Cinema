import { z } from "zod";
import { Id, Provenance } from "./common.js";

export const ProjectMode = z.enum(["creator", "kids"]);
export type ProjectMode = z.infer<typeof ProjectMode>;

export const SourceKind = z.enum(["original", "public_domain", "licensed", "screenplay", "idea", "lesson"]);
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectInput = z.object({
  title: z.string().min(1),
  mode: ProjectMode,
  source: SourceMaterial,
  brief: ProductionBrief,
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;
