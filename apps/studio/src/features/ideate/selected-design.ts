import type { Piece } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Choice = { boardId: string; referenceId: string; assetId?: string }

/** An explicit Design selection takes priority over the project's saved Home visual. */
export function selectedDesignFor(piece: Piece | undefined, choice: Choice | null | undefined) {
  if (choice !== undefined) return choice
  const saved = piece?.intake?.selection
  return saved?.visualId && saved.visualAssetId
    ? { boardId: saved.boardId, referenceId: saved.visualId, assetId: saved.visualAssetId }
    : null
}

export const useSelectedDesign = create<{
  projects: Record<string, Choice | null>
  choose: (pieceId: string, choice: Choice | null) => void
}>()(
  persist(
    (set) => ({
      projects: {},
      choose: (pieceId, choice) =>
        set((state) => ({ projects: { ...state.projects, [pieceId]: choice } })),
    }),
    { name: 'pave:selected-design', partialize: ({ projects }) => ({ projects }) },
  ),
)
