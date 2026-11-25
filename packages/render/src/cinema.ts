/**
 * The cinematographer's vocabulary: how fine jewelry is photographed and filmed, as numbers the
 * renderers share. Pure, used by the server (the assistant's `scenes.suggest` and its framing
 * check before a take), the studio (the Motion control and aspect choices) and tests.
 *
 *  - `pieceFeatures`: what matters about a piece in pictures (the centre stone, a halo, the
 *    gallery seen in profile, pavé, an engraving, a chain), read from its design;
 *  - `shotVocabulary` / `placeShot`: the shots a jeweller takes of each kind of piece, each
 *    placed as a custom camera that frames the piece (or, for a macro, the centre stone) at the
 *    fill the numeric critique accepts;
 *  - `shotFraming`: the framing check before render time is spent: is anything cut off, is the
 *    subject too small, and how to fix it;
 *  - `MOTION_CHOICES`, `ASPECTS`, `cinemaQuestions`: animations, aspect ratios and the two or
 *    three quick questions a Render job asks, with defaults so one "Go" is a full answer.
 */
import {
  type Design,
  GEM_CUTS,
  GEM_MATERIALS,
  METALS,
  type PieceKind,
  type QuickQuestion,
  type RenderScene,
} from '@pave/schema'
import { CHECKS } from './assess'
import { cameraPose, corners, framePoints, resolveCamera } from './camera'
import { type Framing, predictFraming, projectPoint } from './framing'
import { add, type Vec3 } from './math'
import { boundsCenter, boundsRadius, type SceneSubject, stoneCenter, stoneWidth } from './subject'

// ── What matters about the piece ──────────────────────────────────────────────────────────────

export interface PieceFeatures {
  kind: PieceKind
  /** One plain line per thing that matters in pictures, the centre stone first. */
  lines: string[]
  centreStoneNodeId: string | null
  halo: boolean
  pave: boolean
  engraving: boolean
  /** A ring's head shows its gallery (the metal under the stone) in profile. */
  gallery: boolean
  chain: boolean
  /** Stones in the design, the centre one included (melee counted by the kernel when known). */
  stones: number
}

type AnyNode = { kind: string; [k: string]: unknown }

/** A round diamond's weight from its width: the trade's rule of thumb (6.5 mm ≈ 1 ct). */
const roundCarats = (mm: number) => Math.round(mm ** 3 * 0.0037 * 100) / 100

export function pieceFeatures(design: Design, subject?: SceneSubject): PieceFeatures {
  const nodes = Object.entries(design.nodes) as [string, AnyNode][]
  const of = (kind: string) => nodes.filter(([, n]) => n.kind === kind)
  const centreFromKernel = subject?.stones.find((s) => s.role === 'center')?.nodeId ?? null
  const gems = of('gem')
  const centre =
    gems.find(([id]) => id === centreFromKernel) ??
    // The largest single stone is the one people look at.
    [...gems].sort((a, b) => Number(b[1].width ?? 0) - Number(a[1].width ?? 0))[0]
  const lines: string[] = []
  if (centre) {
    const [, g] = centre
    const cut = GEM_CUTS[g.cut as keyof typeof GEM_CUTS]?.label ?? String(g.cut ?? 'stone')
    const stone = GEM_MATERIALS[g.stone as keyof typeof GEM_MATERIALS]?.label ?? 'stone'
    const width = Number(g.width ?? 0)
    const ct =
      g.cut === 'round' && String(g.stone).startsWith('diamond') && width
        ? `, about ${roundCarats(width)} ct`
        : ''
    lines.push(
      `Centre stone: ${cut.toLowerCase()} ${stone.toLowerCase()}, ${width} mm${ct}. It is the hero of every shot: focus on its table, and light it for fire.`,
    )
  }
  const halo = of('halo').length > 0
  if (halo)
    lines.push(
      'A halo round the centre stone: a three-quarter angle shows its depth; small hard lights make it sparkle.',
    )
  const rows = of('gemRow')
  const pave = of('pave').length > 0 || rows.some(([, r]) => r.setting === 'pave')
  if (pave)
    lines.push('Pavé: it reads only with light raking across it, best in a macro or a low angle.')
  else if (rows.length)
    lines.push(
      'A row of stones along the band: a low or three-quarter angle runs the eye along it.',
    )
  const engraving = of('engraving').length > 0
  if (engraving)
    lines.push(
      'An engraving: it needs a low, raking light and a close, square-on view to be legible.',
    )
  const settings = of('setting')
  const gallery = design.kind === 'ring' && settings.length > 0
  if (gallery) {
    const basket = settings.some(([, s]) => s.style === 'basket')
    lines.push(
      `The head${basket ? '’s basket and gallery rails' : '’s gallery (the metal under the stone)'} shows in profile, with the height of the setting.`,
    )
  }
  const chain = of('chain').length > 0
  if (chain)
    lines.push('It hangs on a chain: shoot it hanging, front-on, with the chain leading in.')
  if (of('bail').length) lines.push('The bail shows from the side and the back.')
  const metal = nodes
    .map(([, n]) => n.material)
    .find((m): m is string => typeof m === 'string' && m in METALS)
  if (metal)
    lines.push(
      `Metal: ${METALS[metal as keyof typeof METALS].label}. Edges read when a long soft light runs along them.`,
    )
  const stones = subject?.stones.length ?? gems.length
  return {
    kind: design.kind,
    lines,
    centreStoneNodeId: centre?.[0] ?? null,
    halo,
    pave,
    engraving,
    gallery,
    chain,
    stones,
  }
}

