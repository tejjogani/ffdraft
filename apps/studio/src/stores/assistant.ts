/**
 * The assistant dock's client state: open or not, which conversation, the composer's draft and
 * context chips, and what the assistant is doing right now (read by the CAD workspace for its
 * "Assistant is working" pill and tint). The server owns threads, messages and runs; nothing
 * here is a copy of them.
 *
 * Public API for anything that hands work to the assistant (Ask AI on a part, a stage button,
 * an open question on the spec): {@link openAssistant}, and `assistant.open/close/toggle`.
 */
import type { AssistantTier } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Rect } from '../lib/float-window'

/**
 * Where the assistant lives while open: snapped into the right-hand sidebar (pushing the page
 * aside), or a floating glass window over the work. Either can be collapsed to a small pill.
 */
export type AssistantLayout = 'docked' | 'floating'

/** What a conversation is about; the assistant's tools default to it. Mirrors `Thread.context`. */
export interface AssistantContext {
  pieceId?: string | null
  boardId?: string | null
}

/** A photo attached in the composer, uploaded already. */
export interface Attachment {
  id: string
  name: string
}

/** Parts of a piece the person pointed at, sent as the message's selection. */
export interface SelectionChip {
  pieceId: string
  /** Node ids, or `nodeId:index` for one stone of a row (as the CAD workspace selects them). */
  nodeIds: string[]
}

/** The assistant at work on a piece, for the CAD workspace's pill and touched-node tint. */
export interface Activity {
  pieceId: string
  runId: string
  /** Nodes its edits touched in this run, newest last. */
  nodeIds: string[]
  /** What it is doing, e.g. "Editing the design". */
  label: string
}

/** Kept for older call sites: a prompt and context handed to the dock. */
export interface AssistantRequest {
  prompt?: string
  context?: AssistantContext
  /** Asset ids of attached photos. */
  attachments?: string[]
}

interface AssistantState {
  isOpen: boolean
  /** Docked width. */
  width: number
  layout: AssistantLayout
  /** Folded to a pill that shows a running job's progress; open again with a click or mod+j. */
  collapsed: boolean
  /** The floating window's place and size, remembered; null until it first floats. */
  rect: Rect | null
  /** The conversation shown; null for a new one. */
  activeThreadId: string | null
  /** Thread list instead of the conversation. */
  showThreads: boolean
  draft: string
  attachments: Attachment[]
  selection: SelectionChip | null
  /** The page's piece or board was removed from this message's context by the person. */
  dropPageContext: boolean
  /** The tier picked for a new conversation, and for each conversation since. */
  tierByThread: Record<string, AssistantTier>
  draftTier: AssistantTier | null
  /** Bumped to move focus into the composer. */
  focusNonce: number
  /** Photos sent with each run's message (this session only: the server keeps the pixels, not the ids). */
  sentPhotos: Record<string, string[]>
  activity: Activity | null
  /** What the CAD workspace has selected now, so mod+j can bring it along. */
  liveSelection: SelectionChip | null
  /** The piece the shown conversation is about, as the panel last loaded it. */
  threadPieceId: string | null
  /**
   * A conversation started from Home: the window follows to the piece it makes, but only if the
   * person is still where they sent it from.
   */
  follow: { threadId: string; path: string } | null

  open: (request?: AssistantRequest) => void
  close: () => void
  toggle: () => void
  setWidth: (width: number) => void
  /** Pull it out of the sidebar (at `rect`, or where it floated last) or snap it back in. */
  setLayout: (layout: AssistantLayout, rect?: Rect) => void
  setRect: (rect: Rect) => void
  setCollapsed: (collapsed: boolean) => void
  setDraft: (draft: string) => void
  addAttachments: (a: Attachment[]) => void
  removeAttachment: (id: string) => void
  setSelection: (s: SelectionChip | null) => void
  setDropPageContext: (drop: boolean) => void
  setTier: (threadId: string | null, tier: AssistantTier) => void
  openThread: (threadId: string | null) => void
  setShowThreads: (show: boolean) => void
  /** After a send: the composer is cleared and the conversation is the one it went to. */
  sent: (threadId: string, runId: string, photos: string[], tier: AssistantTier | null) => void
  focusComposer: () => void
  setActivity: (a: Activity | null) => void
  setLiveSelection: (s: SelectionChip | null) => void
  setThreadPieceId: (id: string | null) => void
}

export const DOCK_MIN = 320
export const DOCK_MAX = 640

