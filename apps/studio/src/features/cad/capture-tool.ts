/**
 * The assistant's eyes: `viewport.capture` and `viewport.select`, served while this piece's
 * CAD tab is open. A capture waits until the window's edits are saved, the server's latest
 * version (the assistant's edit just before) has arrived, and the evaluation of exactly that
 * version is on screen, so the images, the summary and `version` agree.
 */
import { nodeTitle } from '@pave/schema'
import { useEffect } from 'react'
import { captureViewport } from '../../components/stage/capture'
import { uploadAsset } from '../../lib/assets'
import { registerClientTool } from '../../lib/client-tools'
import type { DesignSession } from '../../lib/design-session/store'
import { evaluationScheduler } from '../../lib/kernel/client'
import { summarize } from '../../lib/kernel/summary'
import { useWorkspace } from './state/workspace'

/** How long a capture waits for the server's latest version to reach this window. */
const CATCH_UP_MS = 8_000

/**
 * Resolves once the window shows `version` (the one the server just committed, usually by the
 * assistant's own edit, whose event may still be on its way). One resync if it lags, then fail.
 */
async function caughtUp(session: DesignSession, version: number | null): Promise<void> {
  if (version === null || session.get().version >= version) return
  const reached = () =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, CATCH_UP_MS / 2)
      const off = session.store.subscribe((s) => {
        if (s.version < version) return
        clearTimeout(timer)
        off()
        resolve(true)
      })
    })
  if (await reached()) return
  await session.resync()
  if (session.get().version >= version || (await reached())) return
  throw new Error(`This window has not caught up with design version ${version}`)
}

export function useViewportTools(pieceId: string, session: DesignSession | null): void {
  useEffect(() => {
    if (!session) return
    const offCapture = registerClientTool('viewport.capture', async (input, call) => {
      if (input.pieceId !== pieceId) throw new Error('That piece is not open in this window')
      await session.idle()
      await caughtUp(session, call.atVersion)
      const { view, version } = session.get()
      const evaluation = await evaluationScheduler('draft').request(`${pieceId}:capture`, view)
      if (!evaluation) throw new Error('The design changed during the capture; try again')
      // `annotate` names the focused features (or every feature) on the pictures.
      const labelled = input.focusNodeIds?.length ? input.focusNodeIds : view.order
      const labels = input.annotate
        ? Object.fromEntries(
            labelled.filter((id) => view.nodes[id]).map((id) => [id, nodeTitle(view.nodes[id]!)]),
          )
        : undefined
      const blobs = await captureViewport({
        evaluation,
        views: input.views,
        mode: input.mode,
        size: input.size,
        focusNodeIds: input.focusNodeIds,
        labels,
      })
      const assets = await Promise.all(
        blobs.map((b, i) =>
          uploadAsset(new File([b], `capture-v${version}-${i + 1}.png`, { type: 'image/png' })),
        ),
      )
      return {
        version,
        source: 'studio' as const,
        images: assets.map((a, i) => ({ view: input.views[i]!, assetId: a.id })),
        summary: summarize(evaluation),
      }
    })
    const offSelect = registerClientTool('viewport.select', async (input) => {
      if (input.pieceId !== pieceId) throw new Error('That piece is not open in this window')
      const nodes = session.get().view.nodes
      useWorkspace.getState().select(input.nodeIds.filter((id) => nodes[id]))
      return { ok: true as const }
    })
    return () => {
      offCapture()
      offSelect()
    }
  }, [pieceId, session])
}
