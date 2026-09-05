import { z } from "zod";
import type { AgentContext } from "./context.js";
import { SCREENPLAY_SYSTEM, baselineScreenplayPrompt, screenplayPrompt } from "./prompts/screenplay.js";
import { Scene, Screenplay, type AdaptationPlan, type Project, type WorldState } from "../model/index.js";

/** Scene as the model writes it; deterministic code assigns canonical ids/numbers. */
export const SceneOutput = Scene.omit({ id: true }).extend({ id: z.string().optional() });

export const ScreenplayOutput = z.object({
  title: z.string(),
  logline: z.string(),
  acts: z.array(z.object({ number: z.number().int(), title: z.string(), purpose: z.string() })),
  scenes: z.array(SceneOutput),
});
export type ScreenplayOutput = z.infer<typeof ScreenplayOutput>;

/**
 * Build a schema that rejects references to ids not in the world. The Gemini provider feeds the
 * validation messages back to the model, so dangling references become a self-correcting loop.
 */
export function screenplaySchemaFor(world: WorldState) {
  const chars = new Set(world.characters.map((c) => c.id));
  const locs = new Set(world.locations.map((l) => l.id));
  const props = new Set(world.props.map((p) => p.id));
  const events = new Set(world.events.map((e) => e.id));
  const facts = new Set(world.knowledgeFacts.map((f) => f.id));
  return ScreenplayOutput.superRefine((sp, ctx) => {
    sp.scenes.forEach((s, si) => {
      const path = (k: string) => ["scenes", si, k];
      s.characterIds.forEach((c) => !chars.has(c) && ctx.addIssue({ code: "custom", path: path("characterIds"), message: `unknown character id "${c}"` }));
      if (!locs.has(s.locationId)) ctx.addIssue({ code: "custom", path: path("locationId"), message: `unknown location id "${s.locationId}"` });
      s.propIds.forEach((p) => !props.has(p) && ctx.addIssue({ code: "custom", path: path("propIds"), message: `unknown prop id "${p}"` }));
      s.eventIds.forEach((e) => !events.has(e) && ctx.addIssue({ code: "custom", path: path("eventIds"), message: `unknown event id "${e}"` }));
      s.lines.forEach((l, li) => {
        if (l.type === "dialogue" && (!l.characterId || !chars.has(l.characterId))) ctx.addIssue({ code: "custom", path: ["scenes", si, "lines", li], message: `dialogue line needs a valid characterId (got "${l.characterId}")` });
        if (l.type === "dialogue" && l.characterId && !s.characterIds.includes(l.characterId)) ctx.addIssue({ code: "custom", path: ["scenes", si, "lines", li], message: `"${l.characterId}" speaks but is not in characterIds` });
      });
      s.knowledgeReveals.forEach((r) => {
        if (!facts.has(r.factId)) ctx.addIssue({ code: "custom", path: path("knowledgeReveals"), message: `unknown fact id "${r.factId}"` });
        if (!chars.has(r.toCharacterId)) ctx.addIssue({ code: "custom", path: path("knowledgeReveals"), message: `unknown character id "${r.toCharacterId}"` });
      });
      s.propTransfers.forEach((t) => !props.has(t.propId) && ctx.addIssue({ code: "custom", path: path("propTransfers"), message: `unknown prop id "${t.propId}"` }));
    });
  });
}

export function normalizeScreenplay(project: Project, out: ScreenplayOutput): Screenplay {
  const ordered = [...out.scenes].sort((a, b) => a.number - b.number);
  const target = project.brief.targetDurationSec;
  const total = ordered.reduce((s, sc) => s + sc.durationSec, 0);
  const scale = total > 0 && Math.abs(total - target) / target > 0.15 ? target / total : 1;
  const scenes = ordered.map((s, i) =>
    Scene.parse({
      ...s,
      id: `scene_${i + 1}`,
      number: i + 1,
      durationSec: Math.max(3, Math.round(s.durationSec * scale)),
      characterIds: [...new Set(s.characterIds)],
      propIds: [...new Set(s.propIds)],
    }),
  );
  return Screenplay.parse({
    projectId: project.id,
    title: out.title,
    logline: out.logline,
    acts: out.acts.length ? out.acts : [{ number: 1, title: "Act 1", purpose: "" }],
    scenes,
    totalDurationSec: scenes.reduce((s, sc) => s + sc.durationSec, 0),
    version: 1,
    provenance: { provider: "pending", task: "screenplay", createdAt: new Date().toISOString() },
    revisions: [],
  });
}

export async function runScreenplay(ctx: AgentContext, project: Project, world: WorldState, plan: AdaptationPlan, opts: { baseline?: boolean } = {}): Promise<Screenplay> {
  const { events, llm, repo } = ctx;
  events.emit(project.id, "screenplay", "screenplay.started", `Writing screenplay from ${plan.beatSheet.length} beats${opts.baseline ? " (baseline: no memory context)" : ""}`, { provider: llm.name, baseline: !!opts.baseline });
  const result = await llm.generateStructured({
    task: "screenplay",
    fixtureKey: opts.baseline ? "screenplay:baseline" : "screenplay",
    system: SCREENPLAY_SYSTEM,
    prompt: opts.baseline ? baselineScreenplayPrompt(project, world, plan) : screenplayPrompt(project, world, plan),
    schema: screenplaySchemaFor(world),
    temperature: 0.6,
  });
  const screenplay = { ...normalizeScreenplay(project, result.data), provenance: result.provenance };
  repo.saveScreenplay(screenplay);
  const lines = screenplay.scenes.reduce((s, sc) => s + sc.lines.length, 0);
  events.emit(project.id, "screenplay", "screenplay.completed", `Screenplay written: ${screenplay.scenes.length} scenes, ${lines} lines, ${screenplay.totalDurationSec}s`, { provenance: result.provenance }, "success");
  return screenplay;
}
