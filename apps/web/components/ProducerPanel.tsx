"use client";

import { useState } from "react";
import { api, type ProducerStep } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { Section, Spinner } from "./ui";

/**
 * Chat with the CineMemory Producer: an ADK LlmAgent on Gemini whose tools are the real pipeline,
 * critics, repair loop, evaluation harness and ClickHouse production memory (plus the official
 * ClickHouse MCP server for ad-hoc SQL). Every tool call it makes shows up in the activity log.
 */
export function ProducerPanel({ projectId }: { projectId?: string }) {
  const status = useResource(() => api.agentStatus(), [], 30000);
  const [input, setInput] = useState(projectId ? `Inspect project ${projectId}: run it to narrative_verified if needed, explain any violations using scene memory, repair what you can, and summarise.` : "Create the demo project, run it to narrative_verified, explain any violations using scene memory, and repair them.");
  const [transcript, setTranscript] = useState<Array<{ role: "you" | "producer"; steps?: ProducerStep[]; text?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sessionId] = useState(() => `web_${Date.now().toString(36)}`);
  const s = status.data;

  const send = async () => {
    const message = input.trim();
    if (!message) return;
    setBusy(true);
    setError(undefined);
    setTranscript((t) => [...t, { role: "you", text: message }]);
    setInput("");
    try {
      const r = await api.agentChat(sessionId, message);
      setTranscript((t) => [...t, { role: "producer", steps: r.steps }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={<span>Producer agent <span className="ml-2 text-xs font-normal text-ink-400">Google ADK · {s?.model ?? "…"}{s?.mcp ? " · ClickHouse MCP" : ""}</span></span>}
      aside={s ? <span className={`text-xs ${s.available ? "text-lime-glow" : "text-amber-glow"}`}>{s.available ? "live" : "needs GEMINI_API_KEY"}</span> : null}
    >
      {s && !s.available && <div className="mb-3 rounded border border-amber-glow/30 bg-amber-glow/5 px-3 py-2 text-xs text-amber-soft">{s.reason}</div>}
      <div className="scrollbar-thin max-h-[380px] space-y-3 overflow-auto">
        {transcript.length === 0 && <div className="text-xs text-ink-400">The Producer decides which stages to run, queries production memory before reasoning about a scene, and calls the Repair Agent. Its tool calls are logged as real workflow events.</div>}
        {transcript.map((m, i) =>
          m.role === "you" ? (
            <div key={i} className="rounded bg-ink-900/70 px-3 py-2 text-sm text-ink-100"><span className="label mr-2">you</span>{m.text}</div>
          ) : (
            <div key={i} className="space-y-1">
              {m.steps?.map((st, j) =>
                st.type === "tool_call" ? (
                  <div key={j} className="font-mono text-[11px] text-violet-glow">⇢ {st.name}({JSON.stringify(st.args).slice(0, 160)})</div>
                ) : st.type === "tool_result" ? (
                  <div key={j} className="font-mono text-[11px] text-ink-400">⇠ {st.name}: {JSON.stringify(st.result).slice(0, 220)}</div>
                ) : (
                  <div key={j} className="rounded border border-amber-glow/20 bg-amber-glow/5 px-3 py-2 text-sm text-ink-100"><span className="label mr-2">producer</span>{st.text}</div>
                ),
              )}
            </div>
          ),
        )}
      </div>
      {error && <div className="mt-2 text-xs text-rose-glow">{error}</div>}
      <div className="mt-3 flex gap-2">
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && send()} disabled={!s?.available || busy} placeholder="Ask the Producer…" />
        <button className="btn-primary" disabled={!s?.available || busy || !input.trim()} onClick={send}>{busy ? <Spinner className="border-ink-950 border-t-transparent" /> : "Send"}</button>
      </div>
    </Section>
  );
}
