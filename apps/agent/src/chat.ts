import { createInterface } from "node:readline/promises";
import { buildContext } from "@cinememory/core";
import { createProducerRunner } from "./producer.js";

/**
 * Terminal chat with the CineMemory Producer (ADK LlmAgent on Gemini).
 *   pnpm --filter @cinememory/agent chat
 * Requires GEMINI_API_KEY (or Vertex ADC). With CLICKHOUSE_URL set, the ClickHouse MCP toolset is attached.
 */
async function main() {
  const { ctx, info } = await buildContext();
  if (info.llm.fixtureMode) {
    console.error("The Producer agent needs a live Gemini model: set GEMINI_API_KEY in .env (https://aistudio.google.com/apikey).");
    process.exit(2);
  }
  const env = process.env;
  const chUrl = env.CLICKHOUSE_URL ? new URL(env.CLICKHOUSE_URL) : undefined;
  const producer = createProducerRunner(ctx, {
    model: env.GEMINI_TEXT_MODEL,
    apiKey: env.GEMINI_API_KEY,
    vertexai: env.GOOGLE_GENAI_USE_VERTEXAI === "true",
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION,
    clickhouseMcp: chUrl && env.CINEMEMORY_MCP !== "false" ? { env: { CLICKHOUSE_HOST: chUrl.hostname, CLICKHOUSE_PORT: chUrl.port || (chUrl.protocol === "https:" ? "8443" : "8123"), CLICKHOUSE_USER: env.CLICKHOUSE_USER ?? "default", CLICKHOUSE_PASSWORD: env.CLICKHOUSE_PASSWORD ?? "", CLICKHOUSE_SECURE: chUrl.protocol === "https:" ? "true" : "false", CLICKHOUSE_VERIFY: "false" } } : undefined,
  });
  ctx.events.subscribe((e) => console.log(`  · ${e.agent}: ${e.message}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`CineMemory Producer (ADK · ${info.llm.model} · memory ${info.memory.name}). Type a request, e.g. "Create the demo project, run it to narrative_verified and explain any violations." Ctrl+C to exit.`);
  const sessionId = `cli_${Date.now().toString(36)}`;
  while (true) {
    const message = await rl.question("\nyou> ");
    if (!message.trim()) continue;
    const steps = await producer.chat("cli", sessionId, message);
    for (const s of steps) {
      if (s.type === "tool_call") console.log(`  ⇢ ${s.name}(${JSON.stringify(s.args)})`);
      else if (s.type === "tool_result") console.log(`  ⇠ ${s.name}: ${JSON.stringify(s.result).slice(0, 300)}`);
      else console.log(`\nproducer> ${s.text}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
