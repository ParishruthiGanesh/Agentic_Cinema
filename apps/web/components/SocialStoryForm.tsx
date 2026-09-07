"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CreateProjectInput, LanguageReport, SocialStoryBrief, SocialStoryDraft } from "@cinememory/core";
import { api, fileToBase64 } from "@/lib/api";
import { Section, Spinner } from "./ui";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item";
const DEFAULT_STYLE = "soft, flat, calm 2D illustration with gentle colours, clear simple shapes and uncluttered backgrounds";

type Person = SocialStoryBrief["companions"][number];
type Item = SocialStoryBrief["comfortItems"][number];
type Setting = SocialStoryBrief["settings"][number];
type Step = SocialStoryBrief["steps"][number];

const empty: SocialStoryBrief = {
  child: { name: "", age: "", appearance: "", outfit: "" },
  situation: "",
  companions: [],
  comfortItems: [],
  settings: [],
  steps: [],
  mustNotShow: [],
  calmingRules: [],
  authoredBy: "",
};

/**
 * Social story authoring form. The adult's words are used verbatim by the pipeline; Gemini only helps with a first
 * draft (optional) and later with pictures. Photos are optional and become identity references for generation.
 */
export function SocialStoryForm({ childId, fromProjectId }: { childId?: string; fromProjectId?: string } = {}) {
  const router = useRouter();
  const [b, setB] = useState<SocialStoryBrief>(empty);
  const [childName, setChildName] = useState<string>();
  const [notes, setNotes] = useState<Array<{ stepNumber: number; reaction: string; note?: string; recordedAt: string }>>([]);
  const [lint, setLint] = useState<LanguageReport>();
  const [settingPhotos, setSettingPhotos] = useState<Record<string, File>>({});
  const [loadError, setLoadError] = useState<string>();

  // Preload from a child profile (identity locked) and/or from an earlier story's feedback.
  useEffect(() => {
    (async () => {
      try {
        let next: SocialStoryBrief | undefined;
        if (childId) {
          const d = await api.child(childId);
          const c = d.child;
          setChildName(c.name);
          next = { ...empty, child: { name: c.name, age: c.age, appearance: c.appearance, outfit: c.outfit }, companions: c.companions, comfortItems: c.comfortItems, settings: c.places, mustNotShow: c.mustNotShow, calmingRules: c.calmingRules, authoredBy: c.guardian ?? "" };
        }
        if (fromProjectId) {
          const seed = await api.revisionSeed(fromProjectId);
          next = { ...(next ?? empty), ...seed.brief, child: next?.child ?? seed.brief.child };
          setNotes(seed.notes);
          setTitle((t) => t || `${seed.brief.child.name}: ${seed.brief.situation} (revised)`);
        }
        if (next) setB(next);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [childId, fromProjectId]);

  // Plain-language critic runs on the words as they are typed (debounced).
  useEffect(() => {
    if (!b.steps.length) return setLint(undefined);
    const t = setTimeout(() => api.lintSocialStory({ steps: b.steps.map((s) => ({ text: s.text })), calmingRules: b.calmingRules }).then(setLint).catch(() => undefined), 600);
    return () => clearTimeout(t);
  }, [b.steps, b.calmingRules]);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [language, setLanguage] = useState("English");
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [draftNotes, setDraftNotes] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const set = (patch: Partial<SocialStoryBrief>) => setB((prev) => ({ ...prev, ...patch }));
  const childKey = slug(b.child.name || "child");

  const fillExample = async () => {
    setError(undefined);
    try {
      const ex = await api.socialStoryExample();
      setB(ex);
      setTitle(`${ex.child.name} goes to the dentist`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applyDraft = (d: SocialStoryDraft) => {
    const settings: Setting[] = d.settings.map((s) => ({ id: slug(s.name), name: s.name, description: s.description }));
    const companions: Person[] = d.companions.map((c) => ({ id: slug(c.name), name: c.name, role: c.role, appearance: c.appearance, outfit: c.outfit }));
    const comfortItems: Item[] = d.comfortItems.map((c) => ({ id: slug(c.name), name: c.name, description: c.description }));
    const steps: Step[] = d.steps.map((s) => ({
      title: s.title,
      text: s.text,
      settingId: settings.find((x) => x.name.toLowerCase() === s.settingName.toLowerCase())?.id ?? settings[0]?.id ?? "",
      companionIds: s.companions.map((n) => companions.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x),
      comfortItemIds: comfortItems.map((c) => c.id),
      visual: s.visual,
    }));
    set({ situation: d.situation || b.situation, settings, companions, comfortItems, steps, mustNotShow: d.mustNotShow, calmingRules: d.calmingRules });
  };

  const draft = async () => {
    if (!b.child.name || !b.situation) {
      setError("Enter the child's name and the situation first.");
      return;
    }
    setDrafting(true);
    setError(undefined);
    try {
      const r = await api.draftSocialStory({ situation: b.situation, childName: b.child.name, childAge: b.child.age || undefined, notes: draftNotes || undefined, language });
      applyDraft(r.draft);
      setDraftInfo(`Draft by ${r.provenance.provider}${r.provenance.model ? ` · ${r.provenance.model}` : ""}${r.provenance.latencyMs ? ` · ${(r.provenance.latencyMs / 1000).toFixed(1)}s` : ""}. Edit every line below: your final words are used exactly as written.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy("Creating project…");
    try {
      const brief: SocialStoryBrief = { ...b, authoredBy: b.authoredBy || undefined, child: { ...b.child, age: b.child.age || undefined }, steps: b.steps.map((s) => ({ ...s, visual: s.visual || undefined })) };
      const text = renderText(brief);
      const input: CreateProjectInput = {
        title: title.trim() || `${brief.child.name}: ${brief.situation}`,
        mode: "social_story",
        source: { kind: "social_story", title: `${brief.child.name}: ${brief.situation} (routine)`, author: brief.authoredBy, text },
        brief: { genre: "social story", audience: "an autistic child", ageRange: brief.child.age, targetDurationSec: Math.max(30, brief.steps.length * 12), language, visualStyle: style || DEFAULT_STYLE, tone: "calm, literal, reassuring", format: "social story film", requiredFacts: [] },
        socialStory: brief,
        childId,
        revisionOf: fromProjectId,
      };
      const s = await api.createProject(input);
      for (const [cid, file] of Object.entries(photos)) {
        setBusy(`Uploading photo for ${cid}…`);
        const data = await fileToBase64(file);
        await api.uploadReference(s.project.id, cid, { ...data, uploadedBy: brief.authoredBy });
      }
      for (const [lid, file] of Object.entries(settingPhotos)) {
        setBusy(`Uploading photo of ${lid}…`);
        const data = await fileToBase64(file);
        await api.uploadLocationReference(s.project.id, lid, data);
      }
      setBusy("Starting pipeline…");
      await api.run(s.project.id, "narrative_verified").catch(() => undefined);
      router.push(`/projects/${s.project.id}/production`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(undefined);
    }
  };

  const people: Array<{ id: string; label: string }> = [{ id: childKey, label: `${b.child.name || "the child"} (child)` }, ...b.companions.map((c) => ({ id: c.id, label: `${c.name} (${c.role})` }))];

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="card p-4 text-sm text-ink-300">
        <p>A social story previews a situation step by step so nothing on the day is a surprise. <span className="text-ink-100">Your words are used exactly as written.</span> CineMemory locks the child's look, one outfit, the rooms, the comfort items and the must-not-show list, then checks every picture against them and regenerates any that drift. A human approves the Continuity Certificate before the film is shared.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={fillExample}>Fill example: Maya goes to the dentist</button>
        </div>
      </div>

      {loadError && <div className="text-sm text-rose-glow">{loadError}</div>}
      {childId && (
        <div className="rounded-lg border border-violet-glow/40 bg-violet-glow/5 px-4 py-2 text-sm text-ink-200">
          Story for <span className="font-semibold text-ink-100">{childName ?? childId}</span>: look, outfit, comfort items, familiar people and places come from the <Link href={`/children/${childId}`} className="text-amber-glow underline">profile</Link> and are locked here. Add what is new for this situation.
        </div>
      )}
      {notes.length > 0 && (
        <div className="rounded-lg border border-amber-glow/40 bg-amber-glow/5 px-4 py-2 text-sm">
          <div className="font-semibold text-amber-soft">Feedback from the last version</div>
          <ul className="ml-4 list-disc text-ink-200">{notes.map((n, i) => <li key={i}>Step {n.stepNumber}: {n.reaction}{n.note ? ` — ${n.note}` : ""} <span className="text-xs text-ink-400">({n.recordedAt.slice(0, 10)})</span></li>)}</ul>
        </div>
      )}
      <Section title="The child and the situation">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Child's name"><input className="input" value={b.child.name} onChange={(e) => set({ child: { ...b.child, name: e.target.value } })} required readOnly={!!childId} /></Field>
          <Field label="Age (optional)"><input className="input" value={b.child.age ?? ""} onChange={(e) => set({ child: { ...b.child, age: e.target.value } })} readOnly={!!childId} /></Field>
          <Field label="Situation (e.g. going to the dentist for a check-up)"><input className="input" value={b.situation} onChange={(e) => set({ situation: e.target.value })} required /></Field>
          <Field label="Story title (optional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={b.child.name ? `${b.child.name}: ${b.situation}` : ""} /></Field>
          <Field label="How the child looks (hair, skin, features — this is locked for every picture)"><textarea className="input min-h-[60px]" value={b.child.appearance} onChange={(e) => set({ child: { ...b.child, appearance: e.target.value } })} required readOnly={!!childId} /></Field>
          <Field label="The ONE outfit for the whole story (exactly what they will wear on the day)"><textarea className="input min-h-[60px]" value={b.child.outfit} onChange={(e) => set({ child: { ...b.child, outfit: e.target.value } })} required readOnly={!!childId} /></Field>
          {!childId && <Field label={`Photo of ${b.child.name || "the child"} (optional; stays on your server, used only as the identity reference)`}><input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs text-ink-300" onChange={(e) => setPhoto(e.target.files?.[0], childKey)} /></Field>}
          <Field label="Written by (shown on the certificate)"><input className="input" value={b.authoredBy ?? ""} onChange={(e) => set({ authoredBy: e.target.value })} placeholder="e.g. J. Okafor, speech and language therapist" /></Field>
        </div>
      </Section>

      <Section title="Draft with Gemini (optional)" aside={<span className="text-xs text-ink-400">the adult edits everything before it is used</span>}>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input className="input" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Notes for the draft: what to include or avoid, names of real people, the clinic layout…" />
          <button type="button" className="btn-ghost" disabled={drafting} onClick={draft}>{drafting ? <Spinner /> : null} Draft steps</button>
        </div>
        {draftInfo && <div className="mt-2 text-xs text-teal-glow">{draftInfo}</div>}
      </Section>

      <Section title="Settings (rooms and places)" aside={<button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ settings: [...b.settings, { id: `setting_${b.settings.length + 1}`, name: "", description: "" }] })}>Add setting</button>}>
        {b.settings.length === 0 && <div className="text-xs text-ink-400">Add the places the child will be, in the order they will visit them.</div>}
        <div className="space-y-2">
          {b.settings.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-ink-700/60 p-2 md:grid-cols-[180px_1fr_auto]">
              <input className="input" placeholder="Name (e.g. Waiting room)" value={s.name} onChange={(e) => update("settings", i, { name: e.target.value, id: s.id.startsWith("setting_") || s.id === slug(s.name) ? slug(e.target.value) || s.id : s.id })} required />
              <input className="input" placeholder="What it looks like (colours, furniture, what is on the walls)" value={s.description} onChange={(e) => update("settings", i, { description: e.target.value })} required />
              <button type="button" className="btn-danger !py-1 !text-xs" onClick={() => remove("settings", i)}>Remove</button>
              <label className="text-xs text-ink-400 md:col-span-3">Photo of the real place (optional; the picture will match this room) <input type="file" accept="image/png,image/jpeg,image/webp" className="ml-2 text-xs" onChange={(e) => setSettingPhotos((prev) => { const n = { ...prev }; if (e.target.files?.[0]) n[s.id] = e.target.files[0]; else delete n[s.id]; return n; })} /></label>
            </div>
          ))}
        </div>
      </Section>

      <Section title="People (parent, dentist, teacher…)" aside={<button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ companions: [...b.companions, { id: `person_${b.companions.length + 1}`, name: "", role: "", appearance: "", outfit: "" }] })}>Add person</button>}>
        <div className="space-y-2">
          {b.companions.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-ink-700/60 p-2 md:grid-cols-2">
              <input className="input" placeholder="Name (e.g. Mum, Dr. Lee)" value={c.name} onChange={(e) => update("companions", i, { name: e.target.value, id: slug(e.target.value) || c.id })} required />
              <input className="input" placeholder="Role (parent, dentist…)" value={c.role} onChange={(e) => update("companions", i, { role: e.target.value })} required />
              <input className="input" placeholder="How they look" value={c.appearance} onChange={(e) => update("companions", i, { appearance: e.target.value })} required />
              <input className="input" placeholder="What they wear (one outfit)" value={c.outfit} onChange={(e) => update("companions", i, { outfit: e.target.value })} required />
              <label className="text-xs text-ink-400">Photo (optional) <input type="file" accept="image/png,image/jpeg,image/webp" className="ml-2 text-xs" onChange={(e) => setPhoto(e.target.files?.[0], c.id)} /></label>
              <div className="text-right"><button type="button" className="btn-danger !py-1 !text-xs" onClick={() => remove("companions", i)}>Remove</button></div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Comfort items" aside={<button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ comfortItems: [...b.comfortItems, { id: `item_${b.comfortItems.length + 1}`, name: "", description: "" }] })}>Add item</button>}>
        <div className="space-y-2">
          {b.comfortItems.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-ink-700/60 p-2 md:grid-cols-[180px_1fr_auto]">
              <input className="input" placeholder="Name (e.g. Bun)" value={c.name} onChange={(e) => update("comfortItems", i, { name: e.target.value, id: slug(e.target.value) || c.id })} required />
              <input className="input" placeholder="What it looks like" value={c.description} onChange={(e) => update("comfortItems", i, { description: e.target.value })} required />
              <button type="button" className="btn-danger !py-1 !text-xs" onClick={() => remove("comfortItems", i)}>Remove</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Steps (${b.steps.length})`} aside={<button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => set({ steps: [...b.steps, { title: "", text: "", settingId: b.settings[0]?.id ?? "", companionIds: [], comfortItemIds: b.comfortItems.map((c) => c.id) }] })}>Add step</button>}>
        {b.steps.length === 0 && <div className="text-xs text-ink-400">One idea per step, first person, in the real order. 5 to 8 steps works well.</div>}
        <ol className="space-y-3">
          {b.steps.map((s, i) => (
            <li key={i} className="rounded-md border border-ink-700/60 p-3">
              <div className="grid gap-2 md:grid-cols-[60px_1fr_220px]">
                <div className="text-lg font-semibold text-amber-glow">{i + 1}</div>
                <input className="input" placeholder="Step title (e.g. The waiting room)" value={s.title} onChange={(e) => update("steps", i, { title: e.target.value })} required />
                <select className="input" value={s.settingId} onChange={(e) => update("steps", i, { settingId: e.target.value })} required>
                  <option value="">Setting…</option>
                  {b.settings.map((st) => <option key={st.id} value={st.id}>{st.name || st.id}</option>)}
                </select>
              </div>
              <textarea className="input mt-2 min-h-[64px]" placeholder='What the child hears, in their words: "I will sit in the big chair. It leans back slowly. That is okay."' value={s.text} onChange={(e) => update("steps", i, { text: e.target.value })} required />
              <input className="input mt-2" placeholder="What the picture shows (optional; defaults to the words above)" value={s.visual ?? ""} onChange={(e) => update("steps", i, { visual: e.target.value })} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-300">
                <span className="text-ink-400">Present:</span>
                {b.companions.map((c) => (
                  <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={s.companionIds.includes(c.id)} onChange={(e) => update("steps", i, { companionIds: e.target.checked ? [...s.companionIds, c.id] : s.companionIds.filter((x) => x !== c.id) })} /> {c.name || c.id}</label>
                ))}
                {b.comfortItems.length > 0 && <span className="ml-3 text-ink-400">Items:</span>}
                {b.comfortItems.map((c) => (
                  <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={s.comfortItemIds.includes(c.id)} onChange={(e) => update("steps", i, { comfortItemIds: e.target.checked ? [...s.comfortItemIds, c.id] : s.comfortItemIds.filter((x) => x !== c.id) })} /> {c.name || c.id}</label>
                ))}
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn-ghost !py-0.5 !text-xs" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn-ghost !py-0.5 !text-xs" disabled={i === b.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className="btn-danger !py-0.5 !text-xs" onClick={() => remove("steps", i)}>Remove</button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {lint && (
        <Section title="Plain-language check" aside={<span className={`text-xs ${lint.summary.findings ? "text-amber-glow" : "text-lime-glow"}`}>{lint.summary.findings ? `${lint.summary.findings} suggestion${lint.summary.findings === 1 ? "" : "s"}` : "all steps read clearly"}</span>}>
          {lint.findings.length === 0 ? <div className="text-xs text-ink-400">First person, short sentences, present tense, no idioms or negatives, one idea per step.</div> : (
            <ul className="space-y-1 text-xs">
              {lint.findings.map((f, i) => <li key={i} className={f.severity === "medium" ? "text-amber-soft" : "text-ink-300"}><span className="font-mono">step {f.step}</span> · {f.message} <span className="italic text-ink-400">“{f.excerpt}”</span></li>)}
            </ul>
          )}
          <div className="mt-1 text-[11px] text-ink-400">Advice only: your words are used as written.</div>
        </Section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Must never be shown (one per line)">
          <textarea className="input min-h-[90px]" value={b.mustNotShow.join("\n")} onChange={(e) => set({ mustNotShow: lines(e.target.value) })} placeholder={"needles or syringes\ndental drills\ncrying or frightened faces"} />
          <div className="mt-1 text-xs text-ink-400">Each line becomes a critical visual constraint checked in every picture.</div>
        </Section>
        <Section title="Things I can do (calming rules, one per line)">
          <textarea className="input min-h-[90px]" value={b.calmingRules.join("\n")} onChange={(e) => set({ calmingRules: lines(e.target.value) })} placeholder={"If it is too loud, I can ask for my headphones.\nIf I need a break, I can raise my hand."} />
          <div className="mt-1 text-xs text-ink-400">Read at the end of the story; verified as required lines.</div>
        </Section>
      </div>

      <Section title="Pictures">
        <div className="grid gap-3 md:grid-cols-[1fr_200px]">
          <Field label="Visual style"><input className="input" value={style} onChange={(e) => setStyle(e.target.value)} /></Field>
          <Field label="Language"><input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
        </div>
        <div className="mt-2 text-xs text-ink-400">Photos: {Object.keys(photos).length ? Object.keys(photos).map((k) => people.find((p) => p.id === k)?.label ?? k).join(", ") : "none attached"}. Uploaded photos are stored with the project on your server and sent to the image model as identity references. Only upload photos you have consent to use.</div>
      </Section>

      {error && <div className="text-sm text-rose-glow">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={!!busy || b.steps.length === 0 || b.settings.length === 0}>{busy ? <><Spinner className="border-ink-950 border-t-transparent" /> {busy}</> : "Create and compile the story"}</button>
      </div>
    </form>
  );

  function update<K extends "settings" | "companions" | "comfortItems" | "steps">(key: K, i: number, patch: Partial<SocialStoryBrief[K][number]>) {
    setB((prev) => {
      const list = [...(prev[key] as unknown[])] as SocialStoryBrief[K];
      (list as unknown[])[i] = { ...(list as unknown[])[i] as object, ...patch };
      return { ...prev, [key]: list };
    });
  }
  function remove(key: "settings" | "companions" | "comfortItems" | "steps", i: number) {
    setB((prev) => ({ ...prev, [key]: (prev[key] as unknown[]).filter((_, j) => j !== i) }));
  }
  function move(i: number, d: number) {
    setB((prev) => {
      const steps = [...prev.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + d, 0, s);
      return { ...prev, steps };
    });
  }
  function setPhoto(file: File | undefined, id: string) {
    setPhotos((prev) => {
      const next = { ...prev };
      if (file) next[id] = file;
      else delete next[id];
      return next;
    });
  }
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function renderText(b: SocialStoryBrief): string {
  const out: string[] = [`${b.child.name}: ${b.situation}`, ""];
  b.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title}`, s.text, ""));
  if (b.calmingRules.length) out.push("Things I can do:", ...b.calmingRules.map((r) => `- ${r}`), "");
  if (b.mustNotShow.length) out.push(`Must never be shown: ${b.mustNotShow.join("; ")}.`);
  return out.join("\n").trim();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-ink-300">{label}</div>
      {children}
    </label>
  );
}
