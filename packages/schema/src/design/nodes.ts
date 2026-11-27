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
import { CurveDefinition } from './curve'
import { choice, deg, follows, int, mm, ratio, ref, text, toggle, vec3 } from './fields'
import { MeshEdits } from './mesh-edit'
import { NurbsDefinition } from './nurbs'
import { DrawnProfile } from './profile'
import { RhinoContext } from './rhino-context'

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
  .meta({ title: 'Transform', group: 'Transform', advanced: true })

const base = {
  id: z.string(),
  name: z.string().max(80).optional(),
  visible: z.boolean().default(true),
  transform: Transform.optional(),
}

const DEFAULT_METAL = 'au18k-yellow'

const metal = {
  material: choice('Metal', METAL_IDS, DEFAULT_METAL, { group: 'Material', widget: 'metal' }),
  finish: choice('Finish', FINISH_IDS, 'polished', { group: 'Material', widget: 'finish' }),
  plating: choice('Plating', PLATING_IDS, 'none', {
    group: 'Material',
    widget: 'plating',
    advanced: true,
  }),
}

/** A real, purchasable stone or parcel attached to design stones (docs/research/07-sourcing.md). */
export const StoneSourcing = z.object({
  provider: z.string(),
  sku: z.string(),
  url: z.string().url().optional(),
  priceUsd: z.number().nonnegative().optional(),
  /**
   * Measured dimensions of the actual stone; when present the seat is cut to these. Bounded
   * like a stone's width: a zero or negative size from a marketplace record would otherwise
   * reach the geometry (the kernel also falls back to the nominal size if one gets through).
   */
  measured: z
    .object({
      length: z.number().min(0.3).max(40),
      width: z.number().min(0.3).max(40),
      depth: z.number().min(0.1).max(40),
    })
    .optional(),
  listedCarat: z.number().positive().optional().meta({
    title: 'Supplier-listed weight',
    unit: 'ct',
    description: 'Weight reported by the supplier for this fitted stone.',
  }),
  certificate: z.string().optional(),
})
export type StoneSourcing = z.infer<typeof StoneSourcing>

/** What to buy: explicit grade lists, because that is how stones are traded and filtered. */
export const StoneQuality = z.object({
  origin: z.enum(['natural', 'lab', 'any']).default('any'),
  colors: z.array(z.string().max(12)).max(12).optional(),
  clarities: z.array(z.string().max(6)).max(12).optional(),
  certified: z.boolean().optional(),
})
export type StoneQuality = z.infer<typeof StoneQuality>

const stone = {
  cut: choice('Cut', GEM_CUT_IDS, 'round', { group: 'Stone', widget: 'cut' }),
  stone: choice('Stone', GEM_MATERIAL_IDS, 'diamond', { group: 'Stone', widget: 'stone' }),
  quality: StoneQuality.optional(),
  sourcing: StoneSourcing.optional(),
}

/** Melee-sized stones: shown with the stone-size control and snapped to stock diameters. */
const meleeSize = { widget: 'stoneSize', snap: 'melee' } as const

const RingSizeSchema = z
  .object({ system: z.enum(RING_SIZE_SYSTEMS), value: z.number().min(0).max(80) })
  .default({ system: 'us', value: 6 })
  .meta({ title: 'Ring size', widget: 'ringSize' })

const fontChoice = choice('Font', ['sans', 'serif', 'script', 'block'], 'sans')

// ── Rings ────────────────────────────────────────────────────────────────────────────────────

