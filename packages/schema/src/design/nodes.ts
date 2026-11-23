/**
 * The design feature tree.
 *
 * A design is a flat map of nodes; nodes reference each other by id (a setting holds a gem,
 * a pavé field covers a body, a bail hangs a pendant). Geometry is never stored — it is a pure
 * function of this document, computed by @pave/kernel.
 *
 * Space: millimetres, right-handed, Z up. A ring is centred on the origin with the finger along
 * Y and the head at +Z. Flat pieces (pendants, vector/relief/mesh bodies) stand in the XZ plane
 * and face −Y. Angles are degrees.
 */
import { z } from 'zod'
import { GEM_CUT_IDS, GEM_MATERIAL_IDS } from '../domain/gems'
import { FINISH_IDS, METAL_IDS, PLATING_IDS } from '../domain/metals'
import { RING_SIZE_SYSTEMS } from '../domain/sizes'
import { choice, deg, int, mm, ratio, ref, text, toggle, vec3 } from './fields'

/** Kinds that produce a solid another feature can attach to, cut into or cover with stones. */
export const BODY_KINDS = [
  'ringShank',
  'setting',
  'halo',
  'vectorBody',
  'meshBody',
  'relief',
  'revolve',
  'pipe',
  'primitive',
  'boolean',
  'bail',
] as const

const Transform = z
  .object({
    position: vec3('Position', [0, 0, 0]),
    rotation: vec3('Rotation', [0, 0, 0]),
    scale: ratio('Scale', 0.01, 100, 1),
  })
  .meta({ title: 'Transform', group: 'Transform' })

const base = {
  id: z.string(),
  name: z.string().max(80).optional(),
  visible: z.boolean().default(true),
  transform: Transform.optional(),
}

const metal = {
  material: choice('Metal', METAL_IDS, 'au18k-yellow', { group: 'Material' }),
  finish: choice('Finish', FINISH_IDS, 'polished', { group: 'Material' }),
  plating: choice('Plating', PLATING_IDS, 'none', { group: 'Material' }),
}

const stone = {
  cut: choice('Cut', GEM_CUT_IDS, 'round', { group: 'Stone' }),
  stone: choice('Stone', GEM_MATERIAL_IDS, 'diamond', { group: 'Stone' }),
}

const RingSizeSchema = z
  .object({ system: z.enum(RING_SIZE_SYSTEMS), value: z.number().min(0).max(80) })
  .default({ system: 'us', value: 6 })
  .meta({ title: 'Ring size' })

const fontChoice = choice('Font', ['sans', 'serif', 'script', 'block'], 'sans')

// ── Rings ────────────────────────────────────────────────────────────────────────────────────

export const RingShank = z
  .object({
    ...base,
    kind: z.literal('ringShank'),
    ...metal,
    size: RingSizeSchema,
    profile: choice('Profile', ['court', 'dShape', 'flat', 'flatCourt', 'knifeEdge'], 'court', {
      description:
        'Cross-section. court = rounded inside and out (comfort fit); dShape = flat inside, domed outside; flatCourt = flat outside, rounded inside.',
    }),
    widthTop: mm('Width at top', 1, 14, 2.2, { group: 'Band' }),
    widthBottom: mm('Width at base', 1, 14, 2.2, { group: 'Band' }),
    thicknessTop: mm('Thickness at top', 0.9, 5, 1.8, { group: 'Band' }),
    thicknessBottom: mm('Thickness at base', 0.9, 5, 1.6, { group: 'Band' }),
    shoulder: choice('Shoulders', ['plain', 'cathedral', 'split'], 'plain', {
      group: 'Shoulders',
      description: 'cathedral = arches rising to the head; split = band divides in two near the head.',
    }),
    shoulderHeight: mm('Cathedral rise', 0.5, 8, 3, {
      group: 'Shoulders',
      when: { shoulder: ['cathedral'] },
    }),
    splitGap: mm('Split gap', 0.5, 6, 2, { group: 'Shoulders', when: { shoulder: ['split'] } }),
    baseShape: choice('Base', ['round', 'euro'], 'round', {
      group: 'Band',
      description: 'euro = squared-off base that resists spinning.',
    }),
  })
  .meta({ title: 'Ring band', description: 'A ring shank / band sized to a finger.' })

// ── Stones ───────────────────────────────────────────────────────────────────────────────────

