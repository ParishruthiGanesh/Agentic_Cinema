import { GoogleGenAI } from "@google/genai";
import { shortHash } from "../util/hash.js";
import { toGeminiJsonSchema } from "./jsonSchema.js";
import { LLMConfigError, LLMOutputError, LLMQuotaError, type LLMProvider, type StructuredRequest, type StructuredResult } from "./provider.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  model?: string;
  /** Optional failover pool: when a model's daily quota is exhausted (HTTP 429 *PerDay* quota), the next model is used for the rest of the process. */
  models?: string[];
  maxRetries?: number;
  /** Called when a failover happens, so the workflow log can record it. */
  onFailover?: (from: string, to: string, reason: string) => void;
}

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gemini provider using the official @google/genai SDK with JSON-schema constrained output.
 * Default text model: gemini-3.6-flash (the API reports gemini-2.5-flash as no longer available to new users).
 * Every response is validated with zod; on validation failure the model is re-prompted once
 * with the validation errors, then the call fails loudly (never silently swallowed).
 */
export class GeminiLLMProvider implements LLMProvider {
  readonly name = "gemini";
  readonly supportsVision = true;
  private ai: GoogleGenAI;
  private maxRetries: number;
  private pool: string[];
  private poolIndex = 0;
  private onFailover?: GeminiProviderOptions["onFailover"];

  /** The model currently in use (changes only after a quota failover). */
  get model(): string {
    return this.pool[this.poolIndex];
  }

  constructor(opts: GeminiProviderOptions) {
    if (opts.vertexai) {
      if (!opts.project) throw new LLMConfigError("GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI=true");
      this.ai = new GoogleGenAI({ vertexai: true, project: opts.project, location: opts.location ?? "us-central1" });
    } else {
      if (!opts.apiKey) throw new LLMConfigError("GEMINI_API_KEY is not set");
      this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    }
    const pool = (opts.models ?? [opts.model ?? "gemini-3.6-flash"]).map((m) => m.trim()).filter(Boolean);
    this.pool = pool.length ? pool : ["gemini-3.6-flash"];
    this.maxRetries = opts.maxRetries ?? 4;
    this.onFailover = opts.onFailover;
  }

  /** Daily free-tier quota exhaustion: not retryable on this model; fail over if a model is left. */
  private failoverIfDailyQuota(err: unknown): boolean {
    const msg = String((err as { message?: string })?.message ?? err);
    if (!/429/.test(msg) || !/PerDay|per day|daily/i.test(msg)) return false;
    if (this.poolIndex + 1 >= this.pool.length) return false;
    const from = this.model;
    this.poolIndex += 1;
    this.onFailover?.(from, this.model, `daily quota exhausted for ${from}`);
    return true;
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
        if (this.failoverIfDailyQuota(err)) continue; // same attempt count, next model
        if (isDailyQuota(err)) throw new LLMQuotaError(`Gemini daily quota exhausted for ${this.model} and no failover model left: ${String((err as Error).message).slice(0, 300)}`, this.model, retryAfter(err));
        if (!isRetryable(err)) throw err;
        if (attempt === this.maxRetries) {
          // Persistent overload/unavailability on this model: try the next model in the pool once.
          if (isOverloaded(err) && this.poolIndex + 1 < this.pool.length) {
            const from = this.model;
            this.poolIndex += 1;
            this.onFailover?.(from, this.model, `${from} unavailable after ${this.maxRetries} retries`);
            attempt = -1;
            delay = 1500;
            continue;
          }
          throw err;
        }
        // Per-minute rate limits: honour the server's retryDelay (capped) instead of a short fixed backoff.
        const serverWait = retryAfter(err);
        const wait = serverWait ? Math.min(serverWait * 1000 + 1000, 75_000) : delay;
        await sleep(wait);
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

function isDailyQuota(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /429/.test(msg) && /PerDay|per day|daily/i.test(msg);
}

function retryAfter(err: unknown): number | undefined {
  const m = /retryDelay["']?\s*[:=]\s*["']?(\d+)s/.exec(String((err as { message?: string })?.message ?? err));
  return m ? Number(m[1]) : undefined;
}

function isOverloaded(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /503|UNAVAILABLE|overloaded|high demand/i.test(msg);
}

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}
