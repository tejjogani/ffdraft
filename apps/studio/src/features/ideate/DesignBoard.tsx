/**
 * A design board: the image-based space to design, think and collect ideas before CAD. A calm
 * pin board of pictures, sketches, scanned sketch sheets, notes, links (Pinterest, Google, a
 * shop: kept view-only, their image captured only when someone asks) and 3D models kept as
 * inspiration, in two views of the same items: Masonry and Canvas.
 *
 * Everything here is a registered command on the server; the board keeps only its view and the
 * selected tile. From a picture or sketch, "Take to CAD" starts the CAD job from it; a 3D model
 * opens as CAD. The same component is a piece's Design stage and a board in Ideas.
 */
import type { Board, Reference } from '@pave/schema'
import {
  Button,
  cn,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Segmented,
  Sheet,
  Textarea,
  Tooltip,
  toast,
} from '@pave/ui'
import {
  Box,
  Camera,
  FileImage,
  Grid2x2,
  Hammer,
  Link2,
  MoreHorizontal,
  NotebookPen,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { assetUrl } from '../../lib/assets'
import { useRpcMutation } from '../../lib/query'
import { providerLabel, ProvenanceButton, RightsChip } from '../references/Provenance'
import { SketchPad } from '../references/SketchPad'
import {
  addFiles,
  addLinks,
  addNote,
  addSketch,
  captureLink,
  removeReference,
  useOpenAsCad,
  useTakeToCad,
} from './actions'
import { BOARD_ACCEPT, canvasLayout, movedTo, takeToCadRefusal, urlsIn } from './board'
import { ModelViewer } from './ModelViewer'
import { SearchSheet } from './SearchSheet'

type View = 'masonry' | 'canvas'

const VIEW_KEY = 'pave:board-view'
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'canvas' ? 'canvas' : 'masonry'
  } catch {
    return 'masonry'
  }
}