const GemPlacement = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('ringTop'),
      shank: ref('Band', ['ringShank']),
      angle: deg('Angle around band', -180, 180, 0, {
        description: '0 = top of the ring; positive toward +X.',
      }),
      elevation: mm('Culet clearance', 0, 8, 1.2, {
        description: 'Gap between the finger and the lowest point of the stone.',
      }),
      spin: deg('Rotation', -180, 180, 0, { description: 'Turn about the stone’s own axis.' }),
    }),
    z.object({
      type: z.literal('surface'),
      host: ref('On body', BODY_KINDS),
      point: vec3('Point', [0, 0, 0]),
      normal: vec3('Normal', [0, -1, 0]),
      inset: mm('Sink depth', -2, 5, 0, { description: 'How far the girdle sits below the surface.' }),
      spin: deg('Rotation', -180, 180, 0),
    }),
    z.object({ type: z.literal('free') }),
  ])
  .default({ type: 'free' })
  .meta({ title: 'Placement', group: 'Placement' })

/** A real, purchasable stone attached to a design stone (see docs/research/07-sourcing.md). */
export const StoneSourcing = z.object({
  provider: z.string(),
  sku: z.string(),
  url: z.string().url().optional(),
  priceUsd: z.number().nonnegative().optional(),
  /** Measured dimensions of the actual stone; when present the seat is cut to these. */
  measured: z.object({ length: z.number(), width: z.number(), depth: z.number() }).optional(),
  certificate: z.string().optional(),
})

export const Gem = z
  .object({
    ...base,
    kind: z.literal('gem'),
    ...stone,
    width: mm('Width', 0.6, 40, 6.5, {
      group: 'Stone',
      description: 'Girdle width (diameter for rounds). 6.5 mm round ≈ 1 ct diamond.',
    }),
    lw: ratio('Length : width', 0.8, 5, 1, {
      group: 'Stone',
      description: 'Ignored for round; clamped to what the cut allows.',
    }).optional(),
    placement: GemPlacement,
    sourcing: StoneSourcing.optional(),
  })
  .meta({ title: 'Stone', description: 'A single gemstone.' })

export const Setting = z
  .object({
    ...base,
    kind: z.literal('setting'),
    ...metal,
    gem: ref('Holds', ['gem']),
    style: choice('Style', ['prong', 'basket', 'bezel', 'halfBezel', 'flush'], 'prong', {
      description:
        'prong = claws only; basket = claws joined by gallery rails; bezel = full metal rim; halfBezel = two arcs; flush = stone sunk into the host.',
    }),
    prongCount: int('Prongs', 3, 8, 4, { group: 'Prongs', when: { style: ['prong', 'basket'] } }),
    prongDiameter: mm('Prong wire', 0.5, 2.5, 1, {
      group: 'Prongs',
      when: { style: ['prong', 'basket'] },
    }),
    prongTip: choice('Tip', ['round', 'claw', 'tab', 'double'], 'round', {
      group: 'Prongs',
      when: { style: ['prong', 'basket'] },
    }),
    prongSpin: deg('Prong rotation', -90, 90, 45, {
      group: 'Prongs',
      when: { style: ['prong', 'basket'] },
      description: '45 puts four prongs on the corners; 0 on the compass points.',
    }),
    taper: ratio('Taper', 0, 0.8, 0.35, {
      group: 'Prongs',
      when: { style: ['prong', 'basket'] },
      description: 'How strongly the head narrows toward its base.',
    }),
    rails: int('Gallery rails', 0, 2, 1, { group: 'Prongs', when: { style: ['basket'] } }),
    wall: mm('Bezel wall', 0.3, 2, 0.55, { group: 'Bezel', when: { style: ['bezel', 'halfBezel'] } }),
  })
  .meta({ title: 'Setting', description: 'The head that holds one stone.' })

export const Halo = z
  .object({
    ...base,
    kind: z.literal('halo'),
    ...metal,
    ...stone,
    around: ref('Around', ['gem']),
    stoneWidth: mm('Stone size', 0.8, 3.5, 1.3, { group: 'Stone' }),
    rows: int('Rows', 1, 3, 1),
    offset: mm('Gap to centre stone', 0.05, 1.5, 0.25),
    gap: mm('Gap between stones', 0.05, 0.6, 0.15),
    drop: mm('Drop below girdle', -1, 3, 0.4, {
      description: 'How far the halo sits below the centre stone’s girdle.',
    }),
  })
  .meta({ title: 'Halo', description: 'A ring of small stones following the outline of a centre stone.' })