// ── Shots ────────────────────────────────────────────────────────────────────────────────────

export interface ShotRecipe {
  key: string
  title: string
  /** What the shot shows, in a jeweller's words. */
  why: string
  azimuth: number
  elevation: number
  focalLength: number
  /** Share of the frame the subject's larger side fills. */
  fill: number
  /** `stone` frames the centre stone (a macro); `piece` the whole piece. */
  frame: 'piece' | 'stone'
  /** Background blur for a macro; unset keeps everything sharp. */
  fStop?: number
  basePreset: NonNullable<RenderScene['camera']['basePreset']>
}

const r = (s: ShotRecipe) => s

const HERO = r({
  key: 'hero',
  title: 'Hero three-quarter',
  why: 'The picture people buy from: the stone faces the camera at a three-quarter angle, so the band and the head read together.',
  azimuth: 35,
  elevation: 22,
  focalLength: 100,
  fill: 0.66,
  frame: 'piece',
  basePreset: 'hero',
})
const MACRO = r({
  key: 'macro',
  title: 'Macro on the centre stone',
  why: 'Close on the centre stone and its claws: fire, cut and how it is held.',
  azimuth: 28,
  elevation: 34,
  focalLength: 105,
  fill: 0.6,
  frame: 'stone',
  fStop: 5.6,
  basePreset: 'macro',
})
const TOP = r({
  key: 'top',
  title: 'Top-down',
  why: 'Straight down on the face: the outline of the stone and the setting, as it looks on the hand.',
  azimuth: 0,
  elevation: 88,
  focalLength: 100,
  fill: 0.62,
  frame: 'piece',
  basePreset: 'top',
})

const VOCABULARY: Record<PieceKind, ShotRecipe[]> = {
  ring: [
    HERO,
    r({
      key: 'profile',
      title: 'Profile',
      why: 'Side-on at eye level: the gallery under the stone, the height of the head and the shank’s line.',
      azimuth: 90,
      elevation: 5,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'side',
    }),
    TOP,
    MACRO,
    r({
      key: 'low',
      title: 'Low angle',
      why: 'From just above the table, slightly off front: the ring stands tall and the shoulders lead to the stone.',
      azimuth: 20,
      elevation: 4,
      focalLength: 85,
      fill: 0.62,
      frame: 'piece',
      basePreset: 'front',
    }),
  ],
  pendant: [
    r({
      key: 'front',
      title: 'Front, hanging',
      why: 'Face-on as it hangs, the way it is worn: the outline and the bail together.',
      azimuth: 0,
      elevation: 4,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'front',
    }),
    { ...HERO, title: 'Three-quarter', azimuth: 30, elevation: 14 },
    MACRO,
    r({
      key: 'back',
      title: 'Back',
      why: 'The back and the bail: the finish nobody else shows.',
      azimuth: 180,
      elevation: 6,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'front',
    }),
  ],
  earrings: [
    r({
      key: 'front',
      title: 'Front',
      why: 'Face-on, as it is seen on the ear.',
      azimuth: 0,
      elevation: 6,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'front',
    }),
    r({
      key: 'side',
      title: 'Side',
      why: 'From the side: the depth, the post or hook, and how it sits.',
      azimuth: 90,
      elevation: 6,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'side',
    }),
    { ...HERO, title: 'Three-quarter' },
    MACRO,
  ],
  bracelet: [
    r({
      key: 'curve',
      title: 'Curve',
      why: 'A high three-quarter that follows the curve round the wrist.',
      azimuth: 30,
      elevation: 32,
      focalLength: 90,
      fill: 0.68,
      frame: 'piece',
      basePreset: 'three-quarter',
    }),
    TOP,
    r({
      key: 'side',
      title: 'Profile',
      why: 'Side-on: the thickness and the clasp line.',
      azimuth: 90,
      elevation: 8,
      focalLength: 100,
      fill: 0.66,
      frame: 'piece',
      basePreset: 'side',
    }),
    MACRO,
  ],
  necklace: [
    { ...HERO, key: 'front', title: 'Front', azimuth: 0, elevation: 10, basePreset: 'front' },
    TOP,
    MACRO,
  ],
  chain: [
    { ...HERO, title: 'Three-quarter' },
    TOP,
    { ...MACRO, title: 'Macro on the links', why: 'Close on the links: the weave and the finish.' },
  ],
  brooch: [
    { ...HERO, key: 'front', title: 'Front', azimuth: 0, elevation: 8, basePreset: 'front' },
    { ...HERO, title: 'Three-quarter' },
    MACRO,
  ],
  other: [HERO, TOP, MACRO],
}

