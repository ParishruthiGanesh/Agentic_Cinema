import type {
  AdaptationPlan,
  CheckRecord,
  CineGraph,
  ContinuitySummary,
  CreateProjectInput,
  EvalComparison,
  FilmManifest,
  Project,
  SceneContext,
  Screenplay,
  ShotPlan,
  Stage,
  StateChange,
  Violation,
  WorkflowEvent,
  WorldState,
} from "@cinememory/core";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface Job {
  id: string;
  projectId: string;
  kind: "pipeline" | "repair" | "evaluate" | "generate" | "verify";
  status: "running" | "complete" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  detail?: string;
}

export interface ProjectSummary {
  project: Project;
  counts: {
    characters: number;
    locations: number;
    props: number;
    events: number;
    knowledgeFacts: number;
    constraints: number;
    scenes: number;
    shots: number;
    shotsByStatus: Record<string, number>;
    generated: number;
    violations: number;
    unresolved: number;
  };
  continuity: ContinuitySummary;
  screenplayVersion?: number;
  durationSec?: number;
  film: boolean;
  lastEvent?: WorkflowEvent;
}

export interface MemoryTrace {
  source: "clickhouse" | "local";
  sql?: string;
  rows: number;
  latencyMs: number;
}

export interface ProjectMemory {
  name: string;
  persistent: boolean;
  stats: Array<{ table: string; rows: number }>;
  trace: MemoryTrace;
  analytics: {
    eventsByAgent: Array<{ agent: string; count: number }>;
    violationsByCode: Array<{ code: string; status: string; count: number }>;
    repairOutcomes: Array<{ outcome: string; count: number }>;
    llmUsage: Array<{ provider: string; model: string; calls: number; avgMs: number; inputTokens: number; outputTokens: number; failures: number }>;
    knowledgeTimeline: Array<{ factId: string; characterId: string; sceneNumber: number; via: string }>;
  } | null;
  agentActions: Array<{ actionId: string; task: string; provider: string; model?: string; latencyMs: number; inputTokens?: number; outputTokens?: number; ok: boolean; error?: string; createdAt: string }>;
  retrievals: WorkflowEvent[];
}

export interface SceneMemory {
  sceneNumber: number;
  state: { changes: StateChange[]; trace: MemoryTrace };
  knowledge: { events: Array<{ factId: string; statement: string; characterId: string; sceneId: string; sceneNumber: number; via?: string }>; trace: MemoryTrace };
  history: { violations: Array<{ violationId: string; code: string; status: string; repairAttempts: number }>; trace: MemoryTrace };
  context: SceneContext | null;
}

export type ProducerStep =
  | { type: "text"; author: string; text: string; final: boolean }
  | { type: "tool_call"; author: string; name: string; args: unknown }
  | { type: "tool_result"; author: string; name: string; result: unknown };

export interface Health {
  ok: boolean;
  llm: { name: string; model: string; fixtureMode: boolean; supportsVision: boolean };
  media: { name: string; capabilities: { image: boolean; video: boolean; speech: boolean } };
  partner: string;
  memory: { name: string; persistent: boolean; url?: string; database?: string };
  dataDir: string;
  videoEnabled: boolean;
  warnings: string[];
  partnerHealth: { ok: boolean; adapter: string; detail?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError((body && (body.error as string)) || `${res.status} ${res.statusText}`, res.status, body);
  return body as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  projects: () => request<ProjectSummary[]>("/api/projects"),
  project: (id: string) => request<ProjectSummary>(`/api/projects/${id}`),
  createProject: (input: CreateProjectInput) => request<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  createDemo: () => request<ProjectSummary>("/api/projects/demo", { method: "POST" }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  run: (id: string, toStage?: Stage, force = false) => request<Job>(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({ toStage, force }) }),
  reset: (id: string, stage: Stage) => request<Project>(`/api/projects/${id}/reset`, { method: "POST", body: JSON.stringify({ stage }) }),
  verify: (id: string, critics?: string[]) => request<Job>(`/api/projects/${id}/verify`, { method: "POST", body: JSON.stringify({ critics }) }),
  job: (id: string) => request<{ current: Job | null; recent: Job[] }>(`/api/projects/${id}/job`),
  events: (id: string, after = 0) => request<WorkflowEvent[]>(`/api/projects/${id}/events?after=${after}`),
  world: (id: string) => request<WorldState | null>(`/api/projects/${id}/world`),
  changes: (id: string) => request<StateChange[]>(`/api/projects/${id}/changes`),
  adaptation: (id: string) => request<AdaptationPlan | null>(`/api/projects/${id}/adaptation`),
  screenplay: (id: string) => request<Screenplay | null>(`/api/projects/${id}/screenplay`),
  shots: (id: string) => request<ShotPlan | null>(`/api/projects/${id}/shots`),
  violations: (id: string) => request<Violation[]>(`/api/projects/${id}/violations`),
  checks: (id: string) => request<CheckRecord[]>(`/api/projects/${id}/checks`),
  continuity: (id: string) => request<ContinuitySummary>(`/api/projects/${id}/continuity`),
  film: (id: string) => request<FilmManifest | null>(`/api/projects/${id}/film`),
  evaluations: (id: string) => request<EvalComparison[]>(`/api/projects/${id}/evaluations`),
  graph: (id: string, focus?: string, depth = 1) => request<CineGraph>(`/api/projects/${id}/graph${focus ? `?focus=${encodeURIComponent(focus)}&depth=${depth}` : ""}`),
  agentStatus: () => request<{ available: boolean; reason?: string; model?: string; provider?: string; framework?: string; mcp?: string | null; memory?: string }>("/api/agent/status"),
  agentChat: (sessionId: string, message: string) => request<{ sessionId: string; steps: ProducerStep[] }>("/api/agent/chat", { method: "POST", body: JSON.stringify({ sessionId, message }) }),
  memory: (id: string) => request<ProjectMemory>(`/api/projects/${id}/memory`),
  memoryScene: (id: string, n: number) => request<SceneMemory>(`/api/projects/${id}/memory/scene/${n}`),
  memoryStatus: () => request<{ name: string; persistent: boolean; url?: string; database?: string; health: { ok: boolean; detail?: string }; tables: Array<{ table: string; rows: number }> }>("/api/memory/status"),
  references: (id: string) => request<Array<{ characterId: string; path: string; mimeType: string; prompt: string; provenance: { provider: string; model?: string; note?: string } }>>(`/api/projects/${id}/references`),
  sceneContext: (id: string, sceneId: string) => request<SceneContext | null>(`/api/projects/${id}/scenes/${sceneId}/context`),
  repair: (id: string, vid: string) => request<Job>(`/api/projects/${id}/violations/${vid}/repair`, { method: "POST" }),
  override: (id: string, vid: string, note: string) => request<Violation>(`/api/projects/${id}/violations/${vid}/override`, { method: "POST", body: JSON.stringify({ note }) }),
  generateShot: (id: string, shotId: string) => request<Job>(`/api/projects/${id}/shots/${shotId}/generate`, { method: "POST" }),
  evaluate: (id: string) => request<Job>(`/api/projects/${id}/evaluate`, { method: "POST" }),
};

export const mediaUrl = (path?: string) => (path ? `${API_URL}/media/${path}` : undefined);