export const RingShank = z
  .object({
    ...base,
    kind: z.literal('ringShank'),
    ...metal,
    size: RingSizeSchema,
    profile: choice('Profile', ['court', 'dShape', 'flat', 'flatCourt', 'knifeEdge'], 'court', {
      labels: { dShape: 'D-shape', flatCourt: 'Flat court', knifeEdge: 'Knife edge' },
      description:
        'Cross-section. court = rounded inside and out (comfort fit); dShape = flat inside, domed outside; flatCourt = flat outside, rounded inside.',
    }),
    widthTop: mm('Width at top', 1, 14, 2.2, { group: 'Band' }),
    widthBottom: mm('Width at base', 1, 14, 2.2, { group: 'Band' }),
    thicknessTop: mm('Thickness at top', 0.9, 5, 1.8, { group: 'Band' }),
    thicknessBottom: mm('Thickness at base', 0.9, 5, 1.6, { group: 'Band' }),
    shoulder: choice('Shoulders', ['plain', 'cathedral', 'split'], 'plain', {
      group: 'Shoulders',
      description:
        'cathedral = arches rising to the head; split = band divides in two near the head.',
    }),
    shoulderHeight: follows(
      mm('Cathedral rise', 0.5, 8, 3, {
        group: 'Shoulders',
        when: { shoulder: ['cathedral'] },
        description: 'Auto: the arches rise to just under the girdle of the stone on the band.',
      }),
      'head',
    ),
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
      angle: follows(
        deg('Angle around band', -180, 180, 0, {
          description:
            '0 = top of the ring; positive toward +X. Auto: 0, or packed beside the stones at the top for a side stone.',
        }),
        'head',
      ),
      side: z
        .enum(['left', 'right'])
        .optional()
        .meta({
          title: 'Side stone',
          labels: { left: 'Left', right: 'Right' },
          description:
            'A side stone sits 0.5 mm from the girdle of the stone beside it, and moves when that stone changes size.',
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
      inset: mm('Sink depth', -2, 5, 0, {
        description: 'How far the girdle sits below the surface.',
      }),
      spin: deg('Rotation', -180, 180, 0),
    }),
    z.object({ type: z.literal('free') }),
  ])
  .default({ type: 'free' })
  .meta({ title: 'Placement', group: 'Placement' })

export const Gem = z
  .object({
    ...base,
    kind: z.literal('gem'),
    ...stone,
    importSourceId: z.string().min(1).optional().meta({ internal: true }),
    importSourceFit: z
      .object({
        cut: z.enum(GEM_CUT_IDS),
        length: z.number().positive(),
        width: z.number().positive(),
        depth: z.number().positive(),
        /** The source's original girdle frame, in world millimetres. */
        transform: Transform.optional(),
      })
      .optional()
      .meta({ internal: true }),
    width: mm('Width', 0.6, 40, 6.5, {
      group: 'Stone',
      widget: 'stoneSize',
      description: 'Girdle width (diameter for rounds). 6.5 mm round ≈ 1 ct diamond.',
    }),
    lw: follows(
      ratio('Length : width', 0.8, 5, 1, {
        group: 'Stone',
        description:
          'Ignored for round; clamped to what the cut allows. Auto: the cut’s own ratio.',
      }),
      'stone',
    ),
    placement: GemPlacement,
  })
  .meta({ title: 'Stone', description: 'A single gemstone.' })

export const PRONG_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
export type ProngNumber = (typeof PRONG_NUMBERS)[number]
export const PRONG_TIP_OFFSET_MAX_MM = 0.5
const prongTipOffset = (number: ProngNumber) =>
  mm(`Prong ${number} tip offset`, -PRONG_TIP_OFFSET_MAX_MM, PRONG_TIP_OFFSET_MAX_MM, 0)
    .unwrap()
    .optional()
    .meta({ title: `Prong ${number} tip offset`, unit: 'mm', step: 0.05 })

const ProngTipOffsets = z
  .strictObject(
    Object.fromEntries(PRONG_NUMBERS.map((number) => [number, prongTipOffset(number)])) as Record<
      ProngNumber,
      ReturnType<typeof prongTipOffset>
    >,
  )
  .optional()
  .meta({
    title: 'Individual prong tips',
    group: 'Prongs',
    when: { style: ['prong', 'basket'] },
    widget: 'prongTips',
    description:
      'Sparse 1-based prong numbers in the current layout, counterclockwise from the stone’s +X axis as seen from the table. Double tips share a number. Offset is in mm (−0.5 to +0.5), positive outward and negative inward. To move one tip, update with {"prongTipOffsetsMm":{"1":0.25}}. Use null for a key to reset it. Changing the claw layout clears old offsets.',
  })

