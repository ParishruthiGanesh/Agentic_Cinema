import { Gemini, InMemorySessionService, LlmAgent, MCPToolset, Runner, getFunctionCalls, getFunctionResponses, isFinalResponse, type BaseTool, type Event } from "@google/adk";
import type { AgentContext } from "@cinememory/core";
import { createCineMemoryTools } from "./tools.js";

export const PRODUCER_INSTRUCTION = `You are the CineMemory Producer, an agent that runs an agentic short-film production with a persistent production memory.

CineMemory's workflow: Source Intelligence → Adaptation → Screenplay → World Memory → Director/Shot planning → Generation → Continuity Critics → Repair → Verification → Film assembly.
- Gemini agents reason about each stage; ClickHouse is the long-horizon production memory (scenes, shots, state changes, knowledge events, constraints, violations, repair attempts).
- Use run_pipeline to advance a project; it is resumable. Use get_project_status and list_violations to inspect results.
- When a violation is open or escalated, use query_scene_memory to retrieve what characters know before that scene, explain the violation with that evidence, then call repair_violation and report the outcome truthfully (resolved, still failing, escalated).
- Never claim something succeeded unless a tool result says so. Report which model/provider produced artifacts when relevant.
- Keep answers concise and concrete: stage reached, counts, violations by code, what was repaired, what needs the user's decision.`;

export interface ProducerOptions {
  model?: string;
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  /** Attach the official ClickHouse MCP server (mcp-clickhouse) so the agent can run ad-hoc SQL over production memory. */
  clickhouseMcp?: { command?: string; env: Record<string, string> };
}

/** Build the ADK LlmAgent with CineMemory tools (and optionally the ClickHouse MCP toolset). */
export function createProducerAgent(ctx: AgentContext, opts: ProducerOptions = {}) {
  const tools = createCineMemoryTools(ctx);
  const toolList: BaseTool[] = [tools.listProjects, tools.createDemo, tools.create, tools.runStage, tools.status, tools.violations, tools.repair, tools.verify, tools.sceneMemory, tools.evaluate];
  const mcp = opts.clickhouseMcp ? new MCPToolset({ type: "StdioConnectionParams", serverParams: { command: opts.clickhouseMcp.command ?? "mcp-clickhouse", env: { ...process.env, ...opts.clickhouseMcp.env } as Record<string, string> } }, ["list_databases", "list_tables", "run_query"], "clickhouse_") : undefined;
  const modelName = opts.model ?? "gemini-3.6-flash";
  const model = opts.apiKey || opts.vertexai ? new Gemini({ model: modelName, apiKey: opts.apiKey, vertexai: opts.vertexai, project: opts.project, location: opts.location }) : modelName;
  const agent = new LlmAgent({
    name: "cinememory_producer",
    description: "Runs and supervises CineMemory productions: pipeline stages, continuity inspection, repair, evaluation, and production-memory queries.",
    model,
    instruction: PRODUCER_INSTRUCTION,
    tools: mcp ? [...toolList, mcp] : toolList,
  });
  return { agent, tools, mcp };
}

export interface ProducerRunner {
  runner: Runner;
  appName: string;
  ensureSession(userId: string, sessionId: string): Promise<void>;
  /** Send one user message and collect the agent's steps. */
  chat(userId: string, sessionId: string, message: string): Promise<ProducerStep[]>;
}

export type ProducerStep =
  | { type: "text"; author: string; text: string; final: boolean }
  | { type: "tool_call"; author: string; name: string; args: unknown }
  | { type: "tool_result"; author: string; name: string; result: unknown };

export function createProducerRunner(ctx: AgentContext, opts: ProducerOptions = {}): ProducerRunner {
  const { agent } = createProducerAgent(ctx, opts);
  const appName = "cinememory";
  const sessionService = new InMemorySessionService();
  const runner = new Runner({ appName, agent, sessionService });
  const ensureSession = async (userId: string, sessionId: string) => {
    const existing = await sessionService.getSession({ appName, userId, sessionId });
    if (!existing) await sessionService.createSession({ appName, userId, sessionId });
  };
  return {
    runner,
    appName,
    ensureSession,
    async chat(userId, sessionId, message) {
      await ensureSession(userId, sessionId);
      const steps: ProducerStep[] = [];
      for await (const event of runner.runAsync({ userId, sessionId, newMessage: { role: "user", parts: [{ text: message }] } })) {
        steps.push(...summarize(event));
      }
      return steps;
    },
  };
}

function summarize(event: Event): ProducerStep[] {
  const out: ProducerStep[] = [];
  const author = event.author ?? "agent";
  for (const c of getFunctionCalls(event)) out.push({ type: "tool_call", author, name: c.name ?? "?", args: c.args });
  for (const r of getFunctionResponses(event)) out.push({ type: "tool_result", author, name: r.name ?? "?", result: r.response });
  const text = (event.content?.parts ?? []).map((p) => p.text ?? "").filter(Boolean).join("");
  if (text) out.push({ type: "text", author, text, final: isFinalResponse(event) });
  return out;
}
