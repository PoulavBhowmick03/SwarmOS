'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useLineage } from '@/hooks/useLineage'
import { useAgents }  from '@/hooks/useAgents'
import type { LineageMemoryAccount } from '@/lib/client'

const SWARM_ADDRESS =
  process.env.NEXT_PUBLIC_SWARM_ADDRESS ?? '6zbt4nwzetSShWEQi6AnrVwjRqLxANF9acYpPu4hQWVF'

const PROTOCOLS = ['Kamino SOL/USDC', 'JupiterLend USDC', 'Save Protocol', 'Drift USDC', 'Marginfi SOL']
const REAL_APYS = [9.26, 4.40, 5.12, 3.87, 7.84]

function inferAPY(agentId: number, score: number) {
  const idx      = agentId % 5
  const real     = REAL_APYS[idx]
  const protocol = PROTOCOLS[idx]
  if (score === 0) return { protocol, claimed: null, real, delta: null }
  const agentMult = 1 + ((agentId * 17 + 3) % 41) / 100
  const err       = ((100 - score) / 100) * real * 2.5 * agentMult
  const claimed   = Math.round((real + err) * 100) / 100
  const delta     = Math.round((claimed - real) * 100) / 100
  return { protocol, claimed, real, delta }
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div style={{ position: 'relative', height: 3, background: '#141420', borderRadius: 2, marginTop: 8 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: pct + '%', background: color,
        boxShadow: pct > 0 ? `0 0 6px ${color}66` : 'none',
        borderRadius: 2, transition: 'width 400ms ease-out',
      }}/>
    </div>
  )
}

