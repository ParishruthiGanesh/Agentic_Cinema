"use client";

import { useState } from "react";
import type { Stage } from "@cinememory/core";
import { api } from "@/lib/api";
import { STAGES, stageIndex } from "@/lib/format";
import { useProject } from "./ProjectProvider";
import { Pill, Spinner } from "./ui";

/** Pipeline stage strip + run/reset controls. Backed by real stage records on the project. */
export function RunControls({ compact = false }: { compact?: boolean }) {
  const { id, summary, live } = useProject();
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState<Stage>("narrative_verified");
  const p = summary.data?.project;
  if (!p) return null;
  const running = !!live.job;

  const run = async (toStage: Stage, force = false) => {
    setError(undefined);
    try {
      await api.run(id, toStage, force);
      await summary.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reset = async (stage: Stage) => {
    if (!confirm(`Reset from "${stage}"? Downstream artifacts (and their violations) will be discarded.`)) return;
    setError(undefined);
    try {
      await api.reset(id, stage);
      await summary.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const current = stageIndex(p.stage);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.filter((s) => s.id !== "created").map((s) => {
            const rec = p.stages.find((r) => r.stage === s.id);
            const status = rec?.status ?? "pending";
            const isRunning = status === "running";
            return (
              <button
                key={s.id}
                title={`${s.label}${rec?.error ? `: ${rec.error}` : ""}`}
                onClick={() => !running && (status === "complete" ? reset(s.id) : run(s.id))}
                className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${status === "complete" ? "border-lime-glow/40 text-lime-glow hover:border-rose-glow/50 hover:text-rose-glow" : status === "failed" ? "border-rose-glow/60 text-rose-glow" : isRunning ? "border-amber-glow/60 text-amber-glow pulse-glow" : "border-ink-700 text-ink-400 hover:border-ink-500 hover:text-ink-200"}`}
              >
                {isRunning ? <Spinner /> : <span className={`h-1.5 w-1.5 rounded-full ${status === "complete" ? "bg-lime-glow" : status === "failed" ? "bg-rose-glow" : "bg-ink-600"}`} />}
                {compact ? s.short : s.label}
                {status === "complete" && <span className="hidden text-[10px] group-hover:inline">reset</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-1 text-xs" value={target} onChange={(e) => setTarget(e.target.value as Stage)} disabled={running}>
            {STAGES.filter((s) => s.id !== "created").map((s) => (
              <option key={s.id} value={s.id}>to: {s.label}</option>
            ))}
          </select>
          <button className="btn-primary !py-1" disabled={running} onClick={() => run(target)}>
            {running ? <><Spinner className="border-ink-950 border-t-transparent" /> {live.job?.kind}…</> : current >= stageIndex(target) ? "Re-run" : "Run pipeline"}
          </button>
        </div>
      </div>
      {p.stages.find((r) => r.status === "failed") && (
        <div className="mt-2 text-xs text-rose-glow">
          Stage failed: {p.stages.find((r) => r.status === "failed")?.error}
        </div>
      )}
      {live.job?.error && <div className="mt-2 text-xs text-rose-glow">Last job error: {live.job.error}</div>}
      {error && <div className="mt-2 text-xs text-rose-glow">{error}</div>}
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-400">
          <span>Providers:</span>
          <Pill value={`llm ${p.llmProvider ?? "?"}`} className={p.llmProvider === "fixture" ? "border-amber-glow/50 text-amber-glow" : "border-ink-600 text-ink-300"} />
          <Pill value={`media ${p.mediaProvider ?? "?"}`} className={p.mediaProvider === "placeholder" ? "border-amber-glow/50 text-amber-glow" : "border-ink-600 text-ink-300"} />
          <span className="ml-2">Click a completed stage to reset from it; click a pending stage to run up to it.</span>
        </div>
      )}
    </div>
  );
}
