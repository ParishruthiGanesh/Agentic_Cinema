import { z } from "zod";
import type { AgentContext } from "./context.js";
import { SOURCE_INTELLIGENCE_SYSTEM, sourceIntelligencePrompt } from "./prompts/sourceIntelligence.js";
import {
  ContinuityConstraintKind,
  SourceConstraintKind,
  type Character,
  type ContinuityConstraint,
  type Project,
  type WorldState,
  slugify,
} from "../model/index.js";

/* ---------- LLM output schema (what Gemini produces) ---------- */

const OutChar = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["protagonist", "antagonist", "supporting", "minor", "narrator"]),
  description: z.string(),
  appearance: z.object({
    species: z.string().optional(),
    age: z.string().optional(),
    build: z.string().optional(),
    distinguishingFeatures: z.array(z.string()),
    summary: z.string(),
  }),
  clothing: z.object({ items: z.array(z.string()), colors: z.array(z.string()), summary: z.string() }),
  voice: z.object({ description: z.string().optional(), pitch: z.string().optional(), pace: z.string().optional() }),
  personality: z.array(z.string()),
  goals: z.array(z.string()),
  fears: z.array(z.string()),
  initialLocationId: z.string().optional(),
  initialEmotionalState: z.string().optional(),
  sourceEvidence: z.string(),
});

export const SourceAnalysisOutput = z.object({
  characters: z.array(OutChar),
  locations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      visualSummary: z.string(),
      timeOfDayDefault: z.string().optional(),
      keyFeatures: z.array(z.string()),
      connectedTo: z.array(z.string()),
      sourceEvidence: z.string(),
    }),
  ),
  props: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      visualSummary: z.string(),
      significance: z.string(),
      initialOwner: z.string().optional(),
      sourceEvidence: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      order: z.number().int(),
      participants: z.array(z.string()),
      location: z.string().optional(),
      dependsOn: z.array(z.string()),
      consequences: z.array(z.string()),
      importance: z.enum(["essential", "important", "optional"]),
      sourceEvidence: z.string(),
    }),
  ),
  relationships: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      description: z.string(),
      sentiment: z.enum(["positive", "neutral", "negative", "complicated"]),
    }),
  ),
  knowledgeFacts: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      isSecret: z.boolean(),
      triggerPhrases: z.array(z.string()),
      /** Characters who know it from the start of the story. */
      initialHolders: z.array(z.string()),
      /** Characters who learn it during the story, in the order they learn it (the screenplay decides the scene). */
      laterLearners: z.array(z.object({ characterId: z.string(), via: z.string() })),
      sourceEvidence: z.string(),
    }),
  ),
  sourceConstraints: z.array(
    z.object({
      id: z.string(),
      kind: SourceConstraintKind,
      statement: z.string(),
      importance: z.enum(["must_keep", "should_keep", "nice_to_have"]),
      keywords: z.array(z.string()),
      relatedEntities: z.array(z.string()),
      sourceEvidence: z.string(),
    }),
  ),
  visualConstraints: z.array(
    z.object({
      entityType: z.enum(["character", "location", "prop", "style"]),
      entityId: z.string(),
      attribute: z.string(),
      value: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      promptKeywords: z.array(z.string()),
    }),
  ),
  continuityConstraints: z.array(
    z.object({
      kind: ContinuityConstraintKind,
      statement: z.string(),
      entities: z.array(z.string()),
      severity: z.enum(["low", "medium", "high", "critical"]),
    }),
  ),
  themes: z.array(z.string()),
  timeline: z.array(z.string()),
  styleGuide: z.string(),
});
export type SourceAnalysisOutput = z.infer<typeof SourceAnalysisOutput>;

/* ---------- deterministic normalisation into the canonical world ---------- */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "we", "should", "not", "it", "that", "this", "for", "with", "be", "by", "as", "at", "from"]);

/** Derive verification keywords for a required fact when the model gave none. */
export function keywordsFromFact(fact: string): string[] {
  const words = fact
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  const uniq = [...new Set(words)];
  return uniq.slice(0, 4);
}

export interface NormalizationReport {
  droppedReferences: string[];
  addedConstraints: string[];
}

