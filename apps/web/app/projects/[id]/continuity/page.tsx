"use client";

import { useEffect, useState } from "react";
import type { Violation } from "@cinememory/core";
import { useProject } from "@/components/ProjectProvider";
import { ActivityLog } from "@/components/ActivityLog";
import { Empty, PageTitle, Pill, Provenance, Section, Spinner, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { pct } from "@/lib/format";

type Filter = "attention" | "all" | "resolved";

export default function ContinuityPage() {
  const { id, live, summary } = useProject();
  const violations = useResource(() => api.violations(id), [id, live.tick]);
  const continuity = useResource(() => api.continuity(id), [id, live.tick]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const c = continuity.data;
  const all = violations.data ?? [];
  const needsAttention = all.filter((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated").length;
  useEffect(() => {
    if (violations.data && needsAttention === 0 && all.length > 0) setFilter((f) => (f === "attention" ? "all" : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violations.data]);
  const shown = all.filter((v) => (filter === "all" ? true : filter === "resolved" ? v.status === "resolved" || v.status === "overridden" : v.status === "open" || v.status === "repairing" || v.status === "escalated"));
  const sel = all.find((v) => v.id === selected) ?? null;
  const running = !!live.job;

  const act = async (fn: () => Promise<unknown>, key: string) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await Promise.all([violations.refresh(), continuity.refresh(), summary.refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageTitle
        title="Continuity Command Center"
        subtitle="Every score below is pass ÷ evaluated checks from the latest critic runs. Checks that could not run (no keyframe, no vision model) are listed as not evaluated and never counted as passes."
        actions={
          <>
            <button className="btn-ghost" disabled={running} onClick={() => act(() => api.verify(id), "verify")}>{busy === "verify" ? <Spinner /> : null} Re-run critics</button>
            <button className="btn-primary" disabled={running || !all.some((v) => v.status === "open" || v.status === "escalated")} onClick={() => act(() => api.run(id, "narrative_verified", true), "repairall")}>Auto-repair all</button>
          </>
        }
      />
      {error && <div className="mb-3 text-sm text-rose-glow">{error}</div>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Visual continuity" value={pct(c.visual.passRate)} hint={`${c.visual.checksPassed}/${c.visual.checksEvaluated} checks${c.visual.notEvaluated ? ` · ${c.visual.notEvaluated} not evaluated` : ""}`} tone={c.visual.passRate === null ? "neutral" : c.visual.passRate === 1 ? "good" : "warn"} />
          <Stat label="Narrative continuity" value={pct(c.narrative.passRate)} hint={`${c.narrative.checksPassed}/${c.narrative.checksEvaluated} checks`} tone={c.narrative.passRate === null ? "neutral" : c.narrative.passRate === 1 ? "good" : "warn"} />
          <Stat label="Source fidelity" value={pct(c.source.passRate)} hint={`${c.source.checksPassed}/${c.source.checksEvaluated} checks${c.source.notEvaluated ? ` · ${c.source.notEvaluated} not evaluated` : ""}`} tone={c.source.passRate === null ? "neutral" : c.source.passRate === 1 ? "good" : "warn"} />
          <Stat label="Unresolved violations" value={c.unresolved} hint={`${c.resolved} resolved · ${c.escalated} escalated · ${c.total} total`} tone={c.unresolved ? "bad" : c.total ? "good" : "neutral"} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_420px]">
        <Section
          title="Violations"
          aside={
            <div className="flex gap-1">
              {(["attention", "all", "resolved"] as Filter[]).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 text-xs ${filter === f ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}>{f}</button>
              ))}
            </div>
          }
        >
          {violations.loading ? (
            <div className="text-sm text-ink-400">Loading…</div>
          ) : shown.length === 0 ? (
            <Empty title={filter === "attention" ? "Nothing needs attention" : "No violations"} hint={all.length ? "All detected violations have been repaired and re-verified." : "Run verification to evaluate constraints against the screenplay and shots."} />
          ) : (
            <ul className="space-y-2">
              {shown.map((v) => (
                <li key={v.id} onClick={() => setSelected(v.id)} className={`cursor-pointer rounded-lg border p-3 transition ${selected === v.id ? "border-amber-glow/60 bg-ink-800" : "border-ink-700/60 bg-ink-900/40 hover:border-ink-600"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-100">{v.code}</span>
                    <Pill value={v.severity} kind="severity" />
                    <Pill value={v.status} />
                    <span className="text-xs text-ink-400">{v.critic.replace("_", " ")}{v.scope.sceneNumber ? ` · Scene ${v.scope.sceneNumber}` : ""}{v.scope.shotId ? ` · ${v.scope.shotId}` : ""}</span>
                  </div>
                  <div className="mt-1.5 grid gap-0.5 text-sm">
                    <div><span className="text-ink-400">Expected:</span> <span className="text-ink-100">{v.expected}</span></div>
                    <div><span className="text-ink-400">Observed:</span> <span className="text-ink-100">{v.observed}</span></div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="btn-ghost !py-0.5 !text-xs" onClick={(e) => { e.stopPropagation(); setSelected(v.id); }}>View evidence</button>
                    {(v.status === "open" || v.status === "escalated") && (
                      <button className="btn-primary !py-0.5 !text-xs" disabled={running || busy === v.id} onClick={(e) => { e.stopPropagation(); void act(() => api.repair(id, v.id), v.id); }}>{busy === v.id ? <Spinner className="border-ink-950 border-t-transparent" /> : null} Auto repair</button>
                    )}
                    {(v.status === "open" || v.status === "escalated" || v.status === "repairing") && (
                      <button className="btn-ghost !py-0.5 !text-xs" disabled={busy === v.id} onClick={(e) => { e.stopPropagation(); const note = prompt("Why is this acceptable?", "Accepted by director") ?? undefined; if (note !== undefined) void act(() => api.override(id, v.id, note), v.id); }}>Manual override</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-4">
          <Section title="Evidence">
            {!sel ? <div className="text-sm text-ink-400">Select a violation to inspect its constraint, evidence, provenance and repair history.</div> : <Evidence v={sel} />}
          </Section>
          <Section title="Critic activity">
            <ActivityLog compact events={live.events.filter((e) => ["narrative_critic", "source_fidelity_critic", "visual_critic", "repair", "user"].includes(e.agent))} height="h-[300px]" />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Evidence({ v }: { v: Violation }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="label">Constraint</div>
        <div className="text-ink-100">{v.constraint}</div>
        {v.constraintId && <div className="font-mono text-[11px] text-ink-400">{v.constraintId}</div>}
      </div>
      <div>
        <div className="label">Evidence</div>
        <div className="rounded bg-ink-950 p-2 font-mono text-[12px] leading-5 text-ink-200">{v.evidence}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
        <span>confidence {v.confidence.toFixed(2)}</span>
        <Provenance p={v.provenance} />
        <span>detected {v.detectedAt.slice(0, 19).replace("T", " ")}</span>
      </div>
      {v.scope.entityIds.length > 0 && <div className="text-xs text-ink-400">entities: {v.scope.entityIds.join(", ")}</div>}
      {v.resolutionNote && <div className="rounded border border-lime-glow/30 bg-lime-glow/5 px-2 py-1 text-xs text-lime-glow">{v.resolutionNote}</div>}
      {v.repairAttempts.length > 0 && (
        <div>
          <div className="label mb-1">Repair attempts</div>
          <ol className="space-y-1">
            {v.repairAttempts.map((a) => (
              <li key={a.attempt} className="rounded bg-ink-900/70 p-2 text-xs">
                <div className="flex items-center gap-2"><span className="font-semibold text-ink-100">#{a.attempt}</span><Pill value={a.outcome === "resolved" ? "resolved" : a.outcome === "error" ? "failed" : "open"} /><span className="text-ink-400">root cause: {a.rootCause}</span></div>
                <div className="mt-0.5 text-ink-200">{a.strategy} → {a.target}</div>
                <div className="text-ink-400">{a.detail}</div>
                {a.provenance && <Provenance p={a.provenance} />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
