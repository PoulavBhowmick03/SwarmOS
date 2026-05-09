import Anthropic from '@anthropic-ai/sdk'
import { Keypair } from '@solana/web3.js'
import { createKeyPairSignerFromBytes } from '@solana/kit'
import { wrapAxiosWithPayment, x402Client } from '@x402/axios'
import { registerExactSvmScheme } from '@x402/svm/exact/client'
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm'
import axios, { AxiosInstance } from 'axios'
import { fetchLiveYields, YieldOpportunity, YieldProtocol } from './data/yields'
import { TaskType } from './types'
import { runVeniceTask } from './venice'

export interface ChildAgentConfig {
  agentId: number
  generation: number
  taskType: TaskType
  lineageContext: string[]
  wallet: Keypair
  oracleUrl?: string
}

export const TASK_PROMPTS: Record<TaskType, string> = {
  YieldOptimizer: '', // built dynamically from live yield data in buildPrompt()
  CodeReviewer:
    'You are a Solana security auditor. Review this Anchor program snippet for vulnerabilities: [PLACEHOLDER CODE]. Return JSON: { vulnerabilities: Array<{severity: string, description: string, line: string}>, overallRisk: string }',
  DataSynthesizer:
    'Summarize the key trends in Solana DeFi from the past 30 days. Return JSON: { trends: string[], topProtocols: string[], sentiment: string, recommendation: string }'
}

export class ChildAgent {
  agentId: number
  generation: number
  taskType: TaskType
  lineageContext: string[]
  wallet: Keypair
  oracleUrl: string
  lastOutput: string | null = null
  lastScore: number | null = null
  stalePDA = false
  lastExecutionTimeMs: number | null = null
  lastScoringBreakdown: { relevance: number; accuracy: number; efficiency: number } | null = null
  lastAccuracyDetails: { claimed: number | null; actual: { protocol: string; apy: number; vault: string } | null; best: { protocol: string; apy: number; vault: string } | null; delta: number | null; reason: string } | null = null
  lastOracleFeedback: string | null = null

  constructor(config: ChildAgentConfig) {
    this.agentId = config.agentId
    this.generation = config.generation
    this.taskType = config.taskType
    this.lineageContext = config.lineageContext
    this.wallet = config.wallet
    this.oracleUrl =
      config.oracleUrl ?? process.env.SCORING_ORACLE_URL ?? 'http://localhost:3001'
  }

