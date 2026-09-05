import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { buildContext } from "./context.js";
import { JobRunner } from "./jobs.js";
import { ProducerService } from "./producer.js";

const { ctx, info } = await buildContext();
const jobs = new JobRunner(ctx);
const producer = new ProducerService(ctx, info);
const app = createApp(ctx, info, jobs, producer);
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

for (const w of info.warnings) console.warn(`[cinememory] ${w}`);
console.log(`[cinememory] Producer agent (ADK): ${producer.available ? "available" : producer.reason}${producer.mcpAttached ? " · ClickHouse MCP attached" : ""}`);
console.log(`[cinememory] LLM: ${info.llm.name}/${info.llm.model}  media: ${info.media.name}  memory: ${info.memory.name}${info.memory.url ? ` (${info.memory.url}/${info.memory.database})` : ""}  data: ${info.dataDir}`);

serve({ fetch: app.fetch, port }, (addr) => {
  console.log(`[cinememory] API listening on http://localhost:${addr.port}`);
});
