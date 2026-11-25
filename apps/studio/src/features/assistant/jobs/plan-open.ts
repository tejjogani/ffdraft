/**
 * Whether a job's plan panel starts open. It floats over the work (and on a phone covers it), so
 * it opens by itself only for a job that has just started; after that it is as the person last
 * left it, remembered per job in this browser. Storage can be missing or refuse: then the panel
 * simply starts closed.
 */
const key = (runId: string) => `pave.jobPlan.${runId}`
const FRESH_MS = 15_000

export function planStartsOpen(
  runId: string,
  startedAt: string | null,
  now = Date.now(),
  store: Pick<Storage, 'getItem'> | null = safeStorage(),
): boolean {
  try {
    const kept = store?.getItem(key(runId))
    if (kept === 'open') return true
    if (kept === 'closed') return false
  } catch {
    // Unreadable storage: fall back to the fresh-job rule.
  }
  return !!startedAt && now - new Date(startedAt).getTime() < FRESH_MS
}

export function rememberPlan(runId: string, open: boolean): void {
  try {
    safeStorage()?.setItem(key(runId), open ? 'open' : 'closed')
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
