import type { Stage } from "@cinememory/core";

export const STAGES: Array<{ id: Stage; label: string; short: string }> = [
  { id: "created", label: "Created", short: "Create" },
  { id: "source_analyzed", label: "Source analyzed", short: "Understand" },
  { id: "adapted", label: "Adapted", short: "Adapt" },
  { id: "screenplay_written", label: "Screenplay written", short: "Write" },
  { id: "memory_built", label: "Memory built", short: "Remember" },
  { id: "shots_planned", label: "Shots planned", short: "Plan" },
  { id: "narrative_verified", label: "Narrative verified", short: "Verify" },
  { id: "media_generated", label: "Media generated", short: "Generate" },
  { id: "visually_verified", label: "Visually verified", short: "Inspect" },
  { id: "film_assembled", label: "Film assembled", short: "Assemble" },
];

export const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.id === s);

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  return `${Math.round(v * 100)}%`;
}

export function secs(v: number | undefined): string {
  if (v === undefined) return "–";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export function clock(iso: string): string {
  return iso.slice(11, 19);
}

export const SEVERITY_COLOR: Record<string, string> = {
  critical: "border-rose-glow/60 text-rose-glow",
  high: "border-rose-glow/40 text-rose-glow",
  medium: "border-amber-glow/50 text-amber-glow",
  low: "border-ink-400/60 text-ink-300",
};

export const STATUS_COLOR: Record<string, string> = {
  open: "border-rose-glow/50 text-rose-glow",
  repairing: "border-amber-glow/60 text-amber-glow",
  resolved: "border-lime-glow/50 text-lime-glow",
  escalated: "border-violet-glow/60 text-violet-glow",
  overridden: "border-ink-400 text-ink-300",
  PLANNED: "border-ink-400 text-ink-300",
  GENERATING: "border-amber-glow/60 text-amber-glow",
  VERIFYING: "border-teal-glow/60 text-teal-glow",
  FAILED: "border-rose-glow/60 text-rose-glow",
  REPAIRING: "border-violet-glow/60 text-violet-glow",
  VERIFIED: "border-lime-glow/60 text-lime-glow",
  complete: "border-lime-glow/50 text-lime-glow",
  running: "border-amber-glow/60 text-amber-glow",
  failed: "border-rose-glow/60 text-rose-glow",
  pending: "border-ink-600 text-ink-400",
};

export const AGENT_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator",
  source_intelligence: "Source Intelligence",
  adaptation: "Adaptation",
  screenplay: "Screenplay",
  world_memory: "World Memory",
  director: "Director",
  generation: "Generation",
  visual_critic: "Visual Critic",
  narrative_critic: "Narrative Critic",
  source_fidelity_critic: "Source Fidelity Critic",
  repair: "Repair",
  film_assembler: "Film Assembler",
  evaluation: "Evaluation",
  user: "You",
};

export const AGENT_COLOR: Record<string, string> = {
  orchestrator: "text-ink-300",
  source_intelligence: "text-teal-glow",
  adaptation: "text-teal-glow",
  screenplay: "text-teal-glow",
  world_memory: "text-amber-glow",
  director: "text-violet-glow",
  generation: "text-violet-glow",
  visual_critic: "text-rose-glow",
  narrative_critic: "text-rose-glow",
  source_fidelity_critic: "text-rose-glow",
  repair: "text-lime-glow",
  film_assembler: "text-violet-glow",
  evaluation: "text-amber-glow",
  user: "text-ink-100",
};

export function providerLabel(provider?: string, model?: string): string {
  if (!provider) return "unknown";
  if (provider === "fixture") return "development fixture (not a model)";
  if (provider === "placeholder") return "development placeholder (not a model)";
  if (provider === "deterministic") return "deterministic rule engine";
  return model ? `${provider} · ${model}` : provider;
}