export const Setting = z
  .object({
    ...base,
    kind: z.literal('setting'),
    ...metal,
    importSourceId: z.string().min(1).optional().meta({ internal: true }),
    /** Set on the first edit to a confirmed head's geometry; undo restores the original shape. */
    importSourceRegenerated: z.literal(true).optional().meta({ internal: true }),
    gem: ref('Holds', ['gem']),
    style: choice('Style', ['prong', 'basket', 'bezel', 'halfBezel', 'flush'], 'prong', {
      labels: { halfBezel: 'Half bezel' },
      description:
        'prong = claws only; basket = claws joined by gallery rails; bezel = full metal rim; halfBezel = two arcs; flush = stone sunk into the host.',
    }),
    prongCount: follows(
      int('Prongs', 3, 8, 4, {
        group: 'Prongs',
        when: { style: ['prong', 'basket'] },
        description: 'Auto: the usual count for the stone’s shape and size.',
      }),
      'stone',
    ),
    prongDiameter: follows(
      mm('Prong wire', 0.5, 2.5, 1, {
        group: 'Prongs',
        when: { style: ['prong', 'basket'] },
        description: 'Auto: sized to the stone.',
      }),
      'stone',
    ),
    prongTip: choice('Tip', ['round', 'claw', 'tab', 'double'], 'round', {
      group: 'Prongs',
      when: { style: ['prong', 'basket'] },
    }),
    prongTipOffsetsMm: ProngTipOffsets,
    prongSpin: follows(
      deg('Prong rotation', -90, 90, 45, {
        group: 'Prongs',
        advanced: true,
        when: { style: ['prong', 'basket'] },
        description:
          '0 = a claw along the band. Auto: symmetric about the band for the claw count (four at 45, six at 0, three at 30). Shapes with points or corners put claws on them instead.',
      }),
      'stone',
    ),
    taper: ratio('Taper', 0, 0.8, 0.35, {
      group: 'Prongs',
      advanced: true,
      when: { style: ['prong', 'basket'] },
      description: 'How strongly the head narrows toward its base.',
    }),
    rails: int('Gallery rails', 0, 2, 1, { group: 'Prongs', when: { style: ['basket'] } }),
    arcs: choice('Half-bezel arcs', ['auto', 'ends', 'sides'], 'auto', {
      group: 'Bezel',
      when: { style: ['halfBezel'] },
      labels: { auto: 'Auto', ends: 'On the ends', sides: 'On the sides' },
      description:
        'Which part of the stone the two arcs hold. ends = the two ends of its length; sides = across it. Auto: on the points of a pointed stone, on the ends of a long one, across a round or square one.',
    }),
    wall: mm('Bezel wall', 0.3, 2, 0.55, {
      group: 'Bezel',
      when: { style: ['bezel', 'halfBezel'] },
    }),
  })
  .meta({ title: 'Setting', description: 'The head that holds one stone.' })

