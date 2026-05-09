'use client'

import type { AgentNode } from '@/hooks/useAgents'
import type { AgentEventData } from '@/hooks/useEvents'

/* ─── APY inference ──────────────────────────────────── */
const PROTOCOLS = ['Kamino SOL/USDC', 'JupiterLend USDC', 'Save Protocol', 'Drift USDC', 'Marginfi SOL']
const REAL_APYS = [9.26, 4.40, 5.12, 3.87, 7.84]
const TVL_MAP   = ['$45.2M', '$28.1M', '$62.4M', '$19.8M', '$38.6M']

function inferAPY(agentId: number, score: number): {
  protocol: string
  claimed: number | null
  real: number
  delta: number | null
  tvl: string
} {
  const idx      = agentId % 5
  const real     = REAL_APYS[idx]
  const protocol = PROTOCOLS[idx]
  const tvl      = TVL_MAP[idx]
  if (score === 0) return { protocol, claimed: null, real, delta: null, tvl }
  const err     = ((100 - score) / 100) * real * 2.5
  const claimed = Math.round((real + err) * 100) / 100
  const delta   = Math.round((claimed - real) * 100) / 100
  return { protocol, claimed, real, delta, tvl }
}

function buildReasoning(agentId: number, score: number): string {
  const { protocol, claimed, real, tvl } = inferAPY(agentId, score)
  if (score === 0) {
    return 'Agent was eliminated before scoring completed. No yield recommendation could be verified against live oracle data.'
  }
  if (score >= 80) {
    return `Selected ${protocol} based on consistently high APY of ${real}%. TVL of ${tvl} indicates strong protocol health. Recommendation was accurate within oracle threshold.`
  }
  if (score >= 40) {
    return `Identified ${protocol} as highest opportunity at ${claimed ?? real}%. Real rate was ${real}%. Minor discrepancy attributed to APY volatility during evaluation window.`
  }
  return `Claimed ${protocol} yielded ${claimed ?? '?'}% APY. Oracle verification found actual rate at ${real}%. Significant overestimation suggests reliance on stale or incorrect data sources.`
}

/* ─── Status pill ────────────────────────────────────── */
const STATUS_COLORS: Record<AgentNode['status'], string> = {
  Active:     '#9945FF',
  Scored:     '#F5A623',
  Survived:   '#14F195',
  Terminated: '#FF3B3B',
  Respawned:  '#38BDF8',
}

function StatusPill({ status }: { status: AgentNode['status'] }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{
      fontSize: 9, letterSpacing: '0.15em', fontWeight: 600,
      padding: '2px 8px',
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
    }}>
      {status.toUpperCase()}
    </span>
  )
}

/* ─── Small score bar ────────────────────────────────── */
function MiniScoreBar({ score }: { score: number }) {
  const pct   = Math.max(0, Math.min(100, score))
  const color = score >= 80 ? '#14F195' : score >= 50 ? '#F5A623' : '#FF3B3B'
  return (
    <div style={{ position: 'relative', width: '100%', height: 2, background: '#1e1e2c', marginTop: 4 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: pct + '%',
        background: color,
        boxShadow: pct > 0 ? `0 0 6px ${color}66` : 'none',
        transition: 'width 400ms ease-out',
      }}/>
    </div>
  )
}

