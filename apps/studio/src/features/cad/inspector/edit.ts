/**
 * How inspector controls change the node they show. One object per inspected node, built by
 * the Inspector from the session; widgets receive it and never touch the session directly.
 */
import { type Design, describeNode, type Node, type NodeKind } from '@pave/schema'
import { createContext, use, useMemo } from 'react'
import type { DesignSession } from '../../../lib/design-session/store'
import { setField, switchVariant } from '../ops'

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

/**
 * The edit object for one node, wired to the session: previews and commits go through one
 * gesture per field path, so a scrub becomes one labelled change.
 */
export function useNodeEdit(
  node: Node | undefined,
  design: Design,
  session: DesignSession | null,
  readOnly: boolean,
  priorValues: Record<string, Record<string, unknown>> | null,
): FieldEdit | null {
  return useMemo(() => {
    if (!node) return null
    const key = (path: readonly string[]) => `${node.id}.${path.join('.')}`
    return {
      node,
      design,
      readOnly: readOnly || !session,
      preview: (path, value) => session?.preview(key(path), [setField(node.id, path, value)]),
      commit: (path, value) => {
        // The released value wins over the last preview; one gesture becomes one change.
        session?.preview(key(path), [setField(node.id, path, value)])
        session?.commitGesture()
      },
      switchVariant: (path, next) => {
        const { ops, missing } = switchVariant(design, node, path, next)
        if (ops.length) session?.commit(ops)
        const needs = missing.map((m) =>
          m.refKinds
            ? m.refKinds.map((k) => describeNode(k as NodeKind).title.toLowerCase()).join(' or ')
            : m.title,
        )
        return needs.length ? `Add a ${needs.join(', ')} first.` : null
      },
      prior: (path) => {
        const before = priorValues?.[node.id]
        return before && path.length && path[0]! in before
          ? { changed: true, value: before[path[0]!] }
          : { changed: false, value: undefined }
      },
    }
  }, [node, design, session, readOnly, priorValues])
}
