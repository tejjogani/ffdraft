/**
 * What the Design tab shows and how, as opposed to what the design is: selection, hover,
 * view-only hiding, display mode, x-ray, fine-tuning, the ring-size system a designer
 * prefers to read and what their scroll wheel is. Preferences persist; the rest resets when another piece opens.
 */
import type { RingSizeSystem } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WheelDevice } from '../../../components/stage/wheel'

export type DisplayMode = 'rendered' | 'clay' | 'technical'

export interface NodePick {
  nodeId: string
  /** A single stone of a pavé field / row (`${nodeId}:${index}`), when one was clicked. */
  stoneId?: string
  partId?: string
}

interface ViewMask {
  hidden: string[]
  hiddenStones: string[]
  hiddenParts: string[]
  /** Ownership survives changes to the design or regenerated instance counts. */
  owners: Map<string, string>
}

const emptyMask = (): ViewMask => ({
  hidden: [],
  hiddenStones: [],
  hiddenParts: [],
  owners: new Map(),
})
const maskOf = ({ hidden, hiddenStones, hiddenParts, owners }: ViewMask): ViewMask => ({
  hidden,
  hiddenStones,
  hiddenParts,
  owners,
})

function updateMask(mask: ViewMask, targets: readonly NodePick[], hide: boolean): ViewMask {
  const nodes = new Set(mask.hidden),
    stones = new Set(mask.hiddenStones),
    parts = new Set(mask.hiddenParts)
  const owners = new Map(mask.owners)
  for (const { nodeId, stoneId, partId } of targets) {
    const key = stoneId ?? partId ?? nodeId
    const set = stoneId ? stones : partId ? parts : nodes
    if (hide) {
      set.add(key)
      if (stoneId || partId) owners.set(key, nodeId)
    } else {
      set.delete(key)
      if (stoneId || partId) owners.delete(key)
    }
  }
  return { hidden: [...nodes], hiddenStones: [...stones], hiddenParts: [...parts], owners }
}

export function targetHidden(
  mask: Pick<ViewMask, 'hidden' | 'hiddenStones' | 'hiddenParts'>,
  target: NodePick,
) {
  return (
    mask.hidden.includes(target.nodeId) ||
    (!!target.stoneId && mask.hiddenStones.includes(target.stoneId)) ||
    (!!target.partId && mask.hiddenParts.includes(target.partId))
  )
}

function retainedMask(
  mask: ViewMask,
  exists: (id: string) => boolean,
  live?: ReadonlySet<string>,
): ViewMask {
  const keep = (id: string) => exists(mask.owners.get(id) ?? id)
  const removed: NodePick[] = [
    ...mask.hidden.filter((id) => !exists(id)).map((nodeId) => ({ nodeId })),
    ...mask.hiddenStones
      .filter((id) => !keep(id) || (live && !live.has(id)))
      .map((stoneId) => ({ nodeId: mask.owners.get(stoneId)!, stoneId })),
    ...mask.hiddenParts
      .filter((id) => !keep(id))
      .map((partId) => ({ nodeId: mask.owners.get(partId)!, partId })),
  ]
  return removed.length ? updateMask(mask, removed, false) : mask
}

