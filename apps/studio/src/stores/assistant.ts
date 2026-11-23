import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** What a conversation is about; the assistant's tools default to it. Mirrors `Thread.context`. */
export interface AssistantContext {
  pieceId?: string | null
  boardId?: string | null
}

export interface AssistantRequest {
  /** A prompt to send as soon as the panel is ready. */
  prompt?: string
  context?: AssistantContext
  /** Asset ids of attached references. */
  attachments?: string[]
}

interface AssistantState {
  isOpen: boolean
  width: number
  /** The latest request from outside the panel; `id` changes on every `open` call. */
  request: (AssistantRequest & { id: number }) | null
  open: (request?: AssistantRequest) => void
  close: () => void
  toggle: () => void
  setWidth: (width: number) => void
  /** The panel calls this once it has taken the request, so it is not replayed. */
  clearRequest: () => void
}

export const DOCK_MIN = 320
export const DOCK_MAX = 640
let seq = 0

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      isOpen: false,
      width: 380,
      request: null,
      open: (request) => set({ isOpen: true, request: request ? { ...request, id: ++seq } : null }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width: Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, width))) }),
      clearRequest: () => set({ request: null }),
    }),
    { name: 'pave:assistant', partialize: (s) => ({ isOpen: s.isOpen, width: s.width }) },
  ),
)

/**
 * Imperative API for anything that wants to hand work to the assistant:
 * `assistant.open({ prompt: '1.5 ct oval…', context: { pieceId } })`.
 */
export const assistant = {
  open: (request?: AssistantRequest) => useAssistant.getState().open(request),
  close: () => useAssistant.getState().close(),
  toggle: () => useAssistant.getState().toggle(),
}
