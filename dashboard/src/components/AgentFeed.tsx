'use client'

import { useEffect, useRef, useState } from 'react'
import type { SwarmEvent } from '@/lib/client'

/* ─── APY inference ──────────────────────────────────── */
const PROTOCOLS = ['Kamino SOL/USDC', 'JupiterLend USDC', 'Save Protocol', 'Drift USDC', 'Marginfi SOL'] as const
const REAL_APYS = [9.26, 4.40, 5.12, 3.87, 7.84]

function agentProtocol(agentId: number): { name: string; realAPY: number } {
  const idx = agentId % 5
  return { name: PROTOCOLS[idx], realAPY: REAL_APYS[idx] }
}

function agentClaimedAPY(agentId: number, score: number): number | null {
  if (score === 0) return null
  const { realAPY } = agentProtocol(agentId)
  const err = ((100 - score) / 100) * realAPY * 2.5
  return Math.round((realAPY + err) * 100) / 100
}

/* ─── Pill styles ────────────────────────────────────── */
const PILL_STYLES: Record<SwarmEvent['type'], { bg: string; fg: string; bd: string }> = {
  AgentSpawned:    { bg: '#9945FF22', fg: '#9945FF', bd: '#9945FF44' },
  AgentScored:     { bg: '#F5A62322', fg: '#F5A623', bd: '#F5A62344' },
  AgentSurvived:   { bg: '#14F19522', fg: '#14F195', bd: '#14F19544' },
  AgentTerminated: { bg: '#FF3B3B22', fg: '#FF3B3B', bd: '#FF3B3B44' },
  AgentRespawned:  { bg: '#38BDF822', fg: '#38BDF8', bd: '#38BDF844' },
}

const TYPE_LABEL: Record<SwarmEvent['type'], string> = {
  AgentSpawned:    'SPAWNED',
  AgentScored:     'SCORED',
  AgentSurvived:   'SURVIVED',
  AgentTerminated: 'TERMINATED',
  AgentRespawned:  'RESPAWNED',
}

function formatTime(ms: number): string {
  const d   = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
}

/* ─── Event description builders ────────────────────── */
function eventMainLine(e: SwarmEvent): string {
  const id = e.agentId
  switch (e.type) {
    case 'AgentSpawned': {
      const mem = e.inheritedMemories ?? 0
      return `Agent #${id} deployed · Gen ${e.generation ?? 0} · inheriting ${mem} failure memories`
    }
    case 'AgentScored': {
      if (id == null) return 'Agent scored'
      const score    = e.score ?? 0
      const protocol = e.protocol ?? agentProtocol(id).name
      const claimed  = e.claimedAPY ?? agentClaimedAPY(id, score)
      const claimStr = claimed != null ? `at ${claimed}%` : 'no claim'
      return `Agent #${id} · ${protocol} ${claimStr} · score ${score}/100`
    }
    case 'AgentSurvived': {
      if (id == null) return 'Agent survived'
      const score    = e.score ?? 0
      const protocol = e.protocol ?? agentProtocol(id).name
      const claimed  = e.claimedAPY ?? agentClaimedAPY(id, score)
      const claimStr = claimed != null ? `at ${claimed}%` : 'no claim'
      return `Agent #${id} · ${protocol} ${claimStr} · score ${score}/100 ✓`
    }
    case 'AgentTerminated': {
      if (id == null) return 'Agent eliminated'
      const score    = e.score ?? 0
      const protocol = e.protocol ?? agentProtocol(id).name
      const claimed  = e.claimedAPY ?? agentClaimedAPY(id, score)
      const actual   = e.actualAPY ?? agentProtocol(id).realAPY
      if (claimed != null) {
        return `Agent #${id} eliminated · ${protocol} recommended ${claimed}% · real was ${actual}%`
      }
      return `Agent #${id} eliminated · ${protocol} · score ${score}/100`
    }
    case 'AgentRespawned': {
      const newId    = e.newAgentId
      const parentId = e.parentAgentId
      if (newId == null) return 'Agent respawned'
      const actual   = e.actualAPY ?? (parentId != null ? agentProtocol(parentId).realAPY : null)
      const threshold = actual != null ? (actual * 1.1).toFixed(1) : '—'
      return `Agent #${newId} respawned from #${parentId ?? '?'} · warned: do not claim APY > ${threshold}%`
    }
  }
}

