/**
 * Browser takes: without Blender, a take is drawn by one of the person's own Pavé windows, the
 * same way the Render tab previews a shot, then uploaded and delivered with `renders.complete`.
 * Every signed-in window watches for queued browser takes of its user (the person's, or their
 * assistant's); a Web Lock per take lets exactly one window draw it, and the server's first
 * delivery wins if two ever do. Takes are drawn one at a time, so a batch never opens a WebGL
 * context per take. A take nobody draws within ten minutes is failed by the server (a run
 * waiting on it would otherwise wait for ever).
 */
import { BROWSER_TAKE_SECONDS, renderEvaluation } from '@pave/render'
import type { RenderJob } from '@pave/schema'
import { useEffect } from 'react'
import { uploadAsset } from '../../lib/assets'
import { onReconnect, onServerEvent } from '../../lib/events'
import { evaluationScheduler } from '../../lib/kernel/client'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'

/** What the take says it was drawn with. */
export const BROWSER_DEVICE = 'Browser preview (WebGL)'

async function drawTake(job: RenderJob): Promise<void> {
  const started = performance.now()
  const fail = (error: string) => rpc.call('renders.complete', { id: job.id, error })
  if (job.scene.animation) {
    await fail('Animations need Blender. The Render tab plays the motion live, but cannot save it.')
    return
  }
  const piece = await rpc.call('pieces.get', { id: job.pieceId })
  if (piece.version !== job.sourceVersion) {
    await fail('The design changed before this preview was drawn. Render it again.')
    return
  }
  // Production detail, as Blender takes use, so a preview frames and fingerprints the same.
  const evaluation = await evaluationScheduler('production').request(`take:${job.id}`, piece.design)
  if (!evaluation) {
    await fail('The design changed while this preview was being drawn. Render it again.')
    return
  }
  // three.js loads only when a take is drawn, so the shell stays light.
  const { renderStill } = await import('./shot-renderer')
  const render = renderEvaluation(evaluation, piece.design, job.scene.includeUnassignedRhino)
  if (!render.parts.length && !render.stones.length) {
    await fail('Nothing to render. Review the design or preview its unassigned Rhino bodies.')
    return
  }
  const { blob, sceneHash } = await renderStill(render, job.scene, {
    pieceId: job.pieceId,
    version: job.sourceVersion,
  })
  const slug = job.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'take'
  const asset = await uploadAsset(new File([blob], `${slug}-preview.png`, { type: 'image/png' }))
  await rpc.call('renders.complete', {
    id: job.id,
    assetIds: [asset.id],
    seconds: Math.max(0.1, (performance.now() - started) / 1000),
    device: BROWSER_DEVICE,
    sceneHash,
  })
}

/** Runs `work` only if no other window holds the take's lock; without Web Locks, just runs it. */
async function exclusively(id: string, work: () => Promise<void>): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) return work()
  await locks.request(`pave-take-${id}`, { ifAvailable: true }, async (lock) => {
    if (lock) await work()
  })
}

/** Mounted once per window (in the shell). */
export function useBrowserTakes(): void {
  const { user } = useSession()
  useEffect(() => {
    let disposed = false
    let busy = false
    let again = false
    const tried = new Set<string>()

    const sweep = async () => {
      if (busy) {
        again = true
        return
      }
      busy = true
      try {
        do {
          again = false
          const queued = await rpc.call('renders.list', { status: ['queued'], limit: 20 })
          const mine = queued.filter(
            (j) => j.engine === 'browser' && j.createdBy === user.id && !tried.has(j.id),
          )
          for (const job of mine.toReversed()) {
            if (disposed) return
            tried.add(job.id)
            await exclusively(job.id, () =>
              drawTake(job).catch(async (e: unknown) => {
                const message = e instanceof Error ? e.message : String(e)
                await rpc
                  .call('renders.complete', {
                    id: job.id,
                    error: `This window could not draw the preview: ${message}`.slice(0, 1900),
                  })
                  .catch(() => {})
              }),
            )
          }
        } while (again && !disposed)
      } catch {
        // The list could not be read (offline, signed out): the next event tries again.
      } finally {
        busy = false
      }
    }

    void sweep()
    const offJob = onServerEvent('job.updated', (e) => {
      if (e.kind === 'render' && e.status === 'queued') void sweep()
    })
    const offReconnect = onReconnect(() => void sweep())
    return () => {
      disposed = true
      offJob()
      offReconnect()
    }
  }, [user.id])
}

/** A browser take's rough time, for estimates shown before the server answers. */
export const browserTakeSeconds = (count: number) => count * BROWSER_TAKE_SECONDS
