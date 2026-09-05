import type { CheckRecord, CriticName, Provenance, Violation, ViolationCode } from "../model/index.js";
import { shortHash } from "../util/hash.js";

export const DETERMINISTIC: Omit<Provenance, "createdAt" | "task"> = { provider: "deterministic", model: "rule-engine" };

export interface CriticResult {
  critic: CriticName;
  checks: CheckRecord[];
  violations: Violation[];
  runId: string;
  provenance: Provenance;
}

export interface CheckDraft {
  constraintId?: string;
  code?: ViolationCode;
  description: string;
  outcome: "pass" | "fail" | "not_evaluated";
  scope: Violation["scope"];
}

export interface ViolationDraft {
  code: ViolationCode;
  constraintId?: string;
  constraint: string;
  expected: string;
  observed: string;
  severity: Violation["severity"];
  confidence: number;
  evidence: string;
  scope: Violation["scope"];
  provenance?: Provenance;
}

/** Collects checks and violations for one critic run with stable ids/fingerprints. */
export class CriticCollector {
  readonly checks: CheckRecord[] = [];
  readonly violations: Violation[] = [];
  readonly runId: string;
  private n = 0;
  constructor(
    readonly projectId: string,
    readonly critic: CriticName,
    private readonly defaultProvenance: Provenance,
  ) {
    this.runId = `run_${critic}_${Date.now().toString(36)}`;
  }

  check(d: CheckDraft): void {
    this.n += 1;
    this.checks.push({
      id: `chk_${this.critic}_${this.n}_${shortHash(d.description + JSON.stringify(d.scope), 8)}`,
      projectId: this.projectId,
      critic: this.critic,
      constraintId: d.constraintId,
      code: d.code,
      description: d.description,
      passed: d.outcome === "pass",
      outcome: d.outcome,
      scope: { ...d.scope, entityIds: d.scope.entityIds ?? [] },
      runId: this.runId,
      createdAt: new Date().toISOString(),
    });
  }

  violation(v: ViolationDraft): Violation {
    const fingerprint = shortHash([v.code, v.constraintId ?? "", v.scope.sceneId ?? "", v.scope.shotId ?? "", v.scope.lineIndex ?? "", v.expected].join("|"), 16);
    const violation: Violation = {
      id: `vio_${fingerprint}`,
      projectId: this.projectId,
      code: v.code,
      critic: this.critic,
      constraintId: v.constraintId,
      constraint: v.constraint,
      expected: v.expected,
      observed: v.observed,
      severity: v.severity,
      confidence: v.confidence,
      evidence: v.evidence,
      scope: { ...v.scope, entityIds: v.scope.entityIds ?? [] },
      status: "open",
      repairAttempts: [],
      fingerprint,
      detectedAt: new Date().toISOString(),
      provenance: v.provenance ?? this.defaultProvenance,
    };
    this.violations.push(violation);
    this.check({ constraintId: v.constraintId, code: v.code, description: v.constraint, outcome: "fail", scope: v.scope });
    return violation;
  }

  pass(constraintId: string | undefined, description: string, scope: Violation["scope"], code?: ViolationCode): void {
    this.check({ constraintId, code, description, outcome: "pass", scope });
  }

  notEvaluated(constraintId: string | undefined, description: string, scope: Violation["scope"], code?: ViolationCode): void {
    this.check({ constraintId, code, description, outcome: "not_evaluated", scope });
  }

  result(provenance: Provenance): CriticResult {
    return { critic: this.critic, checks: this.checks, violations: this.violations, runId: this.runId, provenance };
  }
}
