export type YieldProtocol = 'Kamino' | 'KaminoLend' | 'JupiterLend' | 'Save' | 'MarginFi' | 'Drift'

export interface YieldOpportunity {
  protocol: YieldProtocol
  vault: string
  token: string
  apy: number
  tvl: number
  riskScore: number
  fetchedAt: number
  source?: string
}

// ---------------------------------------------------------------------------
// Kamino: direct metrics API (confirmed working, real-time)
// ---------------------------------------------------------------------------
const KAMINO_METRICS_URL = 'https://api.kamino.finance/strategies/metrics'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const MIN_TVL = 100_000

// ---------------------------------------------------------------------------
// DefiLlama: per-pool chart endpoint returns latest snapshot as last array entry.
// Pool IDs sourced from yields.llama.fi/pools (chain=Solana, project=*-lend/save).
//   /chart/{poolId} → { status, data: [{ timestamp, tvlUsd, apy, apyBase, ... }] }
// ---------------------------------------------------------------------------
const LLAMA_CHART = 'https://yields.llama.fi/chart'

const LLAMA_POOLS: Array<{ protocol: YieldProtocol; vault: string; poolId: string }> = [
  // Jupiter Lend USDC — $430M TVL, 4.4% APY
  {
    protocol: 'JupiterLend',
    vault: 'USDC',
    poolId: 'd783c8df-e2ed-44b4-8317-161ccc1b5f06',
  },
  // Kamino Lend USDC — $8M TVL, single-asset supply
  {
    protocol: 'KaminoLend',
    vault: 'USDC',
    poolId: 'd2141a59-c199-4be7-8d4b-c8223954836b',
  },
  // Save (formerly Solend) USDC — $11M TVL, conservative
  {
    protocol: 'Save',
    vault: 'USDC',
    poolId: 'dde4c16c-504d-470b-9404-006287ce0906',
  },
]

// ---------------------------------------------------------------------------
// MarginFi: no public HTTP API as of 2026-05. REST DNS fails and the GCS
//   bucket only contains bank address→token metadata, no APY data.
//   SDK (@mrgnlabs/marginfi-client-v2) would work but is not installed.
//
// Drift: /apys returns 401 Unauthorized; all other tried endpoints 404/503.
//   Not tracked on DefiLlama for USDC lending.
// ---------------------------------------------------------------------------

const FALLBACK_YIELDS: YieldOpportunity[] = [
  { protocol: 'Kamino', vault: 'USDC Lending', token: 'USDC', apy: 0.0926, tvl: 45000000, riskScore: 2, fetchedAt: Date.now(), source: 'fallback' },
  { protocol: 'Kamino', vault: 'JLP/USDC', token: 'USDC', apy: 0.142, tvl: 28000000, riskScore: 4, fetchedAt: Date.now(), source: 'fallback' },
  { protocol: 'MarginFi', vault: 'USDC Pool', token: 'USDC', apy: 0.061, tvl: 23000000, riskScore: 3, fetchedAt: Date.now(), source: 'fallback' },
  { protocol: 'Drift', vault: 'USDC Vault', token: 'USDC', apy: 0.112, tvl: 8000000, riskScore: 5, fetchedAt: Date.now(), source: 'fallback' },
]

export async function fetchLiveYields(): Promise<YieldOpportunity[]> {
  const results = await Promise.allSettled([
    fetchKaminoYields(),
    fetchLlamaYields(),
  ])

  const all: YieldOpportunity[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      all.push(...result.value)
    } else {
      console.warn(`[yields] source failed: ${errorMessage(result.reason)}`)
    }
  }

  // Deduplicate by protocol+vault, keeping highest TVL entry
  const seen = new Map<string, YieldOpportunity>()
  for (const y of all) {
    const key = `${y.protocol}:${y.vault}`
    const existing = seen.get(key)
    if (!existing || y.tvl > existing.tvl) seen.set(key, y)
  }

  const live = Array.from(seen.values()).sort((a, b) => b.apy - a.apy)
  if (live.length === 0) {
    console.warn('[yields] all live fetches failed, using fallback data')
    return FALLBACK_YIELDS
  }
  return live
}

async function fetchKaminoYields(): Promise<YieldOpportunity[]> {
  const now = Math.floor(Date.now() / 1000)
  let data: unknown[]
  try {
    data = await getJson<unknown[]>(KAMINO_METRICS_URL)
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[yields] kamino error:', e.message, e.cause)
    throw e
  }
  const out: YieldOpportunity[] = []

  for (const raw of asArray(data)) {
    const row = raw as Record<string, unknown>
    const tA = String(row.tokenA ?? '')
    const tB = String(row.tokenB ?? '')
    const tAMint = String(row.tokenAMint ?? '')
    const tBMint = String(row.tokenBMint ?? '')

    if (
      !tA.includes('USDC') &&
      !tB.includes('USDC') &&
      tAMint !== USDC_MINT &&
      tBMint !== USDC_MINT
    ) {
      continue
    }

    const tvl = toFloat(row.totalValueLocked)
    if (tvl < MIN_TVL) continue

    const kaminoApy = row.kaminoApy as Record<string, Record<string, unknown>> | undefined
    const apy = toFloat(kaminoApy?.vault?.apy7d)
    if (apy <= 0) continue

    out.push({
      protocol: 'Kamino',
      vault: `${tA}/${tB}`,
      token: 'USDC',
      apy,
      tvl,
      riskScore: riskFromTvl(tvl),
      fetchedAt: now,
    })
  }

  return out
}

async function fetchLlamaYields(): Promise<YieldOpportunity[]> {
  const now = Math.floor(Date.now() / 1000)

  const results = await Promise.allSettled(
    LLAMA_POOLS.map(async ({ protocol, vault, poolId }) => {
      const data = await getJson<{ status: string; data: LlamaChartEntry[] }>(
        `${LLAMA_CHART}/${poolId}`
      )
      if (data.status !== 'success' || data.data.length === 0) {
        throw new Error(`DefiLlama pool ${poolId} returned no data`)
      }
      const latest = data.data[data.data.length - 1]
      const apy = toFloat(latest.apy)
      const tvl = toFloat(latest.tvlUsd)
      if (apy <= 0 || tvl < MIN_TVL) return null

      return {
        protocol,
        vault,
        token: 'USDC',
        apy: apy / 100, // DefiLlama returns percentage, normalise to decimal
        tvl,
        riskScore: riskFromTvl(tvl),
        fetchedAt: now,
      } satisfies YieldOpportunity
    })
  )

  const out: YieldOpportunity[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) {
      out.push(r.value)
    } else if (r.status === 'rejected') {
      console.warn(`[yields] DefiLlama pool failed: ${errorMessage(r.reason)}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LlamaChartEntry {
  timestamp: string
  tvlUsd: number
  apy: number
  apyBase: number
  apyReward: number
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 SwarmOS/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value as object).flat()
  return []
}

function toFloat(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function riskFromTvl(tvl: number): number {
  if (tvl >= 100_000_000) return 1
  if (tvl >= 50_000_000) return 2
  if (tvl >= 10_000_000) return 4
  if (tvl >= 1_000_000) return 5
  return 7
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
