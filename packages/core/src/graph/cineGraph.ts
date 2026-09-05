import type { Screenplay, Violation, WorldState } from "../model/index.js";

export type GraphNodeType =
  | "character"
  | "scene"
  | "event"
  | "prop"
  | "location"
  | "knowledge"
  | "constraint"
  | "violation";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Small, UI-friendly payload for the inspector panel. */
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type:
    | "appears_in"
    | "occurs_in"
    | "uses"
    | "set_in"
    | "knows"
    | "unknown_to"
    | "constrains"
    | "depends_on"
    | "relationship"
    | "violates"
    | "satisfies";
  label?: string;
  data?: Record<string, unknown>;
}

export interface CineGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<GraphNodeType, number>;
}

const nid = (type: GraphNodeType, id: string) => `${type}:${id}`;

/**
 * Build the CineGraph: Character → Scene → Event → Prop → Location → Knowledge → Constraint.
 * Pure derivation from persisted state; the UI only renders it.
 */
export function buildCineGraph(world: WorldState, screenplay?: Screenplay, violations: Violation[] = []): CineGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (n: GraphNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const link = (e: Omit<GraphEdge, "id">) => {
    if (!seen.has(e.source) || !seen.has(e.target)) return;
    const id = `${e.type}:${e.source}->${e.target}${e.label ? ":" + e.label : ""}`;
    if (edges.some((x) => x.id === id)) return;
    edges.push({ id, ...e });
  };

  for (const c of world.characters) {
    add({
      id: nid("character", c.id),
      type: "character",
      label: c.name,
      data: { role: c.role, description: c.description, appearance: c.appearance.summary, clothing: c.clothing.summary, knowledge: c.knowledge, inventory: c.inventory },
    });
  }
  for (const l of world.locations) add({ id: nid("location", l.id), type: "location", label: l.name, data: { description: l.description, visual: l.visualSummary } });
  for (const p of world.props) add({ id: nid("prop", p.id), type: "prop", label: p.name, data: { description: p.description, visual: p.visualSummary, significance: p.significance, initialOwner: p.initialOwner } });
  for (const e of world.events) add({ id: nid("event", e.id), type: "event", label: e.name, data: { description: e.description, order: e.order, importance: e.importance, dependsOn: e.dependsOn } });
  for (const f of world.knowledgeFacts) {
    add({ id: nid("knowledge", f.id), type: "knowledge", label: f.statement, data: { isSecret: f.isSecret, holders: f.holders, triggerPhrases: f.triggerPhrases } });
  }
  for (const s of world.sourceConstraints) add({ id: nid("constraint", s.id), type: "constraint", label: s.statement, data: { kind: s.kind, importance: s.importance, family: "source" } });
  for (const v of world.visualConstraints) add({ id: nid("constraint", v.id), type: "constraint", label: `${v.entityId}: ${v.attribute} = ${v.value}`, data: { kind: v.attribute, severity: v.severity, family: "visual", entityId: v.entityId } });
  for (const c of world.continuityConstraints) add({ id: nid("constraint", c.id), type: "constraint", label: c.statement, data: { kind: c.kind, severity: c.severity, family: "continuity" } });

  const scenes = screenplay ? [...screenplay.scenes].sort((a, b) => a.number - b.number) : [];
  for (const s of scenes) {
    add({ id: nid("scene", s.id), type: "scene", label: `Scene ${s.number}: ${s.title}`, data: { number: s.number, objective: s.objective, timeOfDay: s.timeOfDay, durationSec: s.durationSec, locationId: s.locationId } });
  }

  // structural edges
  for (const s of scenes) {
    for (const cid of s.characterIds) link({ source: nid("character", cid), target: nid("scene", s.id), type: "appears_in" });
    for (const pid of s.propIds) link({ source: nid("scene", s.id), target: nid("prop", pid), type: "uses" });
    for (const eid of s.eventIds) link({ source: nid("event", eid), target: nid("scene", s.id), type: "occurs_in" });
    link({ source: nid("scene", s.id), target: nid("location", s.locationId), type: "set_in" });
    for (const cst of s.satisfiesConstraints) link({ source: nid("scene", s.id), target: nid("constraint", cst), type: "satisfies" });
  }
  for (const e of world.events) {
    for (const dep of e.dependsOn) link({ source: nid("event", dep), target: nid("event", e.id), type: "depends_on", label: "before" });
    for (const p of e.participants) link({ source: nid("character", p), target: nid("event", e.id), type: "appears_in" });
  }
  for (const r of world.relationships) link({ source: nid("character", r.from), target: nid("character", r.to), type: "relationship", label: r.type });

  // knowledge edges: who knows what, and since when
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  for (const f of world.knowledgeFacts) {
    const holderIds = new Set(f.holders.map((h) => h.characterId));
    for (const h of f.holders) {
      const sc = sceneById.get(h.acquiredInScene);
      link({ source: nid("character", h.characterId), target: nid("knowledge", f.id), type: "knows", label: sc ? `Scene ${sc.number}` : h.acquiredInScene === "start" ? "from start" : h.acquiredInScene, data: { via: h.via } });
      if (sc) link({ source: nid("knowledge", f.id), target: nid("scene", sc.id), type: "occurs_in", label: "revealed" });
    }
    for (const c of world.characters) if (!holderIds.has(c.id)) link({ source: nid("character", c.id), target: nid("knowledge", f.id), type: "unknown_to", label: "UNKNOWN" });
  }

  // constraint edges
  for (const v of world.visualConstraints) link({ source: nid("constraint", v.id), target: nid(v.entityType === "style" ? "constraint" : v.entityType, v.entityId), type: "constrains" });
  for (const c of world.continuityConstraints) {
    for (const e of c.entities) {
      const type = resolveType(world, e);
      if (type) link({ source: nid("constraint", c.id), target: nid(type, e), type: "constrains" });
    }
  }
  for (const s of world.sourceConstraints) {
    for (const e of s.relatedEntities) {
      const type = resolveType(world, e);
      if (type) link({ source: nid("constraint", s.id), target: nid(type, e), type: "constrains" });
    }
  }

  // violations
  for (const v of violations) {
    if (v.status === "resolved") continue;
    add({ id: nid("violation", v.id), type: "violation", label: v.code, data: { status: v.status, severity: v.severity, expected: v.expected, observed: v.observed, evidence: v.evidence } });
    if (v.scope.sceneId) link({ source: nid("violation", v.id), target: nid("scene", v.scope.sceneId), type: "violates" });
    if (v.constraintId) link({ source: nid("violation", v.id), target: nid("constraint", v.constraintId), type: "violates" });
    for (const e of v.scope.entityIds) {
      const type = resolveType(world, e);
      if (type) link({ source: nid("violation", v.id), target: nid(type, e), type: "violates" });
    }
  }

  const stats = { character: 0, scene: 0, event: 0, prop: 0, location: 0, knowledge: 0, constraint: 0, violation: 0 } as Record<GraphNodeType, number>;
  for (const n of nodes) stats[n.type] += 1;
  return { nodes, edges, stats };
}

function resolveType(world: WorldState, id: string): GraphNodeType | undefined {
  if (world.characters.some((c) => c.id === id)) return "character";
  if (world.props.some((p) => p.id === id)) return "prop";
  if (world.locations.some((l) => l.id === id)) return "location";
  if (world.events.some((e) => e.id === id)) return "event";
  if (world.knowledgeFacts.some((f) => f.id === id)) return "knowledge";
  return undefined;
}

/** Neighbourhood query for the inspector: everything within `depth` hops of a node. */
export function neighborhood(graph: CineGraph, nodeId: string, depth = 1): CineGraph {
  const keep = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const e of graph.edges) {
      if (frontier.includes(e.source) && !keep.has(e.target)) { keep.add(e.target); next.push(e.target); }
      if (frontier.includes(e.target) && !keep.has(e.source)) { keep.add(e.source); next.push(e.source); }
    }
    frontier = next;
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  const stats = { character: 0, scene: 0, event: 0, prop: 0, location: 0, knowledge: 0, constraint: 0, violation: 0 } as Record<GraphNodeType, number>;
  for (const n of nodes) stats[n.type] += 1;
  return { nodes, edges, stats };
}
