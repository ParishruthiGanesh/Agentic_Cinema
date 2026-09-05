import type { Project, WorldState } from "../../model/index.js";

export const ADAPTATION_SYSTEM = `You are the Adaptation Agent of CineMemory. You transform a canonical story world into a production plan for a short film
of a specific duration, audience, genre and language, WITHOUT breaking source constraints or causal dependencies.

Decide explicitly:
- mustKeep: entities that must remain (characters, events, props, locations, facts, themes) and why (cite constraint ids).
- removed: what is cut for duration, with reasons.
- compressed: what is shortened and how.
- merged: characters/events merged together (only when no source constraint forbids it).
- unbreakableChains: ordered event ids whose causal order cannot change.
- beatSheet: ordered beats with the events, characters and location for each and an approximate duration in seconds. Beat durations MUST sum
  to roughly the target duration (within 10%). For a 60-120 second film use 5-8 beats.
Respect the audience: for young children use simple language, gentle stakes and clear cause-and-effect.
Every id you reference MUST exist in the provided world. Use only those ids.`;

export function compactWorld(world: WorldState): string {
  const lines: string[] = [];
  lines.push("CHARACTERS:");
  for (const c of world.characters) lines.push(`- ${c.id}: ${c.name} (${c.role}) — ${c.description}. Look: ${c.appearance.summary ?? ""}. Wears: ${c.clothing.summary ?? ""}. Personality: ${c.personality.join(", ")}`);
  lines.push("LOCATIONS:");
  for (const l of world.locations) lines.push(`- ${l.id}: ${l.name} — ${l.description}`);
  lines.push("PROPS:");
  for (const p of world.props) lines.push(`- ${p.id}: ${p.name} — ${p.description}${p.initialOwner ? ` (held by ${p.initialOwner})` : ""}. ${p.significance ?? ""}`);
  lines.push("EVENTS (chronological):");
  for (const e of world.events) lines.push(`- ${e.id} [${e.order}] (${e.importance}): ${e.name} — ${e.description}${e.dependsOn.length ? ` (depends on ${e.dependsOn.join(", ")})` : ""}`);
  lines.push("KNOWLEDGE FACTS:");
  for (const f of world.knowledgeFacts) {
    lines.push(`- ${f.id}${f.isSecret ? " [SECRET]" : ""}: ${f.statement}. Known from start by: ${f.holders.map((h) => h.characterId).join(", ") || "nobody"}. Learned later by: ${f.expectedLearners.map((l) => `${l.characterId}${l.via ? ` (${l.via})` : ""}`).join(", ") || "nobody"}`);
  }
  lines.push("SOURCE CONSTRAINTS:");
  for (const s of world.sourceConstraints) lines.push(`- ${s.id} (${s.kind}, ${s.importance}): ${s.statement}`);
  lines.push("CONTINUITY CONSTRAINTS:");
  for (const c of world.continuityConstraints) lines.push(`- ${c.id} (${c.kind}): ${c.statement}`);
  lines.push(`THEMES: ${world.themes.join("; ")}`);
  return lines.join("\n");
}

export function adaptationPrompt(project: Project, world: WorldState): string {
  const b = project.brief;
  return `PROJECT: ${project.title}
BRIEF: ${b.format}; genre ${b.genre}; audience ${b.audience}${b.ageRange ? ` (ages ${b.ageRange})` : ""}; language ${b.language}; target duration ${b.targetDurationSec} seconds; visual style "${b.visualStyle}"${b.tone ? `; tone ${b.tone}` : ""}.
${b.adaptationInstructions ? `ADAPTATION INSTRUCTIONS: ${b.adaptationInstructions}\n` : ""}
CANONICAL WORLD:
${compactWorld(world)}

Produce the adaptation plan as JSON.`;
}