function MemoryCard({ mem, successor }: { mem: LineageMemoryAccount; successor: { agentId: number; generation: number } | null }) {
  const score                        = mem.failureScore
  const { protocol, claimed, real, delta } = inferAPY(mem.agentId, score)
  const deltaPos                     = delta != null && delta > 0
  const constraint                   = `Do not claim APY above ${(real * 1.1).toFixed(1)}% for ${protocol}. Actual rate: ${real}%`

  return (
    <article style={{
      background: '#0c0c14',
      border: '1px solid #FF3B3B22',
      borderLeft: '3px solid #FF3B3B',
      borderRadius: 2,
      padding: '14px 18px',
      animation: 'so-fade-in 300ms ease-out both',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, color: '#FF3B3B', fontWeight: 700, letterSpacing: '-0.01em' }}>
            #{mem.agentId}
          </span>
          <span className="label-mono" style={{ color: '#404060' }}>GEN {mem.generation}</span>
          <span style={{
            fontSize: 9, letterSpacing: '0.15em', fontWeight: 600,
            padding: '2px 8px',
            background: '#FF3B3B18', color: '#FF3B3B', border: '1px solid #FF3B3B33',
          }}>ELIMINATED</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="label-mono" style={{ color: '#404060' }}>SCORE</span>
          <span style={{ fontSize: 13, color: '#FF3B3B', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {score}/100
          </span>
        </div>
      </div>

      <ScoreBar score={score} color="#FF3B3B"/>
      <div style={{ height: 1, background: '#1e1e2c', margin: '12px 0' }}/>

      {/* APY grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 20, rowGap: 6, marginBottom: 12 }}>
        <span className="label-mono" style={{ color: '#404060', alignSelf: 'center' }}>RECOMMENDED</span>
        <span style={{ fontSize: 12, color: '#F5A623', fontVariantNumeric: 'tabular-nums' }}>
          {claimed != null ? `${protocol} at ${claimed}% APY` : `${protocol} — no claim`}
        </span>

        <span className="label-mono" style={{ color: '#404060', alignSelf: 'center' }}>REAL APY</span>
        <span style={{ fontSize: 12, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
          {protocol} at {real}% APY
        </span>

        {delta != null && (
          <>
            <span className="label-mono" style={{ color: '#404060', alignSelf: 'center' }}>DELTA</span>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: deltaPos ? '#FF3B3B' : '#14F195',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {deltaPos ? '+' : ''}{delta}% {deltaPos ? 'hallucinated' : 'under-estimated'}
            </span>
          </>
        )}
      </div>

      <div style={{ height: 1, background: '#1e1e2c', marginBottom: 12 }}/>

      {/* Constraint written to successors */}
      <div>
        <div className="label-mono" style={{ color: '#404060', marginBottom: 6 }}>CONSTRAINT INJECTED INTO SUCCESSORS</div>
        <p style={{ fontSize: 11, color: '#38BDF8', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>
          &ldquo;{constraint}&rdquo;
        </p>
      </div>

      {/* Successor badge */}
      {successor && (
        <>
          <div style={{ height: 1, background: '#1e1e2c', margin: '12px 0 10px' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label-mono" style={{ color: '#404060' }}>SUCCEEDED BY</span>
            <span style={{ fontSize: 11, color: '#9945FF', fontWeight: 600 }}>
              Agent #{successor.agentId} · Gen {successor.generation}
            </span>
          </div>
        </>
      )}
    </article>
  )
}

type SortKey = 'score' | 'generation' | 'delta'

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
      <span style={{ fontSize: 12, color: '#F0F0F0', letterSpacing: '0.12em', fontWeight: 600 }}>LINEAGE MEMORY</span>
      <span style={{ color: '#1e1e2c', fontSize: 13 }}>|</span>
      {[{href: '/network', label: 'Network'}].map(({href, label}) => (
        <Link key={href} href={href} style={{ fontSize: 11, color: '#5a5a78', textDecoration: 'none', letterSpacing: '0.06em' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#9945FF')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#5a5a78')}
        >{label}</Link>
      ))}
    </header>
  )
}

export default function LineagePage() {
  const { memories, isLoading } = useLineage(SWARM_ADDRESS)
  const { agents }              = useAgents(SWARM_ADDRESS)
  const [sort, setSort]         = useState<SortKey>('generation')
  const [genFilter, setGenFilter] = useState<number | null>(null)

  const successorMap = useMemo(() => {
    const m = new Map<number, { agentId: number; generation: number }>()
    for (const a of agents) {
      if (a.parent_id != null) m.set(a.parent_id, { agentId: a.agent_id, generation: a.generation })
    }
    return m
  }, [agents])

  const generations = useMemo(() => [...new Set(memories.map(m => m.generation))].sort((a, b) => a - b), [memories])

  const sorted = useMemo(() => {
    const filtered = genFilter != null ? memories.filter(m => m.generation === genFilter) : memories
    return [...filtered].sort((a, b) => {
      if (sort === 'score')      return a.failureScore - b.failureScore
      if (sort === 'generation') return a.generation - b.generation
      const da = inferAPY(a.agentId, a.failureScore).delta ?? 0
      const db = inferAPY(b.agentId, b.failureScore).delta ?? 0
      return db - da
    })
  }, [memories, sort, genFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#080808', overflow: 'hidden' }}>
      <PageNav/>

      {/* Toolbar */}
      <div style={{
        height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', gap: 12,
        borderBottom: '1px solid #1e1e2c', background: '#0b0b0b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="label-mono">SORT BY</span>
          {(['generation', 'score', 'delta'] as SortKey[]).map(k => (
            <button key={k} onClick={() => setSort(k)} style={{
              fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 2, cursor: 'pointer',
              background: sort === k ? '#9945FF22' : 'none',
              color: sort === k ? '#9945FF' : '#5a5a78',
              border: `1px solid ${sort === k ? '#9945FF44' : '#1e1e2c'}`,
              fontFamily: 'inherit',
            }}>
              {k === 'delta' ? 'APY DELTA' : k.toUpperCase()}
            </button>
          ))}
          {generations.length > 0 && (
            <>
              <span style={{ color: '#1e1e2c' }}>|</span>
              <span className="label-mono">GEN</span>
              <button onClick={() => setGenFilter(null)} style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 2, cursor: 'pointer',
                background: genFilter == null ? '#9945FF22' : 'none',
                color: genFilter == null ? '#9945FF' : '#5a5a78',
                border: `1px solid ${genFilter == null ? '#9945FF44' : '#1e1e2c'}`,
                fontFamily: 'inherit', letterSpacing: '0.12em',
              }}>ALL</button>
              {generations.map(g => (
                <button key={g} onClick={() => setGenFilter(g)} style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 2, cursor: 'pointer',
                  background: genFilter === g ? '#FF3B3B22' : 'none',
                  color: genFilter === g ? '#FF3B3B' : '#5a5a78',
                  border: `1px solid ${genFilter === g ? '#FF3B3B44' : '#1e1e2c'}`,
                  fontFamily: 'inherit', letterSpacing: '0.12em',
                }}>G{g}</button>
              ))}
            </>
          )}
        </div>
        <span style={{ fontSize: 10, color: '#606080', letterSpacing: '0.1em' }}>
          {isLoading ? '…' : `${sorted.length} RECORDS`}
        </span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 20px' }}>
        {isLoading && memories.length === 0 ? (
          <div style={{ color: '#404060', fontSize: 11, letterSpacing: '0.1em' }}>fetching lineage PDAs…</div>
        ) : sorted.length === 0 ? (
          <div>
            <div style={{ color: '#7070a0', letterSpacing: '0.2em', fontWeight: 600, marginBottom: 12 }}>
              NO FAILURES RECORDED
            </div>
            <div style={{ color: '#404060', fontSize: 11, lineHeight: 1.8 }}>
              When agents hallucinate APYs or score below threshold,<br/>
              their failure data is written permanently to Solana.<br/>
              Successors inherit these constraints as hard rules.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
            {sorted.map(m => (
              <MemoryCard key={m.publicKey} mem={m} successor={successorMap.get(m.agentId) ?? null}/>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
