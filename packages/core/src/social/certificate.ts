import type { AgentContext } from "../agents/context.js";
import type { CheckRecord, MediaAsset, Project, Violation, VisualConstraint } from "../model/index.js";
import { wordsUnchanged } from "./compile.js";

export type CertificateStatus = "verified" | "issues" | "incomplete";
export type CheckCategory = "identity" | "outfit" | "setting" | "comfort_items" | "forbidden" | "style";

export interface CategoryOutcome {
  pass: number;
  fail: number;
  notEvaluated: number;
  /** "pass" when every evaluated media check passed and at least one ran; "fail" on any failure; "not_evaluated" when nothing ran. */
  state: "pass" | "fail" | "not_evaluated" | "n/a";
}

export interface CertificateStep {
  number: number;
  title: string;
  text: string;
  sceneId: string;
  settingName: string;
  present: string[];
  shotIds: string[];
  keyframe?: MediaAsset;
  keyframeVersions: number;
  realFrame: boolean;
  categories: Record<CheckCategory, CategoryOutcome>;
  violations: Array<{ id: string; code: string; status: string; observed: string; attempts: number; resolvedAt?: string }>;
  verified: boolean;
}

export interface ContinuityCertificate {
  projectId: string;
  title: string;
  child: string;
  situation: string;
  authoredBy?: string;
  status: CertificateStatus;
  reasons: string[];
  generatedAt: string;
  wordsUnchanged: boolean;
  sequence: { ordered: boolean; evidence: string };
  steps: CertificateStep[];
  totals: { checksEvaluated: number; checksPassed: number; notEvaluated: number; violations: number; repaired: number; unresolved: number; regenerations: number };
  media: { keyframes: number; realFrames: number; placeholderFrames: number; references: Array<{ characterId: string; name: string; provider: string; model?: string }> };
  memory: { name: string; persistent: boolean; rows?: number };
  approval?: Project["approval"];
  approvalValid: boolean;
  versions: { screenplay?: number; shotPlan?: number };
}

const EMPTY = (): CategoryOutcome => ({ pass: 0, fail: 0, notEvaluated: 0, state: "n/a" });

export function categoryOf(vc: VisualConstraint | undefined, childId: string): CheckCategory | undefined {
  if (!vc) return undefined;
  if (vc.attribute.startsWith("must_not_show")) return "forbidden";
  if (vc.entityType === "style") return "style";
  if (vc.entityType === "location") return "setting";
  if (vc.entityType === "prop") return "comfort_items";
  if (vc.attribute === "outfit") return "outfit";
  void childId;
  return "identity";
}

function finish(o: CategoryOutcome): CategoryOutcome {
  const state = o.fail ? "fail" : o.pass ? "pass" : o.notEvaluated ? "not_evaluated" : "n/a";
  return { ...o, state };
}

/**
 * Continuity Certificate for a social story: per step, what was verified against the child's canonical identity,
 * outfit, setting, comfort items and the must-not-show list; what drifted and how it was repaired; whether the words
 * and the order are untouched; and whether a human has signed it off. Everything is computed from persisted records.
 */
