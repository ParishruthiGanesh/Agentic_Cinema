"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, fileToBase64, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { Badge, Button, Card, FamilyPage } from "@/components/family";

/** Family view of a child: photos first, a look preview in the chosen style, and the stories. */
export default function KidPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FamilyPage>
      <Kid id={id} />
    </FamilyPage>
  );
}

function Kid({ id }: { id: string }) {
  const detail = useResource(() => api.child(id), [id], 6000);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const d = detail.data;
  if (!d) return <div className="text-[#7a7264]">Loading…</div>;
  const c = d.child;
  const photoOf = (entityId: string) => d.photos.find((p) => p.entityId === entityId)?.path;
  const preview = (style: "illustrated" | "photo") => d.previews.find((p) => p.style === style);

  const upload = async (entityId: string, kind: "character" | "location", file?: File) => {
    if (!file) return;
    setBusy(entityId);
    setError(undefined);
    try {
      await api.uploadChildPhoto(id, entityId, { ...(await fileToBase64(file)), kind });
      await detail.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const removePhoto = async (entityId: string) => {
    if (!confirm("Remove this photo? Future pictures will follow the written description instead.")) return;
    setBusy(entityId);
    setError(undefined);
    try {
      await api.removeChildPhoto(id, entityId);
      await detail.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const makePreview = async (style: "illustrated" | "photo") => {
    setBusy(`preview-${style}`);
    setError(undefined);
    try {
      await api.previewChild(id, style);
      await detail.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const chooseStyle = async (style: "illustrated" | "photo") => {
    const { id: _id, createdAt, updatedAt, ...rest } = c;
    void _id; void createdAt; void updatedAt;
    await api.updateChild(id, { ...rest, style });
    await detail.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <PhotoTile path={photoOf(id)} label={c.name} busy={busy === id} onFile={(f) => upload(id, "character", f)} onRemove={() => removePhoto(id)} big />
          <div>
            <h1 className="text-3xl font-semibold">{c.name}</h1>
            <div className="text-[#7a7264]">{c.age ? `Age ${c.age} · ` : ""}{c.outfit}</div>
            <Link href={`/kids/${id}/edit`} className="text-sm font-semibold text-[#2f7d4f] hover:underline">Edit details, people, places and how {c.name} likes to watch</Link>
          </div>
        </div>
        <Button href={`/kids/${id}/new-story`}>New story for {c.name}</Button>
      </div>
      {error && <div className="text-sm text-[#a13333]">{error}</div>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">How {c.name} will look in the pictures</div>
            <div className="text-sm text-[#7a7264]">Make a preview in each style and choose the one that looks most like {c.name}. Add a photo above first for the best likeness.</div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["illustrated", "photo"] as const).map((style) => {
            const p = preview(style);
            return (
              <div key={style} className={`rounded-2xl border p-3 ${c.style === style ? "border-[#2f7d4f] bg-[#f3faf5]" : "border-[#eee9dd]"}`}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{d.styles[style].label}{c.style === style && <span className="ml-2 rounded-full bg-[#2f7d4f] px-2 py-0.5 text-xs text-white">chosen</span>}</div>
                  <button className="text-sm font-semibold text-[#2f7d4f] hover:underline" disabled={!!busy} onClick={() => makePreview(style)}>{busy === `preview-${style}` ? "Making…" : p ? "Make again" : "Make a preview"}</button>
                </div>
                <div className="mt-1 text-xs text-[#7a7264]">{d.styles[style].description}</div>
                <div className="mt-3 aspect-square overflow-hidden rounded-xl bg-[#eee9dd]">{p ? <img src={mediaUrl(p.path)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm text-[#a59d8c]">no preview yet</div>}</div>
                {p && <div className="mt-1 text-[11px] text-[#a59d8c]">{p.fromPhoto ? "guided by the photo" : "from the description only"} · {p.createdAt.slice(0, 10)}</div>}
                {c.style !== style && <button className="mt-2 w-full rounded-xl border border-[#c9c1b1] py-2 text-sm font-semibold hover:bg-white" onClick={() => chooseStyle(style)}>Use {d.styles[style].label.toLowerCase()} pictures</button>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="text-lg font-semibold">People and places {c.name} knows</div>
        <div className="text-sm text-[#7a7264]">Add a photo of each person and each real room. The pictures will match them.</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {c.companions.map((p) => <PhotoTile key={p.id} path={photoOf(p.id)} label={`${p.name} (${p.role})`} sub={p.outfit} busy={busy === p.id} onFile={(f) => upload(p.id, "character", f)} onRemove={() => removePhoto(p.id)} />)}
          {c.places.map((p) => <PhotoTile key={p.id} path={photoOf(p.id)} label={p.name} sub={p.description} busy={busy === p.id} onFile={(f) => upload(p.id, "location", f)} onRemove={() => removePhoto(p.id)} />)}
          {c.comfortItems.map((p) => <div key={p.id} className="rounded-xl border border-[#eee9dd] p-3 text-sm"><div className="font-semibold">{p.name}</div><div className="text-xs text-[#7a7264]">{p.description}</div></div>)}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between"><div className="text-lg font-semibold">Stories</div><Link href={`/kids/${id}/new-story`} className="text-sm font-semibold text-[#2f7d4f] hover:underline">New story</Link></div>
        {d.stories.length === 0 && <div className="mt-2 text-sm text-[#7a7264]">No stories yet.</div>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {d.stories.map((s) => (
            <Link key={s.project.id} href={`/stories/${s.project.id}`} className="flex gap-3 rounded-xl border border-[#eee9dd] p-3 hover:bg-[#fbf8f1]">
              <div className="h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[#eee9dd]">{s.coverPath && <img src={mediaUrl(s.coverPath)} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.project.title}</div>
                <div className="text-xs text-[#7a7264]">{s.project.socialStory?.steps.length} steps · {s.project.updatedAt.slice(0, 10)}{s.outcomes.length ? ` · ${s.outcomes[0].visitOutcome.replace(/_/g, " ")}` : ""}</div>
                <div className="mt-1">{s.story && <Badge code={s.story.code} label={s.story.label} />}</div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PhotoTile({ path, label, sub, busy, onFile, onRemove, big }: { path?: string; label: string; sub?: string; busy: boolean; onFile: (f?: File) => void; onRemove?: () => void; big?: boolean }) {
  return (
    <div className={`relative ${big ? "" : "rounded-xl border border-[#eee9dd] p-3"}`}>
      <label className="block cursor-pointer" title={path ? "Click to replace the photo" : "Add a photo"}>
        <div className={`overflow-hidden rounded-xl bg-[#eee9dd] ${big ? "h-24 w-24" : "aspect-video w-full"}`}>{path ? <img src={mediaUrl(path)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-[#a59d8c]">{busy ? "uploading…" : "add photo"}</div>}</div>
        {!big && <div className="mt-2 text-sm font-semibold">{label}</div>}
        {!big && sub && <div className="text-xs text-[#7a7264]">{sub}</div>}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {path && onRemove && (
        <button type="button" aria-label="Remove photo" title="Remove photo" disabled={busy} onClick={onRemove} className={`absolute grid h-7 w-7 place-items-center rounded-full bg-white/95 text-base leading-none text-[#a13333] shadow ring-1 ring-[#e6dfd0] hover:bg-[#fde7e7] ${big ? "-right-2 -top-2" : "right-5 top-5"}`}>×</button>
      )}
      {path && !big && <div className="mt-1 text-[11px] text-[#a59d8c]">Click the picture to replace it.</div>}
    </div>
  );
}
