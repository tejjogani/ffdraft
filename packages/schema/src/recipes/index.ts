/**
 * Recipes turn a confirmed {@link PieceSpec} into a first design. They only author nodes — the
 * same nodes a person or the assistant could add by hand — so the result is fully editable.
 * Templates are just specs, which keeps "start from a template" and "the assistant planned
 * this with you" on one code path.
 */
import { type Design, type PieceKind, designFrom } from '../design/design'
import type { NodeInput } from '../design/nodes'
import { type PieceSpec, type PieceSpecInput, PieceSpecSchema, type StoneSpec } from '../design/spec'
import { gemDimsFromCarat } from '../domain/gems'
import { ringInnerDiameter } from '../domain/sizes'

const FACE_FRONT: [number, number, number] = [90, 0, 0]

const widthOf = (s: StoneSpec | undefined, fallback: number): number =>
  !s
    ? fallback
    : s.carat
      ? Number(gemDimsFromCarat(s.cut, s.carat, s.stone, s.lw).width.toFixed(2))
      : (s.widthMm ?? fallback)

const byRole = (spec: PieceSpec, role: StoneSpec['role']) => spec.stones.find((s) => s.role === role)

const headStyle = (s: StoneSpec | undefined) =>
  s?.setting === 'bezel' || s?.setting === 'halfBezel' || s?.setting === 'basket' || s?.setting === 'flush'
    ? s.setting
    : 'prong'

function ring(spec: PieceSpec): NodeInput[] {
  const metal = { material: spec.metal.alloy, finish: spec.metal.finish, plating: spec.metal.plating }
  const r = spec.ring
  const size = r?.size ?? { system: 'us' as const, value: 6 }
  const radius = ringInnerDiameter(size) / 2
  const center = byRole(spec, 'center')
  const accent = byRole(spec, 'accent') ?? byRole(spec, 'pave')
  const a = spec.archetype

  const isBand = a === 'band' || a === 'eternity'
  const width = r?.bandWidthMm ?? (a === 'signet' ? 3.2 : isBand ? 3 : 2)
  const thickness = r?.bandThicknessMm ?? 1.7
  const nodes: NodeInput[] = [
    {
      id: 'band',
      kind: 'ringShank',
      name: 'Band',
      ...metal,
      size,
      profile: r?.profile ?? (a === 'signet' ? 'dShape' : 'court'),
      shoulder: r?.shoulder ?? 'plain',
      widthTop: a === 'signet' ? Math.max(width, 6) : width,
      widthBottom: width,
      thicknessTop: a === 'signet' ? Math.max(thickness, 2.2) : thickness,
      thicknessBottom: Math.max(1.2, thickness - 0.2),
    },
  ]

  if (a === 'signet') {
    nodes.push({
      id: 'face',
      kind: 'relief',
      name: 'Signet face',
      ...metal,
      outline: 'cushion',
      width: 11,
      height: 13,
      baseThickness: 1.6,
      depth: 0.5,
      rim: 0.6,
      transform: { position: [0, 0, radius + thickness], rotation: [-90, 0, 0], scale: 1 },
    })
  }

  if (!isBand && a !== 'signet' && (center || a !== 'custom')) {
    const w = widthOf(center, 6.5)
    nodes.push(
      {
        id: 'center',
        kind: 'gem',
        name: 'Centre stone',
        cut: center?.cut ?? 'round',
        stone: center?.stone ?? 'diamond',
        width: w,
        ...(center?.lw ? { lw: center.lw } : {}),
        placement: { type: 'ringTop', shank: 'band', angle: 0, elevation: 1.2, spin: 0 },
      },
      {
        id: 'head',
        kind: 'setting',
        name: 'Head',
        ...metal,
        gem: 'center',
        style: headStyle(center),
        prongCount: center?.prongs ?? (center?.cut === 'round' && w >= 7.4 ? 6 : 4),
        prongDiameter: Number(Math.min(1.4, Math.max(0.8, w * 0.15)).toFixed(2)),
      },
    )

    if (a === 'halo') {
      const h = byRole(spec, 'halo')
      nodes.push({
        id: 'halo',
        kind: 'halo',
        name: 'Halo',
        ...metal,
        around: 'center',
        cut: 'round',
        stone: h?.stone ?? 'diamond',
        stoneWidth: widthOf(h, 1.3),
      })
    }

    if (a === 'threeStone') {
      const side = byRole(spec, 'side')
      const sw = widthOf(side, Number((w * 0.62).toFixed(2)))
      const angle = Number((((w / 2 + sw / 2 + 0.5) / (radius + thickness + 2)) * (180 / Math.PI)).toFixed(1))
      for (const [i, sign] of [-1, 1].entries()) {
        nodes.push(
          {
            id: `side${i + 1}`,
            kind: 'gem',
            name: i ? 'Side stone R' : 'Side stone L',
            cut: side?.cut ?? 'round',
            stone: side?.stone ?? 'diamond',
            width: sw,
            placement: { type: 'ringTop', shank: 'band', angle: sign * angle, elevation: 0.9, spin: 0 },
          },
          {
            id: `sideHead${i + 1}`,
            kind: 'setting',
            name: i ? 'Side head R' : 'Side head L',
            ...metal,
            gem: `side${i + 1}`,
            style: headStyle(side),
            prongCount: 4,
            prongDiameter: 0.8,
          },
        )
      }
    }
  }

  if (accent || a === 'eternity') {
    const hasHead = nodes.some((n) => n.kind === 'setting')
    nodes.push({
      id: 'row',
      kind: 'gemRow',
      name: a === 'eternity' ? 'Eternity row' : 'Shoulder stones',
      host: 'band',
      cut: accent?.cut ?? 'round',
      stone: accent?.stone ?? 'diamond',
      setting: accent?.setting === 'channel' ? 'channel' : 'pave',
      stoneWidth: widthOf(accent, Math.max(1, Number((width * 0.7).toFixed(1)))),
      coverage: a === 'eternity' ? 360 : 150,
      skipCenter: hasHead ? 44 : 0,
    })
  }

  if (spec.engraving) {
    nodes.push({ id: 'engraving', kind: 'engraving', name: 'Engraving', host: 'band', text: spec.engraving })
  }
  return nodes
}

