import type { DocumentStore } from "./documentStore.js";
import {
  AdaptationPlan,
  CheckRecord,
  CriticRun,
  EvalComparison,
  FilmManifest,
  Project,
  Screenplay,
  ShotPlan,
  StateChange,
  Violation,
  WorkflowEvent,
  WorldState,
} from "../model/index.js";

/** Collection names are the single place to change if a partner store needs different naming. */
export const COLLECTIONS = {
  projects: "projects",
  world: "world",
  stateChanges: "state_changes",
  adaptation: "adaptation",
  screenplay: "screenplay",
  shots: "shots",
  violations: "violations",
  checks: "checks",
  criticRuns: "critic_runs",
  evaluations: "evaluations",
  film: "film",
} as const;

const SINGLETON = "current";

/**
 * Typed repository over the document store. Every read validates with zod so corrupted or
 * hand-edited data fails loudly instead of propagating into agents.
 */
export class Repository {
  constructor(public readonly store: DocumentStore) {}

  /* projects */
  listProjects(): Project[] {
    return this.store
      .listAll<Project>(COLLECTIONS.projects)
      .map((d) => Project.parse(d.data))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  getProject(id: string): Project | undefined {
    const raw = this.store.get<Project>(COLLECTIONS.projects, id, SINGLETON);
    return raw ? Project.parse(raw) : undefined;
  }
  saveProject(p: Project): void {
    this.store.put(COLLECTIONS.projects, p.id, SINGLETON, Project.parse({ ...p, updatedAt: new Date().toISOString() }));
  }
  deleteProject(id: string): void {
    this.store.deleteProject(id);
  }

  /* world memory */
  getWorld(projectId: string): WorldState | undefined {
    const raw = this.store.get<WorldState>(COLLECTIONS.world, projectId, SINGLETON);
    return raw ? WorldState.parse(raw) : undefined;
  }
  saveWorld(w: WorldState): void {
    this.store.put(
      COLLECTIONS.world,
      w.projectId,
      SINGLETON,
      WorldState.parse({ ...w, updatedAt: new Date().toISOString() }),
    );
  }
  listStateChanges(projectId: string): StateChange[] {
    return this.store
      .list<StateChange>(COLLECTIONS.stateChanges, projectId)
      .map((c) => StateChange.parse(c))
      .sort((a, b) => a.sceneNumber - b.sceneNumber || a.id.localeCompare(b.id));
  }
  replaceStateChanges(projectId: string, changes: StateChange[]): void {
    this.store.deleteCollection(COLLECTIONS.stateChanges, projectId);
    this.store.putMany(
      COLLECTIONS.stateChanges,
      projectId,
      changes.map((c) => ({ id: c.id, data: StateChange.parse(c) })),
    );
  }

  /* adaptation / screenplay / shots */
  getAdaptation(projectId: string): AdaptationPlan | undefined {
    const raw = this.store.get<AdaptationPlan>(COLLECTIONS.adaptation, projectId, SINGLETON);
    return raw ? AdaptationPlan.parse(raw) : undefined;
  }
  saveAdaptation(a: AdaptationPlan): void {
    this.store.put(COLLECTIONS.adaptation, a.projectId, SINGLETON, AdaptationPlan.parse(a));
  }
  getScreenplay(projectId: string): Screenplay | undefined {
    const raw = this.store.get<Screenplay>(COLLECTIONS.screenplay, projectId, SINGLETON);
    return raw ? Screenplay.parse(raw) : undefined;
  }
  saveScreenplay(s: Screenplay): void {
    this.store.put(COLLECTIONS.screenplay, s.projectId, SINGLETON, Screenplay.parse(s));
  }
  getShotPlan(projectId: string): ShotPlan | undefined {
    const raw = this.store.get<ShotPlan>(COLLECTIONS.shots, projectId, SINGLETON);
    return raw ? ShotPlan.parse(raw) : undefined;
  }
  saveShotPlan(s: ShotPlan): void {
    this.store.put(
      COLLECTIONS.shots,
      s.projectId,
      SINGLETON,
      ShotPlan.parse({ ...s, updatedAt: new Date().toISOString() }),
    );
  }

  /* verification */
  listViolations(projectId: string): Violation[] {
    return this.store
      .list<Violation>(COLLECTIONS.violations, projectId)
      .map((v) => Violation.parse(v))
      .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt) || a.id.localeCompare(b.id));
  }
  getViolation(projectId: string, id: string): Violation | undefined {
    const raw = this.store.get<Violation>(COLLECTIONS.violations, projectId, id);
    return raw ? Violation.parse(raw) : undefined;
  }
  saveViolation(v: Violation): void {
    this.store.put(COLLECTIONS.violations, v.projectId, v.id, Violation.parse(v));
  }
  deleteViolations(projectId: string): void {
    this.store.deleteCollection(COLLECTIONS.violations, projectId);
  }
  listChecks(projectId: string): CheckRecord[] {
    return this.store.list<CheckRecord>(COLLECTIONS.checks, projectId).map((c) => CheckRecord.parse(c));
  }
  /** Replaces all checks for a critic with the latest run's checks (checks are a snapshot, violations are stateful). */
  replaceChecksForCritic(projectId: string, critic: string, checks: CheckRecord[]): void {
    const others = this.listChecks(projectId).filter((c) => c.critic !== critic);
    this.store.deleteCollection(COLLECTIONS.checks, projectId);
    this.store.putMany(
      COLLECTIONS.checks,
      projectId,
      [...others, ...checks].map((c) => ({ id: c.id, data: CheckRecord.parse(c) })),
    );
  }
  listCriticRuns(projectId: string): CriticRun[] {
    return this.store
      .list<CriticRun>(COLLECTIONS.criticRuns, projectId)
      .map((r) => CriticRun.parse(r))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  saveCriticRun(r: CriticRun): void {
    this.store.put(COLLECTIONS.criticRuns, r.projectId, r.id, CriticRun.parse(r));
  }

  /* events */
  appendEvent(event: Omit<WorkflowEvent, "seq">): WorkflowEvent {
    const seq = this.store.appendEvent(event.projectId, event);
    return WorkflowEvent.parse({ ...event, seq });
  }
  listEvents(projectId: string, afterSeq = 0, limit = 2000): WorkflowEvent[] {
    return this.store.listEvents(projectId, afterSeq, limit).map((e) => WorkflowEvent.parse(e));
  }

  /* evaluation + film */
  listEvaluations(projectId: string): EvalComparison[] {
    return this.store
      .list<EvalComparison>(COLLECTIONS.evaluations, projectId)
      .map((e) => EvalComparison.parse(e))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  saveEvaluation(e: EvalComparison): void {
    this.store.put(COLLECTIONS.evaluations, e.projectId, e.id, EvalComparison.parse(e));
  }
  getFilm(projectId: string): FilmManifest | undefined {
    const raw = this.store.get<FilmManifest>(COLLECTIONS.film, projectId, SINGLETON);
    return raw ? FilmManifest.parse(raw) : undefined;
  }
  saveFilm(f: FilmManifest): void {
    this.store.put(COLLECTIONS.film, f.projectId, SINGLETON, FilmManifest.parse(f));
  }
}
