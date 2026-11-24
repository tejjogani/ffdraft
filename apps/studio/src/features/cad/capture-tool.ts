/**
 * The assistant's eyes: `viewport.capture` and `viewport.select`, served while this piece's
 * Design tab is open. A capture waits until the window's edits are saved and the evaluation of
 * exactly that version is on screen, so the images, the summary and `version` agree.
 */
import { useEffect } from 'react'
import { captureViewport } from '../../components/stage/capture'
import { uploadAsset } from '../../lib/assets'
import { registerClientTool } from '../../lib/client-tools'
import type { DesignSession } from '../../lib/design-session/store'
import { evaluationScheduler } from '../../lib/kernel/client'
import { summarize } from '../../lib/kernel/summary'
import { useWorkspace } from './state/workspace'

export function useViewportTools(pieceId: string, session: DesignSession | null): void {
  useEffect(() => {
    if (!session) return
    const offCapture = registerClientTool('viewport.capture', async (input) => {
      if (input.pieceId !== pieceId) throw new Error('That piece is not open in this window')
      await session.idle()
      const { view, version } = session.get()
      const evaluation = await evaluationScheduler('draft').request(`${pieceId}:capture`, view)
      if (!evaluation) throw new Error('The design changed during the capture; try again')
      const blobs = await captureViewport({
        evaluation,
        views: input.views,
        mode: input.mode,
        size: input.size,
        focusNodeIds: input.focusNodeIds,
      })
      const assets = await Promise.all(
        blobs.map((b, i) => uploadAsset(new File([b], `capture-v${version}-${i + 1}.png`, { type: 'image/png' }))),
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
