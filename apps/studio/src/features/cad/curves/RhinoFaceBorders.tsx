import { type CommandOutput, type NodeOf, newId } from '@pave/schema'
import { Button, Dialog, Select } from '@pave/ui'
import { Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hasGap } from '../../../lib/design-session/core'
import {
  type DesignSession,
  type SessionStore,
  useSessionState,
} from '../../../lib/design-session/store'
import { num } from '../../../lib/format'
import { rpc } from '../../../lib/rpc'
import { useWorkspace } from '../state/workspace'

type Read = CommandOutput<'design.rhinoFaceBorders'>
type Face = Read['faces'][number]
type Target = {
  pieceId: string
  nodeId: string
  nativeAssetId: string
  name: string
  layer?: string
}
type Page = { offset: number; read: Read }
const PAGE_SIZE = 20
const VIEWS = ['Isometric', 'Top', 'Front', 'Right'] as const
type View = (typeof VIEWS)[number]
const staleMessage = 'The design changed. Close and reopen the face border picker.'

const busy = (state: SessionStore) =>
  state.save.status !== 'saved' || hasGap(state) || !!state.gesture

function matches(state: SessionStore, target: Target, read: Read) {
  const node = state.confirmed.nodes[target.nodeId]
  return (
    state.pieceId === target.pieceId &&
    read.pieceId === target.pieceId &&
    read.nodeId === target.nodeId &&
    state.version === read.version &&
    node?.kind === 'meshBody' &&
    node.source.type === 'asset' &&
    node.source.nativeAssetId === target.nativeAssetId &&
    (read.nativeAssetId === target.nativeAssetId || !!(read.reason && read.faceCount === 0))
  )
}

function project([x, y, z]: readonly number[], view: View) {
  if (view === 'Top') return [x!, -y!] as const
  if (view === 'Front') return [x!, -z!] as const
  if (view === 'Right') return [y!, -z!] as const
  return [(x! - y!) * Math.SQRT1_2, (x! + y!) / Math.sqrt(6) - z! * Math.sqrt(2 / 3)] as const
}

function FacePreview({ face, view }: { face: Face; view: View }) {
  const loops = face.loops.map(({ kind, preview }) => ({
    kind,
    points: preview.map((point) => project(point, view)),
  }))
  const points = loops.flatMap(({ points: projected }) => projected)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y
  const padding = Math.max(width, height, 0.001) * 0.12
  const outer = face.loops.find(({ kind }) => kind === 'outer')!
  const centre = [0, 1, 2].map((axis) => {
    const coordinates = outer.preview.map((point) => point[axis]!)
    return (Math.min(...coordinates) + Math.max(...coordinates)) / 2
  })
  return (
    <>
      <svg
        role="img"
        aria-label={`Face ${face.faceIndex + 1} border preview`}
        viewBox={`${x - padding} ${y - padding} ${width + 2 * padding} ${height + 2 * padding}`}
        className="aspect-[8/5] w-full rounded-md border border-line bg-bg"
      >
        {loops.map(({ kind, points: path }, i) => (
          <path
            key={`${kind}-${i}`}
            data-loop-kind={kind}
            d={`${path.map(([h, v], at) => `${at ? 'L' : 'M'}${h} ${v}`).join(' ')} Z`}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className={kind === 'outer' ? 'stroke-select' : 'stroke-fg-muted'}
            strokeDasharray={kind === 'inner' ? '4 2' : undefined}
            strokeWidth={2}
          />
        ))}
      </svg>
      <p className="text-xs text-fg-muted">
        Preview centre {centre.map((value, i) => `${'XYZ'[i]} ${num(value, 3)}`).join(' · ')} mm
      </p>
    </>
  )
}

function label(face: Face) {
  const holes = face.loops.filter(({ kind }) => kind === 'inner').length
  return `Face ${face.faceIndex + 1}${holes ? ` · ${holes} ${holes === 1 ? 'hole' : 'holes'}` : ''}`
}

export function RhinoFaceBorders({
  node,
  pieceId,
  nativeAssetId,
  session,
}: {
  node: NodeOf<'meshBody'>
  pieceId: string
  nativeAssetId: string
  session: DesignSession
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const waiting = useSessionState(session, busy)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        icon={Copy}
        aria-haspopup="dialog"
        aria-expanded={!!target}
        disabled={waiting}
        title={waiting ? 'Wait for the design to finish saving.' : undefined}
        onClick={() =>
          setTarget({
            pieceId,
            nodeId: node.id,
            nativeAssetId,
            name: (node.name || 'Part').slice(0, 48).replace(/[\uD800-\uDBFF]$/, ''),
            layer: node.source.type === 'asset' ? node.source.rhinoLayer : undefined,
          })
        }
      >
        Copy face borders
      </Button>
      {target && (
        <FaceBorderDialog
          target={target}
          session={session}
          close={() => setTarget(null)}
          finalFocus={trigger}
        />
      )}
    </>
  )
}

