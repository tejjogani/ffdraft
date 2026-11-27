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

export function rhinoStoneFields(
  measurements?: RhinoStoneMeasurements,
  digits?: number,
): RhinoStoneFields {
  const values = measurements && [
    measurements.width,
    measurements.length,
    measurements.depth,
    ...measurements.girdle,
    ...measurements.rotation,
  ]
  return Object.fromEntries(
    STONE_FIELD_KEYS.map((key, index) => {
      const value = values?.[index]
      return [
        key,
        value === undefined
          ? ''
          : String(digits === undefined ? value : Number(value.toFixed(digits))),
      ]
    }),
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

/** A group can span occurrences. Match at the same placement or across a containing placement. */
export function uniqueRhinoHeadPairs(stones: readonly PlacedBody[], heads: readonly PlacedBody[]) {
  const headsByGroup = new Map<string, PlacedBody[]>()
  for (const head of heads) {
    for (const group of head.groups) {
      const members = headsByGroup.get(group) ?? []
      members.push(head)
      headsByGroup.set(group, members)
    }
  }
  const candidates = new Map<string, Set<string>>()
  const headUse = new Map<string, number>()
  for (const stone of stones) {
    const matches = new Set<string>()
    for (const group of stone.groups) {
      for (const head of headsByGroup.get(group) ?? []) {
        if (head.id === stone.id) continue
        const [shorter, longer] =
          stone.placement.length <= head.placement.length
            ? [stone.placement, head.placement]
            : [head.placement, stone.placement]
        if (shorter.every((id, index) => id === longer[index])) matches.add(head.id)
      }
    }
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
