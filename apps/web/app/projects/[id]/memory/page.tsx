"use client";

import { useState } from "react";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Section, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { clock } from "@/lib/format";

/**
 * Production Memory page: makes ClickHouse's role visible. Every number here is a live query result.
 * "Gemini reasons; ClickHouse remembers."
 */
export default function MemoryPage() {
  const { id, live, summary } = useProject();
  const memory = useResource(() => api.memory(id), [id, live.tick]);
  const screenplay = useResource(() => api.screenplay(id), [id]);
  const [sceneN, setSceneN] = useState(4);
  const scene = useResource(() => api.memoryScene(id, sceneN), [id, sceneN, live.tick]);
  const m = memory.data;
  if (memory.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!m) return <Empty title="Memory unavailable" hint={memory.error} />;
  const isCH = m.name === "clickhouse";
  const total = m.stats.reduce((s, t) => s + t.rows, 0);
  const world = summary.data?.counts;
  const name = (cid: string) => cid;

  return (
    <div>
      <PageTitle
        title="Production Memory"
        subtitle={isCH ? "ClickHouse is CineMemory's long-horizon memory: every scene, shot, state change, knowledge event, constraint, violation, agent action, generation and repair attempt is appended here, and agents query only the history relevant to the scene they are reasoning about." : "ClickHouse is not configured: this project's memory lives in the local document store. Set CLICKHOUSE_URL to use persistent production memory."}
        actions={<Pill value={isCH ? "ClickHouse" : "local memory"} className={isCH ? "border-amber-glow/60 text-amber-glow" : "border-ink-600 text-ink-300"} />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rows for this production" value={total.toLocaleString()} hint={`${m.stats.length} tables · ${m.trace.latencyMs}ms`} />
        <Stat label="Agent actions (LLM calls)" value={m.stats.find((t) => t.table === "agent_actions")?.rows ?? m.agentActions.length} hint={m.analytics?.llmUsage.map((u) => `${u.provider}/${u.model}: ${u.calls}`).join(" · ") || "recorded per call"} />
        <Stat label="Memory retrievals" value={m.retrievals.length} hint="scene-scoped queries by agents (last 30)" />
        <Stat label="State changes stored" value={m.stats.find((t) => t.table === "state_changes")?.rows ?? "–"} hint={world ? `${world.scenes} scenes · all screenplay versions` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Section title="Scene retrieval explorer" aside={<span className="text-xs text-ink-400">what an agent gets for a scene</span>}>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-ink-400">Before scene</span>
            <select className="input !w-auto !py-1" value={sceneN} onChange={(e) => setSceneN(Number(e.target.value))}>
              {(screenplay.data?.scenes ?? []).map((s) => <option key={s.id} value={s.number}>{s.number} · {s.title}</option>)}
            </select>
          </div>
          {scene.data ? (
            <div className="space-y-3 text-xs">
              <div className="rounded bg-ink-900/70 p-2">
                <div className="label mb-1">Knowledge events before scene {sceneN} <span className="text-ink-500">({scene.data.knowledge.trace.source}, {scene.data.knowledge.trace.rows} rows, {scene.data.knowledge.trace.latencyMs}ms)</span></div>
                {scene.data.knowledge.events.length === 0 ? <div className="text-ink-400">nobody knows any tracked fact yet</div> : scene.data.knowledge.events.map((e, i) => <div key={i} className="text-lime-glow">✓ {name(e.characterId)} knows “{e.statement}” since Scene {e.sceneNumber}{e.via ? ` (${e.via})` : ""}</div>)}
                {scene.data.context?.forbiddenFacts.map((f) => <div key={f.fact.id} className="text-rose-glow">✗ must not be referenced by {f.unknownTo.join(", ")}: “{f.fact.statement}”</div>)}
              </div>
              <div className="rounded bg-ink-900/70 p-2">
                <div className="label mb-1">State changes before scene {sceneN} <span className="text-ink-500">({scene.data.state.trace.source}, {scene.data.state.trace.rows} rows, {scene.data.state.trace.latencyMs}ms)</span></div>
                <div className="scrollbar-thin max-h-48 overflow-auto">
                  {scene.data.state.changes.map((c) => <div key={c.id} className="text-ink-300">S{c.sceneNumber} {c.entityId}.{c.field}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}</div>)}
                </div>
              </div>
              {scene.data.history.violations.length > 0 && (
                <div className="rounded bg-ink-900/70 p-2">
                  <div className="label mb-1">Violation history for this scene</div>
                  {scene.data.history.violations.map((v) => <div key={v.violationId} className="text-ink-300">{v.code} · {v.status} · {v.repairAttempts} repair attempt{v.repairAttempts === 1 ? "" : "s"}</div>)}
                </div>
              )}
              {scene.data.knowledge.trace.sql && (
                <div>
                  <div className="label mb-1">SQL executed</div>
                  <pre className="scrollbar-thin max-h-40 overflow-auto rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">{scene.data.knowledge.trace.sql}</pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-ink-400">{scene.error ?? "Loading…"}</div>
          )}
        </Section>

        <div className="space-y-4">
          <Section title={isCH ? "ClickHouse tables (this production)" : "Local memory collections"}>
            <table className="w-full text-sm">
              <tbody>
                {m.stats.map((t) => (
                  <tr key={t.table} className="border-t border-ink-700/60">
                    <td className="py-1 font-mono text-xs text-ink-200">{t.table}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-ink-100">{t.rows.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          {m.analytics && (
            <Section title="Analytics (SQL)">
              <div className="grid gap-3 text-xs md:grid-cols-2">
                <div>
                  <div className="label mb-1">Events by agent</div>
                  {m.analytics.eventsByAgent.map((r) => <div key={r.agent} className="flex justify-between text-ink-300"><span>{r.agent}</span><span className="font-mono">{r.count}</span></div>)}
                </div>
                <div>
                  <div className="label mb-1">Violations by code / status</div>
                  {m.analytics.violationsByCode.length === 0 && <div className="text-ink-400">none</div>}
                  {m.analytics.violationsByCode.map((r, i) => <div key={i} className="flex justify-between text-ink-300"><span className="font-mono">{r.code}</span><span>{r.status} · {r.count}</span></div>)}
                  <div className="label mb-1 mt-3">Repair outcomes</div>
                  {m.analytics.repairOutcomes.map((r) => <div key={r.outcome} className="flex justify-between text-ink-300"><span>{r.outcome}</span><span className="font-mono">{r.count}</span></div>)}
                </div>
                <div className="md:col-span-2">
                  <div className="label mb-1">Model usage</div>
                  {m.analytics.llmUsage.map((u, i) => <div key={i} className="text-ink-300">{u.provider}/{u.model}: {u.calls} calls · avg {u.avgMs}ms · {u.inputTokens.toLocaleString()}→{u.outputTokens.toLocaleString()} tokens{u.failures ? ` · ${u.failures} failed` : ""}</div>)}
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Section title="Recent memory retrievals" aside={<span className="text-xs text-ink-400">from the event log · click for SQL</span>}>
          <Retrievals items={m.retrievals} />
        </Section>
        <Section title="Agent actions" aside={<span className="text-xs text-ink-400">every model call, from memory</span>}>
          <div className="scrollbar-thin max-h-[420px] overflow-auto">
            {m.agentActions.length === 0 && <div className="text-sm text-ink-400">no model calls recorded</div>}
            {m.agentActions.map((a) => (
              <div key={a.actionId} className="flex items-center gap-2 border-t border-ink-700/40 py-1 text-xs">
                <span className="w-[62px] font-mono text-ink-400">{clock(a.createdAt)}</span>
                <span className={`w-2 h-2 rounded-full ${a.ok ? "bg-lime-glow" : "bg-rose-glow"}`} />
                <span className="w-[150px] truncate text-ink-100">{a.task}</span>
                <span className="text-ink-300">{a.provider}{a.model ? `/${a.model}` : ""}</span>
                <span className="ml-auto font-mono text-ink-400">{a.latencyMs}ms{a.inputTokens ? ` · ${a.inputTokens}→${a.outputTokens}` : ""}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Retrievals({ items }: { items: Array<{ seq: number; ts: string; agent: string; message: string; data: Record<string, unknown> }> }) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return <div className="text-sm text-ink-400">no retrievals yet — run the pipeline</div>;
  return (
    <div className="scrollbar-thin max-h-[420px] overflow-auto">
      {items.map((e) => (
        <div key={e.seq} className="cursor-pointer border-t border-ink-700/40 py-1 text-xs hover:bg-ink-800/60" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
          <div className="flex gap-2"><span className="w-[62px] font-mono text-ink-400">{clock(e.ts)}</span><span className="w-[110px] text-amber-glow">{e.agent.replace("_", " ")}</span><span className="text-ink-200">{e.message}</span></div>
          {open === e.seq && typeof e.data.sql === "string" && <pre className="mt-1 whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">{e.data.sql}</pre>}
        </div>
      ))}
    </div>
  );
}