/** The shots for a kind of piece; a macro only when there is a stone to look at. */
export function shotVocabulary(kind: PieceKind, hasStone = true): ShotRecipe[] {
  return VOCABULARY[kind].filter((s) => s.frame === 'piece' || hasStone || kind === 'chain')
}

/**
 * Points that frame a macro: the corners of a box 1.2 stone widths across round the centre
 * stone (or the named one), the same box the `macro` preset frames, so both measure alike.
 */
function stonePoints(subject: SceneSubject, nodeId?: string | null): Vec3[] | null {
  const pick = nodeId ? subject.stones.filter((s) => s.nodeId === nodeId) : []
  const centre = subject.stones.filter((s) => s.role === 'center')
  const stones = pick.length ? pick : centre.length ? centre : subject.stones.slice(0, 1)
  if (!stones.length) return null
  const out: Vec3[] = []
  for (const s of stones) {
    const c = stoneCenter(s)
    const half = stoneWidth(s) * 0.6
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) out.push(add(c, [x * half, y * half, z * half]))
  }
  return out
}

const piecePoints = (subject: SceneSubject): Vec3[] =>
  subject.silhouette?.length ? subject.silhouette : corners(subject.bounds)

const round2 = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 100) / 100) as Vec3

/**
 * A recipe as a custom camera on this piece: angle and lens from the recipe, the distance and
 * aim solved so the subject fills the recipe's share of a frame of this aspect ratio. Stored
 * with `framedOn`, so it frames exactly this piece and scales with a piece of another size.
 */
export function placeShot(
  recipe: ShotRecipe,
  subject: SceneSubject,
  aspect: number,
  centreStoneNodeId?: string | null,
): RenderScene['camera'] {
  const stone = recipe.frame === 'stone' ? stonePoints(subject, centreStoneNodeId) : null
  const pts = stone ?? piecePoints(subject)
  const { target, distance } = framePoints(
    pts,
    recipe.azimuth,
    recipe.elevation,
    recipe.focalLength,
    aspect,
    recipe.fill,
  )
  const { position } = cameraPose({
    target,
    azimuth: recipe.azimuth,
    elevation: recipe.elevation,
    distance,
  })
  const focus = centreStoneNodeId ?? subject.stones.find((s) => s.role === 'center')?.nodeId
  return {
    preset: 'custom',
    position: round2(position),
    target: round2(target),
    roll: 0,
    focalLength: recipe.focalLength,
    framedOn: {
      center: boundsCenter(subject.bounds),
      radius: boundsRadius(subject.bounds),
    },
    basePreset: recipe.basePreset,
    ...(focus ? { focusNodeId: focus } : {}),
    ...(stone && recipe.fStop ? { fStop: recipe.fStop } : {}),
  }
}

// ── The framing check ────────────────────────────────────────────────────────────────────────

export interface ShotFraming {
  subject: 'piece' | 'centre stone'
  framing: Framing
  ok: boolean
  /** What is wrong and how to fix it, in plain words; null when the shot can be rendered. */
  problem: string | null
}

const isMacro = (camera: RenderScene['camera']) =>
  camera.preset === 'macro' || (camera.preset === 'custom' && camera.basePreset === 'macro')

