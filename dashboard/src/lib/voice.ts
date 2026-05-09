export interface VoiceSettings {
  stability: number
  similarity_boost: number
}

export class VoiceQueue {
  private queue: string[] = []
  private isPlaying = false
  private muted = false
  readonly voiceId: string
  private onPlayingChange?: (playing: boolean) => void

  constructor(voiceId: string, onPlayingChange?: (playing: boolean) => void) {
    this.voiceId = voiceId
    this.onPlayingChange = onPlayingChange
  }

  enqueue(text: string): void {
    if (this.muted) return
    this.queue.push(text)
    if (!this.isPlaying) void this.processQueue()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      this.queue = []
    }
  }

  clear(): void {
    this.queue = []
  }

  get playing(): boolean {
    return this.isPlaying
  }

  private setPlaying(val: boolean): void {
    this.isPlaying = val
    this.onPlayingChange?.(val)
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.setPlaying(false)
      return
    }

    const text = this.queue.shift()!
    this.setPlaying(true)

    try {
      await this.speak(text)
    } catch (err) {
      console.error('[VoiceQueue] speak error:', err)
    }

    void this.processQueue()
  }

  private async speak(text: string): Promise<void> {
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId: this.voiceId,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 } satisfies VoiceSettings,
      }),
    })

    if (!res.ok) throw new Error(`Voice API ${res.status}`)

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    await new Promise<void>((resolve) => {
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      void audio.play().catch(() => resolve())
    })
  }
}

export type SwarmEventType =
  | 'AgentSpawned'
  | 'AgentScored'
  | 'AgentTerminated'
  | 'AgentSurvived'
  | 'AgentRespawned'

export interface VoiceSwarmEvent {
  type: SwarmEventType
  agent_id: string
  generation?: number
  score?: number
  parent_agent_id?: string
  lineage_hash?: string
}

const ZERO_HASH = '0'

export function getVoiceLine(event: VoiceSwarmEvent): string {
  const { type, agent_id, generation, score, parent_agent_id, lineage_hash } = event

  switch (type) {
    case 'AgentSpawned': {
      const openingLine = `Agent ${agent_id} deployed. Generation ${generation ?? 0}.`
      const hasLineage = lineage_hash && lineage_hash !== ZERO_HASH && lineage_hash !== '0'
      return hasLineage
        ? `${openingLine} Inheriting failure memory from the previous cycle.`
        : openingLine
    }
    case 'AgentScored':
      return `Agent ${agent_id} scored ${score ?? 0} out of one hundred.`

    case 'AgentTerminated':
      return `Agent ${agent_id} terminated. Score ${score ?? 0} fell below threshold. Recording failure to chain.`

    case 'AgentSurvived':
      return `Agent ${agent_id} survived. Score ${score ?? 0}. Genetic memory preserved.`

    case 'AgentRespawned':
      return `Successor spawned. Agent ${agent_id} inherits the failure of agent ${parent_agent_id ?? 'unknown'}. It will not make the same mistakes.`
  }
}
