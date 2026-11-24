/**
 * The checks list as a person reads it: problems first, then warnings, the same finding on one
 * feature counted once, and messages that name features rather than their internal ids.
 */
import type { Diagnostic } from '@pave/kernel'
import { type Design, nodeTitle } from '@pave/schema'

export interface Issue {
  d: Diagnostic
  /** How many identical findings this stands for (one per stone of a pavé field, say). */
  count: number
}

/**
 * Problems first, then warnings; the same finding on one feature (one per stone of a pavé
 * field, say) counts once, showing the first instance. Information never counts.
 */
export function toIssues(ds: readonly Diagnostic[]): Issue[] {
  const groups = new Map<string, Issue>()
  for (const d of ds) {
    if (d.level === 'info') continue
    const key = `${d.level}|${d.code}|${d.nodeId ?? ''}`
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { d, count: 1 })
  }
  return [...groups.values()].toSorted((a, b) =>
    a.d.level === b.d.level ? 0 : a.d.level === 'error' ? -1 : 1,
  )
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A kernel message with node ids replaced by the features' names — `halo_x1:1` becomes
 * "Halo, stone 2" — and the "(worst: …)" detail, which only names an instance, dropped. Ids
 * can be ordinary words ("band", "row"), so a bare word is only read as an id when it is
 * quoted, carries a stone index or has the generated `kind_suffix` shape.
 */
export function readableMessage(message: string, design: Design): string {
  const ids = Object.keys(design.nodes).toSorted((a, b) => b.length - a.length)
  if (!ids.length) return message
  const token = new RegExp(`(["“])?\\b(${ids.map(escape).join('|')})\\b(?::(\\d+))?`, 'g')
  return message
    .replace(/\s*\(worst:[^)]*\)/g, '')
    .replace(token, (match, quote: string | undefined, id: string, index: string | undefined) => {
      if (!quote && index === undefined && !id.includes('_')) return match
      const name = nodeTitle(design.nodes[id]!)
      return `${quote ?? ''}${index === undefined ? name : `${name}, stone ${Number(index) + 1}`}`
    })
}
