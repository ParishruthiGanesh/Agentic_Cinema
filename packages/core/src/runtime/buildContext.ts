import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ClickHouseMemory } from "../clickhouse/clickhouseMemory.js";
import { EventBus, type AgentContext, type CineMemoryConfig } from "../agents/context.js";
import { FixtureLLMProvider } from "../llm/fixture.js";
import { GeminiLLMProvider } from "../llm/gemini.js";
import { InstrumentedLLMProvider } from "../llm/instrumented.js";
import { LLMConfigError, type LLMProvider } from "../llm/provider.js";
import { GeminiMediaProvider } from "../media/gemini.js";
import { PlaceholderMediaProvider } from "../media/placeholder.js";
import type { MediaGenerationProvider } from "../media/provider.js";
import { LocalProductionMemory, type ProductionMemory } from "../memory/productionMemory.js";
import { LocalPartnerAdapter } from "../partner/localAdapter.js";
import type { PartnerAdapter } from "../partner/adapter.js";
import { Repository } from "../persistence/repository.js";
import { SqliteDocumentStore } from "../persistence/sqliteStore.js";
import { createDemoFixtureProvider } from "../demo/index.js";

/** Walk up from cwd to the pnpm workspace root so relative paths behave the same from any package. */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Load ./.env (repo root or cwd) without a dependency; real env vars win. */
export function loadEnv(): void {
  for (const candidate of [resolve(process.cwd(), ".env"), resolve(repoRoot(), ".env")]) {
    if (existsSync(candidate)) {
      try {
        const before = { ...process.env };
        process.loadEnvFile(candidate);
        for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
      } catch {
        /* ignore malformed env file */
      }
      break;
    }
  }
}

export interface RuntimeInfo {
  llm: { name: string; model: string; fixtureMode: boolean; supportsVision: boolean };
  media: { name: string; capabilities: MediaGenerationProvider["capabilities"] };
  partner: string;
  memory: { name: string; persistent: boolean; url?: string; database?: string };
  dataDir: string;
  videoEnabled: boolean;
  warnings: string[];
}

export async function buildContext(): Promise<{ ctx: AgentContext; info: RuntimeInfo }> {
  loadEnv();
  const env = process.env;
  const warnings: string[] = [];
  const failovers: Array<{ from: string; to: string; reason: string }> = [];
  const dataDir = resolve(repoRoot(), env.CINEMEMORY_DATA_DIR ?? "./data");
  const config: CineMemoryConfig = {
    repairMaxAttempts: Number(env.REPAIR_MAX_ATTEMPTS ?? 2),
    enableVideoGeneration: env.ENABLE_VIDEO_GENERATION === "true",
    mediaDir: resolve(dataDir, "media"),
  };
  const store = new SqliteDocumentStore(resolve(dataDir, "cinememory.db"));
  const repo = new Repository(store);

  // Production memory + partner adapter: ClickHouse when configured, otherwise local (development only).
  let memory: ProductionMemory;
  let partner: PartnerAdapter;
  const chUrl = env.CLICKHOUSE_URL;
  const partnerChoice = env.PARTNER_ADAPTER || (chUrl ? "clickhouse" : "local");
  if (partnerChoice === "clickhouse") {
    if (!chUrl) throw new Error("PARTNER_ADAPTER=clickhouse requires CLICKHOUSE_URL (e.g. https://<host>.clickhouse.cloud:8443 or http://127.0.0.1:8123)");
    const ch = new ClickHouseMemory({ url: chUrl, username: env.CLICKHOUSE_USER, password: env.CLICKHOUSE_PASSWORD, database: env.CLICKHOUSE_DATABASE });
    const health = await ch.healthCheck();
    if (!health.ok) throw new Error(`ClickHouse at ${chUrl} is not reachable: ${health.detail}. Start it (pnpm clickhouse:local) or fix CLICKHOUSE_URL/credentials.`);
    await ch.init();
    memory = ch;
    partner = ch;
  } else if (partnerChoice === "local") {
    memory = new LocalProductionMemory(repo);
    partner = new LocalPartnerAdapter(store);
    warnings.push("No CLICKHOUSE_URL: production memory is the local document store (not persistent long-horizon memory). Set CLICKHOUSE_URL for ClickHouse.");
  } else {
    throw new Error(`Unknown PARTNER_ADAPTER "${partnerChoice}" (expected clickhouse | local)`);
  }

  const vertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true";
  const hasGemini = !!env.GEMINI_API_KEY || (vertex && !!env.GOOGLE_CLOUD_PROJECT);
  const llmChoice = env.LLM_PROVIDER || (hasGemini ? "gemini" : "fixture");
  let llm: LLMProvider;
  if (llmChoice === "gemini") {
    if (!hasGemini) throw new LLMConfigError("LLM_PROVIDER=gemini but no GEMINI_API_KEY (or Vertex project) configured");
    const pool = (env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash").split(",").map((m) => m.trim()).filter(Boolean);
    llm = new GeminiLLMProvider({ apiKey: env.GEMINI_API_KEY, vertexai: vertex, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, models: pool, onFailover: (from, to, reason) => failovers.push({ from, to, reason }) });
    if (pool.length > 1) warnings.push(`Gemini model pool: ${pool.join(" → ")} (fails over when a model's daily quota is exhausted; every artifact records the model that produced it)`);
  } else if (llmChoice === "fixture") {
    llm = createDemoFixtureProvider();
    warnings.push("LLM_PROVIDER=fixture: agents replay authored development fixtures for the bundled demo only. Set GEMINI_API_KEY for real Gemini agents.");
  } else {
    throw new LLMConfigError(`Unknown LLM_PROVIDER "${llmChoice}" (expected gemini | fixture)`);
  }

  const mediaChoice = env.MEDIA_PROVIDER || (hasGemini ? "gemini" : "placeholder");
  let media: MediaGenerationProvider;
  if (mediaChoice === "gemini") {
    media = new GeminiMediaProvider({ apiKey: env.GEMINI_API_KEY, vertexai: vertex, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, imageModel: env.GEMINI_IMAGE_MODEL, videoModel: env.GEMINI_VIDEO_MODEL, ttsModel: env.GEMINI_TTS_MODEL, enableVideo: config.enableVideoGeneration });
  } else {
    media = new PlaceholderMediaProvider();
    warnings.push("MEDIA_PROVIDER=placeholder: keyframes are labelled SVG storyboard cards, not model output.");
  }

  const events = new EventBus(repo, partner);
  events.attachMemory(memory);
  const instrumented = new InstrumentedLLMProvider(llm, memory, events, () => failovers.splice(0));
  const ctx: AgentContext = { repo, llm: instrumented, media, partner, memory, events, config };
  const info: RuntimeInfo = {
    llm: { name: llm.name, model: llm.model, fixtureMode: llm instanceof FixtureLLMProvider, supportsVision: llm.supportsVision },
    media: { name: media.name, capabilities: media.capabilities },
    partner: partner.name,
    memory: { name: memory.name, persistent: memory.persistent, url: memory.name === "clickhouse" ? chUrl : undefined, database: memory.name === "clickhouse" ? (memory as ClickHouseMemory).db : undefined },
    dataDir,
    videoEnabled: config.enableVideoGeneration && media.capabilities.video,
    warnings,
  };
  return { ctx, info };
}
