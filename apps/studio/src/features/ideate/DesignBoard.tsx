/**
 * A design board: the image-based space to design, think and collect ideas before CAD. A calm
 * pin board of pictures, sketches, scanned sketch sheets, notes, links (Pinterest, Google, a
 * shop: kept view-only, their image captured only when someone asks) and 3D models kept as
 * inspiration, in two views of the same items: Grid and Arrange by hand.
 *
 * Everything here is a registered command on the server; the board keeps only its view and the
 * selected tile. From a picture or sketch, "Take to CAD" starts the CAD job from it; a 3D model
 * opens as CAD. The same component is used in the project and the studio's Moodboards.
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
  Hammer,
  Link2,
  MoreHorizontal,
  NotebookPen,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
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
import { useSession } from '../../lib/session'
import { ProvenanceButton, providerLabel, RightsChip } from '../references/Provenance'
import { SketchPad } from '../references/SketchPad'
import { WebReferenceSearch } from '../references/WebReferenceSearch'
import {
  addFiles,
  addLinks,
  addNote,
  addSketch,
  type BoardTarget,
  captureLink,
  removeReference,
  useOpenAsCad,
  useTakeToCad,
} from './actions'
import {
  BOARD_ACCEPT,
  BOARD_IMAGE_ACCEPT,
  canvasLayout,
  movedTo,
  takeToCadRefusal,
  urlsIn,
} from './board'
import { GeneratePanel } from './GeneratePanel'
import { ModelViewer } from './ModelViewer'

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
  pieceId,
  references = [],
  readOnly = false,
  projectWorkspace = false,
}: ({ board: Board; pieceId?: never } | { board?: never; pieceId: string }) & {
  references?: Reference[]
  readOnly?: boolean
  projectWorkspace?: boolean
}) {
  const boardId = board?.id
  const target: BoardTarget = boardId ? { boardId } : { pieceId: pieceId! }
  const empty = references.length === 0
  const [view, setView] = useState<View>(readView)
  const [selected, setSelected] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [sketching, setSketching] = useState(false)
  const [noting, setNoting] = useState(false)
  const [linking, setLinking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const photos = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const takeToCad = useTakeToCad()
  const openAsCad = useOpenAsCad()
  const chosen = references.find((r) => r.id === selected) ?? null
  const selection = chosen && board && !readOnly && (
    <SelectionBar
      key={chosen.id}
      reference={chosen}
      projectWorkspace={projectWorkspace}
      onTakeToCad={() => takeToCad(board, chosen)}
      onOpenAsCad={() => openAsCad(board, chosen)}
      onClose={() => setSelected(null)}
    />
  )

  const changeView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // The view is a convenience; without storage it resets next time.
    }
  }

  const run = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await save(fn)
    } catch (e) {
      toast.error(`Couldn’t ${what}`, e instanceof Error ? e.message : undefined)
    }
  }

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  // Pasting a picture or a link anywhere on the page adds it, unless the person is typing.
  // `run` only sets this component's busy flag; the listener is renewed when the board changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (readOnly || busy) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      const pasted = [...(e.clipboardData?.files ?? [])]
      const urls = urlsIn(e.clipboardData?.getData('text') ?? '')
      if (!pasted.length && !urls.length) return
      e.preventDefault()
      void run('add that', async () => {
        if (pasted.length) await addFiles(target, pasted)
        else await addLinks(target, urls)
      })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [boardId, pieceId, readOnly, busy])

  const onDrop = (e: DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    setOver(false)
    if (busy) return
    const dropped = [...e.dataTransfer.files]
    const urls = urlsIn(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'))
    if (!dropped.length && !urls.length) return
    void run('add that', async () => {
      if (dropped.length) await addFiles(target, dropped)
      else if (urls.length) await addLinks(target, urls)
    })
  }

  const referenceSearch = searching && !readOnly && (
    <section
      aria-label="Search for references"
      className="rounded-lg border border-line bg-bg px-4 py-4 sm:px-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Search for references</h3>
        <IconButton icon={X} label="Close reference search" onClick={() => setSearching(false)} />
      </div>
      <WebReferenceSearch
        busy={busy}
        onSave={async (url) => {
          await save(() => addLinks(target, [url]))
          setSearching(false)
        }}
      />
    </section>
  )

  return (
    <section
      aria-label="Design board"
      data-design-board={boardId ?? ''}
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
      {empty && (
        <div
          className={cn(
            'rounded-lg border border-line bg-bg-subtle',
            projectWorkspace ? 'p-4' : 'px-5 py-10 sm:px-9 sm:py-14',
          )}
        >
          <h3
            className={cn(
              'text-fg',
              projectWorkspace ? 'text-base font-medium' : 'studio-title',
            )}
          >
            {readOnly ? 'No references yet' : 'Collect references for your design'}
          </h3>
          {!readOnly && (
            <>
              <p className="mt-2 max-w-md text-sm text-fg-muted">
                Bring in a photo of a piece you like, save a link, or get an idea down as a sketch
                or note.
              </p>
              <div className={cn('flex flex-wrap gap-2', projectWorkspace ? 'mt-3' : 'mt-6')}>
                <Button
                  variant="primary"
                  icon={FileImage}
                  disabled={busy}
                  onClick={() => photos.current?.click()}
                >
                  Add reference photo
                </Button>
                <Button
                  variant="secondary"
                  icon={Search}
                  aria-expanded={searching}
                  onClick={() => setSearching((open) => !open)}
                >
                  Search for references
                </Button>
                <Button
                  variant="ghost"
                  icon={PenLine}
                  disabled={busy}
                  onClick={() => setSketching(true)}
                >
                  Sketch
                </Button>
                <Button
                  variant="ghost"
                  icon={NotebookPen}
                  disabled={busy}
                  onClick={() => setNoting(true)}
                >
                  Write a note
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {empty && referenceSearch}
      {projectWorkspace && selection}

      {(!empty || (board && !readOnly)) && (
        <div
          role="toolbar"
          aria-label="Board tools"
          className="flex flex-wrap items-center gap-1.5"
        >
          {!readOnly && (
            <>
              {!empty && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Search}
                  aria-expanded={searching}
                  onClick={() => setSearching((open) => !open)}
                >
                  Search for references
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={Sparkles}
                aria-pressed={generating}
                onClick={() => setGenerating((open) => !open)}
              >
                Generate concepts
              </Button>
              <Menu
                trigger={
                  <Button size="sm" variant="ghost" icon={Plus} disabled={busy}>
                    {busy ? 'Adding…' : 'Add'}
                  </Button>
                }
              >
                <MenuItem icon={FileImage} onClick={() => photos.current?.click()}>
                  Add reference photo
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
                <MenuItem icon={Link2} onClick={() => setLinking(true)}>
                  Paste a link
                </MenuItem>
                <MenuItem icon={NotebookPen} onClick={() => setNoting(true)}>
                  Write a note
                </MenuItem>
              </Menu>
            </>
          )}
          {!empty && (
            <Segmented<View>
              size="sm"
              aria-label="Board view"
              className="ml-auto"
              value={view}
              onChange={changeView}
              options={[
                { value: 'masonry', label: 'Grid' },
                { value: 'canvas', label: 'Arrange by hand' },
              ]}
            />
          )}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            ref={photos}
            type="file"
            multiple
            accept={BOARD_IMAGE_ACCEPT}
            className="hidden"
            aria-label="Reference photos to add"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])]
              e.target.value = ''
              if (picked.length) void run('add those photos', () => addFiles(target, picked))
            }}
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
              if (picked.length) void run('add those files', () => addFiles(target, picked))
            }}
          />
        </>
      )}

      {!empty && referenceSearch}

      {generating && board && !readOnly && (
        <GeneratePanel
          board={board}
          references={references}
          onClose={() => setGenerating(false)}
          onTakeToCad={(r) => void takeToCad(board, r)}
        />
      )}

      {empty || !board ? null : view === 'masonry' ? (
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

      {!projectWorkspace && selection}

      <Sheet open={sketching} onOpenChange={setSketching} title="Sketch an idea">
        <SketchPad
          piece={{ id: board?.pieceId ?? boardId ?? pieceId! }}
          board={{
            key: boardId ? `board:${boardId}` : `design:${pieceId}`,
            titles: references.map((r) => r.title),
            save: async (file, title) => {
              await addSketch(target, file, title)
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
        onSubmit={(text) => save(() => addNote(target, text))}
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
            throw new Error('Paste a web address that starts with https:// or http://.')
          }
          return save(() => addLinks(target, urls))
        }}
      />
    </section>
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
            {r.type === 'generated' && (
              <Sparkles className="size-3 shrink-0 text-ai" aria-label="Generated" />
            )}
            {r.source && <span className="truncate">{providerLabel(r.source.provider)}</span>}
            {r.generation?.costUsd != null && (
              <span className="font-mono tabular">${r.generation.costUsd.toFixed(3)}</span>
            )}
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
      <p className="min-h-20 whitespace-pre-wrap bg-[color-mix(in_oklab,var(--warn)_8%,var(--bg))] px-3 py-3 font-sans text-sm leading-6">
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
  projectWorkspace,
}: {
  reference: Reference
  onTakeToCad: () => Promise<void>
  onOpenAsCad: () => Promise<void>
  onClose: () => void
  projectWorkspace: boolean
}) {
  const refusal = takeToCadRefusal(r)
  const { assistant } = useSession().capabilities
  const [going, setGoing] = useState(false)
  const go = (fn: () => Promise<void>) => {
    setGoing(true)
    void fn().finally(() => setGoing(false))
  }
  return (
    <section
      aria-label="Selected item"
      className={cn(
        'z-10 flex max-w-full flex-wrap items-center gap-2',
        projectWorkspace
          ? 'sticky top-12 rounded-lg border border-line bg-bg-subtle p-3'
          : 'glass-pane sticky bottom-4 mx-auto w-fit rounded-full px-3 py-2 shadow-lg',
      )}
    >
      <div className={cn('min-w-0', projectWorkspace ? 'flex-1 basis-40' : 'max-w-56 px-1')}>
        {projectWorkspace && <p className="text-xs text-fg-muted">Selected design</p>}
        <p className="truncate text-sm font-medium">{r.title || kindWord(r)}</p>
        {projectWorkspace && !refusal && r.type !== 'model' && (
          <p className="mt-0.5 text-xs text-fg-muted">
            {assistant
              ? 'Use this image for the CAD shape.'
              : 'Place this image beside CAD for tracing.'}
          </p>
        )}
      </div>
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
        projectWorkspace ? (
          <p className="text-xs text-fg-muted">{refusal}</p>
        ) : (
          <Tooltip content={refusal}>
            <span>
              <Button size="sm" variant="primary" icon={Hammer} disabled>
                Take to CAD
              </Button>
            </span>
          </Tooltip>
        )
      ) : (
        <Button
          size="sm"
          variant="primary"
          icon={Hammer}
          disabled={going}
          onClick={() => go(onTakeToCad)}
        >
          {going
            ? 'Starting…'
            : projectWorkspace
              ? assistant
                ? 'Build CAD from this image'
                : 'Open image in CAD'
              : 'Take to CAD'}
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
  onSubmit: (text: string) => Promise<unknown>
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="flex flex-col gap-3 px-4 pb-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const value = text.trim()
          if (!value || saving) return
          setSaving(true)
          setError('')
          try {
            await onSubmit(value)
            setText('')
            onOpenChange(false)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Couldn’t save this reference.')
          } finally {
            setSaving(false)
          }
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
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!text.trim() || saving}>
          {saving ? 'Saving…' : submit}
        </Button>
      </form>
    </Sheet>
  )
}
