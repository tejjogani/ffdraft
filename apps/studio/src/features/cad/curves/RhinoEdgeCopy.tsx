import { type CommandOutput, type NodeOf, newId } from '@pave/schema'
import { Button, Dialog } from '@pave/ui'
import { Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesignSession } from '../../../lib/design-session/store'
import { rpc } from '../../../lib/rpc'
import { useWorkspace } from '../state/workspace'

type ReadEdges = CommandOutput<'design.rhinoEdges'>
type Edge = ReadEdges['edges'][number]
type View = 'Isometric' | 'Top' | 'Front' | 'Right'
const VIEWS: View[] = ['Isometric', 'Top', 'Front', 'Right']
const PAGE = 100
const WINDOW = 4 * PAGE

function project([x, y, z]: readonly number[], view: View): [number, number] {
  if (view === 'Top') return [x!, -y!]
  if (view === 'Front') return [x!, -z!]
  if (view === 'Right') return [y!, -z!]
  return [(x! - y!) * Math.SQRT1_2, (x! + y!) / Math.sqrt(6) - z! * Math.sqrt(2 / 3)]
}

function EdgeDrawing({
  edges,
  selected,
  view,
  choose,
}: {
  edges: Edge[]
  selected: number
  view: View
  choose: (id: number) => void
}) {
  const paths = useMemo(() => {
    const rows = edges.map(({ edgeIndex, preview }) => ({
      edgeIndex,
      points: preview.map((p) => project(p, view)),
    }))
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const { points } of rows)
      for (const [x, y] of points) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    const scale = Math.min(336 / Math.max(maxX - minX, 1e-6), 206 / Math.max(maxY - minY, 1e-6))
    return rows.map(({ edgeIndex, points }) => ({
      edgeIndex,
      d: points
        .map(
          ([x, y], i) =>
            `${i ? 'L' : 'M'}${(185 + (x - (minX + maxX) / 2) * scale).toFixed(2)} ${(120 + (y - (minY + maxY) / 2) * scale).toFixed(2)}`,
        )
        .join(' '),
    }))
  }, [edges, view])
  return (
    // biome-ignore lint/a11y/useSemanticElements: the selectable paths share an SVG coordinate system.
    <svg
      viewBox="0 0 370 240"
      role="group"
      aria-label="Rhino edges"
      className="w-full rounded-md border border-line bg-panel"
    >
      {paths.map((p) => (
        <path
          key={p.edgeIndex}
          d={p.d}
          fill="none"
          className="stroke-fg-subtle"
          strokeWidth={1.25}
        />
      ))}
      {paths
        .filter((p) => p.edgeIndex === selected)
        .map((p) => (
          <path key={p.edgeIndex} d={p.d} fill="none" className="stroke-select" strokeWidth={3} />
        ))}
      {paths.map((p) => (
        // biome-ignore lint/a11y/useSemanticElements: SVG strokes support picking the actual projected edge.
        <path
          key={p.edgeIndex}
          data-edge-index={p.edgeIndex}
          role="button"
          tabIndex={p.edgeIndex === selected ? 0 : -1}
          aria-label={`Edge ${p.edgeIndex + 1}`}
          aria-pressed={p.edgeIndex === selected}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              choose(p.edgeIndex)
            }
          }}
          d={p.d}
          fill="none"
          stroke="transparent"
          strokeWidth={9}
          className="cursor-pointer"
          onClick={() => choose(p.edgeIndex)}
        >
          <title>Edge {p.edgeIndex + 1}</title>
        </path>
      ))}
    </svg>
  )
}

interface Props {
  node: NodeOf<'meshBody'>
  pieceId: string
  session: DesignSession
}
export function RhinoEdgeCopy(props: Props) {
  const [opened, setOpened] = useState(false)
  return (
    <>
      <Button size="sm" icon={Copy} onClick={() => setOpened(true)}>
        Copy edge as curve
      </Button>
      {opened && <EdgeEditor {...props} close={() => setOpened(false)} />}
    </>
  )
}

