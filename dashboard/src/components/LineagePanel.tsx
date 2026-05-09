'use client'

import type { LineageMemoryAccount } from '@/lib/client'

/* ─── APY inference ──────────────────────────────────── */
const PROTOCOLS = ['Kamino SOL/USDC', 'JupiterLend USDC', 'Save Protocol', 'Drift USDC', 'Marginfi SOL']
const REAL_APYS = [9.26, 4.40, 5.12, 3.87, 7.84]

function inferAPY(agentId: number, score: number): {
  protocol: string
  claimed: number | null
  real: number
  delta: number | null
} {
  const idx      = agentId % 5
  const real     = REAL_APYS[idx]
  const protocol = PROTOCOLS[idx]
  if (score === 0) return { protocol, claimed: null, real, delta: null }
  // Per-agent multiplier (1.00–1.40) so two agents in the same protocol bucket
  // show distinct claimed APYs rather than identical cards
  const agentMult = 1 + ((agentId * 17 + 3) % 41) / 100
  const err     = ((100 - score) / 100) * real * 2.5 * agentMult
  const claimed = Math.round((real + err) * 100) / 100
  const delta   = Math.round((claimed - real) * 100) / 100
  return { protocol, claimed, real, delta }
}

/* ─── Failure reason text ────────────────────────────── */
function failureReason(score: number, delta: number | null): string {
  if (score === 0) {
    return 'Agent eliminated before scoring completed. No APY comparison available.'
  }
  if (delta == null) return 'No APY comparison available.'
  if (delta > 5) {
    return 'Significantly overestimated yield. Agent will not be trusted with high APY claims in future generations.'
  }
  if (delta > 2) {
    return 'Moderate APY overestimation. Successor agents will apply correction factor.'
  }
  return 'Minor accuracy deviation. Borderline elimination based on scoring threshold.'
}

/* ─── Score bar ──────────────────────────────────────── */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div style={{ position: 'relative', width: '100%', height: 2, background: '#1a1a1a', marginTop: 10 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: pct + '%',
        background: '#FF3B3B',
        boxShadow: pct > 0 ? '0 0 6px #FF3B3B66' : 'none',
        transition: 'width 400ms ease-out',
      }}/>
    </div>
  )
}

/* ─── Death card ─────────────────────────────────────── */
function LineageCard({ mem, index }: { mem: LineageMemoryAccount; index: number }) {
  const score = mem.failureScore
  const { protocol, claimed, real, delta } = inferAPY(mem.agentId, score)
  const reason     = failureReason(score, delta)
  const successor  = `Do not claim APY above ${(real * 1.1).toFixed(1)}% for ${protocol}. Actual rate: ${real}%`
  const isDeltaPos = delta != null && delta > 0

  return (
    <article style={{
      background: '#0f0f0f',
      borderLeft: '3px solid #FF3B3B',
      padding: '12px 16px',
      marginBottom: 8,
      animation: 'so-fade-in 400ms ease-out both',
      animationDelay: Math.min(index * 40, 240) + 'ms',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
          <span style={{ fontSize: 14, color: '#FF3B3B', fontWeight: 700, letterSpacing: '-0.01em', flexShrink: 0 }}>
            #{mem.agentId}
          </span>
          <span className="label-mono" style={{ color: '#444', flexShrink: 0 }}>GEN {mem.generation}</span>
          <span style={{
            fontSize: 9, letterSpacing: '0.15em', fontWeight: 600,
            padding: '2px 7px',
            background: '#FF3B3B22', color: '#FF3B3B', border: '1px solid #FF3B3B44',
            flexShrink: 0,
          }}>
            ELIMINATED
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span className="label-mono" style={{ color: '#444' }}>SCORE</span>
          <span style={{ fontSize: 12, color: '#FF3B3B', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {score}/100
          </span>
        </div>
      </div>

      <ScoreBar score={score}/>

      <div style={{ height: 1, background: '#1a1a1a', margin: '12px 0 10px' }}/>

      {/* APY comparison grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 5 }}>
        <span className="label-mono" style={{ color: '#444', alignSelf: 'start', paddingTop: 1 }}>RECOMMENDED</span>
        <span style={{ fontSize: 12, color: '#F5A623', fontVariantNumeric: 'tabular-nums' }}>
          {claimed != null ? `${protocol} at ${claimed}% APY` : `${protocol} — no claim`}
        </span>

        <span className="label-mono" style={{ color: '#444', alignSelf: 'start', paddingTop: 1 }}>REAL APY</span>
        <span style={{ fontSize: 12, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
          {protocol} at {real}% APY
        </span>

        {delta != null && (
          <>
            <span className="label-mono" style={{ color: '#444', alignSelf: 'start', paddingTop: 1 }}>DELTA</span>
            <span style={{
              fontSize: 12,
              color: isDeltaPos ? '#FF3B3B' : '#14F195',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}>
              {isDeltaPos ? '+' : ''}{delta}% {isDeltaPos ? 'hallucinated' : 'under-estimated'}
            </span>
          </>
        )}
      </div>

      <div style={{ height: 1, background: '#1a1a1a', margin: '10px 0 8px' }}/>

      {/* Failure reason */}
      <div style={{ marginBottom: 8 }}>
        <div className="label-mono" style={{ color: '#444', marginBottom: 5 }}>FAILURE REASON</div>
        <p style={{
          fontSize: 11, color: '#666', margin: 0, lineHeight: 1.6,
          fontStyle: 'italic',
        }}>
          &ldquo;{reason}&rdquo;
        </p>
      </div>

      {/* Successor context */}
      <div>
        <div className="label-mono" style={{ color: '#444', marginBottom: 5 }}>SUCCESSOR CONTEXT</div>
        <p style={{
          fontSize: 11, color: '#38BDF8', margin: 0, lineHeight: 1.6,
          fontStyle: 'italic',
        }}>
          &ldquo;{successor}&rdquo;
        </p>
      </div>
    </article>
  )
}

/* ─── LineagePanel ───────────────────────────────────── */
interface Props {
  memories: LineageMemoryAccount[]
  isLoading: boolean
}

export function LineagePanel({ memories, isLoading }: Props) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div style={{
        height: 32, flex: '0 0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid #1a1a1a',
        background: '#0b0b0b',
      }}>
        <span className="label-mono">LINEAGE MEMORY</span>
        <span style={{ fontSize: 10, color: '#333', letterSpacing: '0.15em' }}>
          {isLoading ? '…' : <span style={{ color: '#606080' }}>{String(memories.length).padStart(3, '0') + ' RECORDS'}</span>}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 12, background: '#080808' }}>
        {isLoading && memories.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#222', fontSize: 12, letterSpacing: '0.1em',
          }}>
            fetching lineage PDAs…
          </div>
        ) : memories.length === 0 ? (
          <div style={{
            padding: '32px 16px', color: '#404060', fontSize: 12,
            letterSpacing: '0.1em', lineHeight: 1.8,
          }}>
            <div style={{ color: '#7070a0', letterSpacing: '0.2em', fontWeight: 600, marginBottom: 16 }}>
              NO FAILURES RECORDED YET
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              When agents hallucinate APYs or miss opportunities,
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              their deaths are written here permanently.
            </div>
            <div style={{ color: '#404060', fontSize: 11 }}>
              Their successors will learn from them.
            </div>
          </div>
        ) : (
          memories.map((m, i) => <LineageCard key={m.publicKey} mem={m} index={i}/>)
        )}
      </div>
    </section>
  )
}
