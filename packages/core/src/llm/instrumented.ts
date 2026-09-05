import type { ProductionMemory } from "../memory/productionMemory.js";
import type { EventBus } from "../agents/context.js";
import { newId } from "../util/hash.js";
import type { LLMProvider, StructuredRequest, StructuredResult } from "./provider.js";

/**
 * Wraps any LLMProvider so every model call is (a) written to production memory as an agent action and
 * (b) emitted as a workflow event. This is how the Agent Activity log shows real Gemini calls with
 * model, latency and tokens, and how ClickHouse accumulates the full reasoning history of a production.
 */
export class InstrumentedLLMProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsVision: boolean;
  private projectId: string | undefined;

  constructor(
    private inner: LLMProvider,
    private memory: ProductionMemory,
    private events: EventBus,
  ) {
    this.name = inner.name;
    this.model = inner.model;
    this.supportsVision = inner.supportsVision;
  }

  /** The orchestrator sets the active project so calls can be attributed. */
  setProject(projectId: string | undefined) {
    this.projectId = projectId;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const projectId = this.projectId ?? "unknown";
    try {
      const result = await this.inner.generateStructured(req);
      const p = result.provenance;
      const tokens = p.inputTokens !== undefined ? ` · ${p.inputTokens}→${p.outputTokens ?? 0} tokens` : "";
      this.events.emit(projectId, agentFor(req.task), "agent.llm.call", `${this.name === "gemini" ? "Gemini" : this.name} ${p.model ?? this.model} · ${req.task} · ${((p.latencyMs ?? Date.now() - started) / 1000).toFixed(1)}s${tokens}`, { task: req.task, provider: p.provider, model: p.model, latencyMs: p.latencyMs, inputTokens: p.inputTokens, outputTokens: p.outputTokens, promptHash: p.promptHash });
      await this.memory.recordAgentAction({ projectId, actionId: newId("act"), task: req.task, provider: p.provider, model: p.model, latencyMs: p.latencyMs ?? Date.now() - started, inputTokens: p.inputTokens, outputTokens: p.outputTokens, promptHash: p.promptHash, ok: true, createdAt: new Date().toISOString() }).catch(() => undefined);
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.events.emit(projectId, agentFor(req.task), "agent.llm.failed", `${this.name} call failed for ${req.task}: ${message}`, { task: req.task, provider: this.name, model: this.model }, "error");
      await this.memory.recordAgentAction({ projectId, actionId: newId("act"), task: req.task, provider: this.name, model: this.model, latencyMs: Date.now() - started, ok: false, error: message, createdAt: new Date().toISOString() }).catch(() => undefined);
      throw err;
    }
  }
}

function agentFor(task: string) {
  if (task.startsWith("source_intelligence")) return "source_intelligence" as const;
  if (task.startsWith("adaptation")) return "adaptation" as const;
  if (task.startsWith("screenplay")) return "screenplay" as const;
  if (task.startsWith("shot_planning")) return "director" as const;
  if (task.startsWith("scene_rewrite")) return "repair" as const;
  if (task.startsWith("visual_inspection")) return "visual_critic" as const;
  if (task.startsWith("source_fidelity")) return "source_fidelity_critic" as const;
  if (task.startsWith("narrative")) return "narrative_critic" as const;
  return "orchestrator" as const;
}