export async function buildContinuityCertificate(ctx: AgentContext, projectId: string): Promise<ContinuityCertificate> {
  const { repo } = ctx;
  const project = repo.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const brief = project.socialStory;
  if (!brief) throw new Error("Continuity certificates are produced for social-story projects only");
  const world = repo.getWorld(projectId);
  const screenplay = repo.getScreenplay(projectId);
  const plan = repo.getShotPlan(projectId);
  const checks = repo.listChecks(projectId);
  const violations = repo.listViolations(projectId);
  const refs = repo.store.list<{ characterId: string; provenance: { provider: string; model?: string } }>("character_refs", projectId);
  const child = world?.characters.find((c) => c.role === "protagonist")?.id ?? "";
  const vcById = new Map((world?.visualConstraints ?? []).map((v) => [v.id, v]));
  const reasons: string[] = [];

  const steps: CertificateStep[] = brief.steps.map((s, i) => {
    const scene = screenplay?.scenes.find((sc) => sc.number === i + 1);
    const shots = (plan?.shots ?? []).filter((sh) => sh.sceneId === scene?.id);
    const shotIds = shots.map((sh) => sh.id);
    const keyframe = shots.find((sh) => sh.keyframe)?.keyframe;
    const realFrame = !!keyframe && keyframe.provenance.provider !== "placeholder";
    const categories: Record<CheckCategory, CategoryOutcome> = { identity: EMPTY(), outfit: EMPTY(), setting: EMPTY(), comfort_items: EMPTY(), forbidden: EMPTY(), style: EMPTY() };
    // Media-level checks only (prompt-level checks prove the prompt, not the picture).
    for (const c of checks.filter((ck: CheckRecord) => ck.critic === "visual" && ck.scope.shotId && shotIds.includes(ck.scope.shotId) && ck.code !== "PROMPT_MISSING_CONSTRAINT")) {
      const cat = categoryOf(vcById.get(c.constraintId ?? ""), child);
      if (!cat) continue;
      if (c.outcome === "pass") categories[cat].pass += 1;
      else if (c.outcome === "fail") categories[cat].fail += 1;
      else categories[cat].notEvaluated += 1;
    }
    for (const k of Object.keys(categories) as CheckCategory[]) categories[k] = finish(categories[k]);
    const vs = violations.filter((v: Violation) => v.critic === "visual" && v.scope.shotId && shotIds.includes(v.scope.shotId));
    const open = vs.some((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated");
    const evaluated = Object.values(categories).some((c) => c.state === "pass" || c.state === "fail");
    const anyFail = Object.values(categories).some((c) => c.state === "fail");
    return {
      number: i + 1,
      title: s.title,
      text: s.text,
      sceneId: scene?.id ?? `scene_${i + 1}`,
      settingName: brief.settings.find((x) => x.id === s.settingId)?.name ?? s.settingId,
      present: [brief.child.name, ...s.companionIds.map((c) => brief.companions.find((x) => x.id === c)?.name ?? c)],
      shotIds,
      keyframe,
      keyframeVersions: shots.reduce((a, sh) => a + sh.generationAttempts, 0),
      realFrame,
      categories,
      violations: vs.map((v) => ({ id: v.id, code: v.code, status: v.status, observed: v.observed, attempts: v.repairAttempts.length, resolvedAt: v.resolvedAt })),
      verified: realFrame && evaluated && !anyFail && !open,
    };
  });

  // Sequence: every step's event is dramatised in its own scene, in order (from the narrative critic's records + the screenplay).
  const orderOk = !!screenplay && brief.steps.every((_, i) => screenplay.scenes.find((sc) => sc.number === i + 1)?.eventIds.includes(`step_${i + 1}`));
  const chronology = checks.filter((c) => c.critic === "narrative" && (c.code === "CHRONOLOGY_VIOLATION" || c.code === "CAUSAL_DEPENDENCY_VIOLATION"));
  const chronologyFail = chronology.some((c) => c.outcome === "fail");
  const sequence = { ordered: orderOk && !chronologyFail, evidence: screenplay ? `${brief.steps.length} steps → ${screenplay.scenes.length} scenes; ${chronology.length} order checks by the Narrative Critic, ${chronology.filter((c) => c.outcome === "pass").length} passed` : "no screenplay yet" };

  const words = !!screenplay && wordsUnchanged(brief, screenplay);
  const evaluatedChecks = checks.filter((c) => c.outcome !== "not_evaluated");
  const unresolved = violations.filter((v) => v.status === "open" || v.status === "repairing" || v.status === "escalated").length;
  const regenerations = (plan?.shots ?? []).reduce((a, s) => a + Math.max(0, s.generationAttempts - 1), 0);

  if (!screenplay) reasons.push("The routine has not been compiled yet.");
  if (screenplay && !words) reasons.push("The screenplay no longer contains the authored words verbatim.");
  if (!sequence.ordered) reasons.push("Step order could not be confirmed.");
  const missing = steps.filter((s) => !s.keyframe).length;
  if (missing) reasons.push(`${missing} step${missing === 1 ? " has" : "s have"} no picture yet.`);
  const placeholders = steps.filter((s) => s.keyframe && !s.realFrame).length;
  if (placeholders) reasons.push(`${placeholders} picture${placeholders === 1 ? " is" : "s are"} development placeholders, not generated images.`);
  const uninspected = steps.filter((s) => s.realFrame && !Object.values(s.categories).some((c) => c.state === "pass" || c.state === "fail")).length;
  if (uninspected) reasons.push(`${uninspected} picture${uninspected === 1 ? " has" : "s have"} not been inspected by the Visual Critic.`);
  if (unresolved) reasons.push(`${unresolved} violation${unresolved === 1 ? "" : "s"} unresolved.`);
  const failing = steps.filter((s) => Object.values(s.categories).some((c) => c.state === "fail")).length;
  if (failing) reasons.push(`${failing} step${failing === 1 ? "" : "s"} failed a visual check.`);

  let status: CertificateStatus = "verified";
  if (unresolved || failing || (screenplay && !words) || (screenplay && !sequence.ordered)) status = "issues";
  else if (!screenplay || missing || placeholders || uninspected) status = "incomplete";

  const stats = await ctx.memory.stats(projectId).catch(() => undefined);
  const approval = project.approval;
  const approvalValid = !!approval && approval.screenplayVersion === screenplay?.version && approval.shotPlanVersion === plan?.version && status === "verified";

  return {
    projectId,
    title: project.title,
    child: brief.child.name,
    situation: brief.situation,
    authoredBy: brief.authoredBy,
    status,
    reasons,
    generatedAt: new Date().toISOString(),
    wordsUnchanged: words,
    sequence,
    steps,
    totals: { checksEvaluated: evaluatedChecks.length, checksPassed: evaluatedChecks.filter((c) => c.passed).length, notEvaluated: checks.length - evaluatedChecks.length, violations: violations.length, repaired: violations.filter((v) => v.status === "resolved").length, unresolved, regenerations },
    media: { keyframes: steps.filter((s) => s.keyframe).length, realFrames: steps.filter((s) => s.realFrame).length, placeholderFrames: placeholders, references: refs.map((r) => ({ characterId: r.characterId, name: world?.characters.find((c) => c.id === r.characterId)?.name ?? r.characterId, provider: r.provenance.provider, model: r.provenance.model })) },
    memory: { name: ctx.memory.name, persistent: ctx.memory.persistent, rows: stats?.tables.reduce((a, t) => a + t.rows, 0) },
    approval,
    approvalValid,
    versions: { screenplay: screenplay?.version, shotPlan: plan?.version },
  };
}

export class ApprovalBlockedError extends Error {
  constructor(
    message: string,
    public readonly certificate: ContinuityCertificate,
  ) {
    super(message);
    this.name = "ApprovalBlockedError";
  }
}

/** Record a human sign-off. Blocked unless the certificate is "verified" (or the adult explicitly overrides with a note). */
export async function approveSocialStory(ctx: AgentContext, projectId: string, input: { approvedBy: string; note?: string; force?: boolean }): Promise<{ project: Project; certificate: ContinuityCertificate }> {
  const cert = await buildContinuityCertificate(ctx, projectId);
  if (cert.status !== "verified" && !input.force) throw new ApprovalBlockedError(`Cannot approve: certificate status is "${cert.status}" (${cert.reasons.join(" ")})`, cert);
  const project = ctx.repo.getProject(projectId)!;
  const approval: NonNullable<Project["approval"]> = { approvedBy: input.approvedBy, note: input.note, approvedAt: new Date().toISOString(), certificateStatus: cert.status, screenplayVersion: cert.versions.screenplay, shotPlanVersion: cert.versions.shotPlan };
  const updated = { ...project, approval };
  ctx.repo.saveProject(updated);
  ctx.events.emit(projectId, "user", "social_story.approved", `${input.approvedBy} approved the social story${input.force && cert.status !== "verified" ? ` despite certificate status "${cert.status}"` : ""}${input.note ? `: ${input.note}` : ""}`, { approval, certificateStatus: cert.status, force: !!input.force }, input.force && cert.status !== "verified" ? "warn" : "success");
  return { project: updated, certificate: { ...cert, approval, approvalValid: cert.status === "verified" } };
}

export function revokeApproval(ctx: AgentContext, projectId: string): Project {
  const project = ctx.repo.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const updated = { ...project, approval: undefined };
  ctx.repo.saveProject(updated);
  ctx.events.emit(projectId, "user", "social_story.approval_revoked", "Approval revoked", {}, "warn");
  return updated;
}
