import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { RuntimeBanner } from "@/components/RuntimeBanner";

export const metadata: Metadata = {
  title: "CineMemory",
  description: "The memory & verification layer for agentic filmmaking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-glow text-sm font-black text-ink-950">C</span>
              <span className="text-sm font-semibold tracking-wide text-ink-100">
                CineMemory <span className="ml-2 hidden text-xs font-normal text-ink-400 sm:inline">memory &amp; verification for agentic filmmaking</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-ink-300">
              <Link href="/" className="hover:text-ink-100">Dashboard</Link>
              <Link href="/children" className="hover:text-ink-100">Children</Link>
              <Link href="/projects/new" className="btn-primary !py-1">New project</Link>
            </nav>
          </div>
          <RuntimeBanner />
        </header>
        <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
