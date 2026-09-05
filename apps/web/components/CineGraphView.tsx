"use client";

import { useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CineGraph, GraphNode, GraphNodeType } from "@cinememory/core";

export const TYPE_STYLE: Record<GraphNodeType, { bg: string; border: string; label: string }> = {
  character: { bg: "#3b2f0c", border: "#f5b942", label: "Character" },
  scene: { bg: "#0f2e33", border: "#3fd0c9", label: "Scene" },
  event: { bg: "#241d3f", border: "#a78bfa", label: "Event" },
  prop: { bg: "#2f3a12", border: "#9be15d", label: "Prop" },
  location: { bg: "#1b2a44", border: "#6ea8ff", label: "Location" },
  knowledge: { bg: "#3a1a3a", border: "#ff8ae2", label: "Knowledge" },
  constraint: { bg: "#1c2233", border: "#8a96b5", label: "Constraint" },
  violation: { bg: "#3f1620", border: "#ff6b8b", label: "Violation" },
};

const COLUMNS: GraphNodeType[] = ["character", "scene", "event", "prop", "location", "knowledge", "constraint", "violation"];

const EDGE_COLOR: Record<string, string> = {
  appears_in: "#f5b942",
  occurs_in: "#a78bfa",
  uses: "#9be15d",
  set_in: "#6ea8ff",
  knows: "#ff8ae2",
  unknown_to: "#5b4a5b",
  constrains: "#8a96b5",
  depends_on: "#c4b5fd",
  relationship: "#f5b942",
  violates: "#ff6b8b",
  satisfies: "#3fd0c9",
};

/** Deterministic layered layout: one column per node type, nodes ordered by label/scene number. */
function layout(graph: CineGraph, hidden: Set<GraphNodeType>): { nodes: Node[]; edges: Edge[] } {
  const visible = graph.nodes.filter((n) => !hidden.has(n.type));
  const byType = new Map<GraphNodeType, GraphNode[]>();
  for (const n of visible) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  const cols = COLUMNS.filter((t) => byType.has(t));
  const nodes: Node[] = [];
  cols.forEach((t, ci) => {
    const list = [...byType.get(t)!].sort((a, b) => (t === "scene" ? (a.data.number as number) - (b.data.number as number) : a.label.localeCompare(b.label)));
    const gap = t === "constraint" || t === "knowledge" ? 92 : 72;
    const totalH = list.length * gap;
    list.forEach((n, i) => {
      const s = TYPE_STYLE[n.type];
      nodes.push({
        id: n.id,
        position: { x: ci * 300, y: i * gap - totalH / 2 },
        data: { label: n.label, node: n },
        style: { background: s.bg, border: `1.5px solid ${s.border}`, color: "#e9edf6", borderRadius: 10, fontSize: 12, width: 220, padding: "6px 10px", whiteSpace: "normal", lineHeight: 1.25 },
      });
    });
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: e.type === "violates",
      style: { stroke: EDGE_COLOR[e.type] ?? "#6b7794", strokeWidth: e.type === "violates" ? 2 : 1.2, strokeDasharray: e.type === "unknown_to" ? "4 4" : undefined, opacity: e.type === "unknown_to" ? 0.6 : 0.9 },
      labelStyle: { fill: "#c7cee0", fontSize: 9 },
      labelBgStyle: { fill: "#0c1019", fillOpacity: 0.9 },
    }));
  return { nodes, edges };
}

export function CineGraphView({ graph, onSelect, selected }: { graph: CineGraph; onSelect: (n: GraphNode | null) => void; selected: string | null }) {
  const [hidden, setHidden] = useState<Set<GraphNodeType>>(new Set());
  const { nodes, edges } = useMemo(() => layout(graph, hidden), [graph, hidden]);
  const styled = useMemo(
    () =>
      nodes.map((n) => {
        const neighbor = selected && edges.some((e) => (e.source === selected && e.target === n.id) || (e.target === selected && e.source === n.id));
        const dim = selected && n.id !== selected && !neighbor;
        return { ...n, style: { ...n.style, opacity: dim ? 0.25 : 1, boxShadow: n.id === selected ? "0 0 0 3px rgba(245,185,66,0.5)" : undefined } };
      }),
    [nodes, edges, selected],
  );
  const styledEdges = useMemo(() => edges.map((e) => ({ ...e, style: { ...e.style, opacity: selected && e.source !== selected && e.target !== selected ? 0.12 : (e.style?.opacity as number) } })), [edges, selected]);
  const onNodeClick: NodeMouseHandler = (_, node) => onSelect((node.data as { node: GraphNode }).node);
  useEffect(() => {
    if (selected && !graph.nodes.some((n) => n.id === selected)) onSelect(null);
  }, [graph, selected, onSelect]);

  return (
    <div className="relative h-[760px] overflow-hidden rounded-xl border border-ink-700/70 bg-ink-900">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        {COLUMNS.filter((t) => graph.stats[t] > 0).map((t) => (
          <button key={t} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })} className={`rounded-full border px-2 py-0.5 text-[11px] ${hidden.has(t) ? "border-ink-700 text-ink-500 line-through" : ""}`} style={hidden.has(t) ? {} : { borderColor: TYPE_STYLE[t].border, color: TYPE_STYLE[t].border, background: TYPE_STYLE[t].bg }}>
            {TYPE_STYLE[t].label} {graph.stats[t]}
          </button>
        ))}
      </div>
      <ReactFlow nodes={styled} edges={styledEdges} onNodeClick={onNodeClick} onPaneClick={() => onSelect(null)} fitView minZoom={0.2} colorMode="dark" nodesDraggable nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background color="#212a40" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
