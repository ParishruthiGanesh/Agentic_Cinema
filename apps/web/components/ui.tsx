"use client";

import { SEVERITY_COLOR, STATUS_COLOR } from "@/lib/format";

export function Pill({ value, kind = "status", className = "" }: { value: string; kind?: "status" | "severity"; className?: string }) {
  const color = (kind === "severity" ? SEVERITY_COLOR : STATUS_COLOR)[value] ?? "border-ink-600 text-ink-300";
  return <span className={`pill ${color} ${className}`}>{value}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-lime-glow" : tone === "warn" ? "text-amber-glow" : tone === "bad" ? "text-rose-glow" : "text-ink-100";
  return (
    <div className="card px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-400">{hint}</div>}
    </div>
  );
}

export function Section({ title, aside, children, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-base font-medium text-ink-200">{title}</div>
      {hint && <div className="max-w-md text-sm text-ink-400">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink-100">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Provenance({ p }: { p?: { provider: string; model?: string; note?: string; latencyMs?: number; createdAt?: string } }) {
  if (!p) return null;
  const dev = p.provider === "fixture" || p.provider === "placeholder";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${dev ? "border-amber-glow/50 text-amber-glow" : "border-ink-600 text-ink-400"}`} title={p.note ?? ""}>
      {p.provider}
      {p.model && p.model !== p.provider ? `/${p.model}` : ""}
      {dev ? " · not a model" : ""}
      {typeof p.latencyMs === "number" && p.latencyMs > 0 ? ` · ${(p.latencyMs / 1000).toFixed(1)}s` : ""}
    </span>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm">
      <div className="text-ink-400">{k}</div>
      <div className="text-ink-100">{v}</div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-glow border-t-transparent ${className}`} />;
}
