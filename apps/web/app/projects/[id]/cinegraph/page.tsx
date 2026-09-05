"use client";

import { useCallback, useState } from "react";
import type { GraphNode } from "@cinememory/core";
import { CineGraphView, TYPE_STYLE } from "@/components/CineGraphView";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

export default function CineGraphPage() {
  const { id, live } = useProject();
  const graph = useResource(() => api.graph(id), [id, live.tick]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const onSelect = useCallback((n: GraphNode | null) => setSelected(n), []);
  const g = graph.data;
  if (graph.loading) return <div className="text-sm text-ink-400">Loading…</div>;
  if (!g || g.nodes.length === 0) return <Empty title="CineGraph is empty" hint="Run source analysis to build the world memory; the graph grows as the screenplay and verification add scenes, knowledge timelines and violations." />;

  const related = selected ? g.edges.filter((e) => e.source === selected.id || e.target === selected.id) : [];
  const nodeById = (nid: string) => g.nodes.find((n) => n.id === nid);
  const groups = related.reduce<Record<string, Array<{ other: GraphNode; edge: (typeof related)[number]; dir: "→" | "←" }>>>((acc, e) => {
    const outgoing = e.source === selected!.id;
    const other = nodeById(outgoing ? e.target : e.source);
    if (!other) return acc;
    const key = e.type;
    (acc[key] = acc[key] ?? []).push({ other, edge: e, dir: outgoing ? "→" : "←" });
    return acc;
  }, {});

  return (
    <div>
      <PageTitle title="CineGraph" subtitle="Character → Scene → Event → Prop → Location → Knowledge → Constraint. Click a node to inspect its dependencies; knowledge edges show in which scene a character learns a fact, and who still does not know it." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <CineGraphView graph={g} onSelect={onSelect} selected={selected?.id ?? null} />
        <div className="space-y-4">
          <Section title="Inspector">
            {!selected ? (
              <div className="text-sm text-ink-400">
                <p>Select a node.</p>
                <p className="mt-2">Try the knowledge node: it shows the fact's timeline — who knows it from which scene, and who is marked UNKNOWN. That is exactly what the Narrative Critic enforces.</p>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <Pill value={TYPE_STYLE[selected.type].label} className="!normal-case !tracking-normal" />
                  <div className="mt-1 text-base font-semibold text-ink-100">{selected.label}</div>
                  <div className="font-mono text-[11px] text-ink-400">{selected.id}</div>
                </div>
                <div className="space-y-1 text-xs">
                  {Object.entries(selected.data).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[90px_1fr] gap-2"><span className="text-ink-400">{k}</span><span className="break-words text-ink-200">{typeof v === "string" ? v : JSON.stringify(v)}</span></div>
                  ))}
                </div>
                <div>
                  <div className="label mb-1">Dependencies ({related.length})</div>
                  {Object.entries(groups).map(([type, items]) => (
                    <div key={type} className="mb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{type.replace("_", " ")}</div>
                      <ul className="space-y-0.5">
                        {items.map(({ other, edge, dir }) => (
                          <li key={edge.id}>
                            <button onClick={() => setSelected(other)} className="w-full rounded px-1.5 py-0.5 text-left text-xs hover:bg-ink-800">
                              <span className="text-ink-500">{dir} </span>
                              <span style={{ color: TYPE_STYLE[other.type].border }}>{other.label}</span>
                              {edge.label && <span className="ml-1 text-ink-400">({edge.label})</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
          <Section title="Legend">
            <div className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(TYPE_STYLE).map(([t, s]) => (
                <div key={t} className="flex items-center gap-2 text-ink-300"><span className="h-3 w-3 rounded" style={{ background: s.bg, border: `1.5px solid ${s.border}` }} />{s.label} <span className="text-ink-500">{g.stats[t as keyof typeof g.stats]}</span></div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ink-400">Dashed edges: character does <em>not</em> know the fact. Animated edges: open violations.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
