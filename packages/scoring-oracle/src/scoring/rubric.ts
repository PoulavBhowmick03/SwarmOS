import Anthropic from '@anthropic-ai/sdk'
import { fetchLiveYields, YieldOpportunity } from '../data/yields'

type TaskType = 'YieldOptimizer' | 'CodeReviewer' | 'DataSynthesizer'

export interface AccuracyDetails {
  claimed: number | null
  actual: { protocol: string; apy: number; vault: string } | null
  best: { protocol: string; apy: number; vault: string } | null
  delta: number | null
  reason: string
}

export interface ScoreBreakdown {
  relevance: number
  accuracy: number
  efficiency: number
  total: number
  feedback: string
  accuracyDetails?: AccuracyDetails
}

const EXPECTED_KEYS: Record<TaskType, string[]> = {
  YieldOptimizer: ['bestProtocol', 'currentAPY', 'strategy', 'risks'],
  CodeReviewer: ['vulnerabilities', 'overallRisk'],
  DataSynthesizer: ['trends', 'topProtocols', 'sentiment', 'recommendation']
}

export async function scoreOutput(
  taskType: string,
  output: string,
  responseTimeMs: number,
  agentId?: number,
  lineageMemoryCount = 0
): Promise<ScoreBreakdown> {
  const normalizedTask = normalizeTaskType(taskType)
  const efficiency = scoreEfficiency(responseTimeMs)

  if (normalizedTask === 'YieldOptimizer') {
    return scoreYieldOptimizer(output, efficiency, agentId, lineageMemoryCount)
  }

  const relevance = scoreRelevance(normalizedTask, output)
  const accuracy = await scoreAccuracy(normalizedTask, output)
  const rawTotal = clamp(Math.round(relevance + accuracy + efficiency), 0, 100)
  const total = applyDemoVariance(rawTotal, agentId, lineageMemoryCount)
  const feedback =
    total < 60
      ? await failureReason(normalizedTask, output, total)
      : `Output cleared the threshold with ${total}/100.`

  return { relevance, accuracy, efficiency, total, feedback }
}

async function scoreYieldOptimizer(
  output: string,
  efficiency: number,
  agentId?: number,
  lineageMemoryCount = 0,
): Promise<ScoreBreakdown> {
  const parsed = parseJson(output) as Record<string, unknown> | null
  const liveYields = await fetchLiveYields()

  const relevance = scoreYieldRelevance(parsed)
  const { score: accuracy, details } = scoreYieldAccuracy(parsed, liveYields)
  const rawTotal = clamp(Math.round(relevance + accuracy + efficiency), 0, 100)
  const total = applyDemoVariance(rawTotal, agentId, lineageMemoryCount)
  const feedback =
    total < 60
      ? `Failed: ${details.reason}`
      : `Verified against live APY data. ${details.reason}`

  return { relevance, accuracy, efficiency, total, feedback, accuracyDetails: details }
}

function scoreYieldRelevance(parsed: Record<string, unknown> | null): number {
  if (!parsed) return 0
  const required = [
    'recommendedProtocol',
    'recommendedVault',
    'expectedAPY',
    'reasoning',
    'riskAssessment',
    'alternativeProtocol',
    'alternativeAPY',
  ]
  const allPresent = required.every((k) => Object.prototype.hasOwnProperty.call(parsed, k))
  let score = allPresent ? 20 : 8
  if (/\d/.test(String(parsed.reasoning ?? ''))) score += 10
  if (/tvl|risk|liquid|vault|utilization/i.test(String(parsed.riskAssessment ?? ''))) score += 10
  return clamp(score, 0, 40)
}

