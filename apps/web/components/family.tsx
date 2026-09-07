"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/** Wrapper for family pages: requires a signed-in account and redirects to /signin otherwise. */
export function FamilyPage({ children, allowAnonymous = false }: { children: React.ReactNode; allowAnonymous?: boolean }) {
  const { account, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && account === null && !allowAnonymous) router.replace("/signin");
  }, [account, loading, allowAnonymous, router]);
  if (loading || (account === null && !allowAnonymous)) return <div className="py-16 text-center text-[#7a7264]">Loading…</div>;
  return <>{children}</>;
}

export const STATUS_TONE: Record<string, string> = {
  approved: "bg-[#e3f2e8] text-[#2f7d4f]",
  needs_approval: "bg-[#fff3d6] text-[#8a5a00]",
  checking: "bg-[#e7effa] text-[#2b5c9e]",
  drawing: "bg-[#e7effa] text-[#2b5c9e]",
  moving: "bg-[#e7effa] text-[#2b5c9e]",
  writing: "bg-[#e7effa] text-[#2b5c9e]",
  failed: "bg-[#fde7e7] text-[#a13333]",
  not_started: "bg-[#eee9dd] text-[#6b6355]",
};

export function Badge({ code, label }: { code: string; label: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[code] ?? STATUS_TONE.not_started}`}>{label}</span>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#e6dfd0] bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Button({ children, href, onClick, kind = "primary", disabled, type = "button" }: { children: React.ReactNode; href?: string; onClick?: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; type?: "button" | "submit" }) {
  const cls = `inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${kind === "primary" ? "bg-[#2f7d4f] text-white hover:bg-[#276a43]" : kind === "danger" ? "border border-[#d9a5a5] text-[#a13333] hover:bg-[#fde7e7]" : "border border-[#c9c1b1] bg-white text-[#26221c] hover:bg-[#f6f1e7]"}`;
  if (href && !disabled) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <div className="mb-1 text-sm font-medium text-[#4d463b]">{label}</div>
    {children}
    {hint && <div className="mt-1 text-xs text-[#7a7264]">{hint}</div>}
  </label>
);

export const inputCls = "w-full rounded-xl border border-[#c9c1b1] bg-white px-3 py-2.5 text-[15px] text-[#26221c] outline-none placeholder:text-[#a59d8c] focus:border-[#2f7d4f]";
