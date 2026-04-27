import { useState, useEffect, useRef } from 'react'
import { bsApi } from '@/api/bookstack'
import type { BSImport } from '@/types/bookstack'

type ImportStatus = BSImport['status']

interface PollerResult {
  status: ImportStatus
  currentStep: number
}

function statusToStep(status: ImportStatus): number {
  switch (status) {
    case 'pending':
      return 0
    case 'running':
      return 2
    case 'complete':
      return 6
    case 'failed':
      return -1
    default:
      return 0
  }
}

export function useIngestPoller(importId: number | null): PollerResult | null {
  const [result, setResult] = useState<PollerResult | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (importId === null) {
      setResult(null)
      stoppedRef.current = false
      return
    }

    stoppedRef.current = false

    const poll = async () => {
      if (stoppedRef.current) return
      try {
        const data = await bsApi.pollImport(importId)
        const step = statusToStep(data.status)
        setResult({ status: data.status, currentStep: step })
        if (data.status === 'complete' || data.status === 'failed') {
          stoppedRef.current = true
        }
      } catch {
        // swallow errors silently during polling
      }
    }

    const intervalId = setInterval(() => {
      if (!stoppedRef.current) {
        poll()
      } else {
        clearInterval(intervalId)
      }
    }, 2000)

    return () => {
      stoppedRef.current = true
      clearInterval(intervalId)
    }
  }, [importId])

  return result
}
