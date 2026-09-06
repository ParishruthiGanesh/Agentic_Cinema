"use client";

import { useProject } from "@/components/ProjectProvider";
import { RunControls } from "@/components/RunControls";
import { ProducerPanel } from "@/components/ProducerPanel";
import { ActivityLog } from "@/components/ActivityLog";
import { PageTitle, Pill, Section } from "@/components/ui";
import { STAGES } from "@/lib/format";

const STAGE_AGENTS: Record<string, string> = {
  source_analyzed: "Source Intelligence Agent reads the material and produces the canonical world (characters, props, locations, events, knowledge facts, constraints).",
  adapted: "Adaptation Agent decides what must stay, what is cut, compressed or merged, and produces the beat sheet — must_keep constraints are enforced deterministically.",
  screenplay_written: "Screenplay Agent writes scenes that reference the world by id and declare every state change (reveals, prop transfers, moves, emotions).",
  memory_built: "World Memory folds the screenplay into a per-scene change log so any agent can retrieve exact state for a scene.",
  shots_planned: "Director Agent breaks scenes into shots; CineMemory composes each visual prompt from retrieved state and constraints.",
  narrative_verified: "Narrative and Source Fidelity Critics run; the Repair Agent rewrites only the affected scene, re-verifies, and escalates after the retry limit.",
  media_generated: "Generation Service produces keyframes (and voice/video when the provider supports them) with full provenance.",
  visually_verified: "Visual Critic checks prompts and, with a vision model, inspects generated keyframes; media-level repairs regenerate the shot.",
  film_assembled: "Assembler builds the film manifest: segments, chapters, subtitles, and a verification summary.",
};

export default function ProductionPage() {
  const { id, summary, live } = useProject();
  const p = summary.data?.project;
  if (!p) return null;
  return (
    <div>
      <PageTitle title="Production" subtitle={p.mode === "social_story" ? "Social story: the routine is compiled verbatim (no model writes the words or plans the shots). Gemini generates the pictures, the Visual Critic inspects them against the locked identity, outfit, rooms, comfort items and forbidden list, and drift is regenerated." : "Run, resume or reset the agent pipeline. Every stage persists its output, so runs can resume after a crash and re-runs of earlier stages invalidate everything downstream."} />
      <RunControls />
      <div className="mt-4">
        <ProducerPanel projectId={id} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Section title="Stages">
          <ol className="space-y-2">
            {STAGES.filter((s) => s.id !== "created").map((s) => {
              const rec = p.stages.find((r) => r.stage === s.id);
              const dur = rec?.startedAt && rec.finishedAt ? `${((Date.parse(rec.finishedAt) - Date.parse(rec.startedAt)) / 1000).toFixed(1)}s` : undefined;
              return (
                <li key={s.id} className="rounded-md border border-ink-700/60 bg-ink-900/50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-100">{s.label}</span>
                    <span className="flex items-center gap-2">
                      {dur && <span className="text-[11px] text-ink-400">{dur}</span>}
                      <Pill value={rec?.status ?? "pending"} />
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-400">{STAGE_AGENTS[s.id]}</div>
                  {rec?.error && <div className="mt-1 text-xs text-rose-glow">{rec.error}</div>}
                </li>
              );
            })}
          </ol>
        </Section>
        <Section title="Agent activity" aside={<span className="text-xs text-ink-400">{live.connected ? "live stream" : "polling"} · {live.events.length} events · click an event for its payload</span>}>
          <ActivityLog events={live.events} height="h-[720px]" />
        </Section>
      </div>
    </div>
  );
}