export const GemRow = z
  .object({
    ...base,
    kind: z.literal('gemRow'),
    ...stone,
    host: ref('On band', ['ringShank']),
    setting: choice('Setting', ['pave', 'channel', 'sharedProng', 'bar', 'flush'], 'pave'),
    stoneWidth: mm('Stone size', 0.8, 6, 1.5, { group: 'Stone' }),
    graduateTo: mm('Graduate to', 0.8, 6, 1.5, {
      group: 'Stone',
      description: 'Stone size at the ends of the row; equal to Stone size for no graduation.',
    }).optional(),
    coverage: deg('Coverage', 10, 360, 150, {
      description: 'Arc of the band that carries stones. 180 = half eternity, 360 = full eternity.',
    }),
    center: deg('Centred at', -180, 180, 0),
    skipCenter: deg('Skip at centre', 0, 180, 0, {
      description: 'Arc left clear around the centre (for a head).',
    }),
    rows: int('Rows', 1, 5, 1),
    gap: mm('Gap between stones', 0.05, 1, 0.15),
  })
  .meta({ title: 'Stone row', description: 'Stones set along a ring band: pavé shoulders, channel, eternity.' })

export const Pave = z
  .object({
    ...base,
    kind: z.literal('pave'),
    ...stone,
    host: ref('Covers', BODY_KINDS),
    region: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('all') }),
        z.object({
          type: z.literal('facing'),
          direction: vec3('Direction', [0, -1, 0]),
          maxAngle: deg('Max angle', 5, 180, 75),
        }),
      ])
      .default({ type: 'facing', direction: [0, -1, 0], maxAngle: 75 })
      .meta({ title: 'Region', description: 'Which part of the body is covered.' }),
    sizeMax: mm('Largest stone', 0.8, 4, 1.8, { group: 'Stone' }),
    sizeMin: mm('Smallest stone', 0.8, 4, 1.0, { group: 'Stone' }),
    gap: mm('Gap between stones', 0.05, 0.6, 0.12),
    margin: mm('Edge margin', 0, 2, 0.3),
    coverage: ratio('Ice level', 0.05, 1, 1, {
      widget: 'slider',
      description: 'Fraction of the region to fill. 1 = fully iced out.',
    }),
    beads: toggle('Beads', true, { description: 'Raise bead prongs between stones.' }),
    seed: int('Layout seed', 0, 9999, 1),
  })
  .meta({ title: 'Pavé', description: 'Automatically packs graded stones over a surface.' })

// ── Bodies ───────────────────────────────────────────────────────────────────────────────────

const Bevel = {
  bevel: choice('Edge', ['flat', 'chamfer', 'round', 'pillow'], 'round', {
    description: 'pillow inflates the whole face into a soft dome.',
  }),
  bevelSize: mm('Edge size', 0, 5, 0.4),
}

export const VectorBody = z
  .object({
    ...base,
    kind: z.literal('vectorBody'),
    ...metal,
    source: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: text('Text', 'Pavé'), font: fontChoice }),
        z.object({
          type: z.literal('svg'),
          d: z.string().max(200_000).meta({ title: 'Path', widget: 'path' }),
        }),
        z.object({
          type: z.literal('shape'),
          shape: choice(
            'Shape',
            ['circle', 'oval', 'heart', 'star', 'cross', 'shield', 'hexagon', 'teardrop', 'tag'],
            'heart',
          ),
        }),
      ])
      .default({ type: 'shape', shape: 'heart' })
      .meta({ title: 'Outline' }),
    height: mm('Height', 3, 150, 22, { description: 'Overall height of the outline.' }),
    thickness: mm('Thickness', 0.6, 20, 2),
    ...Bevel,
    border: mm('Raised border', 0, 3, 0, {
      description: 'Adds a polished rim around the edge — the frame for a pavé field.',
    }),
  })
  .meta({
    title: 'Outline body',
    description: 'Text, a logo path or a shape, extruded into a solid: name pendants, charms, tags.',
  })

export const MeshBody = z
  .object({
    ...base,
    kind: z.literal('meshBody'),
    ...metal,
    source: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('asset'), assetId: z.string().meta({ title: 'Mesh', widget: 'asset' }) }),
        z.object({
          type: z.literal('builtin'),
          name: choice('Model', ['trophy', 'skull', 'crown', 'dice', 'bust'], 'trophy'),
        }),
      ])
      .meta({ title: 'Source' }),
    height: mm('Height', 3, 200, 40, { description: 'The mesh is scaled to this overall height.' }),
    flatBack: ratio('Flat back', 0, 0.9, 0, {
      widget: 'slider',
      description: 'Slices this fraction off the back so the piece lies flat.',
    }),
    hollow: mm('Hollow to wall', 0, 5, 0, { description: '0 keeps the body solid.' }),
    smooth: int('Smoothing', 0, 8, 0),
    detail: ratio('Detail', 0.02, 1, 1, { widget: 'slider', description: 'Mesh simplification.' }),
  })
  .meta({
    title: 'Sculpted body',
    description: 'An imported, scanned or AI-generated mesh made castable: scaled, flat-backed, hollowed.',
  })