function pendant(spec: PieceSpec): NodeInput[] {
  const metal = { material: spec.metal.alloy, finish: spec.metal.finish, plating: spec.metal.plating }
  const a = spec.archetype
  const b = spec.body
  const height = b?.heightMm ?? 24
  const nodes: NodeInput[] = []
  let host = 'body'

  if (a === 'pendantSolitaire') {
    const center = byRole(spec, 'center')
    host = 'head'
    nodes.push(
      {
        id: 'center',
        kind: 'gem',
        name: 'Stone',
        cut: center?.cut ?? 'round',
        stone: center?.stone ?? 'diamond',
        width: widthOf(center, 5),
        ...(center?.lw ? { lw: center.lw } : {}),
        transform: { position: [0, 0, 0], rotation: FACE_FRONT, scale: 1 },
      },
      {
        id: 'head',
        kind: 'setting',
        name: 'Setting',
        ...metal,
        gem: 'center',
        style: headStyle(center) === 'prong' ? 'basket' : headStyle(center),
        prongCount: center?.prongs ?? 4,
      },
    )
  } else if (a === 'namePendant') {
    nodes.push({
      id: 'body',
      kind: 'vectorBody',
      name: 'Name',
      ...metal,
      source: { type: 'text', text: b?.text ?? 'Amara', font: 'script' },
      height: b?.heightMm ?? 9,
      thickness: b?.thicknessMm ?? 1.4,
      bevel: 'round',
      bevelSize: 0.25,
    })
  } else if (a === 'medallion') {
    nodes.push({
      id: 'body',
      kind: 'relief',
      name: 'Medallion',
      ...metal,
      outline: 'round',
      width: height,
      height,
      ...(b?.meshAssetId ? { assetId: b.meshAssetId } : {}),
    })
  } else {
    // icedPendant and anything sculptural: a mesh when we have one, otherwise an outline shape.
    nodes.push(
      b?.meshAssetId
        ? {
            id: 'body',
            kind: 'meshBody',
            name: b.shape ?? 'Sculpt',
            ...metal,
            source: { type: 'asset', assetId: b.meshAssetId },
            height,
            flatBack: 0.35,
          }
        : b?.text
          ? {
              id: 'body',
              kind: 'vectorBody',
              name: b.text,
              ...metal,
              source: { type: 'text', text: b.text, font: 'block' },
              height,
              thickness: b.thicknessMm ?? 3.5,
              bevel: 'pillow',
              bevelSize: 0.8,
              border: 0.6,
            }
          : {
              id: 'body',
              kind: 'meshBody',
              name: b?.shape ?? 'Trophy',
              ...metal,
              source: { type: 'builtin', name: 'trophy' },
              height,
              flatBack: 0.35,
            },
    )
  }

  const pave = byRole(spec, 'pave')
  if (a === 'icedPendant' || pave) {
    nodes.push({
      id: 'ice',
      kind: 'pave',
      name: 'Pavé',
      host,
      stone: pave?.stone ?? 'diamond',
      sizeMax: pave?.widthMm ?? 1.8,
      sizeMin: 1,
      coverage: b?.iceLevel ?? 1,
    })
  }

  const chain = spec.chain
  nodes.push({
    id: 'bail',
    kind: 'bail',
    name: 'Bail',
    ...metal,
    host,
    style: a === 'namePendant' ? 'ring' : 'loop',
    opening: Math.max(3.5, (chain?.widthMm ?? 2) + 2),
    width: a === 'icedPendant' ? 5 : 3,
  })
  if (chain) nodes.push(chainNode(spec, 'bail'))
  return nodes
}

