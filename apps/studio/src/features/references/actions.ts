/**
 * What the panel and the viewport do with pins and image planes. Every plane change goes through
 * {@link changePlane}: it shows at once (the cached pins are patched), is saved with
 * `references.place`, and is recorded for undo; if saving fails the cache is put back.
 */
import type { CommandInput, CommandOutput, ImagePlane, Reference } from '@pave/schema'
import { toast } from '@pave/ui'
import { changeLabel, redoStep, undoStep } from '../../lib/plane-history'
import { invalidateFor, queryClient, rpcKey } from '../../lib/query'
import { RpcError, rpc } from '../../lib/rpc'
import { historyOf, useReferencePanel } from './store'

type Pins = CommandOutput<'references.pins'>

const pinsKey = (pieceId: string) => rpcKey('references.pins', { pieceId })

export const cachedPins = (pieceId: string): Pins | undefined =>
  queryClient.getQueryData<Pins>(pinsKey(pieceId))

function patchPlane(pieceId: string, refId: string, plane: ImagePlane | null): void {
  queryClient.setQueryData<Pins>(pinsKey(pieceId), (old) =>
    old
      ? { ...old, references: old.references.map((r) => (r.id === refId ? { ...r, plane } : r)) }
      : old,
  )
}

/** Saves one plane change; `record: false` for undo and redo, which move along the history. */
export async function changePlane(
  pieceId: string,
  refId: string,
  plane: ImagePlane | null,
  opts: { record?: boolean; label?: string } = {},
): Promise<boolean> {
  const before = cachedPins(pieceId)?.references.find((r) => r.id === refId)?.plane ?? null
  patchPlane(pieceId, refId, plane)
  try {
    await rpc.call('references.place', { id: refId, plane })
  } catch (e) {
    patchPlane(pieceId, refId, before)
    if (e instanceof RpcError && e.status === 404) {
      useReferencePanel.getState().forgetRef(pieceId, refId)
      toast.error('That picture is no longer pinned')
    } else toast.error('Couldn’t save the picture’s place', (e as Error).message)
    return false
  }
  if (opts.record !== false)
    useReferencePanel.getState().recordChange(pieceId, {
      refId,
      before,
      after: plane,
      label: opts.label ?? changeLabel(before, plane),
    })
  return true
}

export async function undoPlane(pieceId: string): Promise<void> {
  const step = undoStep(historyOf(pieceId))
  if (!step) return
  useReferencePanel.getState().setHistory(pieceId, step.history)
  await changePlane(pieceId, step.refId, step.plane, { record: false })
}

export async function redoPlane(pieceId: string): Promise<void> {
  const step = redoStep(historyOf(pieceId))
  if (!step) return
  useReferencePanel.getState().setHistory(pieceId, step.history)
  await changePlane(pieceId, step.refId, step.plane, { record: false })
}

/** Takes a picture out of the view, with Undo in the toast. */
export async function removeFromView(pieceId: string, ref: Reference): Promise<void> {
  if (!ref.plane) return
  if (useReferencePanel.getState().selected?.refId === ref.id)
    useReferencePanel.getState().select(null)
  if (await changePlane(pieceId, ref.id, null))
    toast({
      title: 'Took the picture out of the view',
      action: { label: 'Undo', onClick: () => void undoPlane(pieceId) },
    })
}

type PinItems = CommandInput<'references.pin'>['items']

export async function pin(pieceId: string, items: PinItems): Promise<Reference[] | null> {
  try {
    const out = await rpc.call('references.pin', { pieceId, items })
    invalidateFor(queryClient, 'references')
    return out
  } catch (e) {
    toast.error('Couldn’t pin that', (e as Error).message)
    return null
  }
}

export async function unpin(pieceId: string, ref: Reference): Promise<void> {
  useReferencePanel.getState().forgetRef(pieceId, ref.id)
  queryClient.setQueryData<Pins>(pinsKey(pieceId), (old) =>
    old ? { ...old, references: old.references.filter((r) => r.id !== ref.id) } : old,
  )
  try {
    await rpc.call('references.remove', { ids: [ref.id] })
  } catch (e) {
    toast.error('Couldn’t unpin that', (e as Error).message)
  }
  invalidateFor(queryClient, 'references')
}

/** Moves a pin one place up or down (keyboard and buttons; dragging uses the same call). */
export async function movePin(pieceId: string, refId: string, to: number): Promise<void> {
  const pins = cachedPins(pieceId)
  if (!pins?.boardId) return
  const list = [...pins.references]
  const from = list.findIndex((r) => r.id === refId)
  if (from < 0 || to < 0 || to >= list.length || from === to) return
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved!)
  // Positions between neighbours keep every other row as it is.
  const prev = list[to - 1]?.position
  const next = list[to + 1]?.position
  const position =
    prev === undefined ? next! - 1 : next === undefined ? prev + 1 : (prev + next) / 2
  queryClient.setQueryData<Pins>(pinsKey(pieceId), {
    ...pins,
    references: list.map((r) => (r.id === refId ? { ...r, position } : r)),
  })
  try {
    await rpc.call('references.arrange', {
      boardId: pins.boardId,
      items: [{ id: refId, position }],
    })
  } catch (e) {
    toast.error('Couldn’t reorder the pins', (e as Error).message)
  }
  invalidateFor(queryClient, 'references')
}
