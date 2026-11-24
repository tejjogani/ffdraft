/**
 * A job run as a person watches it: the stored run (from `traces.runs`), with the live stream's
 * newer record while it runs, its steps for the chips, and the clock.
 */
import type { JobStage, Run } from '@pave/schema'
import { useEffect, useState } from 'react'
import { useRpc } from '../../../lib/query'
import { newerRun } from '../model'
import { useRunStream } from '../run-stream'
import { latestJob } from './status'

/** The run as the stream last told it, else as stored. */
export function useLiveRun(stored: Run | null) {
  const view = useRunStream(stored?.id ?? null, stored?.status === 'running')
  const run = newerRun(stored, view?.run ?? null)
  // While it runs, the stream's plan is the newest; after, the stored record has it.
  const job = run && run === view?.run && view.job ? view.job : (run?.job ?? null)
  return { run: run ? { ...run, job } : null, view }
}

/** The newest job of a stage on a piece. */
export function useStageJob(pieceId: string, stage: JobStage) {
  const runs = useRpc('traces.runs', { pieceId, limit: 20 })
  return useLiveRun(latestJob(runs.data, stage))
}

/** Milliseconds since `from`, ticking every second while `ticking`. */
export function useElapsed(from: string | null, to: string | null, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  if (!from) return 0
  return (to ? new Date(to).getTime() : now) - new Date(from).getTime()
}
