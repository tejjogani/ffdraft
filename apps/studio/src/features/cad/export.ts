/**
 * Exports, labelled by purpose. They run in the export worker (production detail: seats cut,
 * metal fused and watertight), so the viewport stays responsive; when that fails the server's
 * `design.export` is the fallback. A piece made from someone's artwork needs a person's
 * attestation first, as the server would require. Rhino and STEP are claimed from the plan's
 * allowance on the server first; the other formats are never counted.
 */
import type { ExportFormat } from '@pave/kernel'
import { type Design, exportCounts, originNeedsAttestation, type Piece } from '@pave/schema'
import { toast } from '@pave/ui'
import { assetUrl } from '../../lib/assets'
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
  '3dm': { label: 'For Rhino', hint: 'Layered meshes and curves' },
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

/**
 * One key per export attempt, so a retried claim is counted once. Not `crypto.randomUUID`: that
 * needs a secure context, and the studio may be opened over plain http on a LAN address.
 */
const attemptKey = () =>
  `x${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')}`

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
  // Rhino and STEP count against the plan: the server hands out one before the browser exports.
  // It is settled below: used once the file is saved, given back if the export fails or the save
  // is canceled. (When the server exports instead, it settles the claim itself.)
  let claimId: string | null = null
  let settledByServer = false
  const settle = (delivered: boolean) => {
    if (!claimId || settledByServer) return
    const id = claimId
    claimId = null
    void rpc
      .call('plan.settle', { claimId: id, delivered })
      .catch(() => {})
      .finally(() => invalidateFor(queryClient, 'plan'))
  }
  try {
    if (exportCounts(format))
      claimId = (await rpc.call('plan.claim', { pieceId: piece.id, format, key: attemptKey() }))
        .claimId
    let blob: Blob
    let notes: string[]
    let extension: string = format
    try {
      const result = await exportDesign(design, format)
      blob = new Blob([result.bytes as BlobPart], { type: result.mime })
      notes = result.notes
      extension = result.extension.replace(/^\./, '')
    } catch (local) {
      // The in-browser exporter failed; the server may have a geometry engine that can.
      const { asset, notes: serverNotes } = await rpc
        .call('design.export', {
          pieceId: piece.id,
          format,
          ...(claimId ? { claimId } : {}),
        })
        .catch(() => {
          throw local
        })
      settledByServer = true
      blob = await (await fetch(assetUrl(asset.id))).blob()
      notes = serverNotes
    }
    toast.dismiss(pending)
    const purpose = EXPORT_PURPOSE[format]
    const saved = await saveFile(blob, safeFileName(name, extension), purpose.hint)
    settle(saved)
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
    settle(false)
    if (reportPlanLimit(e)) return
    toast.error(
      `Couldn’t export ${format.toUpperCase()}`,
      e instanceof Error ? e.message : String(e),
    )
  }
}