function eventSubLine(e: SwarmEvent): { text: string; color: string } {
  const id = e.agentId
  switch (e.type) {
    case 'AgentSpawned':
      return {
        text: `Task: find best yield opportunity · Gen ${e.generation ?? 0}`,
        color: '#505068',
      }
    case 'AgentScored': {
      const score   = e.score ?? 0
      if (id == null) return { text: 'Scored', color: '#888' }
      const realAPY = agentProtocol(id).realAPY
      const claimed = e.claimedAPY ?? agentClaimedAPY(id, score)
      if (claimed == null) return { text: 'No APY claim recorded', color: '#505068' }
      const delta = Math.abs(claimed - realAPY)
      if (score >= 60) {
        return {
          text: `Recommendation matched live APY within ${delta.toFixed(2)}%`,
          color: '#14F195',
        }
      } else {
        const mult = realAPY > 0 ? (claimed / realAPY).toFixed(1) : '?'
        return {
          text: `APY claim ${mult}x higher than real rate`,
          color: '#F5A623',
        }
      }
    }
    case 'AgentSurvived':
      return {
        text: 'Genetic memory preserved · successors inherit accuracy',
        color: '#14F195',
      }
    case 'AgentTerminated':
      return {
        text: 'Failure written to chain · successors warned',
        color: '#FF3B3B',
      }
    case 'AgentRespawned': {
      const parentId = e.parentAgentId
      return {
        text: `Inherits failure context from parent #${parentId ?? '?'}`,
        color: '#38BDF8',
      }
    }
  }
}

/* ─── EventRow ───────────────────────────────────────── */
function EventRow({ event, isNew }: { event: SwarmEvent; isNew: boolean }) {
  const p    = PILL_STYLES[event.type]
  const sub  = eventSubLine(event)
  const main = eventMainLine(event)

  return (
    <div style={{
      flex: '0 0 44px',
      height: 44,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '0 16px',
      borderBottom: '1px solid #18182a',
      animation: isNew ? 'slide-in-top 220ms ease-out both' : 'none',
      gap: 1,
    }}>
      {/* Line 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 10, color: '#606080', fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.04em', minWidth: 56, flexShrink: 0,
        }}>
          {formatTime(event.timestamp)}
        </span>
        <span style={{
          fontSize: 9, letterSpacing: '0.15em', fontWeight: 600,
          padding: '2px 6px',
          background: p.bg, color: p.fg, border: `1px solid ${p.bd}`,
          minWidth: 82, textAlign: 'center',
          flexShrink: 0,
        }}>
          {TYPE_LABEL[event.type]}
        </span>
        <span style={{
          fontSize: 11, color: '#888',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {main}
        </span>
      </div>

      {/* Line 2 */}
      <div style={{ paddingLeft: 66 + 82 + 10 }}>
        <span style={{
          fontSize: 10, color: sub.color,
          fontStyle: 'italic',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'block',
        }}>
          {sub.text}
        </span>
      </div>
    </div>
  )
}

/* ─── AgentFeed ──────────────────────────────────────── */
interface Props {
  events: SwarmEvent[]
}

export function AgentFeed({ events }: Props) {
  const newestRef = useRef<number | undefined>(events[0]?.timestamp)
  const [latestTs, setLatestTs] = useState<number | undefined>(events[0]?.timestamp)

  useEffect(() => {
    if (events[0]?.timestamp !== newestRef.current) {
      newestRef.current = events[0]?.timestamp
      setLatestTs(events[0]?.timestamp)
    }
  }, [events])

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 32, flex: '0 0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid #1a1a1a',
        background: '#0b0b0b',
      }}>
        <span className="label-mono">EVENT STREAM</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 5, height: 5, borderRadius: 999, background: '#14F195',
            animation: 'so-pulse 2s ease-in-out infinite',
            boxShadow: '0 0 6px #14F195',
            display: 'inline-block',
          }}/>
          <span style={{ fontSize: 9, color: '#14F195', letterSpacing: '0.18em', fontWeight: 600 }}>LIVE</span>
        </div>
      </div>

      {/* Event rows */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: '#080808' }}>
        {events.length === 0 ? (
          <div style={{
            padding: '32px 24px', color: '#505068', fontSize: 12,
            letterSpacing: '0.1em', lineHeight: 1.8,
          }}>
            <div style={{ color: '#7070a0', letterSpacing: '0.2em', fontWeight: 600, marginBottom: 16 }}>
              AWAITING SWARM INITIALIZATION
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              Run parent.ts to start the Darwinian selection cycle.
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              Agents will compete on live DeFi yield data from Kamino,
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              JupiterLend, and Save Protocol.
            </div>
            <div style={{ marginTop: 16 }}>
              <span style={{ animation: 'so-blink 1.1s step-end infinite', color: '#505068' }}>_</span>
            </div>
          </div>
        ) : (
          events.map((e, i) => (
            <EventRow
              key={`${e.type}-${e.timestamp}-${i}`}
              event={e}
              isNew={e.timestamp === latestTs}
            />
          ))
        )}
      </div>
    </section>
  )
}
