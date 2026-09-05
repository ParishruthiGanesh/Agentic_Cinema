import { z } from "zod";
import { Id, Severity } from "./common.js";

/* ------------------------------------------------------------------ */
/* Canonical world entities. These are what the World Memory persists. */
/* ------------------------------------------------------------------ */

export const Appearance = z.object({
  species: z.string().optional(),
  age: z.string().optional(),
  build: z.string().optional(),
  height: z.string().optional(),
  skin: z.string().optional(),
  hair: z.string().optional(),
  eyes: z.string().optional(),
  distinguishingFeatures: z.array(z.string()).default([]),
  /** Free-form summary used verbatim in visual prompts. */
  summary: z.string().optional(),
});
export type Appearance = z.infer<typeof Appearance>;

export const Clothing = z.object({
  items: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  summary: z.string().optional(),
});

export const VoiceProfile = z.object({
  description: z.string().optional(),
  pitch: z.string().optional(),
  pace: z.string().optional(),
  accent: z.string().optional(),
});

export const Character = z.object({
  id: Id,
  name: z.string(),
  role: z.enum(["protagonist", "antagonist", "supporting", "minor", "narrator"]).default("supporting"),
  description: z.string(),
  appearance: Appearance.default({ distinguishingFeatures: [] }),
  clothing: Clothing.default({ items: [], colors: [] }),
  voice: VoiceProfile.default({}),
  personality: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  fears: z.array(z.string()).default([]),
  relationships: z.array(Id).default([]),
  /** Mutable state (tracked over time by World Memory) */
  current_location: z.string().default(""),
  emotional_state: z.string().default(""),
  knowledge: z.array(Id).default([]),
  inventory: z.array(Id).default([]),
  continuity_constraints: z.array(Id).default([]),
  /** Ids of scenes the character appears in (derived) */
  scene_appearances: z.array(Id).default([]),
  sourceEvidence: z.string().optional(),
});
export type Character = z.infer<typeof Character>;

export const Location = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  visualSummary: z.string().optional(),
  timeOfDayDefault: z.string().optional(),
  keyFeatures: z.array(z.string()).default([]),
  connectedTo: z.array(Id).default([]),
  sourceEvidence: z.string().optional(),
});
export type Location = z.infer<typeof Location>;

export const Prop = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  visualSummary: z.string().optional(),
  significance: z.string().optional(),
  /** Character id who holds it at story start, if any */
  initialOwner: Id.optional(),
  sourceEvidence: z.string().optional(),
});
export type Prop = z.infer<typeof Prop>;

export const StoryEvent = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  order: z.number().int(),
  participants: z.array(Id).default([]),
  location: Id.optional(),
  /** Event ids that must have happened before this one. */
  dependsOn: z.array(Id).default([]),
  consequences: z.array(z.string()).default([]),
  importance: z.enum(["essential", "important", "optional"]).default("important"),
  sourceEvidence: z.string().optional(),
});
export type StoryEvent = z.infer<typeof StoryEvent>;

export const Relationship = z.object({
  id: Id,
  from: Id,
  to: Id,
  type: z.string(),
  description: z.string().optional(),
  sentiment: z.enum(["positive", "neutral", "negative", "complicated"]).default("neutral"),
});
export type Relationship = z.infer<typeof Relationship>;

/**
 * A piece of story knowledge with a timeline of who learns it and when.
 * `triggerPhrases` are deterministic detectors: if a character's dialogue contains one of these
 * phrases before that character holds the fact, the Narrative Critic flags a violation.
 */
export const KnowledgeHolder = z.object({
  characterId: Id,
  /** Scene id where the character acquires it; "start" if known from the beginning. */
  acquiredInScene: z.string(),
  via: z.string().optional(),
});
export type KnowledgeHolder = z.infer<typeof KnowledgeHolder>;