  async executeTask(): Promise<string> {
    const startedAt = Date.now()
    const liveYields = this.taskType === 'YieldOptimizer' ? await fetchLiveYields() : []
    const systemPrompt = this.buildPrompt(liveYields)
    const userPrompt = 'Execute the task now. Return only the requested JSON object, with no markdown fences.'

    console.log(`Agent ${this.agentId} prompt context: ${systemPrompt.slice(0, 300)}...`)
    if (this.lineageContext.length > 0) {
      const marker = systemPrompt.indexOf('LINEAGE MEMORY')
      const start = marker >= 0 ? marker : 0
      console.log(`[Agent ${this.agentId}] lineage lessons (${this.lineageContext.length}): ${systemPrompt.slice(start, start + 240).replace(/\n/g, ' ')}`)
    }

    const provider = this.selectedLlmProvider()
    if (provider === 'venice') {
      const text = await runVeniceTask(systemPrompt, userPrompt, {
        model: process.env.VENICE_AGENT_MODEL || process.env.VENICE_MODEL,
        temperature: 0.2,
        maxTokens: 1800,
        responseFormat: 'json_object',
        disableReasoning: true,
        label: `agent ${this.agentId} task execution`
      })

      if (text) {
        console.log(`[Agent ${this.agentId}] raw output: ${text.slice(0, 300).replace(/\n/g, ' ')}`)
        this.logRecommendation(text)
        this.lastExecutionTimeMs = Date.now() - startedAt
        this.lastOutput = text
        return text
      }

      console.warn(`Venice execution failed or returned empty output, using demo fallback output`)
      const mock = this.mockOutput(liveYields)
      this.logRecommendation(mock)
      this.lastExecutionTimeMs = Date.now() - startedAt
      this.lastOutput = mock
      return mock
    }

    if (provider === 'mock') {
      const mock = this.mockOutput(liveYields)
      this.logRecommendation(mock)
      this.lastExecutionTimeMs = Date.now() - startedAt
      this.lastOutput = mock
      return mock
    }

    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

      const completion = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 1200,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })

      const text = completion.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim()

      console.log(`[Agent ${this.agentId}] raw output: ${text.slice(0, 300).replace(/\n/g, ' ')}`)
      this.logRecommendation(text)
      this.lastExecutionTimeMs = Date.now() - startedAt
      this.lastOutput = text
      return text
    } catch (error) {
      console.warn(`Anthropic execution failed, using demo fallback output: ${errorMessage(error)}`)
      const mock = this.mockOutput(liveYields)
      this.logRecommendation(mock)
      this.lastExecutionTimeMs = Date.now() - startedAt
      this.lastOutput = mock
      return mock
    }
  }

  async submitToOracle(output: string): Promise<number> {
    const api = await this.createOracleClient()
    const response = await api.post(
      '/evaluate',
      {
        agentId: this.agentId,
        taskType: this.taskType,
        output,
        lineageMemoryCount: this.lineageContext.length
      },
      {
        headers: {
          'x-agent-response-time-ms': String(this.lastExecutionTimeMs ?? 0)
        }
      }
    )

    const score = Number(response.data?.score)
    if (!Number.isFinite(score)) {
      throw new Error(`Scoring oracle returned an invalid score: ${JSON.stringify(response.data)}`)
    }

    this.lastScore = score
    this.lastScoringBreakdown = response.data?.breakdown ?? null
    this.lastAccuracyDetails = response.data?.accuracyDetails ?? null
    this.lastOracleFeedback = response.data?.feedback ?? null
    return score
  }

  private async createOracleClient(): Promise<AxiosInstance> {
    if (process.env.SKIP_X402_PAYMENT === 'true') {
      return axios.create({
        baseURL: this.oracleUrl.replace(/\/$/, ''),
        timeout: 120_000
      })
    }

    return this.createPaidOracleClient()
  }

  private async createPaidOracleClient(): Promise<AxiosInstance> {
    const paymentClient = new x402Client()
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(this.wallet.secretKey))
    registerExactSvmScheme(paymentClient, {
      signer,
      networks: [(process.env.SVM_NETWORK || SOLANA_DEVNET_CAIP2) as any]
    })

    return wrapAxiosWithPayment(
      axios.create({
        baseURL: this.oracleUrl.replace(/\/$/, ''),
        timeout: 120_000
      }),
      paymentClient
    )
  }

  private buildPrompt(liveYields: YieldOpportunity[] = []): string {
    const lineageSuffix = this.buildLineageSuffix()

    if (this.taskType === 'YieldOptimizer') {
      const rows =
        liveYields.length > 0
          ? liveYields
              .slice(0, 6)
              .map(
                (y) =>
                  `- ${y.protocol} ${y.vault}: ${(y.apy * 100).toFixed(2)}% APY (7d), TVL $${Math.round(y.tvl).toLocaleString()}, risk ${y.riskScore}/10`
              )
              .join('\n')
          : '- No live yield data available; base your recommendation on your training knowledge.'

      return (
        `You are a DeFi yield-optimization agent on Solana. Current USDC yield opportunities (fetched live):\n${rows}\n\n` +
        `Recommend the optimal strategy for a $10,000 USDC position. Use exact protocol and vault names from the list above.` +
        lineageSuffix +
        `\n\n` +
        `Return ONLY valid JSON — no markdown fences:\n` +
        `{\n  "recommendedProtocol": "<exact protocol name from the list>",\n  "recommendedVault": "<exact vault name from the list>",\n  "expectedAPY": <decimal e.g. 0.044>,\n  "reasoning": "<2-3 sentences citing specific APY and TVL numbers from above>",\n  "riskAssessment": "<1 sentence mentioning TVL size or utilization risk>",\n  "alternativeProtocol": "<second-best protocol name>",\n  "alternativeAPY": <decimal>\n}`
      )
    }

    const base = TASK_PROMPTS[this.taskType]
    return lineageSuffix ? `${base}${lineageSuffix}` : base
  }

  private buildLineageSuffix(): string {
    if (this.lineageContext.length === 0) return ''

    const maxChars = Number(process.env.LINEAGE_PROMPT_MAX_CHARS ?? 3200)
    const lines: string[] = []
    let used = 0

    for (const [index, lesson] of this.lineageContext.entries()) {
      const line = `${index + 1}. ${lesson.replace(/\s+/g, ' ').trim()}`
      if (!line.trim()) continue
      if (used + line.length > maxChars) break
      lines.push(line)
      used += line.length
    }

    if (lines.length === 0) return ''

    return (
      `\n\nLINEAGE MEMORY FROM TERMINATED AGENTS:\n` +
      `${lines.join('\n')}\n\n` +
      `Use these post-mortem lessons to avoid known failure modes. Current live task data above is authoritative; never copy stale APYs or stale TVL from lineage memory.`
    )
  }

  private selectedLlmProvider(): 'anthropic' | 'venice' | 'mock' {
    const configured = process.env.AGENT_LLM_PROVIDER?.trim().toLowerCase()
    if (configured === 'venice') return 'venice'
    if (configured === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'
    if (configured === 'mock') return 'mock'
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
    if (process.env.VENICE_API_KEY) return 'venice'
    return 'mock'
  }

  private mockOutput(liveYields: YieldOpportunity[] = []): string {
    switch (this.taskType) {
      case 'YieldOptimizer': {
        const best = liveYields[0]
        const second = liveYields[1]
        if (best) {
          return JSON.stringify({
            recommendedProtocol: best.protocol,
            recommendedVault: best.vault,
            expectedAPY: parseFloat(best.apy.toFixed(4)),
            reasoning: `${best.protocol} ${best.vault} offers ${(best.apy * 100).toFixed(2)}% 7-day APY with $${Math.round(best.tvl).toLocaleString()} TVL, the highest among current live opportunities.`,
            riskAssessment: `TVL of $${Math.round(best.tvl).toLocaleString()} provides reasonable liquidity depth; risk score ${best.riskScore}/10.`,
            alternativeProtocol: second?.protocol ?? 'MarginFi',
            alternativeAPY: parseFloat((second?.apy ?? 0.045).toFixed(4)),
          })
        }
        return JSON.stringify({
          recommendedProtocol: 'Kamino',
          recommendedVault: 'SOL/USDC',
          expectedAPY: 0.072,
          reasoning: 'No live data available; using training-knowledge estimate for Kamino USDC lending.',
          riskAssessment: 'Estimate only — verify live APY before deploying capital.',
          alternativeProtocol: 'MarginFi',
          alternativeAPY: 0.055,
        })
      }
      case 'CodeReviewer':
        return JSON.stringify({
          vulnerabilities: [
            {
              severity: 'medium',
              description:
                'The placeholder review target does not include enough account constraints to verify signer and ownership assumptions.',
              line: '[PLACEHOLDER CODE]'
            }
          ],
          overallRisk: 'medium'
        })
      case 'DataSynthesizer':
        return JSON.stringify({
          trends: [
            'Stablecoin lending remains the dominant DeFi agent workflow',
            'Liquidity incentives continue to move APYs across protocols',
            'Risk-adjusted routing matters more than headline yield'
          ],
          topProtocols: ['Kamino', 'Drift', 'MarginFi'],
          sentiment: 'constructive but risk-sensitive',
          recommendation:
            'Prefer diversified USDC lending routes and re-check live utilization before deployment.'
        })
    }
  }

  private logRecommendation(text: string): void {
    if (this.taskType !== 'YieldOptimizer') return
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const protocol = String(parsed.recommendedProtocol ?? parsed.bestProtocol ?? 'unknown')
      const rawApy = Number(parsed.expectedAPY ?? parsed.currentAPY ?? NaN)
      const apyPct = Number.isFinite(rawApy) ? (rawApy > 1 ? rawApy : rawApy * 100) : 0
      console.log(
        `Agent ${this.agentId} recommendation: ` +
        `${protocol} at ${apyPct.toFixed(2)}% APY` +
        (this.lineageContext.length > 0
          ? ` (inheriting ${this.lineageContext.length} failure memories)`
          : ' (no lineage context)')
      )
    } catch {
      console.log(`Agent ${this.agentId} recommendation: (could not parse output)`)
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
