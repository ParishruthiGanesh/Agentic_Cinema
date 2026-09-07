"use client";

import Link from "next/link";
import { useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { Badge, Button, Card, FamilyPage } from "@/components/family";

/** Family home: the children, and every story with a picture, a plain-words status and what to do next. */
export default function HomePage() {
  const { account, loading } = useAuth();
  if (!loading && account === null) return <Landing />;
  return (
    <FamilyPage>
      <Home />
    </FamilyPage>
  );
}

function Landing() {
  return (
    <div className="grid gap-8 py-8 md:grid-cols-[1.2fr_1fr] md:items-center">
      <div>
        <h1 className="text-4xl font-semibold leading-tight">No surprises. Your child's day, pictured before it happens.</h1>
        <p className="mt-4 text-lg text-[#4d463b]">Social stories help autistic children get ready for the dentist, a haircut, a new school. Preview Pal turns the words you write into calm pictures, a gentle voice and a short film, keeps your child, their clothes, the rooms and the order exactly the same in every picture, and checks each one before your child sees it.</p>
        <div className="mt-6 flex gap-3">
          <Button href="/signin">Sign in or create an account</Button>
        </div>
      </div>
      <Card>
        <ol className="space-y-3 text-[15px]">
          <li><span className="font-semibold">1. Tell us about your child.</span> How they look, the outfit they will wear, their comfort toy, the people and places they know. Add photos if you like.</li>
          <li><span className="font-semibold">2. Write the story, step by step.</span> Or start from a draft and edit every word.</li>
          <li><span className="font-semibold">3. We make the pictures and check them.</span> Same child, same clothes, same room, nothing scary.</li>
          <li><span className="font-semibold">4. You approve, then your child watches.</span> One picture at a time, at their pace. Print it too.</li>
        </ol>
      </Card>
    </div>
  );
}

function Home() {
  const kids = useResource(() => api.myChildren(), [], 8000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const claim = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.claimDemoChild();
      await kids.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Your children</h1>
          <p className="mt-1 text-[#7a7264]">Each child has one profile. Every story starts from it, so nothing changes between stories.</p>
        </div>
        <div className="flex gap-2">
          {kids.data?.length === 0 && <Button kind="ghost" onClick={claim} disabled={busy}>{busy ? "Adding…" : "Try with Maya (example)"}</Button>}
          <Button href="/kids/new">Add a child</Button>
        </div>
      </div>
      {error && <div className="mt-3 text-sm text-[#a13333]">{error}</div>}
      {kids.data?.length === 0 && (
        <Card className="mt-6 text-center">
          <div className="text-lg font-semibold">No children yet</div>
          <div className="mt-1 text-[#7a7264]">Add your child, or try the app with Maya, a fictional six-year-old, and her dentist story.</div>
        </Card>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {kids.data?.map((k) => <KidCard key={k.id} id={k.id} name={k.name} age={k.age} outfit={k.outfit} stories={k.stories} />)}
      </div>
    </div>
  );
}

function KidCard({ id, name, age, outfit, stories }: { id: string; name: string; age?: string; outfit: string; stories: number }) {
  const detail = useResource(() => api.child(id), [id], 6000);
  const d = detail.data;
  const photo = d?.previews.find((p) => p.style === d.child.style)?.path ?? d?.photos.find((p) => p.entityId === id)?.path;
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-2xl bg-[#eee9dd]">{photo ? <img src={mediaUrl(photo)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-2xl font-bold text-[#7a7264]">{name.slice(0, 1)}</div>}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-semibold">{name}{age ? <span className="ml-2 text-sm font-normal text-[#7a7264]">age {age}</span> : null}</div>
          <div className="truncate text-sm text-[#7a7264]">{outfit}</div>
        </div>
        <Link href={`/kids/${id}`} className="text-sm font-semibold text-[#2f7d4f] hover:underline">Open</Link>
      </div>
      <div className="mt-4 space-y-2">
        {d?.stories.slice(0, 3).map((s) => (
          <Link key={s.project.id} href={`/stories/${s.project.id}`} className="flex items-center gap-3 rounded-xl border border-[#eee9dd] p-2 hover:bg-[#fbf8f1]">
            <div className="h-12 w-20 overflow-hidden rounded-lg bg-[#eee9dd]">{s.coverPath && <img src={mediaUrl(s.coverPath)} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{s.project.title}</div>
              <div className="text-xs text-[#7a7264]">{s.project.socialStory?.steps.length} steps</div>
            </div>
            {s.story && <Badge code={s.story.code} label={s.story.label} />}
          </Link>
        ))}
        {stories === 0 && <div className="text-sm text-[#7a7264]">No stories yet.</div>}
      </div>
      <div className="mt-4"><Button href={`/kids/${id}/new-story`}>New story for {name}</Button></div>
    </Card>
  );
}