export const KnowledgeFact = z.object({
  id: Id,
  statement: z.string(),
  isSecret: z.boolean().default(false),
  triggerPhrases: z.array(z.string()).default([]),
  holders: z.array(KnowledgeHolder).default([]),
  /** Characters the source says will learn the fact later; the screenplay decides the scene. */
  expectedLearners: z.array(z.object({ characterId: Id, via: z.string().optional() })).default([]),
  sourceEvidence: z.string().optional(),
});
export type KnowledgeFact = z.infer<typeof KnowledgeFact>;

export const SourceConstraintKind = z.enum([
  "required_fact",
  "educational_fact",
  "required_event",
  "character_trait",
  "causal_dependency",
  "theme",
  "tone",
]);
export type SourceConstraintKind = z.infer<typeof SourceConstraintKind>;

export const SourceConstraint = z.object({
  id: Id,
  kind: SourceConstraintKind,
  statement: z.string(),
  importance: z.enum(["must_keep", "should_keep", "nice_to_have"]).default("should_keep"),
  /** Deterministic verification hooks: any of these phrases present in the screenplay satisfies the constraint. */
  keywords: z.array(z.string()).default([]),
  relatedEntities: z.array(Id).default([]),
  sourceEvidence: z.string().optional(),
});
export type SourceConstraint = z.infer<typeof SourceConstraint>;

export const VisualConstraint = z.object({
  id: Id,
  entityType: z.enum(["character", "location", "prop", "style"]),
  entityId: Id,
  attribute: z.string(),
  value: z.string(),
  severity: Severity.default("high"),
  /** Phrases, any of which must appear in a visual prompt for shots containing the entity. */
  promptKeywords: z.array(z.string()).default([]),
});
export type VisualConstraint = z.infer<typeof VisualConstraint>;

export const ContinuityConstraintKind = z.enum([
  "knowledge_order",
  "event_order",
  "prop_possession",
  "location_persistence",
  "character_presence",
  "time_of_day",
]);
export type ContinuityConstraintKind = z.infer<typeof ContinuityConstraintKind>;

export const ContinuityConstraint = z.object({
  id: Id,
  kind: ContinuityConstraintKind,
  statement: z.string(),
  entities: z.array(Id).default([]),
  severity: Severity.default("high"),
  /** Structured payload interpreted by the critic for that kind. */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type ContinuityConstraint = z.infer<typeof ContinuityConstraint>;

export const WorldState = z.object({
  projectId: Id,
  characters: z.array(Character).default([]),
  locations: z.array(Location).default([]),
  props: z.array(Prop).default([]),
  events: z.array(StoryEvent).default([]),
  relationships: z.array(Relationship).default([]),
  knowledgeFacts: z.array(KnowledgeFact).default([]),
  sourceConstraints: z.array(SourceConstraint).default([]),
  visualConstraints: z.array(VisualConstraint).default([]),
  continuityConstraints: z.array(ContinuityConstraint).default([]),
  themes: z.array(z.string()).default([]),
  timeline: z.array(z.string()).default([]),
  styleGuide: z.string().optional(),
  version: z.number().int().default(0),
  updatedAt: z.string(),
});
export type WorldState = z.infer<typeof WorldState>;

/** A single tracked change to an entity, recorded when scenes are folded into memory. */
export const StateChange = z.object({
  id: Id,
  projectId: Id,
  sceneId: Id,
  sceneNumber: z.number().int(),
  entityType: z.enum(["character", "prop", "location"]),
  entityId: Id,
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string(),
  createdAt: z.string(),
});
export type StateChange = z.infer<typeof StateChange>;

export const emptyWorld = (projectId: string): WorldState => ({
  projectId,
  characters: [],
  locations: [],
  props: [],
  events: [],
  relationships: [],
  knowledgeFacts: [],
  sourceConstraints: [],
  visualConstraints: [],
  continuityConstraints: [],
  themes: [],
  timeline: [],
  version: 0,
  updatedAt: new Date().toISOString(),
});
