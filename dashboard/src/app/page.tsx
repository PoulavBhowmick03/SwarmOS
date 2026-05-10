'use client'

import { useMemo, useState }  from 'react'
import { StatsBar }           from '@/components/StatsBar'
import { SwarmVisualizer }    from '@/components/SwarmVisualizer'
import { AgentFeed }          from '@/components/AgentFeed'
import { LineagePanel }       from '@/components/LineagePanel'
import { AgentDetailPanel }   from '@/components/AgentDetailPanel'
import { useSwarm }           from '@/hooks/useSwarm'
import { useAgents }          from '@/hooks/useAgents'
import { useEvents }          from '@/hooks/useEvents'
import { useLineage }         from '@/hooks/useLineage'
import { useYields }          from '@/hooks/useYields'
import type { AgentNode }     from '@/hooks/useAgents'
import type { SwarmEvent }    from '@/lib/client'
import { LiveYields }         from '@/components/LiveYields'
import { actualApyForProtocol } from '@/lib/yields'
import { SWARM_ADDRESS }      from '@/lib/config'

/* Build a synthetic event feed from agent state for initial load */
function deriveEvents(agents: AgentNode[], yields: ReturnType<typeof useYields>['yields']): SwarmEvent[] {
  const evts: SwarmEvent[] = []
  for (const a of agents) {
    const eventTime = a.spawn_timestamp > 0 ? a.spawn_timestamp * 1000 : Date.now() - 60_000
    const protocol = a.claimed_protocol || 'Unknown protocol'
    const actual   = actualApyForProtocol(yields, protocol)
    const claimed  = a.claimed_apy
    const inh      = a.parent_id != null ? (a.agent_id % 4) + 1 : 0

    evts.push({
      type:              'AgentSpawned',
      agentId:           a.agent_id,
      generation:        a.generation,
      timestamp:         eventTime,
      protocol,
      actualAPY:         actual ?? undefined,
      claimedApyBps:     a.claimed_apy_bps,
      claimedAPY:        claimed,
      taskOutputHash:    a.task_output_hash,
      agentUsdcAta:      a.agent_usdc_ata,
      agentUsdcBalance:  a.agent_usdc_balance,
      inheritedMemories: inh,
    })

    if (a.status === 'Scored' || a.status === 'Survived' || a.status === 'Terminated') {
      evts.push({
        type:       'AgentScored',
        agentId:    a.agent_id,
        generation: a.generation,
        score:      a.score,
        timestamp:  eventTime + 5_000,
        protocol,
        actualAPY:  actual ?? undefined,
        claimedApyBps: a.claimed_apy_bps,
        claimedAPY: claimed,
        taskOutputHash: a.task_output_hash,
        agentUsdcAta: a.agent_usdc_ata,
        agentUsdcBalance: a.agent_usdc_balance,
      })
    }
    if (a.status === 'Survived') {
      evts.push({
        type:       'AgentSurvived',
        agentId:    a.agent_id,
        generation: a.generation,
        score:      a.score,
        timestamp:  eventTime + 8_000,
        protocol,
        actualAPY:  actual ?? undefined,
        claimedApyBps: a.claimed_apy_bps,
        claimedAPY: claimed,
        taskOutputHash: a.task_output_hash,
        agentUsdcAta: a.agent_usdc_ata,
        agentUsdcBalance: a.agent_usdc_balance,
      })
    }
    if (a.status === 'Terminated') {
      evts.push({
        type:       'AgentTerminated',
        agentId:    a.agent_id,
        generation: a.generation,
        score:      a.score,
        timestamp:  eventTime + 8_000,
        protocol,
        actualAPY:  actual ?? undefined,
        claimedApyBps: a.claimed_apy_bps,
        claimedAPY: claimed,
        taskOutputHash: a.task_output_hash,
        agentUsdcAta: a.agent_usdc_ata,
        agentUsdcBalance: a.agent_usdc_balance,
      })
    }
    if (a.status === 'Respawned') {
      evts.push({
        type:              'AgentRespawned',
        newAgentId:        a.agent_id,
        parentAgentId:     a.parent_id ?? undefined,
        generation:        a.generation,
        timestamp:         eventTime + 2_000,
        protocol,
        actualAPY:         actual ?? undefined,
        claimedApyBps:     a.claimed_apy_bps,
        claimedAPY:        claimed,
        taskOutputHash:    a.task_output_hash,
        agentUsdcAta:      a.agent_usdc_ata,
        agentUsdcBalance:  a.agent_usdc_balance,
        inheritedMemories: inh,
      })
    }
  }
  return evts.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50)
}

export default function SwarmDashboard() {
  const { swarm,    isLoading: swarmLoading }   = useSwarm(SWARM_ADDRESS)
  const { agents,   isLoading: agentsLoading }  = useAgents(SWARM_ADDRESS)
  const { events: liveEvents, byAgent }         = useEvents(SWARM_ADDRESS)
  const { memories, isLoading: lineageLoading } = useLineage(SWARM_ADDRESS)
  const { yields }                              = useYields()

  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null)

  // Fall back to derived events when real-time subscription has nothing yet
  const derivedEvents  = useMemo(() => deriveEvents(agents, yields), [agents, yields])
  const events         = liveEvents.length > 0 ? liveEvents : derivedEvents

  // Stats
  const survivedCount  = agents.filter((a) => a.status === 'Survived').length
  const survivalRate   = agents.length > 0
    ? Math.round((survivedCount / agents.length) * 100) + '%'
    : undefined

  const scoredAgents   = agents.filter((a) => a.score > 0)
  const avgScore       = scoredAgents.length > 0
    ? Math.round(scoredAgents.reduce((s, a) => s + a.score, 0) / scoredAgents.length) + '/100'
    : undefined

  const survivedAgents = agents.filter((a) => a.status === 'Survived')
  const bestAPY        = survivedAgents.length > 0
    ? Math.max(...survivedAgents.map((a) => a.claimed_apy)).toFixed(2) + '%'
    : undefined

  // Suppress unused warning — agentsLoading still blocks initial state
  void agentsLoading

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100vh',
      background:    '#080808',
      overflow:      'hidden',
    }}>
      <StatsBar
        swarm={swarm}
        isLoading={swarmLoading}
        survivalRate={survivalRate}
        avgScore={avgScore}
        bestAPY={bestAPY}
        events={events}
      />

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* LEFT 45% — swarm topology */}
        <div style={{
          flex: '0 0 45%',
          borderRight: '1px solid #1a1a1a',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}>
          <LiveYields/>
          <SwarmVisualizer
            agents={agents}
            swarmAddress={SWARM_ADDRESS}
            onNodeClick={setSelectedAgent}
          />
        </div>

        {/* RIGHT 55% — event stream + lineage memory */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ flex: '1 1 50%', minHeight: 0, borderBottom: '1px solid #1a1a1a' }}>
            <AgentFeed events={events}/>
          </div>
          <div style={{ flex: '1 1 50%', minHeight: 0 }}>
            <LineagePanel memories={memories} agents={agents} yields={yields} isLoading={lineageLoading}/>
          </div>
        </div>
      </main>

      {/* Agent detail panel — fixed overlay from right */}
      {selectedAgent !== null && (
        <AgentDetailPanel
          agent={selectedAgent}
          eventData={byAgent.get(selectedAgent.agent_id)}
          yields={yields}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