function EdgeEditor({ node, pieceId, session, close }: Props & { close: () => void }) {
  const [read, setRead] = useState<ReadEdges | null>(null)
  const [start, setStart] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [edge, setEdge] = useState('1')
  const [view, setView] = useState<View>('Isometric')
  const [error, setError] = useState('')
  const [copying, setCopying] = useState(false)
  const version = useRef<number | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let current = true
    const fetchPage = (offset: number) =>
      rpc.call('design.rhinoEdges', { pieceId, nodeId: node.id, offset, limit: PAGE })
    setLoading(true)
    setError('')
    void (async () => {
      const first = await fetchPage(start)
      if (!current) return
      if (version.current !== null && first.version !== version.current) {
        setStale(true)
        throw Error('This project changed. Reopen the edge picker.')
      }
      version.current = first.version
      const offsets: number[] = []
      for (let at = start + PAGE; at < Math.min(first.edgeCount, start + WINDOW); at += PAGE)
        offsets.push(at)
      const rest = await Promise.all(offsets.map(fetchPage))
      if (!current) return
      if (
        rest.some((p) => p.version !== first.version || p.nativeAssetId !== first.nativeAssetId)
      ) {
        setStale(true)
        throw Error('This part changed. Reopen the edge picker.')
      }
      setRead({ ...first, edges: [...first.edges, ...rest.flatMap((p) => p.edges)] })
    })()
      .catch((err: unknown) => {
        if (current)
          setError(err instanceof Error ? err.message : 'Could not read the Rhino edges.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [pieceId, node.id, start])
  const chosen = Number(edge) - 1
  const selection = read?.edges.find((e) => e.edgeIndex === chosen)
  function changeEdge(value: string) {
    setEdge(value)
    const idx = Number(value) - 1
    if (read && Number.isInteger(idx) && idx >= 0 && idx < read.edgeCount)
      setStart(Math.floor(idx / WINDOW) * WINDOW)
  }
  async function copy() {
    if (!read || !selection || loading || stale || copying) return
    setCopying(true)
    setError('')
    try {
      const exact = await rpc.call('design.rhinoEdges', {
        pieceId,
        nodeId: node.id,
        edgeIndex: chosen,
      })
      if (!mounted.current) return
      const state = session.get()
      if (
        state.pieceId !== pieceId ||
        state.version !== read.version ||
        state.pending.length ||
        state.gesture ||
        exact.version !== read.version ||
        exact.nativeAssetId !== read.nativeAssetId
      ) {
        setStale(true)
        throw Error('This project changed. Reopen the edge picker.')
      }
      if (!exact.curve) throw Error(exact.reason ?? 'This edge could not be read as a curve.')
      const id = newId('nurbsCurve')
      const name = `${(node.name ?? 'Part').slice(0, 60)} · edge ${chosen + 1}`
      session.commit(
        [
          {
            t: 'add',
            node: {
              id,
              kind: 'nurbsCurve',
              name,
              degree: exact.curve.degree,
              knots: exact.curve.knots,
              controlPoints: exact.curve.controlPoints,
              ...(node.source.type === 'asset' &&
                node.source.rhinoLayer && { rhinoLayer: node.source.rhinoLayer }),
            },
          },
        ],
        { baseVersion: read.version, label: `Copied edge ${chosen + 1} as a curve` },
      )
      useWorkspace.getState().select([id])
      close()
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not copy the edge.')
    } finally {
      if (mounted.current) setCopying(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
      title="Copy edge as curve"
      description="Pick an edge to create an independent curve in this project."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selection || loading || stale || copying}
            onClick={() => void copy()}
          >
            Copy curve
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {loading && !error && (
          <p role="status" className="text-sm text-fg-muted">
            Reading Rhino edges…
          </p>
        )}
        {read && !read.edges.length && (
          <p className="text-sm text-fg-muted">
            {read.reason ?? 'This part has no readable native edges.'}
          </p>
        )}
        {read && read.edges.length > 0 && (
          <>
            <div className="flex flex-wrap gap-1">
              {VIEWS.map((v) => (
                <Button
                  key={v}
                  size="sm"
                  aria-pressed={v === view}
                  variant={v === view ? 'secondary' : 'ghost'}
                  onClick={() => setView(v)}
                >
                  {v}
                </Button>
              ))}
            </div>
            <EdgeDrawing
              edges={loading ? [] : read.edges}
              selected={chosen}
              view={view}
              choose={(i) => changeEdge(String(i + 1))}
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              Edge number
              <input
                aria-label="Edge number"
                inputMode="numeric"
                type="number"
                min={1}
                max={read.edgeCount}
                value={edge}
                onChange={(e) => changeEdge(e.target.value)}
                className="w-20 rounded-md border border-line bg-panel px-2 py-1 text-right tabular-nums"
              />
            </label>
            <p className="text-xs text-fg-muted">
              {read.edgeCount > WINDOW
                ? `Showing edges ${start + 1}–${Math.min(start + WINDOW, read.edgeCount)} of ${read.edgeCount}. Enter an edge number to switch ranges.`
                : `${read.edgeCount} edges`}
              {selection?.closed ? ' · Closed edge' : ''}
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