export const Halo = z
  .object({
    ...base,
    kind: z.literal('halo'),
    ...metal,
    ...stone,
    around: ref('Around', ['gem']),
    head: ref('Head', ['setting'], {
      advanced: true,
      follows: 'head',
      description:
        'The head holding the centre stone: the halo leaves room for its claws or bezel. Auto: the head on the same stone.',
    }).optional(),
    stoneWidth: mm('Stone size', 0.8, 3.5, 1.3, { group: 'Stone', ...meleeSize }),
    rows: int('Rows', 1, 3, 1),
    offset: mm('Gap to centre stone', 0.05, 1.5, 0.25),
    gap: mm('Gap between stones', 0.05, 0.6, 0.15, { advanced: true }),
    drop: mm('Drop below girdle', -1, 3, 0.4, {
      advanced: true,
      description: 'How far the halo sits below the centre stone’s girdle.',
    }),
    clearClaws: toggle('Clear the claws', true, {
      advanced: true,
      description:
        'Keep the centre stone’s claws clear of the halo stones: each claw stands in a notch between two stones, and round a claw on a sharp point (a pear’s, a marquise’s) the row steps out. Off: the layout of halos made before this option, stones evenly round at the gap to the centre stone with the claws crossing them.',
    }),
  })
  .meta({
    title: 'Halo',
    description: 'A ring of small stones following the outline of a centre stone.',
  })

export const GemRow = z
  .object({
    ...base,
    kind: z.literal('gemRow'),
    ...stone,
    host: ref('On band', ['ringShank']),
    setting: choice('Setting', ['pave', 'channel', 'sharedProng', 'bar', 'flush'], 'pave', {
      labels: { pave: 'Pavé', sharedProng: 'Shared prong' },
    }),
    stoneWidth: mm('Stone size', 0.8, 6, 1.5, { group: 'Stone', ...meleeSize }),
    graduateTo: follows(
      mm('Graduate to', 0.8, 6, 1.5, {
        group: 'Stone',
        ...meleeSize,
        description:
          'Stone size at the ends of the row. Auto: equal to Stone size (no graduation).',
      }),
      'stone',
    ),
    coverage: deg('Coverage', 10, 360, 150, {
      description: 'Arc of the band that carries stones. 180 = half eternity, 360 = full eternity.',
    }),
    center: deg('Centred at', -180, 180, 0),
    skipCenter: follows(
      deg('Skip at centre', 0, 180, 0, {
        description:
          'Arc left clear around the centre (for a head). Auto: clears the heads, claws and halo on the band by 0.4 mm.',
      }),
      'head',
    ),
    rows: int('Rows', 1, 5, 1),
    gap: mm('Gap between stones', 0.05, 1, 0.15, { advanced: true }),
  })
  .meta({
    title: 'Stone row',
    description: 'Stones set along a ring band: pavé shoulders, channel, eternity.',
  })

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
    sizeMax: mm('Largest stone', 0.8, 4, 1.8, { group: 'Stone', ...meleeSize }),
    sizeMin: mm('Smallest stone', 0.8, 4, 1.0, { group: 'Stone', ...meleeSize }),
    gap: mm('Gap between stones', 0.05, 0.6, 0.2, { advanced: true }),
    margin: mm('Edge margin', 0, 2, 0.35, { advanced: true }),
    coverage: ratio('Ice level', 0.05, 1, 1, {
      widget: 'slider',
      description: 'Fraction of the region to fill. 1 = fully iced out.',
    }),
    beads: toggle('Beads', true, { description: 'Raise bead prongs between stones.' }),
    seed: int('Layout seed', 0, 9999, 1, { advanced: true }),
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
        DrawnProfile,
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
    join: choice('Join letters', ['auto', 'off', 'underline'], 'auto', {
      advanced: true,
      description:
        'Text: tie loose letters and dots on so it casts as one piece, leave them loose, or stand the letters on a bar.',
    }),
  })
  .meta({
    title: 'Outline body',
    description:
      'Text, a logo path or a shape, extruded into a solid: name pendants, charms, tags.',
  })

export const ImportRoleSchema = z.enum(['unassigned', 'reference', 'metal', 'stone', 'setting'])
export type ImportRole = z.infer<typeof ImportRoleSchema>

