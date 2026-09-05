import { createProducerRunner, type ProducerRunner, type ProducerStep } from "@cinememory/agent";
import type { AgentContext } from "@cinememory/core";
import type { RuntimeInfo } from "./context.js";

/**
 * Lazily constructed ADK Producer agent (Gemini + CineMemory tools + ClickHouse MCP toolset).
 * Unavailable in fixture mode: the agent itself needs a live Gemini model, and we never fake it.
 */
export class ProducerService {
  private runner?: ProducerRunner;
  readonly available: boolean;
  readonly reason?: string;
  readonly mcpAttached: boolean;

  constructor(
    private ctx: AgentContext,
    private info: RuntimeInfo,
  ) {
    this.available = !info.llm.fixtureMode;
    this.reason = this.available ? undefined : "The Producer agent runs on a live Gemini model (ADK LlmAgent). Set GEMINI_API_KEY to enable it.";
    this.mcpAttached = !!process.env.CLICKHOUSE_URL && process.env.CINEMEMORY_MCP !== "false";
  }

  private get(): ProducerRunner {
    if (this.runner) return this.runner;
    const env = process.env;
    const chUrl = env.CLICKHOUSE_URL ? new URL(env.CLICKHOUSE_URL) : undefined;
    this.runner = createProducerRunner(this.ctx, {
      model: env.GEMINI_TEXT_MODEL,
      apiKey: env.GEMINI_API_KEY,
      vertexai: env.GOOGLE_GENAI_USE_VERTEXAI === "true",
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.GOOGLE_CLOUD_LOCATION,
      clickhouseMcp: chUrl && this.mcpAttached ? { env: { CLICKHOUSE_HOST: chUrl.hostname, CLICKHOUSE_PORT: chUrl.port || (chUrl.protocol === "https:" ? "8443" : "8123"), CLICKHOUSE_USER: env.CLICKHOUSE_USER ?? "default", CLICKHOUSE_PASSWORD: env.CLICKHOUSE_PASSWORD ?? "", CLICKHOUSE_SECURE: chUrl.protocol === "https:" ? "true" : "false", CLICKHOUSE_VERIFY: "false" } } : undefined,
    });
    return this.runner;
  }

  async chat(sessionId: string, message: string): Promise<ProducerStep[]> {
    if (!this.available) throw new Error(this.reason);
    return this.get().chat("web", sessionId, message);
  }

  status() {
    return { available: this.available, reason: this.reason, model: this.info.llm.model, provider: this.info.llm.name, framework: "@google/adk", mcp: this.mcpAttached ? "mcp-clickhouse (official ClickHouse MCP server)" : null, memory: this.info.memory.name };
  }
}
