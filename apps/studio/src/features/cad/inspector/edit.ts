/**
 * How inspector controls change the node they show. One object per inspected node, built by
 * the Inspector from the session; widgets receive it and never touch the session directly.
 */
import {
  applyOps,
  type Design,
  describeNode,
  labelForOps,
  type Node,
  type NodeKind,
} from '@pave/schema'
import { createContext, use, useMemo } from 'react'
import type { DesignSession } from '../../../lib/design-session/store'
import { setField, switchVariant } from '../ops'

export interface PriorValue {
  changed: boolean
  /** What the assistant's change did to this field, e.g. "Ring size US 6 → US 7". */
  label?: string
}

export interface FieldEdit {
  node: Node
  design: Design
  /** Shows a value live (a scrub, typing) without recording it. */
  preview(path: readonly string[], value: unknown): void
  /**
   * Records a value as one change, ending the live preview of `path` (if any) with it. A value
   * equal to where the field started records nothing.
   */
  commit(path: readonly string[], value: unknown): void
  /** Drops the live preview of `path` (Escape), back to the recorded value. */
  cancel(path: readonly string[]): void
  /** Switches a choice of variants; returns what is missing when it cannot. */
  switchVariant(path: readonly string[], next: string): string | null
  /** Whether the assistant's latest run changed this exact field, and how. */
  prior(path: readonly string[]): PriorValue
  /** Viewers (and a window without a session) see the controls but every write is a no-op. */
  readOnly: boolean
}

export const FieldEditContext = createContext<FieldEdit | null>(null)

export function useFieldEdit(): FieldEdit {
  const edit = use(FieldEditContext)
  if (!edit) throw new Error('useFieldEdit outside an inspector')
  return edit
}

const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (v, k) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined),
    value,
  )

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The edit object for one node, wired to the session: previews and commits go through one
 * gesture per field path, so a scrub becomes one labelled change.
 */
export function createFieldEdit(
  node: Node,
  design: Design,
  session: DesignSession | null,
  readOnly: boolean,
  priorValues: Record<string, Record<string, unknown>> | null,
): FieldEdit {
  const key = (path: readonly string[]) => `${node.id}.${path.join('.')}`
  const locked = readOnly || !session
  const gestureOn = (path: readonly string[]) => session?.get().gesture?.key === key(path)
  return {
    node,
    design,
    readOnly: locked,
    preview: (path, value) => {
      if (!locked) session!.preview(key(path), [setField(node.id, path, value)])
    },
    commit: (path, value) => {
      if (locked) return
      // The released value wins over the last preview; one gesture becomes one change, and a
      // gesture back at its starting value is dropped by the session.
      session!.preview(key(path), [setField(node.id, path, value)])
      session!.commitGesture()
    },
    cancel: (path) => {
      if (!locked && gestureOn(path)) session!.cancelGesture()
    },
    switchVariant: (path, next) => {
      if (locked) return null
      const { ops, missing } = switchVariant(design, node, path, next)
      if (ops.length) session!.commit(ops)
      const needs = missing.map((m) =>
        m.refKinds
          ? m.refKinds.map((k) => describeNode(k as NodeKind).title.toLowerCase()).join(' or ')
          : m.title,
      )
      return needs.length ? `Add a ${needs.join(', ')} first.` : null
    },
    prior: (path) => {
      const before = priorValues?.[node.id]
      if (!before || !path.length || !(path[0]! in before)) return { changed: false }
      const was = at(before[path[0]!], path.slice(1))
      const now = at(node, path)
      if (same(was, now)) return { changed: false }
      try {
        const then = applyOps(design, [setField(node.id, path, was)]).design
        return { changed: true, label: labelForOps([setField(node.id, path, now)], then) }
      } catch {
        return { changed: true }
      }
    },
  }
}

export function useNodeEdit(
  node: Node | undefined,
  design: Design,
  session: DesignSession | null,
  readOnly: boolean,
  priorValues: Record<string, Record<string, unknown>> | null,
): FieldEdit | null {
  return useMemo(
    () => (node ? createFieldEdit(node, design, session, readOnly, priorValues) : null),
    [node, design, session, readOnly, priorValues],
  )
}
