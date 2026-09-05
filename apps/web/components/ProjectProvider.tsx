"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { api, type ProjectSummary } from "@/lib/api";
import { useLiveEvents, useResource, type LiveEvents, type Resource } from "@/lib/hooks";
import { STAGES, stageIndex } from "@/lib/format";
import { Pill, Spinner } from "./ui";

interface ProjectCtx {
  id: string;
  summary: Resource<ProjectSummary>;
  live: LiveEvents;
}

const Ctx = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProject outside ProjectProvider");
  return c;
}

const NAV = [
  { href: "", label: "Dashboard" },
  { href: "/story", label: "Story" },
  { href: "/cinegraph", label: "CineGraph" },
  { href: "/characters", label: "Characters" },
  { href: "/screenplay", label: "Screenplay" },
  { href: "/storyboard", label: "Storyboard" },
  { href: "/production", label: "Production" },
  { href: "/continuity", label: "Continuity" },
  { href: "/film", label: "Final Film" },
  { href: "/evaluation", label: "Evaluation" },
];

export function ProjectProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const summary = useResource(() => api.project(id), [id]);
  const live = useLiveEvents(id);
  const pathname = usePathname();
  // Any workflow event may change counts/stage: refresh the summary (cheap).
  useEffect(() => {
    if (live.tick > 0) void summary.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.tick]);

  const p = summary.data?.project;
  const base = `/projects/${id}`;
  return (
    <Ctx.Provider value={{ id, summary, live }}>
      <div className="grid grid-cols-[210px_1fr] gap-6">
        <aside className="sticky top-[88px] self-start">
          <div className="mb-3 px-2">
            <div className="label">Project</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-ink-100" title={p?.title}>{p?.title ?? id}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
              {p && <span>{STAGES[stageIndex(p.stage)]?.label}</span>}
              {live.job && (
                <span className="inline-flex items-center gap-1 text-amber-glow">
                  <Spinner /> {live.job.kind}
                </span>
              )}
            </div>
            {p?.isDemo && <Pill value="demo" className="mt-1 border-teal-glow/50 text-teal-glow" />}
          </div>
          <nav className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const href = base + n.href;
              const active = n.href === "" ? pathname === base : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link key={n.href} href={href} className={`rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-ink-800 text-amber-glow" : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">
          {summary.error && !summary.data ? <div className="card p-6 text-sm text-rose-glow">{summary.error}</div> : children}
        </div>
      </div>
    </Ctx.Provider>
  );
}