export const MeshBody = z
  .object({
    ...base,
    kind: z.literal('meshBody'),
    ...metal,
    importRole: ImportRoleSchema.optional().meta({ internal: true }),
    source: z
      .discriminatedUnion('type', [
        z.object({
          type: z.literal('asset'),
          assetId: z.string().meta({ title: 'Mesh', widget: 'asset' }),
          rhinoLayer: z.string().optional(),
          rhinoContext: RhinoContext.optional(),
          nativeAssetId: z.string().optional(),
          /** The paired mesh id keeps a replacement mesh from exporting an older surface. */
          nativeMeshAssetId: z.string().optional(),
          nativeTransform: z.array(z.number()).length(16).optional(),
          rhinoObjectId: z.guid().optional(),
          rhinoInstancePath: z.array(z.guid()).max(32).optional(),
        }),
        z.object({
          type: z.literal('builtin'),
          name: choice('Model', ['trophy', 'crown', 'dice'], 'trophy'),
        }),
      ])
      .meta({ title: 'Source' }),
    keepSourcePlacement: toggle('Keep source size and position', false, {
      advanced: true,
      description: 'Use the coordinates in the mesh asset, in millimetres.',
    }),
    meshEdits: MeshEdits.optional(),
    height: mm('Height', 3, 200, 40, {
      description: 'The mesh is scaled to this overall height.',
      when: { keepSourcePlacement: [false] },
    }),
    flatBack: ratio('Flat back', 0, 0.9, 0, {
      widget: 'slider',
      description: 'Slices this fraction off the back so the piece lies flat.',
    }),
    hollow: mm('Hollow to wall', 0, 5, 0, { description: '0 keeps the body solid.' }),
    smooth: int('Smoothing', 0, 8, 0, { advanced: true }),
    detail: ratio('Detail', 0.02, 1, 1, {
      widget: 'slider',
      advanced: true,
      description: 'Mesh simplification.',
    }),
  })
  .refine(
    (node) =>
      !node.meshEdits ||
      (node.keepSourcePlacement &&
        node.source.type === 'asset' &&
        node.meshEdits.assetId === node.source.assetId),
    {
      path: ['meshEdits'],
      message:
        'Mesh edits require the same source asset and its original placement. Clear the edits to change either.',
    },
  )
  .meta({
    title: 'Sculpted body',
    description:
      'An imported, scanned or AI-generated mesh made castable: scaled, flat-backed, hollowed.',
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
    profile: z.string().max(20_000).optional().meta({
      title: 'Profile',
      widget: 'path',
      description: 'SVG path in mm in the (radius, height) half-plane; revolved about Z.',
    }),
    curve: ref('Profile curve', ['curve'], {
      description: 'A closed construction curve. Editing its points rebuilds the solid.',
    }).optional(),
    axis: z.enum(['vertical', 'horizontal']).optional().meta({
      title: 'Rotation axis',
      description: 'Direction on the drawing plane. Defaults to vertical.',
    }),
    axisOffset: z.number().min(-250).max(250).optional().meta({
      title: 'Axis offset',
      unit: 'mm',
      step: 0.05,
      description:
        'Horizontal position of a vertical axis or vertical position of a horizontal axis. Defaults to 0 mm.',
    }),
    angle: deg('Sweep', 1, 360, 360),
  })
  .superRefine(({ curve, profile, axis, axisOffset }, ctx) => {
    if ((curve === undefined) === (profile === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'Revolve needs exactly one closed curve or SVG profile.',
      })
    if (profile !== undefined && (axis !== undefined || axisOffset !== undefined))
      ctx.addIssue({
        code: 'custom',
        message:
          'An SVG profile revolves about world Z. Use a construction curve to choose the axis.',
      })
  })
  .meta({
    title: 'Revolve',
    description:
      'Turn a closed curve around an axis to make a solid, or supply an SVG radius-height profile about Z.',
  })

