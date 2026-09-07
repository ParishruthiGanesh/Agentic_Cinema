"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { Empty, PageTitle, Spinner } from "@/components/ui";

/** Children whose profiles are stored once and reused by every story. */
export default function ChildrenPage() {
  const children = useResource(() => api.children(), [], 8000);
  const [busy, setBusy] = useState(false);
  const createMaya = async () => {
    setBusy(true);
    try {
      await api.createSocialStoryDemo();
      await children.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageTitle title="Children" subtitle="One profile per child: how they look, the one outfit, comfort items, the people and places they know, and how they like to watch. Every story starts from it, so nothing drifts between the dentist in March and the new school in September." actions={<><button className="btn-ghost" disabled={busy} onClick={createMaya}>{busy ? <Spinner /> : null} Add example child (Maya)</button><Link href="/children/new" className="btn-primary">New child profile</Link></>} />
      {children.error && <div className="mb-3 text-sm text-rose-glow">{children.error}</div>}
      {children.data?.length === 0 && <Empty title="No child profiles yet" hint="Create one, then write stories for the situations coming up." action={<Link href="/children/new" className="btn-primary">New child profile</Link>} />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {children.data?.map((c) => (
          <Link key={c.id} href={`/children/${c.id}`} className="card card-hover block p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-violet-glow to-teal-glow text-lg font-bold text-ink-950">{c.name.slice(0, 1)}</div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-ink-100">{c.name}{c.age ? <span className="ml-2 text-xs font-normal text-ink-400">age {c.age}</span> : null}</div>
                <div className="truncate text-xs text-ink-400">{c.outfit}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[["stories", c.stories], ["people", c.companions.length], ["places", c.places.length], ["photos", c.photos]].map(([k, v]) => (
                <div key={k as string} className="rounded-md bg-ink-900/70 px-2 py-1.5"><div className="text-lg font-semibold tabular-nums text-ink-100">{v as number}</div><div className="text-[10px] uppercase tracking-wide text-ink-400">{k as string}</div></div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ink-400">{c.sensory.pacing === "slow" ? "tap to go on" : "auto advance"} · sound {c.sensory.sound} · {c.sensory.reducedMotion ? "no motion" : "motion ok"}{c.sensory.largeText ? " · large text" : ""}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
