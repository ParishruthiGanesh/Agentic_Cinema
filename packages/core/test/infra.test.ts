import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toGeminiJsonSchema } from "../src/llm/jsonSchema.js";
import { SqliteDocumentStore } from "../src/persistence/sqliteStore.js";
import { Repository } from "../src/persistence/repository.js";
import { LocalPartnerAdapter } from "../src/partner/localAdapter.js";
import { EventBus } from "../src/agents/context.js";
import { keywordsFromFact } from "../src/agents/sourceIntelligence.js";
import { containsPhrase } from "../src/util/text.js";
import { SourceAnalysisOutput } from "../src/agents/sourceIntelligence.js";
import { screenplaySchemaFor } from "../src/agents/screenplay.js";
import { demoArtifacts } from "./helpers.js";

describe("Gemini JSON schema conversion", () => {
  it("strips unsupported keywords and keeps structure", () => {
    const schema = z.object({ name: z.string().describe("the name"), tags: z.array(z.string()).default([]), kind: z.enum(["a", "b"]), n: z.number().int().optional() });
    const js = toGeminiJsonSchema(schema) as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(js.type).toBe("object");
    expect(Object.keys(js.properties)).toEqual(["name", "tags", "kind", "n"]);
    expect(js.required).toEqual(expect.arrayContaining(["name", "kind"]));
    expect(JSON.stringify(js)).not.toContain("$schema");
    expect(JSON.stringify(js)).not.toContain('"default"');
  });

  it("converts the large agent schemas without throwing", () => {
    expect(() => toGeminiJsonSchema(SourceAnalysisOutput)).not.toThrow();
    const { world } = demoArtifacts();
    const refined = toGeminiJsonSchema(screenplaySchemaFor(world)) as { properties: Record<string, unknown> };
    expect(Object.keys(refined.properties)).toEqual(["title", "logline", "acts", "scenes"]);
  });
});

describe("SQLite document store + repository", () => {
  it("round-trips documents and keeps a monotonic event log", () => {
    const store = new SqliteDocumentStore(":memory:");
    const repo = new Repository(store);
    const bus = new EventBus(repo, new LocalPartnerAdapter(store));
    const now = new Date().toISOString();
    repo.saveProject({ id: "p1", title: "P", mode: "creator", source: { kind: "original", title: "s", text: "t" }, brief: { genre: "g", audience: "a", targetDurationSec: 60, language: "English", visualStyle: "v", format: "f", requiredFacts: [] }, stage: "created", stages: [], isDemo: false, createdAt: now, updatedAt: now });
    expect(repo.getProject("p1")?.title).toBe("P");
    expect(repo.listProjects()).toHaveLength(1);
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.emit("p1", "orchestrator", "a", "first");
    bus.emit("p1", "orchestrator", "b", "second");
    const events = repo.listEvents("p1");
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(repo.listEvents("p1", 1).map((e) => e.type)).toEqual(["b"]);
    expect(seen).toEqual(["a", "b"]);
    repo.deleteProject("p1");
    expect(repo.getProject("p1")).toBeUndefined();
    expect(repo.listEvents("p1")).toHaveLength(0);
    store.close();
  });

  it("rejects corrupted documents instead of returning them", () => {
    const store = new SqliteDocumentStore(":memory:");
    const repo = new Repository(store);
    store.put("projects", "bad", "current", { id: "bad", nope: true });
    expect(() => repo.getProject("bad")).toThrow();
    store.close();
  });
});

describe("Deterministic helpers", () => {
  it("derives verification keywords from a required fact", () => {
    expect(keywordsFromFact("Fireflies make their own light; this is called bioluminescence.")).toEqual(["fireflies", "make", "their", "light"]);
  });
  it("matches phrases ignoring case and punctuation", () => {
    expect(containsPhrase("Your glow... the needle FOLLOWS the light!", "needle follows")).toBe(true);
    expect(containsPhrase("Follow the light!", "follows the light")).toBe(false);
  });
});