export const Pipe = z
  .object({
    ...base,
    kind: z.literal('pipe'),
    ...metal,
    curve: ref('Construction curve', ['curve'], {
      description:
        'The wire follows this construction curve’s vertices and closure. Use the curve ID or inline path points. Example node {"id":"wire","kind":"pipe","curve":"curve-id","width":1.5,"thickness":1.5}.',
    }).optional(),
    points: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .min(2)
      .max(400)
      .optional()
      .meta({ title: 'Path points', description: 'Inline XYZ points in mm for a smooth sweep.' }),
    closed: toggle('Closed', false, {
      description:
        'Close an inline path. Linked wires inherit closure from the construction curve.',
    }),
    section: choice('Section', ['round', 'square', 'halfRound'], 'round', {
      labels: { halfRound: 'Half round' },
    }),
    width: mm('Wire width', 0.4, 20, 1.5),
    thickness: mm('Wire thickness', 0.4, 20, 1.5),
    taper: ratio('End taper', 0, 1, 0, {
      advanced: true,
      description: 'Fraction by which the wire thins at its ends.',
    }),
  })
  .superRefine(({ curve, points }, ctx) => {
    if ((curve === undefined) === (points === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['curve'],
        message: 'Give the wire either a construction curve or inline path points.',
      })
  })
  .meta({
    title: 'Wire',
    description: 'A smooth wire swept along a construction curve or path points.',
  })

export const Primitive = z
  .object({
    ...base,
    kind: z.literal('primitive'),
    ...metal,
    shape: choice('Shape', ['box', 'cylinder', 'sphere', 'torus', 'cone'], 'box'),
    // Positive sizes only: a zero or negative size used to become 0.01 mm without a word.
    size: z
      .tuple([
        z.number().min(0.05).max(500),
        z.number().min(0.05).max(500),
        z.number().min(0.05).max(500),
      ])
      .default([5, 5, 5])
      .meta({ title: 'Size', widget: 'vec3', description: 'Bounding size in mm.' }),
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
  .meta({
    title: 'Combine',
    description: 'Union, subtract or intersect bodies. Inputs are consumed.',
  })

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
    opening: mm('Opening', 1.5, 20, 4.5, {
      description: 'Clear inner height — must pass the chain end.',
    }),
    width: mm('Width', 0.8, 15, 3),
    wire: mm('Wire', 0.5, 4, 1.1),
  })
  .meta({
    title: 'Bail',
    description: 'The loop a pendant hangs from. Auto-places at the top of its host.',
  })