interface WorkspaceState extends ViewMask {
  pieceId: string | null
  selection: string[]
  /** The evaluated component under a direct viewport click. */
  stone: string | null
  part: string | null
  hover: NodePick | null
  /** Hidden in this view only: unlike "Exclude from piece", weight and exports are unchanged. */
  curveVisibilityStarted: boolean
  startCurveVisibility(ids: readonly string[]): void
  isolated: NodePick[]
  beforeIsolation: ViewMask | null
  backdrop: 'studio' | 'dark'
  setBackdrop(value: 'studio' | 'dark'): void
  renaming: string | null
  display: DisplayMode
  /** The designer picked a display mode (so a software GPU does not switch it to clay). */
  displayChosen: boolean
  xray: boolean
  fineTune: boolean
  /** The system ring sizes are read and picked in; null = each band's own. */
  ringSystem: RingSizeSystem | null
  /** Set when the GPU cannot run the full material shaders. */
  simplified: boolean
  /** How wheel input is read; `auto` tells a mouse from a trackpad per gesture. */
  wheel: WheelDevice
  open(pieceId: string): void
  select(ids: string[], stone?: string | null, part?: string | null): void
  /** A direct click keeps the exact component hit. Additive clicks select features. */
  pick(p: NodePick | null, additive?: boolean): void
  /** A right-click on a feature (or empty space): see `menuSelection`. Returns what the menu acts on. */
  selectForMenu(nodeId: string | null, stoneId?: string | null, partId?: string | null): string[]
  /**
   * Forgets features that are no longer in the design (an undo took back an addition, a teammate
   * or the assistant deleted one): they leave the selection, the hover and a rename in progress.
   */
  retain(exists: (nodeId: string) => boolean, liveComponents?: ReadonlySet<string>): void
  setHover(p: NodePick | null): void
  toggleHidden(id: string): void
  toggleTarget(target: NodePick): void
  setTargetsHidden(targets: readonly NodePick[], hide: boolean): void
  isolateTargets(targets: readonly NodePick[]): void
  exitIsolation(): void
  showAll(): void
  setRenaming(id: string | null): void
  setDisplay(mode: DisplayMode, chosen?: boolean): void
  toggleXray(): void
  setFineTune(on: boolean): void
  setRingSystem(system: RingSizeSystem | null): void
  setSimplified(on: boolean): void
  setWheel(device: WheelDevice): void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The selection after a right-click, as in every CAD tool: on a feature already selected it
 * stays as it is, so Hide and Delete in the menu act on all of it; on anything else it becomes
 * that feature (or nothing, for empty space), so the menu and the highlight agree.
 */
export const menuSelection = (selection: readonly string[], nodeId: string | null): string[] =>
  nodeId === null ? [] : selection.includes(nodeId) ? [...selection] : [nodeId]

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      pieceId: null,
      selection: [],
      stone: null,
      part: null,
      hover: null,
      ...emptyMask(),
      curveVisibilityStarted: false,
      startCurveVisibility: (ids) => {
        if (!get().curveVisibilityStarted && ids.length)
          set({
            ...updateMask(
              get(),
              ids.map((nodeId) => ({ nodeId })),
              true,
            ),
            curveVisibilityStarted: true,
          })
      },
      isolated: [],
      beforeIsolation: null,
      backdrop: 'studio',
      setBackdrop: (backdrop) => set({ backdrop }),
      renaming: null,
      display: 'rendered',
      displayChosen: false,
      xray: false,
      fineTune: false,
      ringSystem: null,
      simplified: false,
      wheel: 'auto',
      open: (pieceId) => {
        if (get().pieceId !== pieceId)
          set({
            pieceId,
            selection: [],
            stone: null,
            part: null,
            hover: null,
            ...emptyMask(),
            curveVisibilityStarted: false,
            isolated: [],
            beforeIsolation: null,
            renaming: null,
          })
      },
      select: (ids, stone = null, part = null) => {
        const s = get()
        if (same(s.selection, ids) && s.stone === stone && s.part === part) return
        set({ selection: ids, stone, part })
      },
      pick: (p, additive) => {
        const s = get()
        if (!p) return s.select([])
        if (additive) {
          const has = s.selection.includes(p.nodeId)
          return s.select(
            has ? s.selection.filter((x) => x !== p.nodeId) : [...s.selection, p.nodeId],
          )
        }
        s.select([p.nodeId], p.stoneId ?? null, p.partId ?? null)
      },
      selectForMenu: (nodeId, stoneId = null, partId = null) => {
        const s = get()
        const ids = menuSelection(s.selection, nodeId)
        if (nodeId && (stoneId || partId)) s.select([nodeId], stoneId, partId)
        else s.select(ids)
        return get().selection
      },
      retain: (exists, live) => {
        const s = get()
        const selection = s.selection.filter(exists)
        const next: Partial<WorkspaceState> = {}
        // A picked stone belongs to the one selected feature.
        if (selection.length !== s.selection.length) Object.assign(next, { selection, stone: null })
        if (s.hover && !exists(s.hover.nodeId)) next.hover = null
        if (s.renaming && !exists(s.renaming)) next.renaming = null
        const valid = (p: NodePick) =>
          exists(p.nodeId) && (!live || !p.stoneId || live.has(p.stoneId))
        if (s.hover && !valid(s.hover)) next.hover = null
        if ((!selection.length && (s.stone || s.part)) || (s.stone && live && !live.has(s.stone)))
          Object.assign(next, { stone: null, part: null })
        const isolated = s.isolated.filter(valid)
        let mask: ViewMask = s
        if (isolated.length !== s.isolated.length) {
          next.isolated = isolated
          if (!isolated.length && s.beforeIsolation) {
            mask = s.beforeIsolation
            next.beforeIsolation = null
          }
        }
        const cleaned = retainedMask(mask, exists, live)
        if (cleaned !== s) Object.assign(next, maskOf(cleaned))
        if (s.beforeIsolation && next.beforeIsolation !== null) {
          const prior = retainedMask(s.beforeIsolation, exists, live)
          if (prior !== s.beforeIsolation) next.beforeIsolation = prior
        }
        if (Object.keys(next).length) set(next)
      },
      setHover: (hover) => {
        const h = get().hover
        if (
          h?.nodeId === hover?.nodeId &&
          h?.stoneId === hover?.stoneId &&
          h?.partId === hover?.partId
        )
          return
        set({ hover })
      },
      toggleHidden: (id) => get().toggleTarget({ nodeId: id }),
      toggleTarget: (target) => get().setTargetsHidden([target], !targetHidden(get(), target)),
      setTargetsHidden: (targets, hide) => {
        const s = get()
        // Revealing a child also restores visibility of its containing feature.
        const changed = hide
          ? targets
          : targets.flatMap((t) => (t.stoneId || t.partId ? [t, { nodeId: t.nodeId }] : [t]))
        const mask = updateMask(s, changed, hide)
        if (s.beforeIsolation && s.isolated.every((t) => targetHidden(mask, t))) {
          set({
            ...updateMask(s.beforeIsolation, changed, hide),
            isolated: [],
            beforeIsolation: null,
          })
        } else set(mask)
      },
      isolateTargets: (targets) => {
        if (!targets.length) return
        const s = get()
        const prior = s.beforeIsolation ?? maskOf(s)
        const reveal = targets.flatMap((t) =>
          t.stoneId || t.partId ? [t, { nodeId: t.nodeId }] : [t],
        )
        set({ ...updateMask(prior, reveal, false), isolated: [...targets], beforeIsolation: prior })
      },
      exitIsolation: () => {
        const prior = get().beforeIsolation
        if (prior) set({ ...prior, isolated: [], beforeIsolation: null })
      },
      showAll: () => set({ ...emptyMask(), isolated: [], beforeIsolation: null }),
      setRenaming: (renaming) => set({ renaming }),
      setDisplay: (display, chosen = true) =>
        set((s) => ({ display, displayChosen: s.displayChosen || chosen })),
      toggleXray: () => set((s) => ({ xray: !s.xray })),
      setFineTune: (fineTune) => set({ fineTune }),
      setRingSystem: (ringSystem) => set({ ringSystem }),
      setSimplified: (simplified) => set({ simplified }),
      setWheel: (wheel) => set({ wheel }),
    }),
    {
      name: 'pave:cad',
      partialize: (s) => ({
        backdrop: s.backdrop,
        display: s.display,
        displayChosen: s.displayChosen,
        fineTune: s.fineTune,
        ringSystem: s.ringSystem,
        wheel: s.wheel,
      }),
    },
  ),
)

export function selectedTargets(
  s: Pick<WorkspaceState, 'selection' | 'stone' | 'part'>,
): NodePick[] {
  return s.selection.map((nodeId) =>
    s.selection.length === 1
      ? { nodeId, ...(s.stone && { stoneId: s.stone }), ...(s.part && { partId: s.part }) }
      : { nodeId },
  )
}
