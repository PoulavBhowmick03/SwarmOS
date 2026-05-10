export interface VoiceSettings {
  stability: number
  similarity_boost: number
}

interface QueueItem {
  text: string
  settings: VoiceSettings
  priority: 'high' | 'normal'
}

export class VoiceQueue {
  private queue: QueueItem[] = []
  private isPlaying = false
  private isProcessing = false
  private muted = false
  private currentAudio: HTMLAudioElement | null = null
  private currentAbort: AbortController | null = null
  private currentUrl: string | null = null
  private cooldownUntil = 0
  private consecutiveFailures = 0
  readonly voiceId: string
  private onPlayingChange?: (playing: boolean) => void
  private onErrorChange?: (rateLimited: boolean) => void

  constructor(
    voiceId: string,
    onPlayingChange?: (playing: boolean) => void,
    onErrorChange?: (rateLimited: boolean) => void,
  ) {
    this.voiceId = voiceId
    this.onPlayingChange = onPlayingChange
    this.onErrorChange = onErrorChange
  }

  get rateLimited(): boolean {
    return Date.now() < this.cooldownUntil
  }

  enqueue(text: string, settings?: VoiceSettings, priority: 'high' | 'normal' = 'normal'): void {
    if (this.muted) return
    const item: QueueItem = {
      text,
      settings: settings ?? { stability: 0.5, similarity_boost: 0.75 },
      priority,
    }
    if (priority === 'high') {
      // High-priority events (terminate, respawn) flush the backlog and jump in next
      this.queue = this.queue.filter((q) => q.priority === 'high')
      this.queue.unshift(item)
    } else {
      // Normal events: drop if queue is already backed up
      if (this.queue.length >= 2) return
      this.queue.push(item)
    }
    if (!this.isPlaying) void this.processQueue()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      this.clear()
      this.cooldownUntil = 0
      this.consecutiveFailures = 0
      this.onErrorChange?.(false)
    }
  }

  clear(): void {
    this.queue = []
    this.currentAbort?.abort()
    this.currentAbort = null
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.src = ''
      this.currentAudio = null
    }
    this.revokeCurrentUrl()
  }

  get playing(): boolean {
    return this.isPlaying
  }

  private setPlaying(val: boolean): void {
    this.isPlaying = val
    this.onPlayingChange?.(val)
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      while (!this.muted && this.queue.length > 0) {
        // Respect cooldown — wait it out rather than draining and dropping items
        const now = Date.now()
        if (now < this.cooldownUntil) {
          await sleep(Math.min(this.cooldownUntil - now, 3_000))
          continue
        }

        const item = this.queue.shift()!
        this.setPlaying(true)

        try {
          await this.speak(item.text, item.settings)
          // Reset failure streak on success
          if (this.consecutiveFailures > 0) {
            this.consecutiveFailures = 0
            this.onErrorChange?.(false)
          }
        } catch (err) {
          this.consecutiveFailures++
          console.error('[VoiceQueue] speak error:', err)
        }

        await sleep(200)
      }
    } finally {
      this.isProcessing = false
      this.setPlaying(false)
    }
  }

  private async speak(text: string, settings: VoiceSettings): Promise<void> {
    this.currentAbort = new AbortController()
    const timeoutId = setTimeout(() => this.currentAbort?.abort(), 20_000)

    let blob: Blob
    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.currentAbort.signal,
        body: JSON.stringify({
          text,
          voiceId: this.voiceId,
          model_id: 'eleven_turbo_v2',
          voice_settings: settings,
        }),
      })

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          const retryAfter = res.headers.get('Retry-After')
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : 15_000
          this.cooldownUntil = Date.now() + Math.min(waitMs, 60_000)
          this.onErrorChange?.(true)
        }
        throw new Error(`Voice API ${res.status}`)
      }
      blob = await res.blob()
    } finally {
      clearTimeout(timeoutId)
      this.currentAbort = null
    }

    await this.playBlob(blob, text)
  }

  private async playBlob(blob: Blob, text: string): Promise<void> {
    if (this.queue.length === 0) {
      // no-op; keep the method body below linear for cleanup
    }

    const url = URL.createObjectURL(blob)
    this.currentUrl = url

    const audio = new Audio(url)
    this.currentAudio = audio
    audio.preload = 'auto'

    const maxPlaybackMs = Math.min(45_000, Math.max(8_000, text.length * 95))

    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cleanup()
          reject(new Error('Voice playback timed out'))
        }, maxPlaybackMs)

        const cleanup = () => {
          clearTimeout(timeoutId)
          audio.onended = null
          audio.onerror = null
        }

        audio.onended = () => {
          cleanup()
          resolve()
        }
        audio.onerror = () => {
          cleanup()
          reject(new Error('Voice playback failed'))
        }

        void audio.play().catch((error) => {
          cleanup()
          reject(error)
        })
      })
    } finally {
      audio.pause()
      audio.src = ''
      if (this.currentAudio === audio) this.currentAudio = null
      this.revokeCurrentUrl()
    }
  }

  private revokeCurrentUrl(): void {
    if (!this.currentUrl) return
    URL.revokeObjectURL(this.currentUrl)
    this.currentUrl = null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
