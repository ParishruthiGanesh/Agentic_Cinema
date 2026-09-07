import type { AgentContext } from "../agents/context.js";
import { FixtureLLMProvider, type FixtureLookup } from "../llm/fixture.js";
import type { Project } from "../model/index.js";
import { createProject } from "../workflow/orchestrator.js";
import { ADAPTATION, SCREENPLAY, SHOT_PLANS, SOURCE_ANALYSIS } from "./fixtures.js";
import { LUMI_DEMO_INPUT } from "./story.js";
import { MAYA_CHILD_ID, MAYA_CHILD_PROFILE, MAYA_DEMO_INPUT, SOCIAL_STORY_DEMO_ID } from "./maya.js";
import { upsertChildProfile } from "../social/child.js";

export { LUMI_DEMO_INPUT, LUMI_STORY } from "./story.js";
export { MAYA_CHILD_ID, MAYA_CHILD_PROFILE, MAYA_DEMO_INPUT, MAYA_SOCIAL_STORY, SOCIAL_STORY_DEMO_ID } from "./maya.js";
export * as DEMO_FIXTURES from "./fixtures.js";

export const DEMO_PROJECT_ID = "lumi_demo";

function currentSceneFromPrompt(prompt: string): Record<string, unknown> | undefined {
  const start = prompt.indexOf("CURRENT SCENE JSON:");
  const end = prompt.indexOf("CURRENT LINES:");
  if (start < 0 || end < 0) return undefined;
  try {
    return JSON.parse(prompt.slice(start + "CURRENT SCENE JSON:".length, end).trim());
  } catch {
    return undefined;
  }
}

function lineCountFromPrompt(prompt: string): number {
  const idx = prompt.indexOf("SCRIPT LINES:");
  if (idx < 0) return 0;
  return (prompt.slice(idx).match(/^\[\d+\]/gm) ?? []).length;
}

/**
 * Fixture resolver for the demo project. Generation tasks replay authored outputs; repair tasks apply a
 * deterministic edit to the CURRENT scene carried in the prompt (so repeated repairs compose correctly).
 * Anything else is unknown → FixtureMissingError, so fixture mode can never silently "work" for other projects.
 */
export const DEMO_PROMPT_MARKER = "PROJECT: Lumi and the Broken Compass";

export function demoFixtureResolver(lookup: FixtureLookup): unknown | undefined {
  const { task, fixtureKey, prompt } = lookup;
  // Fixtures exist only for the bundled demo; any other project must fail loudly.
  if (!prompt.includes(DEMO_PROMPT_MARKER)) return undefined;
  if (task === "source_intelligence") return structuredClone(SOURCE_ANALYSIS);
  if (task === "adaptation") return structuredClone(ADAPTATION);
  if (task === "screenplay") return structuredClone(SCREENPLAY);
  if (task === "shot_planning") {
    const sceneId = fixtureKey.split(":")[1];
    const plan = SHOT_PLANS[sceneId];
    if (!plan) return undefined;
    const copy = structuredClone(plan);
    // Assign any script lines added by a repair to the last shot so every line is still heard.
    const count = lineCountFromPrompt(prompt);
    const assigned = new Set(copy.shots.flatMap((s) => s.lineIndexes));
    for (let i = 0; i < count; i++) if (!assigned.has(i)) copy.shots[copy.shots.length - 1].lineIndexes.push(i);
    for (const s of copy.shots) s.lineIndexes = s.lineIndexes.filter((i) => i < count);
    return copy;
  }
  if (task === "scene_rewrite") {
    const [, code] = fixtureKey.split(":");
    const scene = currentSceneFromPrompt(prompt);
    if (!scene) return undefined;
    const lines = scene.lines as Array<{ type: string; characterId?: string; text: string; emotion?: string }>;
    if (code === "KNOWLEDGE_TIMELINE_VIOLATION") {
      const m = /line (\d+):/.exec(prompt);
      const li = m ? Number(m[1]) : -1;
      if (li < 0 || !lines[li]) return undefined;
      lines[li] = { ...lines[li], text: "Lumi! You came! I can barely see anything in here... is that your glow?", emotion: "overjoyed" };
      return scene;
    }
    if (code === "REQUIRED_FACT_MISSING") {
      const m = /include "([\w-]+)" in satisfiesConstraints/.exec(prompt);
      lines.push({ type: "narration", text: "Did you know? Fireflies make their own light inside their bodies. That special glow is called bioluminescence." });
      const sat = new Set([...(scene.satisfiesConstraints as string[]), ...(m ? [m[1]] : [])]);
      scene.satisfiesConstraints = [...sat];
      return scene;
    }
    return undefined;
  }
  return undefined;
}

export function createDemoFixtureProvider(): FixtureLLMProvider {
  return new FixtureLLMProvider(demoFixtureResolver);
}

/** Create (or return) the bundled demo project. */
export function ensureDemoProject(ctx: AgentContext): Project {
  const existing = ctx.repo.getProject(DEMO_PROJECT_ID);
  if (existing) return existing;
  return createProject(ctx, LUMI_DEMO_INPUT, { id: DEMO_PROJECT_ID, isDemo: true });
}

/** Create (or return) the bundled social-story demo ("Maya goes to the dentist"). */
export function ensureSocialStoryDemo(ctx: AgentContext): Project {
  if (!ctx.repo.getChild(MAYA_CHILD_ID)) upsertChildProfile(ctx, MAYA_CHILD_PROFILE);
  const existing = ctx.repo.getProject(SOCIAL_STORY_DEMO_ID);
  if (existing) return existing;
  return createProject(ctx, { ...MAYA_DEMO_INPUT, childId: MAYA_CHILD_ID }, { id: SOCIAL_STORY_DEMO_ID, isDemo: true });
}
