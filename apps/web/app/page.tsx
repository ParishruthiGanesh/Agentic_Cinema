"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { STAGES, pct, stageIndex, timeAgo } from "@/lib/format";
import { Empty, PageTitle, Pill } from "@/components/ui";

export default function DashboardPage() {
  const projects = useResource(() => api.projects(), [], 5000);
  const [busy, setBusy] = useState(false);

  const createDemo = async () => {
    setBusy(true);
    try {
      const s = await api.createDemo();
      await api.run(s.project.id, "narrative_verified").catch(() => undefined);
      await projects.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="Projects"
        subtitle="Every project carries a persistent world memory, a verified screenplay, planned shots and a continuity record."
        actions={
          <>
            <button className="btn-ghost" onClick={createDemo} disabled={busy}>
              {busy ? "Creating…" : "Create demo project"}
            </button>
            <Link href="/projects/new" className="btn-primary">New project</Link>
          </>
        }
      />
      {projects.error && <div className="mb-4 text-sm text-rose-glow">{projects.error}</div>}
      {projects.data && projects.data.length === 0 && (
        <Empty
          title="No projects yet"
          hint='Create the bundled demo ("Lumi and the Broken Compass") to see the whole pipeline — extraction, world memory, screenplay, CineGraph, continuity checks and autonomous repair — or start from your own story.'
          action={
            <button className="btn-primary" onClick={createDemo} disabled={busy}>
              {busy ? "Creating…" : "Create demo project"}
            </button>
          }
        />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.data?.map((s) => {
          const p = s.project;
          const idx = stageIndex(p.stage);
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="card card-hover block p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-ink-100">{p.title}</div>
                  <div className="mt-0.5 text-xs text-ink-400">
                    {p.mode === "kids" ? "Kids / educational" : "Creator"} · {p.source.kind.replace("_", " ")} · {p.brief.targetDurationSec}s · updated {timeAgo(p.updatedAt)}
                  </div>
                </div>
                {p.isDemo && <Pill value="demo" className="border-teal-glow/50 text-teal-glow" />}
              </div>
              <div className="mt-3 flex items-center gap-1">
                {STAGES.map((st, i) => (
                  <span key={st.id} title={st.label} className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-amber-glow" : "bg-ink-700"}`} />
                ))}
              </div>
              <div className="mt-1 text-[11px] text-ink-400">{STAGES[idx]?.label}</div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <Mini label="scenes" value={s.counts.scenes} />
                <Mini label="shots" value={s.counts.shots} />
                <Mini label="constraints" value={s.counts.constraints} />
                <Mini label="unresolved" value={s.counts.unresolved} tone={s.counts.unresolved ? "bad" : s.counts.violations ? "good" : undefined} />
              </div>
              <div className="mt-3 flex gap-3 text-[11px] text-ink-400">
                <span>narrative {pct(s.continuity.narrative.passRate)}</span>
                <span>source {pct(s.continuity.source.passRate)}</span>
                <span>visual {pct(s.continuity.visual.passRate)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-md bg-ink-900/70 px-2 py-1.5">
      <div className={`text-lg font-semibold tabular-nums ${tone === "bad" ? "text-rose-glow" : tone === "good" ? "text-lime-glow" : "text-ink-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
}
