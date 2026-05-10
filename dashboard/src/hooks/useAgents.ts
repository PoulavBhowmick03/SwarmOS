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
  claimed_apy_bps: number
  claimed_apy: number
  claimed_protocol: string
  task_output_hash: string
  agent_usdc_ata: string
  agent_usdc_balance: number | null
  agent_usdc_raw_amount: string | null
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
    claimed_apy_bps:  a.claimedApyBps,
    claimed_apy:      a.claimedApy,
    claimed_protocol: a.claimedProtocol,
    task_output_hash: a.taskOutputHash,
    agent_usdc_ata:   a.agentUsdcAta,
    agent_usdc_balance: a.agentUsdcBalance,
    agent_usdc_raw_amount: a.agentUsdcRawAmount,
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

    void load()
    const intervalId = setInterval(load, 20_000)

    return () => {
      cancelRef.current = true
      clearInterval(intervalId)
    }
  }, [swarmAddress])

  return { agents, isLoading, error }
}
