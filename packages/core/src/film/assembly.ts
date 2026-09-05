import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentContext } from "../agents/context.js";
import type { FilmManifest, Project } from "../model/index.js";

/**
 * Final film assembly. Produces a manifest the browser sequencer plays (clips where they exist,
 * keyframes otherwise, per-shot voice tracks, subtitles and scene chapters). When ffmpeg is available
 * and every segment has a real video clip, it additionally renders a single MP4.
 */
export async function assembleFilm(ctx: AgentContext, project: Project): Promise<FilmManifest> {
  const { repo, events, config } = ctx;
  const plan = repo.getShotPlan(project.id);
  const screenplay = repo.getScreenplay(project.id);
  if (!plan || !screenplay) throw new Error("Film assembly requires a screenplay and a shot plan");
  events.emit(project.id, "film_assembler", "film.assembly.started", `Assembling ${plan.shots.length} shots`, {});

  const shots = [...plan.shots].sort((a, b) => a.sceneNumber - b.sceneNumber || a.index - b.index);
  const segments: FilmManifest["segments"] = [];
  const subtitles: FilmManifest["subtitles"] = [];
  const chapters: FilmManifest["chapters"] = [];
  const world = repo.getWorld(project.id);
  const name = (id?: string) => (id ? (world?.characters.find((c) => c.id === id)?.name ?? id) : "Narrator");
  let t = 0;
  let currentScene = "";
  for (const s of shots) {
    if (s.sceneId !== currentScene) {
      const scene = screenplay.scenes.find((x) => x.id === s.sceneId);
      chapters.push({ sceneId: s.sceneId, title: scene ? `Scene ${scene.number}: ${scene.title}` : s.sceneId, startSec: t, durationSec: 0 });
      currentScene = s.sceneId;
    }
    const dur = s.video?.durationSec ?? s.durationSec;
    segments.push({ shotId: s.id, sceneId: s.sceneId, startSec: t, durationSec: dur, video: s.video, keyframe: s.keyframe, audio: s.audio });
    const spoken = s.dialogue.filter((d) => d.text.trim());
    if (spoken.length) {
      const slice = dur / spoken.length;
      spoken.forEach((d, i) => subtitles.push({ startSec: t + i * slice, endSec: t + (i + 1) * slice, text: d.text, speaker: d.type === "narration" ? "Narrator" : name(d.characterId) }));
    }
    t += dur;
    chapters[chapters.length - 1].durationSec += dur;
  }

  const violations = repo.listViolations(project.id);
  const checks = repo.listChecks(project.id).filter((c) => c.outcome !== "not_evaluated");
  const unresolved = violations.filter((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated");
  const warnings: string[] = unresolved.map((v) => `${v.code}${v.scope.sceneNumber ? ` (Scene ${v.scope.sceneNumber})` : ""}: ${v.observed}`);
  const missingClips = segments.filter((s) => !s.video).length;
  if (missingClips) warnings.push(`${missingClips} of ${segments.length} segments have no video clip and play as keyframes`);
  const placeholderFrames = segments.filter((s) => s.keyframe?.provenance.provider === "placeholder").length;
  if (placeholderFrames) warnings.push(`${placeholderFrames} keyframes are development placeholders, not model output`);

  let renderedVideo: FilmManifest["renderedVideo"];
  if (missingClips === 0 && segments.length > 0) {
    try {
      renderedVideo = await renderWithFfmpeg(ctx, project, segments);
      if (renderedVideo) events.emit(project.id, "film_assembler", "film.rendered", `Rendered ${renderedVideo.path} with ffmpeg`, {}, "success");
    } catch (e) {
      events.emit(project.id, "film_assembler", "film.render.skipped", `ffmpeg render skipped: ${(e as Error).message}`, {}, "warn");
    }
  }

  const manifest: FilmManifest = {
    projectId: project.id,
    title: screenplay.title,
    totalDurationSec: t,
    segments,
    chapters,
    subtitles,
    renderedVideo,
    verification: { checksEvaluated: checks.length, violationsResolved: violations.filter((v) => v.status === "resolved").length, violationsUnresolved: unresolved.length, warnings },
    assembledAt: new Date().toISOString(),
    provenance: { provider: "deterministic", model: "assembler", task: "film_assembly", createdAt: new Date().toISOString() },
  };
  repo.saveFilm(manifest);
  await mkdir(join(config.mediaDir, project.id), { recursive: true });
  await writeFile(join(config.mediaDir, project.id, "subtitles.vtt"), toVtt(subtitles));
  events.emit(project.id, "film_assembler", "film.assembly.completed", `Film assembled: ${segments.length} segments, ${Math.round(t)}s, ${unresolved.length} unresolved warning${unresolved.length === 1 ? "" : "s"}`, { totalDurationSec: t }, unresolved.length ? "warn" : "success");
  return manifest;
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
}

export function toVtt(cues: FilmManifest["subtitles"]): string {
  return "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${fmt(c.startSec)} --> ${fmt(c.endSec)}\n${c.speaker ? `<v ${c.speaker}>` : ""}${c.text}\n`).join("\n");
}

async function renderWithFfmpeg(ctx: AgentContext, project: Project, segments: FilmManifest["segments"]): Promise<FilmManifest["renderedVideo"]> {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const available = await new Promise<boolean>((resolve) => {
    const p = spawn(ffmpeg, ["-version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
  if (!available) throw new Error(`ffmpeg not available (${ffmpeg}); set FFMPEG_PATH to render an MP4`);
  const dir = join(ctx.config.mediaDir, project.id);
  const listPath = join(dir, "concat.txt");
  await writeFile(listPath, segments.map((s) => `file '${join(ctx.config.mediaDir, s.video!.path).replace(/'/g, "'\\''")}'`).join("\n"));
  const outRel = `${project.id}/film.mp4`;
  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", join(ctx.config.mediaDir, outRel)]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
  return { kind: "video", path: outRel, mimeType: "video/mp4", durationSec: segments.reduce((a, s) => a + s.durationSec, 0), provenance: { provider: "ffmpeg", model: "concat", task: "film_render", createdAt: new Date().toISOString() } };
}
