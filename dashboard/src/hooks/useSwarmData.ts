"use client";

import { useEffect, useState } from "react";
import type { ChildState, GenerationStat, SwarmEvent } from "@/types";
import { API_BASE } from "@/lib/mantle";
import { MOCK_AGENTS, MOCK_EVENTS, MOCK_GENERATIONS } from "@/lib/mockData";

type QueryState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  isMockData: boolean;
};

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function usePolledResource<T>(
  path: string,
  initial: T,
  mockFallback: T,
  intervalMs: number
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: initial,
    loading: true,
    error: null,
    isMockData: false,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchJSON<T>(path);
        if (!cancelled) {
          setState({ data, loading: false, error: null, isMockData: false });
        }
      } catch (error: any) {
        if (!cancelled) {
          setState({
            data: mockFallback,
            loading: false,
            error: error?.message ?? "Request failed",
            isMockData: true,
          });
        }
      }
    };

    load();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs, path]);

  return state;
}

export function useSwarmData() {
  const state = usePolledResource<ChildState[]>("/api/state", [], MOCK_AGENTS, 10_000);
  return {
    children: state.data,
    loading: state.loading,
    error: state.error,
    isMockData: state.isMockData,
    usingMockData: state.isMockData,
  };
}

export function useSwarmEvents() {
  const state = usePolledResource<SwarmEvent[]>("/api/events", [], MOCK_EVENTS, 8_000);
  return {
    events: state.data,
    loading: state.loading,
    error: state.error,
    isMockData: state.isMockData,
    usingMockData: state.isMockData,
  };
}

export function useGenerationStats() {
  const state = usePolledResource<GenerationStat[]>("/api/generations", [], MOCK_GENERATIONS, 15_000);
  return {
    generations: state.data,
    loading: state.loading,
    error: state.error,
    isMockData: state.isMockData,
    usingMockData: state.isMockData,
  };
}

export function useSwarmMeta() {
  return {
    meta: {
      apiBase: API_BASE,
    },
    loading: false,
    error: null as string | null,
  };
}

export function useChildData(childId: string) {
  const { children, loading, error } = useSwarmData();
  const child = children.find((entry) => entry.agentId === childId) ?? null;
  return {
    child,
    voteHistory: [],
    loading,
    error,
  };
}
