'use client'

import { useEffect, useRef, useState } from 'react'
import { VoiceQueue } from '@/lib/voice'
import type { SwarmEvent } from '@/lib/client'

const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB'

// Unique key per event — NOT timestamp (all events in a batch share the same timestamp)
function eventKey(e: SwarmEvent): string {
  const id = e.agentId ?? e.newAgentId ?? 0
  return `${e.type}:${id}:${e.generation ?? 0}`
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)} percent`
}

function buildLine(event: SwarmEvent): string | null {
  const id    = event.agentId ?? event.newAgentId ?? 0
  const gen   = event.generation ?? 0
  const score = event.score ?? 0

  switch (event.type) {
    case 'AgentSpawned': {
      const mem = event.inheritedMemories ?? 0
      if (mem >= 5) {
        return `Agent ${id} enters generation ${gen}, armed with ${mem} inherited failure memories. ` +
          `Every mistake its ancestors made is now a constraint in its reasoning. This one knows what not to do.`
      }
      if (mem > 0) {
        return `Agent ${id} launches into generation ${gen}. It carries ${mem} failure ${mem === 1 ? 'memory' : 'memories'} from the last wave. ` +
          `The chain does not forget.`
      }
      return `Agent ${id} is deployed. Generation ${gen}. No inherited knowledge — ` +
        `it enters the DeFi arena with nothing but its own reasoning. The market will judge it.`
    }

    case 'AgentScored': {
      const protocol = event.protocol ?? 'an unknown protocol'
      const actual   = event.actualAPY != null ? pct(event.actualAPY) : null
      if (score >= 83) {
        return `Agent ${id} scores ${score} out of one hundred. ` +
          (actual ? `It found ${protocol} at ${actual}. ` : '') +
          `A strong read. The swarm moves forward with this intelligence.`
      }
      if (score >= 60) {
        return `Agent ${id} comes in at ${score}. ` +
          (actual ? `${protocol} at ${actual}. ` : '') +
          `It clears the threshold — but only just. Survival is not guaranteed.`
      }
      return `Agent ${id} scores ${score}. ` +
        (actual ? `${protocol} at ${actual}. ` : '') +
        `Below sixty. The oracle is not impressed.`
    }

    case 'AgentSurvived': {
      const protocol = event.protocol ?? 'its recommended protocol'
      return `Agent ${id} survives generation ${gen} with a score of ${score}. ` +
        `Its read on ${protocol} holds up against live market data. ` +
        `Its knowledge is preserved — the next generation will inherit this edge.`
    }

    case 'AgentTerminated': {
      const protocol = event.protocol ?? 'the protocol'
      const claimed  = event.claimedAPY != null ? pct(event.claimedAPY) : null
      const actual   = event.actualAPY  != null ? pct(event.actualAPY)  : null

      if (claimed && actual && event.claimedAPY != null && event.actualAPY != null) {
        const deltaSign = event.claimedAPY > event.actualAPY ? 'over' : 'under'
        const deltaPct  = Math.abs((event.claimedAPY - event.actualAPY) * 100).toFixed(1)
        return `Agent ${id} is eliminated. Score: ${score}. ` +
          `It claimed ${protocol} was returning ${claimed}. ` +
          `The live rate was ${actual}. ` +
          `${deltaPct} points ${deltaSign}estimated. ` +
          `This hallucination is now written permanently to the Solana chain. ` +
          `Every successor will know: do not repeat this mistake.`
      }

      return `Agent ${id} is cut from the swarm. Score ${score} — below the survival threshold. ` +
        `Its failure is recorded on-chain. The chain remembers what it got wrong ` +
        `so the next generation does not have to learn it the hard way.`
    }

    case 'AgentRespawned': {
      const parentId = event.parentAgentId
      const mem      = event.inheritedMemories ?? 0
      if (parentId) {
        return `Agent ${parentId} is dead. From its failure, agent ${id} is born. ` +
          `${mem > 0 ? `It inherits ${mem} failure ${mem === 1 ? 'memory' : 'memories'} — ` : ''}` +
          `the distilled lessons of every agent the swarm has lost. ` +
          `This is Darwin running on Solana.`
      }
      return `A new successor rises: agent ${id}. ` +
        `Generation ${gen}. ${mem} failure memories embedded in its context. ` +
        `The swarm does not mourn its dead — it learns from them.`
    }
  }

  return null
}

interface Props {
  events: SwarmEvent[]
}

export function VoiceNarrator({ events }: Props) {
  const [muted, setMuted]       = useState(false)
  const [isPlaying, setPlaying] = useState(false)
  const voiceQueueRef           = useRef<VoiceQueue | null>(null)
  const seenRef                 = useRef<Set<string>>(new Set())
  const initializedRef          = useRef(false)

  useEffect(() => {
    voiceQueueRef.current = new VoiceQueue(VOICE_ID, setPlaying)
    return () => voiceQueueRef.current?.clear()
  }, [])

  useEffect(() => {
    voiceQueueRef.current?.setMuted(muted)
  }, [muted])

  useEffect(() => {
    const queue = voiceQueueRef.current
    if (!queue || events.length === 0) return

    // First non-empty batch is historical — mark all as seen, don't narrate
    if (!initializedRef.current) {
      initializedRef.current = true
      for (const e of events) seenRef.current.add(eventKey(e))
      return
    }

    if (muted) return

    for (const e of events) {
      const key = eventKey(e)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      const line = buildLine(e)
      if (line) queue.enqueue(line)
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
        background: isPlaying && !muted ? '#9945FF22' : '#111',
        color:      isPlaying && !muted ? '#9945FF'   : '#555',
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
      {isPlaying && !muted ? (
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
