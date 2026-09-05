import { z } from "zod";
import { CriticCollector, DETERMINISTIC, type CriticResult } from "./common.js";
import type { LLMProvider } from "../llm/provider.js";
import type { AdaptationPlan, Screenplay, SourceConstraint, WorldState } from "../model/index.js";
import { containsPhrase, findPhrase, truncate } from "../util/text.js";

const JudgeOutput = z.object({
  present: z.boolean(),
  /** Verbatim quote from the screenplay that demonstrates the constraint, empty if absent. */
  quote: z.string(),
  explanation: z.string(),
});

const JUDGE_SYSTEM = `You are the Source Fidelity Critic of CineMemory. Decide whether a screenplay honors a specific source constraint.
You must cite a VERBATIM quote from the screenplay text that demonstrates it. If you cannot quote such a line, answer present=false.
Never rely on implication; the audience must actually hear or see the fact.`;

function screenplayText(screenplay: Screenplay): string {
  return screenplay.scenes
    .sort((a, b) => a.number - b.number)
    .map((s) => `Scene ${s.number} — ${s.title}\n` + s.lines.map((l) => `${l.type === "dialogue" ? (l.characterId ?? "?") + ": " : l.type === "narration" ? "NARRATOR: " : "[action] "}${l.text}`).join("\n"))
    .join("\n\n");
}

/**
 * Source Fidelity Critic. Deterministic keyword evidence first; when a Gemini provider is available,
 * a judge may rescue a keyword miss ONLY by citing a verbatim quote that we verify exists in the text.
 * A numeric confidence alone never counts as proof.
 */
