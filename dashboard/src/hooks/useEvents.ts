'use client'

import { useState, useEffect, useRef } from 'react'
import type { SwarmEvent, AgentAccount, AgentStatus } from '@/lib/client'

export interface AgentEventData {
  score?: number
  claimedAPY?: number
  actualAPY?: number
  protocol?: string
  inheritedMemories?: number
  spawnTs?: number
}

const MAX_EVENTS = 50
const POLL_MS    = 20_000

// Derive synthetic SwarmEvents by diffing previous vs current agent state
function diffAgents(
  prev: Map<number, AgentAccount>,
  next: AgentAccount[],
): SwarmEvent[] {
  const now    = Date.now()
  const events: SwarmEvent[] = []

  for (const agent of next) {
    const old = prev.get(agent.agentId)

    if (!old) {
      // New agent appeared → spawned
      events.push({
        type:       'AgentSpawned',
        agentId:    agent.agentId,
        generation: agent.generation,
        swarm:      agent.swarm,
        timestamp:  now,
      })
      continue
    }

    if (old.status === agent.status) continue

    const wasActive = (s: AgentStatus) => s === 'Active' || s === 'Scored'

    if (wasActive(old.status) && agent.status === 'Survived') {
      events.push({ type: 'AgentSurvived', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now })
    } else if (wasActive(old.status) && agent.status === 'Terminated') {
      events.push({ type: 'AgentTerminated', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now })
    } else if (wasActive(old.status) && agent.status === 'Scored') {
      events.push({ type: 'AgentScored', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now })
    } else if (agent.status === 'Respawned') {
      events.push({ type: 'AgentRespawned', newAgentId: agent.agentId, parentAgentId: agent.parentId ?? undefined, generation: agent.generation, timestamp: now })
    }
  }

  return events
}

export function useEvents(swarmAddress: string): {
  events: SwarmEvent[]
  byAgent: Map<number, AgentEventData>
} {
  const [events,  setEvents]  = useState<SwarmEvent[]>([])
  const [byAgent, setByAgent] = useState<Map<number, AgentEventData>>(new Map())

  const prevAgentsRef  = useRef<Map<number, AgentAccount>>(new Map())
  const cancelRef      = useRef(false)
  // Keep WebSocket subscription running in parallel — if it fires, great
  const unsubRef       = useRef<(() => void) | null>(null)

  function ingestEvents(incoming: SwarmEvent[]) {
    if (incoming.length === 0) return

    setEvents((prev) => [...incoming, ...prev].slice(0, MAX_EVENTS))

    setByAgent((prev) => {
      const next = new Map(prev)
      for (const e of incoming) {
        const agentId = e.agentId ?? e.newAgentId
        if (agentId == null) continue
        const existing: AgentEventData = next.get(agentId) ?? {}
        switch (e.type) {
          case 'AgentSpawned':
            next.set(agentId, { ...existing, spawnTs: e.timestamp, inheritedMemories: e.inheritedMemories, protocol: e.protocol })
            break
          case 'AgentScored':
          case 'AgentSurvived':
          case 'AgentTerminated':
            next.set(agentId, { ...existing, score: e.score, claimedAPY: e.claimedAPY, actualAPY: e.actualAPY, protocol: e.protocol ?? existing.protocol })
            break
          case 'AgentRespawned':
            next.set(agentId, { ...existing, inheritedMemories: e.inheritedMemories, protocol: e.protocol ?? existing.protocol })
            break
        }
      }
      return next
    })
  }

  useEffect(() => {
    cancelRef.current = false

    // ── WebSocket subscription (best-effort) ──────────────────────────
    const initWs = async () => {
      const { getClient } = await import('@/lib/client')
      unsubRef.current = getClient().subscribeToEvents((e) => {
        if (!cancelRef.current) ingestEvents([e])
      })
    }
    void initWs()

    // ── Polling fallback (primary for event detection) ────────────────
    const poll = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        const accounts = await getClient().getAllAgents(swarmAddress)
        if (cancelRef.current) return

        const prev = prevAgentsRef.current
        const synthetic = diffAgents(prev, accounts)

        // Update state cache
        prevAgentsRef.current = new Map(accounts.map((a) => [a.agentId, a]))

        ingestEvents(synthetic)
      } catch {
        // silently ignore poll errors — WebSocket may still provide events
      }
    }

    void poll()
    const intervalId = setInterval(poll, POLL_MS)

    return () => {
      cancelRef.current = true
      clearInterval(intervalId)
      unsubRef.current?.()
      unsubRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swarmAddress])

  return { events, byAgent }
}
