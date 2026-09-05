import type { Provenance } from "../model/index.js";

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Reference images (base64) to anchor character identity where the model supports it. */
  references?: Array<{ mimeType: string; data: string; label: string }>;
  /** Text label used only by the placeholder provider to describe the shot. */
  label?: string;
}

export interface VideoRequest {
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  aspectRatio?: "16:9" | "9:16";
  /** Optional starting keyframe (base64) for image-to-video models. */
  startImage?: { mimeType: string; data: string };
}

export interface SpeechRequest {
  text: string;
  voiceDescription?: string;
  voiceName?: string;
  language?: string;
}

export interface GeneratedMedia {
  kind: "image" | "video" | "audio";
  mimeType: string;
  /** Raw bytes to be written by the caller. */
  bytes: Uint8Array;
  durationSec?: number;
  width?: number;
  height?: number;
  provenance: Provenance;
}

export interface MediaCapabilities {
  image: boolean;
  video: boolean;
  speech: boolean;
}

/**
 * Media generation abstraction. Providers are swappable; the pipeline never depends on a
 * specific model. Implementations must never claim output came from a model that did not produce it.
 */
export interface MediaGenerationProvider {
  readonly name: string;
  readonly capabilities: MediaCapabilities;
  generateImage(req: ImageRequest): Promise<GeneratedMedia>;
  generateVideo(req: VideoRequest): Promise<GeneratedMedia>;
  generateSpeech(req: SpeechRequest): Promise<GeneratedMedia>;
}

export class MediaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUnavailableError";
  }
}