/** The edges of the frame the points cross, in words ("left and top"). */
function cutEdges(
  camera: Parameters<typeof projectPoint>[0],
  aspect: number,
  pts: readonly Vec3[],
): string[] {
  const edges = new Set<string>()
  for (const p of pts) {
    const q = projectPoint(camera, aspect, p)
    if (!q) {
      edges.add('behind the camera')
      continue
    }
    if (q[0] < 0) edges.add('left')
    if (q[0] > 1) edges.add('right')
    if (q[1] < 0) edges.add('top')
    if (q[1] > 1) edges.add('bottom')
  }
  return [...edges]
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const words = (list: string[]) =>
  list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`

/**
 * Whether a shot can be rendered as framed. A shot must hold the whole piece, inside the
 * frame-safe margin, at a size the critique accepts; a macro must hold the centre stone (the
 * rest of the piece may run out of frame, as it does in a macro). Off-centre is allowed: thirds
 * are a choice.
 */
export function shotFraming(scene: RenderScene, subject: SceneSubject): ShotFraming {
  const aspect = scene.output.width / scene.output.height
  const camera = resolveCamera(scene.camera, subject, aspect)
  const macro = isMacro(scene.camera)
  const stone = macro ? stonePoints(subject, scene.camera.focusNodeId) : null
  const pts = stone ?? piecePoints(subject)
  const framing = predictFraming(camera, aspect, pts)
  const name = stone ? 'centre stone' : 'piece'
  const fartherBy = (fill: number) =>
    `move the camera about ${Math.max(5, Math.round((fill / CHECKS.fillTarget - 1) * 100))}% farther back (or widen the lens)`
  let problem: string | null = null
  switch (framing.verdict) {
    case 'empty':
      problem = `The ${name} is not in view at all: aim the camera's target at it.`
      break
    case 'cropped':
      problem = `The ${name} is cut off at the ${words(cutEdges(camera, aspect, pts))}: ${fartherBy(Math.max(framing.fill, 0.8))}, or move the target towards the cut side.`
      break
    case 'small':
      problem = `The ${name} fills only ${pct(framing.fill)} of the frame: move about ${Math.round((1 - framing.fill / CHECKS.fillTarget) * 100)}% closer (or use a longer lens).`
      break
    case 'large':
      if (!stone)
        problem = `The ${name} fills ${pct(framing.fill)}, with no room around it: ${fartherBy(framing.fill)}.`
      break
    case 'tight':
      if (!stone)
        problem = `The ${name} touches the frame-safe margin: ${fartherBy(framing.fill + 0.1)}, or re-centre it.`
      break
    case 'off-centre':
    case 'good':
      break
  }
  return { subject: name, framing, ok: problem === null, problem }
}

// ── Aspect ratios, motion and the questions ─────────────────────────────────────────────────

export const ASPECTS = {
  '1:1': { label: 'Square 1:1', ratio: 1, use: 'product pages, marketplaces' },
  '4:5': { label: 'Portrait 4:5', ratio: 4 / 5, use: 'social feeds' },
  '9:16': { label: 'Vertical 9:16', ratio: 9 / 16, use: 'stories and reels' },
  '16:9': { label: 'Wide 16:9', ratio: 16 / 9, use: 'banners and video' },
  '3:2': { label: 'Landscape 3:2', ratio: 3 / 2, use: 'lookbooks and editorial' },
} as const
export type AspectKey = keyof typeof ASPECTS

/** An output size of this aspect ratio with the given long side, in even pixels. */
export function outputSize(aspect: AspectKey, longSide: number): { width: number; height: number } {
  const ratio = ASPECTS[aspect].ratio
  const even = (n: number) => Math.max(256, Math.round(n / 2) * 2)
  return ratio >= 1
    ? { width: even(longSide), height: even(longSide / ratio) }
    : { width: even(longSide * ratio), height: even(longSide) }
}

/** The aspect key nearest to a width and height, for showing a shot's shape in words. */
export function aspectOf(width: number, height: number): AspectKey {
  const ratio = width / height
  let best: AspectKey = '1:1'
  for (const k of Object.keys(ASPECTS) as AspectKey[])
    if (
      Math.abs(Math.log(ASPECTS[k].ratio / ratio)) < Math.abs(Math.log(ASPECTS[best].ratio / ratio))
    )
      best = k
  return best
}

