"use client";

import { useState } from "react";
import type { EvalMetrics } from "@cinememory/core";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Provenance, Section, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { pct } from "@/lib/format";

const ROWS: Array<{ key: keyof EvalMetrics; label: string; better: "higher" | "lower" | "none"; fmt?: (v: number | null) => string }> = [
  { key: "constraintsEvaluated", label: "Constraints evaluated", better: "none" },
  { key: "checksEvaluated", label: "Checks evaluated", better: "none" },
  { key: "checksNotEvaluated", label: "Checks not evaluated", better: "none" },
  { key: "violationsDetected", label: "Violations detected", better: "none" },
  { key: "violationsRepaired", label: "Violations repaired", better: "higher" },
  { key: "violationsUnresolved", label: "Unresolved violations", better: "lower" },
  { key: "visualPassRate", label: "Visual continuity pass rate", better: "higher", fmt: pct },
  { key: "narrativePassRate", label: "Narrative constraint pass rate", better: "higher", fmt: pct },
  { key: "sourcePassRate", label: "Source constraint pass rate", better: "higher", fmt: pct },
  { key: "repairAttempts", label: "Repair attempts", better: "none" },
];

export default function EvaluationPage() {
  const { id, live } = useProject();
  const evals = useResource(() => api.evaluations(id), [id, live.tick]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const latest = evals.data?.[0];

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.evaluate(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="Baseline vs CineMemory"
        subtitle="Both variants run on this project's source. Baseline generates the screenplay and shots without state retrieval or constraint injection and never repairs; CineMemory uses scene-scoped memory, injected constraints, critics and the bounded repair loop. Numbers are computed from the persisted check and violation records of each run."
        actions={<button className="btn-primary" onClick={run} disabled={busy || !!live.job}>{busy || live.job?.kind === "evaluate" ? <><Spinner className="border-ink-950 border-t-transparent" /> Running…</> : latest ? "Run again" : "Run evaluation"}</button>}
      />
      {error && <div className="mb-3 text-sm text-rose-glow">{error}</div>}
      {!latest ? (
        <Empty title="No evaluation yet" hint="Run the harness to measure what CineMemory changes on this project. It creates two inspectable evaluation projects." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Section title={`Results · ${latest.createdAt.slice(0, 16).replace("T", " ")}`} aside={<span className="text-xs text-ink-400">{evals.data?.length} run{evals.data && evals.data.length > 1 ? "s" : ""}</span>}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-400"><th className="pb-2">Metric</th><th className="pb-2 text-right">Baseline</th><th className="pb-2 text-right">CineMemory</th><th className="pb-2 text-right">Δ</th></tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const b = latest.baseline.metrics[r.key];
                  const c = latest.cinememory.metrics[r.key];
                  const f = r.fmt ?? ((v: number | null) => (v === null ? "n/a" : String(v)));
                  const delta = b === null || c === null ? null : c - b;
                  const good = delta === null || delta === 0 || r.better === "none" ? "text-ink-300" : (r.better === "higher" ? delta > 0 : delta < 0) ? "text-lime-glow" : "text-rose-glow";
                  return (
                    <tr key={r.key} className="border-t border-ink-700/60">
                      <td className="py-2 text-ink-200">{r.label}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-ink-100">{f(b)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-ink-100">{f(c)}</td>
                      <td className={`py-2 text-right font-mono tabular-nums ${good}`}>{delta === null ? "" : r.fmt ? `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} pts` : `${delta > 0 ? "+" : ""}${delta}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[latest.baseline, latest.cinememory].map((r) => (
                <div key={r.id} className="rounded bg-ink-900/70 p-3 text-xs">
                  <div className="mb-1 flex items-center justify-between"><span className="font-semibold uppercase tracking-wide text-ink-100">{r.variant}</span><Provenance p={r.provenance} /></div>
                  <ul className="space-y-1 text-ink-300">{r.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
                  <div className="mt-2 text-ink-400">Evidence project: <a className="text-amber-glow hover:underline" href={`/projects/${r.evalProjectId}/continuity`}>{r.evalProjectId}</a></div>
                </div>
              ))}
            </div>
          </Section>
          <Section title="How to read this">
            <div className="space-y-2 text-xs text-ink-300">
              <p><strong className="text-ink-100">Constraints evaluated</strong> counts distinct constraints the critics could check. Both variants see the same world, so this matches.</p>
              <p><strong className="text-ink-100">Violations detected</strong> in the baseline are what an unguarded generation produced; in CineMemory they are what the critics caught before repair.</p>
              <p><strong className="text-ink-100">Pass rates</strong> are pass ÷ evaluated checks after the run finished (after repair for CineMemory). Media-level visual checks are excluded when no vision model or model-generated keyframe is available; they appear under “not evaluated”.</p>
              <p>Every evaluation run is a real project you can open to read its screenplay, violations and event log.</p>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
