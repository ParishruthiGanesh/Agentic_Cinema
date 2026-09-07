"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { StoryOutcomeInput } from "@cinememory/core";
import { api, mediaUrl } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { Badge, Button, Card, FamilyPage, Field, inputCls } from "@/components/family";

/** One story: progress in plain words while it is made, then the approval screen, then watch and print. */
export default function StoryPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FamilyPage>
      <Story id={id} />
    </FamilyPage>
  );
}

const CHECK_LABEL: Record<string, string> = { identity: "Same face and hair", outfit: "Same clothes", setting: "Same room", comfort_items: "Comfort item present", forbidden: "Nothing from the must-not list", style: "Same picture style" };

function Story({ id }: { id: string }) {
  const summary = useResource(() => api.project(id), [id], 4000);
  const p = summary.data?.project;
  const status = summary.data?.story;
  const inProgress = status && ["writing", "drawing", "moving", "checking"].includes(status.code);
  const ready = status && (status.code === "needs_approval" || status.code === "approved");
  const cert = useResource(ready ? () => api.certificate(id) : null, [id, status?.code]);
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<StoryOutcomeInput>({ recordedBy: "", timesWatched: 1, visitOutcome: "went_well", notes: "", stepNotes: [] });
  if (!p) return <div className="text-[#7a7264]">Loading…</div>;

  const act = async (fn: () => Promise<unknown>, key: string) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await Promise.all([summary.refresh(), cert.refresh()]);
    } catch (e) {
      const m = (e as Error).message;
      setError(/already running/i.test(m) ? "Still working on this story. Give it a few minutes; this page updates by itself." : m);
    } finally {
      setBusy(undefined);
    }
  };
  const c = cert.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={p.childId ? `/kids/${p.childId}` : "/"} className="text-sm text-[#7a7264] hover:underline">← {p.socialStory?.child.name ?? "Back"}</Link>
          <h1 className="text-3xl font-semibold">{p.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-[#7a7264]">{status && <Badge code={status.code} label={status.label} />}<span className="text-sm">{p.socialStory?.steps.length} steps</span></div>
        </div>
        {status?.code === "needs_approval" && (
          <div className="flex flex-wrap gap-2">
            <Button kind="ghost" href={`/watch/${id}?preview=1`}>Preview (adults only)</Button>
            {summary.data?.videoPath && <a className="inline-flex items-center rounded-xl border border-[#c9c1b1] bg-white px-4 py-2.5 text-sm font-semibold" href={mediaUrl(summary.data.videoPath)} download>Download the video</a>}
          </div>
        )}
        {status?.code === "approved" && (
          <div className="flex flex-wrap gap-2">
            <Button href={`/watch/${id}`}>Watch with {p.socialStory?.child.name}</Button>
            {summary.data?.videoPath && <a className="inline-flex items-center rounded-xl border border-[#c9c1b1] bg-white px-4 py-2.5 text-sm font-semibold" href={mediaUrl(summary.data.videoPath)} download>Download the video</a>}
            <a className="inline-flex items-center rounded-xl border border-[#c9c1b1] bg-white px-4 py-2.5 text-sm font-semibold" href={api.bookletUrl(id)} target="_blank" rel="noreferrer">Print</a>
          </div>
        )}
      </div>
      {error && <div className="text-sm text-[#a13333]">{error}</div>}

      {inProgress && (
        <Card>
          <div className="flex items-center gap-4">
            <span className="h-4 w-4 animate-pulse rounded-full bg-[#2f7d4f]" />
            <div>
              <div className="text-lg font-semibold">{status!.label}…</div>
              <div className="text-sm text-[#7a7264]">{status!.detail} You can leave this page; the story keeps being made.</div>
            </div>
          </div>
          <Progress code={status!.code} />
        </Card>
      )}

      {status?.code === "failed" && (
        <Card className="border-[#d9a5a5]">
          <div className="font-semibold text-[#a13333]">Something went wrong</div>
          <div className="mt-1 text-sm text-[#7a7264]">{status.detail}</div>
          <div className="mt-3"><Button onClick={() => act(() => api.run(id, "film_assembled"), "retry")} disabled={busy === "retry"}>Try again</Button></div>
        </Card>
      )}

      {status?.code === "not_started" && <Card><Button onClick={() => act(() => api.run(id, "film_assembled"), "start")} disabled={busy === "start"}>Make the story</Button></Card>}

      {ready && c && (
        <>
          {summary.data && summary.data.clips === 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-semibold">Still pictures for now</div><div className="text-sm text-[#7a7264]">Add moving pictures: a gentle clip for each step, starting from its checked picture. Every clip is checked again, and you approve again afterwards.</div></div>
              <Button kind="ghost" onClick={() => act(() => api.addVideo(id), "video")} disabled={busy === "video"}>{busy === "video" ? "Starting…" : "Add moving pictures"}</Button>
            </Card>
          )}
          <Card className={c.status === "verified" ? "border-[#bfe0cb]" : "border-[#f1d38a]"}>
            {c.status === "verified" ? (
              <div className="text-lg font-semibold">All {c.steps.length} pictures match {c.child}, the clothes, the rooms and the must-not list.</div>
            ) : (
              <div className="text-lg font-semibold">Please look at {(() => { const bad = c.steps.filter((s) => !s.verified).map((s) => s.number); return bad.length ? `step${bad.length > 1 ? "s" : ""} ${bad.join(", ")}` : "the pictures"; })()} before approving.</div>
            )}
          </Card>

          <div className="grid gap-4">
            {c.steps.map((s) => (
              <Card key={s.number} className="grid gap-4 md:grid-cols-[320px_1fr]">
                <div className="aspect-video overflow-hidden rounded-xl bg-[#eee9dd]">{s.keyframe ? <img src={mediaUrl(s.keyframe.path)} alt="" className="h-full w-full object-cover" /> : null}</div>
                <div>
                  <div className="text-sm text-[#7a7264]">Step {s.number} · {s.settingName} · {s.present.join(", ")}</div>
                  <div className="mt-1 text-lg">“{s.text}”</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(s.categories).filter(([, v]) => v.state !== "n/a").map(([k, v]) => (
                      <span key={k} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.state === "pass" ? "bg-[#e3f2e8] text-[#2f7d4f]" : v.state === "fail" ? "bg-[#fde7e7] text-[#a13333]" : "bg-[#eee9dd] text-[#6b6355]"}`}>{CHECK_LABEL[k] ?? k} {v.state === "pass" ? "✓" : v.state === "fail" ? "✗" : "?"}</span>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card>
            {c.approval ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="font-semibold text-[#2f7d4f]">Approved by {c.approval.approvedBy}</div><div className="text-sm text-[#7a7264]">{c.approval.approvedAt.slice(0, 10)}{c.approval.note ? ` · ${c.approval.note}` : ""}{!c.approvalValid ? " · the pictures changed since; please look again and approve" : ""}</div></div>
                <Button kind="danger" onClick={() => act(() => api.revokeApproval(id), "revoke")} disabled={busy === "revoke"}>Take approval back</Button>
              </div>
            ) : (
              <div>
                <div className="text-lg font-semibold">Ready to approve?</div>
                <div className="mt-1 text-sm text-[#7a7264]">Look at every picture above. If they all look right for {c.child}, sign here. Your child can watch only after this.</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input className={`${inputCls} !w-64`} placeholder="Your name" value={approver} onChange={(e) => setApprover(e.target.value)} />
                  <Button onClick={() => act(() => api.approve(id, { approvedBy: approver, force: c.status !== "verified", note: c.status !== "verified" ? "Reviewed by hand" : undefined }), "approve")} disabled={!approver || busy === "approve"}>{c.status === "verified" ? "Approve" : "Approve anyway"}</Button>
                  <Link href={`/watch/${id}?preview=1`} className="text-sm font-semibold text-[#2f7d4f] hover:underline">Preview first</Link>
                </div>
              </div>
            )}
          </Card>

          {c.approval && (
            <Card>
              <div className="text-lg font-semibold">After the real visit</div>
              <div className="text-sm text-[#7a7264]">Tell us how it went. The next story for {c.child} can start from these notes.</div>
              {c.outcomes.length > 0 && <ul className="mt-2 space-y-1 text-sm">{c.outcomes.map((o) => <li key={o.id} className="rounded-lg bg-[#f6f1e7] px-3 py-1.5">{o.recordedAt.slice(0, 10)} · {o.visitOutcome.replace(/_/g, " ")} · watched {o.timesWatched}×{o.stepNotes.length ? ` · ${o.stepNotes.map((n) => `step ${n.stepNumber} ${n.reaction}`).join(", ")}` : ""}</li>)}</ul>}
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Your name"><input className={inputCls} value={outcome.recordedBy} onChange={(e) => setOutcome({ ...outcome, recordedBy: e.target.value })} /></Field>
                <Field label="Times watched"><input className={inputCls} type="number" min={0} value={outcome.timesWatched} onChange={(e) => setOutcome({ ...outcome, timesWatched: Number(e.target.value) })} /></Field>
                <Field label="How did it go?"><select className={inputCls} value={outcome.visitOutcome} onChange={(e) => setOutcome({ ...outcome, visitOutcome: e.target.value as StoryOutcomeInput["visitOutcome"] })}><option value="went_well">It went well</option><option value="some_difficulty">Some difficulty</option><option value="difficult">It was difficult</option><option value="did_not_happen">It did not happen</option></select></Field>
              </div>
              <div className="mt-3 grid gap-1">
                {c.steps.map((s) => {
                  const n = outcome.stepNotes.find((x) => x.stepNumber === s.number);
                  return (
                    <div key={s.number} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate">{s.number}. {s.title}</span>
                      {(["calm", "unsure", "anxious"] as const).map((r) => <button key={r} className={`rounded-full px-2.5 py-0.5 text-xs ${n?.reaction === r ? "bg-[#26221c] text-white" : "bg-[#eee9dd]"}`} onClick={() => setOutcome({ ...outcome, stepNotes: [...outcome.stepNotes.filter((x) => x.stepNumber !== s.number), { stepNumber: s.number, reaction: r, note: n?.note }] })}>{r}</button>)}
                      {n && <input className={`${inputCls} !py-1 text-xs`} placeholder="note" value={n.note ?? ""} onChange={(e) => setOutcome({ ...outcome, stepNotes: outcome.stepNotes.map((x) => (x.stepNumber === s.number ? { ...x, note: e.target.value } : x)) })} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => act(() => api.recordOutcome(id, outcome), "outcome")} disabled={!outcome.recordedBy || busy === "outcome"}>Save</Button>
                {c.outcomes.length > 0 && p.childId && <Button kind="ghost" href={`/kids/${p.childId}/new-story?from=${id}`}>Make a new version from these notes</Button>}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Progress({ code }: { code: string }) {
  if (code === "moving") return <div className="mt-4 text-xs text-[#7a7264]">Each step gets a short clip, then every clip is checked and the video file is built. You can approve again when it is done.</div>;
  const stages = ["writing", "drawing", "checking"];
  const idx = stages.indexOf(code);
  return (
    <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-[#7a7264]">
      {["Getting the words ready", "Drawing the pictures", "Checking every picture"].map((l, i) => (
        <div key={l}><div className={`h-2 rounded-full ${i <= idx ? "bg-[#2f7d4f]" : "bg-[#eee9dd]"}`} /><div className="mt-1">{l}</div></div>
      ))}
    </div>
  );
}
