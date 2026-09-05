import { z } from "zod";

/** Identifier: lowercase slug, used for every entity so ids are stable across agents. */
export const Id = z.string().min(1).max(120);
export type Id = z.infer<typeof Id>;

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

/**
 * Provenance is stamped on every artifact produced by an LLM, a media model or a
 * deterministic routine so the UI can always say where something came from.
 * `provider` is "gemini", "fixture" (development replay), "placeholder" (dev media)
 * or "deterministic" (rule-based code). Nothing is ever labelled as a model it did not come from.
 */
export const Provenance = z.object({
  provider: z.string(),
  model: z.string().optional(),
  task: z.string(),
  createdAt: z.string(),
  latencyMs: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  promptHash: z.string().optional(),
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const nowIso = () => new Date().toISOString();

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "item"
  );
}
