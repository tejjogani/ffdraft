/**
 * Recipes turn a confirmed {@link PieceSpec} into a first design. They only author nodes — the
 * same nodes a person or the assistant could add by hand — so the result is fully editable.
 * Templates are just specs, which keeps "start from a template" and "the assistant planned
 * this with you" on one code path.
 */
import { z } from 'zod'
import { type Design, designFrom, type PieceKind } from '../design/design'
import { unpinAtRule } from '../design/mount'
import { NODE_SCHEMAS, type NodeInput } from '../design/nodes'
import {
  type Archetype,
  type PieceSpec,
  type PieceSpecInput,
  PieceSpecSchema,
  type StoneSpec,
} from '../design/spec'
import { gemDimsFromCarat } from '../domain/gems'
import { ringInnerDiameter } from '../domain/sizes'

const FACE_FRONT: [number, number, number] = [90, 0, 0]

const widthOf = (s: StoneSpec | undefined, fallback: number): number =>
  !s
    ? fallback
    : s.carat
      ? Number(gemDimsFromCarat(s.cut, s.carat, s.stone, s.lw).width.toFixed(2))
      : (s.widthMm ?? fallback)

/**
 * The length : width the spec pins, if any. Absent, the stone follows its cut's own ratio
 * (design/mount.ts), which is also the ratio its carat was sized with.
 */
const lwOf = (s: StoneSpec | undefined): { lw?: number } => (s?.lw ? { lw: s.lw } : {})

/** The claw count the spec pins, if any; absent, the head follows the stone (design/mount.ts). */
const prongsOf = (s: StoneSpec | undefined): { prongCount?: number } =>
  s?.prongs ? { prongCount: s.prongs } : {}

const byRole = (spec: PieceSpec, role: StoneSpec['role']) =>
  spec.stones.find((s) => s.role === role)

const headStyle = (s: StoneSpec | undefined) =>
  s?.setting === 'bezel' ||
  s?.setting === 'halfBezel' ||
  s?.setting === 'basket' ||
  s?.setting === 'flush'
    ? s.setting
    : 'prong'

function ring(spec: PieceSpec, notes: string[]): NodeInput[] {
  const metal = {
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
  }
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
        ...lwOf(center),
        placement: { type: 'ringTop', shank: 'band', elevation: 1.2, spin: 0 },
      },
      {
        id: 'head',
        kind: 'setting',
        name: 'Head',
        ...metal,
        gem: 'center',
        style: headStyle(center),
        // Claw count, wire and rotation follow the stone (design/mount.ts) unless the spec pins them.
        ...prongsOf(center),
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
      // Side stones are packed 0.5 mm from the centre girdle by the mount rules, and move
      // with the centre stone; their size stays (they are bought as a matched pair).
      for (const i of [0, 1]) {
        nodes.push(
          {
            id: `side${i + 1}`,
            kind: 'gem',
            name: i ? 'Side stone R' : 'Side stone L',
            cut: side?.cut ?? 'round',
            stone: side?.stone ?? 'diamond',
            width: sw,
            ...lwOf(side),
            placement: {
              type: 'ringTop',
              shank: 'band',
              side: i ? 'right' : 'left',
              elevation: 0.9,
              spin: 0,
            },
          },
          {
            id: `sideHead${i + 1}`,
            kind: 'setting',
            name: i ? 'Side head R' : 'Side head L',
            ...metal,
            gem: `side${i + 1}`,
            style: headStyle(side),
            ...prongsOf(side),
          },
        )
      }
    }
  }

  if (accent || a === 'eternity') {
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
      // The arc left clear for the head follows the head (design/mount.ts).
    })
  }

  if (spec.engraving) {
    // Text wrapped inside the band may take 97 % of its round (the kernel's engraving.tooLong);
    // letters advance about 0.7 of their height each, so a long text is set smaller, down to
    // the least letter that engraves cleanly.
    const room = 0.97 * 2 * Math.PI * radius
    const fit =
      Math.floor((room / (ENGRAVING_ADVANCE * Array.from(spec.engraving).length)) * 10) / 10
    const size = Math.max(ENGRAVING_MIN, Math.min(ENGRAVING_SIZE, fit))
    if (fit < ENGRAVING_MIN)
      notes.push(
        `The engraving is too long for the inside of this band even in ${ENGRAVING_MIN} mm letters; shorten it.`,
      )
    nodes.push({
      id: 'engraving',
      kind: 'engraving',
      name: 'Engraving',
      host: 'band',
      text: spec.engraving,
      ...(size < ENGRAVING_SIZE && { size }),
    })
  }
  return nodes
}

