/**
 * Shot writes that start outside the Render tab or span pieces: saving a piece's default set
 * (once, however many callers ask at the same moment), "Render this view" from the CAD
 * workspace, and house shots, the organisation's framed shots reused on any piece.
 */
import { DEFAULT_SHOTS } from '@pave/render'
import {
  type PieceKind,
  type RenderSceneInput,
  RenderSceneSchema,
  type SavedScene,
} from '@pave/schema'
import { queryClient, rpcKey } from '../../lib/query'
import { rpc } from '../../lib/rpc'

/** One save of the default set per piece at a time: two first edits must not save it twice. */
const saving = new Map<string, Promise<SavedScene[]>>()

/** The piece's saved shots; the default set for its kind is saved first if there are none. */
export function ensureShotsSaved(pieceId: string, kind: PieceKind): Promise<SavedScene[]> {
  const running = saving.get(pieceId)
  if (running) return running
  const work = (async () => {
    const existing = await rpc.call('scenes.list', { pieceId })
    if (existing.length) return existing
    const rows: SavedScene[] = []
    for (const [i, s] of DEFAULT_SHOTS(kind).entries())
      rows.push(
        await rpc.call('scenes.create', {
          pieceId,
          title: s.title,
          scene: RenderSceneSchema.parse(s.scene),
          position: i + 1,
        }),
      )
    queryClient.setQueryData(rpcKey('scenes.list', { pieceId }), rows)
    return rows
  })().finally(() => saving.delete(pieceId))
  saving.set(pieceId, work)
  return work
}

/** The shot the Render tab should select when it next opens for a piece. */
let intent: { pieceId: string; sceneId: string } | null = null

export function selectShotNext(pieceId: string, sceneId: string): void {
  intent = { pieceId, sceneId }
}

export function takeShotIntent(pieceId: string): string | null {
  if (intent?.pieceId !== pieceId) return null
  const id = intent.sceneId
  intent = null
  return id
}

/** A title not already in the list: "View", "View 2", … */
export function freshTitle(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`
}

/**
 * Adds a shot to a piece (after its default set, so that is not lost) and returns it, e.g. the
 * CAD view as a custom camera or a house shot.
 */
export async function addShot(
  pieceId: string,
  kind: PieceKind,
  title: string,
  scene: RenderSceneInput,
): Promise<SavedScene> {
  const rows = await ensureShotsSaved(pieceId, kind)
  const row = await rpc.call('scenes.create', {
    pieceId,
    title: freshTitle(
      title,
      rows.map((r) => r.title),
    ),
    scene: RenderSceneSchema.parse(scene),
  })
  // In the list at once, so a Render tab opening now can select it.
  queryClient.setQueryData<SavedScene[]>(rpcKey('scenes.list', { pieceId }), (list) =>
    list ? [...list.filter((s) => s.id !== row.id), row] : [...rows, row],
  )
  void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.list') })
  return row
}

/** Saves a shot as a house shot: the organisation's, offered on every piece. */
export async function saveHouseShot(title: string, scene: RenderSceneInput): Promise<SavedScene> {
  const houses = await rpc.call('scenes.list', { pieceId: null })
  // The lock is the designer's choice for one piece's shot; a house shot starts unlocked.
  const parsed = RenderSceneSchema.parse(scene)
  const row = await rpc.call('scenes.create', {
    pieceId: null,
    title: freshTitle(
      title,
      houses.map((h) => h.title),
    ),
    scene: { ...parsed, camera: { ...parsed.camera, locked: undefined } },
  })
  void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.list', { pieceId: null }) })
  return row
}

/**
 * "Render this view": the CAD view's camera as a new custom shot of the piece (square, standard
 * quality), selected when the Render tab opens. The square frame holds everything the CAD view
 * showed: the lens spans the wider side in both.
 */
export async function renderThisView(
  pieceId: string,
  kind: PieceKind,
  camera: {
    position: [number, number, number]
    target: [number, number, number]
    focalLength: number
    framedOn: { center: [number, number, number]; radius: number } | null
  },
): Promise<SavedScene> {
  const round = (v: [number, number, number]) =>
    v.map((n) => Math.round(n * 1000) / 1000) as [number, number, number]
  const row = await addShot(pieceId, kind, 'CAD view', {
    camera: {
      preset: 'custom',
      position: round(camera.position),
      target: round(camera.target),
      focalLength: camera.focalLength,
      ...(camera.framedOn ? { framedOn: camera.framedOn } : {}),
    },
    output: { width: 2000, height: 2000, quality: 'standard' },
  })
  selectShotNext(pieceId, row.id)
  return row
}

interface ShotActionQueue {
  tail: Promise<void>
  pendingEdits: Set<Promise<boolean>>
}

const actionQueues = new Map<string, ShotActionQueue>()

/** A render reads saved scenes, so it must follow the edits requested before it on this piece. */
export function queueShotAction<T>(
  pieceId: string,
  kind: 'edit' | 'render',
  work: () => Promise<T>,
): Promise<T> {
  const queue = actionQueues.get(pieceId) ?? { tail: Promise.resolve(), pendingEdits: new Set() }
  const requiredEdits = kind === 'render' ? [...queue.pendingEdits] : []
  const result = queue.tail.then(async () => {
    const saved = await Promise.all(requiredEdits)
    if (saved.includes(false))
      throw new Error('A pending shot change could not be saved. Try rendering again.')
    return work()
  })
  const settled = result.then(
    () => true,
    () => false,
  )
  if (kind === 'edit') queue.pendingEdits.add(settled)
  const tail = settled.then(() => {
    queue.pendingEdits.delete(settled)
    if (queue.tail === tail) actionQueues.delete(pieceId)
  })
  queue.tail = tail
  actionQueues.set(pieceId, queue)
  return result
}

const cadRenders = new Map<string, Promise<SavedScene | null>>()

/** Queues the saved Hero shot, or the first saved shot if this set has no Hero. */
export function queueCadRender(
  pieceId: string,
  kind: PieceKind,
  canProceed: () => boolean,
): Promise<SavedScene | null> {
  const pending = cadRenders.get(pieceId)
  if (pending) return pending
  const work = queueShotAction(pieceId, 'render', async () => {
    if (!canProceed()) return null
    const shots = await ensureShotsSaved(pieceId, kind)
    if (!canProceed()) return null
    const shot = shots.find((s) => s.title.toLowerCase() === 'hero') ?? shots[0]
    if (!shot) throw new Error('Add a shot in Render Studio, then try again.')
    await rpc.call('renders.create', {
      pieceId,
      sceneId: shot.id,
      title: shot.title,
      engine: 'blender',
    })
    void queryClient.invalidateQueries({ queryKey: rpcKey('renders.list') })
    return shot
  }).finally(() => cadRenders.delete(pieceId))
  cadRenders.set(pieceId, work)
  return work
}
