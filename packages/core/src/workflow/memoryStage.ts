import { memoryLabel, type AgentContext } from "../agents/context.js";
import { foldScreenplay } from "../memory/worldMemory.js";
import type { Screenplay, StateChange, WorldState } from "../model/index.js";

/**
 * Fold the screenplay into the World Memory change log, persist it in the document store (for the UI)
 * and in production memory (ClickHouse: state_changes + knowledge_events + scenes), and report it.
 * Used by the memory_built stage, by the Repair Agent after a rewrite, and by the evaluation harness.
 */
export async function persistWorldMemory(ctx: AgentContext, projectId: string, world: WorldState, screenplay: Screenplay): Promise<{ world: WorldState; changes: StateChange[] }> {
  const folded = foldScreenplay(world, screenplay);
  ctx.repo.saveWorld(folded.world);
  ctx.repo.replaceStateChanges(projectId, folded.changes);
  const t = Date.now();
  await ctx.memory.recordStateChanges(projectId, folded.changes, screenplay.version);
  await ctx.memory.recordKnowledgeEvents(projectId, folded.world, screenplay);
  const facts = folded.world.knowledgeFacts.filter((f) => f.holders.length);
  const holders = facts.reduce((n, f) => n + f.holders.length, 0);
  ctx.events.emit(projectId, "world_memory", "memory.built", `World memory v${screenplay.version} written to ${memoryLabel(ctx)}: ${folded.changes.length} state changes across ${screenplay.scenes.length} scenes, ${holders} knowledge events for ${facts.length} facts (${Date.now() - t}ms)`, { version: folded.world.version, screenplayVersion: screenplay.version, changes: folded.changes.length, knowledgeEvents: holders, memory: ctx.memory.name }, "success");
  return folded;
}
