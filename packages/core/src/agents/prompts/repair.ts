import type { Project, Violation } from "../../model/index.js";
import type { SceneContext } from "../../memory/worldMemory.js";
import { renderSceneContext } from "../../memory/worldMemory.js";

export const SCENE_REWRITE_SYSTEM = `You are the Repair Agent of CineMemory. A critic found a continuity or fidelity violation in ONE scene of a screenplay.
Rewrite ONLY that scene so the violation is fixed while preserving everything else: the scene's objective, its place in the story,
its characters, location, duration, events, and all declared state changes that are still correct.

Rules:
- Return the complete rewritten scene as JSON with the same id and number.
- Reference only ids that exist in the canonical world (characters, locations, props, events, facts).
- A character must never reference a knowledge fact they do not yet know (see MUST NOT REFERENCE). If a line currently does, rewrite that line
  so the character expresses curiosity, confusion or an unrelated thought instead — do NOT move the reveal earlier.
- If a required fact must be added, add it naturally in dialogue or narration in the audience's language level, and add its constraint id to satisfiesConstraints.
- Keep the same number of lines or fewer; do not add new characters.`;

export function sceneRewritePrompt(project: Project, ctx: SceneContext, violation: Violation, extra?: string): string {
  const lines = ctx.scene.lines.map((l, i) => `[${i}] ${l.type.toUpperCase()}${l.characterId ? ` ${l.characterId}` : ""}: ${l.text}`).join("\n");
  return `PROJECT: ${project.title} (${project.brief.format}, audience ${project.brief.audience}, language ${project.brief.language})
${renderSceneContext(ctx)}

VIOLATION TO FIX: ${violation.code}
Constraint: ${violation.constraint}
Expected: ${violation.expected}
Observed: ${violation.observed}
Evidence: ${violation.evidence}
${extra ? `\nADDITIONAL INSTRUCTION: ${extra}\n` : ""}
CURRENT SCENE JSON:
${JSON.stringify(ctx.scene, null, 1)}

CURRENT LINES:
${lines}

Return the corrected scene as JSON.`;
}
