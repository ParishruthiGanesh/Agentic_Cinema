import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  EventBus,
  FixtureLLMProvider,
  GeminiLLMProvider,
  GeminiMediaProvider,
  LLMConfigError,
  LocalPartnerAdapter,
  PlaceholderMediaProvider,
  Repository,
  SqliteDocumentStore,
  createDemoFixtureProvider,
  type AgentContext,
  type CineMemoryConfig,
  type LLMProvider,
  type MediaGenerationProvider,
  type PartnerAdapter,
} from "@cinememory/core";

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
  dataDir: string;
  videoEnabled: boolean;
  warnings: string[];
}

export function buildContext(): { ctx: AgentContext; info: RuntimeInfo } {
  loadEnv();
  const env = process.env;
  const warnings: string[] = [];
  const dataDir = resolve(repoRoot(), env.CINEMEMORY_DATA_DIR ?? "./data");
  const config: CineMemoryConfig = {
    repairMaxAttempts: Number(env.REPAIR_MAX_ATTEMPTS ?? 2),
    enableVideoGeneration: env.ENABLE_VIDEO_GENERATION === "true",
    mediaDir: resolve(dataDir, "media"),
  };
  const store = new SqliteDocumentStore(resolve(dataDir, "cinememory.db"));
  const repo = new Repository(store);
  const partner: PartnerAdapter = new LocalPartnerAdapter(store);
  if (env.PARTNER_ADAPTER && env.PARTNER_ADAPTER !== "local") warnings.push(`PARTNER_ADAPTER=${env.PARTNER_ADAPTER} is not implemented yet; using "local"`);

  const vertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true";
  const hasGemini = !!env.GEMINI_API_KEY || (vertex && !!env.GOOGLE_CLOUD_PROJECT);
  const llmChoice = env.LLM_PROVIDER || (hasGemini ? "gemini" : "fixture");
  let llm: LLMProvider;
  if (llmChoice === "gemini") {
    if (!hasGemini) throw new LLMConfigError("LLM_PROVIDER=gemini but no GEMINI_API_KEY (or Vertex project) configured");
    llm = new GeminiLLMProvider({ apiKey: env.GEMINI_API_KEY, vertexai: vertex, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, model: env.GEMINI_TEXT_MODEL });
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

  const ctx: AgentContext = { repo, llm, media, partner, events: new EventBus(repo, partner), config };
  const info: RuntimeInfo = {
    llm: { name: llm.name, model: llm.model, fixtureMode: llm instanceof FixtureLLMProvider, supportsVision: llm.supportsVision },
    media: { name: media.name, capabilities: media.capabilities },
    partner: partner.name,
    dataDir,
    videoEnabled: config.enableVideoGeneration && media.capabilities.video,
    warnings,
  };
  return { ctx, info };
}
