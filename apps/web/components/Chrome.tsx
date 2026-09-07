"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RuntimeBanner } from "./RuntimeBanner";
import { useAuth } from "@/lib/auth";

const isStudio = (p: string) => p === "/studio" || p.startsWith("/studio/") || p.startsWith("/projects") || p.startsWith("/children");

/**
 * Two front doors on one codebase: the family app (calm, plain words, no engineering) and the studio
 * (the full workspace for therapists' details, judges and engineers). The child player has no chrome at all.
 */
export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/watch")) return <>{children}</>;
  if (isStudio(pathname)) {
    return (
      <>
        <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
            <Link href="/studio" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-glow text-sm font-black text-ink-950">C</span>
              <span className="text-sm font-semibold tracking-wide text-ink-100">
                CineMemory Studio <span className="ml-2 hidden text-xs font-normal text-ink-400 sm:inline">memory &amp; verification for agentic filmmaking</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-ink-300">
              <Link href="/" className="hover:text-ink-100">Family app</Link>
              <Link href="/studio" className="hover:text-ink-100">Projects</Link>
              <Link href="/children" className="hover:text-ink-100">Children</Link>
              <Link href="/projects/new" className="btn-primary !py-1">New project</Link>
            </nav>
          </div>
          <RuntimeBanner />
        </header>
        <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>
      </>
    );
  }
  return <FamilyShell>{children}</FamilyShell>;
}

function FamilyShell({ children }: { children: React.ReactNode }) {
  const { account, signOut } = useAuth();
  return (
    <div className="family min-h-screen bg-[#f6f1e7] text-[#26221c]">
      <header className="border-b border-[#e6dfd0] bg-[#fbf8f1]">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#2f7d4f] text-base font-black text-white">S</span>
            <span className="text-lg font-semibold">Same Story</span>
            <span className="hidden text-sm text-[#7a7264] sm:inline">stories that stay the same, for children who need them to</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {account ? (
              <>
                <span className="hidden text-[#7a7264] sm:inline">{account.name}</span>
                <button className="rounded-lg border border-[#c9c1b1] px-3 py-1.5 hover:bg-white" onClick={() => void signOut()}>Sign out</button>
              </>
            ) : (
              <Link href="/signin" className="rounded-lg bg-[#26221c] px-3 py-1.5 text-white">Sign in</Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-5 pb-8 text-xs text-[#9a927f]">
        Built on CineMemory. Therapists and engineers: <Link href="/studio" className="underline">open the studio</Link>.
      </footer>
    </div>
  );
}
