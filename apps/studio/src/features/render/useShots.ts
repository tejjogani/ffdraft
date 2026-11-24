/**
 * The Render tab's server state and actions in one place: the piece, its shots (the default
 * set until something is saved), its takes, the engine, and the writes — save the set on the
 * first edit, adjust a shot, render one or all, cancel, star, swap a take into the set, set the
 * cover. Every write goes through the same commands the assistant uses.
 */
import {
  mergePatch,
  type RenderJob,
  type RenderScene,
  RenderSceneSchema,
  type SavedScene,
} from '@pave/schema'
import { toast } from '@pave/ui'
import { useRef } from 'react'
import { queryClient, rpcKey, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { type Shot, shotList } from './shots'

export function useShots(pieceId: string) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const saved = useRpc('scenes.list', { pieceId })
  const takes = useRpc('renders.list', { pieceId, limit: 200 })
  const engine = useRpc('renders.engine', {})
  const shots = piece.data ? shotList(saved.data, piece.data.kind) : []
  const saving = useRef<Promise<SavedScene[]> | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: rpcKey('scenes.list') })
    void queryClient.invalidateQueries({ queryKey: rpcKey('renders.list') })
  }

  /** The shots as saved rows: the default set is saved (once, in order) the first time it is needed. */
  const ensureSaved = (): Promise<SavedScene[]> => {
    if (saved.data?.length) return Promise.resolve(saved.data)
    saving.current ??= (async () => {
      const rows: SavedScene[] = []
      for (const [i, s] of shots.entries())
        rows.push(
          await rpc.call('scenes.create', {
            pieceId,
            title: s.title,
            scene: s.scene,
            position: i + 1,
          }),
        )
      queryClient.setQueryData(rpcKey('scenes.list', { pieceId }), rows)
      return rows
    })().finally(() => {
      saving.current = null
    })
    return saving.current
  }

  /** The saved row for a shot (a default one by its position in the set). */
  const savedFor = async (shot: Shot): Promise<SavedScene> => {
    if (shot.saved) return shot.saved
    const rows = await ensureSaved()
    return rows[shots.findIndex((s) => s.key === shot.key)] ?? rows[0]!
  }

  /** Applies a merge patch to a shot: shown at once, saved, and checked by the server. */
  const adjust = async (shot: Shot, patch: Record<string, unknown>): Promise<Shot | null> => {
    try {
      const row = await savedFor(shot)
      const key = rpcKey('scenes.list', { pieceId })
      const next = RenderSceneSchema.parse(mergePatch(row.scene, patch)) as RenderScene
      queryClient.setQueryData<SavedScene[]>(key, (list) =>
        list?.map((s) => (s.id === row.id ? { ...s, scene: next } : s)),
      )
      const updated = await rpc.call('scenes.update', { id: row.id, patch })
      return { key: updated.id, title: updated.title, scene: updated.scene, saved: updated }
    } catch (e) {
      toast.error('Couldn’t change the shot', e instanceof Error ? e.message : undefined)
      refresh()
      return null
    }
  }

  /** Queues a take of each shot; Blender when it is set up, else this window draws a preview. */
  const render = async (list: Shot[], extra: { retryOf?: string; note?: string } = {}) => {
    try {
      for (const shot of list) {
        const row = await savedFor(shot)
        await rpc.call('renders.create', {
          pieceId,
          sceneId: row.id,
          title: row.title,
          ...extra,
        })
      }
    } catch (e) {
      toast.error('Couldn’t start the render', e instanceof Error ? e.message : undefined)
    } finally {
      refresh()
    }
  }

  /** Renders a take again with what it was asked for: its shot as it is now, else its own scene. */
  const rerender = async (take: RenderJob) => {
    try {
      await rpc.call('renders.create', {
        pieceId,
        title: take.title,
        retryOf: take.id,
        ...(take.sceneId ? { sceneId: take.sceneId } : { scene: take.requestedScene }),
        ...(take.groupId ? { groupId: take.groupId } : {}),
        ...(take.variantLabel ? { variantLabel: take.variantLabel } : {}),
      })
    } catch (e) {
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

  return {
    piece: piece.data,
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
      act('Couldn’t swap it in', () =>
        t.sceneId ? rpc.call('scenes.update', { id: t.sceneId, takeId: t.id }) : Promise.resolve(),
      ),
    cover: (t: RenderJob) =>
      act('Couldn’t set the cover', async () => {
        await rpc.call('pieces.update', {
          id: pieceId,
          coverAssetId: t.assetIds[0]!,
          coverAuto: false,
        })
        void queryClient.invalidateQueries({ queryKey: rpcKey('pieces.get') })
        toast.success('Cover set')
      }),
  }
}
