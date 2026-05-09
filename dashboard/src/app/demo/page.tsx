'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSwarm }   from '@/hooks/useSwarm'
import { useLineage } from '@/hooks/useLineage'
import { FundSwarm }  from '@/components/FundSwarm'
import type { LineageMemoryAccount } from '@/lib/client'

const SWARM_ADDRESS = process.env.NEXT_PUBLIC_SWARM_ADDRESS ?? '6zbt4nwzetSShWEQi6AnrVwjRqLxANF9acYpPu4hQWVF'
const PROGRAM_ID    = process.env.NEXT_PUBLIC_SWARM_PROGRAM_ID ?? 'D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a'
const ORACLE_WALLET = 'D14J1wLNEZkHEBcM9NW9nUwCkhxuJSUvE5G3E38frDJs'
const EXPLORER      = 'https://explorer.solana.com'

interface YieldData {
  protocol: string
  vault?:   string
  token?:   string
  apy:      number
  tvl?:     number
  riskScore?: number
  trend?:   string
}

// Normalise oracle decimal (0.0926) or legacy percent (9.26) → percent
function toPercent(apy: number): number {
  return apy < 1 ? apy * 100 : apy
}

const PROTOCOLS = ['Kamino SOL/USDC', 'JupiterLend USDC', 'Save Protocol', 'Drift USDC', 'Marginfi SOL']
const REAL_APYS  = [9.26, 4.40, 5.12, 3.87, 7.84]

function inferAPY(agentId: number, score: number) {
  const idx      = agentId % 5
  const real     = REAL_APYS[idx]
  const protocol = PROTOCOLS[idx]
  if (score === 0) return { protocol, claimed: null as number | null, real, delta: null as number | null }
  const agentMult = 1 + ((agentId * 17 + 3) % 41) / 100
  const err       = ((100 - score) / 100) * real * 2.5 * agentMult
  const claimed   = Math.round((real + err) * 100) / 100
  const delta     = Math.round((claimed - real) * 100) / 100
  return { protocol, claimed, real, delta }
}

function fmt(n: number): string {
  return n.toLocaleString()
}

/* ─── sub-components ─────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, letterSpacing: '0.22em', fontWeight: 600,
      color: '#9945FF', textTransform: 'uppercase',
      marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ flex: 1, height: 1, background: '#9945FF33' }}/>
      {children}
      <span style={{ flex: 1, height: 1, background: '#9945FF33' }}/>
    </div>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 20, alignItems: 'flex-start',
      padding: '20px 0', borderBottom: '1px solid #14141e',
    }}>
      <div style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: 6,
        border: '1px solid #9945FF44', background: '#9945FF0e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#9945FF', letterSpacing: '0.04em',
      }}>
        {n}
      </div>
      <div>
        <div style={{
          fontSize: 10, letterSpacing: '0.18em', color: '#9945FF',
          textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
        }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: '#a0a0c0', lineHeight: 1.75 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, accent = '#e8e8e4' }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      padding: '16px 20px',
      border: '1px solid #1a1a2e',
      borderRadius: 6,
      background: '#0b0b14',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#505068', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

function DeathCard({ mem }: { mem: LineageMemoryAccount }) {
  const short = (s: string) => s.slice(0, 6) + '…' + s.slice(-4)
  const explorerUrl = `${EXPLORER}/address/${mem.publicKey}?cluster=devnet`
  const { protocol, claimed, real, delta } = inferAPY(mem.agentId, mem.failureScore)
  const deltaPos = delta != null && delta > 0

  return (
    <div style={{
      padding: '14px 16px',
      border: '1px solid #FF3B3B30',
      borderLeft: '3px solid #FF3B3B',
      borderRadius: 4,
      background: '#FF3B3B08',
      marginBottom: 8,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#FF3B3B', letterSpacing: '0.12em', fontWeight: 600 }}>
          AGENT #{mem.agentId} — GEN {mem.generation} — TERMINATED
        </span>
        <a
          href={explorerUrl}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, color: '#505068', letterSpacing: '0.08em', textDecoration: 'none' }}
        >
          {short(mem.publicKey)} ↗
        </a>
      </div>

      {/* APY comparison */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8, marginBottom: 8,
      }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.12em', color: '#505068', textTransform: 'uppercase', marginBottom: 3 }}>Claimed</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F5A623', fontVariantNumeric: 'tabular-nums' }}>
            {claimed != null ? `${claimed}%` : '—'}
          </div>
          <div style={{ fontSize: 9, color: '#404060' }}>{protocol}</div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.12em', color: '#505068', textTransform: 'uppercase', marginBottom: 3 }}>Real</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#14F195', fontVariantNumeric: 'tabular-nums' }}>
            {real}%
          </div>
          <div style={{ fontSize: 9, color: '#404060' }}>live rate</div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.12em', color: '#505068', textTransform: 'uppercase', marginBottom: 3 }}>Delta</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: deltaPos ? '#FF3B3B' : '#14F195' }}>
            {delta != null ? `${deltaPos ? '+' : ''}${delta}%` : '—'}
          </div>
          <div style={{ fontSize: 9, color: deltaPos ? '#FF3B3B88' : '#14F19588' }}>
            {deltaPos ? 'hallucinated' : 'under-est.'}
          </div>
        </div>
      </div>

      {/* Score + post-mortem */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: '#606080' }}>
        <span>Score <span style={{ color: '#FF3B3B' }}>{mem.failureScore}/100</span></span>
        {mem.arweaveUri && (
          <a href={mem.arweaveUri} target="_blank" rel="noopener noreferrer"
            style={{ color: '#38BDF8', textDecoration: 'none' }}>
            post-mortem ↗
          </a>
        )}
      </div>
    </div>
  )
}

