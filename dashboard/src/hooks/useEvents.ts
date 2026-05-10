'use client'

import { useState, useEffect, useRef } from 'react'
import type { SwarmEvent, AgentAccount, AgentStatus } from '@/lib/client'

function enrichFromAgent(e: SwarmEvent, cached: AgentAccount | undefined): SwarmEvent {
  const agentId = e.agentId ?? e.newAgentId
  if (agentId == null) return e
  if (!cached) return e
  return {
    ...e,
    claimedApyBps:    e.claimedApyBps    ?? cached.claimedApyBps,
    claimedAPY:       e.claimedAPY       ?? cached.claimedApy,
    protocol:         e.protocol         ?? (cached.claimedProtocol || undefined),
    taskOutputHash:   e.taskOutputHash   ?? cached.taskOutputHash,
    agentUsdcAta:     e.agentUsdcAta     ?? cached.agentUsdcAta,
    agentUsdcBalance: e.agentUsdcBalance ?? cached.agentUsdcBalance,
  }
}

function enrichFromCache(e: SwarmEvent, cache: Map<number, AgentAccount>): SwarmEvent {
  return enrichFromAgent(e, cache.get(e.agentId ?? e.newAgentId ?? -1))
}

export interface AgentEventData {
  score?: number
  claimedApyBps?: number
  claimedAPY?: number
  actualAPY?: number
  protocol?: string
  taskOutputHash?: string
  agentUsdcAta?: string
  agentUsdcBalance?: number | null
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
    const claim = {
      claimedApyBps:    agent.claimedApyBps,
      claimedAPY:       agent.claimedApy,
      protocol:         agent.claimedProtocol,
      taskOutputHash:   agent.taskOutputHash,
      agentUsdcAta:     agent.agentUsdcAta,
      agentUsdcBalance: agent.agentUsdcBalance,
    }

    if (!old) {
      // New agent appeared → spawned
      events.push({
        type:       'AgentSpawned',
        agentId:    agent.agentId,
        generation: agent.generation,
        swarm:      agent.swarm,
        timestamp:  now,
        ...claim,
      })
      continue
    }

    // Emit AgentScored when score appears without a status transition (oracle scored in same block)
    if (old.status === agent.status) {
      if (old.score === 0 && agent.score > 0 && agent.status === 'Active') {
        events.push({ type: 'AgentScored', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now, ...claim })
      }
      continue
    }

    const wasActive = (s: AgentStatus) => s === 'Active' || s === 'Scored'

    if (old.score === 0 && agent.score > 0 && (agent.status === 'Survived' || agent.status === 'Terminated')) {
      events.push({ type: 'AgentScored', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now, ...claim })
    }

    if (wasActive(old.status) && agent.status === 'Survived') {
      events.push({ type: 'AgentSurvived', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now, ...claim })
    } else if (wasActive(old.status) && agent.status === 'Terminated') {
      events.push({ type: 'AgentTerminated', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now, ...claim })
    } else if (wasActive(old.status) && agent.status === 'Scored') {
      events.push({ type: 'AgentScored', agentId: agent.agentId, score: agent.score, generation: agent.generation, timestamp: now, ...claim })
    } else if (agent.status === 'Respawned') {
      events.push({ type: 'AgentRespawned', newAgentId: agent.agentId, parentAgentId: agent.parentId ?? undefined, generation: agent.generation, timestamp: now, ...claim })
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
  const seededRef      = useRef(false)
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
            next.set(agentId, {
              ...existing,
              spawnTs: e.timestamp,
              inheritedMemories: e.inheritedMemories,
              claimedApyBps: e.claimedApyBps ?? existing.claimedApyBps,
              claimedAPY: e.claimedAPY ?? existing.claimedAPY,
              protocol: e.protocol ?? existing.protocol,
              taskOutputHash: e.taskOutputHash ?? existing.taskOutputHash,
              agentUsdcAta: e.agentUsdcAta ?? existing.agentUsdcAta,
              agentUsdcBalance: e.agentUsdcBalance ?? existing.agentUsdcBalance,
            })
            break
          case 'AgentScored':
          case 'AgentSurvived':
          case 'AgentTerminated':
            next.set(agentId, {
              ...existing,
              score: e.score,
              claimedApyBps: e.claimedApyBps ?? existing.claimedApyBps,
              claimedAPY: e.claimedAPY ?? existing.claimedAPY,
              actualAPY: e.actualAPY ?? existing.actualAPY,
              protocol: e.protocol ?? existing.protocol,
              taskOutputHash: e.taskOutputHash ?? existing.taskOutputHash,
              agentUsdcAta: e.agentUsdcAta ?? existing.agentUsdcAta,
              agentUsdcBalance: e.agentUsdcBalance ?? existing.agentUsdcBalance,
            })
            break
          case 'AgentRespawned':
            next.set(agentId, {
              ...existing,
              inheritedMemories: e.inheritedMemories,
              claimedApyBps: e.claimedApyBps ?? existing.claimedApyBps,
              claimedAPY: e.claimedAPY ?? existing.claimedAPY,
              protocol: e.protocol ?? existing.protocol,
              taskOutputHash: e.taskOutputHash ?? existing.taskOutputHash,
              agentUsdcAta: e.agentUsdcAta ?? existing.agentUsdcAta,
              agentUsdcBalance: e.agentUsdcBalance ?? existing.agentUsdcBalance,
            })
            break
        }
      }
      return next
    })
  }

  useEffect(() => {
    cancelRef.current = false
    seededRef.current = false

    // ── WebSocket subscription (best-effort) ──────────────────────────
    const initWs = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        unsubRef.current = getClient().subscribeToEvents((e) => {
          if (cancelRef.current) return
          const cached = enrichFromCache(e, prevAgentsRef.current)
          const agentId = cached.agentId ?? cached.newAgentId
          if (agentId == null || cached.protocol != null || prevAgentsRef.current.has(agentId)) {
            ingestEvents([cached])
            return
          }

          void getClient().getAllAgents(swarmAddress)
            .then((accounts) => {
              if (cancelRef.current) return
              prevAgentsRef.current = new Map(accounts.map((a) => [a.agentId, a]))
              ingestEvents([enrichFromAgent(e, prevAgentsRef.current.get(agentId))])
            })
            .catch(() => {
              if (!cancelRef.current) ingestEvents([cached])
            })
        })
      } catch {
        // Polling remains the primary event source; websocket support is best-effort.
      }
    }
    void initWs()

    // ── Polling fallback (primary for event detection) ────────────────
    const poll = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        const accounts = await getClient().getAllAgents(swarmAddress)
        if (cancelRef.current) return

        const prev = prevAgentsRef.current
        if (!seededRef.current) {
          prevAgentsRef.current = new Map(accounts.map((a) => [a.agentId, a]))
          seededRef.current = true
          return
        }

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
      seededRef.current = false
      clearInterval(intervalId)
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [swarmAddress])

  return { events, byAgent }
}
