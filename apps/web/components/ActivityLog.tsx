"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkflowEvent } from "@cinememory/core";
import { AGENT_COLOR, AGENT_LABEL, clock } from "@/lib/format";

const LEVEL_DOT: Record<string, string> = { info: "bg-ink-400", warn: "bg-amber-glow", error: "bg-rose-glow", success: "bg-lime-glow" };

/** Renders the persisted workflow event log verbatim. Nothing here is decorative. */
export function ActivityLog({ events, height = "h-[480px]", compact = false }: { events: WorkflowEvent[]; height?: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  if (events.length === 0) return <div className="py-8 text-center text-sm text-ink-400">No agent activity yet.</div>;
  return (
    <div ref={ref} className={`scrollbar-thin overflow-y-auto ${height}`}>
      <ol className="space-y-0.5">
        {events.map((e) => (
          <li key={e.seq} className="group rounded px-2 py-1 hover:bg-ink-800/70" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
            <div className="flex items-start gap-2 text-[13px] leading-5">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[e.level] ?? "bg-ink-400"}`} />
              <span className="w-[62px] shrink-0 font-mono text-[11px] text-ink-400">{clock(e.ts)}</span>
              {!compact && <span className={`w-[150px] shrink-0 truncate text-xs font-semibold ${AGENT_COLOR[e.agent] ?? "text-ink-300"}`}>{AGENT_LABEL[e.agent] ?? e.agent}</span>}
              <span className={`min-w-0 flex-1 ${e.level === "error" ? "text-rose-glow" : e.level === "warn" ? "text-amber-soft" : "text-ink-200"}`}>{e.message}</span>
            </div>
            {open === e.seq && Object.keys(e.data).length > 0 && (
              <pre className="scrollbar-thin ml-[230px] mt-1 max-h-48 overflow-auto rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">{JSON.stringify(e.data, null, 1)}</pre>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
