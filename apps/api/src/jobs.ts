import type { AgentContext } from "@cinememory/core";

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

/**
 * In-process job runner: one running job per project. Long agent workflows run here while the API
 * stays responsive; state is persisted by the agents themselves, so a crash mid-run is resumable.
 */
export class JobRunner {
  private jobs = new Map<string, Job>();
  private history: Job[] = [];
  private seq = 0;

  constructor(private ctx: AgentContext) {}

  current(projectId: string): Job | undefined {
    return this.jobs.get(projectId);
  }

  recent(projectId: string, limit = 10): Job[] {
    return this.history.filter((j) => j.projectId === projectId).slice(-limit).reverse();
  }

  start(projectId: string, kind: Job["kind"], detail: string, work: () => Promise<void>): Job {
    const running = this.jobs.get(projectId);
    if (running) throw new JobBusyError(running);
    this.seq += 1;
    const job: Job = { id: `job_${Date.now().toString(36)}_${this.seq}`, projectId, kind, status: "running", startedAt: new Date().toISOString(), detail };
    this.jobs.set(projectId, job);
    void work()
      .then(() => {
        job.status = "complete";
      })
      .catch((err: unknown) => {
        job.status = "failed";
        job.error = (err as Error).message ?? String(err);
        this.ctx.events.emit(projectId, "orchestrator", "job.failed", `${kind} job failed: ${job.error}`, { jobId: job.id }, "error");
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        this.jobs.delete(projectId);
        this.history.push(job);
        if (this.history.length > 200) this.history.shift();
      });
    return job;
  }
}

export class JobBusyError extends Error {
  constructor(public readonly job: Job) {
    super(`A ${job.kind} job is already running for this project`);
    this.name = "JobBusyError";
  }
}