export const Relief = z
  .object({
    ...base,
    kind: z.literal('relief'),
    ...metal,
    assetId: z.string().optional().meta({ title: 'Height map', widget: 'asset' }),
    outline: choice('Outline', ['round', 'oval', 'cushion', 'rect', 'shield'], 'round'),
    width: mm('Width', 4, 100, 18),
    height: mm('Height', 4, 100, 18),
    baseThickness: mm('Base thickness', 0.5, 6, 1.2),
    depth: mm('Relief depth', 0.1, 6, 0.8),
    rim: mm('Rim', 0, 4, 0.8),
    invert: toggle('Invert', false),
  })
  .meta({ title: 'Relief', description: 'A coin, medallion or signet face raised from an image.' })

export const Revolve = z
  .object({
    ...base,
    kind: z.literal('revolve'),
    ...metal,
    profile: z
      .string()
      .max(20_000)
      .meta({
        title: 'Profile',
        widget: 'path',
        description: 'SVG path in mm in the (radius, height) half-plane; revolved about Z.',
      }),
    angle: deg('Sweep', 1, 360, 360),
  })
  .meta({ title: 'Revolve', description: 'A lathe form: domes, beads, cups, bezels.' })

export const Pipe = z
  .object({
    ...base,
    kind: z.literal('pipe'),
    ...metal,
    points: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .min(2)
      .max(400)
      .meta({ title: 'Path points', description: 'A smooth curve is fitted through these.' }),
    closed: toggle('Closed', false),
    section: choice('Section', ['round', 'square', 'halfRound'], 'round'),
    width: mm('Wire width', 0.4, 20, 1.5),
    thickness: mm('Wire thickness', 0.4, 20, 1.5),
    taper: ratio('End taper', 0, 1, 0, { description: 'Fraction by which the wire thins at its ends.' }),
  })
  .meta({ title: 'Wire', description: 'A wire swept along a curve: vines, bypass bands, hoops, bangles.' })

export const Primitive = z
  .object({
    ...base,
    kind: z.literal('primitive'),
    ...metal,
    shape: choice('Shape', ['box', 'cylinder', 'sphere', 'torus', 'cone'], 'box'),
    size: vec3('Size', [5, 5, 5], { description: 'Bounding size in mm.' }),
    tube: mm('Tube', 0.2, 20, 1, { when: { shape: ['torus'] } }),
    fillet: mm('Edge radius', 0, 5, 0),
  })
  .meta({ title: 'Primitive' })

export const BooleanNode = z
  .object({
    ...base,
    kind: z.literal('boolean'),
    op: choice('Operation', ['union', 'subtract', 'intersect'], 'subtract'),
    target: ref('Target', BODY_KINDS),
    tools: z.array(ref('Tool', BODY_KINDS)).min(1).max(32),
  })
  .meta({ title: 'Combine', description: 'Union, subtract or intersect bodies. Inputs are consumed.' })

// ── Attachments ──────────────────────────────────────────────────────────────────────────────

export const Bail = z
  .object({
    ...base,
    kind: z.literal('bail'),
    ...metal,
    host: ref('Hangs', BODY_KINDS).optional(),
    style: choice('Style', ['loop', 'tube', 'ring', 'hidden'], 'loop', {
      description: 'ring = plain jump ring; hidden = slot behind the top of the piece.',
    }),
    opening: mm('Opening', 1.5, 20, 4.5, { description: 'Clear inner height — must pass the chain end.' }),
    width: mm('Width', 0.8, 15, 3),
    wire: mm('Wire', 0.5, 4, 1.1),
  })
  .meta({ title: 'Bail', description: 'The loop a pendant hangs from. Auto-places at the top of its host.' })

