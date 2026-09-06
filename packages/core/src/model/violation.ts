import { z } from "zod";
import { Id, Provenance, Severity } from "./common.js";

export const ViolationCode = z.enum([
  // narrative
  "KNOWLEDGE_TIMELINE_VIOLATION",
  "CHRONOLOGY_VIOLATION",
  "CAUSAL_DEPENDENCY_VIOLATION",
  "PROP_POSSESSION_VIOLATION",
  "CHARACTER_PRESENCE_VIOLATION",
  "LOCATION_CONTINUITY_VIOLATION",
  "UNRESOLVED_DEPENDENCY",
  // source fidelity
  "REQUIRED_FACT_MISSING",
  "REQUIRED_EVENT_MISSING",
  "REQUIRED_CHARACTER_MISSING",
  "SOURCE_CONTRADICTION",
  // visual (prompt-level and media-level)
  "PROMPT_MISSING_CONSTRAINT",
  "PROP_MISSING",
  "CHARACTER_IDENTITY_DRIFT",
  "CLOTHING_MISMATCH",
  "COLOR_MISMATCH",
  "LOCATION_MISMATCH",
  "TIME_OF_DAY_MISMATCH",
  "STYLE_MISMATCH",
  /** Something on the must-not-show list is visible in a frame (social stories). */
  "FORBIDDEN_CONTENT",
]);
export type ViolationCode = z.infer<typeof ViolationCode>;

export const CriticName = z.enum(["narrative", "source_fidelity", "visual"]);
export type CriticName = z.infer<typeof CriticName>;

export const ViolationStatus = z.enum(["open", "repairing", "resolved", "escalated", "overridden"]);
export type ViolationStatus = z.infer<typeof ViolationStatus>;

/** Where in the production the violation was observed. */
export const ViolationScope = z.object({
  sceneId: Id.optional(),
  sceneNumber: z.number().int().optional(),
  shotId: Id.optional(),
  lineIndex: z.number().int().optional(),
  entityIds: z.array(Id).default([]),
});

export const RepairAttempt = z.object({
  attempt: z.number().int(),
  rootCause: z.enum(["screenplay", "shot_prompt", "generated_media", "source_extraction", "unknown"]),
  strategy: z.string(),
  target: z.string(),
  outcome: z.enum(["resolved", "still_failing", "error"]),
  detail: z.string(),
  provenance: Provenance.optional(),
  createdAt: z.string(),
});
export type RepairAttempt = z.infer<typeof RepairAttempt>;

export const Violation = z.object({
  id: Id,
  projectId: Id,
  code: ViolationCode,
  critic: CriticName,
  constraintId: Id.optional(),
  constraint: z.string(),
  expected: z.string(),
  observed: z.string(),
  severity: Severity,
  /** 1.0 for deterministic checks; a model-reported number for vision checks. Never used as proof by itself. */
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  scope: ViolationScope,
  status: ViolationStatus.default("open"),
  repairAttempts: z.array(RepairAttempt).default([]),
  /** Stable key so re-running a critic updates the same violation instead of duplicating it. */
  fingerprint: z.string(),
  detectedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolutionNote: z.string().optional(),
  provenance: Provenance,
});
export type Violation = z.infer<typeof Violation>;

/** A check that was evaluated, whether or not it produced a violation. Scores are derived from these. */
export const CheckRecord = z.object({
  id: Id,
  projectId: Id,
  critic: CriticName,
  constraintId: Id.optional(),
  code: ViolationCode.optional(),
  description: z.string(),
  passed: z.boolean(),
  /** "not_evaluated" when a check could not run (e.g. no vision provider); never counted as pass. */
  outcome: z.enum(["pass", "fail", "not_evaluated"]),
  scope: ViolationScope,
  runId: Id,
  createdAt: z.string(),
});
export type CheckRecord = z.infer<typeof CheckRecord>;

export const CriticRun = z.object({
  id: Id,
  projectId: Id,
  critic: CriticName,
  startedAt: z.string(),
  finishedAt: z.string(),
  checksEvaluated: z.number().int(),
  violationsFound: z.number().int(),
  notEvaluated: z.number().int().default(0),
  provenance: Provenance,
});
export type CriticRun = z.infer<typeof CriticRun>;