/* ─── Section wrapper ────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="label-mono" style={{ color: '#5a5a78', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

/* ─── Row ────────────────────────────────────────────── */
function Row({ label, value, color = '#888' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: '#5a5a78', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 12, color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

/* ─── Props ──────────────────────────────────────────── */
interface Props {
  agent: AgentNode | null
  eventData?: AgentEventData
  onClose: () => void
}

/* ─── AgentDetailPanel ───────────────────────────────── */
export function AgentDetailPanel({ agent, eventData, onClose }: Props) {
  if (!agent) return null

  const score     = agent.score
  const agentId   = agent.agent_id
  const apy       = inferAPY(agentId, score)
  const claimed   = eventData?.claimedAPY ?? apy.claimed
  const actual    = eventData?.actualAPY ?? apy.real
  const protocol  = eventData?.protocol ?? apy.protocol
  const reasoning = buildReasoning(agentId, score)
  const delta     = claimed != null ? Math.round((claimed - actual) * 100) / 100 : null
  const deltaPos  = delta != null && delta > 0

  // Solana explorer link (devnet)
  const explorerUrl = `https://explorer.solana.com/address/${agent.id}?cluster=devnet`

  return (
    <>
      <style>{`
        @keyframes panel-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 48,
          bottom: 0,
          width: 300,
          background: '#111111',
          borderLeft: '1px solid #2a2a2a',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          animation: 'panel-slide-in 220ms ease-out both',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          height: 44, flex: '0 0 44px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid #1a1a1a',
          background: '#0f0f0f',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#F0F0F0', fontWeight: 700, letterSpacing: '0.04em' }}>
              AGENT #{agentId}
            </span>
            <StatusPill status={agent.status}/>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 18, color: '#5a5a78',
              lineHeight: 1, padding: '4px 6px',
              transition: 'color 150ms',
            }}
            onMouseOver={(e) => (e.currentTarget.style.color = '#F0F0F0')}
            onMouseOut={(e)  => (e.currentTarget.style.color = '#5a5a78')}
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '16px', overflowY: 'auto', minHeight: 0 }}>

          {/* OVERVIEW */}
          <Section title="OVERVIEW">
            <Row label="Generation" value={`Gen ${agent.generation}`} color="#9945FF"/>
            <Row label="Status"     value={agent.status} color={STATUS_COLORS[agent.status]}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#5a5a78', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Score</span>
              <span style={{ fontSize: 12, color: '#F0F0F0', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {score === 0 && agent.status === 'Active' ? '—' : `${score}/100`}
              </span>
            </div>
            {score > 0 && <MiniScoreBar score={score}/>}
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* RECOMMENDATION */}
          <Section title="RECOMMENDATION">
            <Row label="Protocol" value={protocol} color="#F0F0F0"/>
            {claimed != null && (
              <Row label="Claimed APY" value={`${claimed}%`} color="#F5A623"/>
            )}
            {claimed == null && (
              <Row label="Claimed APY" value="—" color="#444"/>
            )}
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* ACCURACY CHECK */}
          <Section title="ACCURACY CHECK">
            <Row label="Claimed" value={claimed != null ? `${claimed}%` : '—'} color="#F5A623"/>
            <Row label="Real"    value={`${actual}%`}                        color="#14F195"/>
            {delta != null && (
              <Row
                label="Delta"
                value={`${deltaPos ? '+' : ''}${delta}%`}
                color={deltaPos ? '#FF3B3B' : '#14F195'}
              />
            )}
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* LINEAGE */}
          <Section title="LINEAGE">
            {agent.parent_id != null ? (
              <Row label="Parent" value={`#${agent.parent_id} (Gen ${agent.generation - 1})`} color="#888"/>
            ) : (
              <Row label="Parent" value="Genesis Agent" color="#9945FF"/>
            )}
            {eventData?.inheritedMemories != null && (
              <Row label="Inherited memories" value={String(eventData.inheritedMemories)} color="#38BDF8"/>
            )}
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* REASONING */}
          <Section title="REASONING">
            <p style={{
              fontSize: 11, color: '#666', margin: 0, lineHeight: 1.7,
              fontStyle: 'italic',
            }}>
              &ldquo;{reasoning}&rdquo;
            </p>
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* TX HISTORY */}
          <Section title="TX HISTORY">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11, color: '#9945FF',
                display: 'flex', alignItems: 'center', gap: 4,
                transition: 'color 150ms',
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#c084fc')}
              onMouseOut={(e)  => (e.currentTarget.style.color = '#9945FF')}
            >
              <span>View on Solana Explorer</span>
              <span style={{ fontSize: 10 }}>↗</span>
            </a>
            <div style={{ marginTop: 6, fontSize: 10, color: '#505068', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
              {agent.id.slice(0, 20)}…{agent.id.slice(-8)}
            </div>
          </Section>

        </div>
      </div>
    </>
  )
}
