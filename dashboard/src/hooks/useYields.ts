'use client'

import { useState, useEffect } from 'react'

export interface YieldEntry {
  protocol: string
  apy: number
  trend: 'up' | 'down' | 'stable'
  tvl?: string
}

const POLL_INTERVAL = 60_000 // 60 seconds

export function useYields(): { yields: YieldEntry[]; updatedAt: number | null } {
  const [yields, setYields]       = useState<YieldEntry[]>([])
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true

    const fetchYields = async () => {
      try {
        const res = await fetch('/api/yields', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as YieldEntry[]
        if (mounted) {
          setYields(data)
          setUpdatedAt(Date.now())
        }
      } catch {
        // silently ignore network errors — stale data is fine
      }
    }

    void fetchYields()
    const id = setInterval(fetchYields, POLL_INTERVAL)

    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  return { yields, updatedAt }
}
