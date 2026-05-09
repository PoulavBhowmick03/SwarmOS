'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSwarm }  from '@/hooks/useSwarm'
import { useAgents } from '@/hooks/useAgents'

const SWARM_ADDRESS =
  process.env.NEXT_PUBLIC_SWARM_ADDRESS ?? '6zbt4nwzetSShWEQi6AnrVwjRqLxANF9acYpPu4hQWVF'

const PROGRAM_ID  = process.env.NEXT_PUBLIC_SWARM_PROGRAM_ID ?? 'D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a'
const RPC_URL     = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const ORACLE_URL  = process.env.NEXT_PUBLIC_SCORING_ORACLE_URL ?? 'http://localhost:3001'

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
      <span style={{ fontSize: 12, color: '#F0F0F0', letterSpacing: '0.12em', fontWeight: 600 }}>NETWORK</span>
      <span style={{ color: '#1e1e2c', fontSize: 13 }}>|</span>
      {[{href: '/lineage', label: 'Lineage'}].map(({href, label}) => (
        <Link key={href} href={href} style={{ fontSize: 11, color: '#5a5a78', textDecoration: 'none', letterSpacing: '0.06em' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#9945FF')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#5a5a78')}
        >{label}</Link>
      ))}
    </header>
  )
}

function InfoRow({ label, value, mono = true, color = '#F0F0F0', href }: {
  label: string; value: string; mono?: boolean; color?: string; href?: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid #12121e',
    }}>
      <span style={{ fontSize: 10, color: '#5a5a78', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>
        {label}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{
          fontSize: 11, color: '#9945FF', textDecoration: 'none', letterSpacing: mono ? '0.04em' : '0.02em',
          fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all', textAlign: 'right', marginLeft: 16,
        }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#c084fc')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9945FF')}
        >
          {value} ↗
        </a>
      ) : (
        <span style={{
          fontSize: 11, color, letterSpacing: mono ? '0.04em' : '0.02em',
          fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all', textAlign: 'right', marginLeft: 16,
        }}>
          {value}
        </span>
      )}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 4 }}>
      <span className="label-mono" style={{ color: '#7070a0', letterSpacing: '0.2em' }}>{title}</span>
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  const color = ok ? '#14F195' : '#FF3B3B'
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: 999,
      background: color, marginRight: 6,
      boxShadow: ok ? `0 0 6px ${color}` : 'none',
      animation: ok ? 'so-pulse 2s ease-in-out infinite' : 'none',
    }}/>
  )
}

export default function NetworkPage() {
  const { swarm, isLoading: swarmLoading } = useSwarm(SWARM_ADDRESS)
  const { agents }                         = useAgents(SWARM_ADDRESS)
  const [rpcOk, setRpcOk]                 = useState<boolean | null>(null)

  useEffect(() => {
    fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    })
      .then(r => r.json())
      .then(j => setRpcOk(j?.result === 'ok'))
      .catch(() => setRpcOk(false))
  }, [])

  const terminatedCount = agents.filter(a => a.status === 'Terminated').length
  const survivedCount   = agents.filter(a => a.status === 'Survived').length
  const survivalRate    = agents.length > 0
    ? Math.round((survivedCount / agents.length) * 100) + '%'
    : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#080808', overflow: 'hidden' }}>
      <PageNav/>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>

          {/* Status banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            background: '#0d0d0d', border: '1px solid #1e1e2c', borderRadius: 4,
            marginBottom: 8,
          }}>
            <StatusDot ok={rpcOk === true}/>
            <span style={{ fontSize: 11, color: rpcOk === true ? '#14F195' : rpcOk === false ? '#FF3B3B' : '#5a5a78', letterSpacing: '0.1em' }}>
              {rpcOk === null ? 'CHECKING RPC…' : rpcOk ? 'DEVNET RPC HEALTHY' : 'RPC UNREACHABLE'}
            </span>
            {!swarmLoading && swarm && (
              <>
                <span style={{ color: '#1e1e2c' }}>|</span>
                <span style={{ fontSize: 11, color: '#9945FF', letterSpacing: '0.08em' }}>
                  GEN {swarm.generation} · {swarm.activeAgentCount} ACTIVE
                </span>
              </>
            )}
          </div>

          {/* Contracts */}
          <SectionHeader title="DEPLOYMENT"/>
          <InfoRow label="Network"    value="Solana Devnet" mono={false} color="#9945FF"/>
          <InfoRow label="Program ID" value={PROGRAM_ID}
            href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
          />
          <InfoRow label="Swarm PDA"  value={SWARM_ADDRESS}
            href={`https://explorer.solana.com/address/${SWARM_ADDRESS}?cluster=devnet`}
          />
          <InfoRow label="RPC Endpoint" value={RPC_URL} mono={false} color="#606080"/>
          <InfoRow label="Scoring Oracle" value={ORACLE_URL} mono={false} color="#606080"/>

          {/* Program instructions */}
          <SectionHeader title="PROGRAM INSTRUCTIONS"/>
          {[
            ['initialize_swarm',    'Create the swarm PDA and set authority'],
            ['bump_generation',     'Increment swarm.generation before each wave'],
            ['spawn_agent',         'Allocate agent PDA, inherit lineage context'],
            ['score_agent',         'Write oracle score to agent account'],
            ['evaluate_and_prune',  'Terminate or survive; write failure to lineage PDA'],
            ['respawn_successor',   'Spawn replacement from a terminated agent\'s lineage'],
          ].map(([ix, desc]) => (
            <div key={ix} style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: '1px solid #12121e',
            }}>
              <span style={{ fontSize: 10, color: '#9945FF', letterSpacing: '0.06em', fontWeight: 600, flexShrink: 0 }}>
                {ix}
              </span>
              <span style={{ fontSize: 10, color: '#5a5a78', marginLeft: 16, textAlign: 'right' }}>{desc}</span>
            </div>
          ))}

          {/* Swarm stats */}
          <SectionHeader title="SWARM STATE"/>
          <InfoRow label="Generation"      value={swarmLoading ? '…' : `G${swarm?.generation ?? 0}`} color="#9945FF"/>
          <InfoRow label="Total Spawned"   value={swarmLoading ? '…' : String(swarm?.totalSpawned ?? 0)} color="#F0F0F0"/>
          <InfoRow label="Active Now"      value={swarmLoading ? '…' : String(swarm?.activeAgentCount ?? 0)} color="#9945FF"/>
          <InfoRow label="Survived"        value={String(survivedCount)} color="#14F195"/>
          <InfoRow label="Terminated"      value={String(terminatedCount)} color="#FF3B3B"/>
          <InfoRow label="Survival Rate"   value={survivalRate} color="#14F195"/>
          <InfoRow label="Scoring Threshold" value={swarmLoading ? '…' : String(swarm?.scoringThreshold ?? '—')} color="#F5A623"/>
          <InfoRow label="Authority"       value={swarm?.authority ?? '—'}
            href={swarm?.authority ? `https://explorer.solana.com/address/${swarm.authority}?cluster=devnet` : undefined}
          />

          <div style={{ height: 40 }}/>
        </div>
      </div>
    </div>
  )
}
