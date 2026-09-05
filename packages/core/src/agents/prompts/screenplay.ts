import type { AdaptationPlan, Project, WorldState } from "../../model/index.js";
import { compactWorld } from "./adaptation.js";

export const SCREENPLAY_SYSTEM = `You are the Screenplay Agent of CineMemory. You write the screenplay for a short film from an adaptation plan and a canonical
story world. Every scene must reference the canonical world by id, and you must DECLARE all state changes so the World Memory can
track them:

- "knowledgeReveals": every time a character LEARNS a knowledge fact in a scene (discovery, being told, seeing it), list {factId, toCharacterId, via}.
- "propTransfers": every time a prop changes hands or is picked up/dropped.
- "exitLocations": where a character goes at the end of the scene if it differs from the scene location.
- "endEmotions": emotional state of each present character at the end of the scene.
- "eventIds": which canonical events happen in the scene.
- "satisfiesConstraints": ids of source constraints this scene honors (e.g. an educational fact stated in dialogue).

HARD RULES:
- A character must NEVER speak about a knowledge fact before they learn it (either from the start, or via a knowledgeReveal in an earlier scene or this scene).
- Characters, locations, props, events and facts must be referenced ONLY by ids that exist in the world.
- Scene ids are "scene_1", "scene_2", ... in order; numbers start at 1; acts start at 1.
- Lines: type "dialogue" requires characterId; "narration" and "action" have no characterId. Dialogue is short and natural for the audience.
- Keep required facts (must_keep constraints) explicitly present in dialogue or narration, in child-friendly words when the audience is young.
- Durations: each scene has "durationSec"; the sum must be close to the target duration.
- Write in the requested language.`;

/**
 * Baseline prompt used by the evaluation harness: what a system WITHOUT CineMemory would send —
 * the raw source text and the beat sheet, but no canonical state, knowledge timeline or constraints.
 */
export function baselineScreenplayPrompt(project: Project, world: WorldState, plan: AdaptationPlan): string {
  const b = project.brief;
  return `PROJECT: ${project.title}
LOGLINE: ${plan.logline}
TARGET: ${b.targetDurationSec}s total, ${b.format}, audience ${b.audience}${b.ageRange ? ` (ages ${b.ageRange})` : ""}, language ${b.language}.
BEAT SHEET:
${plan.beatSheet.map((bt, i) => `${i + 1}. ${bt.beat} (~${bt.approxDurationSec ?? "?"}s)`).join("\n")}
CHARACTER IDS: ${world.characters.map((c) => `${c.id} (${c.name})`).join(", ")}
LOCATION IDS: ${world.locations.map((l) => `${l.id} (${l.name})`).join(", ")}
PROP IDS: ${world.props.map((p) => `${p.id} (${p.name})`).join(", ")}
EVENT IDS: ${world.events.map((e) => e.id).join(", ")}
FACT IDS: ${world.knowledgeFacts.map((f) => f.id).join(", ")}

SOURCE TEXT:
"""
${project.source.text}
"""

Write the screenplay as JSON.`;
}

export function screenplayPrompt(project: Project, world: WorldState, plan: AdaptationPlan): string {
  const b = project.brief;
  return `PROJECT: ${project.title}
LOGLINE: ${plan.logline}
SYNOPSIS: ${plan.synopsis}
TARGET: ${b.targetDurationSec}s total, ${b.format}, audience ${b.audience}${b.ageRange ? ` (ages ${b.ageRange})` : ""}, language ${b.language}, tone ${b.tone ?? plan.toneNotes ?? "warm"}.
BEAT SHEET (follow in order):
${plan.beatSheet.map((bt, i) => `${i + 1}. ${bt.beat} [events: ${bt.eventIds.join(", ") || "-"}; characters: ${bt.characterIds.join(", ") || "-"}; location: ${bt.locationId ?? "-"}; ~${bt.approxDurationSec ?? "?"}s]`).join("\n")}
MUST KEEP: ${plan.mustKeep.map((m) => `${m.entityId} (${m.reason})`).join("; ")}
UNBREAKABLE CHAINS: ${plan.unbreakableChains.map((c) => c.events.join(" -> ")).join(" | ") || "none"}

CANONICAL WORLD:
${compactWorld(world)}

Write the screenplay as JSON.`;
}
