'use client'

import { useEffect, useRef, useState } from 'react'
import { VoiceQueue } from '@/lib/voice'
import type { SwarmEvent } from '@/lib/client'

import type { VoiceSettings } from '@/lib/voice'

const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB'

// Voice gets more expressive (lower stability) as generations increase
function settingsForGen(gen: number): VoiceSettings {
  if (gen <= 1) return { stability: 0.60, similarity_boost: 0.75 }
  if (gen === 2) return { stability: 0.42, similarity_boost: 0.80 }
  return              { stability: 0.28, similarity_boost: 0.85 }
}

function eventKey(e: SwarmEvent): string {
  const id = e.agentId ?? e.newAgentId ?? 0
  return `${e.type}:${id}:${e.generation ?? 0}`
}

// One line per generation wave — suppress per-agent spawn noise
function buildSpawnWaveLine(gen: number, agentCount: number, totalMemories: number): string {
  const memPhrase = totalMemories > 0
    ? `carrying ${totalMemories} failure ${totalMemories === 1 ? 'memory' : 'memories'} from the dead`
    : 'no inherited knowledge — entering blind'

  if (gen <= 1) {
    return `Generation one begins. ${agentCount} agents deployed — ${memPhrase}. The market will sort them.`
  }
  if (gen === 2) {
    return `Generation two. ${agentCount} agents, each ${memPhrase}. The swarm is learning from its casualties.`
  }
  return `Generation ${gen}. ${agentCount} evolved agents — ${memPhrase}. Every mistake the swarm has made is now a weapon.`
}

function buildTerminateLine(event: SwarmEvent, gen: number): string {
  const id       = event.agentId ?? 0
  const score    = event.score ?? 0
  const protocol = event.protocol ?? 'the protocol'

  if (event.claimedAPY != null && event.actualAPY != null) {
    const deltaSign = event.claimedAPY > event.actualAPY ? 'over' : 'under'
    const deltaPct  = Math.abs((event.claimedAPY - event.actualAPY) * 100).toFixed(1)

    if (gen <= 1) {
      return `Agent ${id} eliminated. Score ${score}. Claimed ${protocol} at ${event.claimedAPY.toFixed(2)} percent — actual was ${event.actualAPY.toFixed(2)}. ${deltaPct} points ${deltaSign}estimated. Failure written to chain.`
    }
    if (gen === 2) {
      return `Agent ${id} cut. Score ${score}. Still hallucinating yields — ${deltaPct} points off. Its predecessors made this exact mistake. The chain will make sure generation three does not.`
    }
    return `Agent ${id} is gone. Score ${score}. ${deltaPct} points ${deltaSign}estimated — in generation ${gen}, that is unacceptable. The swarm has no mercy for repeated failure.`
  }

  if (gen <= 1) {
    return `Agent ${id} terminated. Score ${score} — below threshold. Failure recorded on-chain.`
  }
  return `Agent ${id} cut. Score ${score}. Generation ${gen} holds a higher standard. The chain remembers.`
}

function buildRespawnLine(event: SwarmEvent, gen: number): string {
  const id       = event.newAgentId ?? 0
  const parentId = event.parentAgentId
  const mem      = event.inheritedMemories ?? 0

  if (gen <= 1) {
    return `Agent ${id} spawned from the failure of agent ${parentId ?? 'its predecessor'}. ${mem > 0 ? `${mem} failure memories injected.` : ''} The swarm continues.`
  }
  if (gen === 2) {
    return `Agent ${id} rises from agent ${parentId ?? 'the fallen'}. It carries ${mem} distilled failure ${mem === 1 ? 'memory' : 'memories'}. Generation two does not guess — it inherits.`
  }
  return `Agent ${id}. Born from failure. ${mem} lessons encoded. Generation ${gen}. This is Darwin running on Solana.`
}

function buildSurvivedLine(event: SwarmEvent, gen: number): string {
  const id       = event.agentId ?? 0
  const score    = event.score ?? 0
  const protocol = event.protocol ?? 'its protocol'

  if (gen <= 1) {
    return `Agent ${id} survives. Score ${score}. Its read on ${protocol} holds. Knowledge preserved for the next wave.`
  }
  return `Agent ${id} survives generation ${gen}. Score ${score}. The evolved cohort grows stronger.`
}

interface Props {
  events: SwarmEvent[]
}

