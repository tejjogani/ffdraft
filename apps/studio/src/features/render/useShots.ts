/**
 * The Render tab's server state and actions in one place: the piece, its shots (the default
 * set until something is saved), its takes, the engine, and the writes — save the set on the
 * first edit, adjust a shot, render one or all, cancel, star, swap a take into the set, set the
 * cover. Every write goes through the same commands the assistant uses.
 */
import { mergePatch, type RenderJob, RenderSceneSchema, type SavedScene } from '@pave/schema'
import { toast } from '@pave/ui'
import { useRef } from 'react'
import { queryClient, rpcKey, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { reportPlanLimit } from '../plans/plan-limit'
import { ensureShotsSaved, queueShotAction } from './shot-actions'
import { type Shot, shotForTake, shotList, takeMedia } from './shots'

export function useShots(pieceId: string, canRender: boolean) {
  // A plan-limit toast can keep a preview action after the design changes.
  const renderAllowed = useRef({ pieceId, canRender })
  renderAllowed.current = { pieceId, canRender }
  const canStartRender = () =>
    renderAllowed.current.pieceId === pieceId && renderAllowed.current.canRender
  const piece = useRpc('pieces.get', { id: pieceId })
  const saved = useRpc('scenes.list', { pieceId })
  const takes = useRpc('renders.list', { pieceId, limit: 200 })
  const engine = useRpc('renders.engine', {})
  const shots = piece.data ? shotList(saved.data, piece.data.kind) : []
  const sceneListKey = rpcKey('scenes.list', { pieceId })
  const pieceKind = piece.data?.kind ?? 'ring'

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.list') })
    void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.history') })
    void queryClient.invalidateQueries({ queryKey: rpcKey('renders.list') })
  }

  /** The shots as saved rows: the default set is saved (once, in order) the first time it is needed. */
  const ensureSaved = (): Promise<SavedScene[]> => {
    const latest = queryClient.getQueryData<SavedScene[]>(sceneListKey)
    return latest?.length ? Promise.resolve(latest) : ensureShotsSaved(pieceId, pieceKind)
  }

  const replaceCachedScene = (row: SavedScene) => {
    queryClient.setQueryData<SavedScene[]>(sceneListKey, (list) =>
      list?.map((scene) => (scene.id === row.id ? row : scene)),
    )
  }

  /** Resolves captured default-shot keys even after an earlier action has saved the shot list. */
  const savedFor = async (shot: Shot): Promise<SavedScene> => {
    if (shot.saved) {
      if (shot.saved.pieceId !== pieceId) throw new Error('That shot belongs to another project.')
      return (
        queryClient
          .getQueryData<SavedScene[]>(sceneListKey)
          ?.find((row) => row.id === shot.saved?.id) ?? shot.saved
      )
    }
    const position =
      shotList(undefined, pieceKind).findIndex((preset) => preset.key === shot.key) + 1
    const rows = await ensureSaved()
    const row = rows.find((scene) => scene.position === position && scene.title === shot.title)
    if (!row) throw new Error('That shot is no longer in the set.')
    return row
  }

  /** Applies a merge patch to a shot: shown while saving and checked by the server. */
  const adjust = async (shot: Shot, patch: Record<string, unknown>): Promise<Shot | null> => {
    try {
      return await queueShotAction(pieceId, 'edit', async () => {
        const row = await savedFor(shot)
        const next = RenderSceneSchema.parse(mergePatch(row.scene, patch))
        replaceCachedScene({ ...row, scene: next })
        try {
          const updated = await rpc.call('scenes.update', { id: row.id, patch })
          replaceCachedScene(updated)
          void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.history', { id: row.id }) })
          return { key: updated.id, title: updated.title, scene: updated.scene, saved: updated }
        } catch (e) {
          replaceCachedScene(row)
          throw e
        }
      })
    } catch (e) {
      toast.error('Couldn’t change the shot', e instanceof Error ? e.message : undefined)
      refresh()
      return null
    }
  }

  /** Queues a take of each shot; Blender when it is set up, else this window draws a preview. */
  const render = async (
    list: Shot[],
    extra: { retryOf?: string; note?: string; engine?: 'browser' } = {},
  ): Promise<void> => {
    if (!canStartRender()) return
    let done = 0
    try {
      await queueShotAction(pieceId, 'render', async () => {
        for (const shot of list) {
          if (!canStartRender()) return
          const row = await savedFor(shot)
          if (!canStartRender()) return
          await rpc.call('renders.create', {
            pieceId,
            sceneId: row.id,
            title: row.title,
            ...extra,
          })
          done++
        }
      })
    } catch (e) {
      // Out of free Blender renders: the shots not yet queued can still be browser previews.
      const rest = list.slice(done)
      const preview = {
        label: 'Preview in the browser',
        run: () => void render(rest, { ...extra, engine: 'browser' }),
      }
      if (!reportPlanLimit(e, preview))
        toast.error('Couldn’t start the render', e instanceof Error ? e.message : undefined)
    } finally {
      refresh()
    }
  }

  /** Renders a take again with what it was asked for: its shot as it is now, else its own scene. */
  const rerender = async (take: RenderJob) => {
    if (!canStartRender() || take.pieceId !== pieceId) return
    try {
      await queueShotAction(pieceId, 'render', async () => {
        if (!canStartRender()) return
        await rpc.call('renders.create', {
          pieceId,
          title: take.title,
          retryOf: take.id,
          ...(take.sceneId ? { sceneId: take.sceneId } : { scene: take.requestedScene }),
          ...(take.groupId ? { groupId: take.groupId } : {}),
          ...(take.variantLabel ? { variantLabel: take.variantLabel } : {}),
        })
      })
    } catch (e) {
      if (!reportPlanLimit(e))
        toast.error('Couldn’t re-render', e instanceof Error ? e.message : undefined)
    } finally {
      refresh()
    }
  }

  const act = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (e) {
      toast.error(what, e instanceof Error ? e.message : undefined)
    } finally {
      refresh()
    }
  }

  /** Undoes (or redoes) a change to a saved shot: `scenes.revert` of the change the history names. */
  const revert = (shot: Shot, changeId: string) =>
    act('Couldn’t undo that', () =>
      queueShotAction(pieceId, 'edit', async () => {
        const row = await savedFor(shot)
        const { scene } = await rpc.call('scenes.revert', { id: row.id, changeId })
        replaceCachedScene(scene)
      }),
    )

  return {
    piece: piece.data,
    revert,
    ensureSaved,
    shots,
    takes: takes.data ?? [],
    loading: piece.isPending || saved.isPending,
    engine: engine.data,
    adjust,
    render,
    rerender,
    cancel: (t: RenderJob) =>
      act('Couldn’t cancel', () => rpc.call('renders.cancel', { id: t.id })),
    star: (t: RenderJob) =>
      act('Couldn’t star it', () => rpc.call('renders.update', { id: t.id, starred: !t.starred })),
    pick: (t: RenderJob) =>
      act('Couldn’t put it in the set', async () => {
        // A variant or one-off take has no shot of its own: it becomes one, made from exactly the
        // scene it rendered, with this take in the set. Never a silent no-op.
        const target = shotForTake(t)
        const sceneId =
          'sceneId' in target
            ? target.sceneId
            : (await rpc.call('scenes.create', { pieceId, ...target.create })).id
        await rpc.call('scenes.update', { id: sceneId, takeId: t.id })
        if (!t.sceneId) toast.success('Added to the set as a new shot')
      }),
    cover: (t: RenderJob) =>
      act('Couldn’t set the cover', async () => {
        await rpc.call('pieces.update', {
          id: pieceId,
          coverAssetId: takeMedia(t).still ?? t.assetIds[0]!,
          coverAuto: false,
        })
        void queryClient.invalidateQueries({ queryKey: rpcKey('pieces.get') })
        toast.success('Cover set')
      }),
  }
}