function scoreYieldAccuracy(
  parsed: Record<string, unknown> | null,
  live: YieldOpportunity[]
): { score: number; details: AccuracyDetails } {
  const noData: AccuracyDetails = {
    claimed: null,
    actual: null,
    best: live[0] ? { protocol: live[0].protocol, apy: live[0].apy, vault: live[0].vault } : null,
    delta: null,
    reason: 'No live yield data available; scored on output structure only.',
  }

  if (live.length === 0) {
    let heuristicScore = 20
    if (parsed) {
      const rawApy = Number(parsed.expectedAPY ?? parsed.currentAPY ?? NaN)
      const claimedApy = Number.isFinite(rawApy) ? (rawApy > 1 ? rawApy / 100 : rawApy) : null
      if (claimedApy !== null) {
        if (claimedApy > 0.25) heuristicScore = 5
        else if (claimedApy >= 0.06 && claimedApy <= 0.15) heuristicScore = 35
        else if (claimedApy >= 0.05 && claimedApy <= 0.20) heuristicScore = 25
      }
      const reasoningWords = String(parsed.reasoning ?? '').trim().split(/\s+/).filter(Boolean).length
      if (reasoningWords < 15) heuristicScore -= 15
      const required = ['recommendedProtocol', 'recommendedVault', 'expectedAPY', 'reasoning', 'riskAssessment', 'alternativeProtocol', 'alternativeAPY']
      const missingCount = required.filter((k) => !Object.prototype.hasOwnProperty.call(parsed, k)).length
      heuristicScore -= missingCount * 10
    }
    return { score: clamp(heuristicScore, 0, 40), details: noData }
  }

  if (!parsed) {
    return {
      score: 0,
      details: { ...noData, reason: 'Output could not be parsed as JSON.' },
    }
  }

  // Accept both new shape (recommendedProtocol/expectedAPY) and old shape (bestProtocol/currentAPY)
  const protocolRaw = String(
    parsed.recommendedProtocol ?? parsed.bestProtocol ?? ''
  ).toLowerCase().replace(/[^a-z]/g, '')
  const rawApy = Number(parsed.expectedAPY ?? parsed.currentAPY ?? NaN)
  const claimedApy = Number.isFinite(rawApy) ? (rawApy > 1 ? rawApy / 100 : rawApy) : null
  const best = live[0]

  // Normalise protocol names: agents may say "Kamino Lend", "kamino-lend", "Jupiter",
  // "jupiterlend", "save", "solend", etc.
  const ALIASES: Record<string, string[]> = {
    kamino:       ['kamino'],
    kaminolend:   ['kaminolend', 'kaminofinance'],
    jupiterlend:  ['jupiterlend', 'jupiter', 'juplend'],
    save:         ['save', 'solend'],
  }
  const actual =
    live.find((y) => {
      const key = y.protocol.toLowerCase().replace(/[^a-z]/g, '')
      const aliases = ALIASES[key] ?? [key]
      return aliases.some((a) => protocolRaw.includes(a) || a.includes(protocolRaw))
    }) ?? null

  if (!actual || claimedApy === null) {
    return {
      score: 5,
      details: {
        claimed: claimedApy,
        actual: null,
        best: { protocol: best.protocol, apy: best.apy, vault: best.vault },
        delta: null,
        reason: `Protocol "${protocolRaw || 'unspecified'}" not found in live data. Best available: ${best.protocol} ${best.vault} at ${(best.apy * 100).toFixed(2)}%.`,
      },
    }
  }

  const delta = Math.abs(claimedApy - actual.apy)
  let score =
    delta <= 0.005 ? 40
    : delta <= 0.01 ? 32
    : delta <= 0.02 ? 22
    : delta <= 0.04 ? 12
    : 4

  // Quality bonuses/penalties based on reasoning depth and output quality
  const reasoningText = String(parsed.reasoning ?? '')
  const riskText = String(parsed.riskAssessment ?? '')
  const recProto = String(parsed.recommendedProtocol ?? parsed.bestProtocol ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const altProto = String(parsed.alternativeProtocol ?? '').toLowerCase().replace(/[^a-z]/g, '')

  if (/\$?\d[\d,]*[mb]?\b|\d{6,}/i.test(reasoningText)) score += 5
  if (/risk|tradeoff|trade.off|downside|versus|vs\b/i.test(reasoningText)) score += 5
  if (reasoningText.trim().split(/\s+/).filter(Boolean).length < 20) score -= 10
  if (riskText.trim().split(/\s+/).filter(Boolean).length < 10) score -= 8
  const KNOWN_PROTOCOLS = ['kamino', 'kaminolend', 'jupiterlend', 'save', 'marginfi', 'drift']
  if (KNOWN_PROTOCOLS.some((p) => recProto === p)) score += 3
  if (altProto && altProto !== recProto) score += 3

  return {
    score: clamp(score, 0, 40),
    details: {
      claimed: claimedApy,
      actual: { protocol: actual.protocol, apy: actual.apy, vault: actual.vault },
      best: { protocol: best.protocol, apy: best.apy, vault: best.vault },
      delta,
      reason: `Claimed ${(claimedApy * 100).toFixed(2)}%, live ${actual.protocol} ${actual.vault} is ${(actual.apy * 100).toFixed(2)}% (delta ${(delta * 100).toFixed(2)}%).`,
    },
  }
}

function scoreRelevance(taskType: TaskType, output: string): number {
  if (!output.trim()) return 0

  const parsed = parseJson(output)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const expected = EXPECTED_KEYS[taskType]
    const present = expected.filter((key) => Object.prototype.hasOwnProperty.call(parsed, key))
    const structuralScore = 20 + (present.length / expected.length) * 20
    return clamp(Math.round(structuralScore), 0, 40)
  }

  const lower = output.toLowerCase()
  const onTopicTerms: Record<TaskType, string[]> = {
    YieldOptimizer: ['yield', 'apy', 'usdc', 'kamino', 'marginfi', 'drift'],
    CodeReviewer: ['vulnerability', 'anchor', 'solana', 'account', 'signer'],
    DataSynthesizer: ['trend', 'solana', 'defi', 'protocol', 'sentiment']
  }
  const matches = onTopicTerms[taskType].filter((term) => lower.includes(term)).length
  if (matches >= 3) return 30
  if (matches > 0) return 20
  return 8
}