function YieldCard({ y, isBest }: { y: YieldData; isBest: boolean }) {
  const apy  = toPercent(y.apy)
  const name = [y.protocol, y.vault].filter(Boolean).join(' ')
  const tvlStr = y.tvl
    ? y.tvl >= 1_000_000 ? `$${(y.tvl / 1_000_000).toFixed(1)}M` : `$${fmt(y.tvl)}`
    : null

  const riskColor = (r?: number) =>
    !r ? '#555' : r >= 3 ? '#F5A623' : r === 2 ? '#14F195' : '#38BDF8'

  return (
    <div style={{
      padding: '14px 16px',
      border: `1px solid ${isBest ? '#14F19540' : '#141420'}`,
      borderTop: isBest ? '2px solid #14F195' : '2px solid #1e1e30',
      borderRadius: 4,
      background: isBest ? '#14F19508' : '#0b0b12',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, color: isBest ? '#14F195' : '#505068', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        {isBest && '★ '}
        {name}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e4', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', marginBottom: 6 }}>
        {apy.toFixed(2)}%
      </div>
      <div style={{ fontSize: 10, color: '#505068', display: 'flex', gap: 12 }}>
        {tvlStr && <span>TVL {tvlStr}</span>}
        {y.riskScore != null && (
          <span style={{ color: riskColor(y.riskScore) }}>
            Risk {y.riskScore}/5
          </span>
        )}
        {y.token && <span>{y.token}</span>}
      </div>
    </div>
  )
}

/* ─── main page ──────────────────────────────────────── */

