"use client";

import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

/** Always tells the user which providers are live. Fixture/placeholder modes are never hidden. */
export function RuntimeBanner() {
  const health = useResource(() => api.health(), [], 30000);
  if (health.error) {
    return (
      <div className="border-t border-rose-glow/30 bg-rose-glow/10 px-5 py-1.5 text-xs text-rose-glow">
        API unreachable at {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"} — start it with <code className="font-mono">pnpm dev:api</code>.
      </div>
    );
  }
  const h = health.data;
  if (!h) return null;
  const fixture = h.llm.fixtureMode;
  const placeholder = h.media.name === "placeholder";
  if (!fixture && !placeholder) {
    return (
      <div className="border-t border-ink-800 bg-ink-900/60 px-5 py-1 text-[11px] text-ink-400">
        Live: Gemini {h.llm.model} · media {h.media.name}{h.videoEnabled ? " (video on)" : " (keyframes + voice; Veo off)"} · partner adapter {h.partner}
      </div>
    );
  }
  return (
    <div className="border-t border-amber-glow/30 bg-amber-glow/10 px-5 py-1.5 text-xs text-amber-soft">
      <strong>Development mode.</strong>{" "}
      {fixture && <>LLM agents replay authored fixtures for the bundled demo project (no Gemini key configured). </>}
      {placeholder && <>Keyframes are labelled placeholder cards, not model output. </>}
      Set <code className="font-mono">GEMINI_API_KEY</code> in <code className="font-mono">.env</code> for live agents and media.
    </div>
  );
}