/** Default letter height of an engraving, the least that engraves cleanly, and advance per letter per mm of height. */
const ENGRAVING_SIZE = 1.4
const ENGRAVING_MIN = 0.6
const ENGRAVING_ADVANCE = 0.7

function pendant(spec: PieceSpec, notes: string[]): NodeInput[] {
  const metal = {
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
  }
  const a = spec.archetype
  const b = spec.body
  const height = b?.heightMm ?? 24
  const nodes: NodeInput[] = []
  let host = 'body'

  // A solitaire or halo asked for as a pendant is the solitaire pendant (with its halo).
  if (a === 'pendantSolitaire' || a === 'solitaire' || a === 'halo') {
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
        ...lwOf(center),
        transform: { position: [0, 0, 0], rotation: FACE_FRONT, scale: 1 },
      },
      {
        id: 'head',
        kind: 'setting',
        name: 'Setting',
        ...metal,
        gem: 'center',
        style: headStyle(center) === 'prong' ? 'basket' : headStyle(center),
        ...prongsOf(center),
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
      // The halo is the outermost metal: a bail on the head would rise through its top stones.
      host = 'halo'
    }
  } else if (a === 'namePendant') {
    // An iced name is set in block letters: a script's hairlines take no stone with its seat
    // wall (1.1 mm melee came out as an empty field up to 20 mm high).
    const iced = byRole(spec, 'pave') !== undefined && (b?.iceLevel ?? 1) > 0
    nodes.push({
      id: 'body',
      kind: 'vectorBody',
      name: 'Name',
      ...metal,
      source: { type: 'text', text: b?.text ?? 'Amara', font: iced ? 'block' : 'script' },
      height: b?.heightMm ?? 9,
      thickness: b?.thicknessMm ?? (iced ? 2.5 : 1.4),
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
    // A cast body this size is hollowed to a wall that still takes the pavé's deepest seat
    // (0.65 × the largest stone + 0.4 mm), and flat-backed so it lies against the chest: the
    // trade scoops the back of an iced piece, or a 45 mm trophy weighs 130 g.
    const wall = Number(Math.max(1.2, 0.65 * paveMax(spec) + 0.4).toFixed(2))
    const sculpt = { height, flatBack: 0.5, hollow: wall }
    nodes.push(
      b?.meshAssetId
        ? {
            id: 'body',
            kind: 'meshBody',
            name: b.shape ?? 'Sculpt',
            ...metal,
            source: { type: 'asset', assetId: b.meshAssetId },
            ...sculpt,
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
              ...sculpt,
            },
    )
  }

  const solitaire = a === 'pendantSolitaire' || a === 'solitaire' || a === 'halo'
  const pave = byRole(spec, 'pave')
  const ice = b?.iceLevel ?? 1
  if (solitaire && pave)
    // A head or a halo has no face to pavé: the field would come out empty (pave.empty).
    notes.push(
      `A ${a === 'halo' ? 'halo' : 'solitaire'} pendant has no body to pavé, so the pavé stones were left out; a halo frames the stone with melee.`,
    )
  else if ((a === 'icedPendant' || pave) && ice > 0) {
    const sizeMax = paveMax(spec)
    nodes.push({
      id: 'ice',
      kind: 'pave',
      name: 'Pavé',
      host,
      stone: pave?.stone ?? 'diamond',
      sizeMax,
      // 1 mm and up: the 0.8 mm melee that would reach narrower parts sits too near their edges
      // to keep a seat wall (seat.wall on the trophy rises from 11 to 17 stones).
      sizeMin: Math.min(1, sizeMax),
      // Half a millimetre of metal from the field's edge, so the outer seats keep their wall.
      margin: 0.5,
      coverage: ice,
    })
  } else if (ice === 0 && (a === 'icedPendant' || pave))
    notes.push('Ice level 0 leaves the piece unset, so no pavé was added.')

  if (spec.kind === 'brooch') {
    // A brooch is worn on a pin, not hung; there is no pin finding yet, so it is said, not
    // replaced by a bail.
    notes.push(
      'There is no brooch pin among the findings yet, so the piece has no fitting: add a pin by hand, or make it a pendant to hang it from a bail.',
    )
    return nodes
  }
  const iced = nodes.some((n) => n.kind === 'pave')
  const body = nodes.find((n) => n.id === 'body')
  nodes.push(bailNode(spec, host, solitaire ? undefined : height, iced, hiddenFits(body)))
  if (spec.chain) nodes.push(chainNode(spec, notes, 'bail'))
  return nodes
}

/**
 * Tallest sculpted body a hidden bail is planned for, mm. A hidden loop on a scooped back is
 * carried down the back to the metal below on a strap (the kernel's bail); past this the open
 * back is too long to strap (a 150 mm trophy found no metal to land on: bail.weakJoint).
 */
const HIDDEN_MAX = 120
/**
 * Shortest sculpted body a hidden bail is planned for, mm. Below it the scooped back leaves only
 * the rim and a neck too thin to strap to: a 20 mm trophy held its loop by a tenth of a lap of
 * its back run (the kernel's bail.weakJoint), so a small sculpt hangs from a bail on top.
 */
const HIDDEN_MIN = 25

/**
 * Whether a hidden bail suits this body at all, before its size is checked. A sculpted body has
 * metal across its top to hide a loop under. Text does only when it is one letter: across a
 * word the top is the dip between letters or a lowercase letter, far under the body's height,
 * so a slot sized from the height sat at the centre of mass (bail.hiddenLow on iced names and
 * on BOSS, bail.unsupported on Tej).
 */
function hiddenFits(body: NodeInput | undefined): boolean {
  if (!body) return false
  if (body.kind === 'meshBody')
    return (body.height ?? 0) >= HIDDEN_MIN && (body.height ?? 0) <= HIDDEN_MAX
  if (body.kind !== 'vectorBody' || body.source?.type !== 'text') return false
  return Array.from((body.source.text ?? '').trim()).length === 1
}

/** The largest pavé stone: the spec's, or 1.3 mm, which a 1.25 mm wall seats. */
const paveMax = (spec: PieceSpec) => byRole(spec, 'pave')?.widthMm ?? 1.3

/**
 * The depth of a tennis line as the kernel builds it (stone, box, plate and hinge), mm: about
 * 1.25 × the link on wide links, and more than that on fine ones, whose hinge and plate do not
 * shrink with the stone (2.1 × 3.1 mm at 2 mm, 3.0 × 3.7 at 3, 6.2 × 7.1 at 6).
 */
const tennisDepth = (w: number) => Math.max(1.25 * w, w + 1.15)

/**
 * The bail for the pendant's chain. Its hole passes the chain's section with the 1.5 mm the
 * kernel's bail check asks for, by the same fits the canon's `bail.opening` rule uses (holes
 * measured on the kernel): in a ring or tube, round chain needs its width + 1.7, flat links
 * 1.15 × width + 2, box chain its diagonal, a tennis chain the diagonal of its deeper section.
 * A ring on fine round chain, a tube on everything heavier. Behind a paved body a hidden bail
 * keeps the top stones clear (canon `bail.chainStyle`), but only on a body that has metal across
 * its top to hide it under (a sculpt, or a single letter: see hiddenFits) and is tall enough to
 * hide it high up: a hidden slot whose hole falls out of the body's top third tips the piece
 * forward (the kernel's bail.hiddenLow), so a small iced piece, a name, and any setting get a
 * bail on top.
 * On a body, wire, width and opening grow with the piece, as the canon's `bail.wire` and
 * `bail.opening` rules do, so a heavy piece is not hung on a fine wire.
 */
function bailNode(
  spec: PieceSpec,
  host: string,
  bodyHeight: number | undefined,
  iced: boolean,
  hiddenSuits: boolean,
): NodeInput {
  const style = spec.chain?.style ?? 'cable'
  const w = spec.chain?.widthMm ?? 1.2
  const round = style === 'cable' || style === 'rope'
  const flat = !round && style !== 'box' && style !== 'tennis'
  const wire = bodyHeight ? Math.min(2.5, Math.max(1.1, 1.0 + 0.012 * bodyHeight)) : 1.1
  // The hidden slot is `opening` high and 0.6 of that deep: it must take the chain's width up
  // and its depth across (flat links half their width). The canon's fit for a hidden bail is
  // the floor, so the recipe and the canon's bail.opening rule agree.
  const across = flat ? 0.5 * w : style === 'tennis' ? tennisDepth(w) : w
  const canonHidden = style === 'tennis' ? 2.05 * w + 3.6 : flat ? 1.15 * w + 2 : 2.18 * w + 0.95
  const hiddenOpening = Math.max(Math.max(w + 1.5, (across + 1.5) / 0.6) + 0.5, canonHidden + 0.3)
  // The slot's centre sits a wire and half its height under the top. The kernel wants it in
  // the top third; 0.3 of the height leaves room for a top that is lower across the slot than
  // at its highest point (a letter's apex).
  const hidden =
    iced &&
    hiddenSuits &&
    bodyHeight !== undefined &&
    1.5 * wire + hiddenOpening / 2 <= 0.3 * bodyHeight
  const need =
    style === 'tennis'
      ? Math.hypot(w + 1.5, w + 2.1) + 0.2
      : style === 'box'
        ? 1.415 * (w + 1.5) + 0.1
        : round
          ? w + 1.7
          : 1.15 * w + 2.0
  // Capped at the largest opening a bail takes (20 mm): a 200 mm trophy asked for 25 mm and
  // came out with a note that 20 was used.
  const forHeight = bodyHeight ? Math.min(20, 0.15 * bodyHeight - 2 * wire) : 0
  const opening = hidden ? hiddenOpening : Math.max(need + 0.3, forHeight)
  return {
    id: 'bail',
    kind: 'bail',
    name: 'Bail',
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
    host,
    // A round wire ring suits fine chain on a light piece; a big body (its bail's opening grows
    // with it) wants a tube's broad band, not a 17 mm ring of wire.
    style: hidden ? 'hidden' : round && w <= 2 && (bodyHeight ?? 0) <= 60 ? 'ring' : 'tube',
    opening: Number(opening.toFixed(2)),
    width: Number(Math.min(6, Math.max(2.5, 0.5 * opening)).toFixed(2)),
    wire: Number(wire.toFixed(2)),
  }
}

/**
 * Wire for each chain style, as the kernel builds it best: thin enough that it is not thinned
 * (no `chain.wireThinned`), and for tennis the accent prong a stone of that size takes.
 */
function chainWire(style: string, width: number, stone: number): number {
  const wire =
    style === 'cable'
      ? width / 3.9
      : style === 'rope'
        ? width / 8
        : style === 'box'
          ? width / 5.5
          : style === 'figaro' || style === 'curb'
            ? 0.22 * width
            : style === 'tennis'
              ? Math.min(0.4 * stone, Math.max(0.8, 0.3 * stone))
              : 0.26 * width
  // Rounded down, so the kernel never thins it (rounding up passed its cap: rope 3 mm 0.375
  // became 0.38). The node's 0.3 mm floor is above the kernel's cap on fine rope and box, whose
  // wires are thin by construction; there the floor holds and the kernel thins it, noted as info.
  return Math.max(0.3, Math.floor(wire * 100 + 1e-9) / 100)
}

/** Narrowest tennis link the kernel builds, mm. */
const TENNIS_MIN = 1.8

function chainNode(spec: PieceSpec, notes: string[], through?: string): NodeInput {
  const c = spec.chain ?? {
    style: spec.archetype === 'tennis' ? ('tennis' as const) : ('cuban' as const),
    lengthMm: spec.kind === 'bracelet' ? 180 : 457,
    widthMm: spec.archetype === 'tennis' ? 3.4 : 8,
  }
  const accent = byRole(spec, 'accent') ?? byRole(spec, 'pave')
  let linkWidth = c.widthMm
  // A tennis line is specified by its stones: the link is the stone plus its box wall (the
  // kernel's tennis link takes a wall of half the prong wire, at least 0.4 mm). Only when the
  // line is the piece: a pendant's accent or pavé stones are its own, not its chain's.
  const line = through ? undefined : byRole(spec, 'accent')
  if (c.style === 'tennis' && line?.widthMm) {
    const prong = chainWire('tennis', 0, line.widthMm)
    const fromStone = Number((line.widthMm + Math.max(0.4, 0.5 * prong)).toFixed(2))
    if (Math.abs(fromStone - linkWidth) > 0.2)
      notes.push(
        `${line.widthMm} mm stones need ${fromStone} mm tennis links; the chain's ${linkWidth} mm was changed to match.`,
      )
    linkWidth = fromStone
  }
  // Under this the kernel's tennis box leaves no room for its hinge (the link fails to build).
  if (c.style === 'tennis' && linkWidth < TENNIS_MIN) {
    notes.push(
      `Tennis links under ${TENNIS_MIN} mm cannot carry their hinge; ${TENNIS_MIN} mm links were used.`,
    )
    linkWidth = TENNIS_MIN
  }
  const stoneWidth = c.style === 'tennis' ? (line?.widthMm ?? linkWidth - 0.4) : linkWidth
  return {
    id: 'chain',
    kind: 'chain',
    name: 'Chain',
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
    style: c.style,
    length: c.lengthMm,
    linkWidth,
    wire: chainWire(c.style, linkWidth, stoneWidth),
    stone: accent?.stone ?? 'diamond',
    ...(c.style === 'tennis' && line ? { cut: line.cut } : {}),
    ...(through ? { through } : {}),
    // A chain is put on by its clasp: a tennis line closes in a box clasp, any other in a
    // lobster (a closed loop could not be put on at all).
    clasp: c.style === 'tennis' ? 'box' : 'lobster',
  }
}

function studs(spec: PieceSpec): NodeInput[] {
  const metal = {
    material: spec.metal.alloy,
    finish: spec.metal.finish,
    plating: spec.metal.plating,
  }
  const center = byRole(spec, 'center')
  const cut = center?.cut ?? 'round'
  // A flush setting sinks the stone into a host body; a stud has none, so it gets a bezel.
  const style = headStyle(center)
  // A halo stud: the halo goes round each stone and is mirrored with it.
  const halo = byRole(spec, 'halo')
  const framed = spec.archetype === 'halo' || halo !== undefined
  return [
    {
      id: 'stone',
      kind: 'gem',
      name: 'Stone',
      cut,
      stone: center?.stone ?? 'diamond',
      width: widthOf(center, 5),
      ...lwOf(center),
      transform: { position: [-7, 0, 0], rotation: FACE_FRONT, scale: 1 },
    },
    {
      id: 'head',
      kind: 'setting',
      name: 'Setting',
      ...metal,
      gem: 'stone',
      style: style === 'prong' ? 'basket' : style === 'flush' ? 'bezel' : style,
      ...prongsOf(center),
    },
    ...(framed
      ? [
          {
            id: 'halo',
            kind: 'halo' as const,
            name: 'Halo',
            ...metal,
            around: 'stone',
            cut: 'round' as const,
            stone: halo?.stone ?? 'diamond',
            stoneWidth: widthOf(halo, 1.1),
          },
        ]
      : []),
    { id: 'post', kind: 'finding', name: 'Post', ...metal, type: 'earringPost', host: 'head' },
    {
      id: 'pair',
      kind: 'pattern',
      name: 'Pair',
      sources: framed ? ['stone', 'head', 'halo', 'post'] : ['stone', 'head', 'post'],
      type: 'mirror',
      axis: 'x',
    },
  ]
}

/** Archetypes each kind has a recipe for; any other pairing is reported, not guessed at. */
const RECIPES: Record<PieceKind, readonly Archetype[]> = {
  ring: ['solitaire', 'halo', 'threeStone', 'eternity', 'band', 'signet', 'custom'],
  pendant: [
    'pendantSolitaire',
    'solitaire',
    'halo',
    'namePendant',
    'icedPendant',
    'medallion',
    'tennis',
    'cuban',
    'custom',
  ],
  necklace: [
    'pendantSolitaire',
    'solitaire',
    'halo',
    'namePendant',
    'icedPendant',
    'medallion',
    'tennis',
    'cuban',
    'custom',
  ],
  earrings: ['studs', 'solitaire', 'halo', 'custom'],
  bracelet: ['tennis', 'cuban', 'custom'],
  chain: ['tennis', 'cuban', 'custom'],
  brooch: ['icedPendant', 'medallion', 'namePendant', 'custom'],
  other: [
    'pendantSolitaire',
    'namePendant',
    'icedPendant',
    'medallion',
    'studs',
    'tennis',
    'cuban',
    'custom',
  ],
}

/** A node field's declared range, read from its schema so the numbers live in one place. */
function rangeOf(
  kind: NodeInput['kind'],
  key: string,
): { min: number; max: number; title: string } | null {
  let field: unknown = (NODE_SCHEMAS[kind] as unknown as { shape: Record<string, unknown> }).shape[
    key
  ]
  let title = key
  while (field instanceof z.ZodDefault || field instanceof z.ZodOptional) {
    title = (z.globalRegistry.get(field)?.title as string | undefined) ?? title
    field = field.unwrap()
  }
  if (!(field instanceof z.ZodNumber)) return null
  title = (z.globalRegistry.get(field)?.title as string | undefined) ?? title
  return { min: field.minValue ?? -Infinity, max: field.maxValue ?? Infinity, title }
}

/**
 * Makes the recipe total over every spec the spec schema accepts: each number copied or derived
 * into a node is brought inside that node field's range, and each change is noted for the
 * designer. Without this a valid spec (a 25 mm chain, a 200 mm name) fails the whole build.
 */
function fitNodes(nodes: NodeInput[], notes: string[]): NodeInput[] {
  return nodes.map((node) => {
    const out: Record<string, unknown> = { ...node }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== 'number') continue
      const range = rangeOf(node.kind, key)
      if (!range) continue
      const fitted = Math.min(range.max, Math.max(range.min, value))
      if (fitted === value) continue
      out[key] = fitted
      notes.push(
        `${node.name ?? node.id}: ${range.title.toLowerCase()} ${Number(value.toFixed(2))} is outside ${range.min}–${range.max}, so ${fitted} was used.`,
      )
    }
    if (node.kind === 'ringShank' && node.size) {
      const value = Math.min(80, Math.max(0, node.size.value))
      if (value !== node.size.value) {
        notes.push(`Ring size ${node.size.value} is outside 0–80, so ${value} was used.`)
        out.size = { ...node.size, value }
      }
    }
    // The pavé's smallest stone can never be larger than its largest.
    if (node.kind === 'pave' && typeof out.sizeMin === 'number' && typeof out.sizeMax === 'number')
      out.sizeMin = Math.min(out.sizeMin, out.sizeMax)
    return out as NodeInput
  })
}