export const useAssistant = create<AssistantState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      width: 380,
      layout: 'docked',
      collapsed: false,
      rect: null,
      activeThreadId: null,
      showThreads: false,
      draft: '',
      attachments: [],
      selection: null,
      dropPageContext: false,
      tierByThread: {},
      draftTier: null,
      focusNonce: 0,
      sentPhotos: {},
      activity: null,
      liveSelection: null,
      threadPieceId: null,
      follow: null,

      open: (request) => {
        const patch: Partial<AssistantState> = {
          isOpen: true,
          collapsed: false,
          focusNonce: get().focusNonce + 1,
        }
        if (request?.prompt !== undefined) patch.draft = request.prompt
        if (request?.attachments?.length)
          patch.attachments = request.attachments.map((id) => ({ id, name: 'Photo' }))
        // A request about another piece starts a new conversation about it.
        if (request?.context?.pieceId) {
          patch.dropPageContext = false
          patch.showThreads = false
        }
        set(patch)
      },
      close: () => set({ isOpen: false, collapsed: false }),
      // A pill opens again; an open window closes; a closed one opens where it was.
      toggle: () =>
        set((s) =>
          s.isOpen && s.collapsed
            ? { collapsed: false, focusNonce: s.focusNonce + 1 }
            : { isOpen: !s.isOpen, collapsed: false, focusNonce: s.focusNonce + 1 },
        ),
      setWidth: (width) =>
        set({ width: Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, width))) }),
      setLayout: (layout, rect) =>
        set((s) => ({ layout, collapsed: false, rect: rect ?? s.rect, isOpen: true })),
      setRect: (rect) => set({ rect }),
      setCollapsed: (collapsed) =>
        set((s) => ({ collapsed, focusNonce: collapsed ? s.focusNonce : s.focusNonce + 1 })),
      setDraft: (draft) => set({ draft }),
      addAttachments: (a) => set((s) => ({ attachments: [...s.attachments, ...a].slice(0, 8) })),
      removeAttachment: (id) =>
        set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
      setSelection: (selection) => set({ selection }),
      setDropPageContext: (dropPageContext) => set({ dropPageContext }),
      setTier: (threadId, tier) =>
        set((s) =>
          threadId
            ? { tierByThread: { ...s.tierByThread, [threadId]: tier } }
            : { draftTier: tier },
        ),
      openThread: (activeThreadId) =>
        set((s) => ({ activeThreadId, showThreads: false, focusNonce: s.focusNonce + 1 })),
      setShowThreads: (showThreads) => set({ showThreads }),
      sent: (threadId, runId, photos, tier) =>
        set((s) => ({
          activeThreadId: threadId,
          showThreads: false,
          draft: '',
          attachments: [],
          selection: null,
          dropPageContext: false,
          draftTier: null,
          tierByThread: tier ? { ...s.tierByThread, [threadId]: tier } : s.tierByThread,
          sentPhotos: photos.length ? { ...s.sentPhotos, [runId]: photos } : s.sentPhotos,
        })),
      focusComposer: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
      setActivity: (activity) => set({ activity }),
      setLiveSelection: (liveSelection) => set({ liveSelection }),
      setThreadPieceId: (threadPieceId) => set({ threadPieceId }),
    }),
    {
      name: 'pave:assistant',
      partialize: persistedAssistant,
    },
  ),
)

/**
 * What survives a reload: whether it was open, where it lived (docked or floating, its place
 * and size, folded to a pill), the conversation and the tiers. Drafts and selections do not.
 */
export function persistedAssistant(s: AssistantState) {
  return {
    isOpen: s.isOpen,
    width: s.width,
    layout: s.layout,
    collapsed: s.collapsed,
    rect: s.rect,
    activeThreadId: s.activeThreadId,
    tierByThread: s.tierByThread,
  }
}

/** The assistant takes a column of the page (so the page header leaves room for it). */
export const isDockedOpen = (s: Pick<AssistantState, 'isOpen' | 'layout' | 'collapsed'>) =>
  s.isOpen && s.layout === 'docked' && !s.collapsed

/**
 * Opens the dock about a piece, with parts of it as a context chip and the composer focused:
 * the entry point for "Ask AI" on a selection.
 *
 *   openAssistant({ pieceId, selection: ['center', 'halo'], draft: 'Make these smaller' })
 *
 * A conversation about another piece is left for a new one; one about this piece carries on.
 */
export function openAssistant(input: {
  pieceId: string
  selection?: string[]
  draft?: string
  /** Carry on this conversation instead (e.g. a job's thread). */
  threadId?: string
}): void {
  const s = useAssistant.getState()
  useAssistant.setState({
    isOpen: true,
    collapsed: false,
    showThreads: false,
    dropPageContext: false,
    activeThreadId: input.threadId ?? (s.threadPieceId === input.pieceId ? s.activeThreadId : null),
    selection: input.selection?.length
      ? { pieceId: input.pieceId, nodeIds: input.selection }
      : null,
    draft: input.draft ?? s.draft,
    focusNonce: s.focusNonce + 1,
  })
}

/** Imperative API: `assistant.open({ prompt, context })`, `assistant.toggle()`. */
export const assistant = {
  open: (request?: AssistantRequest) => useAssistant.getState().open(request),
  close: () => useAssistant.getState().close(),
  /**
   * Opens with whatever the CAD workspace has selected as a context chip (mod+j), opens the
   * pill again, or closes.
   */
  toggle: () => {
    const s = useAssistant.getState()
    if (s.isOpen && s.collapsed) return s.setCollapsed(false)
    if (s.isOpen) return s.close()
    const live = s.liveSelection
    if (live?.nodeIds.length) openAssistant({ pieceId: live.pieceId, selection: live.nodeIds })
    else s.toggle()
  },
}