export function DesignBoard({
  board,
  references,
  readOnly = false,
}: {
  board: Board
  references: Reference[]
  readOnly?: boolean
}) {
  const [view, setView] = useState<View>(readView)
  const [selected, setSelected] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [sketching, setSketching] = useState(false)
  const [noting, setNoting] = useState(false)
  const [linking, setLinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const takeToCad = useTakeToCad()
  const openAsCad = useOpenAsCad()
  const chosen = references.find((r) => r.id === selected) ?? null

  const changeView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // The view is a convenience; without storage it resets next time.
    }
  }

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(`Couldn’t ${what}`, e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  // Pasting a picture or a link anywhere on the page adds it, unless the person is typing.
  // `run` only sets this component's busy flag; the listener is renewed when the board changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (readOnly) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      const pasted = [...(e.clipboardData?.files ?? [])]
      const urls = urlsIn(e.clipboardData?.getData('text') ?? '')
      if (!pasted.length && !urls.length) return
      e.preventDefault()
      void run('add that', async () => {
        if (pasted.length) await addFiles(board.id, pasted)
        else await addLinks(board.id, urls)
      })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [board.id, readOnly])

  const onDrop = (e: DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    setOver(false)
    const dropped = [...e.dataTransfer.files]
    const urls = urlsIn(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'))
    void run('add that', async () => {
      if (dropped.length) await addFiles(board.id, dropped)
      else if (urls.length) await addLinks(board.id, urls)
    })
  }

  return (
    <section
      aria-label="Design board"
      data-design-board={board.id}
      className={cn(
        'relative flex flex-col gap-4',
        over && 'rounded-lg ring-2 ring-select ring-offset-4 ring-offset-bg',
      )}
      onDragOver={(e) => {
        if (readOnly) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div role="toolbar" aria-label="Board tools" className="flex flex-wrap items-center gap-1.5">
        {!readOnly && (
          <>
            <Button size="sm" variant="secondary" icon={Search} onClick={() => setSearching(true)}>
              Search references
            </Button>
            <Menu
              trigger={
                <Button size="sm" variant="ghost" icon={Plus} disabled={busy}>
                  {busy ? 'Adding…' : 'Add'}
                </Button>
              }
            >
              <MenuItem
                icon={FileImage}
                description="Photos, screenshots, scanned sketch sheets"
                onClick={() => files.current?.click()}
              >
                Upload pictures
              </MenuItem>
              <MenuItem
                icon={Box}
                description="STL, OBJ, GLB, 3MF or PLY"
                onClick={() => files.current?.click()}
              >
                Add a 3D model
              </MenuItem>
              <MenuItem icon={PenLine} onClick={() => setSketching(true)}>
                Sketch
              </MenuItem>
              <MenuItem
                icon={Link2}
                description="Pinterest, Google, a shop: kept view-only"
                onClick={() => setLinking(true)}
              >
                Paste a link
              </MenuItem>
              <MenuItem icon={NotebookPen} onClick={() => setNoting(true)}>
                Write a note
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={Search}
                disabled
                description="Needs a search API key and the provider’s terms; paste links meanwhile"
              >
                Google and Pinterest search
              </MenuItem>
              <MenuItem
                icon={Sparkles}
                disabled
                description="Four concepts from your references need an image model"
              >
                Generate concepts
              </MenuItem>
            </Menu>
          </>
        )}
        <Segmented<View>
          size="sm"
          aria-label="Board view"
          className="ml-auto"
          value={view}
          onChange={changeView}
          options={[
            { value: 'masonry', label: 'Masonry' },
            { value: 'canvas', label: 'Canvas' },
          ]}
        />
        <input
          ref={files}
          type="file"
          multiple
          accept={BOARD_ACCEPT}
          className="hidden"
          aria-label="Pictures or 3D models to add"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])]
            e.target.value = ''
            void run('add those files', () => addFiles(board.id, picked))
          }}
        />
      </div>

      {references.length === 0 ? (
        <EmptyBoard
          onUpload={() => files.current?.click()}
          onSearch={() => setSearching(true)}
          onSketch={() => setSketching(true)}
          readOnly={readOnly}
        />
      ) : view === 'masonry' ? (
        <ul aria-label="Board items" className="columns-2 gap-3 sm:columns-3 xl:columns-4">
          {references.map((r) => (
            <li key={r.id} className="mb-3 break-inside-avoid">
              <Tile
                reference={r}
                selected={r.id === selected}
                onSelect={() => setSelected(r.id === selected ? null : r.id)}
                onTakeToCad={() => void takeToCad(board, r)}
                onOpenAsCad={() => void openAsCad(board, r)}
                readOnly={readOnly}
              />
            </li>
          ))}
        </ul>
      ) : (
        <CanvasView
          board={board}
          references={references}
          selected={selected}
          onSelect={setSelected}
          onTakeToCad={(r) => void takeToCad(board, r)}
          onOpenAsCad={(r) => void openAsCad(board, r)}
          readOnly={readOnly}
        />
      )}

      {chosen && !readOnly && (
        <SelectionBar
          reference={chosen}
          onTakeToCad={() => void takeToCad(board, chosen)}
          onOpenAsCad={() => void openAsCad(board, chosen)}
          onClose={() => setSelected(null)}
        />
      )}

      <SearchSheet open={searching} onOpenChange={setSearching} boardId={board.id} />
      <Sheet open={sketching} onOpenChange={setSketching} title="Sketch an idea">
        <SketchPad
          piece={{ id: board.pieceId ?? board.id }}
          board={{
            key: `board:${board.id}`,
            titles: references.map((r) => r.title),
            save: async (file, title) => {
              await addSketch(board.id, file, title)
              setSketching(false)
            },
          }}
        />
      </Sheet>
      <TextDialog
        open={noting}
        onOpenChange={setNoting}
        title="Write a note"
        placeholder="Trophy on a pendant, about 25 mm tall, an iced base…"
        submit="Add the note"
        onSubmit={(text) => run('add the note', () => addNote(board.id, text))}
      />
      <TextDialog
        open={linking}
        onOpenChange={setLinking}
        title="Paste a link"
        placeholder="https://www.pinterest.com/pin/…"
        submit="Add the link"
        hint="Links from Pinterest, Google or a shop are kept as view-only inspiration: shown here, never sent to AI. Capture the image to see it on the board."
        onSubmit={(text) => {
          const urls = urlsIn(text)
          if (!urls.length) {
            toast.error('That is not a web address', 'Paste a link that starts with https://')
            return
          }
          return run('add the link', () => addLinks(board.id, urls))
        }}
      />
    </section>
  )
}

function EmptyBoard({
  onUpload,
  onSearch,
  onSketch,
  readOnly,
}: {
  onUpload: () => void
  onSearch: () => void
  onSketch: () => void
  readOnly: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg px-6 py-14 text-center shadow-[inset_0_0_0_1px_var(--line)]">
      <Grid2x2 className="size-6 text-fg-faint" aria-hidden />
      <p className="font-serif text-heading">Start the board</p>
      <p className="max-w-md text-sm text-fg-subtle">
        Drop or paste pictures (a trophy you want on a pendant, a pendant you like, a sketch sheet),
        links from Pinterest or Google, or a 3D model. Then pick one and take it to CAD.
      </p>
      {!readOnly && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="primary" icon={FileImage} onClick={onUpload}>
            Upload pictures
          </Button>
          <Button size="sm" variant="secondary" icon={Search} onClick={onSearch}>
            Search museums
          </Button>
          <Button size="sm" variant="ghost" icon={PenLine} onClick={onSketch}>
            Sketch
          </Button>
        </div>
      )}
    </div>
  )
}

