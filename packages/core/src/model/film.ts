import { z } from "zod";
import { Id, Provenance } from "./common.js";
import { MediaAsset } from "./shot.js";

export const SubtitleCue = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  speaker: z.string().optional(),
});

export const FilmSegment = z.object({
  shotId: Id,
  sceneId: Id,
  startSec: z.number(),
  durationSec: z.number(),
  /** Video preferred; keyframe fallback (labelled in UI). */
  video: MediaAsset.optional(),
  keyframe: MediaAsset.optional(),
  audio: MediaAsset.optional(),
});

export const Chapter = z.object({
  sceneId: Id,
  title: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
});

export const FilmManifest = z.object({
  projectId: Id,
  title: z.string(),
  totalDurationSec: z.number(),
  segments: z.array(FilmSegment),
  chapters: z.array(Chapter),
  subtitles: z.array(SubtitleCue),
  /** Present only when an ffmpeg render succeeded. */
  renderedVideo: MediaAsset.optional(),
  verification: z.object({
    checksEvaluated: z.number().int(),
    violationsResolved: z.number().int(),
    violationsUnresolved: z.number().int(),
    warnings: z.array(z.string()),
  }),
  assembledAt: z.string(),
  provenance: Provenance,
});
export type FilmManifest = z.infer<typeof FilmManifest>;
