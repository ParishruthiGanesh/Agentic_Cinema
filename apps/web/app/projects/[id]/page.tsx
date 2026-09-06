"use client";

import Link from "next/link";
import { useProject } from "@/components/ProjectProvider";
import { RunControls } from "@/components/RunControls";
import { ActivityLog } from "@/components/ActivityLog";
import { PageTitle, Section, Stat } from "@/components/ui";
import { STAGES, modeLabel, pct, secs, stageIndex } from "@/lib/format";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

function MemoryPanel({ id, tick }: { id: string; tick: number }) {
  const mem = useResource(() => api.memory(id), [id, tick]);
  const m = mem.data;
  if (!m) return null;
  const isCH = m.name === "clickhouse";
  const total = m.stats.reduce((s, t) => s + t.rows, 0);
  return (
    <Section title={<span>Production memory · <span className={isCH ? "text-amber-glow" : "text-ink-400"}>{isCH ? "ClickHouse" : "local (ClickHouse not configured)"}</span></span>} aside={<Link href={`/projects/${id}/memory`} className="text-xs text-amber-glow hover:underline">Open memory →</Link>}>
      <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-6">
        {[["rows stored", total], ...m.stats.filter((t) => ["state_changes", "knowledge_events", "violations", "agent_actions", "repair_attempts"].includes(t.table)).map((t) => [t.table.replace("_", " "), t.rows])].map(([k, v]) => (
          <div key={k as string} className="rounded-md bg-ink-900/70 py-2"><div className="text-lg font-semibold tabular-nums">{(v as number).toLocaleString()}</div><div className="text-[10px] uppercase tracking-wide text-ink-400">{k as string}</div></div>
        ))}
      </div>
      <div className="mt-2 text-xs text-ink-400">{m.retrievals.length ? `Last retrieval: ${m.retrievals[0].message}` : "Agents retrieve scene-scoped history from here instead of re-reading the whole film."}</div>
    </Section>
  );
}

export default function ProjectDashboard() {
  const { id, summary, live } = useProject();
  const s = summary.data;
  if (!s) return <div className="text-sm text-ink-400">Loading…</div>;
  const p = s.project;
  const c = s.counts;
  const cont = s.continuity;
  const genProgress = c.shots ? Math.round((c.generated / c.shots) * 100) : 0;
  const verifiedShots = c.shotsByStatus.VERIFIED ?? 0;

  return (
    <div>
      <PageTitle
        title={p.title}
        subtitle={
          <>
            {modeLabel(p.mode)} · source: {p.source.kind.replace("_", " ")} “{p.source.title}” · {p.brief.format}, {p.brief.genre}, {p.brief.audience}
            {p.brief.ageRange ? ` (${p.brief.ageRange})` : ""} · target {secs(p.brief.targetDurationSec)}
          </>
        }
      />
      {p.mode === "social_story" && p.socialStory && (
        <div className="mb-4 rounded-lg border border-violet-glow/40 bg-violet-glow/5 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-semibold text-ink-100">Social story for {p.socialStory.child.name}</span> <span className="text-ink-300">· {p.socialStory.steps.length} steps · one outfit: {p.socialStory.child.outfit}</span></div>
            <Link href={`/projects/${id}/certificate`} className="btn-primary !py-1 !text-xs">{p.approval ? `Approved by ${p.approval.approvedBy}` : "Open Continuity Certificate"}</Link>
          </div>
          <ol className="mt-2 grid gap-1 text-xs text-ink-300 md:grid-cols-2">{p.socialStory.steps.map((s, i) => <li key={i}><span className="text-amber-glow">{i + 1}.</span> {s.title}</li>)}</ol>
        </div>
      )}
      <RunControls />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Production stage" value={<span className="text-base">{STAGES[stageIndex(p.stage)]?.label}</span>} hint={`${p.stages.filter((x) => x.status === "complete").length - 1}/${STAGES.length - 1} stages complete`} />
        <Stat label="Scenes" value={c.scenes} hint={s.durationSec ? `${secs(s.durationSec)} · screenplay v${s.screenplayVersion}` : "not written yet"} />
        <Stat label="Shots" value={c.shots} hint={c.shots ? `${verifiedShots} verified` : "not planned yet"} />
        <Stat label="Generation" value={`${genProgress}%`} hint={`${c.generated}/${c.shots} keyframes`} tone={c.shots && genProgress === 100 ? "good" : "neutral"} />
        <Stat label="Continuity" value={cont.total ? `${cont.resolved}/${cont.total}` : "–"} hint={cont.total ? "violations resolved" : "no checks run yet"} tone={cont.unresolved ? "bad" : cont.total ? "good" : "neutral"} />
        <Stat label="Unresolved" value={c.unresolved} hint={cont.escalated ? `${cont.escalated} escalated to you` : "nothing needs attention"} tone={c.unresolved ? "bad" : "good"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="World memory" aside={<Link href={`/projects/${id}/cinegraph`} className="text-xs text-amber-glow hover:underline">Open CineGraph →</Link>}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Characters", c.characters],
              ["Locations", c.locations],
              ["Props", c.props],
              ["Events", c.events],
              ["Knowledge", c.knowledgeFacts],
              ["Constraints", c.constraints],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-md bg-ink-900/70 py-2">
                <div className="text-xl font-semibold tabular-nums">{v as number}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-400">{k as string}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Continuity status" aside={<Link href={`/projects/${id}/continuity`} className="text-xs text-amber-glow hover:underline">Command center →</Link>}>
          <div className="space-y-2">
            {[
              ["Visual continuity", cont.visual],
              ["Narrative continuity", cont.narrative],
              ["Source fidelity", cont.source],
            ].map(([label, v]) => {
              const x = v as typeof cont.visual;
              return (
                <div key={label as string} className="flex items-center justify-between text-sm">
                  <span className="text-ink-300">{label as string}</span>
                  <span className="tabular-nums">
                    <span className={x.passRate === null ? "text-ink-400" : x.passRate === 1 ? "text-lime-glow" : "text-amber-glow"}>{pct(x.passRate)}</span>
                    <span className="ml-2 text-xs text-ink-400">{x.checksEvaluated} checks{x.notEvaluated ? `, ${x.notEvaluated} n/e` : ""}</span>
                  </span>
                </div>
              );
            })}
            <div className="pt-1 text-xs text-ink-400">Scores are pass ÷ evaluated checks from the last critic runs. Checks that could not run are excluded, never counted as passes.</div>
          </div>
        </Section>
        <Section title="Brief">
          <div className="space-y-1 text-sm text-ink-200">
            <div><span className="text-ink-400">Style:</span> {p.brief.visualStyle}</div>
            {p.brief.tone && <div><span className="text-ink-400">Tone:</span> {p.brief.tone}</div>}
            <div><span className="text-ink-400">Language:</span> {p.brief.language}</div>
            {p.brief.adaptationInstructions && <div><span className="text-ink-400">Instructions:</span> {p.brief.adaptationInstructions}</div>}
            {p.brief.requiredFacts.length > 0 && (
              <div>
                <span className="text-ink-400">Required facts:</span>
                <ul className="ml-4 list-disc">{p.brief.requiredFacts.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
          </div>
        </Section>
      </div>

      <div className="mt-4">
        <MemoryPanel id={id} tick={live.tick} />
      </div>
      <div className="mt-4">
        <Section title="Agent activity" aside={<span className="text-xs text-ink-400">{live.connected ? "live" : "polling"} · {live.events.length} events</span>}>
          <ActivityLog events={live.events} height="h-[360px]" />
        </Section>
      </div>
    </div>
  );
}
