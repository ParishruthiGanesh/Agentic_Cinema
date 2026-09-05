import { z } from "zod";
import { Id, Provenance } from "./common.js";

export const EvalVariant = z.enum(["baseline", "cinememory"]);
export type EvalVariant = z.infer<typeof EvalVariant>;

export const EvalMetrics = z.object({
  constraintsEvaluated: z.number().int(),
  checksEvaluated: z.number().int(),
  checksNotEvaluated: z.number().int(),
  violationsDetected: z.number().int(),
  violationsRepaired: z.number().int(),
  violationsUnresolved: z.number().int(),
  /** passed / evaluated for each critic; null when nothing was evaluated (never a made-up 100%). */
  visualPassRate: z.number().nullable(),
  narrativePassRate: z.number().nullable(),
  sourcePassRate: z.number().nullable(),
  repairAttempts: z.number().int(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;

export const EvalRunRecord = z.object({
  id: Id,
  projectId: Id,
  variant: EvalVariant,
  /** Ids of the project copies used for the run, so the evidence is inspectable. */
  evalProjectId: Id,
  metrics: EvalMetrics,
  violationIds: z.array(Id),
  startedAt: z.string(),
  finishedAt: z.string(),
  provenance: Provenance,
  notes: z.array(z.string()).default([]),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

export const EvalComparison = z.object({
  id: Id,
  projectId: Id,
  baseline: EvalRunRecord,
  cinememory: EvalRunRecord,
  createdAt: z.string(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;
