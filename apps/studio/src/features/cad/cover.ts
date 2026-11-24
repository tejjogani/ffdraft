/**
 * Automatic covers: when a designer leaves the Design tab after changing the piece, the
 * viewport photographs it for cards and the overview — only while the cover is automatic
 * (nobody picked one), never from a software renderer, and at most once per visit, so the
 * audit log and `updatedAt` are not churned by every edit.
 */
import type { Piece } from '@pave/schema'
import { captureViewport } from '../../components/stage/capture'
import type { Viewer } from '../../components/stage/viewer'
import { uploadAsset } from '../../lib/assets'
import { rpc } from '../../lib/rpc'

export function captureCover(
  viewer: Viewer,
  piece: Piece,
  changed: boolean,
  canEdit: boolean,
): void {
  if (!changed || !canEdit || !piece.coverAuto || viewer.tier === 'software') return
  captureViewport({ views: ['hero'], mode: 'rendered', size: 768 })
    .then(([blob]) => uploadAsset(new File([blob!], 'cover.png', { type: 'image/png' })))
    .then((asset) => rpc.call('pieces.update', { id: piece.id, coverAssetId: asset.id, coverAuto: true }))
    .catch(() => {
      // A missed cover is harmless; the next visit tries again.
    })
}
