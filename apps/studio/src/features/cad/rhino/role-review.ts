export interface RhinoStoneMeasurements {
  width: number
  length: number
  depth: number
  girdle: [number, number, number]
  rotation: [number, number, number]
}

export const STONE_FIELD_KEYS = [
  'width',
  'length',
  'depth',
  'x',
  'y',
  'z',
  'rx',
  'ry',
  'rz',
] as const
export type RhinoStoneField = (typeof STONE_FIELD_KEYS)[number]
export type RhinoStoneFields = Record<RhinoStoneField, string>

export function rhinoStoneFields(measurements?: RhinoStoneMeasurements): RhinoStoneFields {
  const values = measurements && [
    measurements.width,
    measurements.length,
    measurements.depth,
    ...measurements.girdle,
    ...measurements.rotation,
  ]
  return Object.fromEntries(
    STONE_FIELD_KEYS.map((key, index) => [key, values ? String(values[index]) : '']),
  ) as RhinoStoneFields
}

export function parseRhinoStoneFields(
  fields: RhinoStoneFields,
): RhinoStoneMeasurements | undefined {
  const values = STONE_FIELD_KEYS.map((key) => (fields[key].trim() ? Number(fields[key]) : NaN))
  if (!values.every(Number.isFinite)) return undefined
  const [width, length, depth, x, y, z, rx, ry, rz] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  if (width <= 0 || length <= 0 || depth <= 0) return undefined
  return { width, length, depth, girdle: [x, y, z], rotation: [rx, ry, rz] }
}

interface PlacedBody {
  id: string
  groups: readonly string[]
  placement: readonly string[]
}

/** A group can span multiple occurrences. Pair only within the same occurrence, in both directions. */
export function uniqueRhinoHeadPairs(stones: readonly PlacedBody[], heads: readonly PlacedBody[]) {
  const groupKey = (body: PlacedBody, group: string) => JSON.stringify([group, ...body.placement])
  const headsByGroup = new Map<string, string[]>()
  for (const head of heads) {
    for (const group of head.groups) {
      const key = groupKey(head, group)
      const members = headsByGroup.get(key) ?? []
      members.push(head.id)
      headsByGroup.set(key, members)
    }
  }
  const candidates = new Map<string, Set<string>>()
  const headUse = new Map<string, number>()
  for (const stone of stones) {
    const matches = new Set(
      stone.groups.flatMap((group) => headsByGroup.get(groupKey(stone, group)) ?? []),
    )
    matches.delete(stone.id)
    candidates.set(stone.id, matches)
    for (const head of matches) headUse.set(head, (headUse.get(head) ?? 0) + 1)
  }
  const pairs = new Map<string, string>()
  for (const [stone, matches] of candidates) {
    const [head] = matches
    if (matches.size === 1 && head && headUse.get(head) === 1) pairs.set(stone, head)
  }
  return pairs
}

export function selectedRhinoPeers(
  ids: readonly string[],
  isolated: ReadonlySet<string>,
  overrides: ReadonlyMap<string, boolean>,
) {
  return ids.filter((id) => overrides.get(id) ?? !isolated.has(id))
}
