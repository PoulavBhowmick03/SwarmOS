'use client'

import { useState, useEffect, useRef } from 'react'
import type { LineageMemoryAccount } from '@/lib/client'

export function useLineage(swarmAddress: string): {
  memories: LineageMemoryAccount[]
  isLoading: boolean
  error: Error | null
} {
  const [memories, setMemories] = useState<LineageMemoryAccount[]>([])
  const [isLoading, setLoading] = useState(true)
  const [error, setError]       = useState<Error | null>(null)
  const cancelRef               = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    let intervalId: ReturnType<typeof setInterval>

    const load = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        const data = await getClient().getAllLineageMemories(swarmAddress)
        if (!cancelRef.current) {
          setMemories(data)
          setLoading(false)
          setError(null)
        }
      } catch (e) {
        if (!cancelRef.current) {
          setError(e as Error)
          setLoading(false)
        }
      }
    }

    void load()
    intervalId = setInterval(load, 60_000)

    return () => {
      cancelRef.current = true
      clearInterval(intervalId)
    }
  }, [swarmAddress])

  return { memories, isLoading, error }
}
