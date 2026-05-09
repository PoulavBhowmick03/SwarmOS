'use client'

import { useYields } from '@/hooks/useYields'
import type { YieldEntry } from '@/hooks/useYields'

const FALLBACK: YieldEntry[] = [
  { protocol: 'Kamino SOL/USDC',  apy: 9.26, trend: 'up',     tvl: '$45.2M' },
  { protocol: 'JupiterLend USDC', apy: 4.40, trend: 'stable',  tvl: '$28.1M' },
  { protocol: 'Save Protocol',    apy: 5.12, trend: 'down',    tvl: '$62.4M' },
  { protocol: 'Drift USDC',       apy: 3.87, trend: 'stable',  tvl: '$19.8M' },
]

function YieldCard({ entry, maxApy, isBest }: { entry: YieldEntry; maxApy: number; isBest: boolean }) {
  const barWidth   = maxApy > 0 ? Math.round((entry.apy / maxApy) * 100) : 0
  const trendColor = entry.trend === 'up' ? '#14F195' : entry.trend === 'down' ? '#FF3B3B' : '#444'
  const trendIcon  = entry.trend === 'up' ? '↑' : entry.trend === 'down' ? '↓' : '→'
  const shortName  = entry.protocol.split(' ')[0].toUpperCase()

  return (
    <div style={{
      width: 118, flexShrink: 0,
      padding: '6px 10px',
      border: `1px solid ${isBest ? '#9945FF44' : '#141414'}`,
      borderRadius: 4,
      background: isBest ? '#9945FF08' : '#0b0b0b',
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 4,
      }}>
        <span style={{
          fontSize: 9, letterSpacing: '0.1em',
          fontFamily: 'var(--mono)',
          color: isBest ? '#9945FF' : '#606080',
        }}>
          {shortName}
        </span>
        {isBest && (
          <span style={{ fontSize: 8, color: '#9945FF66', letterSpacing: '0.08em' }}>BEST</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 5 }}>
        <span style={{
          fontSize: 14, fontWeight: 700, color: '#F0F0F0',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {entry.apy.toFixed(2)}%
        </span>
        <span style={{ fontSize: 10, color: trendColor }}>{trendIcon}</span>
        {entry.tvl && (
          <span style={{ fontSize: 8, color: '#505068', marginLeft: 'auto' }}>{entry.tvl}</span>
        )}
      </div>

      <div style={{ height: 2, background: '#111', borderRadius: 1 }}>
        <div style={{
          height: '100%',
          width: barWidth + '%',
          background: isBest ? '#9945FF' : '#14F19540',
          borderRadius: 1,
          transition: 'width 0.6s ease',
        }}/>
      </div>
    </div>
  )
}

export function LiveYields() {
  const { yields } = useYields()
  const data       = yields.length > 0 ? yields : FALLBACK
  const maxApy     = Math.max(...data.map(y => y.apy))

  return (
    <div style={{
      height: 64, flex: '0 0 64px',
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 10,
      borderBottom: '1px solid #1a1a1a',
      background: '#090909',
      overflow: 'hidden',
    }}>
      <div style={{ flexShrink: 0, marginRight: 2 }}>
        <div style={{ fontSize: 8, color: '#404060', letterSpacing: '0.12em', fontFamily: 'var(--mono)' }}>LIVE</div>
        <div style={{ fontSize: 8, color: '#404060', letterSpacing: '0.12em', fontFamily: 'var(--mono)' }}>YIELDS</div>
      </div>
      <div style={{ width: 1, height: 36, background: '#141414', flexShrink: 0 }}/>
      <div style={{ display: 'flex', gap: 7 }}>
        {data.slice(0, 4).map(y => (
          <YieldCard
            key={y.protocol}
            entry={y}
            maxApy={maxApy}
            isBest={y.apy === maxApy}
          />
        ))}
      </div>
    </div>
  )
}
