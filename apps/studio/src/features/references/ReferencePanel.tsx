/**
 * The reference window beside CAD and the Render tab. Its References tab finds references (the
 * Google Images and Pinterest, the piece's own photos and moodboards, the organisation's boards,
 * a pasted link, a dropped or pasted picture), pins them to the piece, orders them, and drags a
 * pinned picture onto the CAD view as an image plane; every result and pin says where it comes
 * from and what its rights allow. Its Sketch tab is a sketch pad whose sketch becomes a pinned
 * reference; Generated shows only when an image model is configured.
 *
 * Docked as a flat column beside the work, or pulled out as a floating glass window the person
 * can move, resize, close and dock again (remembered per browser); a sheet on narrow screens.
 */
import type { ImagePlaneView, Piece, Reference } from '@pave/schema'
import {
  Button,
  cn,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Segmented,
  Sheet,
  Skeleton,
  Spinner,
  tabClass,
  toast,
} from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  Camera,
  EyeOff,
  GripVertical,
  ImagePlus,
  Images,
  Link2,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  PictureInPicture2,
  Pin,
  PinOff,
  Sparkles,
  X,
} from 'lucide-react'
import { type DragEvent, type ReactNode, useRef, useState } from 'react'
import { FloatingWindow } from '../../components/FloatingWindow'
import { assetUrl, uploadAsset } from '../../lib/assets'
import { defaultRect } from '../../lib/float-window'
import { VIEW_LABEL } from '../../lib/image-planes'
import { useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { useAssistant } from '../../stores/assistant'
import { useSend } from '../assistant/actions'
import { movePin, pin, removeFromView, unpin } from './actions'
import { GeneratedTab } from './GeneratedTab'
import { ProvenanceButton, type ProvenanceFacts, providerLabel, RightsChip } from './Provenance'
import { TraceOutline } from './TraceOutline'
import { SketchPad } from './SketchPad'
import { type PanelSource, PIN_DRAG_TYPE, type ReferenceTab, useReferencePanel } from './store'
import { WebReferenceSearch } from './WebReferenceSearch'

const VIEWS: ImagePlaneView[] = ['front', 'top', 'right']

/** Docked beside the work from this container width; a sheet below it. */
export const DOCK_PANEL_PX = 900
export const PANEL_PX = 320
/** The floating window's first size and its smallest. */
const FLOAT_SIZE = { w: 360, h: 600 }
const FLOAT_LIMITS = { minW: 300, minH: 360 }
/** The goal of the CAD job that updates the design to a newly pinned picture. */
/** The goal of the Render job that copies pinned shot references. */
export const SHOT_GOAL =
  'Shoot the piece like the attached shot references: read each one’s angle, framing, lens, light and any motion, place one shot per reference copying them, show each reference beside its framing capture, then render and hand the set over.'

/**
 * A pinned picture handed to an AI job: the CAD job updates the design to it, the Render job
 * copies it as a shot reference. Both go through the job's plan (so they can be paused,
 * inspected and undone), and the assistant opens on the job's conversation.
 */
function useReferenceJob(piece: Piece) {
  const { send, pending } = useSend({ pieceId: piece.id })
  const start = async (stage: 'cad' | 'render', assetId: string) => {
    try {
      await send(
        stage === 'cad'
          ? 'Update the design to this new reference image'
          : 'Shoot it like this reference',
        {
          job: { stage, goal: stage === 'cad' ? UPDATE_GOAL : SHOT_GOAL },
          threadId: null,
          pieceId: piece.id,
          bare: true,
          attachments: [assetId],
        },
      )
      useAssistant.setState({ isOpen: true, collapsed: false })
    } catch (e) {
      toast.error('Couldn’t start the job', (e as Error).message)
    }
  }
  return { start, pending }
}

export const UPDATE_GOAL =
  'Update the design to the attached reference picture: read it, compare it with the design as it is, change only what differs (one undoable edit per change), keep my own edits, fit and compare, and say what changed and what still differs.'

const refFacts = (r: Reference): ProvenanceFacts => ({
  title: r.title,
  provider: r.source?.provider ?? null,
  url: r.source?.url ?? null,
  credit: r.source?.credit ?? null,
  license: r.source?.license ?? null,
  licenseUrl: r.source?.licenseUrl ?? null,
  capturedAt: r.source?.capturedAt ?? null,
  rights: r.rights,
})

/** A link's site and path, shorter than the whole address. */
function linkName(url: string | null | undefined): string {
  if (!url) return 'Link'
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}

// A 3D model from a design board has no picture: its tile shows no image rather than a broken one.
const pictureOf = (r: Reference, width = 320) =>
  r.type === 'model' ? null : r.assetId ? assetUrl(r.assetId, width) : r.thumbUrl

/**
 * The window's contents under its tabs: References, Sketch, and Generated when an image model is
 * configured (otherwise one line says image generation needs one). The caller docks it, floats
 * it or puts it in a sheet.
 */
export function ReferenceWindowBody({ piece }: { piece: Piece }) {
  const stored = useReferencePanel((s) => s.tab)
  const setTab = useReferencePanel((s) => s.setTab)
  const { capabilities } = useSession()
  const generation = capabilities.imageGeneration.length > 0
  const tab: ReferenceTab = stored === 'generated' && !generation ? 'references' : stored
  return (
    <div className="flex h-full min-h-0 flex-col" data-region="references">
      {/* The window's own tabs are a quiet underline row, so they never read as a second copy of
          the segmented "where to look" control just below them. */}
      <fieldset
        aria-label="Reference window"
        className="mx-3 mb-2 flex min-w-0 shrink-0 items-center gap-4 border-0 p-0 shadow-[inset_0_-1px_0_var(--line)]"
      >
        {(
          [
            ['references', 'References'],
            ['sketch', 'Sketch'],
            ...(generation ? [['generated', 'Generated'] as const] : []),
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              tabClass,
              'h-8 aria-pressed:text-fg aria-pressed:after:absolute aria-pressed:after:inset-x-0 aria-pressed:after:bottom-0 aria-pressed:after:h-px aria-pressed:after:bg-fg',
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="min-h-0 flex-1">
        {tab === 'references' && <ReferencesTab piece={piece} />}
        {tab === 'sketch' && <SketchPad piece={piece} />}
        {tab === 'generated' && <GeneratedTab piece={piece} />}
      </div>
      {!generation && (
        <p className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Generating images needs an image model, which this build does not include.
        </p>
      )}
    </div>
  )
}

/** Find, pin and order references. */
function ReferencesTab({ piece }: { piece: Piece }) {
  const source = useReferencePanel((s) => s.source)
  const setSource = useReferencePanel((s) => s.setSource)
  const pins = useRpc('references.pins', { pieceId: piece.id })
  const count = pins.data?.references.length ?? 0
  const auth = useSession()
  const role = activeOrg(auth)?.role ?? 'viewer'
  const readOnly = role === 'viewer' || role === 'guest'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <Segmented<PanelSource>
          size="sm"
          aria-label="Where to look"
          value={source}
          onChange={setSource}
          className="w-full"
          options={[
            { value: 'pinned', label: count ? `Pinned ${count}` : 'Pinned' },
            { value: 'search', label: 'Search' },
            { value: 'piece', label: 'This piece' },
            { value: 'boards', label: 'Boards' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {source === 'pinned' && (
          <PinnedList piece={piece} pins={pins.data?.references ?? null} readOnly={readOnly} />
        )}
        {source === 'search' && <SearchSource key={piece.id} piece={piece} readOnly={readOnly} />}
        {source === 'piece' && <PieceSource piece={piece} readOnly={readOnly} />}
        {source === 'boards' && <BoardsSource piece={piece} readOnly={readOnly} />}
      </div>
    </div>
  )
}

// ── Pinned ────────────────────────────────────────────────────────────────────────────────────

function PinnedList({
  piece,
  pins,
  readOnly,
}: {
  piece: Piece
  pins: Reference[] | null
  readOnly: boolean
}) {
  const [over, setOver] = useState<number | null>(null)
  if (!pins) return <Skeleton className="h-24" />
  return (
    <div className="flex flex-col gap-3">
      {!readOnly && <AddBar piece={piece} />}
      {pins.length === 0 ? (
        <EmptyState
          title="Nothing pinned yet"
          description="Search Google Images or Pinterest, pick from your boards, or add a link or picture. Pinned pictures can be laid in the front, top or right view to model over."
        />
      ) : (
        <ul aria-label="Pinned references" className="flex flex-col gap-2">
          {pins.map((r, i) => (
            <li
              key={r.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(PIN_DRAG_TYPE)) return
                e.preventDefault()
                setOver(i)
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(PIN_DRAG_TYPE)
                setOver(null)
                if (!id) return
                e.preventDefault()
                void movePin(piece.id, id, i)
              }}
              className={cn(over === i && 'rounded-lg shadow-[0_-2px_0_0_var(--select)]')}
            >
              <PinTile piece={piece} ref_={r} index={i} total={pins.length} readOnly={readOnly} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PinTile({
  piece,
  ref_: r,
  index,
  total,
  readOnly,
}: {
  piece: Piece
  ref_: Reference
  index: number
  total: number
  readOnly: boolean
}) {
  const setDragging = useReferencePanel((s) => s.setDragging)
  const select = useReferencePanel((s) => s.select)
  const setOpen = useReferencePanel((s) => s.setOpen)
  const navigate = useNavigate()
  const [traceOpen, setTraceOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const picture = pictureOf(r)
  const placeable = !!r.assetId && !readOnly
  const { capabilities } = useSession()
  const job = useReferenceJob(piece)
  // A view-only picture is never sent to AI; a link without its picture has nothing to send.
  const forAi = capabilities.assistant && !readOnly && !!r.assetId && r.rights !== 'viewOnly'

  const place = (view: ImagePlaneView) => {
    // The CAD view lays it (it knows the piece's size); from another tab, CAD opens first.
    useReferencePanel.getState().setPlaceRequest({ pieceId: piece.id, refId: r.id, view })
    if (useReferencePanel.getState().viewport !== piece.id)
      void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
    // On a phone the panel is a sheet over the view: get it out of the way.
    if (window.matchMedia(`(max-width: ${DOCK_PANEL_PX - 1}px)`).matches) setOpen(false)
  }

  const capture = async () => {
    setCapturing(true)
    try {
      await rpc.call('references.capture', { id: r.id })
    } catch (e) {
      toast.error('Couldn’t capture the image', (e as Error).message)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <article
      aria-label={`Pinned: ${r.title || 'Untitled'}`}
      draggable={!readOnly}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(PIN_DRAG_TYPE, r.id)
        e.dataTransfer.effectAllowed = 'copyMove'
        if (placeable) setDragging(r.id)
      }}
      onDragEnd={() => setDragging(null)}
      className="group flex gap-2.5 rounded-lg bg-bg p-1.5 shadow-[0_0_0_1px_var(--line)]"
    >
      {traceOpen && (
        <TraceOutline piece={piece} reference={r} onClose={() => setTraceOpen(false)} />
      )}
      <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-muted">
        {picture ? (
          <img
            src={picture}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <Link2 className="size-4 text-fg-subtle" aria-hidden />
        )}
        {!readOnly && (
          <GripVertical
            aria-hidden
            className="absolute top-0.5 left-0.5 size-3.5 rounded-xs bg-bg/80 text-fg-subtle opacity-0 group-hover:opacity-100"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1">
          <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 font-medium [overflow-wrap:anywhere]">
            {r.title || (r.type === 'link' ? linkName(r.source?.url) : 'Untitled')}
          </p>
          <ProvenanceButton facts={refFacts(r)} />
          {!readOnly && (
            <Menu
              align="end"
              trigger={
                <IconButton
                  icon={MoreHorizontal}
                  label={`Actions for ${r.title || 'this reference'}`}
                  size="sm"
                  className="size-6"
                />
              }
            >
              <MenuGroup label="Lay in a view to model over">
                {VIEWS.map((v) => (
                  <MenuItem key={v} icon={Images} disabled={!placeable} onClick={() => place(v)}>
                    {VIEW_LABEL[v]} view
                  </MenuItem>
                ))}
              </MenuGroup>
              {r.plane && (
                <MenuItem icon={EyeOff} onClick={() => void removeFromView(piece.id, r)}>
                  Take out of the view
                </MenuItem>
              )}
              {r.assetId && r.type !== 'model' && r.rights !== 'viewOnly' && (
                <MenuItem icon={Images} onClick={() => setTraceOpen(true)}>
                  Trace a flat outline
                </MenuItem>
              )}
              {forAi && (
                <MenuGroup label="With AI">
                  <MenuItem
                    icon={Sparkles}
                    disabled={job.pending || piece.design.order.length === 0}
                    onClick={() => void job.start('cad', r.assetId!)}
                  >
                    Update the design to this picture
                  </MenuItem>
                  <MenuItem
                    icon={Camera}
                    disabled={job.pending || piece.design.order.length === 0}
                    onClick={() => void job.start('render', r.assetId!)}
                  >
                    Shoot like this reference
                  </MenuItem>
                </MenuGroup>
              )}
              {r.type === 'link' && !r.assetId && (
                <MenuItem icon={Camera} onClick={() => void capture()}>
                  Capture image
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                icon={ArrowUp}
                disabled={index === 0}
                onClick={() => void movePin(piece.id, r.id, index - 1)}
              >
                Move up
              </MenuItem>
              <MenuItem
                icon={ArrowDown}
                disabled={index === total - 1}
                onClick={() => void movePin(piece.id, r.id, index + 1)}
              >
                Move down
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={PinOff} danger onClick={() => void unpin(piece.id, r)}>
                Unpin
              </MenuItem>
            </Menu>
          )}
        </div>
        <p className="truncate text-xs text-fg-subtle">{providerLabel(r.source?.provider)}</p>
        <div className="flex flex-wrap items-center gap-1">
          <RightsChip rights={r.rights} />
          {r.plane && (
            <button
              type="button"
              onClick={() => select({ pieceId: piece.id, refId: r.id })}
              className="inline-flex h-5 items-center rounded-xs bg-select-soft px-1.5 text-xs font-medium text-select"
            >
              In {VIEW_LABEL[r.plane.view].toLowerCase()} view
            </button>
          )}
          {r.type === 'link' && !r.assetId && !readOnly && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs"
              onClick={() => void capture()}
            >
              {capturing ? <Spinner className="size-3" /> : <Camera className="size-3" />}
              Capture image
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

/** Paste a link or a picture, drop files or links, or pick a file. */
function AddBar({ piece }: { piece: Piece }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const addFiles = async (files: File[]) => {
    const pictures = files.filter((f) => f.type.startsWith('image/'))
    if (!pictures.length) return
    setBusy(true)
    try {
      const assets = await Promise.all(pictures.map((f) => uploadAsset(f)))
      await pin(
        piece.id,
        assets.map((a) => ({ assetId: a.id })),
      )
    } catch (e) {
      toast.error('Couldn’t add the picture', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addUrl = async (url: string) => {
    const trimmed = url.trim()
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      toast.error('That is not a web address', 'Paste a link that starts with http:// or https://')
      return
    }
    setBusy(true)
    // Kept as a view-only link; its picture is fetched only when someone asks (Capture image).
    if (await pin(piece.id, [{ url: trimmed }])) setValue('')
    setBusy(false)
  }

  return (
    <section
      aria-label="Add a reference"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PIN_DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes(PIN_DRAG_TYPE)) return
        e.preventDefault()
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) void addFiles(files)
        else {
          const url =
            e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
          if (url) void addUrl(url.split('\n')[0]!)
        }
      }}
      className={cn(
        'rounded-lg border border-dashed border-line-strong p-2',
        over && 'border-select bg-select-soft',
      )}
    >
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (value) void addUrl(value)
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          placeholder="Paste a link or a picture"
          aria-label="Paste a link or a picture"
          className="h-8 min-w-0 flex-1 text-sm"
        />
        <IconButton
          icon={ImagePlus}
          label="Add a picture from a file"
          onClick={() => file.current?.click()}
        />
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </form>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-subtle">
        {busy && <Spinner className="size-3" />}
        Or drop pictures and links here. A link stays view-only.
      </p>
    </section>
  )
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────

function SearchSource({ piece, readOnly }: { piece: Piece; readOnly: boolean }) {
  const setSource = useReferencePanel((s) => s.setSource)
  const saveLink = async (url: string) => {
    const saved = await pin(piece.id, [{ url, title: linkName(url) }])
    if (!saved?.length) throw new Error('Couldn’t pin that link. Try again.')
    setSource('pinned')
  }
  return <WebReferenceSearch saveLabel="Pin link" {...(!readOnly && { onSave: saveLink })} />
}

/** A picture with its title, credit, rights and one action, for results and board items. */
function Tile({
  label,
  picture,
  sub,
  chips,
  facts,
  action,
}: {
  label: string
  picture: string | null
  sub: string
  chips: ReactNode
  facts: ProvenanceFacts
  action: ReactNode
}) {
  return (
    <article
      aria-label={label || 'Untitled'}
      className="flex h-full flex-col overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]"
    >
      <div className="relative aspect-square bg-bg-muted">
        {picture ? (
          <img
            src={picture}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <Link2 className="absolute inset-0 m-auto size-4 text-fg-subtle" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <div className="flex items-start gap-0.5">
          <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 font-medium">
            {label || 'Untitled'}
          </p>
          <ProvenanceButton facts={facts} />
        </div>
        <p className="line-clamp-2 text-2xs leading-3.5 text-fg-subtle">{sub}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-0.5">
          {chips}
          {action}
        </div>
      </div>
    </article>
  )
}

// ── This piece and boards ─────────────────────────────────────────────────────────────────────

function PieceSource({ piece, readOnly }: { piece: Piece; readOnly: boolean }) {
  const boards = useRpc('boards.list', { pieceId: piece.id })
  const photos = piece.origin?.sourceAssetIds ?? []
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Photos of this piece" className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-fg-muted">Photos</h3>
        {photos.length ? (
          <ul className="grid grid-cols-2 gap-2">
            {photos.map((id) => (
              <li key={id}>
                <Tile
                  label="Photo the piece was made from"
                  picture={assetUrl(id, 320)}
                  sub="Uploaded"
                  chips={<RightsChip rights="own" />}
                  facts={{
                    title: 'Photo the piece was made from',
                    provider: 'upload',
                    url: null,
                    credit: null,
                    license: null,
                    rights: 'own',
                  }}
                  action={readOnly ? null : <PinButton piece={piece} item={{ assetId: id }} />}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-subtle">
            No photos yet. A piece made from a photo keeps it here.
          </p>
        )}
      </section>
      {boards.isPending ? (
        <Skeleton className="h-20" />
      ) : boards.data?.length ? (
        boards.data.map((b) => (
          <BoardReferences
            key={b.id}
            boardId={b.id}
            title={b.title}
            piece={piece}
            readOnly={readOnly}
          />
        ))
      ) : (
        <p className="text-xs text-fg-subtle">No design references on this piece yet.</p>
      )}
    </div>
  )
}

function BoardsSource({ piece, readOnly }: { piece: Piece; readOnly: boolean }) {
  const boards = useRpc('boards.list', { scope: 'library' })
  const [open, setOpen] = useState<string | null>(null)
  if (boards.isPending) return <Skeleton className="h-20" />
  if (!boards.data?.length)
    return <p className="text-xs text-fg-subtle">Your organisation has no moodboards yet.</p>
  return (
    <div className="flex flex-col gap-2">
      {boards.data.map((b) => (
        <div key={b.id}>
          <button
            type="button"
            aria-expanded={open === b.id}
            onClick={() => setOpen(open === b.id ? null : b.id)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-muted"
          >
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
            <span className="text-xs text-fg-subtle">{b.referenceCount}</span>
          </button>
          {open === b.id && (
            <div className="mt-1.5">
              <BoardReferences boardId={b.id} piece={piece} readOnly={readOnly} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BoardReferences({
  boardId,
  title,
  piece,
  readOnly,
}: {
  boardId: string
  title?: string
  piece: Piece
  readOnly: boolean
}) {
  const board = useRpc('boards.get', { id: boardId })
  const items = (board.data?.references ?? []).filter(
    (r) => r.type !== 'note' && r.type !== 'swatch',
  )
  return (
    <section aria-label={title ?? 'Board'} className="flex flex-col gap-1.5">
      {title && <h3 className="text-xs font-medium text-fg-muted">{title}</h3>}
      {board.isPending ? (
        <Skeleton className="h-20" />
      ) : items.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {items.map((r) => (
            <li key={r.id}>
              <Tile
                label={r.title}
                picture={pictureOf(r)}
                sub={r.source?.credit ?? providerLabel(r.source?.provider)}
                chips={<RightsChip rights={r.rights} />}
                facts={refFacts(r)}
                action={readOnly ? null : <PinButton piece={piece} item={{ referenceId: r.id }} />}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">No pictures or links on this board.</p>
      )}
    </section>
  )
}

function PinButton({
  piece,
  item,
}: {
  piece: Piece
  item: { assetId: string } | { referenceId: string }
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      className="h-6 px-2 text-xs"
      onClick={async () => {
        setBusy(true)
        await pin(piece.id, [item])
        setBusy(false)
      }}
    >
      {busy ? <Spinner className="size-3" /> : <Pin className="size-3" />}
      Pin
    </Button>
  )
}

// ── Docking ───────────────────────────────────────────────────────────────────────────────────

/**
 * The reference window beside a workspace tab. Docked: a flat column when there is room
 * (collapsed, a slim rail with the pin count). Floating: a glass window over the work that can
 * be moved, resized, closed and dragged back to the right edge to dock. Narrow screens: a sheet.
 */
export function ReferenceDock({ piece, docked }: { piece: Piece; docked: boolean }) {
  const open = useReferencePanel((s) => s.open)
  const setOpen = useReferencePanel((s) => s.setOpen)
  const layout = useReferencePanel((s) => s.layout)
  const rect = useReferencePanel((s) => s.rect)
  const setRect = useReferencePanel((s) => s.setRect)
  const setLayout = useReferencePanel((s) => s.setLayout)
  const pins = useRpc('references.pins', { pieceId: piece.id })
  const count = pins.data?.references.length ?? 0
  if (!docked)
    return (
      <Sheet open={open} onOpenChange={setOpen} title="References" side="right">
        <ReferenceWindowBody piece={piece} />
      </Sheet>
    )
  if (layout === 'floating')
    return open ? (
      <FloatingWindow
        label="References"
        layer="z-30"
        rect={rect}
        defaultSize={FLOAT_SIZE}
        limits={FLOAT_LIMITS}
        onRect={setRect}
        onSnap={() => setLayout('docked')}
        snapHint="Release to dock it beside the CAD"
        snapWidth={PANEL_PX}
        title={
          <>
            <Images className="size-3.5 text-fg-muted" aria-hidden />
            <span className="truncate text-sm font-medium">References</span>
            {count > 0 && <span className="text-xs text-fg-subtle">{count} pinned</span>}
          </>
        }
        actions={
          <>
            <IconButton
              icon={PanelRight}
              label="Dock beside the CAD"
              size="sm"
              onClick={() => setLayout('docked')}
            />
            <IconButton
              icon={X}
              label="Close references"
              size="sm"
              onClick={() => setOpen(false)}
            />
          </>
        }
      >
        <ReferenceWindowBody piece={piece} />
      </FloatingWindow>
    ) : null
  if (!open)
    return (
      <aside
        aria-label="References (hidden)"
        className="flex w-10 shrink-0 flex-col items-center border-l border-line bg-bg pt-2"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Show references${count ? ` (${count} pinned)` : ''}`}
          className="flex flex-col items-center gap-1.5 rounded-md px-1.5 py-2 text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <Images className="size-4" aria-hidden />
          <span className="text-2xs [writing-mode:vertical-rl]">References</span>
          {count > 0 && (
            <span className="rounded-xs bg-bg-muted px-1 text-2xs font-medium text-fg">
              {count}
            </span>
          )}
        </button>
      </aside>
    )
  return (
    <aside
      aria-label="References"
      style={{ width: PANEL_PX }}
      className="flex shrink-0 flex-col border-l border-line bg-bg"
    >
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-xs font-medium text-fg-muted">References</h2>
        <span className="flex items-center">
          <IconButton
            icon={PictureInPicture2}
            label="Pop out as a floating window"
            size="sm"
            onClick={() =>
              setLayout(
                'floating',
                rect ??
                  defaultRect(
                    { w: window.innerWidth, h: window.innerHeight },
                    FLOAT_SIZE,
                    FLOAT_LIMITS,
                  ),
              )
            }
          />
          <IconButton
            icon={PanelRightClose}
            label="Hide references"
            size="sm"
            onClick={() => setOpen(false)}
          />
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ReferenceWindowBody piece={piece} />
      </div>
    </aside>
  )
}