/** One item on the board: its picture, model, link or note, with its credit and rights. */
function Tile({
  reference: r,
  selected,
  onSelect,
  onTakeToCad,
  onOpenAsCad,
  readOnly,
  fill,
}: {
  reference: Reference
  selected: boolean
  onSelect: () => void
  onTakeToCad: () => void
  onOpenAsCad: () => void
  readOnly: boolean
  /** On the canvas the tile fills its placement; in masonry it keeps its picture's shape. */
  fill?: boolean
}) {
  const refusal = takeToCadRefusal(r)
  const [capturing, setCapturing] = useState(false)
  const facts = {
    title: r.title,
    provider: r.source?.provider ?? null,
    url: r.source?.url ?? null,
    credit: r.source?.credit ?? null,
    license: r.source?.license ?? null,
    licenseUrl: r.source?.licenseUrl ?? null,
    capturedAt: r.source?.capturedAt ?? null,
    rights: r.rights,
  }
  return (
    <article
      aria-label={`${kindWord(r)}: ${r.title || 'Untitled'}`}
      data-board-item={r.type}
      data-selected={selected || undefined}
      className={cn(
        'group reveal relative overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]',
        selected && 'shadow-[0_0_0_2px_var(--select)]',
        fill && 'h-full',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Select ${r.title || kindWord(r).toLowerCase()}`}
        onClick={onSelect}
        className="block w-full text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--select)]"
      >
        <Media reference={r} />
      </button>
      <div className="flex items-start gap-1 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {r.title || (r.type === 'note' ? 'Note' : 'Untitled')}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-3xs text-fg-subtle">
            {r.source && <span className="truncate">{providerLabel(r.source.provider)}</span>}
            <RightsChip rights={r.rights} />
          </p>
        </div>
        {r.source && <ProvenanceButton facts={facts} />}
        {!readOnly && (
          <Menu
            align="end"
            trigger={
              <IconButton
                icon={MoreHorizontal}
                label={`Actions for ${r.title || 'this item'}`}
                size="sm"
                className="size-6"
              />
            }
          >
            {r.type === 'model' ? (
              <MenuItem icon={Box} onClick={onOpenAsCad}>
                Open as CAD
              </MenuItem>
            ) : (
              <MenuItem
                icon={Hammer}
                disabled={!!refusal}
                {...(refusal ? { description: refusal } : {})}
                onClick={onTakeToCad}
              >
                Take to CAD
              </MenuItem>
            )}
            {r.type === 'link' && !r.assetId && (
              <MenuItem
                icon={Camera}
                disabled={capturing}
                description="Fetch the page’s image to show it; it stays view-only"
                onClick={() => {
                  setCapturing(true)
                  captureLink(r)
                    .catch((e: Error) => toast.error('Couldn’t capture the image', e.message))
                    .finally(() => setCapturing(false))
                }}
              >
                Capture image
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onClick={() => void removeReference(r)}>
              Remove from the board
            </MenuItem>
          </Menu>
        )}
      </div>
    </article>
  )
}

const kindWord = (r: Reference) =>
  r.type === 'model'
    ? '3D model'
    : r.type === 'note'
      ? 'Note'
      : r.type === 'link'
        ? 'Link'
        : r.type === 'generated'
          ? 'Generated image'
          : r.type === 'swatch'
            ? 'Colour'
            : 'Picture'

function Media({ reference: r }: { reference: Reference }) {
  if (r.type === 'model' && r.assetId)
    return <ModelViewer assetId={r.assetId} name={r.title || 'model.stl'} />
  if (r.type === 'note')
    return (
      <p className="min-h-20 whitespace-pre-wrap bg-[color-mix(in_oklab,var(--warn)_8%,var(--bg))] px-3 py-3 font-serif text-sm leading-6">
        {r.note}
      </p>
    )
  if (r.type === 'swatch')
    return <div className="h-24" style={{ background: r.palette[0] ?? 'transparent' }} />
  const src = r.assetId ? assetUrl(r.assetId, 480) : r.thumbUrl
  if (!src)
    return (
      <div className="flex min-h-24 flex-col justify-center gap-1 bg-bg-muted px-3 py-4 text-xs text-fg-subtle">
        <Link2 className="size-4" aria-hidden />
        <span className="break-all">{r.source?.url ?? 'A link'}</span>
      </div>
    )
  return (
    <img
      src={src}
      alt={r.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="block h-auto w-full bg-bg-muted"
      style={r.width && r.height ? { aspectRatio: `${r.width} / ${r.height}` } : undefined}
    />
  )
}

/** The canvas: the same items placed freely; a drag moves one and is saved when let go. */
function CanvasView({
  board,
  references,
  selected,
  onSelect,
  onTakeToCad,
  onOpenAsCad,
  readOnly,
}: {
  board: Board
  references: Reference[]
  selected: string | null
  onSelect: (id: string | null) => void
  onTakeToCad: (r: Reference) => void
  onOpenAsCad: (r: Reference) => void
  readOnly: boolean
}) {
  const arrange = useRpcMutation('references.arrange')
  const layout = canvasLayout(references)
  const [moving, setMoving] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const start = useRef<{ id: string; x: number; y: number } | null>(null)
  const topZ = Math.max(0, ...[...layout.values()].map((p) => p.z))
  const width = Math.max(...[...layout.values()].map((p) => p.x + p.w), 600)
  const height = Math.max(...[...layout.values()].map((p) => p.y + p.w * 1.4), 400)

  const down = (id: string) => (e: ReactPointerEvent) => {
    if (readOnly || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { id, x: e.clientX, y: e.clientY }
  }
  const move = (e: ReactPointerEvent) => {
    const s = start.current
    if (s) setMoving({ id: s.id, dx: e.clientX - s.x, dy: e.clientY - s.y })
  }
  const up = () => {
    const s = start.current
    start.current = null
    if (!s || !moving || (Math.abs(moving.dx) < 3 && Math.abs(moving.dy) < 3)) {
      setMoving(null)
      return
    }
    const placed = movedTo(layout.get(s.id)!, moving.dx, moving.dy, topZ)
    setMoving(null)
    arrange.mutate({ boardId: board.id, items: [{ id: s.id, canvas: placed }] })
  }

  return (
    <section
      className="stage-soft relative h-[70vh] overflow-auto rounded-lg shadow-[inset_0_0_0_1px_var(--line)]"
      aria-label="Board canvas"
    >
      <ul
        aria-label="Board items"
        className="relative"
        style={{ width: width + 48, height: height + 48 }}
      >
        {references.map((r) => {
          const p = layout.get(r.id)!
          const shift = moving?.id === r.id ? moving : null
          return (
            <li
              key={r.id}
              onPointerDown={down(r.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className={cn(
                'absolute touch-none',
                !readOnly && 'cursor-grab active:cursor-grabbing',
              )}
              style={{
                left: 24 + p.x + (shift?.dx ?? 0),
                top: 24 + p.y + (shift?.dy ?? 0),
                width: p.w,
                zIndex: shift ? topZ + 1 : p.z,
              }}
            >
              <Tile
                reference={r}
                selected={r.id === selected}
                onSelect={() => onSelect(r.id === selected ? null : r.id)}
                onTakeToCad={() => onTakeToCad(r)}
                onOpenAsCad={() => onOpenAsCad(r)}
                readOnly={readOnly}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The frosted bar a selected item raises: its way to CAD. */
function SelectionBar({
  reference: r,
  onTakeToCad,
  onOpenAsCad,
  onClose,
}: {
  reference: Reference
  onTakeToCad: () => void
  onOpenAsCad: () => void
  onClose: () => void
}) {
  const refusal = takeToCadRefusal(r)
  const [going, setGoing] = useState(false)
  const go = (fn: () => void) => {
    setGoing(true)
    fn()
  }
  return (
    <section
      aria-label="Selected item"
      className="glass-pane sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full px-3 py-2 shadow-lg"
    >
      <span className="max-w-56 truncate px-1 text-sm">{r.title || kindWord(r)}</span>
      {r.type === 'model' ? (
        <Button
          size="sm"
          variant="primary"
          icon={Box}
          disabled={going}
          onClick={() => go(onOpenAsCad)}
        >
          Open as CAD
        </Button>
      ) : refusal ? (
        <Tooltip content={refusal}>
          <span>
            <Button size="sm" variant="primary" icon={Hammer} disabled>
              Take to CAD
            </Button>
          </span>
        </Tooltip>
      ) : (
        <Button
          size="sm"
          variant="primary"
          icon={Hammer}
          disabled={going}
          onClick={() => go(onTakeToCad)}
        >
          {going ? 'Starting…' : 'Take to CAD'}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClose}>
        Done
      </Button>
    </section>
  )
}

function TextDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  submit,
  hint,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder: string
  submit: string
  hint?: string
  onSubmit: (text: string) => Promise<unknown> | undefined
}) {
  const [text, setText] = useState('')
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="flex flex-col gap-3 px-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          const value = text.trim()
          if (!value) return
          void Promise.resolve(onSubmit(value)).then(() => {
            setText('')
            onOpenChange(false)
          })
        }}
      >
        <Textarea
          minRows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={title}
          autoFocus
        />
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          {submit}
        </Button>
      </form>
    </Sheet>
  )
}