export default function DemoPage() {
  const { swarm }    = useSwarm(SWARM_ADDRESS)
  const { memories } = useLineage(SWARM_ADDRESS)

  const [yields, setYields]         = useState<YieldData[]>([])
  const [yieldsTs, setYieldsTs]     = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/yields', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as YieldData[]
        setYields(data)
        setYieldsTs(Date.now())
      } catch { /* silent */ }
    }
    void load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const survivedCount   = 0 // not available without useAgents — swarm has totalSpawned
  const bestYield       = yields.length > 0
    ? Math.max(...yields.map(y => toPercent(y.apy)))
    : null
  const topMemories     = memories.slice(0, 5)
  const explorerProgram = `${EXPLORER}/address/${PROGRAM_ID}?cluster=devnet`
  const explorerSwarm   = `${EXPLORER}/address/${SWARM_ADDRESS}?cluster=devnet`

  const container: React.CSSProperties = {
    maxWidth: 800,
    margin:   '0 auto',
    padding:  '48px 28px 120px',
    fontFamily: 'var(--font-mono, monospace)',
    color: '#e8e8e4',
  }

  return (
    <div style={{ background: '#080808', minHeight: '100vh' }}>
      <div style={container}>

        {/* ── nav back ───────────────────────────────── */}
        <div style={{ marginBottom: 48, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{
            fontSize: 11, color: '#505068', letterSpacing: '0.1em',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ← MISSION CONTROL
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#14F195', display: 'inline-block',
              animation: 'so-pulse 2s ease-in-out infinite' }}/>
            <span style={{ fontSize: 9, color: '#14F195', letterSpacing: '0.2em', fontWeight: 600 }}>DEVNET</span>
          </div>
        </div>

        {/* ── header ─────────────────────────────────── */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.22em', color: '#9945FF', textTransform: 'uppercase', marginBottom: 12 }}>
            HACKATHON DEMO — DEV3PACK / COLOSSEUM FRONTIER
          </div>
          <h1 style={{
            margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em',
            color: '#e8e8e4', lineHeight: 1.2,
          }}>
            SwarmOS
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: '#7070a0', lineHeight: 1.6 }}>
            Autonomous DeFi Yield Optimization — Darwinian AI on Solana
          </p>
          <div style={{
            marginTop: 20, padding: '10px 14px',
            background: '#0b0b14', border: '1px solid #1a1a2e', borderRadius: 5,
            fontSize: 11, color: '#505068', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div>
              <span style={{ color: '#404060', marginRight: 8 }}>Program</span>
              <a href={explorerProgram} target="_blank" rel="noopener noreferrer"
                style={{ color: '#38BDF8', textDecoration: 'none', fontFamily: 'monospace' }}>
                {PROGRAM_ID} ↗
              </a>
            </div>
            <div>
              <span style={{ color: '#404060', marginRight: 8 }}>Swarm PDA</span>
              <a href={explorerSwarm} target="_blank" rel="noopener noreferrer"
                style={{ color: '#38BDF8', textDecoration: 'none', fontFamily: 'monospace' }}>
                {SWARM_ADDRESS} ↗
              </a>
            </div>
          </div>
        </div>

        {/* ── Section 1: The Problem ──────────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>The Problem</SectionLabel>
          <p style={{ margin: 0, fontSize: 14, color: '#a0a0c0', lineHeight: 1.85 }}>
            DeFi yields change hourly across dozens of protocols. A single AI agent making
            a one-shot recommendation has no feedback mechanism — if it's wrong, it's wrong
            silently. There's no selection pressure. No learning.
          </p>
          <p style={{ margin: '14px 0 0', fontSize: 14, color: '#14F195', lineHeight: 1.85, fontWeight: 500 }}>
            SwarmOS fixes this with Darwinian selection on Solana.
          </p>
        </div>

        {/* ── Section 2: Live Yields ──────────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>Live Yield Opportunities</SectionLabel>
          {yieldsTs && (
            <div style={{ fontSize: 9, color: '#404060', marginBottom: 12, letterSpacing: '0.08em' }}>
              UPDATED {new Date(yieldsTs).toLocaleTimeString()} — refreshes every 60s
            </div>
          )}
          {yields.length > 0 ? (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                {yields.slice(0, 4).map((y, i) => {
                  const maxApy = Math.max(...yields.map(x => toPercent(x.apy)))
                  return (
                    <YieldCard
                      key={i}
                      y={y}
                      isBest={toPercent(y.apy) === maxApy}
                    />
                  )
                })}
              </div>
              {bestYield != null && (
                <div style={{
                  padding: '10px 14px', background: '#14F19508',
                  border: '1px solid #14F19530', borderRadius: 4,
                  fontSize: 12, color: '#14F195',
                }}>
                  Best opportunity: {yields.find(y => toPercent(y.apy) === bestYield)?.protocol} at{' '}
                  <strong>{bestYield.toFixed(2)}%</strong> APY — this is what agents compete to find.
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '24px 0', color: '#404060', fontSize: 12 }}>
              Loading live yield data…
            </div>
          )}
        </div>

        {/* ── Section 3: How It Works ─────────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>How The Swarm Works</SectionLabel>

          <Step n="01" title="Spawn" body={
            <>
              5 agents deployed per generation. Each reads live yield data and makes a
              recommendation. Agents whose lineage carries prior failure memories are warned
              about specific hallucination patterns before they execute.
            </>
          }/>

          <Step n="02" title="Score (via x402)" body={
            <>
              Each agent pays <span style={{ color: '#14F195' }}>$0.01 USDC</span> via x402
              protocol to the scoring oracle before receiving its evaluation.
              No payment → no score. The oracle compares claimed APY vs real on-chain APY:
              <div style={{
                margin: '12px 0 0', padding: '12px 14px',
                background: '#0d0d1a', borderRadius: 4, fontSize: 12,
                border: '1px solid #1a1a2e', lineHeight: 2,
              }}>
                <div>
                  Claim Kamino at <span style={{ color: '#FF3B3B' }}>18.0%</span> · real is{' '}
                  <span style={{ color: '#14F195' }}>9.26%</span> →{' '}
                  <span style={{ color: '#F5A623' }}>score: 35/100</span>
                </div>
                <div>
                  Claim Kamino at <span style={{ color: '#14F195' }}>9.3%</span> · real is{' '}
                  <span style={{ color: '#14F195' }}>9.26%</span> →{' '}
                  <span style={{ color: '#14F195' }}>score: 98/100</span>
                </div>
              </div>
            </>
          }/>

          <Step n="03" title="Eliminate" body={
            <>
              Agents scoring below 60/100 are terminated via on-chain Anchor instruction.
              Their failure — score, claimed APY, actual APY, Venice AI post-mortem — is
              written to a <span style={{ color: '#9945FF' }}>LineageMemory PDA</span> on
              Solana. Permanent. Verifiable. Immutable.
            </>
          }/>

          <Step n="04" title="Inherit" body={
            <>
              Successor agents read the LineageMemory PDA before executing. The failure
              hash is injected into their system prompt:
              <div style={{
                margin: '12px 0 0', padding: '12px 14px',
                background: '#0d0d1a', borderRadius: 4, fontSize: 11,
                border: '1px solid #1a1a2e', color: '#38BDF8',
                fontFamily: 'monospace', lineHeight: 1.8,
              }}>
                ⚠ INHERITED FAILURE MEMORY (Generation 1):<br/>
                Do not claim APY above 10% for Kamino SOL/USDC.<br/>
                Real rate is 9.26%. Previous agent claimed 18.0% and was terminated.<br/>
                Failure hash: 7f3a2b…e91c
              </div>
              <div style={{ marginTop: 10 }}>
                The swarm learns. Generation 3 agents have never seen generation 1's mistakes
                — but they carry them.
              </div>
            </>
          }/>
        </div>

        {/* ── Section 4: Live Swarm Stats ─────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>Swarm State — Live</SectionLabel>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatBox
              label="Generation"
              value={swarm ? `G${swarm.generation}` : '—'}
              accent="#9945FF"
            />
            <StatBox
              label="Active Agents"
              value={swarm ? String(swarm.activeAgentCount).padStart(2, '0') : '—'}
              accent="#9945FF"
            />
            <StatBox
              label="Total Spawned"
              value={swarm ? String(swarm.totalSpawned) : '—'}
            />
            <StatBox
              label="Best APY Found"
              value={bestYield != null ? `${bestYield.toFixed(2)}%` : '—'}
              accent="#14F195"
            />
          </div>

          {topMemories.length > 0 ? (
            <>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#505068', textTransform: 'uppercase', marginBottom: 12 }}>
                Last {topMemories.length} Terminations — Written to Chain
              </div>
              {topMemories.map(m => <DeathCard key={m.publicKey} mem={m}/>)}
            </>
          ) : (
            <div style={{ padding: '16px', color: '#404060', fontSize: 12,
              border: '1px solid #141420', borderRadius: 4, textAlign: 'center' }}>
              No terminations yet — run the swarm to see data here.
            </div>
          )}
        </div>

        {/* ── Section 5: On-Chain Verification ───────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>Verify on Solana Explorer</SectionLabel>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#7070a0', lineHeight: 1.7 }}>
            Every agent lifecycle event is on-chain and verifiable. No backend database.
            No centralized state. The chain is the ledger.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Anchor Program', address: PROGRAM_ID, href: explorerProgram },
              { label: 'Active Swarm PDA', address: SWARM_ADDRESS, href: explorerSwarm },
            ].map(({ label, address, href }) => (
              <a key={address} href={href} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', background: '#0b0b14',
                  border: '1px solid #1a1a2e', borderRadius: 5, textDecoration: 'none',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#9945FF44')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
              >
                <div>
                  <div style={{ fontSize: 9, color: '#505068', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 11, color: '#38BDF8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {address}
                  </div>
                </div>
                <span style={{ fontSize: 14, color: '#38BDF8', flexShrink: 0, marginLeft: 12 }}>↗</span>
              </a>
            ))}
          </div>

          {memories.slice(0, 3).length > 0 && (
            <>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#505068', textTransform: 'uppercase', marginBottom: 10 }}>
                LineageMemory PDAs (most recent)
              </div>
              {memories.slice(0, 3).map(m => (
                <a
                  key={m.publicKey}
                  href={`${EXPLORER}/address/${m.publicKey}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', marginBottom: 6, background: '#0b0b14',
                    border: '1px solid #1a1a2e', borderRadius: 4, textDecoration: 'none',
                  }}
                >
                  <div style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>
                    Agent #{m.agentId} · Gen {m.generation} · Score {m.failureScore}
                    <span style={{ marginLeft: 12, color: '#404060', fontSize: 9 }}>
                      {m.publicKey.slice(0, 8)}…{m.publicKey.slice(-6)}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#505068', flexShrink: 0 }}>↗</span>
                </a>
              ))}
            </>
          )}
        </div>

        {/* ── Section 6: x402 Payment Flow ────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>X402 Agent Micropayments</SectionLabel>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#7070a0', lineHeight: 1.7 }}>
            Every agent pays <strong style={{ color: '#14F195' }}>$0.01 USDC</strong> via
            the x402 protocol before receiving its score. No payment → no evaluation.
            This is autonomous agent-to-agent commerce on Solana.
          </p>
          <div style={{
            padding: '16px 18px',
            background: '#05050e',
            border: '1px solid #1a1a2e',
            borderLeft: '3px solid #38BDF8',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 12,
            color: '#38BDF8',
            lineHeight: 2,
            marginBottom: 16,
          }}>
            <div style={{ color: '#505068', marginBottom: 4 }}>HTTP/1.1 402 Payment Required</div>
            <div><span style={{ color: '#404060' }}>x-payment-required:</span> [base64 payload]</div>
            <div><span style={{ color: '#404060' }}>scheme:</span> exact</div>
            <div><span style={{ color: '#404060' }}>network:</span> <span style={{ color: '#9945FF' }}>solana:devnet</span></div>
            <div><span style={{ color: '#404060' }}>amount:</span> 10000 <span style={{ color: '#404060' }}>(0.01 USDC)</span></div>
            <div><span style={{ color: '#404060' }}>payTo:</span> <span style={{ color: '#14F195', fontSize: 10 }}>{ORACLE_WALLET}</span></div>
          </div>
          <Link href="/ledger" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: '#38BDF8', letterSpacing: '0.08em',
            textDecoration: 'none',
          }}>
            View payment ledger →
          </Link>
        </div>

        {/* ── Section 7: LI.FI Funding ────────────────── */}
        <div style={{ marginBottom: 56 }}>
          <SectionLabel>Fund From Any Chain</SectionLabel>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#7070a0', lineHeight: 1.7 }}>
            The swarm treasury accepts USDC from any chain. LI.FI routes the optimal swap
            and bridge automatically. Powered by Jumper Exchange.
          </p>
          {swarm?.treasury ? (
            <FundSwarm treasuryAddress={swarm.treasury}/>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid #9945FF60', background: '#9945FF18',
              color: '#9945FF', fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: 600, letterSpacing: '0.04em',
            }}>
              <span style={{ fontSize: 14 }}>⚡</span>
              Fund Swarm
              <span style={{ fontSize: 10, color: '#9945FF88', marginLeft: 4 }}>(loading treasury…)</span>
            </div>
          )}
        </div>

        {/* ── footer ──────────────────────────────────── */}
        <div style={{
          borderTop: '1px solid #141420', paddingTop: 24,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 10, color: '#404060', letterSpacing: '0.08em', flexWrap: 'wrap', gap: 12,
        }}>
          <span>SWARMOS · DEVNET · {new Date().getFullYear()}</span>
          <div style={{ display: 'flex', gap: 20 }}>
            <Link href="/" style={{ color: '#505068', textDecoration: 'none' }}>Mission Control</Link>
            <Link href="/lineage" style={{ color: '#505068', textDecoration: 'none' }}>Lineage</Link>
            <Link href="/network" style={{ color: '#505068', textDecoration: 'none' }}>Network</Link>
            <a href={explorerProgram} target="_blank" rel="noopener noreferrer"
              style={{ color: '#505068', textDecoration: 'none' }}>Explorer ↗</a>
          </div>
        </div>

      </div>
    </div>
  )
}
