"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ChildProfileInput } from "@cinememory/core";
import { api, fileToBase64, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { STAGES, stageIndex, timeAgo } from "@/lib/format";
import { PageTitle, Pill, Section, Spinner } from "@/components/ui";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item";
const OUTCOME_LABEL: Record<string, string> = { went_well: "went well", some_difficulty: "some difficulty", difficult: "difficult", did_not_happen: "did not happen" };

const blank: ChildProfileInput = { name: "", age: "", appearance: "", outfit: "", comfortItems: [], companions: [], places: [], mustNotShow: [], calmingRules: [], sensory: { reducedMotion: true, sound: "on", showText: true, largeText: false, pacing: "slow" }, style: "illustrated", guardian: "", notes: "" };

/** Child profile: edit once, reuse in every story; see every story and what happened after each real visit. */
export function ChildEditor({ id, family = false }: { id: string; family?: boolean }) {
  const params = { id };
  const router = useRouter();
  const isNew = params.id === "new";
  const base = family ? "/kids" : "/children";
  const detail = useResource(isNew ? null : () => api.child(params.id), [params.id]);
  const [form, setForm] = useState<ChildProfileInput>(blank);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (detail.data) {
      const { id, createdAt, updatedAt, ...rest } = detail.data.child;
      void id; void createdAt; void updatedAt;
      setForm(rest);
    }
  }, [detail.data]);
  const set = (patch: Partial<ChildProfileInput>) => setForm((f) => ({ ...f, ...patch }));
  const childKey = slug(form.name || "child");

  const save = async () => {
    setBusy("save");
    setError(undefined);
    try {
      const saved = isNew ? await api.saveChild(form) : await api.updateChild(params.id, form);
      if (isNew) router.push(`${base}/${saved.id}`);
      else await detail.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const upload = async (entityId: string, kind: "character" | "location", file?: File) => {
    if (!file || isNew) return;
    setBusy(entityId);
    try {
      const data = await fileToBase64(file);
      await api.uploadChildPhoto(params.id, entityId, { ...data, kind });
      await detail.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const photoFor = (entityId: string) => detail.data?.photos.find((p) => p.entityId === entityId);
  const d = detail.data;

  return (
    <div>
      <PageTitle title={isNew ? "New child profile" : (d?.child.name ?? params.id)} subtitle="Stored once, reused by every story. Photos stay on your server and are used only as identity and place references for the pictures." actions={!isNew ? <><Link href={family ? `/kids/${params.id}/new-story` : `/projects/new?child=${params.id}`} className="btn-primary">New story for {d?.child.name ?? "this child"}</Link></> : null} />
      {error && <div className="mb-3 text-sm text-rose-glow">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Section title="Who they are">
            <div className="grid gap-3 md:grid-cols-2">
              <F label="Name"><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></F>
              <F label="Age"><input className="input" value={form.age ?? ""} onChange={(e) => set({ age: e.target.value })} /></F>
              <F label="How they look (locked in every picture)"><textarea className="input min-h-[60px]" value={form.appearance} onChange={(e) => set({ appearance: e.target.value })} /></F>
              <F label="The one outfit"><textarea className="input min-h-[60px]" value={form.outfit} onChange={(e) => set({ outfit: e.target.value })} /></F>
              <F label="Guardian / therapist"><input className="input" value={form.guardian ?? ""} onChange={(e) => set({ guardian: e.target.value })} /></F>
              <F label="Notes"><input className="input" value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></F>
            </div>
            {!isNew && <PhotoRow label={`Photo of ${form.name || "the child"}`} photo={photoFor(childKey)?.path} busy={busy === childKey} onFile={(f) => upload(childKey, "character", f)} onRemove={() => api.removeChildPhoto(params.id, childKey).then(() => detail.refresh())} />}
          </Section>

          <Section title="People they know" aside={<button className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ companions: [...form.companions, { id: `person_${form.companions.length + 1}`, name: "", role: "", appearance: "", outfit: "" }] })}>Add</button>}>
            <div className="space-y-2">
              {form.companions.map((c, i) => (
                <div key={i} className="rounded-md border border-ink-700/60 p-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <input className="input" placeholder="Name" value={c.name} onChange={(e) => set({ companions: form.companions.map((x, j) => (j === i ? { ...x, name: e.target.value, id: slug(e.target.value) || x.id } : x)) })} />
                    <input className="input" placeholder="Role" value={c.role} onChange={(e) => set({ companions: form.companions.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
                    <input className="input" placeholder="How they look" value={c.appearance} onChange={(e) => set({ companions: form.companions.map((x, j) => (j === i ? { ...x, appearance: e.target.value } : x)) })} />
                    <input className="input" placeholder="What they wear" value={c.outfit} onChange={(e) => set({ companions: form.companions.map((x, j) => (j === i ? { ...x, outfit: e.target.value } : x)) })} />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    {!isNew ? <PhotoRow label="Photo" photo={photoFor(c.id)?.path} busy={busy === c.id} onFile={(f) => upload(c.id, "character", f)} onRemove={() => api.removeChildPhoto(params.id, c.id).then(() => detail.refresh())} /> : <span />}
                    <button className="btn-danger !py-0.5 !text-xs" onClick={() => set({ companions: form.companions.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Familiar places" aside={<button className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ places: [...form.places, { id: `place_${form.places.length + 1}`, name: "", description: "" }] })}>Add</button>}>
            <div className="space-y-2">
              {form.places.map((p, i) => (
                <div key={i} className="rounded-md border border-ink-700/60 p-2">
                  <div className="grid gap-2 md:grid-cols-[200px_1fr]">
                    <input className="input" placeholder="Name (e.g. Home hallway)" value={p.name} onChange={(e) => set({ places: form.places.map((x, j) => (j === i ? { ...x, name: e.target.value, id: slug(e.target.value) || x.id } : x)) })} />
                    <input className="input" placeholder="What it looks like" value={p.description} onChange={(e) => set({ places: form.places.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    {!isNew ? <PhotoRow label="Photo of the real place" photo={photoFor(p.id)?.path} busy={busy === p.id} onFile={(f) => upload(p.id, "location", f)} onRemove={() => api.removeChildPhoto(params.id, p.id).then(() => detail.refresh())} /> : <span />}
                    <button className="btn-danger !py-0.5 !text-xs" onClick={() => set({ places: form.places.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Comfort items" aside={<button className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ comfortItems: [...form.comfortItems, { id: `item_${form.comfortItems.length + 1}`, name: "", description: "" }] })}>Add</button>}>
            <div className="space-y-2">
              {form.comfortItems.map((c, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[200px_1fr_auto]">
                  <input className="input" placeholder="Name" value={c.name} onChange={(e) => set({ comfortItems: form.comfortItems.map((x, j) => (j === i ? { ...x, name: e.target.value, id: slug(e.target.value) || x.id } : x)) })} />
                  <input className="input" placeholder="What it looks like" value={c.description} onChange={(e) => set({ comfortItems: form.comfortItems.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                  <button className="btn-danger !py-1 !text-xs" onClick={() => set({ comfortItems: form.comfortItems.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Must never be shown (one per line)"><textarea className="input min-h-[80px]" value={form.mustNotShow.join("\n")} onChange={(e) => set({ mustNotShow: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></Section>
            <Section title="Things I can do (one per line)"><textarea className="input min-h-[80px]" value={form.calmingRules.join("\n")} onChange={(e) => set({ calmingRules: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></Section>
          </div>

          <Section title="How the pictures should look">
            <div className="grid gap-2 md:grid-cols-2">
              {(["illustrated", "photo"] as const).map((st) => (
                <label key={st} className={`cursor-pointer rounded-lg border p-3 text-sm ${form.style === st ? "border-amber-glow/70 bg-amber-glow/5" : "border-ink-700/60"}`}>
                  <input type="radio" name="style" className="mr-2" checked={form.style === st} onChange={() => set({ style: st })} />
                  <span className="font-semibold text-ink-100">{st === "illustrated" ? "Illustrated" : "Photo"}</span>
                  <div className="mt-1 text-xs text-ink-400">{st === "illustrated" ? "A calm drawing that looks like your child and your rooms. Small differences are less upsetting than in a photo." : "Looks like a real photo of your child in the real place. Faces can be slightly off; check every picture before approving."}</div>
                </label>
              ))}
            </div>
          </Section>
          <Section title="How they like to watch (applied by the child player)">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sensory.reducedMotion} onChange={(e) => set({ sensory: { ...form.sensory, reducedMotion: e.target.checked } })} /> No motion between pictures (no fades)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sensory.sound === "on"} onChange={(e) => set({ sensory: { ...form.sensory, sound: e.target.checked ? "on" : "off" } })} /> Play the voice</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sensory.showText} onChange={(e) => set({ sensory: { ...form.sensory, showText: e.target.checked } })} /> Show the words</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sensory.largeText} onChange={(e) => set({ sensory: { ...form.sensory, largeText: e.target.checked } })} /> Large text</label>
              <label className="flex items-center gap-2 md:col-span-2"><span className="text-ink-300">Pacing</span><select className="input !w-auto" value={form.sensory.pacing} onChange={(e) => set({ sensory: { ...form.sensory, pacing: e.target.value as "slow" | "normal" } })}><option value="slow">slow: the child taps to go on</option><option value="normal">normal: go on after the voice line</option></select></label>
              <input className="input md:col-span-2" placeholder="Notes for whoever shows the story (what helps, what to avoid)" value={form.sensory.notes ?? ""} onChange={(e) => set({ sensory: { ...form.sensory, notes: e.target.value } })} />
            </div>
          </Section>
          <div className="flex justify-end"><button className="btn-primary" disabled={busy === "save" || !form.name || !form.appearance || !form.outfit} onClick={save}>{busy === "save" ? <Spinner className="border-ink-950 border-t-transparent" /> : null} {isNew ? "Create profile" : "Save profile"}</button></div>
        </div>

        <div className="space-y-4">
          {d && !family && (
            <Section title={`Stories (${d.stories.length})`} aside={<Link href={`/projects/new?child=${params.id}`} className="text-xs text-amber-glow hover:underline">New story →</Link>}>
              {d.stories.length === 0 && <div className="text-xs text-ink-400">No stories yet.</div>}
              <ul className="space-y-2">
                {d.stories.map((s) => (
                  <li key={s.project.id} className="rounded-md border border-ink-700/60 p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/projects/${s.project.id}/certificate`} className="truncate font-medium text-ink-100 hover:text-amber-glow">{s.project.title}</Link>
                      {s.project.approval ? <Pill value="approved" className="border-lime-glow/50 text-lime-glow" /> : <Pill value={STAGES[stageIndex(s.project.stage)]?.short ?? s.project.stage} className="border-ink-600 text-ink-300" />}
                    </div>
                    <div className="text-xs text-ink-400">{s.project.socialStory?.situation} · {timeAgo(s.project.updatedAt)}{s.project.revisionOf ? " · revision" : ""}</div>
                    {s.outcomes.map((o) => (
                      <div key={o.id} className={`mt-1 rounded px-2 py-1 text-xs ${o.visitOutcome === "went_well" ? "bg-lime-glow/10 text-lime-glow" : "bg-amber-glow/10 text-amber-soft"}`}>{OUTCOME_LABEL[o.visitOutcome]} · watched {o.timesWatched}× · {o.recordedBy}{o.stepNotes.filter((n) => n.reaction === "anxious").length ? ` · anxious at step ${o.stepNotes.filter((n) => n.reaction === "anxious").map((n) => n.stepNumber).join(", ")}` : ""}</div>
                    ))}
                    <div className="mt-1 flex gap-3 text-[11px]">
                      <Link href={`/watch/${s.project.id}`} className="text-teal-glow hover:underline">Child player</Link>
                      <a href={api.bookletUrl(s.project.id)} target="_blank" rel="noreferrer" className="text-amber-glow hover:underline">Booklet PDF</a>
                      <Link href={`/projects/new?child=${params.id}&from=${s.project.id}`} className="text-ink-300 hover:underline">Revise from feedback</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {d?.history && !family && (
            <Section title="History in ClickHouse">
              <div className="text-xs text-ink-300">Profile versions: {d.history.profileVersions?.n ?? 0} · outcomes recorded: {d.history.outcomes.length}</div>
              {d.history.outcomes.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-300">{d.history.outcomes.map((o, i) => <li key={i}>{o.recorded_at.slice(0, 10)} · {o.project_id} · {OUTCOME_LABEL[o.visit_outcome] ?? o.visit_outcome} · watched {o.times_watched}×{o.anxious_steps?.length ? ` · anxious steps ${o.anxious_steps.join(", ")}` : ""}</li>)}</ul>
              )}
              <details className="mt-2 text-[11px] text-ink-400"><summary className="cursor-pointer">SQL</summary><pre className="whitespace-pre-wrap font-mono">{d.history.traces.map((t) => t.sql).join("\n\n")}</pre></details>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-xs text-ink-300">{label}</div>{children}</label>;
}

function PhotoRow({ label, photo, busy, onFile, onRemove }: { label: string; photo?: string; busy: boolean; onFile: (f?: File) => void; onRemove: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-ink-400">
      {photo && <img src={mediaUrl(photo)} alt="" className="h-10 w-10 rounded object-cover" />}
      <label className="cursor-pointer text-amber-glow hover:underline">{photo ? "Replace" : label}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} /></label>
      {photo && <button className="text-rose-glow hover:underline" onClick={onRemove}>remove</button>}
      {busy && <Spinner />}
    </div>
  );
}
