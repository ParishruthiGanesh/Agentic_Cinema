"use client";

import Link from "next/link";
import { useState } from "react";
import type { ContinuityCertificate, StoryOutcomeInput } from "@cinememory/core";
import { useProject } from "@/components/ProjectProvider";
import { Empty, PageTitle, Pill, Provenance, Section, Spinner, Stat } from "@/components/ui";
import { api, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";

const CATEGORY_LABEL: Record<string, string> = { identity: "Identity", outfit: "Outfit", setting: "Setting", comfort_items: "Comfort items", forbidden: "Nothing forbidden", style: "Style" };
const STATE_STYLE: Record<string, string> = { pass: "border-lime-glow/60 text-lime-glow", fail: "border-rose-glow/60 text-rose-glow", not_evaluated: "border-amber-glow/50 text-amber-glow", "n/a": "border-ink-700 text-ink-500" };
const STATUS_STYLE: Record<string, string> = { verified: "border-lime-glow/60 bg-lime-glow/10 text-lime-glow", issues: "border-rose-glow/60 bg-rose-glow/10 text-rose-glow", incomplete: "border-amber-glow/60 bg-amber-glow/10 text-amber-glow" };

/**
 * Continuity Certificate: the human-readable proof a therapist or parent reviews before a social story is shown to
 * the child. Every row is computed from persisted checks, violations, repair attempts and media provenance.
 */
export default function CertificatePage() {
  const { id, summary, live } = useProject();
  const cert = useResource(() => api.certificate(id), [id, live.tick]);
  const [approver, setApprover] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<StoryOutcomeInput>({ recordedBy: "", timesWatched: 1, visitOutcome: "went_well", notes: "", stepNotes: [] });
  const p = summary.data?.project;
  if (p && p.mode !== "social_story") return <Empty title="Certificates are for social stories" hint="This project is a film project. Open the Continuity Command Center for its verification record." action={<Link href={`/projects/${id}/continuity`} className="btn-primary">Continuity</Link>} />;
  if (cert.error && !cert.data) return <div className="text-sm text-rose-glow">{cert.error}</div>;
  const c = cert.data;
  if (!c) return <div className="text-sm text-ink-400">Loading…</div>;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await Promise.all([cert.refresh(), summary.refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="Continuity Certificate"
        subtitle={<>{c.child}: {c.situation}{c.authoredBy ? ` · written by ${c.authoredBy}` : ""} · generated {c.generatedAt.slice(0, 19).replace("T", " ")}</>}
        actions={
          <>
            <a className="btn-ghost !py-1 !text-xs" href={api.bookletUrl(id)} target="_blank" rel="noreferrer">Booklet PDF</a>
            <Link className="btn-ghost !py-1 !text-xs" href={`/watch/${id}${c.approvalValid ? "" : "?preview=1"}`}>{c.approvalValid ? "Open child player" : "Preview child player"}</Link>
            {c.childId && <Link className="btn-ghost !py-1 !text-xs" href={`/children/${c.childId}`}>Child profile</Link>}
            <span className={`rounded-lg border px-3 py-1.5 text-sm font-semibold uppercase tracking-wide ${STATUS_STYLE[c.status]}`}>{c.status}</span>
          </>
        }
      />
      {c.reasons.length > 0 && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${c.status === "issues" ? "border-rose-glow/40 bg-rose-glow/5 text-rose-glow" : "border-amber-glow/40 bg-amber-glow/5 text-amber-soft"}`}>
          <div className="font-semibold">{c.status === "issues" ? "Not ready: problems found" : "Not ready yet"}</div>
          <ul className="ml-4 list-disc">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Words unchanged" value={c.wordsUnchanged ? "yes" : "no"} hint="every step appears verbatim" tone={c.wordsUnchanged ? "good" : "bad"} />
        <Stat label="Order kept" value={c.sequence.ordered ? "yes" : "no"} hint={c.sequence.evidence} tone={c.sequence.ordered ? "good" : "bad"} />
        <Stat label="Pictures" value={`${c.media.realFrames}/${c.steps.length}`} hint={c.media.placeholderFrames ? `${c.media.placeholderFrames} placeholders` : "generated frames"} tone={c.media.realFrames === c.steps.length ? "good" : "warn"} />
        <Stat label="Checks" value={`${c.totals.checksPassed}/${c.totals.checksEvaluated}`} hint={`${c.totals.notEvaluated} not evaluated`} tone={c.totals.checksEvaluated && c.totals.checksPassed === c.totals.checksEvaluated ? "good" : "neutral"} />
        <Stat label="Drift repaired" value={`${c.totals.repaired}/${c.totals.violations}`} hint={`${c.totals.regenerations} regenerations`} tone={c.totals.unresolved ? "bad" : "good"} />
        <Stat label="Memory" value={<span className="text-base">{c.memory.name === "clickhouse" ? "ClickHouse" : "local"}</span>} hint={c.memory.rows !== undefined ? `${c.memory.rows.toLocaleString()} rows recorded` : c.memory.persistent ? "persistent" : "not persistent"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Section title={`Steps (${c.steps.length})`} aside={<span className="text-xs text-ink-400">media-level checks only; prompt-level checks are not counted here</span>}>
          <ol className="space-y-3">
            {c.steps.map((s) => (
              <li key={s.number} className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[168px_1fr] ${s.verified ? "border-lime-glow/30" : "border-ink-700/60"}`}>
                <div className="relative aspect-video overflow-hidden rounded bg-ink-950">
                  {s.keyframe ? <img src={mediaUrl(s.keyframe.path)} alt={s.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-ink-500">no picture</div>}
                  {s.keyframe && <div className="absolute bottom-1 left-1"><Provenance p={s.keyframe.provenance} /></div>}
                  {s.keyframeVersions > 1 && <div className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-amber-glow">v{s.keyframeVersions} · regenerated</div>}
                </div>
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-100">{s.number}. {s.title}</span>
                    <span className="text-xs text-ink-400">{s.settingName} · {s.present.join(", ")}</span>
                    {s.verified ? <Pill value="verified" className="border-lime-glow/60 text-lime-glow" /> : <Pill value={s.realFrame ? "checking" : s.keyframe ? "placeholder" : "pending"} className="border-ink-600 text-ink-300" />}
                  </div>
                  <div className="mt-1 text-[13px] italic text-ink-200">“{s.text}”</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(s.categories).map(([k, v]) => (
                      <span key={k} title={`${v.pass} pass · ${v.fail} fail · ${v.notEvaluated} not evaluated`} className={`pill !normal-case !tracking-normal ${STATE_STYLE[v.state]}`}>
                        {CATEGORY_LABEL[k]} {v.state === "pass" ? "✓" : v.state === "fail" ? "✗" : v.state === "not_evaluated" ? "?" : "–"}
                      </span>
                    ))}
                  </div>
                  {s.violations.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {s.violations.map((v) => (
                        <li key={v.id} className="rounded bg-ink-900/70 px-2 py-1">
                          <span className="font-mono font-semibold text-ink-100">{v.code}</span> <Pill value={v.status} /> <span className="text-ink-400">{v.attempts} repair attempt{v.attempts === 1 ? "" : "s"}</span>
                          <div className="text-ink-300">{v.observed}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <div className="space-y-4">
          <Section title="Sign-off">
            {c.approval ? (
              <div className="space-y-2 text-sm">
                <div className={`rounded border px-3 py-2 ${c.approvalValid ? "border-lime-glow/40 bg-lime-glow/5 text-lime-glow" : "border-amber-glow/40 bg-amber-glow/5 text-amber-soft"}`}>
                  <div className="font-semibold">Approved by {c.approval.approvedBy}</div>
                  <div className="text-xs">{c.approval.approvedAt.slice(0, 19).replace("T", " ")} · certificate was “{c.approval.certificateStatus}”{c.approval.note ? ` · ${c.approval.note}` : ""}</div>
                  {!c.approvalValid && <div className="mt-1 text-xs">This approval no longer matches the current pictures or certificate status. Review and approve again before sharing.</div>}
                </div>
                <button className="btn-danger !py-1 !text-xs" disabled={busy} onClick={() => act(() => api.revokeApproval(id))}>Revoke approval</button>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-xs text-ink-400">The film should be shown to the child only after the person who knows them reviews every picture and signs here. Approval is stored with the certificate status and picture versions.</p>
                <input className="input" placeholder="Your name and role" value={approver} onChange={(e) => setApprover(e.target.value)} />
                <input className="input" placeholder="Note (optional; required to approve with open issues)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary !py-1" disabled={busy || !approver || c.status !== "verified"} onClick={() => act(() => api.approve(id, { approvedBy: approver, note: note || undefined }))}>{busy ? <Spinner className="border-ink-950 border-t-transparent" /> : null} Approve</button>
                  {c.status !== "verified" && <button className="btn-ghost !py-1 !text-xs" disabled={busy || !approver || !note} title="Records the approval with the current status; use only when you have reviewed the open items yourself" onClick={() => act(() => api.approve(id, { approvedBy: approver, note, force: true }))}>Approve anyway (with note)</button>}
                </div>
                {c.status !== "verified" && <div className="text-xs text-ink-400">Approve is enabled when the certificate is verified.</div>}
              </div>
            )}
            {error && <div className="mt-2 text-xs text-rose-glow">{error}</div>}
          </Section>
          <Section title="Plain language" aside={<span className={`text-xs ${c.language.summary.findings ? "text-amber-glow" : "text-lime-glow"}`}>{c.language.summary.stepsClean}/{c.language.summary.steps} clean</span>}>
            {c.language.findings.length === 0 ? <div className="text-xs text-ink-400">First person, short sentences, present tense, no idioms, one idea per step.</div> : (
              <ul className="space-y-1 text-xs">{c.language.findings.map((f, i) => <li key={i} className={f.severity === "medium" ? "text-amber-soft" : "text-ink-300"}>step {f.step}: {f.message}</li>)}</ul>
            )}
            <div className="mt-1 text-[11px] text-ink-400">Advice, not a block: the adult owns the words.</div>
          </Section>
          <Section title="After the real visit">
            {c.outcomes.length > 0 && (
              <ul className="mb-3 space-y-1 text-xs">
                {c.outcomes.map((o) => <li key={o.id} className={`rounded px-2 py-1 ${o.visitOutcome === "went_well" ? "bg-lime-glow/10 text-lime-glow" : "bg-amber-glow/10 text-amber-soft"}`}>{o.recordedAt.slice(0, 10)} · {o.visitOutcome.replace(/_/g, " ")} · watched {o.timesWatched}× · {o.recordedBy}{o.notes ? ` · ${o.notes}` : ""}{o.stepNotes.length ? ` · ${o.stepNotes.map((n) => `step ${n.stepNumber} ${n.reaction}${n.note ? ` (${n.note})` : ""}`).join(", ")}` : ""}</li>)}
              </ul>
            )}
            <div className="grid gap-2 text-sm">
              <input className="input" placeholder="Your name" value={outcome.recordedBy} onChange={(e) => setOutcome({ ...outcome, recordedBy: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-300">Times watched<input className="input" type="number" min={0} value={outcome.timesWatched} onChange={(e) => setOutcome({ ...outcome, timesWatched: Number(e.target.value) })} /></label>
                <label className="text-xs text-ink-300">The visit<select className="input" value={outcome.visitOutcome} onChange={(e) => setOutcome({ ...outcome, visitOutcome: e.target.value as StoryOutcomeInput["visitOutcome"] })}><option value="went_well">went well</option><option value="some_difficulty">some difficulty</option><option value="difficult">difficult</option><option value="did_not_happen">did not happen</option></select></label>
              </div>
              <div className="grid gap-1">
                {c.steps.map((s) => {
                  const n = outcome.stepNotes.find((x) => x.stepNumber === s.number);
                  return (
                    <div key={s.number} className="flex items-center gap-2 text-xs">
                      <span className="w-24 truncate text-ink-300">{s.number}. {s.title}</span>
                      <select className="input !w-auto !py-0.5" value={n?.reaction ?? ""} onChange={(e) => { const r = e.target.value as "calm" | "unsure" | "anxious" | ""; setOutcome({ ...outcome, stepNotes: [...outcome.stepNotes.filter((x) => x.stepNumber !== s.number), ...(r ? [{ stepNumber: s.number, reaction: r, note: n?.note }] : [])] }); }}>
                        <option value="">–</option><option value="calm">calm</option><option value="unsure">unsure</option><option value="anxious">anxious</option>
                      </select>
                      {n && <input className="input !py-0.5" placeholder="note" value={n.note ?? ""} onChange={(e) => setOutcome({ ...outcome, stepNotes: outcome.stepNotes.map((x) => (x.stepNumber === s.number ? { ...x, note: e.target.value } : x)) })} />}
                    </div>
                  );
                })}
              </div>
              <input className="input" placeholder="Notes (optional)" value={outcome.notes ?? ""} onChange={(e) => setOutcome({ ...outcome, notes: e.target.value })} />
              <div className="flex gap-2">
                <button className="btn-primary !py-1" disabled={busy || !outcome.recordedBy} onClick={() => act(() => api.recordOutcome(id, outcome).then(() => setOutcome({ recordedBy: outcome.recordedBy, timesWatched: 1, visitOutcome: "went_well", notes: "", stepNotes: [] })))}>Record outcome</button>
                {c.outcomes.length > 0 && <Link className="btn-ghost !py-1" href={`/projects/new?from=${id}${c.childId ? `&child=${c.childId}` : ""}`}>Revise story from feedback</Link>}
              </div>
            </div>
          </Section>
          <Section title="Identity references">
            {c.media.references.length === 0 ? <div className="text-xs text-ink-400">None yet. Reference sheets are generated before the first picture; you can upload a photo on the Characters page instead.</div> : (
              <ul className="space-y-1 text-xs">
                {c.media.references.map((r) => <li key={`${r.kind}-${r.characterId}`} className="flex items-center justify-between"><span className="text-ink-100">{r.name}{r.kind === "location" ? <span className="ml-1 text-ink-400">(place)</span> : null}</span><span className={r.provider === "upload" ? "text-teal-glow" : "text-ink-400"}>{r.provider === "upload" ? "uploaded photo" : `${r.provider}${r.model ? ` · ${r.model}` : ""}`}</span></li>)}
              </ul>
            )}
          </Section>
          <Section title="What this certifies">
            <ul className="space-y-1 text-xs text-ink-300">
              <li><span className="text-ink-100">Words:</span> every step is in the screenplay exactly as written; no model rewrote it.</li>
              <li><span className="text-ink-100">Order:</span> the steps are dramatised in the authored order, checked by the Narrative Critic.</li>
              <li><span className="text-ink-100">Pictures:</span> each generated frame was inspected by a vision model against the locked identity, outfit, setting, comfort items and the must-not-show list; drift was regenerated and re-inspected.</li>
              <li><span className="text-ink-100">Record:</span> checks, violations, repairs and model calls are stored in production memory{c.memory.name === "clickhouse" ? " (ClickHouse)" : ""}.</li>
              <li><span className="text-ink-100">Not certified:</span> a vision model can miss subtle details. The human sign-off is the final check.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

export type { ContinuityCertificate };