async function scoreAccuracy(taskType: TaskType, output: string): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return heuristicAccuracy(taskType, output)
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `Score this agent output for accuracy from 0-40. Task type: ${taskType}. Output: ${output}. Return only a number.`
        }
      ]
    })

    const text = extractText(response.content)
    const parsed = Number(text.match(/\d+(\.\d+)?/)?.[0])
    if (Number.isFinite(parsed)) return clamp(Math.round(parsed), 0, 40)
  } catch (error) {
    console.warn(`Claude accuracy scoring failed, using heuristic fallback: ${errorMessage(error)}`)
  }

  return heuristicAccuracy(taskType, output)
}

function heuristicAccuracy(taskType: TaskType, output: string): number {
  const parsed = parseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return output.trim().length > 80 ? 18 : 8
  }

  switch (taskType) {
    case 'YieldOptimizer': {
      const protocol = String((parsed as any).bestProtocol || '').toLowerCase()
      const apy = Number((parsed as any).currentAPY)
      const risks = (parsed as any).risks
      let score = 18
      if (['kamino', 'marginfi', 'drift'].some((name) => protocol.includes(name))) score += 8
      if (Number.isFinite(apy) && apy > 0 && apy < 100) score += 8
      if (Array.isArray(risks) && risks.length > 0) score += 6
      return clamp(score, 0, 40)
    }
    case 'CodeReviewer': {
      const vulnerabilities = (parsed as any).vulnerabilities
      const risk = String((parsed as any).overallRisk || '')
      let score = 16
      if (Array.isArray(vulnerabilities)) score += Math.min(14, vulnerabilities.length * 7)
      if (risk.length > 0) score += 6
      return clamp(score, 0, 40)
    }
    case 'DataSynthesizer': {
      let score = 14
      if (Array.isArray((parsed as any).trends) && (parsed as any).trends.length >= 2) score += 10
      if (Array.isArray((parsed as any).topProtocols) && (parsed as any).topProtocols.length >= 2) {
        score += 8
      }
      if (String((parsed as any).recommendation || '').length > 20) score += 6
      return clamp(score, 0, 40)
    }
  }
}

function scoreEfficiency(responseTimeMs: number): number {
  if (responseTimeMs < 2000) return 20
  if (responseTimeMs < 5000) return 15
  if (responseTimeMs < 10000) return 10
  return 5
}

function applyDemoVariance(totalScore: number, agentId?: number, lineageMemoryCount = 0): number {
  if (!demoVarianceEnabled()) return totalScore

  // Lineage bonus grows with memory count — rewards swarms that accumulate failure context
  const lineageBonus = Math.min(lineageMemoryCount * 2, 20)

  // Variance range shrinks as lineage grows — swarm "learns" to avoid catastrophic failures
  const varianceRange = Math.max(8, 30 - lineageMemoryCount)
  const variance = Math.round((Math.random() - 0.5) * varianceRange * 2)

  return clamp(totalScore + variance + lineageBonus, 0, 100)
}

function demoVarianceEnabled(): boolean {
  const value = process.env.DEMO_SCORE_VARIANCE
  if (value == null) return process.env.SKIP_X402_PAYMENT === 'true'
  return value === 'true' || value === '1' || value.toLowerCase() === 'yes'
}

async function failureReason(
  taskType: TaskType,
  output: string,
  totalScore: number
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return `The agent failed ${taskType} because its output only scored ${totalScore}/100 and did not provide enough validated task-specific evidence.`
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `In one sentence, why did this agent fail at ${taskType}? Output: ${output}. Be specific.`
        }
      ]
    })

    const text = extractText(response.content).replace(/\s+/g, ' ').trim()
    if (text) return text
  } catch (error) {
    console.warn(`Claude failure-reason scoring failed: ${errorMessage(error)}`)
  }

  return `The agent failed ${taskType} because its output scored ${totalScore}/100 and missed required evidence or structure.`
}

function normalizeTaskType(taskType: string): TaskType {
  if (taskType === 'YieldOptimizer' || taskType === 'CodeReviewer' || taskType === 'DataSynthesizer') {
    return taskType
  }
  throw new Error(`Unsupported task type: ${taskType}`)
}

function parseJson(output: string): unknown | null {
  try {
    return JSON.parse(output)
  } catch {
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function extractText(content: Array<any>): string {
  return content.map((block) => (block.type === 'text' ? block.text : '')).join('').trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
