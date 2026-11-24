/**
 * How inspector controls change the node they show. One object per inspected node, built by
 * the Inspector from the session; widgets receive it and never touch the session directly.
 */
import type { Design, Node } from '@pave/schema'
import { createContext, use } from 'react'

export interface FieldEdit {
  node: Node
  design: Design
  /** Shows a value live (a scrub) without recording it. */
  preview(path: readonly string[], value: unknown): void
  /** Records a value as one change, or ends the live preview of `path` as one change. */
  commit(path: readonly string[], value: unknown): void
  /** Switches a choice of variants; returns what is missing when it cannot. */
  switchVariant(path: readonly string[], next: string): string | null
  /** The value before the assistant's latest run changed this field, if it did. */
  prior(path: readonly string[]): { changed: boolean; value: unknown }
  readOnly: boolean
}

export const FieldEditContext = createContext<FieldEdit | null>(null)

export function useFieldEdit(): FieldEdit {
  const edit = use(FieldEditContext)
  if (!edit) throw new Error('useFieldEdit outside an inspector')
  return edit
}
