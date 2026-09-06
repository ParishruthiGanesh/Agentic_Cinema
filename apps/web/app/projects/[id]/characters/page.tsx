"use client";

import { useState } from "react";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Provenance } from "@/components/ui";
import { api, fileToBase64, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";

export default function CharactersPage() {
  const { id, live } = useProject();
  const world = useResource(() => api.world(id), [id, live.tick]);
  const screenplay = useResource(() => api.screenplay(id), [id, live.tick]);
  const refs = useResource(() => api.references(id), [id, live.tick]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const w = world.data;
  const upload = async (cid: string, file?: File) => {
    if (!file) return;
    setBusy(cid);
    setError(undefined);
    try {
      const data = await fileToBase64(file);
      await api.uploadReference(id, cid, data);
      await refs.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (cid: string) => {
    setBusy(cid);
    try {
      await api.removeReference(id, cid);
      await refs.refresh();
    } finally {
      setBusy(null);
    }
  };
  if (world.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!w) return <Empty title="No characters yet" hint="Run source analysis to extract the character bible." />;
  const sceneNum = (sid: string) => screenplay.data?.scenes.find((s) => s.id === sid)?.number;
  const name = (cid: string) => w.characters.find((c) => c.id === cid)?.name ?? cid;

  return (
    <div>
      <PageTitle title="Character bible" subtitle="Canonical identity from the source. Visual constraints are injected into every shot prompt containing the character and verified by the Visual Critic. Upload a photo or drawing to use it as the identity reference instead of a generated sheet." />
      {error && <div className="mb-3 text-sm text-rose-glow">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {w.characters.map((c) => {
          const vcs = w.visualConstraints.filter((v) => v.entityId === c.id);
          const knows = w.knowledgeFacts.filter((f) => f.holders.some((h) => h.characterId === c.id));
          const unknown = w.knowledgeFacts.filter((f) => !f.holders.some((h) => h.characterId === c.id));
          const rels = w.relationships.filter((r) => r.from === c.id || r.to === c.id);
          const initials = c.name.slice(0, 1).toUpperCase();
          const ref = refs.data?.find((r) => r.characterId === c.id);
          return (
            <div key={c.id} className="card overflow-hidden">
              {ref && (
                <div className="relative aspect-square max-h-56 w-full overflow-hidden bg-ink-950">
                  <img src={mediaUrl(ref.path)} alt={`${c.name} reference`} className="h-full w-full object-cover" />
                  <div className="absolute bottom-2 left-2"><Provenance p={ref.provenance} /></div>
                  <div className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-ink-200">{ref.provenance.provider === "upload" ? "uploaded reference photo" : "reference appearance"}</div>
                </div>
              )}
              <div className="flex items-center gap-2 border-b border-ink-700/60 bg-ink-900/40 px-4 py-1.5 text-[11px] text-ink-400">
                <label className="cursor-pointer text-amber-glow hover:underline">{ref ? "Replace reference with a photo" : "Upload reference photo"}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy === c.id} onChange={(e) => upload(c.id, e.target.files?.[0])} /></label>
                {ref && <button className="text-rose-glow hover:underline" disabled={busy === c.id} onClick={() => remove(c.id)}>remove</button>}
                {busy === c.id && <span>working…</span>}
              </div>
              <div className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900/60 px-4 py-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-amber-glow to-rose-glow text-lg font-bold text-ink-950">{initials}</div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-ink-100">{c.name}</div>
                  <div className="text-xs text-ink-400">{c.role} · {c.appearance.species ?? "character"}{c.appearance.age ? `, ${c.appearance.age}` : ""}</div>
                </div>
              </div>
              <div className="space-y-3 p-4 text-sm">
                <p className="text-ink-200">{c.description}</p>
                <Row k="Appearance" v={c.appearance.summary ?? c.appearance.distinguishingFeatures.join(", ")} />
                {c.appearance.distinguishingFeatures.length > 0 && <Row k="Features" v={c.appearance.distinguishingFeatures.join(" · ")} />}
                <Row k="Clothing" v={c.clothing.summary ?? c.clothing.items.join(", ") ?? "—"} />
                <Row k="Voice" v={[c.voice.description, c.voice.pitch && `pitch ${c.voice.pitch}`, c.voice.pace && `pace ${c.voice.pace}`].filter(Boolean).join(", ") || "—"} />
                <Row k="Personality" v={c.personality.join(", ") || "—"} />
                {c.goals.length > 0 && <Row k="Goals" v={c.goals.join("; ")} />}
                {c.fears.length > 0 && <Row k="Fears" v={c.fears.join("; ")} />}
                <Row k="Relationships" v={rels.length ? rels.map((r) => `${r.from === c.id ? name(r.to) : name(r.from)} (${r.type})`).join(", ") : "—"} />
                <div>
                  <div className="label mb-1">Visual constraints</div>
                  <div className="flex flex-wrap gap-1">
                    {vcs.length === 0 && <span className="text-xs text-ink-400">none</span>}
                    {vcs.map((v) => <Pill key={v.id} value={`${v.attribute}: ${v.value}`} kind="severity" className="!normal-case !tracking-normal" />)}
                  </div>
                </div>
                <div>
                  <div className="label mb-1">Knowledge</div>
                  <ul className="space-y-0.5 text-xs">
                    {knows.map((f) => {
                      const h = f.holders.find((x) => x.characterId === c.id)!;
                      const n = sceneNum(h.acquiredInScene);
                      return <li key={f.id} className="text-lime-glow">✓ {f.statement} <span className="text-ink-400">— {n ? `learns in Scene ${n}` : h.acquiredInScene}{h.via ? ` (${h.via})` : ""}</span></li>;
                    })}
                    {unknown.map((f) => <li key={f.id} className="text-ink-400">✗ {f.statement} — UNKNOWN</li>)}
                    {w.knowledgeFacts.length === 0 && <li className="text-ink-400">no tracked facts</li>}
                  </ul>
                </div>
                <Row k="Scenes" v={c.scene_appearances.length ? c.scene_appearances.map((s) => `S${sceneNum(s) ?? "?"}`).join(", ") : "not yet placed"} />
                {c.sourceEvidence && <div className="border-t border-ink-700/60 pt-2 text-xs italic text-ink-400">“{c.sourceEvidence}”</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <div className="text-xs text-ink-400">{k}</div>
      <div className="text-[13px] text-ink-100">{v}</div>
    </div>
  );
}
