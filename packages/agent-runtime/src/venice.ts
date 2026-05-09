import { TaskType } from './types'

const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1'
const DEFAULT_VENICE_MODEL = 'zai-org-glm-5'

type VeniceRole = 'system' | 'user' | 'assistant'

interface VeniceMessage {
  role: VeniceRole
  content: string
}

interface VeniceChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface LineagePostMortemInput {
  agentId: number
  generation: number
  taskType: TaskType
  score: number
  threshold: number
  output: string | null
  oracleFeedback: string | null
  scoringBreakdown: { relevance: number; accuracy: number; efficiency: number } | null
  accuracyDetails: {
    claimed: number | null
    actual: { protocol: string; apy: number; vault: string } | null
    best: { protocol: string; apy: number; vault: string } | null
    delta: number | null
    reason: string
  } | null
}

export interface LineagePostMortem {
  failureReason: string
  rootCause: string
  correctiveRules: string[]
  promptHints: string[]
  riskWarnings: string[]
  evidence: string[]
}

export interface LineageLessonRecord {
  agentId: number
  generation: number
  taskType: TaskType
  score: number
  failureReason: string
  rootCause?: string
  correctiveRules?: string[]
  promptHints?: string[]
  riskWarnings?: string[]
  evidence?: string[]
  oracleFeedback?: string | null
  source: 'stored' | 'generic'
}

export async function generateVenicePostMortem(
  input: LineagePostMortemInput
): Promise<LineagePostMortem | null> {
  if (!veniceLineageEnabled()) return null

  const content = await callVeniceChat(
    [
      {
        role: 'system',
        content:
          'You are the lineage analyst for SwarmOS, a Darwinian Solana agent swarm. Convert a terminated agent result into compact, transferable failure memory. Be concrete, technical, and bounded by the provided evidence.'
      },
      {
        role: 'user',
        content:
          `Agent ${input.agentId} was terminated.\n` +
          `Task: ${input.taskType}\n` +
          `Generation: ${input.generation}\n` +
          `Score: ${input.score}/100\n` +
          `Threshold: ${input.threshold}/100\n` +
          `Oracle feedback: ${input.oracleFeedback ?? 'none'}\n` +
          `Scoring breakdown: ${JSON.stringify(input.scoringBreakdown ?? {})}\n` +
          `Accuracy details: ${JSON.stringify(input.accuracyDetails ?? {})}\n` +
          `Agent output: ${truncate(input.output ?? 'none', 2200)}\n\n` +
          `Return only valid JSON with this exact shape:\n` +
          `{\n` +
          `  "failureReason": "<specific one-sentence reason>",\n` +
          `  "rootCause": "<what actually caused termination>",\n` +
          `  "correctiveRules": ["<rule future agents can execute>", "<rule>", "<rule>"],\n` +
          `  "promptHints": ["<prompt-level tactic>", "<prompt-level tactic>"],\n` +
          `  "riskWarnings": ["<DeFi or scoring risk to consider>"],\n` +
          `  "evidence": ["<short evidence from the output or oracle>"]\n` +
          `}`
      }
    ],
    { temperature: 0.1, maxTokens: 650 }
  )

  if (!content) return null
  return normalizePostMortem(parseJsonObject<LineagePostMortem>(content))
}

export async function synthesizeVeniceLineageLessons(
  records: LineageLessonRecord[],
  taskType: TaskType,
  maxLessons: number
): Promise<string[] | null> {
  if (!veniceLineageEnabled() || records.length === 0) return null

  const content = await callVeniceChat(
    [
      {
        role: 'system',
        content:
          'You compress SwarmOS lineage memories before they are injected into child agents. Prefer useful tactical guidance over repetitive warnings. Do not preserve contradictions. Current live task data always beats stale lineage.'
      },
      {
        role: 'user',
        content:
          `Task type: ${taskType}\n` +
          `Create at most ${maxLessons} compact lessons from these terminated-agent memories.\n` +
          `Each lesson must be actionable, non-duplicative, and under 180 characters.\n` +
          `Memories:\n${truncate(JSON.stringify(records, null, 2), 9000)}\n\n` +
          `Return only valid JSON:\n` +
          `{"lessons":["<actionable lineage lesson>", "<lesson>"]}`
      }
    ],
    { temperature: 0.15, maxTokens: 800 }
  )

  if (!content) return null
  const parsed = parseJsonObject<{ lessons?: unknown }>(content)
  if (!parsed || !Array.isArray(parsed.lessons)) return null

  return uniqueNonEmptyStrings(parsed.lessons)
    .map((lesson) => truncate(lesson, 220))
    .slice(0, maxLessons)
}

export async function runVeniceTask(
  systemPrompt: string,
  userPrompt: string,
  options: VeniceChatOptions = {}
): Promise<string | null> {
  if (!veniceConfigured()) return null
  return callVeniceChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    options
  )
}

export function parseJsonObject<T>(raw: string): T | null {
  const clean = raw.replace(/```json|```/gi, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}

export function veniceLineageEnabled(): boolean {
  if (process.env.USE_VENICE_LINEAGE === 'false') return false
  return veniceConfigured()
}

function veniceConfigured(): boolean {
  return Boolean(process.env.VENICE_API_KEY)
}

async function callVeniceChat(
  messages: VeniceMessage[],
  options: VeniceChatOptions = {}
): Promise<string | null> {
  const apiKey = process.env.VENICE_API_KEY
  if (!apiKey) return null

  const baseUrl = (process.env.VENICE_BASE_URL || DEFAULT_VENICE_BASE_URL).replace(/\/$/, '')
  const model = options.model || process.env.VENICE_MODEL || DEFAULT_VENICE_MODEL

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 800
      }),
      signal: AbortSignal.timeout(Number(process.env.VENICE_TIMEOUT_MS ?? 30_000))
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${truncate(text, 300)}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch (error) {
    console.warn(`[Venice] lineage analysis unavailable: ${errorMessage(error)}`)
    return null
  }
}

function normalizePostMortem(value: LineagePostMortem | null): LineagePostMortem | null {
  if (!value || typeof value !== 'object') return null

  const failureReason = stringOrEmpty(value.failureReason)
  const rootCause = stringOrEmpty(value.rootCause)
  const correctiveRules = uniqueNonEmptyStrings(value.correctiveRules).slice(0, 4)
  const promptHints = uniqueNonEmptyStrings(value.promptHints).slice(0, 3)
  const riskWarnings = uniqueNonEmptyStrings(value.riskWarnings).slice(0, 3)
  const evidence = uniqueNonEmptyStrings(value.evidence).slice(0, 4)

  if (!failureReason || correctiveRules.length === 0) return null

  return {
    failureReason: truncate(failureReason, 260),
    rootCause: truncate(rootCause || failureReason, 320),
    correctiveRules: correctiveRules.map((item) => truncate(item, 220)),
    promptHints: promptHints.map((item) => truncate(item, 180)),
    riskWarnings: riskWarnings.map((item) => truncate(item, 180)),
    evidence: evidence.map((item) => truncate(item, 180))
  }
}

function uniqueNonEmptyStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const text = stringOrEmpty(value).replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }

  return out
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
