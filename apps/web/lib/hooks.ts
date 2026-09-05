"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowEvent } from "@cinememory/core";
import { API_URL, api, type Job } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** Fetch-on-mount + optional polling. Refresh manually after mutations or on workflow events. */
export function useResource<T>(fetcher: (() => Promise<T>) | null, deps: unknown[] = [], pollMs?: number): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(!!fetcher);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    const f = fetcherRef.current;
    if (!f) return;
    try {
      const d = await f();
      setData(d);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!pollMs) return;
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs]);

  return { data, error, loading, refresh };
}

export interface LiveEvents {
  events: WorkflowEvent[];
  job: Job | null;
  connected: boolean;
  /** Incremented on every event so pages can refresh derived data. */
  tick: number;
}

/** Server-sent events stream for a project's activity log (falls back to polling if SSE fails). */
export function useLiveEvents(projectId: string | undefined): LiveEvents {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    setEvents([]);
    lastSeq.current = 0;
    let es: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const push = (e: WorkflowEvent) => {
      if (e.seq <= lastSeq.current) return;
      lastSeq.current = e.seq;
      setEvents((prev) => [...prev.slice(-499), e]);
      setTick((t) => t + 1);
    };
    try {
      es = new EventSource(`${API_URL}/api/projects/${projectId}/events/stream`);
      es.addEventListener("event", (m) => push(JSON.parse((m as MessageEvent).data) as WorkflowEvent));
      es.addEventListener("ping", (m) => {
        const d = JSON.parse((m as MessageEvent).data) as { job: Job | null };
        setJob(d.job);
        setConnected(true);
      });
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
    } catch {
      setConnected(false);
    }
    poll = setInterval(async () => {
      try {
        const [evts, j] = await Promise.all([api.events(projectId, lastSeq.current), api.job(projectId)]);
        evts.forEach(push);
        setJob(j.current);
      } catch {
        /* offline */
      }
    }, 4000);
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [projectId]);

  return { events, job, connected, tick };
}
