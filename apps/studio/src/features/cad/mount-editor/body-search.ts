import { nodeTitle } from '@pave/schema'
import type { ImportedMesh } from '../mesh-edit/model'

export function filterMountBodies(bodies: readonly ImportedMesh[], query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return bodies
  return bodies.filter((body) => {
    const { rhinoLayer, rhinoContext } = body.source
    const fields = [
      nodeTitle(body),
      rhinoLayer,
      ...(rhinoContext?.groups.map((group) => group.name) ?? []),
    ]
    const text = fields.join(' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}
