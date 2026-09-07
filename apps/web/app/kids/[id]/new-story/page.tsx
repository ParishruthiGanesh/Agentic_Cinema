"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { LanguageReport, SocialStoryBrief } from "@cinememory/core";
import { api, fileToBase64, type CreateStoryInput } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { Button, Card, FamilyPage, Field, inputCls } from "@/components/family";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item";
type Step = SocialStoryBrief["steps"][number];

/** Three calm steps: what is happening, the words, the pictures. No pipeline, no stages, no models on screen. */
export default function NewStoryPage() {
  return (
    <FamilyPage>
      <Suspense fallback={null}>
        <Wizard />
      </Suspense>
    </FamilyPage>
  );
}

function Wizard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") ?? undefined;
  const detail = useResource(() => api.child(id), [id]);
  const c = detail.data?.child;
  const [page, setPage] = useState(1);
  const [situation, setSituation] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [settings, setSettings] = useState<SocialStoryBrief["settings"]>([]);
  const [companions, setCompanions] = useState<SocialStoryBrief["companions"]>([]);
  const [mustNotShow, setMustNotShow] = useState<string[]>([]);
  const [calmingRules, setCalmingRules] = useState<string[]>([]);
  const [style, setStyle] = useState<"illustrated" | "photo">();
  const [video, setVideo] = useState(true);
  const [photos, setPhotos] = useState<Record<string, { file: File; kind: "character" | "location" }>>({});
  const [feedback, setFeedback] = useState<Array<{ stepNumber: number; reaction: string; note?: string }>>([]);
  const [lint, setLint] = useState<LanguageReport>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  // Revising an earlier story: start from its words and show the notes the adult left.
  useEffect(() => {
    if (!from) return;
    api.revisionSeed(from).then((seed) => {
      setSituation(seed.brief.situation);
      setSteps(seed.brief.steps);
      setSettings(seed.brief.settings);
      setCompanions(seed.brief.companions);
      setMustNotShow(seed.brief.mustNotShow);
      setCalmingRules(seed.brief.calmingRules);
      setFeedback(seed.notes);
      setTitle(`${seed.brief.child.name}: ${seed.brief.situation} (new version)`);
      setPage(2);
    }).catch((e) => setError((e as Error).message));
  }, [from]);

  useEffect(() => {
    if (!steps.length) return setLint(undefined);
    const t = setTimeout(() => api.lintSocialStory({ steps: steps.map((s) => ({ text: s.text })), calmingRules }).then(setLint).catch(() => undefined), 600);
    return () => clearTimeout(t);
  }, [steps, calmingRules]);

  if (!c) return <div className="text-[#7a7264]">Loading…</div>;
  const allSettings = [...c.places, ...settings.filter((s) => !c.places.some((p) => p.id === s.id))];
  const allPeople = [...c.companions, ...companions.filter((s) => !c.companions.some((p) => p.id === s.id))];

  const draft = async () => {
    if (!situation.trim()) return setError("Tell us what is happening first.");
    setBusy("draft");
    setError(undefined);
    try {
      const r = await api.draftSocialStory({ situation, childName: c.name, childAge: c.age, notes: notes || undefined });
      const d = r.draft;
      const newSettings = d.settings.map((s) => ({ id: slug(s.name), name: s.name, description: s.description })).filter((s) => !c.places.some((p) => p.id === s.id));
      const newPeople = d.companions.map((p) => ({ id: slug(p.name), name: p.name, role: p.role, appearance: p.appearance, outfit: p.outfit })).filter((p) => !c.companions.some((x) => x.id === p.id));
      setSettings(newSettings);
      setCompanions(newPeople);
      const settingsAll = [...c.places, ...newSettings];
      const peopleAll = [...c.companions, ...newPeople];
      setSteps(d.steps.map((s) => ({ title: s.title, text: s.text, settingId: settingsAll.find((x) => x.name.toLowerCase() === s.settingName.toLowerCase())?.id ?? settingsAll[0]?.id ?? "", companionIds: s.companions.map((n) => peopleAll.find((p) => p.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x), comfortItemIds: c.comfortItems.map((i) => i.id), visual: s.visual })));
      setMustNotShow([...new Set([...c.mustNotShow, ...d.mustNotShow])]);
      setCalmingRules([...new Set([...c.calmingRules, ...d.calmingRules])]);
      setPage(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const create = async () => {
    setBusy("create");
    setError(undefined);
    try {
      // Photos for new people/places are stored on the profile first so future stories reuse them.
      const profileIds = new Set([...c.companions.map((p) => p.id), ...c.places.map((p) => p.id)]);
      const pending = Object.entries(photos).filter(([eid]) => !profileIds.has(eid));
      const input: CreateStoryInput = { title: title || undefined, situation, steps, settings, companions, mustNotShow, calmingRules, style, revisionOf: from, authoredBy: c.guardian, video };
      const created = await api.createStory(id, input);
      for (const [eid, { file, kind }] of pending) {
        const data = await fileToBase64(file);
        if (kind === "location") await api.uploadLocationReference(created.project.id, eid, data);
        else await api.uploadReference(created.project.id, eid, data);
      }
      router.push(`/stories/${created.project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  };

  const update = (i: number, patch: Partial<Step>) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3 text-sm text-[#7a7264]">
        {["What is happening", "The words", "The pictures"].map((t, i) => <span key={t} className={`rounded-full px-3 py-1 ${page === i + 1 ? "bg-[#26221c] text-white" : "bg-[#eee9dd]"}`}>{i + 1}. {t}</span>)}
      </div>
      <h1 className="mt-4 text-3xl font-semibold">New story for {c.name}</h1>
      {error && <div className="mt-3 text-sm text-[#a13333]">{error}</div>}

      {page === 1 && (
        <Card className="mt-5 grid gap-4">
          <Field label="What is going to happen?" hint="For example: going to the dentist for a check-up, the first day at a new school, a haircut."><input className={inputCls} value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="going to the dentist for a check-up" /></Field>
          <Field label="Anything we should know? (optional)" hint="The name of the clinic or teacher, what usually helps, what to avoid."><textarea className={`${inputCls} min-h-[80px]`} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-3">
            <Button onClick={draft} disabled={busy === "draft"}>{busy === "draft" ? "Writing a first draft…" : "Write a first draft for me"}</Button>
            <Button kind="ghost" onClick={() => { if (!steps.length) setSteps([{ title: "", text: "", settingId: allSettings[0]?.id ?? "", companionIds: [], comfortItemIds: c.comfortItems.map((i) => i.id) }]); setPage(2); }} disabled={!situation.trim()}>I will write it myself</Button>
          </div>
          <div className="text-xs text-[#7a7264]">The draft is a starting point. You edit every word before anything is made, and your final words are used exactly as written.</div>
        </Card>
      )}

      {page === 2 && (
        <div className="mt-5 space-y-4">
          {feedback.length > 0 && (
            <Card className="border-[#f1d38a] bg-[#fff8e6]">
              <div className="font-semibold">Notes from last time</div>
              <ul className="ml-4 list-disc text-sm">{feedback.map((n, i) => <li key={i}>Step {n.stepNumber}: {n.reaction}{n.note ? ` — ${n.note}` : ""}</li>)}</ul>
            </Card>
          )}
          {steps.map((s, i) => {
            const findings = lint?.findings.filter((f) => f.step === i + 1) ?? [];
            return (
              <Card key={i}>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-semibold text-[#2f7d4f]">{i + 1}</div>
                  <input className={inputCls} placeholder="Step title (e.g. The waiting room)" value={s.title} onChange={(e) => update(i, { title: e.target.value })} />
                  <select className={`${inputCls} !w-52`} value={s.settingId} onChange={(e) => update(i, { settingId: e.target.value })}>
                    <option value="">Where?</option>
                    {allSettings.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
                <textarea className={`${inputCls} mt-3 min-h-[80px] text-lg`} placeholder={`What ${c.name} hears, in ${c.name}'s words: "I sit in the big chair. It leans back slowly. That is okay."`} value={s.text} onChange={(e) => update(i, { text: e.target.value })} />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[#4d463b]">
                  <span className="text-[#7a7264]">Who is there:</span>
                  {allPeople.map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={s.companionIds.includes(p.id)} onChange={(e) => update(i, { companionIds: e.target.checked ? [...s.companionIds, p.id] : s.companionIds.filter((x) => x !== p.id) })} /> {p.name}</label>)}
                  {c.comfortItems.map((it) => <label key={it.id} className="flex items-center gap-1"><input type="checkbox" checked={s.comfortItemIds.includes(it.id)} onChange={(e) => update(i, { comfortItemIds: e.target.checked ? [...s.comfortItemIds, it.id] : s.comfortItemIds.filter((x) => x !== it.id) })} /> {it.name}</label>)}
                  <span className="ml-auto flex gap-2 text-xs">
                    <button className="hover:underline" disabled={i === 0} onClick={() => setSteps((p) => { const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>up</button>
                    <button className="hover:underline" disabled={i === steps.length - 1} onClick={() => setSteps((p) => { const n = [...p]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>down</button>
                    <button className="text-[#a13333] hover:underline" onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}>remove</button>
                  </span>
                </div>
                {findings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-[#8a5a00]">{findings.map((f, k) => <li key={k}>Tip: {f.message}</li>)}</ul>}
              </Card>
            );
          })}
          <Button kind="ghost" onClick={() => setSteps((p) => [...p, { title: "", text: "", settingId: allSettings[0]?.id ?? "", companionIds: [], comfortItemIds: c.comfortItems.map((i) => i.id) }])}>Add a step</Button>

          {(settings.length > 0 || companions.length > 0) && (
            <Card>
              <div className="font-semibold">New for this story</div>
              <div className="text-sm text-[#7a7264]">These places and people are not in {c.name}'s profile yet. Check the descriptions; add a photo if you have one.</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {settings.map((s, i) => (
                  <div key={s.id} className="rounded-xl border border-[#eee9dd] p-3 text-sm">
                    <input className={inputCls} value={s.name} onChange={(e) => setSettings((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <textarea className={`${inputCls} mt-2 min-h-[60px]`} value={s.description} onChange={(e) => setSettings((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <label className="mt-2 block text-xs text-[#7a7264]">Photo of the real place <input type="file" accept="image/*" className="ml-1 text-xs" onChange={(e) => e.target.files?.[0] && setPhotos((p) => ({ ...p, [s.id]: { file: e.target.files![0], kind: "location" } }))} /></label>
                  </div>
                ))}
                {companions.map((p, i) => (
                  <div key={p.id} className="rounded-xl border border-[#eee9dd] p-3 text-sm">
                    <input className={inputCls} value={p.name} onChange={(e) => setCompanions((c2) => c2.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input className={`${inputCls} mt-2`} placeholder="Role" value={p.role} onChange={(e) => setCompanions((c2) => c2.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                    <input className={`${inputCls} mt-2`} placeholder="How they look" value={p.appearance} onChange={(e) => setCompanions((c2) => c2.map((x, j) => (j === i ? { ...x, appearance: e.target.value } : x)))} />
                    <input className={`${inputCls} mt-2`} placeholder="What they wear" value={p.outfit} onChange={(e) => setCompanions((c2) => c2.map((x, j) => (j === i ? { ...x, outfit: e.target.value } : x)))} />
                    <label className="mt-2 block text-xs text-[#7a7264]">Photo <input type="file" accept="image/*" className="ml-1 text-xs" onChange={(e) => e.target.files?.[0] && setPhotos((ph) => ({ ...ph, [p.id]: { file: e.target.files![0], kind: "character" } }))} /></label>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Things that must never be in the pictures" hint="One per line."><textarea className={`${inputCls} min-h-[80px]`} value={mustNotShow.join("\n")} onChange={(e) => setMustNotShow(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} /></Field>
              <Field label="Things I can do (read at the end)" hint="One per line."><textarea className={`${inputCls} min-h-[80px]`} value={calmingRules.join("\n")} onChange={(e) => setCalmingRules(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} /></Field>
            </div>
          </Card>
          <div className="flex justify-between">
            <Button kind="ghost" onClick={() => setPage(1)}>Back</Button>
            <Button onClick={() => setPage(3)} disabled={!steps.length || steps.some((s) => !s.text.trim() || !s.settingId)}>Next: the pictures</Button>
          </div>
        </div>
      )}

      {page === 3 && (
        <div className="mt-5 space-y-4">
          <Card>
            <div className="font-semibold">Picture style</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(["illustrated", "photo"] as const).map((st) => (
                <label key={st} className={`cursor-pointer rounded-xl border p-3 ${(style ?? c.style) === st ? "border-[#2f7d4f] bg-[#f3faf5]" : "border-[#eee9dd]"}`}>
                  <input type="radio" name="style" className="mr-2" checked={(style ?? c.style) === st} onChange={() => setStyle(st)} />
                  <span className="font-semibold">{detail.data?.styles[st].label}</span>
                  <div className="mt-1 text-xs text-[#7a7264]">{detail.data?.styles[st].description}</div>
                </label>
              ))}
            </div>
          </Card>
          <Card>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={video} onChange={(e) => setVideo(e.target.checked)} />
              <span><span className="font-semibold">Moving pictures</span><div className="text-sm text-[#7a7264]">Each step becomes a short, gentle clip that starts from its checked picture: small movements only, same people, same room. Takes a few minutes longer. Without this, each step is a still picture with the voice.</div></span>
            </label>
          </Card>
          <Card>
            <Field label="Story title (optional)"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${c.name}: ${situation}`} /></Field>
            <div className="mt-3 text-sm text-[#4d463b]">We will make one picture{video ? ", a short clip" : ""} and the voice for each of the {steps.length} steps, then check every picture: same {c.name}, same clothes, same rooms, nothing from the must-not list. This takes a few minutes. You approve before {c.name} sees it.</div>
          </Card>
          <div className="flex justify-between">
            <Button kind="ghost" onClick={() => setPage(2)}>Back</Button>
            <Button onClick={create} disabled={busy === "create"}>{busy === "create" ? "Starting…" : "Make the story"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
