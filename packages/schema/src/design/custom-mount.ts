import type { Design } from './design'
import { stoneFitTargetError } from './intents'
import { importRoleOf, type MountFit, type NodeOf } from './nodes'

export type MountMember = NodeOf<'meshBody'> & {
  source: Extract<NodeOf<'meshBody'>['source'], { type: 'asset' }>
}

/** The source mesh supplies both the original control box and the project millimetre frame. */
export function customMountPartIssue(design: Design, id: string): string | undefined {
  const n = Object.hasOwn(design.nodes, id) ? design.nodes[id] : undefined
  if (n?.kind !== 'meshBody' || n.source.type !== 'asset' || !n.keepSourcePlacement)
    return 'Choose an imported mount part that keeps its source size and position.'
  const role = importRoleOf(n)
  if (role === 'stone') return 'This part is a stone. Choose its surrounding metal.'
  if (role === 'setting')
    return 'This part already belongs to a replacement head. Detach the head in Review materials before editing the original mounting.'
  if (n.flatBack || n.hollow || n.smooth || n.detail !== 1)
    return 'Restore the original mesh shaping options before measuring a control box for this part.'
  if (
    Object.values(design.nodes).some(
      (other) =>
        (other.kind === 'group' && other.children.includes(id)) ||
        (other.kind === 'pattern' && other.sources.includes(id)) ||
        (other.kind === 'boolean' && (other.tools.includes(id) || other.target === id)),
    )
  )
    return 'This part is used by a group, pattern or boolean. Choose an independent mount member.'
}

export function customMountStoneIssue(design: Design, id: string): string | undefined {
  const gem = Object.hasOwn(design.nodes, id) ? design.nodes[id] : undefined
  if (
    gem?.kind !== 'gem' ||
    !gem.importSourceId ||
    !gem.importSourceFit ||
    gem.placement.type !== 'free'
  )
    return 'Choose a confirmed imported stone in this project with original measurements and a girdle frame.'
  if (Object.values(design.nodes).some((n) => n.kind === 'group' && n.children.includes(id)))
    return 'Choose an independent stone outside a transformed group.'
  return stoneFitTargetError(design, id)
}

export function customMountFitForStone(design: Design, id: string): MountFit {
  const issue = customMountStoneIssue(design, id)
  if (issue) throw new Error(issue)
  const gem = design.nodes[id] as NodeOf<'gem'>
  const source = gem.importSourceFit!
  // Imported geometry with no original transform was recorded in the untransformed world frame.
  return {
    gem: id,
    base: { width: source.width, length: source.length, depth: source.depth },
    frame: {
      position: source.transform?.position ?? [0, 0, 0],
      rotation: source.transform?.rotation ?? [0, 0, 0],
    },
  }
}
