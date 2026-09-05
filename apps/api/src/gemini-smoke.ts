import { z } from "zod";
import { GeminiLLMProvider, GeminiMediaProvider, LLMConfigError } from "@cinememory/core";
import { loadEnv } from "./context.js";

/**
 * Exercises every live Google model path CineMemory depends on and reports, per path, exactly which
 * service/model succeeded or failed (HTTP status / API message). Nothing is faked or skipped silently.
 *
 *   pnpm gemini:smoke            text + vision + image + tts
 *   pnpm gemini:smoke --video    additionally calls Veo (billable, slow)
 */
async function main() {
  loadEnv();
  const env = process.env;
  const vertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true";
  if (!env.GEMINI_API_KEY && !(vertex && env.GOOGLE_CLOUD_PROJECT)) {
    console.error("No credentials: set GEMINI_API_KEY in .env (https://aistudio.google.com/apikey) or GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT with ADC.");
    process.exit(2);
  }
  const results: Array<{ path: string; model: string; ok: boolean; detail: string; ms: number }> = [];
  const run = async (path: string, model: string, fn: () => Promise<string>) => {
    const t = Date.now();
    try {
      const detail = await fn();
      results.push({ path, model, ok: true, detail, ms: Date.now() - t });
      console.log(`✔ ${path} [${model}] ${detail} (${Date.now() - t}ms)`);
    } catch (e) {
      const detail = (e as Error).message.slice(0, 400);
      results.push({ path, model, ok: false, detail, ms: Date.now() - t });
      console.log(`✘ ${path} [${model}] ${detail}`);
    }
  };

  const textModel = env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
  let llm: GeminiLLMProvider | undefined;
  try {
    llm = new GeminiLLMProvider({ apiKey: env.GEMINI_API_KEY, vertexai: vertex, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, model: textModel, maxRetries: 1 });
  } catch (e) {
    if (e instanceof LLMConfigError) console.error(e.message);
    process.exit(2);
  }

  await run("structured JSON (source understanding)", textModel, async () => {
    const r = await llm!.generateStructured({
      task: "smoke_structured",
      system: "Extract characters from the text as JSON.",
      prompt: 'Text: "Maya, a girl with a red backpack, tells Ravi the secret in the old lighthouse."',
      schema: z.object({ characters: z.array(z.object({ id: z.string(), name: z.string(), items: z.array(z.string()) })), location: z.string() }),
      temperature: 0,
    });
    return `${r.data.characters.length} characters, location "${r.data.location}", ${r.provenance.inputTokens ?? "?"}→${r.provenance.outputTokens ?? "?"} tokens`;
  });

  await run("continuity reasoning (knowledge timeline)", textModel, async () => {
    const r = await llm!.generateStructured({
      task: "smoke_reasoning",
      system: "You are a continuity critic. Answer strictly from the timeline.",
      prompt: "Timeline: Maya learns the secret in Scene 3. Ravi is told by Maya in Scene 5. In Scene 4 Ravi says: 'The compass points to light!' Is this a knowledge violation? Explain.",
      schema: z.object({ violation: z.boolean(), code: z.string(), explanation: z.string() }),
      temperature: 0,
    });
    return `violation=${r.data.violation} code=${r.data.code}`;
  });

  const media = new GeminiMediaProvider({ apiKey: env.GEMINI_API_KEY, vertexai: vertex, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, imageModel: env.GEMINI_IMAGE_MODEL, videoModel: env.GEMINI_VIDEO_MODEL, ttsModel: env.GEMINI_TTS_MODEL, enableVideo: process.argv.includes("--video"), videoTimeoutMs: 8 * 60_000 });
  let image: { mimeType: string; bytes: Uint8Array } | undefined;
  await run("image generation (keyframe)", env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image", async () => {
    const img = await media.generateImage({ prompt: "Soft painterly children's animation: a tiny firefly with a warm yellow glow and a tiny blue scarf hovering over a twilight meadow. 16:9.", aspectRatio: "16:9" });
    image = img;
    return `${img.mimeType}, ${img.bytes.length} bytes`;
  });

  await run("image/visual analysis (vision)", textModel, async () => {
    if (!image) throw new Error("skipped: no image from the previous step");
    const r = await llm!.generateStructured({
      task: "smoke_vision",
      system: "Inspect the image and report what you see.",
      prompt: "Does the image show a firefly? Is there a blue scarf? Is the glow yellow?",
      schema: z.object({ firefly: z.boolean(), blueScarf: z.boolean(), yellowGlow: z.boolean(), description: z.string() }),
      images: [{ mimeType: image.mimeType, data: Buffer.from(image.bytes).toString("base64") }],
      temperature: 0,
    });
    return `firefly=${r.data.firefly} blueScarf=${r.data.blueScarf} yellowGlow=${r.data.yellowGlow}`;
  });

  await run("text-to-speech (voice)", env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts", async () => {
    const a = await media.generateSpeech({ text: "It doesn't point north at all. It points to the brightest light!", voiceDescription: "small, bright and a little breathless" });
    return `${a.mimeType}, ${a.bytes.length} bytes, ~${a.durationSec?.toFixed(1)}s`;
  });

  if (process.argv.includes("--video")) {
    await run("video generation (Veo)", env.GEMINI_VIDEO_MODEL ?? "veo-3.0-fast-generate-001", async () => {
      const v = await media.generateVideo({ prompt: "A tiny glowing firefly flies over a twilight meadow, soft painterly animation.", durationSec: 5, aspectRatio: "16:9", startImage: image && image.mimeType !== "image/svg+xml" ? { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString("base64") } : undefined });
      return `${v.mimeType}, ${v.bytes.length} bytes`;
    });
  } else {
    console.log("· video generation (Veo) not attempted (pass --video to call Veo; billable)");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} live model paths succeeded.`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.path} [${f.model}]: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
