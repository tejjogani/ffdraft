/**
 * Exports, labelled by purpose. Uncounted formats run in the export worker (production detail:
 * seats cut, metal fused and watertight), so the viewport stays responsive; when that fails the
 * server's `design.export` is the fallback. Rhino and STEP count against the plan, so the server
 * always makes them and counts only what it delivered. A piece made from someone's artwork needs
 * a person's attestation first, as the server would require.
 */
import type { ExportFormat } from '@pave/kernel'
import { type Design, exportCounts, originNeedsAttestation, type Piece } from '@pave/schema'
import { toast } from '@pave/ui'
import { downloadAsset } from '../../lib/assets'
import { plural } from '../../lib/format'
import { exportDesign } from '../../lib/kernel/client'
import { invalidateFor, queryClient } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { safeFileName, saveFile } from '../../lib/save-file'
import { reportPlanLimit } from '../plans/plan-limit'

export const EXPORT_PURPOSE: Record<
  ExportFormat,
  { label: string; hint: string /** Made to be cast or printed: checks matter. */; makes?: true }
> = {
  stl: { label: 'For casting', hint: 'Watertight metal, per alloy', makes: true },
  step: { label: 'For another CAD', hint: 'Exact surfaces for Rhino, MatrixGold' },
  '3dm': { label: 'For Rhino', hint: 'Retains unchanged Rhino solids' },
  '3mf': { label: 'For 3D printing', hint: 'Mesh with units', makes: true },
  glb: { label: 'For the web and AR', hint: 'With stones and materials' },
  obj: { label: 'As a plain mesh', hint: 'For any 3D tool' },
}

export interface ExportContext {
  /** Problems the checks found, said once more when exporting something to be made. */
  problems: number
  review(): void
}

/** Formats in menu order, limited to what this kernel build writes. */
export const exportFormats = (available: readonly string[]): ExportFormat[] =>
  (Object.keys(EXPORT_PURPOSE) as ExportFormat[]).filter((f) => available.includes(f))

export async function runExport(
  piece: Piece,
  design: Design,
  format: ExportFormat,
  context: ExportContext,
): Promise<void> {
  if (originNeedsAttestation(piece.origin)) {
    toast({
      title: 'Confirm you may use the artwork first',
      description:
        'This piece was made from uploaded or referenced artwork. Confirm your rights on its Overview, then export.',
    })
    return
  }
  const name = piece.title || 'Untitled piece'
  const pending = toast({ title: `Preparing ${format.toUpperCase()}…`, timeout: 0 })
  try {
    let blob!: Blob
    let notes!: string[]
    let extension: string = format
    const fromServer = async () => {
      const { asset, notes: serverNotes } = await rpc.call('design.export', {
        pieceId: piece.id,
        format,
      })
      invalidateFor(queryClient, 'plan')
      // Checked: an error answer must never be saved as the exported file.
      blob = await downloadAsset(asset.id)
      notes = serverNotes
    }
    if (exportCounts(format)) {
      // Rhino and STEP count against the plan, so the server makes them: it counts only a file
      // it delivered, and a failed export is never counted.
      await fromServer()
    } else {
      try {
        const result = await exportDesign(design, format)
        blob = new Blob([result.bytes as BlobPart], { type: result.mime })
        notes = result.notes
        extension = result.extension.replace(/^\./, '')
      } catch (local) {
        // The in-browser exporter failed; the server's geometry engine may manage.
        await fromServer().catch(() => {
          throw local
        })
      }
    }
    toast.dismiss(pending)
    const purpose = EXPORT_PURPOSE[format]
    const saved = await saveFile(blob, safeFileName(name, extension), purpose.hint)
    if (!saved) return
    if (purpose.makes && context.problems > 0)
      toast({
        title: `Exported ${format.toUpperCase()}`,
        description: `${plural(context.problems, 'problem')} to fix before ${format === 'stl' ? 'casting' : 'printing'}.`,
        action: { label: 'Review', onClick: context.review },
      })
    else
      toast({
        title: `Exported ${format.toUpperCase()}`,
        // The first note is the one that matters (what the format can't carry); the rest is detail.
        description: notes[0],
        type: 'success',
      })
  } catch (e) {
    toast.dismiss(pending)
    if (reportPlanLimit(e)) return
    toast.error(
      `Couldn’t export ${format.toUpperCase()}`,
      e instanceof Error ? e.message : String(e),
    )
  }
}
