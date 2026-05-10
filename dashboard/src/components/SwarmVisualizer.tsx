'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import type { AgentNode } from '@/hooks/useAgents'
import { formatPercent, formatUsdc } from '@/lib/yields'

interface Props {
  agents: AgentNode[]
  swarmAddress?: string
  onNodeClick?: (agent: AgentNode) => void
}

const SUMMARY_THRESHOLD = 30

const STATUS_COLOR: Record<AgentNode['status'], string> = {
  Active:     '#9945FF',
  Survived:   '#14F195',
  Scored:     '#F5A623',
  Respawned:  '#38BDF8',
  Terminated: '#FF3B3B',
}

function survivalColor(rate: number): string {
  return rate > 0.7 ? '#14F195' : rate >= 0.5 ? '#F5A623' : '#FF3B3B'
}

/* ─── Individual mode helpers ───────────────────────── */

const TOP_PAD  = 48
const LABEL_H  = 20
const ROW_H    = 30
const ROW_PAD  = 24
const SIDE_PAD = 40
const MIN_STEP = 24

function nodeRadius(score: number, perRow: number): number {
  const minRadius = perRow > 20 ? 7 : perRow > 10 ? 9 : 11
  const range = perRow > 20 ? 4  : perRow > 10 ? 6  : 8
  return minRadius + (Math.min(100, Math.max(0, score)) / 100) * range
}

interface NodeColors { fill: string; glow: string | null; dashed: boolean; stroke: string }

function nodeColors(status: AgentNode['status']): NodeColors {
  switch (status) {
    case 'Active':     return { fill: '#9945FF', glow: '#9945FF', dashed: false, stroke: 'none' }
    case 'Survived':   return { fill: '#14F195', glow: '#14F195', dashed: false, stroke: 'none' }
    case 'Scored':     return { fill: '#F5A623', glow: '#F5A623', dashed: false, stroke: 'none' }
    case 'Respawned':  return { fill: '#38BDF8', glow: '#38BDF8', dashed: false, stroke: 'none' }
    case 'Terminated': return { fill: 'transparent', glow: null,      dashed: true,  stroke: '#FF3B3B' }
    default:           return { fill: '#666',        glow: null,      dashed: false, stroke: 'none' }
  }
}

function Legend() {
  const items: [AgentNode['status'], string][] = [
    ['Active', 'ACTIVE'], ['Survived', 'SURVIVED'], ['Scored', 'SCORED'],
    ['Respawned', 'RESPAWNED'], ['Terminated', 'TERMINATED'],
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {items.map(([s, l]) => (
        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 6, height: 6, flexShrink: 0, borderRadius: 999,
            background: s === 'Terminated' ? 'transparent' : STATUS_COLOR[s],
            border: s === 'Terminated' ? `1px solid ${STATUS_COLOR[s]}` : 'none',
          }}/>
          <span style={{ fontSize: 9, color: '#5a5a78', letterSpacing: '0.15em' }}>{l}</span>
        </div>
      ))}
    </div>
  )
}

/* ─── Summary mode helpers ──────────────────────────── */

interface GenStat {
  gen: number
  list: AgentNode[]
  survived: number
  terminated: number
  total: number
  survivalRate: number
}

