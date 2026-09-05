import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { buildContext } from "./context.js";
import { JobRunner } from "./jobs.js";

const { ctx, info } = buildContext();
const jobs = new JobRunner(ctx);
const app = createApp(ctx, info, jobs);
const port = Number(process.env.API_PORT ?? 8787);

for (const w of info.warnings) console.warn(`[cinememory] ${w}`);
console.log(`[cinememory] LLM: ${info.llm.name}/${info.llm.model}  media: ${info.media.name}  partner: ${info.partner}  data: ${info.dataDir}`);

serve({ fetch: app.fetch, port }, (addr) => {
  console.log(`[cinememory] API listening on http://localhost:${addr.port}`);
});
