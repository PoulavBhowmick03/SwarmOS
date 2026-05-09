'use client'

import { useState, useEffect, useRef } from 'react'
import type { AgentAccount } from '@/lib/client'

export interface AgentNode {
  id: string            // publicKey of PDA
  agent_id: number
  parent_id: number | null
  generation: number
  status: 'Active' | 'Scored' | 'Survived' | 'Terminated' | 'Respawned'
  score: number         // 0–100
  task_type: string
  lineage_hash: string
  swarm: string
  spawn_timestamp: number
}

function accountToNode(a: AgentAccount): AgentNode {
  return {
    id:               a.publicKey,
    agent_id:         a.agentId,
    parent_id:        a.parentId,
    generation:       a.generation,
    status:           a.status,
    score:            a.score,
    task_type:        a.taskType,
    lineage_hash:     a.lineageHash,
    swarm:            a.swarm,
    spawn_timestamp:  a.spawnTimestamp,
  }
}

export function useAgents(swarmAddress: string): {
  agents: AgentNode[]
  isLoading: boolean
  error: Error | null
} {
  const [agents, setAgents]     = useState<AgentNode[]>([])
  const [isLoading, setLoading] = useState(true)
  const [error, setError]       = useState<Error | null>(null)
  const cancelRef               = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    let intervalId: ReturnType<typeof setInterval>

    const load = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        const accounts = await getClient().getAllAgents(swarmAddress)
        if (!cancelRef.current) {
          setAgents(accounts.map(accountToNode).sort((a, b) => a.agent_id - b.agent_id))
          setLoading(false)
          setError(null)
        }
      } catch (e) {
        if (!cancelRef.current) {
          setError(e as Error)
          setLoading(false)
        }
      }
    }

    // Delay initial load by 3s so it doesn't collide with useEvents first poll
    const initialDelay = setTimeout(() => void load(), 3_000)
    intervalId = setInterval(load, 20_000)

    return () => {
      cancelRef.current = true
      clearTimeout(initialDelay)
      clearInterval(intervalId)
    }
  }, [swarmAddress])

  return { agents, isLoading, error }
}
