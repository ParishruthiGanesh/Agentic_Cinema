import type { z } from "zod";
import type { Provenance } from "../model/index.js";

export interface InlineImage {
  mimeType: string;
  /** base64 data */
  data: string;
}

export interface StructuredRequest<T> {
  /** Stable task name, e.g. "source_intelligence". Used for provenance, fixtures and metrics. */
  task: string;
  /** Optional finer-grained key for fixtures (e.g. task + scene id). Defaults to task. */
  fixtureKey?: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
  images?: InlineImage[];
}

export interface StructuredResult<T> {
  data: T;
  provenance: Provenance;
  rawText: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsVision: boolean;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export class LLMOutputError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "LLMOutputError";
  }
}
