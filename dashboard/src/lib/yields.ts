export interface YieldLike {
  protocol: string
  vault?: string
  token?: string
  apy: number
  tvl?: number | string
  riskScore?: number
  fetchedAt?: number
  trend?: string
}

export function toPercent(apy: number): number {
  return apy < 1 ? apy * 100 : apy
}

export function claimedApyFromBps(bps?: number | null): number | null {
  if (bps == null) return null
  return Math.round((bps / 100) * 100) / 100
}

export function formatPercent(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(digits)}%`
}

export function formatUsdc(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(value < 1 ? 6 : 2)} USDC`
}

export function formatTvl(value?: number | string | null): string {
  if (value == null || value === '') return '-'
  if (typeof value === 'string') return value
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toLocaleString()}`
}

export function opportunityName(entry: YieldLike): string {
  return [entry.protocol, entry.vault].filter(Boolean).join(' ')
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function findYieldForProtocol(yields: YieldLike[], claimedProtocol?: string | null): YieldLike | null {
  if (!claimedProtocol) return null

  const target = normalizeName(claimedProtocol)
  if (!target) return null

  const exact = yields.find((entry) => normalizeName(opportunityName(entry)) === target)
  if (exact) return exact

  return yields.find((entry) => {
    const full = normalizeName(opportunityName(entry))
    const protocol = normalizeName(entry.protocol)
    const vault = normalizeName(entry.vault ?? '')
    return full.includes(target) ||
      target.includes(full) ||
      protocol.includes(target) ||
      target.includes(protocol) ||
      (vault.length > 0 && (vault.includes(target) || target.includes(vault)))
  }) ?? null
}

export function actualApyForProtocol(yields: YieldLike[], claimedProtocol?: string | null): number | null {
  const match = findYieldForProtocol(yields, claimedProtocol)
  return match ? toPercent(match.apy) : null
}

export function apyDelta(claimed?: number | null, actual?: number | null): number | null {
  if (claimed == null || actual == null) return null
  return Math.round((claimed - actual) * 100) / 100
}

export function shortHash(value?: string | null, head = 8, tail = 6): string {
  if (!value) return '-'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}
