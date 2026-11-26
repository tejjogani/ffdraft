import { METALS, type MetalId, type Piece, type Reference } from '@pave/schema'
import { Button, controlClass, Dialog, Field, InlineError } from '@pave/ui'
import { useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { useRpc, useRpcMutation } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'

/** The chosen Design image belongs to the project, so it is available from a fresh CAD visit. */
export function TraceSelectedDesign({ piece }: { piece: Piece }) {
  const session = useSession()
  const role = activeOrg(session)?.role
  const [open, setOpen] = useState(false)
  const selected = piece.intake?.selection
  const board = useRpc(
    'boards.get',
    { id: selected?.boardId ?? '' },
    {
      enabled: !!selected?.visualId && role !== 'viewer' && role !== 'guest',
    },
  )
  const reference =
    board.data?.board.pieceId === piece.id
      ? board.data.references.find(
          (r) => r.id === selected?.visualId && !!r.assetId && r.rights !== 'viewOnly',
        )
      : undefined
  if (!reference || role === 'viewer' || role === 'guest') return null
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Trace selected design
      </Button>
      {open && <TraceOutline piece={piece} reference={reference} onClose={() => setOpen(false)} />}
    </>
  )
}

/** A flat outline is an editable solid. Its scale comes from the designer or the project spec. */
export function TraceOutline({
  piece,
  reference,
  onClose,
}: {
  piece: Piece
  reference: Reference
  onClose(): void
}) {
  const trace = useRpc('match.traceOutline', { pieceId: piece.id, referenceId: reference.id })
  const save = useRpcMutation('design.apply')
  const confirmed = piece.intake?.details
  const [height, setHeight] = useState(
    String(piece.spec?.body?.heightMm ?? confirmed?.heightMm ?? (confirmed ? '' : 22)),
  )
  const [thickness, setThickness] = useState(
    String(piece.spec?.body?.thicknessMm ?? confirmed?.thicknessMm ?? (confirmed ? '' : 2)),
  )
  const [material, setMaterial] = useState<MetalId | ''>(
    piece.spec?.metal.alloy ?? confirmed?.metal ?? (confirmed ? '' : 'au18k-yellow'),
  )
  const [changeId] = useState(() => crypto.randomUUID())
  const preview = trace.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Trace a flat outline"
      description="Check the silhouette, then set the size of the metal body."
    >
      {trace.isPending ? (
        <p>Tracing the picture…</p>
      ) : trace.isError ? (
        <InlineError message={trace.error.message} onRetry={() => void trace.refetch()} />
      ) : (
        preview && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!material || !height || !thickness) return
              save.mutate(
                {
                  pieceId: piece.id,
                  baseVersion: preview.version,
                  changeId,
                  label: `Trace ${reference.title || 'artwork'}`.slice(0, 200),
                  ops: [
                    {
                      t: 'add',
                      node: {
                        id: `outline_${changeId}`,
                        kind: 'vectorBody',
                        name: (reference.title || 'Traced outline').slice(0, 80),
                        source: { type: 'svg', d: preview.path },
                        height: Number(height),
                        thickness: Number(thickness),
                        bevel: 'flat',
                        material,
                        finish: piece.spec?.metal.finish,
                        plating: piece.spec?.metal.plating,
                      },
                    },
                  ],
                },
                { onSuccess: onClose },
              )
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <figure>
                <img
                  src={assetUrl(reference.assetId!, 320)}
                  alt=""
                  className="aspect-square w-full rounded-md bg-white object-contain"
                />
                <figcaption>Reference</figcaption>
              </figure>
              <figure>
                <svg
                  role="img"
                  aria-label="Traced outline"
                  viewBox={`0 0 ${preview.width} ${preview.height}`}
                  className="aspect-square w-full rounded-md bg-bg-muted p-1"
                >
                  <path d={preview.path} fill="currentColor" fillRule="evenodd" />
                </svg>
                <figcaption>Metal outline</figcaption>
              </figure>
            </div>
            {preview.islands > 1 && (
              <p>
                {preview.islands} separate shapes. Add connecting metal in CAD if they should cast
                as one piece.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Height (mm)">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    type="number"
                    min="3"
                    max="150"
                    step="any"
                    required
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Thickness (mm)">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    type="number"
                    min="0.6"
                    max="20"
                    step="any"
                    required
                    value={thickness}
                    onChange={(e) => setThickness(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Metal">
              {(id) => (
                <select
                  id={id}
                  className={controlClass}
                  value={material}
                  required
                  onChange={(e) => setMaterial(e.target.value as MetalId | '')}
                >
                  <option value="">
                    {confirmed?.metalDescription
                      ? `Choose an alloy for ${confirmed.metalDescription}`
                      : 'Choose an alloy'}
                  </option>
                  {Object.entries(METALS).map(([id, m]) => (
                    <option key={id} value={id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {save.isError && (
              <InlineError message={save.error.message} onRetry={() => void trace.refetch()} />
            )}
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Add outline to CAD
            </Button>
          </form>
        )
      )}
    </Dialog>
  )
}