export const Chain = z
  .object({
    ...base,
    kind: z.literal('chain'),
    ...metal,
    ...stone,
    style: choice('Style', ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box', 'tennis'], 'cable'),
    length: mm('Length', 100, 900, 457, { step: 1 }),
    linkWidth: mm('Link width', 0.8, 25, 3),
    wire: mm('Wire', 0.3, 6, 0.8),
    through: ref('Through bail', ['bail']).optional(),
    layout: choice('Layout', ['drape', 'straight'], 'drape'),
  })
  .meta({ title: 'Chain', description: 'Cable, curb/Cuban, rope, box or tennis chain.' })

export const Finding = z
  .object({
    ...base,
    kind: z.literal('finding'),
    ...metal,
    type: choice('Type', ['earringPost', 'butterfly', 'jumpRing', 'lobsterClasp'], 'earringPost'),
    host: ref('On', BODY_KINDS).optional(),
    length: mm('Length', 2, 20, 10),
    wire: mm('Wire', 0.5, 2, 0.8),
  })
  .meta({ title: 'Finding', description: 'Posts, backs, jump rings, clasps.' })

export const Engraving = z
  .object({
    ...base,
    kind: z.literal('engraving'),
    host: ref('On', BODY_KINDS),
    text: text('Text', 'forever'),
    font: fontChoice,
    size: mm('Letter height', 0.6, 20, 1.4),
    depth: mm('Depth', 0.05, 2, 0.25),
    mode: choice('Mode', ['engrave', 'emboss'], 'engrave'),
    where: choice('Where', ['insideBand', 'outsideBand', 'front', 'back'], 'insideBand'),
    angle: deg('Position', -180, 180, 180, { description: 'Around the band; 180 = base of the ring.' }),
  })
  .meta({ title: 'Engraving' })

// ── Structure ────────────────────────────────────────────────────────────────────────────────

export const Pattern = z
  .object({
    ...base,
    kind: z.literal('pattern'),
    sources: z.array(z.string()).min(1).max(64).meta({ title: 'Sources' }),
    type: choice('Type', ['polar', 'linear', 'mirror'], 'polar'),
    axis: choice('Axis', ['x', 'y', 'z'], 'z'),
    count: int('Count', 2, 200, 6, { when: { type: ['polar', 'linear'] } }),
    angle: deg('Total angle', 1, 360, 360, { when: { type: ['polar'] } }),
    spacing: mm('Spacing', 0.1, 200, 5, { when: { type: ['linear'] } }),
  })
  .meta({ title: 'Pattern', description: 'Repeats nodes around an axis, along a line, or mirrors them.' })

export const Group = z
  .object({
    ...base,
    kind: z.literal('group'),
    children: z.array(z.string()).max(500).meta({ title: 'Children' }),
  })
  .meta({ title: 'Group' })

export const NODE_SCHEMAS = {
  ringShank: RingShank,
  gem: Gem,
  setting: Setting,
  halo: Halo,
  gemRow: GemRow,
  pave: Pave,
  vectorBody: VectorBody,
  meshBody: MeshBody,
  relief: Relief,
  revolve: Revolve,
  pipe: Pipe,
  primitive: Primitive,
  boolean: BooleanNode,
  bail: Bail,
  chain: Chain,
  finding: Finding,
  engraving: Engraving,
  pattern: Pattern,
  group: Group,
} as const

export type NodeKind = keyof typeof NODE_SCHEMAS
export const NODE_KINDS = Object.keys(NODE_SCHEMAS) as [NodeKind, ...NodeKind[]]

export const NodeSchema = z.discriminatedUnion('kind', [
  RingShank,
  Gem,
  Setting,
  Halo,
  GemRow,
  Pave,
  VectorBody,
  MeshBody,
  Relief,
  Revolve,
  Pipe,
  Primitive,
  BooleanNode,
  Bail,
  Chain,
  Finding,
  Engraving,
  Pattern,
  Group,
])

export type Node = z.infer<typeof NodeSchema>
/** What callers may pass when creating a node: defaults are optional. */
export type NodeInput = z.input<typeof NodeSchema>
export type NodeOf<K extends NodeKind> = Extract<Node, { kind: K }>
export type NodeInputOf<K extends NodeKind> = Extract<NodeInput, { kind: K }>

export const isBodyKind = (k: NodeKind): boolean => (BODY_KINDS as readonly string[]).includes(k)

/** Ids of every node this node depends on. Drives evaluation order and integrity checks. */
export function nodeRefs(n: Node): string[] {
  switch (n.kind) {
    case 'gem':
      return n.placement.type === 'ringTop'
        ? [n.placement.shank]
        : n.placement.type === 'surface'
          ? [n.placement.host]
          : []
    case 'setting':
      return [n.gem]
    case 'halo':
      return [n.around]
    case 'gemRow':
    case 'pave':
    case 'engraving':
      return [n.host]
    case 'boolean':
      return [n.target, ...n.tools]
    case 'bail':
    case 'finding':
      return n.host ? [n.host] : []
    case 'chain':
      return n.through ? [n.through] : []
    case 'pattern':
      return n.sources
    case 'group':
      return n.children
    default:
      return []
  }
}
