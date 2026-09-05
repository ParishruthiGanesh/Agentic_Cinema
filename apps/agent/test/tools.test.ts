import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus, InMemoryDocumentStore, InstrumentedLLMProvider, LocalPartnerAdapter, LocalProductionMemory, PlaceholderMediaProvider, Repository, createDemoFixtureProvider, type AgentContext } from "@cinememory/core";
import { createCineMemoryTools } from "../src/tools.js";
import { createProducerAgent } from "../src/producer.js";

function ctx(): AgentContext {
  const store = new InMemoryDocumentStore();
  const repo = new Repository(store);
  const partner = new LocalPartnerAdapter(store);
  const memory = new LocalProductionMemory(repo);
  const events = new EventBus(repo, partner);
  events.attachMemory(memory);
  return { repo, llm: new InstrumentedLLMProvider(createDemoFixtureProvider(), memory, events), media: new PlaceholderMediaProvider(), partner, memory, events, config: { repairMaxAttempts: 2, enableVideoGeneration: false, mediaDir: mkdtempSync(join(tmpdir(), "cm-agent-")) } };
}

const exec = async <T>(tool: { execute?: unknown; runAsync?: unknown }, args: unknown): Promise<T> => {
  // FunctionTool stores the execute callback; call it the way ADK does (input, toolContext).
  const fn = (tool as unknown as { execute?: (i: unknown) => Promise<T>; func?: (i: unknown) => Promise<T> }).execute ?? (tool as unknown as { func: (i: unknown) => Promise<T> }).func;
  return fn(args);
};

describe("ADK Producer agent", () => {
  it("builds an LlmAgent with the CineMemory tool set", () => {
    const { agent, tools } = createProducerAgent(ctx(), { model: "gemini-2.5-flash" });
    expect(agent.name).toBe("cinememory_producer");
    expect(Object.keys(tools)).toHaveLength(10);
    expect(agent.tools?.length).toBe(10);
  });

  it("tools drive the real pipeline, critics, memory retrieval and repair", async () => {
    const c = ctx();
    const tools = createCineMemoryTools(c);
    const demo = await exec<{ projectId: string }>(tools.createDemo, {});
    expect(demo.projectId).toBe("lumi_demo");
    c.config.repairMaxAttempts = 0; // leave violations escalated so the agent has something to repair
    const run = await exec<{ stage: string; continuity: { unresolved: number } }>(tools.runStage, { projectId: demo.projectId, toStage: "narrative_verified", force: false });
    expect(run.stage).toBe("narrative_verified");
    const escalated = await exec<Array<{ id: string; code: string; scene?: number }>>(tools.violations, { projectId: demo.projectId, status: "escalated" });
    expect(escalated.map((v) => v.code).sort()).toEqual(["KNOWLEDGE_TIMELINE_VIOLATION", "REQUIRED_FACT_MISSING"]);

    const mem = await exec<{ knowledge: Array<{ character: string; sinceScene: number }>; mustNotReference: Array<{ unknownTo: string[] }> }>(tools.sceneMemory, { projectId: demo.projectId, sceneNumber: 4 });
    expect(mem.knowledge).toEqual([{ character: "lumi", fact: "The broken compass's needle points to the brightest light, not north.", sinceScene: 3, via: "the needle follows her glow" }]);
    expect(mem.mustNotReference[0].unknownTo).toEqual(["milo"]);

    c.config.repairMaxAttempts = 2;
    const kv = escalated.find((v) => v.code === "KNOWLEDGE_TIMELINE_VIOLATION")!;
    // A repair request after escalation gets a fresh budget through the same path the API uses.
    const v0 = c.repo.getViolation(demo.projectId, kv.id)!;
    c.repo.saveViolation({ ...v0, status: "open", repairAttempts: [] });
    const repaired = await exec<{ status: string }>(tools.repair, { projectId: demo.projectId, violationId: kv.id });
    expect(repaired.status).toBe("resolved");
    const events = c.repo.listEvents(demo.projectId).filter((e) => e.type === "agent.producer.tool");
    expect(events.length).toBeGreaterThan(2);
  });
});
