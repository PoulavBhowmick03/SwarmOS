import { TaskType } from './types'

const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1'
const DEFAULT_VENICE_MODEL = 'zai-org-glm-5-1'

type VeniceRole = 'system' | 'user' | 'assistant'
type VeniceReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface VeniceMessage {
  role: VeniceRole
  content: string
}

interface VeniceChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: 'json_object'
  disableReasoning?: boolean
  reasoningEffort?: VeniceReasoningEffort
  label?: string
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
    {
      temperature: 0.1,
      maxTokens: 900,
      responseFormat: 'json_object',
      disableReasoning: true,
      label: 'lineage post-mortem'
    }
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
    {
      temperature: 0.15,
      maxTokens: 1000,
      responseFormat: 'json_object',
      disableReasoning: true,
      label: 'lineage lesson synthesis'
    }
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
  const clean = stripThinkingBlocks(raw).replace(/```(?:json)?|```/gi, '').trim()
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
  const maxCompletionTokens = options.maxTokens ?? 800
  const disableReasoning =
    options.disableReasoning ??
    process.env.VENICE_DISABLE_REASONING !== 'false'
  const reasoningEffort = options.reasoningEffort ?? parseReasoningEffort(
    process.env.VENICE_REASONING_EFFORT
  )

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_completion_tokens: maxCompletionTokens,
    max_tokens: maxCompletionTokens,
    n: 1,
    venice_parameters: {
      strip_thinking_response: true,
      disable_thinking: disableReasoning,
      enable_web_search: 'off',
      enable_web_scraping: false,
      enable_web_citations: false,
      include_venice_system_prompt: false
    }
  }

  if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' }
  }

  if (disableReasoning) {
    body.reasoning = { enabled: false }
  } else if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort
    body.reasoning = { effort: reasoningEffort }
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.VENICE_TIMEOUT_MS ?? 30_000))
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${truncate(text, 300)}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string
        stop_reason?: string | null
        message?: { content?: string; reasoning_content?: string | null }
      }>
      usage?: {
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = data.choices?.[0]
    const content = stripThinkingBlocks(choice?.message?.content ?? '').trim()

    if (!content) {
      const reason = choice?.finish_reason ?? choice?.stop_reason ?? 'unknown'
      const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens
      console.warn(
        `[Venice] ${options.label ?? 'chat'} returned no visible content ` +
          `(finish=${reason}, reasoning_tokens=${reasoningTokens ?? 'n/a'})`
      )
      return null
    }

    return content
  } catch (error) {
    console.warn(`[Venice] ${options.label ?? 'chat'} unavailable: ${errorMessage(error)}`)
    return null
  }
}

function parseReasoningEffort(value: string | undefined): VeniceReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return normalized
    default:
      return undefined
  }
}

function stripThinkingBlocks(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
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