function FaceBorderDialog({
  target,
  session,
  close,
  finalFocus,
}: {
  target: Target
  session: DesignSession
  close(): void
  finalFocus: React.RefObject<HTMLButtonElement | null>
}) {
  const [page, setPage] = useState<Page | null>(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<View>('Isometric')
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const anchor = useRef<Pick<Read, 'version' | 'nativeAssetId'> | null>(null)
  const active = useRef(false)
  const waiting = useSessionState(session, busy)
  const changed = useSessionState(
    session,
    (state) => page !== null && !matches(state, target, page.read),
  )
  const stale = conflict || changed
  const current = page?.offset === offset ? page.read : null
  const chosen = selected
    ? current?.faces.find((face) => String(face.faceIndex) === selected)
    : undefined
  const faceCount = page?.read.faceCount ?? 0

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    const { pieceId, nodeId } = target
    void rpc
      .call('design.rhinoFaceBorders', { pieceId, nodeId, offset, limit: PAGE_SIZE })
      .then((read) => {
        if (!live) return
        const previous = anchor.current
        if (
          previous &&
          (read.version !== previous.version || read.nativeAssetId !== previous.nativeAssetId)
        ) {
          setConflict(true)
          return
        }
        anchor.current ??= { version: read.version, nativeAssetId: read.nativeAssetId }
        setPage({ offset, read })
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not read the face borders.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [target, offset])

  function movePage(next: number) {
    setSelected(null)
    setOffset(next)
  }

  async function copy() {
    if (!current || !chosen || loading || stale || copying || busy(session.get())) return
    setCopying(true)
    setError('')
    try {
      const { pieceId, nodeId } = target
      const exact = await rpc.call('design.rhinoFaceBorders', {
        pieceId,
        nodeId,
        faceIndex: chosen.faceIndex,
      })
      if (!active.current) return
      const state = session.get()
      if (!matches(state, target, current) || !matches(state, target, exact)) {
        setConflict(true)
        return
      }
      if (busy(state))
        throw Error('Wait for the design to finish saving, then copy the borders again.')
      const curves = exact.curves
      if (
        !curves?.length ||
        curves.length !== chosen.loops.length ||
        exact.faces[0]?.faceIndex !== chosen.faceIndex ||
        curves.some(({ kind }, i) => kind !== chosen.loops[i]?.kind)
      ) {
        throw Error(exact.reason ?? 'Pavé could not read the complete boundary of this face.')
      }

      let hole = 0
      const nodes = curves.map(({ kind, degree, knots, controlPoints }) => ({
        id: newId('nurbsCurve'),
        kind: 'nurbsCurve' as const,
        name: `${target.name} · face ${chosen.faceIndex + 1} ${kind === 'outer' ? 'outer border' : `hole ${++hole}`}`,
        degree,
        knots,
        controlPoints,
        ...(target.layer && { rhinoLayer: target.layer }),
      }))
      session.commit(
        nodes.map((node) => ({ t: 'add', node })),
        {
          baseVersion: current.version,
          label: `Copied face ${chosen.faceIndex + 1} borders`,
        },
      )
      useWorkspace.getState().select(nodes.map(({ id }) => id))
      close()
    } catch (err) {
      if (active.current)
        setError(err instanceof Error ? err.message : 'Could not copy the face borders.')
    } finally {
      if (active.current) setCopying(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      finalFocus={finalFocus}
      className="[--glass-strong:var(--bg-subtle)]"
      title="Copy face borders"
      description="Create independent curves from a face’s outer border and hole outlines."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!chosen || stale || loading || copying || waiting}
            onClick={() => void copy()}
          >
            {copying ? 'Copying…' : 'Copy borders'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {(stale || error) && (
          <p role="alert" className="text-sm text-danger">
            {stale ? staleMessage : error}
          </p>
        )}
        {(loading || waiting) && !stale && (
          <p role="status" className="text-sm text-fg-muted">
            {loading ? 'Reading Rhino faces…' : 'Waiting for the design to finish saving…'}
          </p>
        )}
        {current && current.faces.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Rhino face</span>
            <Select
              aria-label="Rhino face"
              value={selected}
              onChange={setSelected}
              disabled={stale || loading || copying}
              placeholder="Choose a face"
              options={current.faces.map((face) => ({
                value: String(face.faceIndex),
                label: label(face),
              }))}
              className="w-full"
            />
          </div>
        )}
        {current && current.faces.length === 0 && !stale && (
          <p className="text-sm text-fg-muted">
            {faceCount > PAGE_SIZE
              ? 'No eligible faces in this range. Browse another range to check more faces.'
              : (current.reason ?? 'This part has no eligible face borders.')}
          </p>
        )}
        {faceCount > PAGE_SIZE && (
          <nav aria-label="Face pages" className="space-y-1.5">
            <p className="text-xs text-fg-muted">
              Faces {offset + 1}–{Math.min(offset + PAGE_SIZE, faceCount)} of {faceCount}
              {current && ` · ${current.faces.length} eligible`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={offset === 0 || loading || stale || copying}
                onClick={() => movePage(offset - PAGE_SIZE)}
              >
                Previous faces
              </Button>
              <Button
                size="sm"
                disabled={offset + PAGE_SIZE >= faceCount || loading || stale || copying}
                onClick={() => movePage(offset + PAGE_SIZE)}
              >
                Next faces
              </Button>
            </div>
          </nav>
        )}
        {chosen && !stale && (
          <div className="space-y-2">
            <fieldset className="flex flex-wrap gap-1">
              <legend className="sr-only">Preview view</legend>
              {VIEWS.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={name === view ? 'secondary' : 'ghost'}
                  aria-pressed={name === view}
                  onClick={() => setView(name)}
                >
                  {name}
                </Button>
              ))}
            </fieldset>
            <FacePreview face={chosen} view={view} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
