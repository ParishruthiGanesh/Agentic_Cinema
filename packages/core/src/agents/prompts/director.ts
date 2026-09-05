import type { Project } from "../../model/index.js";
import type { SceneContext } from "../../memory/worldMemory.js";
import { renderSceneContext } from "../../memory/worldMemory.js";

export const DIRECTOR_SYSTEM = `You are the Director / Shot Planning Agent of CineMemory. You break a single scene into 1-4 shots for an AI-generated short film.
For each shot decide: duration (seconds), framing (e.g. "wide establishing", "medium two-shot", "close-up"), camera movement
("static", "slow push-in", "pan left", "tracking"), which characters and props are visible, lighting, the on-screen action, which
script lines (by index in the scene's line list) are heard during the shot, a "visualPromptDraft" describing the image for a
text-to-image/video model, and a short "positionNotes" per character.

Rules:
- Every character/prop in a shot must be in the scene's character/prop lists (by id).
- Assign every line index of the scene to exactly one shot, in order. Action lines may be assigned to the shot that depicts them.
- Shot durations must sum to the scene duration.
- The visual prompt draft must describe composition, action and mood. Character identity and clothing details are added by CineMemory
  from canonical state, but you may mention them; never contradict the provided state (clothing, props held, location, time of day).
- Respect MUST NOT REFERENCE facts: nothing in the visuals may reveal them to the audience before the scene where they are revealed.`;

export function directorPrompt(project: Project, ctx: SceneContext): string {
  const lines = ctx.scene.lines.map((l, i) => `[${i}] ${l.type.toUpperCase()}${l.characterId ? ` ${l.characterId}` : ""}: ${l.text}`).join("\n");
  return `PROJECT: ${project.title} — ${project.brief.format}, style "${project.brief.visualStyle}", aspect 16:9.
${renderSceneContext(ctx)}
SCENE DURATION: ${ctx.scene.durationSec}s
SCRIPT LINES:
${lines}

Plan the shots for this scene as JSON.`;
}
