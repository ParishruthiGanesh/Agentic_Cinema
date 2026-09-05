import { GoogleGenAI } from "@google/genai";
import { shortHash } from "../util/hash.js";
import { toGeminiJsonSchema } from "./jsonSchema.js";
import { LLMConfigError, LLMOutputError, type LLMProvider, type StructuredRequest, type StructuredResult } from "./provider.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  model?: string;
  maxRetries?: number;
}

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gemini provider using the official @google/genai SDK with JSON-schema constrained output.
 * Every response is validated with zod; on validation failure the model is re-prompted once
 * with the validation errors, then the call fails loudly (never silently swallowed).
 */
export class GeminiLLMProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly supportsVision = true;
  private ai: GoogleGenAI;
  private maxRetries: number;

  constructor(opts: GeminiProviderOptions) {
    if (opts.vertexai) {
      if (!opts.project) throw new LLMConfigError("GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI=true");
      this.ai = new GoogleGenAI({ vertexai: true, project: opts.project, location: opts.location ?? "us-central1" });
    } else {
      if (!opts.apiKey) throw new LLMConfigError("GEMINI_API_KEY is not set");
      this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    }
    this.model = opts.model ?? "gemini-2.5-flash";
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toGeminiJsonSchema(req.schema);
    const started = Date.now();
    let prompt = req.prompt;
    let lastRaw = "";
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, usage } = await this.callWithRetry(req, prompt, jsonSchema);
      lastRaw = text;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(stripCodeFence(text));
      } catch (e) {
        lastError = e;
        prompt = `${req.prompt}\n\nYour previous response was not valid JSON. Respond with a single JSON object only.`;
        continue;
      }
      const result = req.schema.safeParse(parsedJson);
      if (result.success) {
        return {
          data: result.data,
          rawText: text,
          provenance: {
            provider: this.name,
            model: this.model,
            task: req.task,
            createdAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            inputTokens: usage.input,
            outputTokens: usage.output,
            promptHash: shortHash(req.system + "\n" + req.prompt),
          },
        };
      }
      lastError = result.error;
      const issues = result.error.issues
        .slice(0, 12)
        .map((i) => `- ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      prompt = `${req.prompt}\n\nYour previous JSON response failed schema validation:\n${issues}\nFix these issues and respond again with a single JSON object.`;
    }
    throw new LLMOutputError(`Gemini output failed validation for task "${req.task}": ${String(lastError)}`, lastRaw);
  }

  private async callWithRetry<T>(
    req: StructuredRequest<T>,
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<{ text: string; usage: { input?: number; output?: number } }> {
    let delay = 1500;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const parts: Array<Record<string, unknown>> = [{ text: prompt }];
        for (const img of req.images ?? []) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        const res = await this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            temperature: req.temperature ?? 0.4,
          },
        });
        const text = res.text ?? "";
        if (!text) throw new LLMOutputError("Gemini returned an empty response", "");
        return {
          text,
          usage: { input: res.usageMetadata?.promptTokenCount, output: res.usageMetadata?.candidatesTokenCount },
        };
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxRetries) throw err;
        await sleep(delay);
        delay *= 2;
      }
    }
    throw lastErr;
  }
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return t;
}

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}
