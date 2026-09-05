import { z } from "zod";
import { Id } from "./common.js";

export const AgentName = z.enum([
  "orchestrator",
  "source_intelligence",
  "adaptation",
  "screenplay",
  "world_memory",
  "director",
  "generation",
  "visual_critic",
  "narrative_critic",
  "source_fidelity_critic",
  "repair",
  "film_assembler",
  "evaluation",
  "user",
]);
export type AgentName = z.infer<typeof AgentName>;

export const EventLevel = z.enum(["info", "warn", "error", "success"]);

/** A real workflow event written by backend code. The UI activity log renders these verbatim. */
export const WorkflowEvent = z.object({
  id: Id,
  projectId: Id,
  seq: z.number().int(),
  ts: z.string(),
  agent: AgentName,
  type: z.string(),
  level: EventLevel.default("info"),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type WorkflowEvent = z.infer<typeof WorkflowEvent>;