export const Chain = z
  .object({
    ...base,
    kind: z.literal('chain'),
    ...metal,
    ...stone,
    // Only a tennis chain carries stones; on the other styles these did nothing.
    cut: choice('Cut', GEM_CUT_IDS, 'round', {
      group: 'Stone',
      widget: 'cut',
      when: { style: ['tennis'] },
    }),
    stone: choice('Stone', GEM_MATERIAL_IDS, 'diamond', {
      group: 'Stone',
      widget: 'stone',
      when: { style: ['tennis'] },
    }),
    style: choice('Style', ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box', 'tennis'], 'cable'),
    length: mm('Length', 100, 900, 457, { step: 1 }),
    linkWidth: mm('Link width', 0.8, 25, 3),
    wire: mm('Wire', 0.3, 6, 0.8),
    through: ref('Through bail', ['bail']).optional(),
    layout: choice('Layout', ['drape', 'straight'], 'drape'),
    clasp: choice('Clasp', ['none', 'lobster', 'box'], 'none', {
      labels: { none: 'None (closed loop)', lobster: 'Lobster', box: 'Box' },
      description: 'Opens a draped chain at the back so it can be put on.',
    }),
  })
  .meta({ title: 'Chain', description: 'Cable, curb/Cuban, rope, box or tennis chain.' })

export const Finding = z
  .object({
    ...base,
    kind: z.literal('finding'),
    ...metal,
    type: choice('Type', ['earringPost', 'butterfly', 'jumpRing', 'lobsterClasp'], 'earringPost', {
      labels: {
        earringPost: 'Earring post',
        butterfly: 'Butterfly back',
        jumpRing: 'Jump ring',
        lobsterClasp: 'Lobster clasp',
      },
    }),
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
    where: choice('Where', ['insideBand', 'outsideBand', 'front', 'back'], 'insideBand', {
      labels: { insideBand: 'Inside the band', outsideBand: 'Outside the band' },
    }),
    angle: deg('Position', -180, 180, 180, {
      description: 'Around the band; 180 = base of the ring.',
    }),
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
  .meta({
    title: 'Pattern',
    description: 'Repeats nodes around an axis, along a line, or mirrors them.',
  })

export const Group = z
  .object({
    ...base,
    kind: z.literal('group'),
    children: z.array(z.string()).max(500).meta({ title: 'Children' }),
  })
  .meta({ title: 'Group' })

export const ConstructionCurve = CurveDefinition.safeExtend({
  ...base,
  kind: z.literal('curve'),
  transform: z.never().optional(),
}).meta({ title: 'Construction curve', description: 'An editable planar polyline in millimetres.' })

export const NurbsCurve = NurbsDefinition.safeExtend({
  ...base,
  kind: z.literal('nurbsCurve'),
  transform: z.never().optional(),
  rhinoLayer: z.string().optional().meta({ title: 'Rhino layer' }),
  rhinoContext: RhinoContext.optional(),
  sourceObjectId: z.string().optional().meta({ title: 'Source Rhino object' }),
}).meta({
  title: 'NURBS curve',
  description:
    'An editable spatial curve with measured control points, rational weights and a knot vector.',
})

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
  curve: ConstructionCurve,
  nurbsCurve: NurbsCurve,
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
  ConstructionCurve,
  NurbsCurve,
])

export type Node = z.infer<typeof NodeSchema>
/** What callers may pass when creating a node: defaults are optional. */
export type NodeInput = z.input<typeof NodeSchema>
export type NodeOf<K extends NodeKind> = Extract<Node, { kind: K }>
export type NodeInputOf<K extends NodeKind> = Extract<NodeInput, { kind: K }>

export const isBodyKind = (k: NodeKind): boolean => (BODY_KINDS as readonly string[]).includes(k)

/** Old Rhino imports have provenance but no role. Other imports keep their existing metal behavior. */
export function importRoleOf(node: NodeOf<'meshBody'>): ImportRole | undefined {
  const { source, importRole } = node
  if (importRole !== undefined) return importRole
  if (
    source.type === 'asset' &&
    (source.rhinoLayer !== undefined ||
      source.rhinoObjectId !== undefined ||
      source.rhinoInstancePath !== undefined ||
      source.nativeAssetId !== undefined)
  )
    return node.material === DEFAULT_METAL ? 'unassigned' : 'metal'
}

/** Whether a source is geometry for modeling or exchange until it is assigned to production. */
export function isImportReference(node: Node): node is NodeOf<'meshBody'> {
  if (node.kind !== 'meshBody') return false
  const role = importRoleOf(node)
  return role !== undefined && role !== 'metal'
}

export function importSourceRole(node: Node): 'stone' | 'setting' | undefined {
  if (node.kind === 'gem' && node.importSourceId) return 'stone'
  if (node.kind === 'setting' && node.importSourceId) return 'setting'
}

/** Ids of every node this node depends on. Drives evaluation order and integrity checks. */
export function nodeRefs(n: Node): string[] {
  switch (n.kind) {
    case 'gem': {
      const refs = n.importSourceId ? [n.importSourceId] : []
      if (n.placement.type === 'ringTop') refs.push(n.placement.shank)
      if (n.placement.type === 'surface') refs.push(n.placement.host)
      return [...new Set(refs)]
    }
    case 'setting':
      return n.importSourceId ? [n.gem, n.importSourceId] : [n.gem]
    case 'halo':
      return n.head ? [n.around, n.head] : [n.around]
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
    case 'revolve':
    case 'pipe':
      return n.curve === undefined ? [] : [n.curve]
    case 'pattern':
      return n.sources
    case 'group':
      return n.children
    default:
      return []
  }
}