export function normalizeSourceAnalysis(project: Project, out: SourceAnalysisOutput): { world: WorldState; report: NormalizationReport } {
  const report: NormalizationReport = { droppedReferences: [], addedConstraints: [] };
  const idMap = new Map<string, string>();
  const canon = (raw: string) => {
    const s = slugify(raw);
    idMap.set(raw, s);
    return s;
  };
  const ref = (raw: string | undefined, kind: string): string | undefined => {
    if (!raw) return undefined;
    const s = idMap.get(raw) ?? slugify(raw);
    if (!known.has(s)) {
      report.droppedReferences.push(`${kind}: ${raw}`);
      return undefined;
    }
    return s;
  };

  const known = new Set<string>();
  for (const c of out.characters) known.add(canon(c.id));
  for (const l of out.locations) known.add(canon(l.id));
  for (const p of out.props) known.add(canon(p.id));
  for (const e of out.events) known.add(canon(e.id));
  for (const f of out.knowledgeFacts) known.add(canon(f.id));

  const refs = (raws: string[], kind: string) => raws.map((r) => ref(r, kind)).filter((x): x is string => !!x);

  const characters: Character[] = out.characters.map((c) => ({
    id: slugify(c.id),
    name: c.name,
    role: c.role,
    description: c.description,
    appearance: { ...c.appearance, distinguishingFeatures: c.appearance.distinguishingFeatures },
    clothing: c.clothing,
    voice: c.voice,
    personality: c.personality,
    goals: c.goals,
    fears: c.fears,
    relationships: [],
    current_location: ref(c.initialLocationId, `character ${c.id}.initialLocationId`) ?? "",
    emotional_state: c.initialEmotionalState ?? "",
    knowledge: [],
    inventory: [],
    continuity_constraints: [],
    scene_appearances: [],
    sourceEvidence: c.sourceEvidence,
  }));

  const locations = out.locations.map((l) => ({ ...l, id: slugify(l.id), connectedTo: refs(l.connectedTo, `location ${l.id}.connectedTo`) }));
  const props = out.props.map((p) => ({ ...p, id: slugify(p.id), initialOwner: ref(p.initialOwner, `prop ${p.id}.initialOwner`) }));
  const events = out.events
    .map((e) => ({
      ...e,
      id: slugify(e.id),
      participants: refs(e.participants, `event ${e.id}.participants`),
      location: ref(e.location, `event ${e.id}.location`),
      dependsOn: refs(e.dependsOn, `event ${e.id}.dependsOn`),
    }))
    .sort((a, b) => a.order - b.order);

  const relationships = out.relationships
    .map((r, i) => ({ id: `rel_${i + 1}_${slugify(r.from)}_${slugify(r.to)}`, from: ref(r.from, "relationship.from"), to: ref(r.to, "relationship.to"), type: r.type, description: r.description, sentiment: r.sentiment }))
    .filter((r): r is typeof r & { from: string; to: string } => !!r.from && !!r.to);
  for (const r of relationships) {
    const c = characters.find((x) => x.id === r.from);
    if (c && !c.relationships.includes(r.to)) c.relationships.push(r.to);
  }

  const knowledgeFacts = out.knowledgeFacts.map((f) => ({
    id: slugify(f.id),
    statement: f.statement,
    isSecret: f.isSecret,
    triggerPhrases: f.triggerPhrases,
    holders: refs(f.initialHolders, `fact ${f.id}.initialHolders`).map((cid) => ({ characterId: cid, acquiredInScene: "start", via: "known from the start" })),
    sourceEvidence: f.sourceEvidence,
    expectedLearners: f.laterLearners
      .map((l) => ({ characterId: ref(l.characterId, `fact ${f.id}.laterLearners`) as string, via: l.via }))
      .filter((l) => !!l.characterId),
  }));
  for (const f of knowledgeFacts) {
    for (const h of f.holders) {
      const c = characters.find((x) => x.id === h.characterId);
      if (c && !c.knowledge.includes(f.id)) c.knowledge.push(f.id);
    }
  }

  const sourceConstraints = out.sourceConstraints.map((s) => ({
    ...s,
    id: slugify(s.id),
    keywords: s.keywords.length ? s.keywords : keywordsFromFact(s.statement),
    relatedEntities: refs(s.relatedEntities, `constraint ${s.id}.relatedEntities`),
  }));
  // Educational mode: every required fact from the brief must exist as a must_keep educational constraint.
  project.brief.requiredFacts.forEach((fact, i) => {
    const kw = keywordsFromFact(fact);
    const exists = sourceConstraints.some(
      (s) => s.kind === "educational_fact" && (s.statement.toLowerCase() === fact.toLowerCase() || kw.filter((k) => s.statement.toLowerCase().includes(k)).length >= Math.min(2, kw.length)),
    );
    if (!exists) {
      const id = `edu_fact_${i + 1}`;
      sourceConstraints.push({ id, kind: "educational_fact", statement: fact, importance: "must_keep", keywords: kw, relatedEntities: [], sourceEvidence: "production brief: required fact" });
      report.addedConstraints.push(id);
    } else {
      const s = sourceConstraints.find((x) => x.kind === "educational_fact" && x.statement.toLowerCase() === fact.toLowerCase());
      if (s) s.importance = "must_keep";
    }
  });

  const visualConstraints = out.visualConstraints
    .map((v, i) => ({
      id: `vc_${i + 1}_${slugify(v.entityId)}_${slugify(v.attribute)}`,
      entityType: v.entityType,
      entityId: v.entityType === "style" ? "style" : (ref(v.entityId, `visualConstraint.entityId`) ?? ""),
      attribute: v.attribute,
      value: v.value,
      severity: v.severity,
      promptKeywords: v.promptKeywords.length ? v.promptKeywords : [v.value],
    }))
    .filter((v) => v.entityId !== "");

  const continuityConstraints: ContinuityConstraint[] = out.continuityConstraints.map((c, i) => ({
    id: `cc_${i + 1}_${c.kind}`,
    kind: c.kind,
    statement: c.statement,
    entities: refs(c.entities, `continuityConstraint.entities`),
    severity: c.severity,
    params: {},
  }));
  // Every secret fact gets a deterministic knowledge_order constraint the Narrative Critic enforces.
  for (const f of knowledgeFacts) {
    if (!f.isSecret && f.expectedLearners.length === 0) continue;
    const id = `cc_knowledge_${f.id}`;
    if (continuityConstraints.some((c) => c.id === id)) continue;
    continuityConstraints.push({
      id,
      kind: "knowledge_order",
      statement: `No character may reference "${f.statement}" before learning it.`,
      entities: [f.id, ...f.expectedLearners.map((l) => l.characterId)],
      severity: "high",
      params: { factId: f.id },
    });
    report.addedConstraints.push(id);
  }
  for (const c of characters) {
    c.continuity_constraints = continuityConstraints.filter((cc) => cc.entities.includes(c.id)).map((cc) => cc.id);
  }

  const world: WorldState = {
    projectId: project.id,
    characters,
    locations,
    props,
    events,
    relationships,
    knowledgeFacts,
    sourceConstraints,
    visualConstraints,
    continuityConstraints,
    themes: out.themes,
    timeline: out.timeline,
    styleGuide: out.styleGuide || project.brief.visualStyle,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  return { world, report };
}

/* ---------- agent ---------- */

export async function runSourceIntelligence(ctx: AgentContext, project: Project): Promise<WorldState> {
  const { events, llm, repo } = ctx;
  events.emit(project.id, "source_intelligence", "source.analysis.started", `Analyzing source "${project.source.title}" (${project.source.text.length} chars)`, { provider: llm.name, model: llm.model });
  const result = await llm.generateStructured({
    task: "source_intelligence",
    system: SOURCE_INTELLIGENCE_SYSTEM,
    prompt: sourceIntelligencePrompt(project),
    schema: SourceAnalysisOutput,
    temperature: 0.2,
  });
  const { world, report } = normalizeSourceAnalysis(project, result.data);
  repo.saveWorld(world);
  // Keep the raw model output next to the world for provenance/inspection.
  repo.store.put("source_analysis_raw", project.id, "current", { output: result.data, provenance: result.provenance, report });
  const constraintCount = world.sourceConstraints.length + world.visualConstraints.length + world.continuityConstraints.length;
  events.emit(project.id, "source_intelligence", "source.analysis.completed", `Source analyzed: ${world.characters.length} characters, ${world.locations.length} locations, ${world.props.length} props, ${world.events.length} events, ${world.knowledgeFacts.length} knowledge facts`, { provenance: result.provenance }, "success");
  events.emit(project.id, "world_memory", "memory.constraints.extracted", `${constraintCount} constraints extracted (${world.sourceConstraints.length} source, ${world.visualConstraints.length} visual, ${world.continuityConstraints.length} continuity)`, { added: report.addedConstraints });
  if (report.droppedReferences.length) {
    events.emit(project.id, "source_intelligence", "source.analysis.dangling_refs", `Dropped ${report.droppedReferences.length} dangling references from model output`, { dropped: report.droppedReferences }, "warn");
  }
  return world;
}
