import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, type AgentContext } from "../src/agents/context.js";
import { createDemoFixtureProvider, ensureDemoProject, LUMI_DEMO_INPUT, DEMO_FIXTURES } from "../src/demo/index.js";
import { PlaceholderMediaProvider } from "../src/media/placeholder.js";
import { normalizeSourceAnalysis } from "../src/agents/sourceIntelligence.js";
import { normalizeScreenplay } from "../src/agents/screenplay.js";
import { LocalPartnerAdapter } from "../src/partner/localAdapter.js";
import { InMemoryDocumentStore } from "../src/persistence/documentStore.js";
import { Repository } from "../src/persistence/repository.js";
import type { Project, Screenplay, WorldState } from "../src/model/index.js";

export function makeTestContext(): AgentContext {
  const store = new InMemoryDocumentStore();
  const repo = new Repository(store);
  const partner = new LocalPartnerAdapter(store);
  return {
    repo,
    llm: createDemoFixtureProvider(),
    media: new PlaceholderMediaProvider(),
    partner,
    events: new EventBus(repo, partner),
    config: { repairMaxAttempts: 2, enableVideoGeneration: false, mediaDir: mkdtempSync(join(tmpdir(), "cinememory-test-")) },
  };
}

/** Demo project + world + screenplay straight from fixtures, without running agents. */
export function demoArtifacts(): { project: Project; world: WorldState; screenplay: Screenplay } {
  const project: Project = {
    id: "lumi_demo",
    ...LUMI_DEMO_INPUT,
    stage: "created",
    stages: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const { world } = normalizeSourceAnalysis(project, DEMO_FIXTURES.SOURCE_ANALYSIS);
  const screenplay = normalizeScreenplay(project, DEMO_FIXTURES.SCREENPLAY);
  return { project, world, screenplay };
}

export { ensureDemoProject };