function chainNode(spec: PieceSpec, through?: string): NodeInput {
  const c = spec.chain ?? {
    style: spec.archetype === 'tennis' ? ('tennis' as const) : ('cuban' as const),
    lengthMm: spec.kind === 'bracelet' ? 180 : 457,
    widthMm: spec.archetype === 'tennis' ? 3 : 8,
  }
  const accent = byRole(spec, 'accent') ?? byRole(spec, 'pave')
  return {
    id: 'chain',
    kind: 'chain',
    name: 'Chain',
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
    style: c.style,
    length: c.lengthMm,
    linkWidth: c.widthMm,
    wire: Number(Math.max(0.4, c.widthMm * 0.26).toFixed(2)),
    stone: accent?.stone ?? 'diamond',
    ...(through ? { through } : {}),
  }
}

function studs(spec: PieceSpec): NodeInput[] {
  const metal = { material: spec.metal.alloy, finish: spec.metal.finish, plating: spec.metal.plating }
  const center = byRole(spec, 'center')
  return [
    {
      id: 'stone',
      kind: 'gem',
      name: 'Stone',
      cut: center?.cut ?? 'round',
      stone: center?.stone ?? 'diamond',
      width: widthOf(center, 5),
      transform: { position: [-7, 0, 0], rotation: FACE_FRONT, scale: 1 },
    },
    {
      id: 'head',
      kind: 'setting',
      name: 'Setting',
      ...metal,
      gem: 'stone',
      style: headStyle(center) === 'prong' ? 'basket' : headStyle(center),
      prongCount: center?.prongs ?? 4,
      prongDiameter: 0.8,
    },
    { id: 'post', kind: 'finding', name: 'Post', ...metal, type: 'earringPost', host: 'head' },
    { id: 'pair', kind: 'pattern', name: 'Pair', sources: ['stone', 'head', 'post'], type: 'mirror', axis: 'x' },
  ]
}

