"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { SensoryProfile } from "@cinememory/core";
import { api, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";

const DEFAULT_SENSORY: SensoryProfile = { reducedMotion: true, sound: "on", showText: true, largeText: false, pacing: "slow" };

/**
 * Child-facing player. No dashboard, no timeline, no surprises: one picture at a time, the child's own words,
 * one big button to go on, one to hear it again. The child's sensory profile decides motion, sound, text and pacing.
 * Only approved stories play unless an adult opens it with ?preview=1.
 */
export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <Player />
    </Suspense>
  );
}

function Player() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const preview = search.get("preview") === "1";
  const summary = useResource(() => api.project(id), [id]);
  const film = useResource(() => api.film(id), [id]);
  const project = summary.data?.project;
  const childId = project?.childId;
  const child = useResource(childId ? () => api.child(childId) : null, [childId]);
  const base = child.data?.child.sensory ?? DEFAULT_SENSORY;
  const [sensory, setSensory] = useState<SensoryProfile>(DEFAULT_SENSORY);
  useEffect(() => setSensory(base), [base]);
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // One "page" per scene: the first segment of each chapter carries the picture; all lines of the scene are the words.
  const pages = useMemo(() => {
    const m = film.data;
    if (!m) return [];
    return m.chapters.map((c) => {
      const segs = m.segments.filter((s) => s.sceneId === c.sceneId);
      const words = m.subtitles.filter((s) => s.startSec >= c.startSec && s.startSec < c.startSec + c.durationSec).map((s) => s.text);
      return { title: c.title.replace(/^Scene \d+: /, ""), keyframe: segs.find((s) => s.keyframe)?.keyframe, audio: segs.map((s) => s.audio).filter(Boolean), words, durationSec: c.durationSec };
    });
  }, [film.data]);
  const page = pages[i];

  // Play the voice when a page opens (if sound is on); auto-advance only in "normal" pacing.
  useEffect(() => {
    const a = audio.current;
    if (!a || !page) return;
    a.pause();
    if (sensory.sound === "on" && page.audio[0]) {
      a.src = mediaUrl(page.audio[0].path) ?? "";
      a.play().catch(() => undefined);
    }
    if (sensory.pacing === "normal") {
      const t = setTimeout(() => (i < pages.length - 1 ? setI(i + 1) : setDone(true)), Math.max(4000, page.durationSec * 1000));
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, page, sensory.sound, sensory.pacing]);

  const approved = !!project?.approval;
  const blocked = project?.mode === "social_story" && !approved && !preview;
  const textSize = sensory.largeText ? "text-3xl md:text-5xl" : "text-2xl md:text-4xl";
  const transition = sensory.reducedMotion ? "" : "transition-opacity duration-500";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f1e7] text-[#26221c]" style={{ fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif" }}>
      <audio ref={audio} />
      {blocked ? (
        <Centered>
          <div className="text-2xl font-semibold">This story is waiting for a grown-up to check it.</div>
          <div className="mt-2 text-base text-[#5b554b]">A parent or therapist approves the Continuity Certificate first.</div>
          <div className="mt-6 flex gap-3"><Link href={`/projects/${id}/certificate`} className="rounded-xl bg-[#26221c] px-5 py-3 text-white">Open the certificate</Link><Link href={`/watch/${id}?preview=1`} className="rounded-xl border border-[#26221c] px-5 py-3">Preview anyway (adult)</Link></div>
        </Centered>
      ) : !film.data && !film.loading ? (
        <Centered><div className="text-2xl font-semibold">The pictures are not ready yet.</div><Link href={`/projects/${id}/production`} className="mt-4 underline">Open production</Link></Centered>
      ) : !page ? (
        <Centered><div className="text-xl">Loading…</div></Centered>
      ) : done ? (
        <Centered>
          <div className="text-4xl font-semibold">The end</div>
          <div className="mt-2 text-xl text-[#5b554b]">{child.data?.child.name ?? "You"} did it.</div>
          <button className="mt-8 rounded-2xl bg-[#2f7d4f] px-8 py-5 text-2xl font-semibold text-white" onClick={() => { setI(0); setDone(false); }}>Watch again</button>
        </Centered>
      ) : (
        <>
          <div className="flex items-center justify-between px-5 py-3 text-sm text-[#5b554b]">
            <span>{i + 1} of {pages.length}{preview && !approved ? " · preview (not approved)" : ""}</span>
            <div className="flex items-center gap-3">
              <button className="rounded-lg border border-[#c9c1b1] px-3 py-1" onClick={() => setShowSettings((s) => !s)} aria-label="Settings">⚙︎</button>
              <Link href={`/projects/${id}/certificate`} className="rounded-lg border border-[#c9c1b1] px-3 py-1" aria-label="Exit">Exit</Link>
            </div>
          </div>
          {showSettings && (
            <div className="mx-5 mb-2 flex flex-wrap gap-4 rounded-xl bg-white/70 px-4 py-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={sensory.sound === "on"} onChange={(e) => setSensory({ ...sensory, sound: e.target.checked ? "on" : "off" })} /> Voice</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sensory.showText} onChange={(e) => setSensory({ ...sensory, showText: e.target.checked })} /> Words</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sensory.largeText} onChange={(e) => setSensory({ ...sensory, largeText: e.target.checked })} /> Big words</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sensory.pacing === "normal"} onChange={(e) => setSensory({ ...sensory, pacing: e.target.checked ? "normal" : "slow" })} /> Go on by itself</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!sensory.reducedMotion} onChange={(e) => setSensory({ ...sensory, reducedMotion: !e.target.checked })} /> Fades</label>
            </div>
          )}
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-6">
            <div className={`w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-md ${transition}`} key={sensory.reducedMotion ? undefined : i}>
              {page.keyframe ? <img src={mediaUrl(page.keyframe.path)} alt="" className="aspect-video w-full object-cover" /> : <div className="grid aspect-video place-items-center text-[#5b554b]">No picture</div>}
            </div>
            {sensory.showText && (
              <div className={`max-w-4xl text-center font-medium leading-snug ${textSize}`}>{page.words.join(" ")}</div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button className="rounded-2xl border-2 border-[#26221c] bg-white px-6 py-4 text-xl" onClick={() => { const a = audio.current; if (a && page.audio[0]) { a.currentTime = 0; a.play().catch(() => undefined); } }} disabled={sensory.sound === "off" || !page.audio[0]}>Again</button>
              {i > 0 && <button className="rounded-2xl border-2 border-[#26221c] bg-white px-6 py-4 text-xl" onClick={() => setI(i - 1)}>Back</button>}
              <button className="rounded-2xl bg-[#2f7d4f] px-10 py-5 text-2xl font-semibold text-white" onClick={() => (i < pages.length - 1 ? setI(i + 1) : setDone(true))}>{i < pages.length - 1 ? "Next" : "Finish"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">{children}</div>;
}
