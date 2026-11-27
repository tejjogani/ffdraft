import { type CommandInput, type CommandOutput, newId } from '@pave/schema'
import { Button, Dialog, NumberField } from '@pave/ui'
import { ArrowUpFromLine } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { hasGap } from '../../../lib/design-session/core'
import {
  type DesignSession,
  type SessionStore,
  useSessionState,
} from '../../../lib/design-session/store'
import { num } from '../../../lib/format'
import { RpcError, rpc } from '../../../lib/rpc'

type PartRef = { pieceId: string; nodeId: string; nativeAssetId: string }
type FaceRead = CommandOutput<'design.rhinoCapFaces'>
type Face = FaceRead['faces'][number]
type Move = CommandInput<'design.offsetRhinoCap'> & { changeId: string }

const staleMessage =
  'The design changed. Close this editor and reopen it to review the latest faces.'
const busy = (s: SessionStore) => s.save.status !== 'saved' || hasGap(s)
const mm = (n: number) => `${num(n, 4)} mm`

function direction(normal: Face['normal']) {
  const axis = normal.findIndex((value) => Math.abs(value) > 1 - 1e-8)
  if (axis === -1) return null
  const positive = normal[axis]! > 0
  const coordinate = ['X', 'Y', 'Z'][axis]!
  const names = positive ? ['Right', 'Back', 'Top'] : ['Left', 'Front', 'Bottom']
  return `${names[axis]} (${positive ? '+' : '−'}${coordinate})`
}

function faceLabel(face: Face) {
  return direction(face.normal) ?? `Face ${face.faceIndex + 1}`
}

function vector(values: Face['center']) {
  return values.map((value, axis) => `${'XYZ'[axis]} ${num(value, 4)}`).join(' · ')
}

function changed(s: SessionStore, target: PartRef, read: FaceRead) {
  const node = s.confirmed.nodes[target.nodeId]
  return (
    s.pieceId !== target.pieceId ||
    read.pieceId !== target.pieceId ||
    read.nodeId !== target.nodeId ||
    s.version !== read.version ||
    node?.kind !== 'meshBody' ||
    node.source.type !== 'asset' ||
    node.source.nativeAssetId !== target.nativeAssetId ||
    read.nativeAssetId !== target.nativeAssetId
  )
}

export function RhinoEndFaceTool(props: PartRef & { session: DesignSession }) {
  const { session } = props
  const waiting = useSessionState(session, busy)
  const [target, setTarget] = useState<PartRef | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        icon={ArrowUpFromLine}
        aria-haspopup="dialog"
        aria-expanded={target !== null}
        disabled={waiting}
        title={waiting ? 'Wait for the design to finish saving.' : undefined}
        onClick={() => {
          if (!target && !busy(session.get())) {
            const { pieceId, nodeId, nativeAssetId } = props
            setTarget({ pieceId, nodeId, nativeAssetId })
          }
        }}
      >
        Move end face
      </Button>
      {target && (
        <EndFaceDialog
          target={target}
          session={session}
          onClose={() => setTarget(null)}
          finalFocus={trigger}
        />
      )}
    </>
  )
}

