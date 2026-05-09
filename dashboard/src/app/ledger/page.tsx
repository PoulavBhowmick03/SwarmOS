'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useAgents, AgentNode } from '@/hooks/useAgents'
import { useSwarm }             from '@/hooks/useSwarm'

const SWARM_ADDRESS =
  process.env.NEXT_PUBLIC_SWARM_ADDRESS ?? '6zbt4nwzetSShWEQi6AnrVwjRqLxANF9acYpPu4hQWVF'

type Instruction =
  | 'spawn_agent'
  | 'submit_score'
  | 'evaluate_and_prune — survived'
  | 'evaluate_and_prune — terminated'
  | 'respawn_successor'

interface LedgerEntry {
  ts: number
  instruction: Instruction
  agentId: number
  generation: number
  score: number | null
  detail: string
}

function deriveLedger(agents: AgentNode[]): LedgerEntry[] {
  const entries: LedgerEntry[] = []

  for (const a of agents) {
    entries.push({
      ts:          a.spawn_timestamp,
      instruction: 'spawn_agent',
      agentId:     a.agent_id,
      generation:  a.generation,
      score:       null,
      detail:      a.parent_id != null ? `successor of #${a.parent_id}` : 'genesis agent',
    })

    if (a.score > 0 || a.status === 'Scored' || a.status === 'Survived' || a.status === 'Terminated') {
      entries.push({
        ts:          a.spawn_timestamp + 1,
        instruction: 'submit_score',
        agentId:     a.agent_id,
        generation:  a.generation,
        score:       a.score,
        detail:      `oracle: ${a.score}/100`,
      })
    }

    if (a.status === 'Survived') {
      entries.push({
        ts:          a.spawn_timestamp + 2,
        instruction: 'evaluate_and_prune — survived',
        agentId:     a.agent_id,
        generation:  a.generation,
        score:       a.score,
        detail:      'cleared threshold',
      })
    } else if (a.status === 'Terminated') {
      entries.push({
        ts:          a.spawn_timestamp + 2,
        instruction: 'evaluate_and_prune — terminated',
        agentId:     a.agent_id,
        generation:  a.generation,
        score:       a.score,
        detail:      'lineage memory written',
      })
    } else if (a.status === 'Respawned') {
      entries.push({
        ts:          a.spawn_timestamp + 2,
        instruction: 'respawn_successor',
        agentId:     a.agent_id,
        generation:  a.generation,
        score:       a.score,
        detail:      `gen ${a.generation} successor spawned`,
      })
    }
  }

  return entries.sort((a, b) => b.ts - a.ts || b.agentId - a.agentId)
}

const IX_COLOR: Record<string, string> = {
  'spawn_agent':                      '#9945FF',
  'submit_score':                     '#38BDF8',
  'evaluate_and_prune — survived':    '#14F195',
  'evaluate_and_prune — terminated':  '#FF3B3B',
  'respawn_successor':                '#F5A623',
}

function fmtTs(unix: number): string {
  if (!unix) return '—'
  const d = new Date(unix * 1000)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function PageNav() {
  return (
    <header style={{
      height: 48, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 20px', gap: 16,
      borderBottom: '1px solid #1e1e2c',
      background: '#080808',
    }}>
      <Link href="/" style={{ fontSize: 11, color: '#9945FF', textDecoration: 'none', letterSpacing: '0.08em', fontWeight: 600 }}>
        ← SWARMOS
      </Link>
      <span style={{ color: '#1e1e2c', fontSize: 13 }}>|</span>
      <span style={{ fontSize: 12, color: '#F0F0F0', letterSpacing: '0.12em', fontWeight: 600 }}>LEDGER</span>
      <span style={{ color: '#1e1e2c', fontSize: 13 }}>|</span>
      {[
        { href: '/network',  label: 'Network'  },
        { href: '/lineage',  label: 'Lineage'  },
        { href: '/demo',     label: 'Demo'     },
      ].map(({ href, label }) => (
        <Link key={href} href={href}
          style={{ fontSize: 11, color: '#5a5a78', textDecoration: 'none', letterSpacing: '0.06em' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#9945FF')}
          onMouseLeave={e => (e.currentTarget.style.color = '#5a5a78')}
        >{label}</Link>
      ))}
    </header>
  )
}

export default function LedgerPage() {
  const { agents, isLoading } = useAgents(SWARM_ADDRESS)
  const { swarm }             = useSwarm(SWARM_ADDRESS)
  const entries               = useMemo(() => deriveLedger(agents), [agents])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#080808', overflow: 'hidden' }}>
      <PageNav/>

      {/* Toolbar */}
      <div style={{
        height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '1px solid #1e1e2c', background: '#0b0b0b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {swarm && (
            <span style={{ fontSize: 10, color: '#505068', letterSpacing: '0.1em' }}>
              GEN {swarm.generation} · {swarm.totalSpawned} TOTAL SPAWNED
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: '#606080', letterSpacing: '0.1em' }}>
          {isLoading ? '…' : `${entries.length} EVENTS`}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading && entries.length === 0 ? (
          <div style={{ padding: '20px', color: '#404060', fontSize: 11, letterSpacing: '0.1em' }}>
            fetching agent PDAs…
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '20px' }}>
            <div style={{ color: '#7070a0', letterSpacing: '0.2em', fontWeight: 600, marginBottom: 10 }}>
              NO INSTRUCTIONS RECORDED
            </div>
            <div style={{ color: '#404060', fontSize: 11, lineHeight: 1.8 }}>
              Run the swarm to see on-chain instruction activity here.
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e2c', background: '#0a0a12' }}>
                {['TIMESTAMP', 'INSTRUCTION', 'AGENT', 'GEN', 'SCORE', 'DETAIL'].map(col => (
                  <th key={col} style={{
                    padding: '8px 16px', textAlign: 'left',
                    fontSize: 9, letterSpacing: '0.14em', color: '#505068',
                    fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const color = IX_COLOR[e.instruction] ?? '#606080'
                return (
                  <tr key={i} style={{
                    background: i % 2 === 0 ? '#080808' : '#0a0a10',
                    borderBottom: '1px solid #12121e',
                  }}>
                    <td style={{ padding: '9px 16px', color: '#606080', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtTs(e.ts)}
                    </td>
                    <td style={{ padding: '9px 16px', color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {e.instruction}
                    </td>
                    <td style={{ padding: '9px 16px', color: '#9945FF', fontVariantNumeric: 'tabular-nums' }}>
                      #{e.agentId}
                    </td>
                    <td style={{ padding: '9px 16px', color: '#5a5a78' }}>
                      G{e.generation}
                    </td>
                    <td style={{ padding: '9px 16px', fontVariantNumeric: 'tabular-nums' }}>
                      {e.score != null ? (
                        <span style={{ color: e.score >= 60 ? '#14F195' : '#FF3B3B', fontWeight: 600 }}>
                          {e.score}/100
                        </span>
                      ) : (
                        <span style={{ color: '#404060' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '9px 16px', color: '#606080' }}>
                      {e.detail}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
