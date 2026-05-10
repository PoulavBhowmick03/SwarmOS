'use client'

import { useState, useEffect, useRef } from 'react'
import type { SwarmAccount } from '@/lib/client'

export function useSwarm(swarmAddress: string): {
  swarm: SwarmAccount | null
  isLoading: boolean
  error: Error | null
} {
  const [swarm, setSwarm]       = useState<SwarmAccount | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [error, setError]       = useState<Error | null>(null)
  const cancelRef               = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    const load = async () => {
      try {
        const { getClient } = await import('@/lib/client')
        const data = await getClient().getSwarm(swarmAddress)
        if (!cancelRef.current) {
          setSwarm(data)
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
    const intervalId = setInterval(load, 10_000)

    return () => {
      cancelRef.current = true
      clearInterval(intervalId)
    }
  }, [swarmAddress])

  return { swarm, isLoading, error }
}
