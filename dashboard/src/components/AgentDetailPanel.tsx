'use client'

import type { AgentNode } from '@/hooks/useAgents'
import type { AgentEventData } from '@/hooks/useEvents'
import type { YieldLike } from '@/lib/yields'
import { actualApyForProtocol, apyDelta, formatPercent, formatUsdc, shortHash } from '@/lib/yields'
import { explorerAddressUrl } from '@/lib/config'

function buildReasoning(protocol: string, claimed: number | null, actual: number | null, score: number): string {
  if (score === 0) {
    return 'Agent has not received an oracle score yet. The claim and output hash are already stored on-chain.'
  }
  if (claimed == null) {
    return 'Oracle score exists, but this account does not expose a stored APY claim. Check the program IDL and deployment version.'
  }
  if (actual == null) {
    return `The agent claimed ${protocol} at ${formatPercent(claimed)}. Live oracle data does not currently expose a direct matching yield row.`
  }
  const delta = apyDelta(claimed, actual) ?? 0
  if (score >= 80) {
    return `The agent claimed ${protocol} at ${formatPercent(claimed)}. Live oracle APY is ${formatPercent(actual)}, a ${Math.abs(delta).toFixed(2)} point delta.`
  }
  if (score >= 40) {
    return `The agent found ${protocol}, but its stored claim of ${formatPercent(claimed)} only partially matched the live rate of ${formatPercent(actual)}.`
  }
  return `The agent claimed ${protocol} at ${formatPercent(claimed)} while live oracle data showed ${formatPercent(actual)}. The mismatch was large enough to fail selection.`
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
      <span style={{
        fontSize: 12,
        color,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        textAlign: 'right',
        marginLeft: 12,
        wordBreak: 'break-all',
      }}>{value}</span>
    </div>
  )
}

/* ─── Props ──────────────────────────────────────────── */
interface Props {
  agent: AgentNode | null
  eventData?: AgentEventData
  yields?: YieldLike[]
  onClose: () => void
}

/* ─── AgentDetailPanel ───────────────────────────────── */
export function AgentDetailPanel({ agent, eventData, yields = [], onClose }: Props) {
  if (!agent) return null

  const score     = agent.score
  const agentId   = agent.agent_id
  const claimed   = eventData?.claimedAPY ?? agent.claimed_apy
  const protocol  = eventData?.protocol ?? agent.claimed_protocol ?? 'Unknown protocol'
  const actual    = eventData?.actualAPY ?? actualApyForProtocol(yields, protocol)
  const reasoning = buildReasoning(protocol, claimed, actual, score)
  const delta     = apyDelta(claimed, actual)
  const deltaPos  = delta != null && delta > 0
  const usdcBalance = eventData?.agentUsdcBalance ?? agent.agent_usdc_balance
  const ata = eventData?.agentUsdcAta ?? agent.agent_usdc_ata
  const custodyState = usdcBalance == null
    ? 'ATA not found'
    : usdcBalance > 0
      ? 'Funded'
      : agent.status === 'Terminated'
        ? 'Reclaimed'
        : 'Empty'

  // Solana explorer link (devnet)
  const explorerUrl = explorerAddressUrl(agent.id)
  const ataExplorerUrl = explorerAddressUrl(ata)

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
            <Row label="Protocol" value={protocol || '-'} color="#F0F0F0"/>
            <Row label="Claimed APY" value={formatPercent(claimed)} color="#F5A623"/>
            <Row label="Claim BPS" value={String(eventData?.claimedApyBps ?? agent.claimed_apy_bps)} color="#606080"/>
            <Row label="Output Hash" value={shortHash(agent.task_output_hash)} color="#38BDF8"/>
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* ACCURACY CHECK */}
          <Section title="ACCURACY CHECK">
            <Row label="Claimed" value={formatPercent(claimed)} color="#F5A623"/>
            <Row label="Live Oracle" value={formatPercent(actual)} color={actual == null ? '#444' : '#14F195'}/>
            {delta != null && (
              <Row
                label="Delta"
                value={`${deltaPos ? '+' : ''}${delta.toFixed(2)}%`}
                color={deltaPos ? '#FF3B3B' : '#14F195'}
              />
            )}
          </Section>

          <div style={{ height: 1, background: '#1e1e2c', marginBottom: 16 }}/>

          {/* CUSTODY */}
          <Section title="USDC CUSTODY">
            <Row label="Agent ATA" value={shortHash(ata)} color="#38BDF8"/>
            <Row label="Balance" value={formatUsdc(usdcBalance)} color={usdcBalance && usdcBalance > 0 ? '#14F195' : '#606080'}/>
            <Row label="State" value={custodyState} color={custodyState === 'Funded' ? '#14F195' : custodyState === 'Reclaimed' ? '#F5A623' : '#606080'}/>
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
            <a
              href={ataExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginTop: 10,
                fontSize: 11, color: '#38BDF8',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span>View agent USDC ATA</span>
              <span style={{ fontSize: 10 }}>↗</span>
            </a>
          </Section>

        </div>
      </div>
    </>
  )
}
