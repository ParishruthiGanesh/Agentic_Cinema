"use client";

import { useProject } from "@/components/ProjectProvider";
import { PageTitle, Provenance, Section, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

export default function StoryPage() {
  const { id, summary, live } = useProject();
  const adaptation = useResource(() => api.adaptation(id), [id, live.tick]);
  const world = useResource(() => api.world(id), [id, live.tick]);
  const p = summary.data?.project;
  if (!p) return null;
  const plan = adaptation.data;
  const w = world.data;

  return (
    <div>
      <PageTitle title="Story" subtitle="The source as provided, what the Source Intelligence Agent extracted from it, and how the Adaptation Agent decided to fit it into the brief." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Section title={`Source · ${p.source.kind.replace("_", " ")}`} aside={<span className="text-xs text-ink-400">{p.source.text.length.toLocaleString()} chars{p.source.author ? ` · ${p.source.author}` : ""}</span>}>
          <div className="mb-2 text-sm font-medium text-ink-100">{p.source.title}</div>
          {p.source.rightsNote && <div className="mb-3 rounded border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs text-ink-300">Rights: {p.source.rightsNote}</div>}
          <pre className="scrollbar-thin max-h-[640px] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-6 text-ink-200">{p.source.text}</pre>
        </Section>
        <div className="space-y-4">
          <Section title="Extraction summary" aside={w ? <span className="text-xs text-ink-400">world v{w.version}</span> : null}>
            {!w ? (
              <div className="text-sm text-ink-400">Not analyzed yet. Run the pipeline from the Production page.</div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  {w.themes.map((t) => <span key={t} className="pill border-teal-glow/40 text-teal-glow">{t}</span>)}
                </div>
                <div>
                  <div className="label mb-1">Timeline</div>
                  <ol className="ml-4 list-decimal text-ink-200">{w.timeline.map((t) => <li key={t}>{t}</li>)}</ol>
                </div>
                <div>
                  <div className="label mb-1">Source constraints ({w.sourceConstraints.length})</div>
                  <ul className="space-y-1">
                    {w.sourceConstraints.map((c) => (
                      <li key={c.id} className="rounded bg-ink-900/70 px-2 py-1">
                        <span className={`pill mr-2 ${c.importance === "must_keep" ? "border-rose-glow/50 text-rose-glow" : "border-ink-600 text-ink-300"}`}>{c.kind.replace("_", " ")}</span>
                        <span className="text-ink-200">{c.statement}</span>
                        {c.sourceEvidence && <div className="mt-0.5 text-xs italic text-ink-400">“{c.sourceEvidence}”</div>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label mb-1">Knowledge facts ({w.knowledgeFacts.length})</div>
                  <ul className="space-y-1">
                    {w.knowledgeFacts.map((f) => (
                      <li key={f.id} className="rounded bg-ink-900/70 px-2 py-1">
                        {f.isSecret && <span className="pill mr-2 border-violet-glow/60 text-violet-glow">secret</span>}
                        <span className="text-ink-200">{f.statement}</span>
                        <div className="mt-0.5 text-xs text-ink-400">
                          holders: {f.holders.map((h) => `${h.characterId} @ ${h.acquiredInScene}`).join(", ") || "none yet"} · triggers: {f.triggerPhrases.map((t) => `“${t}”`).join(", ")}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                {w.styleGuide && <div><div className="label mb-1">Style guide</div><div className="text-ink-200">{w.styleGuide}</div></div>}
              </div>
            )}
          </Section>
          <Section title="Adaptation plan" aside={plan ? <Provenance p={plan.provenance} /> : null}>
            {!plan ? (
              <Empty title="No adaptation yet" hint="The Adaptation Agent runs after source analysis." />
            ) : (
              <div className="space-y-3 text-sm">
                <div><span className="text-ink-400">Logline:</span> <span className="text-ink-100">{plan.logline}</span></div>
                <div className="text-ink-200">{plan.synopsis}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <List title={`Must keep (${plan.mustKeep.length})`} items={plan.mustKeep.map((m) => `${m.entityId} — ${m.reason}`)} tone="text-lime-glow" />
                  <List title={`Removed (${plan.removed.length})`} items={plan.removed.map((m) => `${m.entityId} — ${m.reason}`)} tone="text-rose-glow" />
                  <List title={`Compressed (${plan.compressed.length})`} items={plan.compressed.map((m) => `${m.entityId} — ${m.how}`)} tone="text-amber-glow" />
                  <List title={`Merged (${plan.merged.length})`} items={plan.merged.map((m) => `${m.from.join(" + ")} → ${m.into}: ${m.reason}`)} tone="text-violet-glow" />
                </div>
                <div>
                  <div className="label mb-1">Unbreakable causal chains</div>
                  {plan.unbreakableChains.map((c, i) => (
                    <div key={i} className="font-mono text-xs text-ink-200">{c.events.join(" → ")} <span className="text-ink-400">— {c.reason}</span></div>
                  ))}
                </div>
                <div>
                  <div className="label mb-1">Beat sheet</div>
                  <ol className="space-y-1">
                    {plan.beatSheet.map((b, i) => (
                      <li key={i} className="flex gap-2 rounded bg-ink-900/70 px-2 py-1">
                        <span className="w-5 shrink-0 text-ink-400">{i + 1}.</span>
                        <span className="flex-1 text-ink-200">{b.beat}</span>
                        <span className="shrink-0 text-xs text-ink-400">~{b.approxDurationSec}s</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {(plan.audienceNotes || plan.toneNotes) && <div className="text-xs text-ink-400">{plan.audienceNotes} {plan.toneNotes}</div>}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <div className={`label mb-1 ${tone}`}>{title}</div>
      {items.length === 0 ? <div className="text-xs text-ink-400">none</div> : <ul className="space-y-0.5 text-xs text-ink-200">{items.map((i) => <li key={i}>• {i}</li>)}</ul>}
    </div>
  );
}
