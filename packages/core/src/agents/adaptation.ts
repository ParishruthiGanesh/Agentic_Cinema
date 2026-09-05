import { z } from "zod";
import type { AgentContext } from "./context.js";
import { ADAPTATION_SYSTEM, adaptationPrompt } from "./prompts/adaptation.js";
import { AdaptationPlan, type Project, type WorldState } from "../model/index.js";

export const AdaptationOutput = AdaptationPlan.omit({ projectId: true, provenance: true, targetDurationSec: true });
export type AdaptationOutput = z.infer<typeof AdaptationOutput>;

/**
 * Deterministic safeguards: anything a must_keep source constraint relates to is forced into mustKeep,
 * and beat durations are scaled to the target so the screenplay agent gets a realistic budget.
 */
export function normalizeAdaptation(project: Project, world: WorldState, out: AdaptationOutput): { plan: AdaptationPlan; forced: string[] } {
  const forced: string[] = [];
  const mustKeep = [...out.mustKeep];
  const has = (id: string) => mustKeep.some((m) => m.entityId === id);
  const typeOf = (id: string): AdaptationPlan["mustKeep"][number]["entityType"] | undefined => {
    if (world.characters.some((c) => c.id === id)) return "character";
    if (world.events.some((e) => e.id === id)) return "event";
    if (world.props.some((p) => p.id === id)) return "prop";
    if (world.locations.some((l) => l.id === id)) return "location";
    if (world.knowledgeFacts.some((f) => f.id === id)) return "fact";
    return undefined;
  };
  for (const sc of world.sourceConstraints) {
    if (sc.importance !== "must_keep") continue;
    for (const e of sc.relatedEntities) {
      const t = typeOf(e);
      if (t && !has(e)) {
        mustKeep.push({ entityId: e, entityType: t, reason: `required by source constraint ${sc.id}: ${sc.statement}` });
        forced.push(e);
      }
    }
  }
  for (const ev of world.events) {
    if (ev.importance === "essential" && !has(ev.id)) {
      mustKeep.push({ entityId: ev.id, entityType: "event", reason: "essential event in source" });
      forced.push(ev.id);
    }
  }
  const removed = out.removed.filter((r) => !has(r.entityId));

  const target = project.brief.targetDurationSec;
  const total = out.beatSheet.reduce((s, b) => s + (b.approxDurationSec ?? 0), 0);
  const beatSheet = out.beatSheet.map((b) => ({
    ...b,
    approxDurationSec: total > 0 ? Math.max(4, Math.round(((b.approxDurationSec ?? target / out.beatSheet.length) * target) / total)) : Math.round(target / Math.max(1, out.beatSheet.length)),
  }));

  return {
    plan: AdaptationPlan.parse({
      ...out,
      projectId: project.id,
      targetDurationSec: target,
      mustKeep,
      removed,
      beatSheet,
      provenance: { provider: "pending", task: "adaptation", createdAt: new Date().toISOString() },
    }),
    forced,
  };
}

export async function runAdaptation(ctx: AgentContext, project: Project, world: WorldState): Promise<AdaptationPlan> {
  const { events, llm, repo } = ctx;
  events.emit(project.id, "adaptation", "adaptation.started", `Adapting for ${project.brief.audience}, ${project.brief.targetDurationSec}s ${project.brief.genre}`, { provider: llm.name });
  const result = await llm.generateStructured({
    task: "adaptation",
    system: ADAPTATION_SYSTEM,
    prompt: adaptationPrompt(project, world),
    schema: AdaptationOutput,
    temperature: 0.4,
  });
  const { plan: base, forced } = normalizeAdaptation(project, world, result.data);
  const plan = { ...base, provenance: result.provenance };
  repo.saveAdaptation(plan);
  events.emit(project.id, "adaptation", "adaptation.completed", `Adaptation plan: ${plan.beatSheet.length} beats, keep ${plan.mustKeep.length}, remove ${plan.removed.length}, merge ${plan.merged.length}`, { provenance: result.provenance, forcedMustKeep: forced }, "success");
  if (forced.length) events.emit(project.id, "world_memory", "adaptation.constraints.enforced", `Forced ${forced.length} entities into mustKeep because of must_keep source constraints`, { forced }, "warn");
  return plan;
}
