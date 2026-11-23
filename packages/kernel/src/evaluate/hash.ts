/** Content hashes for memoising node builds. */
import type { Node } from '@pave/schema'

/** cyrb53: a fast 53-bit string hash; collisions are irrelevant at the scale of one design. */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// Design edits replace only the nodes they touch, so untouched nodes keep their identity and
// their hash is computed once.
const byIdentity = new WeakMap<Node, string>()

export function hashNode(node: Node): string {
  let hash = byIdentity.get(node)
  if (hash === undefined) {
    hash = hashString(JSON.stringify(node))
    byIdentity.set(node, hash)
  }
  return hash
}

export const combineHashes = (parts: readonly string[]): string => hashString(parts.join('|'))