function MiniNode({ agent, onNodeClick }: { agent: AgentNode; onNodeClick?: (a: AgentNode) => void }) {
  const terminated = agent.status === 'Terminated'
  return (
    <div
      title={`#${agent.agent_id} · ${agent.status} · ${agent.claimed_protocol || 'no claim'} ${formatPercent(agent.claimed_apy)} · ${agent.score > 0 ? agent.score + '/100' : 'unscored'}`}
      onClick={() => onNodeClick?.(agent)}
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        cursor: 'pointer',
        background: terminated ? 'transparent' : STATUS_COLOR[agent.status],
        border: terminated ? `1.5px solid ${STATUS_COLOR.Terminated}` : 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

function GenRow({ g, onNodeClick }: { g: GenStat; onNodeClick?: (a: AgentNode) => void }) {
  const rate      = g.survivalRate
  const rateColor = survivalColor(rate)

  const sorted = useMemo(() => [
    ...g.list.filter(a => a.status === 'Terminated'),
    ...g.list.filter(a => a.status !== 'Terminated'),
  ], [g.list])

  const MAX_NODES = 40
  const shown     = sorted.slice(0, MAX_NODES)
  const overflow  = sorted.length - MAX_NODES

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #18182a' }}>
      {/* Progress bar row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, color: '#5a5a78', letterSpacing: '0.08em',
          fontFamily: 'var(--mono)', width: 38, flexShrink: 0,
        }}>
          GEN {g.gen}
        </span>
        <div style={{ flex: 1, height: 5, background: '#111', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: (rate * 100).toFixed(1) + '%',
            background: rateColor,
            borderRadius: 3,
            opacity: 0.8,
            transition: 'width 0.5s ease',
          }}/>
        </div>
        <span style={{
          fontSize: 10, color: rateColor, fontVariantNumeric: 'tabular-nums',
          flexShrink: 0, letterSpacing: '0.04em', minWidth: 80, textAlign: 'right',
        }}>
          {Math.round(rate * 100)}% survived
        </span>
        <span style={{
          fontSize: 9, color: '#505068', flexShrink: 0,
          width: 52, textAlign: 'right', letterSpacing: '0.04em',
        }}>
          {g.survived}/{g.total}
        </span>
      </div>

      {/* Mini-node row */}
      <div style={{
        display: 'flex', alignItems: 'center',
        flexWrap: 'wrap', gap: 3, paddingLeft: 48,
      }}>
        {shown.map(a => (
          <MiniNode key={a.agent_id} agent={a} onNodeClick={onNodeClick}/>
        ))}
        {overflow > 0 && (
          <span style={{ fontSize: 9, color: '#505068', letterSpacing: '0.08em', paddingLeft: 2 }}>
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  )
}

function EvolutionStrip({ genStats }: { genStats: GenStat[] }) {
  return (
    <div style={{
      flex: '0 0 44px', height: 44,
      display: 'flex', alignItems: 'center',
      padding: '0 16px',
      borderBottom: '1px solid #111',
      background: '#060606',
      overflowX: 'auto',
      gap: 0,
    }}>
      <span style={{
        fontSize: 8, color: '#404060', letterSpacing: '0.12em',
        marginRight: 12, flexShrink: 0, fontFamily: 'var(--mono)',
      }}>
        EVOLUTION
      </span>
      {genStats.map((g, i) => (
        <div key={g.gen} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && (
            <span style={{ fontSize: 11, color: '#404060', padding: '0 8px' }}>→</span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{
              fontSize: 8, color: '#5a5a78', letterSpacing: '0.1em', fontFamily: 'var(--mono)',
            }}>
              GEN {g.gen}
            </span>
            <span style={{
              fontSize: 13, fontWeight: 700, color: survivalColor(g.survivalRate),
              fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)',
            }}>
              {Math.round(g.survivalRate * 100)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Empty state ───────────────────────────────────── */

function EmptyState() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 11, color: '#5a5a78', letterSpacing: '0.2em',
          marginBottom: 14, fontFamily: 'var(--mono)',
        }}>
          AWAITING AGENTS
        </div>
        <div style={{
          fontSize: 11, color: '#404060', lineHeight: 2,
          fontFamily: 'var(--mono)', marginBottom: 18,
        }}>
          Start the swarm to begin Darwinian selection.<br/>
          Agents will compete on live yield data from<br/>
          <span style={{ color: '#505068' }}>Kamino · JupiterLend · Save · Drift</span>
        </div>
        <div style={{
          display: 'inline-block',
          padding: '7px 14px',
          background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 4,
          fontSize: 10, color: '#505068', letterSpacing: '0.06em',
          fontFamily: 'var(--mono)',
        }}>
          $ npx ts-node src/parent.ts --task yield-optimizer
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ────────────────────────────────── */

interface HoverState { agent: AgentNode; x: number; y: number }

export function SwarmVisualizer({ agents, swarmAddress, onNodeClick }: Props) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const [size, setSize]     = useState({ w: 800, h: 600 })
  const [hover, setHover]   = useState<HoverState | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect
        setSize({ w: Math.max(300, width), h: Math.max(200, height) })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gens = useMemo(() => {
    const m = new Map<number, AgentNode[]>()
    agents.forEach((a) => {
      if (!m.has(a.generation)) m.set(a.generation, [])
      m.get(a.generation)!.push(a)
    })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [agents])

  const genStats: GenStat[] = useMemo(() => gens.map(([gen, list]) => {
    const survived   = list.filter(a => a.status === 'Survived').length
    const terminated = list.filter(a => a.status === 'Terminated').length
    const total      = list.length
    return { gen, list, survived, terminated, total, survivalRate: total > 0 ? survived / total : 0 }
  }), [gens])

  const agentById = useMemo(() => new Map(agents.map(a => [a.agent_id, a])), [agents])

  const truncAddr = swarmAddress
    ? swarmAddress.slice(0, 8) + '…' + swarmAddress.slice(-8)
    : ''

  const handleCopy = () => {
    if (swarmAddress) navigator.clipboard?.writeText(swarmAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isSummary = agents.length > SUMMARY_THRESHOLD

  /* ── Individual mode layout ─────────────────────── */

  const layout = useMemo(() => {
    if (isSummary) {
      return {
        pos: new Map<number, { x: number; y: number }>(),
        genLabelY: new Map<number, number>(),
        svgH: 0, perRow: 0,
      }
    }
    const pos       = new Map<number, { x: number; y: number }>()
    const genLabelY = new Map<number, number>()
    const usableW   = Math.max(1, size.w - SIDE_PAD * 2)
    const perRow    = Math.max(1, Math.floor(usableW / MIN_STEP))

    let curY = TOP_PAD
    gens.forEach(([g, list]) => {
      genLabelY.set(g, curY)
      curY += LABEL_H
      const numRows = Math.ceil(list.length / perRow)
      list.forEach((a, i) => {
        const row    = Math.floor(i / perRow)
        const col    = i % perRow
        const rowLen = row === numRows - 1 ? list.length - row * perRow : perRow
        const span   = (rowLen - 1) * MIN_STEP
        const startX = SIDE_PAD + Math.max(0, (usableW - span) / 2)
        pos.set(a.agent_id, { x: startX + col * MIN_STEP, y: curY + row * ROW_H })
      })
      curY += numRows * ROW_H + ROW_PAD
    })

    return { pos, genLabelY, svgH: Math.max(curY + 20, size.h), perRow }
  }, [isSummary, gens, size.w, size.h])

  /* ── Shared header ──────────────────────────────── */

  const header = (
    <div style={{
      height: 32, flex: '0 0 32px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', borderBottom: '1px solid #1a1a1a', background: '#0b0b0b',
    }}>
      <span className="label-mono">SWARM TOPOLOGY</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {!isSummary && <Legend/>}
        <span style={{ fontSize: 10, color: '#606080', letterSpacing: '0.15em' }}>
          {String(agents.length).padStart(3, '0')} NODES
        </span>
        {isSummary && (
          <span style={{ fontSize: 9, color: '#404060', letterSpacing: '0.12em' }}>SUMMARY VIEW</span>
        )}
      </div>
    </div>
  )

  /* ── Summary mode ───────────────────────────────── */

  if (isSummary) {
    return (
      <section style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', minHeight: 0, position: 'relative',
      }}>
        {header}
        <EvolutionStrip genStats={genStats}/>
        <div style={{ flex: 1, overflowY: 'auto', background: '#080808' }}>
          {genStats.map(g => (
            <GenRow key={g.gen} g={g} onNodeClick={onNodeClick}/>
          ))}
        </div>
        {swarmAddress && (
          <button onClick={handleCopy} style={{
            position: 'absolute', left: 16, bottom: 12,
            fontSize: 10, color: copied ? '#14F195' : '#505068',
            letterSpacing: '0.1em', padding: 0,
            background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 200ms',
          }}>
            {copied ? '✓ COPIED' : truncAddr + '  ⧉'}
          </button>
        )}
      </section>
    )
  }

  /* ── Individual mode ────────────────────────────── */

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {header}

      <div ref={containerRef} style={{
        flex: 1, position: 'relative',
        overflow: 'hidden', overflowY: 'auto',
        background: '#080808',
      }}>
        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(to right, #0f0f0f 1px, transparent 1px),' +
            'linear-gradient(to bottom, #0f0f0f 1px, transparent 1px)',
          backgroundSize: '40px 40px', opacity: 0.5, pointerEvents: 'none',
        }}/>

        {/* Gen rail labels */}
        {gens.map(([g]) => {
          const y = layout.genLabelY.get(g) ?? 0
          return (
            <div key={'rail-' + g} style={{
              position: 'absolute', left: 0, right: 0, top: y,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 16px', height: LABEL_H, pointerEvents: 'none',
            }}>
              <span className="label-mono" style={{ color: '#5a5a78', flexShrink: 0 }}>GEN {g}</span>
              <div style={{ flex: 1, height: 1, background: '#18182a' }}/>
            </div>
          )
        })}

        <svg
          width={size.w}
          height={layout.svgH}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          <defs>
            <style>{`@keyframes march { to { stroke-dashoffset: -7; } }`}</style>
          </defs>

          {/* Edges: terminated→child (dashed purple marching) | survived→child (thin green) */}
          {agents.map((a) => {
            if (a.parent_id == null) return null
            const parent = agentById.get(a.parent_id)
            if (!parent) return null
            if (parent.status !== 'Terminated' && parent.status !== 'Survived') return null

            const p = layout.pos.get(a.parent_id)
            const c = layout.pos.get(a.agent_id)
            if (!p || !c) return null

            const pr   = nodeRadius(parent.score, layout.perRow)
            const cr   = nodeRadius(a.score, layout.perRow)
            const dx   = c.x - p.x
            const dy   = c.y - p.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const x1   = p.x + (dx / dist) * pr
            const y1   = p.y + (dy / dist) * pr
            const x2   = c.x - (dx / dist) * (cr + 3)
            const y2   = c.y - (dy / dist) * (cr + 3)

            if (parent.status === 'Terminated') {
              return (
                <line key={'edge-' + a.id}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#9945FF" strokeWidth="0.5"
                  strokeDasharray="4 3" opacity={0.4}
                  style={{ animation: 'march 1.5s linear infinite' }}
                />
              )
            }
            return (
              <line key={'edge-' + a.id}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#14F195" strokeWidth="0.5" opacity={0.3}
              />
            )
          })}

          {/* Nodes */}
          {agents.map((a) => {
            const p = layout.pos.get(a.agent_id)
            if (!p) return null
            const r   = nodeRadius(a.score, layout.perRow)
            const col = nodeColors(a.status)

            const arcRing = (a.status === 'Scored' || a.status === 'Survived') && a.score > 0 ? (() => {
              const arcR          = r + 2.5
              const circumference = 2 * Math.PI * arcR
              const arcLen        = (a.score / 100) * circumference
              const arcColor      = a.score >= 80 ? '#14F195' : a.score >= 50 ? '#F5A623' : '#FF3B3B'
              return (
                <circle
                  cx={p.x} cy={p.y} r={arcR}
                  fill="none" stroke={arcColor} strokeWidth="2"
                  strokeDasharray={`${arcLen} ${circumference}`}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${p.x} ${p.y})`}
                  opacity={0.85}
                />
              )
            })() : null

            return (
              <g key={'n-' + a.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover({ agent: a, x: p.x, y: p.y })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onNodeClick?.(a)}>
                {col.glow ? (
                  <circle cx={p.x} cy={p.y} r={r}
                    fill={col.fill}
                    style={{ filter: `drop-shadow(0 0 ${r * 0.6}px ${col.glow}99)` }}/>
                ) : (
                  <circle cx={p.x} cy={p.y} r={r}
                    fill={col.fill} stroke={col.stroke}
                    strokeWidth={1.5} strokeDasharray={col.dashed ? '3 2' : ''}/>
                )}
                {arcRing}
                {a.status === 'Terminated' ? (
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9"
                    fill="#FF3B3B" fontFamily="JetBrains Mono, monospace" fontWeight="700"
                    style={{ pointerEvents: 'none' }}>×</text>
                ) : r >= 11 ? (
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="7"
                    fill="#fff" fontFamily="JetBrains Mono, monospace" fontWeight="600"
                    style={{ pointerEvents: 'none' }}>{a.agent_id}</text>
                ) : null}
              </g>
            )
          })}
        </svg>

        {/* Hover tooltip */}
        {hover && (() => {
          const a    = hover.agent
          const left = Math.min(Math.max(hover.x - 90, 8), size.w - 192)
          const top  = Math.max(8, hover.y - 126)
          return (
            <div style={{
              position: 'absolute', left, top, width: 182,
              background: '#161616', border: '1px solid #2a2a2a',
              padding: '8px 10px', pointerEvents: 'none', zIndex: 10,
              fontSize: 11, lineHeight: 1.6, color: '#888',
            }}>
              <div style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', marginBottom: 4 }}>
                AGENT #{a.agent_id}
              </div>
              <div>
                Gen <span style={{ color: '#ccc' }}>{a.generation}</span>
                {' · '}
                <span style={{ color: STATUS_COLOR[a.status] }}>{a.status}</span>
              </div>
              <div>Score: <span style={{ color: '#F0F0F0' }}>
                {a.score === 0 && a.status === 'Active' ? '—' : a.score + '/100'}
              </span></div>
              <div style={{
                color: '#9945FF', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
              }}>
                {a.claimed_protocol || a.task_type}
              </div>
              <div>Claim: <span style={{ color: '#F5A623' }}>{formatPercent(a.claimed_apy)}</span></div>
              <div>USDC: <span style={{ color: a.agent_usdc_balance && a.agent_usdc_balance > 0 ? '#14F195' : '#606080' }}>
                {formatUsdc(a.agent_usdc_balance)}
              </span></div>
              {onNodeClick && (
                <div style={{ marginTop: 4, fontSize: 9, color: '#505068', letterSpacing: '0.12em' }}>
                  CLICK TO INSPECT
                </div>
              )}
            </div>
          )
        })()}

        {/* Empty state */}
        {agents.length === 0 && <EmptyState/>}

        {/* Address copy */}
        {swarmAddress && (
          <button onClick={handleCopy} style={{
            position: 'absolute', left: 16, bottom: 12,
            fontSize: 10, color: copied ? '#14F195' : '#505068',
            letterSpacing: '0.1em', padding: 0,
            background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 200ms',
          }}>
            {copied ? '✓ COPIED' : truncAddr + '  ⧉'}
          </button>
        )}
      </div>
    </section>
  )
}
