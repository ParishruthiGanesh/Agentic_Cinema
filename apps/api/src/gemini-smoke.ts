import { createRequire } from "node:module";
import { z } from "zod";
const require = createRequire(import.meta.url);
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

  const textModel = env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash";
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
  await run("image generation (keyframe)", env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image", async () => {
    const img = await media.generateImage({ prompt: "Soft painterly children's animation: a tiny firefly with a warm yellow glow and a tiny blue scarf hovering over a twilight meadow. 16:9.", aspectRatio: "16:9" });
    image = img;
    return `${img.mimeType}, ${img.bytes.length} bytes`;
  });

  await run("image/visual analysis (vision)", textModel, async () => {
    if (!image) {
      // No generated image (e.g. no image quota): verify the vision path with a locally synthesised PNG
      // (a yellow disc on a dark blue field). Clearly labelled; it only proves the call path works.
      image = { mimeType: "image/png", bytes: syntheticPng() };
      console.log("  (using a synthetic PNG: yellow disc on dark blue — image generation had no quota)");
    }
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
    await run("video generation (Veo)", env.GEMINI_VIDEO_MODEL ?? "veo-3.1-fast-generate-preview", async () => {
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

/** Minimal PNG encoder (RGB, no dependencies): a yellow disc on a dark blue background. */
function syntheticPng(w = 256, h = 256): Uint8Array {
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 4) ** 2;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = inside ? 245 : 16; raw[o + 1] = inside ? 185 : 24; raw[o + 2] = inside ? 66 : 64;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
