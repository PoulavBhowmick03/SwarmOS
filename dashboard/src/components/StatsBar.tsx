'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { SwarmAccount, SwarmEvent } from '@/lib/client'
import { VoiceNarrator } from '@/components/VoiceNarrator'

interface Props {
  swarm: SwarmAccount | null
  isLoading: boolean
  survivalRate?: string
  avgScore?: string
  bestAPY?: string
  events?: SwarmEvent[]
}

function DNALogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20"
      style={{ animation: 'dna-spin 8s linear infinite', transformStyle: 'preserve-3d' }}>
      <defs>
        <linearGradient id="dna-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9945FF"/>
          <stop offset="1" stopColor="#9945FF99"/>
        </linearGradient>
        <linearGradient id="dna-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14F195"/>
          <stop offset="1" stopColor="#14F19599"/>
        </linearGradient>
      </defs>
      <path d="M4 2 Q 16 6 4 10 Q 16 14 4 18" fill="none" stroke="url(#dna-a)" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M16 2 Q 4 6 16 10 Q 4 14 16 18" fill="none" stroke="url(#dna-b)" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="6" y1="4"  x2="14" y2="4"  stroke="#9945FF44" strokeWidth="0.7"/>
      <line x1="7" y1="8"  x2="13" y2="8"  stroke="#9945FF44" strokeWidth="0.7"/>
      <line x1="6" y1="12" x2="14" y2="12" stroke="#9945FF44" strokeWidth="0.7"/>
      <line x1="7" y1="16" x2="13" y2="16" stroke="#9945FF44" strokeWidth="0.7"/>
    </svg>
  )
}

function StatPill({ label, value, color = '#F0F0F0' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, height: '100%' }}>
      <div className="label-mono" style={{ lineHeight: 1, marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: 13, lineHeight: 1, color, fontWeight: 600,
        letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 120,
      }}>
        {value}
      </div>
    </div>
  )
}

function PulseDot({ active }: { active: boolean }) {
  const color = active ? '#14F195' : '#444'
  return (
    <span style={{ position: 'relative', width: 6, height: 6, display: 'inline-block', flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 999, background: color,
        animation: active ? 'so-pulse 2s ease-in-out infinite' : 'none',
      }}/>
      {active && (
        <span style={{
          position: 'absolute', inset: -3, borderRadius: 999,
          boxShadow: `0 0 8px ${color}`,
          animation: 'so-pulse 2s ease-in-out infinite',
        }}/>
      )}
    </span>
  )
}

function LocalClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const s = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
            `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return (
    <span style={{ fontSize: 11, color: '#606080', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
      {s}
    </span>
  )
}

export function StatsBar({ swarm, isLoading, survivalRate, avgScore, bestAPY, events = [] }: Props) {
  const dash      = isLoading ? '—' : undefined
  const active    = swarm?.activeAgentCount ?? 0
  const spawned   = swarm?.totalSpawned ?? 0
  const hasActive = active > 0

  return (
    <header style={{
      height: 48, flex: '0 0 48px',
      display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid #1a1a1a',
      background: '#080808',
    }}>
      {/* LEFT — logo + nav */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px',
        borderRight: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <DNALogo/>
        <span style={{ fontSize: 13, color: '#9945FF', letterSpacing: '0.08em', fontWeight: 600 }}>SWARMOS</span>
        <span style={{ color: '#404060', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 12, color: '#666', letterSpacing: '0.04em' }}>
          {isLoading ? '…' : (swarm?.name ?? 'devnet')}
        </span>
        <div style={{ width: 1, height: 14, background: '#1e1e2c', margin: '0 4px' }}/>
        {[
          { href: '/demo',    label: 'Demo'    },
          { href: '/ledger',  label: 'Ledger'  },
          { href: '/network', label: 'Network' },
          { href: '/lineage', label: 'Lineage' },
        ].map(({ href, label }) => (
          <Link key={href} href={href} style={{
            fontSize: 11, color: '#5a5a78', letterSpacing: '0.06em',
            textDecoration: 'none', padding: '2px 6px', borderRadius: 3,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#9945FF')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#5a5a78')}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* CENTER — stat pills */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
        <StatPill label="GENERATION" value={dash ?? ('G' + (swarm?.generation ?? 0))} color="#9945FF"/>
        <div className="divider-v"/>
        <StatPill label="ACTIVE" value={dash ?? String(active).padStart(2, '0')} color="#9945FF"/>
        <div className="divider-v"/>
        <StatPill label="SPAWNED" value={dash ?? String(spawned).padStart(3, '0')}/>
        <div className="divider-v"/>
        <StatPill label="SURVIVAL RATE" value={dash ?? (survivalRate ?? '—')} color="#14F195"/>
        <div className="divider-v"/>
        <StatPill label="AVG SCORE" value={dash ?? (avgScore ?? '—')} color="#F5A623"/>
        <div className="divider-v"/>
        <StatPill label="BEST APY FOUND" value={dash ?? (bestAPY ?? '—')} color="#14F195"/>
      </div>

      {/* RIGHT — voice + network + clock */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px',
        borderLeft: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <VoiceNarrator events={events}/>
        <div style={{ width: 1, height: 14, background: '#1a1a1a' }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <PulseDot active={hasActive}/>
          <span style={{ fontSize: 10, color: hasActive ? '#14F195' : '#444', letterSpacing: '0.18em', fontWeight: 600 }}>
            DEVNET
          </span>
        </div>
        <div style={{ width: 1, height: 14, background: '#1a1a1a' }}/>
        <LocalClock/>
      </div>
    </header>
  )
}
