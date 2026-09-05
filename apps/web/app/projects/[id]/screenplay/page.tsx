"use client";

import { useState } from "react";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Provenance, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { secs } from "@/lib/format";

export default function ScreenplayPage() {
  const { id, live } = useProject();
  const screenplay = useResource(() => api.screenplay(id), [id, live.tick]);
  const world = useResource(() => api.world(id), [id, live.tick]);
  const changes = useResource(() => api.changes(id), [id, live.tick]);
  const violations = useResource(() => api.violations(id), [id, live.tick]);
  const [ctxScene, setCtxScene] = useState<string | null>(null);
  const sceneCtx = useResource(ctxScene ? () => api.sceneContext(id, ctxScene) : null, [id, ctxScene, live.tick]);

  const sp = screenplay.data;
  if (screenplay.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!sp) return <Empty title="No screenplay yet" hint="The Screenplay Agent runs after adaptation." />;
  const name = (cid?: string) => (cid ? (world.data?.characters.find((c) => c.id === cid)?.name ?? cid) : "");
  const loc = (lid: string) => world.data?.locations.find((l) => l.id === lid)?.name ?? lid;

  return (
    <div>
      <PageTitle
        title={sp.title}
        subtitle={<>{sp.logline} · {sp.scenes.length} scenes · {secs(sp.totalDurationSec)} · version {sp.version}</>}
        actions={<Provenance p={sp.provenance} />}
      />
      {sp.revisions.length > 0 && (
        <div className="card mb-4 p-3 text-xs">
          <div className="label mb-1">Repair revisions</div>
          {sp.revisions.map((r) => (
            <div key={r.version} className="text-ink-300">v{r.version} · Scene {sp.scenes.find((s) => s.id === r.sceneId)?.number} · {r.reason} <Provenance p={r.provenance} /></div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {sp.acts.map((act) => (
            <div key={act.number}>
              <div className="label mb-2">Act {act.number} — {act.title}{act.purpose ? ` · ${act.purpose}` : ""}</div>
              {sp.scenes.filter((s) => s.act === act.number).map((s) => {
                const vs = (violations.data ?? []).filter((v) => v.scope.sceneId === s.id && v.status !== "resolved");
                const sceneChanges = (changes.data ?? []).filter((c) => c.sceneId === s.id);
                return (
                  <Section
                    key={s.id}
                    className="mb-3"
                    title={<span>Scene {s.number} · {s.title} <span className="ml-2 font-normal text-ink-400">{loc(s.locationId)} · {s.timeOfDay} · {s.durationSec}s</span></span>}
                    aside={
                      <div className="flex items-center gap-2">
                        {vs.map((v) => <Pill key={v.id} value={v.code} className={v.status === "escalated" ? "border-violet-glow/60 text-violet-glow" : "border-rose-glow/60 text-rose-glow"} />)}
                        <button className="text-xs text-amber-glow hover:underline" onClick={() => setCtxScene(ctxScene === s.id ? null : s.id)}>{ctxScene === s.id ? "hide memory" : "retrieved memory"}</button>
                      </div>
                    }
                  >
                    <div className="mb-2 text-xs text-ink-400"><span className="text-ink-300">Objective:</span> {s.objective} · <span className="text-ink-300">Mood:</span> {s.emotionalState} · <span className="text-ink-300">Cast:</span> {s.characterIds.map(name).join(", ")}</div>
                    <div className="space-y-1.5">
                      {s.lines.map((l, i) => {
                        const hit = vs.find((v) => v.scope.lineIndex === i);
                        return (
                          <div key={i} className={`rounded px-2 py-1 ${hit ? "bg-rose-glow/10 ring-1 ring-rose-glow/40" : ""}`}>
                            {l.type === "dialogue" ? (
                              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                                <span className="font-semibold uppercase tracking-wide text-amber-glow">{name(l.characterId)}{l.emotion ? <span className="block text-[10px] font-normal normal-case tracking-normal text-ink-400">({l.emotion})</span> : null}</span>
                                <span className="text-ink-100">{l.text}</span>
                              </div>
                            ) : l.type === "narration" ? (
                              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm"><span className="font-semibold uppercase tracking-wide text-teal-glow">Narrator</span><span className="italic text-ink-200">{l.text}</span></div>
                            ) : (
                              <div className="pl-[128px] text-[13px] text-ink-300">{l.text}</div>
                            )}
                            {hit && <div className="mt-1 pl-[128px] text-xs text-rose-glow">{hit.code}: {hit.observed}</div>}
                          </div>
                        );
                      })}
                    </div>
                    {(s.knowledgeReveals.length > 0 || s.propTransfers.length > 0 || sceneChanges.length > 0) && (
                      <div className="mt-3 border-t border-ink-700/60 pt-2 text-xs text-ink-400">
                        <span className="label">State changes</span>
                        <ul className="mt-1 space-y-0.5">
                          {s.knowledgeReveals.map((r, i) => <li key={`r${i}`} className="text-violet-glow">🔑 {name(r.toCharacterId)} learns “{world.data?.knowledgeFacts.find((f) => f.id === r.factId)?.statement ?? r.factId}” — {r.via}</li>)}
                          {sceneChanges.filter((c) => c.field !== "knowledge").map((c) => <li key={c.id}>↳ {name(c.entityId)}.{c.field}: {String(c.before ?? "∅")} → {String(c.after)} <span className="text-ink-500">({c.reason})</span></li>)}
                        </ul>
                      </div>
                    )}
                  </Section>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sticky top-[100px] self-start">
          <Section title={ctxScene ? `Retrieved memory · ${ctxScene.replace("_", " ")}` : "Retrieved memory"}>
            {!ctxScene ? (
              <div className="text-sm text-ink-400">Click “retrieved memory” on a scene to see exactly what CineMemory hands to agents for that scene: character state at scene start, facts they must not reference, and the constraints in force. This replaces stuffing the whole screenplay into every prompt.</div>
            ) : !sceneCtx.data ? (
              <div className="text-sm text-ink-400">Loading…</div>
            ) : (
              <div className="space-y-3 text-xs">
                {sceneCtx.data.characters.map((c) => (
                  <div key={c.character.id} className="rounded bg-ink-900/70 p-2">
                    <div className="text-sm font-semibold text-ink-100">{c.character.name}</div>
                    <div className="text-ink-300">at: {loc(c.current_location) || "—"} · mood: {c.emotional_state || "—"}</div>
                    <div className="text-ink-300">holding: {c.inventory.join(", ") || "nothing"}</div>
                    <div className="text-ink-300">knows: {c.knowledge.join(", ") || "nothing special"}</div>
                  </div>
                ))}
                {sceneCtx.data.forbiddenFacts.length > 0 && (
                  <div>
                    <div className="label mb-1 text-rose-glow">Must not reference</div>
                    {sceneCtx.data.forbiddenFacts.map((f) => <div key={f.fact.id} className="text-ink-200">“{f.fact.statement}” — unknown to {f.unknownTo.map(name).join(", ")}{f.knownBy.length ? ` (known to ${f.knownBy.map(name).join(", ")})` : ""}</div>)}
                  </div>
                )}
                <div>
                  <div className="label mb-1">Constraints in force</div>
                  {sceneCtx.data.visualConstraints.map((v) => <div key={v.id} className="text-ink-300">👁 {v.entityId}.{v.attribute} = {v.value}</div>)}
                  {sceneCtx.data.continuityConstraints.map((c) => <div key={c.id} className="text-ink-300">⛓ {c.statement}</div>)}
                  {sceneCtx.data.sourceConstraints.map((c) => <div key={c.id} className="text-ink-300">📜 {c.statement}</div>)}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
