"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CreateProjectInput } from "@cinememory/core";
import { api } from "@/lib/api";
import { PageTitle } from "@/components/ui";

const KIDS_EXAMPLE = {
  title: "Why We Save Water",
  text: `Every drop of water on Earth is part of one big cycle. Rain falls, rivers flow to the sea, the sun lifts water into the sky as vapor, and clouds carry it back over the land. Only a tiny part of all water is fresh water we can drink, and much of that is frozen in ice. When we leave a tap running, the clean water we waste has already travelled a long way through pipes, filters and pumps that use energy. Turning off the tap while brushing your teeth can save several litres a day. Fixing a dripping tap saves even more. Water we save today stays in rivers and lakes for fish, birds and for the people who need it tomorrow.`,
  facts: ["Only a small fraction of Earth's water is fresh water we can drink.", "Turning off the tap while brushing your teeth saves water every day.", "Water moves in a cycle: rain, rivers, evaporation, clouds."],
};

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"creator" | "kids">("creator");
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<CreateProjectInput["source"]["kind"]>("original");
  const [sourceTitle, setSourceTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [rights, setRights] = useState("");
  const [genre, setGenre] = useState("adventure");
  const [audience, setAudience] = useState("general audience");
  const [ageRange, setAgeRange] = useState("");
  const [duration, setDuration] = useState(75);
  const [language, setLanguage] = useState("English");
  const [style, setStyle] = useState("soft painterly 2D animation, warm palette");
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState("animated short");
  const [instructions, setInstructions] = useState("");
  const [facts, setFacts] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const fillKidsExample = () => {
    setMode("kids");
    setTitle(KIDS_EXAMPLE.title);
    setSourceKind("lesson");
    setSourceTitle("Saving water (lesson notes)");
    setText(KIDS_EXAMPLE.text);
    setAudience("children");
    setAgeRange("6-8");
    setDuration(90);
    setGenre("gentle educational adventure");
    setFacts(KIDS_EXAMPLE.facts.join("\n"));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const input: CreateProjectInput = {
        title: title.trim(),
        mode,
        source: { kind: sourceKind, title: sourceTitle.trim() || title.trim(), author: author.trim() || undefined, text: text.trim(), rightsNote: rights.trim() || undefined },
        brief: {
          genre,
          audience,
          ageRange: ageRange || undefined,
          targetDurationSec: Number(duration),
          language,
          visualStyle: style,
          tone: tone || undefined,
          format,
          adaptationInstructions: instructions || undefined,
          requiredFacts: facts.split("\n").map((f) => f.trim()).filter(Boolean),
        },
      };
      const s = await api.createProject(input);
      await api.run(s.project.id, "narrative_verified").catch(() => undefined);
      router.push(`/projects/${s.project.id}/production`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle
        title="New project"
        subtitle="Provide the source material and the production brief. CineMemory extracts a canonical world, adapts it, writes the screenplay and verifies continuity before any media is generated."
        actions={<button type="button" className="btn-ghost" onClick={fillKidsExample}>Fill kids / educational example</button>}
      />
      <form onSubmit={submit} className="grid gap-5">
        <div className="card p-4">
          <div className="label mb-2">Workflow</div>
          <div className="flex gap-2">
            {(["creator", "kids"] as const).map((m) => (
              <button type="button" key={m} onClick={() => setMode(m)} className={`btn ${mode === m ? "bg-amber-glow text-ink-950" : "border border-ink-600 text-ink-200"}`}>
                {m === "creator" ? "Creator / Filmmaker" : "Kids / Educational"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {mode === "creator" ? "Original stories, public-domain text, licensed material, screenplays or ideas. Real actors are never generated; characters are fictional or authorised likenesses." : "Lessons, concepts or facts. Required facts are tracked as source constraints and verified in the final screenplay."}
          </p>
        </div>

        <div className="card grid gap-3 p-4">
          <div className="label">Source material</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Project title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
            <Field label="Source kind">
              <select className="input" value={sourceKind} onChange={(e) => setSourceKind(e.target.value as CreateProjectInput["source"]["kind"])}>
                <option value="original">Original story</option>
                <option value="public_domain">Public-domain text</option>
                <option value="licensed">Licensed material</option>
                <option value="screenplay">Screenplay</option>
                <option value="idea">Story idea</option>
                <option value="lesson">Lesson / concept</option>
              </select>
            </Field>
            <Field label="Source title (optional)"><input className="input" value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} /></Field>
            <Field label="Author (optional)"><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
          </div>
          <Field label="Text">
            <textarea className="input min-h-[220px] font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} required placeholder="Paste the story, lesson or screenplay here. Do not paste copyrighted works you are not licensed to adapt." />
          </Field>
          <Field label="Rights note (optional)"><input className="input" value={rights} onChange={(e) => setRights(e.target.value)} placeholder="e.g. public domain (published 1890) / licensed from … / original work" /></Field>
        </div>

        <div className="card grid gap-3 p-4">
          <div className="label">Production brief</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Genre"><input className="input" value={genre} onChange={(e) => setGenre(e.target.value)} /></Field>
            <Field label="Audience"><input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} /></Field>
            <Field label="Age range"><input className="input" value={ageRange} onChange={(e) => setAgeRange(e.target.value)} placeholder="e.g. 6-9" /></Field>
            <Field label="Target duration (s)"><input className="input" type="number" min={20} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
            <Field label="Language"><input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
            <Field label="Format"><input className="input" value={format} onChange={(e) => setFormat(e.target.value)} /></Field>
          </div>
          <Field label="Visual style"><input className="input" value={style} onChange={(e) => setStyle(e.target.value)} /></Field>
          <Field label="Tone (optional)"><input className="input" value={tone} onChange={(e) => setTone(e.target.value)} /></Field>
          <Field label="Adaptation instructions (optional)"><textarea className="input min-h-[70px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
          <Field label={mode === "kids" ? "Required facts (one per line) — verified by the Source Fidelity Critic" : "Required facts (optional, one per line)"}>
            <textarea className="input min-h-[80px]" value={facts} onChange={(e) => setFacts(e.target.value)} />
          </Field>
        </div>

        {error && <div className="text-sm text-rose-glow">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create and run pipeline"}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-ink-300">{label}</div>
      {children}
    </label>
  );
}
