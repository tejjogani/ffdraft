/**
 * Where a docked dialog (Replace stone…) sits on the Design tab: over the inspector column
 * when it is shown, since the dialog stands in for it while open; else over the right of the
 * 3D view, between its toolbars and its facts strip, and the view frames the piece in what is
 * left. In px from the window's edges, for `position: fixed`.
 */

import { HUD_BAND_PX } from '../../../components/stage/viewer'
import type { DockArea } from '../../assistant/quick-intent-store'

interface Rect {
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** The dialog's widest, and its margin from the edges of what it docks over. */
const DOCK_WIDTH_PX = 360
const INSET_PX = 8
const VIEW_EDGE_PX = 12

export function dockArea(
  regions: { inspector: Rect | null; viewport: Rect },
  windowWidth: number,
): Omit<DockArea, 'pieceId'> {
  const { inspector, viewport } = regions
  if (inspector)
    return {
      top: inspector.top + INSET_PX,
      right: windowWidth - inspector.right + INSET_PX,
      width: inspector.width - 2 * INSET_PX,
      height: inspector.height - 2 * INSET_PX,
      viewInset: 0,
    }
  const width = Math.min(DOCK_WIDTH_PX, viewport.width - 2 * VIEW_EDGE_PX)
  // A short window keeps the dialog usable before it keeps the toolbars uncovered.
  const band = viewport.height - 2 * HUD_BAND_PX >= 360 ? HUD_BAND_PX : VIEW_EDGE_PX
  return {
    top: viewport.top + band,
    right: windowWidth - viewport.right + VIEW_EDGE_PX,
    width,
    height: viewport.height - 2 * band,
    viewInset: width + 2 * VIEW_EDGE_PX,
  }
}