export function VoiceNarrator({ events }: Props) {
  const [muted, setMuted]           = useState(false)
  const [isPlaying, setPlaying]     = useState(false)
  const [rateLimited, setRateLimit] = useState(false)
  const voiceQueueRef               = useRef<VoiceQueue | null>(null)
  const seenRef                     = useRef<Set<string>>(new Set())
  const initializedRef              = useRef(false)
  // Track which generations we've already announced as a wave
  const announcedGenRef             = useRef<Set<number>>(new Set())
  // Buffer spawns briefly to batch them into one wave announcement
  const spawnBufferRef              = useRef<Map<number, { count: number; memories: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map())

  useEffect(() => {
    voiceQueueRef.current = new VoiceQueue(VOICE_ID, setPlaying, setRateLimit)
    return () => voiceQueueRef.current?.clear()
  }, [])

  useEffect(() => {
    voiceQueueRef.current?.setMuted(muted)
  }, [muted])

  useEffect(() => {
    const queue = voiceQueueRef.current
    if (!queue || events.length === 0) return

    if (!initializedRef.current) {
      initializedRef.current = true
      for (const e of events) seenRef.current.add(eventKey(e))
      // Also mark all generations in existing events as already announced
      for (const e of events) {
        if (e.type === 'AgentSpawned' && e.generation != null) {
          announcedGenRef.current.add(e.generation)
        }
      }
      return
    }

    if (muted) return

    for (const e of events) {
      const key = eventKey(e)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)

      const gen = e.generation ?? 0

      if (e.type === 'AgentSpawned') {
        // Batch all spawns within the same generation into one wave announcement
        const buf = spawnBufferRef.current.get(gen) ?? { count: 0, memories: 0, timer: null }
        buf.count++
        buf.memories += e.inheritedMemories ?? 0
        if (buf.timer) clearTimeout(buf.timer)
        buf.timer = setTimeout(() => {
          if (!announcedGenRef.current.has(gen)) {
            announcedGenRef.current.add(gen)
            const line = buildSpawnWaveLine(gen, buf.count, buf.memories)
            queue.enqueue(line, settingsForGen(gen), 'normal')
          }
          spawnBufferRef.current.delete(gen)
        }, 600)
        spawnBufferRef.current.set(gen, buf)
        continue
      }

      if (e.type === 'AgentScored') continue // too noisy, skip

      if (e.type === 'AgentTerminated') {
        const line = buildTerminateLine(e, gen)
        queue.enqueue(line, settingsForGen(gen), 'high')
        continue
      }

      if (e.type === 'AgentRespawned') {
        const line = buildRespawnLine(e, gen)
        queue.enqueue(line, settingsForGen(gen), 'high')
        continue
      }

      if (e.type === 'AgentSurvived') {
        const line = buildSurvivedLine(e, gen)
        queue.enqueue(line, settingsForGen(gen), 'normal')
        continue
      }
    }
  }, [events, muted])

  return (
    <button
      onClick={() => setMuted((m) => !m)}
      title={muted ? 'Unmute narration' : 'Mute narration'}
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        6,
        padding:    '4px 10px',
        borderRadius: 3,
        border:     '1px solid #2a2a2a',
        background: rateLimited && !muted ? '#F5A62322' : isPlaying && !muted ? '#9945FF22' : '#111',
        color:      rateLimited && !muted ? '#F5A623'   : isPlaying && !muted ? '#9945FF'   : '#555',
        cursor:     'pointer',
        fontSize:   10,
        letterSpacing: '0.12em',
        fontFamily: 'inherit',
        transition: 'all 0.2s',
        outline:    'none',
        whiteSpace: 'nowrap',
      }}
      onMouseOver={(e) => { if (!isPlaying || muted) e.currentTarget.style.color = '#888' }}
      onMouseOut={(e)  => { if (!isPlaying || muted) e.currentTarget.style.color = '#555' }}
    >
      {rateLimited && !muted ? (
        <>
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: '#F5A623' }}/>
          RATE LIMITED
        </>
      ) : isPlaying && !muted ? (
        <>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: '#9945FF',
            animation: 'so-pulse 1s ease-in-out infinite',
          }}/>
          NARRATING
        </>
      ) : muted ? (
        <>🔇 MUTED</>
      ) : (
        <>🔊 VOICE</>
      )}
    </button>
  )
}
