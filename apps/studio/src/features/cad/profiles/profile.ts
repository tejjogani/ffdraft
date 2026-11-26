import { type DrawnProfile, type Node, type NodeOf, newId } from '@pave/schema'

export type ProfileNode = NodeOf<'vectorBody'> & { source: DrawnProfile }

export function isProfileNode(node: Node | undefined): node is ProfileNode {
  return node?.kind === 'vectorBody' && node.source.type === 'profile'
}

export function profileNode(source: DrawnProfile, thickness: number) {
  return {
    id: newId('vectorBody'),
    name: 'Profile extrusion',
    kind: 'vectorBody' as const,
    source,
    thickness,
    bevel: 'flat' as const,
  }
}

export function profileSize(source: DrawnProfile): [number, number] {
  const u = source.points.map(([x]) => x)
  const v = source.points.map(([, y]) => y)
  return [Math.max(...u) - Math.min(...u), Math.max(...v) - Math.min(...v)]
}
