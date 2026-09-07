import type { Project } from "../model/index.js";

export type StoryStatusCode = "writing" | "drawing" | "checking" | "needs_approval" | "approved" | "failed" | "not_started";

/** Plain-words status for families and therapists; the studio keeps the stage names. */
export function storyStatus(project: Project, opts: { running?: boolean; jobError?: string } = {}): { code: StoryStatusCode; label: string; detail: string } {
  const failed = project.stages.find((s) => s.status === "failed");
  if (failed && !opts.running) return { code: "failed", label: "Something went wrong", detail: failed.error ?? opts.jobError ?? "Try again, or contact support." };
  if (project.approval) return { code: "approved", label: "Ready to watch", detail: `Approved by ${project.approval.approvedBy}` };
  const stage = project.stage;
  if (stage === "film_assembled") return { code: "needs_approval", label: "Waiting for your approval", detail: "Look at every picture, then approve." };
  if (opts.running || stage === "visually_verified" || stage === "media_generated") {
    if (stage === "media_generated" || stage === "visually_verified") return { code: "checking", label: "Checking every picture", detail: "Each picture is compared with your child's look, outfit and the must-not-show list." };
    if (stage === "narrative_verified" || stage === "shots_planned") return { code: "drawing", label: "Drawing the pictures", detail: "One picture per step, plus the voice." };
    return { code: "writing", label: "Getting the story ready", detail: "Locking the words, the order and what must stay the same." };
  }
  if (stage === "created") return { code: "not_started", label: "Not started", detail: "The story has not been made yet." };
  return { code: "drawing", label: "Paused", detail: "The story stopped part-way; open it to continue." };
}
