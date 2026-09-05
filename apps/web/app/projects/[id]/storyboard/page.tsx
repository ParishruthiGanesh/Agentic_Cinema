"use client";

import { useState } from "react";
import type { Shot } from "@cinememory/core";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Provenance, Section, Spinner } from "@/components/ui";
import { api, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";

export default function StoryboardPage() {
  const { id, live } = useProject();
  const shots = useResource(() => api.shots(id), [id, live.tick]);
  const world = useResource(() => api.world(id), [id, live.tick]);
  const violations = useResource(() => api.violations(id), [id, live.tick]);
  const screenplay = useResource(() => api.screenplay(id), [id, live.tick]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const plan = shots.data;
  if (shots.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!plan || plan.shots.length === 0) return <Empty title="No shots planned yet" hint="The Director Agent plans shots after the screenplay is written." />;
  const name = (cid: string) => world.data?.characters.find((c) => c.id === cid)?.name ?? cid;
  const propName = (pid: string) => world.data?.props.find((p) => p.id === pid)?.name ?? pid;
  const locName = (lid: string) => world.data?.locations.find((l) => l.id === lid)?.name ?? lid;
  const sel = plan.shots.find((s) => s.id === selected) ?? null;
  const shotViolations = (shotId: string) => (violations.data ?? []).filter((v) => v.scope.shotId === shotId && v.status !== "resolved" && v.status !== "overridden");
  const scenes = [...new Set(plan.shots.map((s) => s.sceneId))];

  const generate = async (shotId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.generateShot(id, shotId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="Storyboard"
        subtitle={`${plan.shots.length} shots · statuses reflect persisted generation and verification state`}
        actions={
          <div className="flex gap-1.5">
            {Object.entries(plan.shots.reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {})).map(([k, v]) => <Pill key={k} value={`${k} ${v}`} className={k === "VERIFIED" ? "border-lime-glow/60 text-lime-glow" : k === "FAILED" ? "border-rose-glow/60 text-rose-glow" : "border-ink-600 text-ink-300"} />)}
          </div>
        }
      />
      {error && <div className="mb-3 text-sm text-rose-glow">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
        <div className="space-y-5">
          {scenes.map((sceneId) => {
            const sc = screenplay.data?.scenes.find((s) => s.id === sceneId);
            const list = plan.shots.filter((s) => s.sceneId === sceneId);
            return (
              <div key={sceneId}>
                <div className="label mb-2">Scene {sc?.number ?? sceneId} {sc ? `· ${sc.title} · ${locName(sc.locationId)} · ${sc.timeOfDay}` : ""}</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((s) => {
                    const vs = shotViolations(s.id);
                    const img = mediaUrl(s.keyframe?.path);
                    return (
                      <button key={s.id} onClick={() => setSelected(s.id)} className={`card card-hover overflow-hidden text-left ${selected === s.id ? "!border-amber-glow/70" : ""}`}>
                        <div className="relative aspect-video bg-ink-950">
                          {img ? <img src={img} alt={s.id} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-3 text-center text-xs text-ink-400">{s.framing} · {s.cameraMovement}</div>}
                          <div className="absolute left-2 top-2 flex gap-1"><Pill value={s.status} /></div>
                          {s.keyframe && <div className="absolute bottom-2 right-2"><Provenance p={s.keyframe.provenance} /></div>}
                        </div>
                        <div className="px-3 py-2">
                          <div className="flex items-center justify-between text-xs"><span className="font-mono font-semibold text-ink-100">{s.id}</span><span className="text-ink-400">{s.durationSec}s</span></div>
                          <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-300">{s.action}</div>
                          <div className="mt-1 text-[11px] text-ink-400">{s.characterIds.map(name).join(", ") || "no characters"}{s.propIds.length ? ` · ${s.propIds.map(propName).join(", ")}` : ""}</div>
                          {vs.length > 0 && <div className="mt-1 text-[11px] text-rose-glow">{vs.length} open violation{vs.length > 1 ? "s" : ""}: {vs.map((v) => v.code).join(", ")}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sticky top-[100px] self-start">
          <Section title={sel ? `Shot ${sel.id}` : "Shot detail"} aside={sel ? <button className="btn-primary !py-0.5 !text-xs" disabled={busy || !!live.job} onClick={() => generate(sel.id)}>{busy ? <Spinner className="border-ink-950 border-t-transparent" /> : null} {sel.keyframe ? "Regenerate" : "Generate"}</button> : null}>
            {!sel ? <div className="text-sm text-ink-400">Select a shot to compare its expected state (from CineMemory) with the generated result.</div> : <ShotDetail s={sel} name={name} propName={propName} locName={locName} violations={shotViolations(sel.id)} />}
          </Section>
        </div>
      </div>
    </div>
  );
}

function ShotDetail({ s, name, propName, locName, violations }: { s: Shot; name: (id: string) => string; propName: (id: string) => string; locName: (id: string) => string; violations: Array<{ id: string; code: string; observed: string; expected: string }> }) {
  const img = mediaUrl(s.keyframe?.path);
  const vid = mediaUrl(s.video?.path);
  const aud = mediaUrl(s.audio?.path);
  return (
    <div className="space-y-3 text-sm">
      <div className="aspect-video overflow-hidden rounded-md bg-ink-950">
        {vid ? <video src={vid} controls className="h-full w-full" /> : img ? <img src={img} alt={s.id} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-ink-400">not generated yet</div>}
      </div>
      {s.keyframe && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400"><span>keyframe</span><Provenance p={s.keyframe.provenance} />{s.video && <><span>video</span><Provenance p={s.video.provenance} /></>}{s.audio && <><span>voice</span><Provenance p={s.audio.provenance} /></>}</div>}
      {aud && <audio src={aud} controls className="w-full" />}
      {s.lastError && <div className="text-xs text-rose-glow">Last error: {s.lastError}</div>}
      <div>
        <div className="label mb-1">Expected state (from CineMemory)</div>
        <div className="space-y-1 rounded bg-ink-900/70 p-2 text-xs">
          <div><span className="text-ink-400">Location:</span> {locName(s.locationId)} · {s.timeOfDay} · {s.lighting}</div>
          <div><span className="text-ink-400">Camera:</span> {s.framing}, {s.cameraMovement} · {s.durationSec}s</div>
          {s.characterStates.map((c) => (
            <div key={c.characterId} className="border-t border-ink-700/60 pt-1">
              <span className="font-semibold text-ink-100">{name(c.characterId)}</span> — {c.appearance}; wearing {c.clothing}; {c.emotionalState}{c.holding.length ? `; holding ${c.holding.map(propName).join(", ")}` : ""}{c.position ? ` · ${c.position}` : ""}
            </div>
          ))}
          {s.propIds.length > 0 && <div><span className="text-ink-400">Props:</span> {s.propIds.map(propName).join(", ")}</div>}
          <div><span className="text-ink-400">Inherited constraints:</span> {s.inheritedConstraintIds.length ? s.inheritedConstraintIds.join(", ") : "none (baseline)"}</div>
        </div>
      </div>
      {s.dialogue.length > 0 && (
        <div>
          <div className="label mb-1">Audio</div>
          {s.dialogue.map((d, i) => <div key={i} className="text-xs"><span className="text-amber-glow">{d.type === "narration" ? "Narrator" : name(d.characterId ?? "")}:</span> <span className="text-ink-200">{d.text}</span></div>)}
        </div>
      )}
      <div>
        <div className="label mb-1">Generation prompt</div>
        <pre className="scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">{s.visualPrompt}</pre>
      </div>
      {violations.length > 0 && (
        <div>
          <div className="label mb-1 text-rose-glow">Open violations</div>
          {violations.map((v) => <div key={v.id} className="rounded border border-rose-glow/30 bg-rose-glow/5 p-2 text-xs"><span className="font-mono font-semibold">{v.code}</span> — expected {v.expected}; observed {v.observed}</div>)}
        </div>
      )}
    </div>
  );
}
