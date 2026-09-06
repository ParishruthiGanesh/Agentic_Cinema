"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Provenance, Section, Stat } from "@/components/ui";
import { api, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { secs } from "@/lib/format";

/**
 * Final film player. Plays the assembled manifest as a sequence: a video clip when the shot has one,
 * otherwise the keyframe held for the shot's duration, with per-shot voice tracks and subtitle cues.
 * When an ffmpeg render exists it is offered directly.
 */
export default function FilmPage() {
  const { id, live, summary } = useProject();
  const film = useResource(() => api.film(id), [id, live.tick]);
  const proj = summary.data?.project;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const m = film.data;

  useEffect(() => {
    if (!playing || !m) return;
    last.current = performance.now();
    const step = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= m.totalDurationSec) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, m]);

  const seg = m?.segments.find((s) => t >= s.startSec && t < s.startSec + s.durationSec) ?? m?.segments[0];
  const cue = m?.subtitles.find((c) => t >= c.startSec && t < c.endSec);
  const chapter = m?.chapters.find((c) => t >= c.startSec && t < c.startSec + c.durationSec);

  // Start/stop per-segment audio and video with the timeline.
  useEffect(() => {
    const a = audioRef.current;
    if (a) {
      if (playing && seg?.audio) {
        a.play().catch(() => undefined);
      } else a.pause();
    }
    const v = videoRef.current;
    if (v) {
      if (playing) v.play().catch(() => undefined);
      else v.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg?.shotId, playing]);

  if (film.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!m) return <Empty title="Film not assembled yet" hint="Run the pipeline to “Film assembled”. Keyframes are used for shots without video clips; the player says so." />;

  return (
    <div>
      <PageTitle title={m.title} subtitle={<>{secs(m.totalDurationSec)} · {m.segments.length} segments · {m.chapters.length} chapters · assembled {m.assembledAt.slice(0, 16).replace("T", " ")}</>} actions={m.renderedVideo ? <a className="btn-primary" href={mediaUrl(m.renderedVideo.path)} target="_blank" rel="noreferrer">Open rendered MP4</a> : <Provenance p={m.provenance} />} />
      {proj?.mode === "social_story" && (
        proj.approval ? (
          <div className="mb-4 rounded-lg border border-lime-glow/40 bg-lime-glow/5 px-4 py-2 text-sm text-lime-glow">Approved by {proj.approval.approvedBy} on {proj.approval.approvedAt.slice(0, 10)}{proj.approval.note ? ` · ${proj.approval.note}` : ""}. <Link href={`/projects/${id}/certificate`} className="underline">Certificate</Link></div>
        ) : (
          <div className="mb-4 rounded-lg border border-amber-glow/40 bg-amber-glow/5 px-4 py-2 text-sm text-amber-soft">Not yet approved. Review the <Link href={`/projects/${id}/certificate`} className="underline">Continuity Certificate</Link> and sign it before showing this story to the child.</div>
        )
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="card overflow-hidden">
            <div className="relative aspect-video bg-black">
              {seg?.video ? (
                <video key={seg.shotId} ref={videoRef} src={mediaUrl(seg.video.path)} className="h-full w-full" muted={!!seg.audio} autoPlay={playing} />
              ) : seg?.keyframe ? (
                <img key={seg.shotId} src={mediaUrl(seg.keyframe.path)} alt={seg.shotId} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-sm text-ink-400">no media for {seg?.shotId}</div>
              )}
              {seg?.audio && <audio key={`a-${seg.shotId}`} ref={audioRef} src={mediaUrl(seg.audio.path)} />}
              {cue && <div className="absolute inset-x-0 bottom-8 mx-auto w-fit max-w-[80%] rounded bg-black/70 px-3 py-1 text-center text-base text-white">{cue.speaker && cue.speaker !== "Narrator" ? <span className="text-amber-glow">{cue.speaker}: </span> : null}{cue.text}</div>}
              <div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-xs text-ink-200">{chapter?.title} · {seg?.shotId}{seg && !seg.video ? " · keyframe (no clip)" : ""}</div>
            </div>
            <div className="flex items-center gap-3 border-t border-ink-700/60 px-4 py-3">
              <button className="btn-primary !px-4" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : t > 0 ? "Resume" : "Play"}</button>
              <button className="btn-ghost" onClick={() => { setPlaying(false); setT(0); }}>Restart</button>
              <input type="range" min={0} max={m.totalDurationSec} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} className="flex-1 accent-amber-glow" />
              <span className="w-24 text-right font-mono text-xs text-ink-300">{t.toFixed(1)}s / {m.totalDurationSec.toFixed(0)}s</span>
            </div>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded bg-ink-800">
            {m.segments.map((s) => (
              <button key={s.shotId} title={s.shotId} onClick={() => setT(s.startSec)} style={{ width: `${(s.durationSec / m.totalDurationSec) * 100}%` }} className={`border-r border-ink-950 ${s.video ? "bg-teal-glow/70" : s.keyframe ? "bg-amber-glow/60" : "bg-rose-glow/60"} ${seg?.shotId === s.shotId ? "brightness-150" : ""}`} />
            ))}
          </div>
          <div className="mt-1 flex gap-4 text-[11px] text-ink-400"><span><span className="inline-block h-2 w-2 bg-teal-glow/70" /> video clip</span><span><span className="inline-block h-2 w-2 bg-amber-glow/60" /> keyframe</span><span><span className="inline-block h-2 w-2 bg-rose-glow/60" /> missing</span></div>
        </div>
        <div className="space-y-4">
          <Section title="Chapters">
            <ol className="space-y-1">
              {m.chapters.map((c) => (
                <li key={c.sceneId}><button onClick={() => setT(c.startSec)} className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-ink-800 ${chapter?.sceneId === c.sceneId ? "text-amber-glow" : "text-ink-200"}`}>{c.title} <span className="text-xs text-ink-400">{secs(c.startSec)}</span></button></li>
              ))}
            </ol>
          </Section>
          <Section title="Verification summary">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Checks" value={m.verification.checksEvaluated} />
              <Stat label="Resolved" value={m.verification.violationsResolved} tone="good" />
              <Stat label="Unresolved" value={m.verification.violationsUnresolved} tone={m.verification.violationsUnresolved ? "bad" : "good"} />
            </div>
            {m.verification.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-soft">{m.verification.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
            )}
          </Section>
          <Section title="Subtitles"><a className="text-xs text-amber-glow hover:underline" href={mediaUrl(`${id}/subtitles.vtt`)} target="_blank" rel="noreferrer">Download WebVTT</a><div className="mt-1 text-xs text-ink-400">{m.subtitles.length} cues</div></Section>
        </div>
      </div>
    </div>
  );
}
