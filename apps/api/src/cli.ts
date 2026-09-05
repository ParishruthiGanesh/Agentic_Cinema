import { ensureDemoProject, runEvaluation, runPipeline, type Stage } from "@cinememory/core";
import { buildContext } from "./context.js";

/**
 * CLI helpers:
 *   tsx src/cli.ts seed-demo [toStage]      create the demo project and run the pipeline (default: narrative_verified)
 *   tsx src/cli.ts evaluate [projectId]     run baseline vs CineMemory (default: demo project)
 */
async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { ctx, info } = await buildContext();
  for (const w of info.warnings) console.warn(`[cinememory] ${w}`);
  ctx.events.subscribe((e) => console.log(`${e.ts.slice(11, 19)} ${e.level.padEnd(7)} ${e.agent.padEnd(22)} ${e.message}`));

  if (cmd === "seed-demo") {
    const project = ensureDemoProject(ctx);
    const done = await runPipeline(ctx, project.id, { toStage: (arg as Stage) ?? "narrative_verified" });
    console.log(`\nDemo project "${done.id}" at stage ${done.stage}.`);
  } else if (cmd === "evaluate") {
    const project = arg ? ctx.repo.getProject(arg) : ensureDemoProject(ctx);
    if (!project) throw new Error(`Project ${arg} not found`);
    if (!ctx.repo.getWorld(project.id)) await runPipeline(ctx, project.id, { toStage: "source_analyzed" });
    const cmp = await runEvaluation(ctx, project.id);
    console.table({ baseline: cmp.baseline.metrics, cinememory: cmp.cinememory.metrics });
  } else {
    console.log("usage: cli.ts seed-demo [toStage] | evaluate [projectId]");
    process.exitCode = 1;
  }
  ctx.repo.store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