/** Builds the first editable design for a spec. */
export function buildDesign(input: PieceSpecInput): Design {
  const spec = PieceSpecSchema.parse(input)
  const nodes =
    spec.kind === 'ring'
      ? ring(spec)
      : spec.archetype === 'studs' || spec.kind === 'earrings'
        ? studs(spec)
        : spec.archetype === 'tennis' || spec.archetype === 'cuban' || spec.kind === 'chain'
          ? [chainNode(spec)]
          : spec.archetype === 'custom'
            ? []
            : pendant(spec)
  return designFrom(spec.kind as PieceKind, nodes)
}

export interface Template {
  id: string
  /** Shown in the gallery, grouped by family. */
  family: 'Bridal' | 'Bands' | 'Pendants' | 'Iced' | 'Earrings' | 'Chains'
  spec: PieceSpecInput
}

const us = (value: number) => ({ size: { system: 'us' as const, value } })

export const TEMPLATES: readonly Template[] = [
  {
    id: 'solitaire',
    family: 'Bridal',
    spec: {
      kind: 'ring',
      archetype: 'solitaire',
      title: 'Classic solitaire',
      summary: 'A 1 ct round brilliant in four claws on a slim comfort-fit band.',
      style: ['classic', 'minimal'],
      metal: { alloy: 'pt950' },
      ring: us(6),
      stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 4 }],
    },
  },
  {
    id: 'oval-pave',
    family: 'Bridal',
    spec: {
      kind: 'ring',
      archetype: 'solitaire',
      title: 'Oval with pavé shoulders',
      summary: 'A 1.5 ct oval on a fine pavé band.',
      style: ['modern', 'delicate'],
      ring: { ...us(6), bandWidthMm: 1.8, shoulder: 'cathedral' },
      stones: [
        { role: 'center', cut: 'oval', carat: 1.5, setting: 'prong', prongs: 4 },
        { role: 'accent', cut: 'round', widthMm: 1.3, setting: 'pave' },
      ],
    },
  },
  {
    id: 'halo',
    family: 'Bridal',
    spec: {
      kind: 'ring',
      archetype: 'halo',
      title: 'Cushion halo',
      summary: 'A 1.2 ct cushion framed by a single pavé halo.',
      style: ['glamorous'],
      metal: { alloy: 'au18k-white', plating: 'rhodium' },
      ring: us(6),
      stones: [
        { role: 'center', cut: 'cushion', carat: 1.2 },
        { role: 'halo', widthMm: 1.3 },
        { role: 'accent', widthMm: 1.3, setting: 'pave' },
      ],
    },
  },
  {
    id: 'three-stone',
    family: 'Bridal',
    spec: {
      kind: 'ring',
      archetype: 'threeStone',
      title: 'Three-stone emerald',
      summary: 'An emerald-cut centre flanked by two smaller emerald cuts.',
      style: ['art deco'],
      metal: { alloy: 'pt950' },
      ring: us(6),
      stones: [
        { role: 'center', cut: 'emerald', carat: 1.5 },
        { role: 'side', cut: 'emerald', carat: 0.4 },
      ],
    },
  },
  {
    id: 'wedding-band',
    family: 'Bands',
    spec: {
      kind: 'ring',
      archetype: 'band',
      title: 'Court wedding band',
      summary: 'A 4 mm comfort-fit band.',
      style: ['classic'],
      ring: { ...us(9), bandWidthMm: 4, bandThicknessMm: 1.8 },
    },
  },
  {
    id: 'eternity',
    family: 'Bands',
    spec: {
      kind: 'ring',
      archetype: 'eternity',
      title: 'Full eternity',
      summary: 'Round brilliants set all the way around.',
      style: ['classic'],
      metal: { alloy: 'pt950' },
      ring: { ...us(6), bandWidthMm: 2.6, bandThicknessMm: 1.9, profile: 'flat' },
      stones: [{ role: 'accent', cut: 'round', widthMm: 2, setting: 'pave' }],
    },
  },
  {
    id: 'signet',
    family: 'Bands',
    spec: {
      kind: 'ring',
      archetype: 'signet',
      title: 'Cushion signet',
      summary: 'A heavy signet with a cushion face ready for a crest.',
      style: ['heritage'],
      metal: { alloy: 'au14k-yellow' },
      ring: us(9),
    },
  },
  {
    id: 'pendant-solitaire',
    family: 'Pendants',
    spec: {
      kind: 'pendant',
      archetype: 'pendantSolitaire',
      title: 'Bezel solitaire pendant',
      summary: 'A bezel-set round on a fine cable chain.',
      style: ['minimal'],
      stones: [{ role: 'center', cut: 'round', carat: 0.5, setting: 'bezel' }],
      chain: { style: 'cable', lengthMm: 457, widthMm: 1.2 },
    },
  },
  {
    id: 'name-pendant',
    family: 'Pendants',
    spec: {
      kind: 'pendant',
      archetype: 'namePendant',
      title: 'Script name pendant',
      summary: 'A name in flowing script on a cable chain.',
      style: ['personal'],
      body: { heightMm: 9, text: 'Amara' },
      chain: { style: 'cable', lengthMm: 406, widthMm: 1.2 },
    },
  },
  {
    id: 'iced-trophy',
    family: 'Iced',
    spec: {
      kind: 'pendant',
      archetype: 'icedPendant',
      title: 'Iced-out trophy',
      summary: 'A sculpted trophy, fully paved, on a Cuban link.',
      style: ['hip hop', 'statement'],
      metal: { alloy: 'au14k-yellow' },
      body: { heightMm: 45, shape: 'Trophy', iceLevel: 1 },
      stones: [{ role: 'pave', stone: 'diamond-lab', widthMm: 1.8 }],
      chain: { style: 'cuban', lengthMm: 559, widthMm: 8 },
    },
  },
  {
    id: 'iced-initial',
    family: 'Iced',
    spec: {
      kind: 'pendant',
      archetype: 'icedPendant',
      title: 'Iced initial',
      summary: 'A block letter with a polished border and a full pavé face.',
      style: ['hip hop'],
      metal: { alloy: 'au14k-white', plating: 'rhodium' },
      body: { heightMm: 32, text: 'A', thicknessMm: 4, iceLevel: 1 },
      stones: [{ role: 'pave', stone: 'moissanite', widthMm: 1.6 }],
      chain: { style: 'tennis', lengthMm: 508, widthMm: 3 },
    },
  },
  {
    id: 'studs',
    family: 'Earrings',
    spec: {
      kind: 'earrings',
      archetype: 'studs',
      title: 'Diamond studs',
      summary: 'A pair of four-claw basket studs.',
      style: ['classic'],
      metal: { alloy: 'au18k-white' },
      stones: [{ role: 'center', cut: 'round', carat: 0.5, count: 2 }],
    },
  },
  {
    id: 'cuban',
    family: 'Chains',
    spec: {
      kind: 'chain',
      archetype: 'cuban',
      title: 'Miami Cuban link',
      summary: 'A 10 mm Cuban link, 22 inches.',
      style: ['hip hop'],
      metal: { alloy: 'au14k-yellow' },
      chain: { style: 'cuban', lengthMm: 559, widthMm: 10 },
    },
  },
  {
    id: 'tennis',
    family: 'Chains',
    spec: {
      kind: 'bracelet',
      archetype: 'tennis',
      title: 'Tennis bracelet',
      summary: 'A line of 3 mm rounds, 7 inches.',
      style: ['classic'],
      metal: { alloy: 'au18k-white' },
      chain: { style: 'tennis', lengthMm: 180, widthMm: 3.4 },
      stones: [{ role: 'accent', cut: 'round', widthMm: 3 }],
    },
  },
]
