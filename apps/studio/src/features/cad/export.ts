/**
 * Exports, labelled by purpose. They run in the export worker (production detail: seats cut,
 * metal fused and watertight), so the viewport stays responsive; when that fails the server's
 * `design.export` is the fallback. A piece made from someone's artwork needs a person's
 * attestation first, as the server would require.
 */
import type { ExportFormat } from '@pave/kernel'
import { type Design, originNeedsAttestation, type Piece } from '@pave/schema'
import { toast } from '@pave/ui'
import { assetUrl } from '../../lib/assets'
import { exportKernel, resolveAsset } from '../../lib/kernel/client'
import { rpc } from '../../lib/rpc'
import { safeFileName, saveFile } from '../../lib/save-file'

export const EXPORT_PURPOSE: Record<ExportFormat, { label: string; hint: string }> = {
  stl: { label: 'For casting', hint: 'STL · watertight metal, per alloy' },
  step: { label: 'For another CAD', hint: 'STEP · exact surfaces for Rhino, MatrixGold' },
  '3dm': { label: 'For Rhino', hint: '3DM · layered meshes and curves' },
  '3mf': { label: 'For 3D printing', hint: '3MF · mesh with units' },
  glb: { label: 'For the web and AR', hint: 'GLB · with stones and materials' },
  obj: { label: 'As a plain mesh', hint: 'OBJ · for any 3D tool' },
}

/** Formats in menu order, limited to what this kernel build writes. */
export const exportFormats = (available: readonly string[]): ExportFormat[] =>
  (Object.keys(EXPORT_PURPOSE) as ExportFormat[]).filter((f) => available.includes(f))

export async function runExport(piece: Piece, design: Design, format: ExportFormat): Promise<void> {
  if (originNeedsAttestation(piece.origin)) {
    toast({
      title: 'Confirm you may use the artwork first',
      description: 'This piece was made from uploaded or referenced artwork. Confirm your rights on its Overview, then export.',
    })
    return
  }
  const name = piece.title || 'Untitled piece'
  const pending = toast({ title: `Preparing ${format.toUpperCase()}…`, timeout: 0 })
  try {
    let blob: Blob
    let notes: string[]
    let extension: string = format
    try {
      const result = await exportKernel().export(design, format, { assets: resolveAsset })
      blob = new Blob([result.bytes as BlobPart], { type: result.mime })
      notes = result.notes
      extension = result.extension.replace(/^\./, '')
    } catch (local) {
      // The in-browser exporter failed; the server may have a geometry engine that can.
      const { asset, notes: serverNotes } = await rpc
        .call('design.export', { pieceId: piece.id, format })
        .catch(() => {
          throw local
        })
      blob = await (await fetch(assetUrl(asset.id))).blob()
      notes = serverNotes
    }
    toast.dismiss(pending)
    const saved = await saveFile(blob, safeFileName(name, extension), EXPORT_PURPOSE[format].hint)
    if (saved)
      toast({
        title: `Exported ${format.toUpperCase()}`,
        description: notes.length ? notes.join(' ') : undefined,
        type: 'success',
      })
  } catch (e) {
    toast.dismiss(pending)
    toast.error(`Couldn’t export ${format.toUpperCase()}`, e instanceof Error ? e.message : String(e))
  }
}