type Motion = NonNullable<RenderScene['animation']>

export interface MotionChoice {
  type: Motion['type']
  label: string
  hint: string
  seconds: number
  loop: boolean
  /** The shot it suits best. */
  bestOn: string
}

/** The animations offered by name, in the order the Motion control shows them. */
export const MOTION_CHOICES: readonly MotionChoice[] = [
  {
    type: 'turntable',
    label: '360° turntable',
    hint: 'One full turn; loops without a jump.',
    seconds: 6,
    loop: true,
    bestOn: 'the hero shot',
  },
  {
    type: 'half-orbit',
    label: 'Half orbit',
    hint: 'The camera travels round the front, profile to profile.',
    seconds: 5,
    loop: true,
    bestOn: 'the hero shot',
  },
  {
    type: 'push-in',
    label: 'Slow push-in',
    hint: 'The camera moves slowly closer.',
    seconds: 4,
    loop: false,
    bestOn: 'the hero shot',
  },
  {
    type: 'macro-sweep',
    label: 'Macro sweep',
    hint: 'Close in, drifting across the centre stone.',
    seconds: 4,
    loop: false,
    bestOn: 'the macro',
  },
  {
    type: 'light-sweep',
    label: 'Sparkle pass',
    hint: 'The light sweeps across; the stones flash.',
    seconds: 4,
    loop: true,
    bestOn: 'the hero shot or the macro',
  },
  {
    type: 'orbit-arc',
    label: 'Short arc',
    hint: 'A small sideways move round the piece.',
    seconds: 4,
    loop: false,
    bestOn: 'any shot',
  },
  {
    type: 'rack-focus',
    label: 'Rack focus',
    hint: 'Focus travels from the claws to the band.',
    seconds: 4,
    loop: false,
    bestOn: 'the macro',
  },
]

export const motionChoice = (type: Motion['type']): MotionChoice =>
  MOTION_CHOICES.find((m) => m.type === type)!

/** An animation as a scene stores it, with the choice's defaults. */
export function motionOf(type: Motion['type'], fps = 30, seconds?: number): Motion {
  const m = motionChoice(type)
  return { type, seconds: seconds ?? m.seconds, fps, loop: m.loop }
}

/** What the pictures are for, and the look and shapes each purpose starts from. */
export const PURPOSES = {
  product: {
    label: 'Product page on white',
    look: 'catalog-white',
    aspects: ['1:1'] as AspectKey[],
  },
  social: {
    label: 'Social posts',
    look: 'black-acrylic',
    aspects: ['4:5', '9:16'] as AspectKey[],
  },
  lookbook: {
    label: 'Lookbook / editorial',
    look: 'editorial-warm',
    aspects: ['4:5', '3:2'] as AspectKey[],
  },
} as const satisfies Record<
  string,
  { label: string; look: RenderScene['look']; aspects: AspectKey[] }
>

/**
 * The Render job's quick questions, with defaults chosen from the piece so a single Go is a
 * good answer: a product set on white, square, with a turntable (and a sparkle pass when the
 * piece has a halo or pavé to flash).
 */
export function cinemaQuestions(
  features: Pick<PieceFeatures, 'halo' | 'pave' | 'stones'>,
): QuickQuestion[] {
  const sparkly = features.halo || features.pave
  return [
    {
      id: 'purpose',
      question: 'What are the images for?',
      options: (Object.keys(PURPOSES) as (keyof typeof PURPOSES)[]).map((id) => ({
        id,
        label: PURPOSES[id].label,
      })),
      multiple: false,
      defaults: ['product'],
    },
    {
      id: 'aspects',
      question: 'Which shapes?',
      options: (['1:1', '4:5', '9:16', '16:9'] as const).map((k) => ({
        id: k.replace(':', 'x'),
        label: k,
        hint: ASPECTS[k].use,
      })),
      multiple: true,
      defaults: ['1x1'],
    },
    {
      id: 'motion',
      question: 'Any animations?',
      options: [
        { id: 'none', label: 'Stills only' },
        { id: 'turntable', label: '360° turntable, 6 s' },
        { id: 'macro-sweep', label: 'Macro sweep, 4 s' },
        { id: 'light-sweep', label: 'Sparkle pass, 4 s' },
        { id: 'half-orbit', label: 'Half orbit, 5 s' },
      ],
      multiple: true,
      defaults: sparkly && features.stones > 1 ? ['turntable', 'light-sweep'] : ['turntable'],
    },
  ]
}
