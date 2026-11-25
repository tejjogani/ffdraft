/**
 * The reference window's sketch pad: a pen, an eraser, Undo and Clear on a square white sheet.
 * A sketch is saved as the person's own picture pinned to the piece (so the assistant may read
 * it like any pinned picture), and can be laid in the front, top or right view as an image
 * plane to model over, the same way as any pinned picture. Needs no AI.
 *
 * The drawing is data (sketch.ts); this component turns pointers into strokes and draws them.
 */
import type { ImagePlaneView, Piece } from '@pave/schema'
import { Button, cn, IconButton, Menu, MenuItem, Segmented, Spinner, toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { Eraser, Images, Pencil, Save, Trash2, Undo2 } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { uploadAsset } from '../../lib/assets'
import { VIEW_LABEL } from '../../lib/image-planes'
import { useRpc } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { pin, refreshPins } from './actions'
import {
  addStroke,
  clearSketch,
  drawSketch,
  ERASER_SIZE,
  INK,
  isBlank,
  PAPER,
  PEN_SIZES,
  SKETCH_PX,
  type SketchEntry,
  type Stroke,
  toSheet,
  undoSketch,
} from './sketch'
import { useReferencePanel } from './store'

const VIEWS: ImagePlaneView[] = ['front', 'top', 'right']
const NO_SKETCH: SketchEntry[] = []

type Tool = 'pen' | 'eraser'
type PenSize = keyof typeof PEN_SIZES

/** The next free "Sketch n" title among the piece's pins. */
function nextTitle(titles: readonly string[]): string {
  const used = titles
    .map((t) => /^Sketch (\d+)$/.exec(t)?.[1])
    .filter(Boolean)
    .map(Number)
  return `Sketch ${used.length ? Math.max(...used) + 1 : 1}`
}

/**
 * Where a sketch is saved. Beside CAD it is pinned to the piece; on a design board it is saved
 * to that board (`board`), with no image-plane menu: the board is not a CAD view.
 */
export interface SketchTarget {
  /** Keys the unsaved strokes (per board), apart from each piece's pad beside CAD. */
  key: string
  /** Titles already used, for the next "Sketch n". */
  titles: readonly string[]
  save: (file: File, title: string) => Promise<void>
}

export function SketchPad({ piece, board }: { piece: Pick<Piece, 'id'>; board?: SketchTarget }) {
  const key = board?.key ?? piece.id
  const entries = useReferencePanel((s) => s.sketches[key] ?? NO_SKETCH)
  const setSketch = useReferencePanel((s) => s.setSketch)
  const pins = useRpc('references.pins', { pieceId: piece.id }, { enabled: !board })
  const auth = useSession()
  const role = activeOrg(auth)?.role ?? 'viewer'
  const readOnly = role === 'viewer' || role === 'guest'
  const navigate = useNavigate()
  const [tool, setTool] = useState<Tool>('pen')
  const [size, setSize] = useState<PenSize>('medium')
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<Stroke | null>(null)

  // The sheet is redrawn from the data whenever it changes (undo, clear, another tab's return).
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawSketch(ctx, entries)
  }, [entries])

  const set = (next: SketchEntry[]) => setSketch(key, next)
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return toSheet(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (readOnly || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    stroke.current = {
      tool,
      size: tool === 'pen' ? PEN_SIZES[size] : ERASER_SIZE,
      points: [point(e)],
    }
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = stroke.current
    const ctx = canvas.current?.getContext('2d')
    if (!s || !ctx) return
    const prev = s.points.at(-1)!
    const next = point(e)
    s.points.push(next)
    // Only the new segment is drawn while the pointer moves; the data redraws on release.
    ctx.strokeStyle = s.tool === 'pen' ? INK : PAPER
    ctx.lineWidth = s.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(prev[0], prev[1])
    ctx.lineTo(next[0], next[1])
    ctx.stroke()
  }
  const up = () => {
    const s = stroke.current
    stroke.current = null
    if (s) set(addStroke(entries, s))
  }
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      set(undoSketch(entries))
    }
  }

  const save = async (view: ImagePlaneView | null) => {
    const el = canvas.current
    if (!el || isBlank(entries)) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((ok) => el.toBlob(ok, 'image/png'))
      if (!blob) throw new Error('The sketch could not be turned into a picture')
      const title = nextTitle(board?.titles ?? (pins.data?.references ?? []).map((r) => r.title))
      const file = new File([blob], `${title.toLowerCase().replace(' ', '-')}.png`, {
        type: 'image/png',
      })
      if (board) {
        await board.save(file, title)
        set(clearSketch(entries))
        toast.success(`${title} saved to the design board`)
        return
      }
      const asset = await uploadAsset(file)
      // The person's own drawing: rights "own", so it may be laid in a view and read by AI.
      const out = await pin(piece.id, [
        { assetId: asset.id, title, rights: 'own', note: 'Sketched in Pavé' },
      ])
      const ref = out?.[0]
      if (!ref) return
      await refreshPins(piece.id)
      if (view) {
        const s = useReferencePanel.getState()
        s.setPlaceRequest({ pieceId: piece.id, refId: ref.id, view })
        if (s.viewport !== piece.id)
          void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
        toast.success(`${title} saved and laid in the ${VIEW_LABEL[view].toLowerCase()} view`)
      } else
        toast({
          title: `${title} saved as a reference`,
          description: 'It is pinned to this piece.',
          action: {
            label: 'Lay in front view',
            onClick: () => {
              const s = useReferencePanel.getState()
              s.setPlaceRequest({ pieceId: piece.id, refId: ref.id, view: 'front' })
              if (s.viewport !== piece.id)
                void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
            },
          },
        })
    } catch (e) {
      toast.error('Couldn’t save the sketch', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const blank = isBlank(entries)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-3 pb-3">
      <div role="toolbar" aria-label="Sketch tools" className="flex flex-wrap items-center gap-1">
        <IconButton
          icon={Pencil}
          label="Pen"
          active={tool === 'pen'}
          onClick={() => setTool('pen')}
        />
        <IconButton
          icon={Eraser}
          label="Eraser"
          active={tool === 'eraser'}
          onClick={() => setTool('eraser')}
        />
        <Segmented<PenSize>
          size="sm"
          aria-label="Pen size"
          value={size}
          onChange={(v) => {
            setSize(v)
            setTool('pen')
          }}
          options={[
            { value: 'fine', label: 'Fine' },
            { value: 'medium', label: 'Medium' },
            { value: 'bold', label: 'Bold' },
          ]}
        />
        <span className="ml-auto flex items-center">
          <IconButton
            icon={Undo2}
            label="Undo stroke"
            shortcut="mod+z"
            disabled={!entries.length}
            onClick={() => set(undoSketch(entries))}
          />
          <IconButton
            icon={Trash2}
            label="Clear the sheet"
            disabled={!entries.length || blank}
            onClick={() => set(clearSketch(entries))}
          />
        </span>
      </div>
      <canvas
        ref={canvas}
        width={SKETCH_PX}
        height={SKETCH_PX}
        // Focusable so mod+z undoes a stroke.
        tabIndex={0}
        role="img"
        aria-label={blank ? 'Sketch pad, empty' : 'Sketch pad'}
        data-sketch-pad
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={onKey}
        className={cn(
          'aspect-square w-full touch-none rounded-lg bg-white shadow-[0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[0_0_0_2px_var(--select)]',
          readOnly ? 'cursor-not-allowed' : tool === 'pen' ? 'cursor-crosshair' : 'cursor-cell',
        )}
      />
      {/* Wraps in a narrow panel rather than running off its edge. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={blank || saving || readOnly}
          onClick={() => void save(null)}
        >
          {saving ? <Spinner className="size-3.5" label="Saving" /> : <Save className="size-3.5" />}
          {board ? 'Save to the board' : 'Save as reference'}
        </Button>
        {!board && (
          <Menu
            align="end"
            trigger={
              <Button size="sm" variant="ghost" disabled={blank || saving || readOnly}>
                <Images className="size-3.5" /> Save and lay in a view
              </Button>
            }
          >
            {VIEWS.map((v) => (
              <MenuItem key={v} icon={Images} onClick={() => void save(v)}>
                {VIEW_LABEL[v]} view
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
      <p className="text-xs leading-5 text-fg-subtle">
        {board
          ? 'A saved sketch goes on the design board as your own picture: take it to CAD like any picture.'
          : 'A saved sketch is pinned to this piece as your own picture. Lay it in the front, top or right view to model over it, and scale it by two points like any picture.'}
      </p>
    </div>
  )
}