/** What a recipe built, and what it had to change or could not do, for the designer. */
export interface RecipeResult {
  design: Design
  notes: string[]
}

/** Builds the first editable design for a spec, with notes on anything adjusted. */
export function planDesign(input: PieceSpecInput): RecipeResult {
  const spec = PieceSpecSchema.parse(input)
  const notes: string[] = []
  const kind = spec.kind as PieceKind
  const a = spec.archetype
  let nodes: NodeInput[]
  if (!RECIPES[kind].includes(a)) {
    notes.push(
      `There is no recipe for a ${kind} built as ${a}, so the design starts empty; pick an archetype made for a ${kind} (${RECIPES[kind].join(', ')}).`,
    )
    nodes = []
  } else if (a === 'custom') nodes = []
  else if (kind === 'ring') nodes = ring(spec, notes)
  else if (a === 'studs' || kind === 'earrings') nodes = studs(spec)
  else if (a === 'tennis' || a === 'cuban' || kind === 'chain' || kind === 'bracelet')
    nodes = [chainNode(spec, notes)]
  else nodes = pendant(spec, notes)
  // A value the spec pinned that equals what the mount rules give is left to follow them, so
  // a later change of stone moves it too (design/mount.ts).
  return { design: unpinAtRule(designFrom(kind, fitNodes(nodes, notes))), notes }
}

/** Builds the first editable design for a spec. */
export function buildDesign(input: PieceSpecInput): Design {
  return planDesign(input).design
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
      summary: 'A hollow sculpted trophy with a pavé face, on a Cuban link.',
      style: ['hip hop', 'statement'],
      metal: { alloy: 'au14k-yellow' },
      body: { heightMm: 45, shape: 'Trophy', iceLevel: 1 },
      stones: [{ role: 'pave', stone: 'diamond-lab', widthMm: 1.3 }],
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
      stones: [{ role: 'pave', stone: 'moissanite', widthMm: 1.3 }],
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