function EndFaceDialog({
  target,
  session,
  onClose,
  finalFocus,
}: {
  target: PartRef
  session: DesignSession
  onClose(): void
  finalFocus: React.RefObject<HTMLButtonElement | null>
}) {
  const [result, setResult] = useState<{ faces: FaceRead } | { error: string } | null>(null)
  const [faceIndex, setFaceIndex] = useState<number>()
  const [offset, setOffset] = useState<number | null>(0)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState<Move>()
  const active = useRef(false)
  const radioName = useId()
  const read = result && 'faces' in result ? result.faces : null
  const changedSinceRead = useSessionState(
    session,
    (s) => read !== null && changed(s, target, read),
  )
  const stale = conflict || changedSinceRead
  const waiting = useSessionState(session, busy)

  useEffect(() => {
    let disposed = false
    void rpc.call('design.rhinoCapFaces', { pieceId: target.pieceId, nodeId: target.nodeId }).then(
      (reply) => {
        if (disposed) return
        setResult({ faces: reply })
        // For a world-aligned pair, start with the face on the positive side of the axis.
        setFaceIndex(
          (reply.faces.find((face) => direction(face.normal)?.includes('+')) ?? reply.faces[0])
            ?.faceIndex,
        )
        if (reply.version > session.get().version) void session.resync()
      },
      (reason: unknown) => {
        if (!disposed)
          setResult({
            error: reason instanceof Error ? reason.message : 'Could not read the Rhino faces.',
          })
      },
    )
    return () => {
      disposed = true
    }
  }, [target, session])

  const face = read?.faces.find((item) => item.faceIndex === faceIndex)
  const opposite = read?.faces.find((item) => item.faceIndex === face?.oppositeFaceIndex)
  const nextSpan = face && offset !== null && Number.isFinite(offset) ? face.spanMm + offset : null
  const invalid = nextSpan !== null && (nextSpan <= 0 || !Number.isFinite(nextSpan))
  const ready = !!(read?.nativeAssetId && face && opposite && offset && nextSpan && !invalid)
  const disabled = saving || !!retry || !!stale
  const notice =
    error ||
    (!saving && !retry && stale ? staleMessage : null) ||
    (invalid ? 'Enter an offset that leaves a positive thickness.' : null)

  async function move() {
    if (active.current) return
    const state = session.get()
    if (!retry) {
      if (conflict || !read || changed(state, target, read)) {
        setConflict(true)
        return
      }
      if (busy(state)) return
    }
    const payload =
      retry ??
      (ready && read && face && offset !== null
        ? {
            pieceId: target.pieceId,
            nodeId: target.nodeId,
            nativeAssetId: target.nativeAssetId,
            baseVersion: read.version,
            faceIndex: face.faceIndex,
            offsetMm: offset,
            changeId: newId('chg'),
          }
        : null)
    if (!payload) return
    active.current = true
    setSaving(true)
    setError(undefined)
    try {
      const answer = await rpc.call('design.offsetRhinoCap', payload)
      if (
        answer?.change?.id !== payload.changeId ||
        answer.change.pieceId !== payload.pieceId ||
        answer.change.actor.type !== 'user'
      ) {
        throw new RpcError('invalid_response', 'The save could not be confirmed.', 0)
      }
      session.adoptChange(payload.changeId, answer.change)
      onClose()
    } catch (reason) {
      const status = reason instanceof RpcError ? reason.status : 0
      if (status === 0 || status === 408 || status === 429 || status >= 500) {
        setRetry(payload)
        setError('The save could not be confirmed. Retry to check the same move.')
        void session.resync()
      } else {
        setRetry(undefined)
        if (status === 409) {
          setConflict(true)
          void session.resync()
        } else setError(reason instanceof Error ? reason.message : 'Could not move this face.')
      }
    } finally {
      active.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      placement="end"
      title="Move end face"
      description="Move a planar end face on this Rhino solid. The opposite end stays fixed."
      onOpenChange={(open) => {
        if (!open && !active.current) onClose()
      }}
      finalFocus={finalFocus}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            {retry ? 'Close' : 'Cancel'}
          </Button>
          {!!read?.faces.length && (
            <Button
              variant="primary"
              disabled={saving || (!retry && (!ready || waiting || stale))}
              onClick={() => void move()}
            >
              {saving ? 'Moving face…' : retry ? 'Retry save' : 'Move face'}
            </Button>
          )}
        </>
      }
    >
      {!result && (
        <p role="status" className="text-sm text-fg-muted">
          Reading the Rhino solid…
        </p>
      )}
      {result && 'error' in result && (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      )}
      {read && !read.faces.length && (
        <p role="status" className="text-sm text-fg-muted">
          {read.reason ?? 'This part has no supported pair of planar end faces.'}
        </p>
      )}
      {read && face && opposite && (
        <div className="space-y-4 text-sm">
          <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
            <legend className="mb-2 flex w-full items-center justify-between gap-2 font-medium">
              Face to move
              <span className="text-xs font-normal text-fg-muted">Center in project mm</span>
            </legend>
            {read.faces.map((item) => (
              <label
                key={item.faceIndex}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-line-strong px-2.5 py-2 has-checked:border-select has-checked:bg-select-soft has-focus-visible:outline-2 has-focus-visible:outline-select has-disabled:cursor-default"
              >
                <input
                  type="radio"
                  className="mt-1 accent-select"
                  name={radioName}
                  checked={item.faceIndex === faceIndex}
                  onChange={() => {
                    setFaceIndex(item.faceIndex)
                    setError(undefined)
                  }}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{faceLabel(item)}</span>
                  <span className="mt-0.5 block font-mono text-2xs text-fg-muted tabular">
                    {vector(item.center)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-lg border border-line px-3 py-2.5">
            <dt className="text-fg-muted">Fixed face</dt>
            <dd className="text-right">{faceLabel(opposite)}</dd>
            {!direction(face.normal) && (
              <>
                <dt className="text-fg-muted">Outward direction</dt>
                <dd className="text-right font-mono text-xs tabular">{vector(face.normal)}</dd>
              </>
            )}
            <dt className="text-fg-muted">Through-holes</dt>
            <dd className="text-right tabular">{face.innerLoops}</dd>
            <dt className="text-fg-muted">Thickness</dt>
            <dd className="text-right font-mono text-xs tabular">
              {mm(face.spanMm)} → {nextSpan !== null && !invalid ? mm(nextSpan) : '—'}
            </dd>
          </dl>
          <div className="grid grid-cols-[1fr_8rem] items-center gap-x-3 gap-y-1.5">
            <NumberField
              aria-label="Offset (mm)"
              rowLabel="Offset"
              value={offset}
              onChange={(value) => {
                setOffset(value)
                setError(undefined)
              }}
              unit="mm"
              inputMode="text"
              step={0.05}
              precision={3}
              disabled={disabled}
            />
            <p className="col-span-2 text-xs text-fg-muted">
              Positive adds thickness. Negative removes it. Offsets use project millimetres.
            </p>
          </div>
        </div>
      )}
      {waiting && !saving && !stale && !retry && (
        <p role="status" className="mt-3 text-xs text-fg-muted">
          Waiting for the design to finish saving…
        </p>
      )}
      {notice && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {notice}
        </p>
      )}
    </Dialog>
  )
}