export async function runSourceFidelityCritic(world: WorldState, screenplay: Screenplay, plan: AdaptationPlan | undefined, llm?: LLMProvider): Promise<CriticResult> {
  const started = new Date().toISOString();
  const col = new CriticCollector(world.projectId, "source_fidelity", { ...DETERMINISTIC, task: "source_fidelity_critic", createdAt: started });
  const scenes = [...screenplay.scenes].sort((a, b) => a.number - b.number);
  const fullText = screenplayText(screenplay);
  const name = (id: string) => world.characters.find((c) => c.id === id)?.name ?? world.events.find((e) => e.id === id)?.name ?? id;
  const sceneOf = (eventId: string) => scenes.find((s) => s.eventIds.includes(eventId));
  const severityFor = (c: SourceConstraint) => (c.importance === "must_keep" ? "high" : c.importance === "should_keep" ? "medium" : "low") as "high" | "medium" | "low";

  for (const c of world.sourceConstraints) {
    const scope = { entityIds: c.relatedEntities };
    switch (c.kind) {
      case "required_fact":
      case "educational_fact":
      case "theme":
      case "tone": {
        const found = findPhrase(fullText, c.keywords);
        if (found) {
          const scene = scenes.find((s) => s.lines.some((l) => containsPhrase(l.text, found)));
          const line = scene?.lines.find((l) => containsPhrase(l.text, found));
          col.check({ constraintId: c.id, code: "REQUIRED_FACT_MISSING", description: c.statement, outcome: "pass", scope: { ...scope, sceneId: scene?.id, sceneNumber: scene?.number } });
          void line;
          break;
        }
        if (c.keywords.length === 0) {
          col.notEvaluated(c.id, `${c.statement} (no verification keywords)`, scope, "REQUIRED_FACT_MISSING");
          break;
        }
        // Keyword miss: ask the judge for a verbatim quote, and verify the quote really exists.
        let rescued: { quote: string; explanation: string } | undefined;
        let judgeProv: CriticResult["provenance"] | undefined;
        if (llm && llm.name !== "fixture") {
          try {
            const res = await llm.generateStructured({
              task: "source_fidelity_judge",
              fixtureKey: `source_fidelity_judge:${c.id}`,
              system: JUDGE_SYSTEM,
              prompt: `CONSTRAINT (${c.kind}): ${c.statement}\n\nSCREENPLAY:\n${fullText}\n\nIs the constraint honored? Cite a verbatim quote.`,
              schema: JudgeOutput,
              temperature: 0,
            });
            judgeProv = res.provenance;
            if (res.data.present && res.data.quote.trim().length > 8 && containsPhrase(fullText, res.data.quote)) rescued = res.data;
          } catch {
            /* judge failure is not a pass; fall through to violation */
          }
        }
        if (rescued) {
          col.check({ constraintId: c.id, code: "REQUIRED_FACT_MISSING", description: `${c.statement} (judge-verified quote: "${truncate(rescued.quote, 100)}")`, outcome: "pass", scope });
          break;
        }
        if (c.kind === "theme" || c.kind === "tone") {
          col.violation({ code: "SOURCE_CONTRADICTION", constraintId: c.id, constraint: c.statement, expected: `Screenplay reflects ${c.kind}: ${c.statement}`, observed: `None of the ${c.kind} keywords [${c.keywords.join(", ")}] appear`, severity: "low", confidence: 0.7, evidence: `Keyword scan over ${scenes.length} scenes found no match${judgeProv ? "; judge could not cite a verbatim quote" : ""}.`, scope, provenance: judgeProv });
        } else {
          col.violation({ code: "REQUIRED_FACT_MISSING", constraintId: c.id, constraint: c.statement, expected: `Audience hears/sees: ${c.statement}`, observed: `No line contains any of [${c.keywords.join(", ")}]`, severity: severityFor(c), confidence: 1, evidence: `Deterministic keyword scan over ${scenes.length} scenes${judgeProv ? `; ${llm?.model} judge could not cite a verbatim quote` : ""}.`, scope, provenance: judgeProv ? { ...judgeProv, note: "keyword scan + judge with quote verification" } : undefined });
        }
        break;
      }
      case "required_event": {
        const evIds = c.relatedEntities.filter((e) => world.events.some((x) => x.id === e));
        if (evIds.length === 0) {
          col.notEvaluated(c.id, `${c.statement} (no event ids attached)`, scope, "REQUIRED_EVENT_MISSING");
          break;
        }
        for (const eid of evIds) {
          const s = sceneOf(eid);
          if (s) col.pass(c.id, `${c.statement}: "${name(eid)}" occurs in Scene ${s.number}`, { ...scope, sceneId: s.id, sceneNumber: s.number }, "REQUIRED_EVENT_MISSING");
          else col.violation({ code: "REQUIRED_EVENT_MISSING", constraintId: c.id, constraint: c.statement, expected: `Event "${name(eid)}" is dramatized in some scene`, observed: `No scene lists event ${eid}`, severity: severityFor(c), confidence: 1, evidence: `Scanned eventIds of ${scenes.length} scenes.`, scope: { entityIds: [eid] } });
        }
        break;
      }
      case "character_trait": {
        const chars = c.relatedEntities.filter((e) => world.characters.some((x) => x.id === e));
        for (const cid of chars) {
          const appears = scenes.some((s) => s.characterIds.includes(cid));
          if (!appears) {
            col.violation({ code: "REQUIRED_CHARACTER_MISSING", constraintId: c.id, constraint: c.statement, expected: `${name(cid)} appears in the film`, observed: `${name(cid)} is in no scene`, severity: severityFor(c), confidence: 1, evidence: `No scene.characterIds contains ${cid}.`, scope: { entityIds: [cid] } });
            continue;
          }
          if (c.keywords.length) {
            const found = findPhrase(fullText, c.keywords);
            if (found) col.pass(c.id, c.statement, { entityIds: [cid] }, "SOURCE_CONTRADICTION");
            else col.violation({ code: "SOURCE_CONTRADICTION", constraintId: c.id, constraint: c.statement, expected: `Trait shown: ${c.statement}`, observed: `No line contains [${c.keywords.join(", ")}]`, severity: "low", confidence: 0.7, evidence: `${name(cid)} appears in ${scenes.filter((s) => s.characterIds.includes(cid)).length} scenes but trait keywords are absent.`, scope: { entityIds: [cid] } });
          } else col.pass(c.id, `${c.statement}: ${name(cid)} present`, { entityIds: [cid] }, "REQUIRED_CHARACTER_MISSING");
        }
        break;
      }
      case "causal_dependency": {
        const evIds = c.relatedEntities.filter((e) => world.events.some((x) => x.id === e));
        const placed = evIds.map((e) => ({ e, s: sceneOf(e) })).filter((x) => x.s);
        if (placed.length < 2) {
          col.notEvaluated(c.id, `${c.statement} (fewer than two related events dramatized)`, scope, "CAUSAL_DEPENDENCY_VIOLATION");
          break;
        }
        const srcOrder = [...placed].sort((a, b) => world.events.find((x) => x.id === a.e)!.order - world.events.find((x) => x.id === b.e)!.order);
        const ok = srcOrder.every((x, i) => i === 0 || x.s!.number >= srcOrder[i - 1].s!.number);
        if (ok) col.pass(c.id, c.statement, scope, "CAUSAL_DEPENDENCY_VIOLATION");
        else col.violation({ code: "CAUSAL_DEPENDENCY_VIOLATION", constraintId: c.id, constraint: c.statement, expected: srcOrder.map((x) => name(x.e)).join(" → "), observed: placed.sort((a, b) => a.s!.number - b.s!.number).map((x) => `${name(x.e)} (S${x.s!.number})`).join(" → "), severity: severityFor(c), confidence: 1, evidence: "Scene order of related events contradicts source order.", scope });
        break;
      }
    }
  }

  // Adaptation plan promises: everything in mustKeep must actually be present.
  for (const m of plan?.mustKeep ?? []) {
    if (m.entityType === "character") {
      const appears = scenes.some((s) => s.characterIds.includes(m.entityId));
      if (appears) col.pass(undefined, `mustKeep: ${name(m.entityId)} appears`, { entityIds: [m.entityId] }, "REQUIRED_CHARACTER_MISSING");
      else col.violation({ code: "REQUIRED_CHARACTER_MISSING", constraint: `Adaptation plan keeps ${name(m.entityId)}`, expected: `${name(m.entityId)} in at least one scene`, observed: "absent from all scenes", severity: "high", confidence: 1, evidence: `mustKeep reason: ${m.reason}`, scope: { entityIds: [m.entityId] } });
    } else if (m.entityType === "event") {
      const s = sceneOf(m.entityId);
      if (s) col.pass(undefined, `mustKeep: "${name(m.entityId)}" dramatized`, { sceneId: s.id, sceneNumber: s.number, entityIds: [m.entityId] }, "REQUIRED_EVENT_MISSING");
      else col.violation({ code: "REQUIRED_EVENT_MISSING", constraint: `Adaptation plan keeps event "${name(m.entityId)}"`, expected: "event occurs in a scene", observed: "no scene lists it", severity: "high", confidence: 1, evidence: `mustKeep reason: ${m.reason}`, scope: { entityIds: [m.entityId] } });
    } else if (m.entityType === "prop") {
      const s = scenes.find((sc) => sc.propIds.includes(m.entityId));
      if (s) col.pass(undefined, `mustKeep: prop ${m.entityId} appears`, { sceneId: s.id, sceneNumber: s.number, entityIds: [m.entityId] });
      else col.violation({ code: "SOURCE_CONTRADICTION", constraint: `Adaptation plan keeps prop ${m.entityId}`, expected: "prop appears in a scene", observed: "no scene lists it", severity: "medium", confidence: 1, evidence: `mustKeep reason: ${m.reason}`, scope: { entityIds: [m.entityId] } });
    }
  }

  return col.result({ ...DETERMINISTIC, task: "source_fidelity_critic", createdAt: started, latencyMs: Date.now() - Date.parse(started), note: llm && llm.name !== "fixture" ? `judge: ${llm.model} (quote-verified)` : "deterministic only" });
}
