import { GoogleGenAI } from "@google/genai";
import type { GeneratedMedia, ImageRequest, MediaGenerationProvider, SpeechRequest, VideoRequest } from "./provider.js";
import { MediaUnavailableError } from "./provider.js";

export interface GeminiMediaOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  imageModel?: string;
  videoModel?: string;
  ttsModel?: string;
  /** Veo calls are slow and billable; disabled unless explicitly enabled. */
  enableVideo?: boolean;
  /** Poll interval for long-running video operations (ms). */
  pollIntervalMs?: number;
  /** Maximum time to wait for a video (ms). */
  videoTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google media generation through the official @google/genai SDK:
 * - keyframes: Gemini image model (`gemini-2.5-flash-image`) or Imagen (`imagen-*`) via generateImages
 * - video: Veo via generateVideos (long-running operation, polled)
 * - speech: Gemini TTS (PCM → WAV)
 * Every asset is stamped with the exact model that produced it.
 */
export class GeminiMediaProvider implements MediaGenerationProvider {
  readonly name = "gemini";
  readonly capabilities: { image: boolean; video: boolean; speech: boolean };
  private ai: GoogleGenAI;
  private imageModel: string;
  private videoModel: string;
  private ttsModel: string;
  private apiKey?: string;
  private pollIntervalMs: number;
  private videoTimeoutMs: number;

  constructor(opts: GeminiMediaOptions) {
    if (opts.vertexai) {
      if (!opts.project) throw new MediaUnavailableError("GOOGLE_CLOUD_PROJECT is required for Vertex AI media generation");
      this.ai = new GoogleGenAI({ vertexai: true, project: opts.project, location: opts.location ?? "us-central1" });
    } else {
      if (!opts.apiKey) throw new MediaUnavailableError("GEMINI_API_KEY is required for Gemini media generation");
      this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
      this.apiKey = opts.apiKey;
    }
    this.imageModel = opts.imageModel ?? "gemini-3.1-flash-image";
    this.videoModel = opts.videoModel ?? "veo-3.1-fast-generate-preview";
    this.ttsModel = opts.ttsModel ?? "gemini-2.5-flash-preview-tts";
    this.pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    this.videoTimeoutMs = opts.videoTimeoutMs ?? 6 * 60_000;
    this.capabilities = { image: true, video: !!opts.enableVideo, speech: true };
  }

  async generateImage(req: ImageRequest): Promise<GeneratedMedia> {
    const started = Date.now();
    if (this.imageModel.startsWith("imagen")) {
      const res = await this.ai.models.generateImages({
        model: this.imageModel,
        prompt: req.prompt,
        config: { numberOfImages: 1, aspectRatio: req.aspectRatio ?? "16:9", negativePrompt: req.negativePrompt },
      });
      const img = res.generatedImages?.[0]?.image;
      if (!img?.imageBytes) throw new MediaUnavailableError(`Imagen returned no image (${this.imageModel})`);
      return {
        kind: "image",
        mimeType: img.mimeType ?? "image/png",
        bytes: Buffer.from(img.imageBytes, "base64"),
        provenance: { provider: this.name, model: this.imageModel, task: "keyframe", createdAt: new Date().toISOString(), latencyMs: Date.now() - started },
      };
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const ref of req.references ?? []) {
      parts.push({ text: `Reference for ${ref.label}:` });
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
    }
    parts.push({ text: `${req.prompt}${req.negativePrompt ? `\nAvoid: ${req.negativePrompt}` : ""}\nAspect ratio ${req.aspectRatio ?? "16:9"}.` });
    const res = await this.ai.models.generateContent({
      model: this.imageModel,
      contents: [{ role: "user", parts }],
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });
    const candidateParts = res.candidates?.[0]?.content?.parts ?? [];
    const imagePart = candidateParts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const text = candidateParts.map((p) => p.text).filter(Boolean).join(" ");
      throw new MediaUnavailableError(`Gemini image model returned no image (${this.imageModel})${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return {
      kind: "image",
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
      bytes: Buffer.from(imagePart.inlineData.data, "base64"),
      provenance: { provider: this.name, model: this.imageModel, task: "keyframe", createdAt: new Date().toISOString(), latencyMs: Date.now() - started, inputTokens: res.usageMetadata?.promptTokenCount, outputTokens: res.usageMetadata?.candidatesTokenCount },
    };
  }

  async generateVideo(req: VideoRequest): Promise<GeneratedMedia> {
    if (!this.capabilities.video) throw new MediaUnavailableError("Video generation is disabled (set ENABLE_VIDEO_GENERATION=true)");
    const started = Date.now();
    let operation = await this.ai.models.generateVideos({
      model: this.videoModel,
      prompt: req.prompt,
      image: req.startImage ? { imageBytes: req.startImage.data, mimeType: req.startImage.mimeType } : undefined,
      config: { aspectRatio: req.aspectRatio ?? "16:9", numberOfVideos: 1, negativePrompt: req.negativePrompt },
    });
    while (!operation.done) {
      if (Date.now() - started > this.videoTimeoutMs) throw new MediaUnavailableError(`Veo operation timed out after ${this.videoTimeoutMs / 1000}s`);
      await sleep(this.pollIntervalMs);
      operation = await this.ai.operations.getVideosOperation({ operation });
    }
    if (operation.error) throw new MediaUnavailableError(`Veo error: ${JSON.stringify(operation.error)}`);
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video) throw new MediaUnavailableError("Veo returned no video");
    let bytes: Uint8Array;
    if (video.videoBytes) bytes = Buffer.from(video.videoBytes, "base64");
    else if (video.uri) {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers["x-goog-api-key"] = this.apiKey;
      const r = await fetch(video.uri, { headers });
      if (!r.ok) throw new MediaUnavailableError(`Failed to download Veo video: HTTP ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } else throw new MediaUnavailableError("Veo video has neither bytes nor uri");
    return {
      kind: "video",
      mimeType: video.mimeType ?? "video/mp4",
      bytes,
      durationSec: req.durationSec,
      provenance: { provider: this.name, model: this.videoModel, task: "video", createdAt: new Date().toISOString(), latencyMs: Date.now() - started },
    };
  }

  async generateSpeech(req: SpeechRequest): Promise<GeneratedMedia> {
    const started = Date.now();
    const styled = req.voiceDescription ? `Say this ${req.voiceDescription}: ${req.text}` : req.text;
    const res = await this.ai.models.generateContent({
      model: this.ttsModel,
      contents: [{ role: "user", parts: [{ text: styled }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceName ?? "Kore" } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new MediaUnavailableError(`Gemini TTS returned no audio (${this.ttsModel})`);
    const mime = part.inlineData.mimeType ?? "audio/L16;codec=pcm;rate=24000";
    const raw = Buffer.from(part.inlineData.data, "base64");
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    const isPcm = /L16|pcm/i.test(mime);
    const bytes = isPcm ? pcmToWav(raw, rate) : raw;
    return {
      kind: "audio",
      mimeType: isPcm ? "audio/wav" : mime,
      bytes,
      durationSec: isPcm ? raw.length / (rate * 2) : undefined,
      provenance: { provider: this.name, model: this.ttsModel, task: "speech", createdAt: new Date().toISOString(), latencyMs: Date.now() - started },
    };
  }
}

/** Wrap 16-bit mono PCM in a WAV container so browsers can play it. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
