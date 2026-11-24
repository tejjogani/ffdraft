/** The critique rubric, failure modes and capture views: research 09 §6. */
import type { Archetype, PieceKind } from '@pave/schema'
import type { RubricCriterion, View } from './model'

export const RUBRIC: readonly RubricCriterion[] = [
  {
    id: 'focal',
    title: 'Focal hierarchy',
    views: ['top', 'threeQuarter'],
    judgedBy: 'vision',
    anchors: {
      5: 'One element wins in a blink',
      3: 'The hero wins after a second look',
      1: 'Two equals, or the hero lost in metal',
    },
    questions: [
      'Which single element do you see first?',
      'Does anything compete with it for size or brightness?',
    ],
  },
  {
    id: 'proportion',
    title: 'Proportion and body scale',
    views: ['top', 'side', 'onBody'],
    judgedBy: 'numbers',
    anchors: {
      5: 'Every ratio inside one variant',
      3: 'Ratios inside bands but mixing variants',
      1: 'Any ratio outside all bands',
    },
    questions: ['Do all style findings pass or carry a waiver?'],
  },
  {
    id: 'silhouette',
    title: 'Silhouette',
    views: ['top', 'front'],
    judgedBy: 'vision',
    anchors: { 5: 'Recognisable at 64 px', 3: 'Readable but generic', 1: 'Blobby or ambiguous' },
    questions: ['Shrunk to a thumbnail, is the outline still the piece?'],
  },
  {
    id: 'fidelity',
    title: 'Fidelity to brief and references',
    views: ['top', 'side', 'threeQuarter'],
    judgedBy: 'both',
    anchors: {
      5: 'Categoricals match, ratios within 15 %',
      3: 'Categoricals match, a ratio 15–25 % off',
      1: 'Different archetype, cut or prong count',
    },
    questions: [
      'Does each reference’s cut, setting and claw count match?',
      'Which ratio is furthest from the reference?',
    ],
  },
  {
    id: 'line',
    title: 'Line and flow',
    views: ['side', 'threeQuarter'],
    judgedBy: 'vision',
    anchors: {
      5: 'Shoulders run into the head',
      3: 'Joins visible but tidy',
      1: 'Head looks stuck on',
    },
    questions: ['Do the shoulders lead the eye into the head without a step?'],
  },
  {
    id: 'profile',
    title: 'Profile and under-gallery',
    views: ['side', 'under'],
    judgedBy: 'vision',
    anchors: {
      5: 'Considered from the side and below',
      3: 'Plain but clean',
      1: 'Bare sticks or a solid block',
    },
    questions: [
      'From the side, is there a gallery, rail or bridge, or bare claws?',
      'From below, is the back finished?',
    ],
  },
  {
    id: 'rhythm',
    title: 'Rhythm and stone layout',
    views: ['top', 'threeQuarter'],
    judgedBy: 'both',
    anchors: {
      5: 'Even spacing, clean row ends',
      3: 'Minor unevenness',
      1: 'Ragged ends, bald patches',
    },
    questions: ['Are row ends clean and the gaps even?', 'Any bald patches in the pavé?'],
  },
  {
    id: 'unity',
    title: 'Unity',
    views: ['threeQuarter'],
    judgedBy: 'numbers',
    anchors: {
      5: 'Meets the unity rule',
      3: 'One borrowed element',
      1: 'Three or more vocabularies',
    },
    questions: ['At most two metals, two finishes and one claw-tip family?'],
  },
  {
    id: 'wearability',
    title: 'Wearability',
    views: ['side', 'onBody'],
    judgedBy: 'numbers',
    anchors: {
      5: 'Height, mass and edges in class',
      3: 'One limit near its edge',
      1: 'Snag-prone, overweight',
    },
    questions: ['Is the height, weight per ear or pendant mass inside its class?'],
  },
  {
    id: 'durability',
    title: 'Durability and make',
    views: ['side', 'under'],
    judgedBy: 'numbers',
    anchors: {
      5: 'Above floors with polish allowance',
      3: 'At the floors',
      1: 'Will not survive casting',
    },
    questions: ['Do walls, claws and seats clear the kernel floors with polish allowance?'],
  },
]

/** Failure modes of generated jewelry (research 09 §6), tagged with the archetypes they afflict. */
const HEADED: readonly Archetype[] = ['solitaire', 'halo', 'threeStone']
const CLAWED: readonly Archetype[] = [...HEADED, 'pendantSolitaire', 'studs']
const HUNG: readonly Archetype[] = ['pendantSolitaire', 'namePendant', 'icedPendant', 'medallion']
export const FAILURE_MODES: readonly {
  id: string
  text: string
  archetypes: readonly Archetype[]
}[] = [
  {
    id: 'defaultScale',
    text: 'Default scale: a hip-hop pendant left at 22 mm',
    archetypes: ['icedPendant', 'medallion'],
  },
  {
    id: 'illegibleIce',
    text: 'Illegible iced text: strokes too thin for a clean row',
    archetypes: ['icedPendant'],
  },
  { id: 'underBuiltBail', text: 'An under-built bail on a heavy piece', archetypes: HUNG },
  { id: 'tyreHalo', text: 'A "tyre" halo wider than 1.7× the centre', archetypes: ['halo'] },
  { id: 'rowHitsHead', text: 'A stone row running into the head', archetypes: HEADED },
  { id: 'fatProngs', text: 'Fat claws that hide the stone', archetypes: CLAWED },
  {
    id: 'lollipop',
    text: 'A "lollipop" head: a big head on a stick of a shank',
    archetypes: [...HEADED, 'pendantSolitaire'],
  },
  {
    id: 'bandMismatch',
    text: 'Band and stone out of scale with each other',
    archetypes: [...HEADED, 'signet'],
  },
  {
    id: 'noHierarchy',
    text: 'No hierarchy: two equal stones fighting',
    archetypes: ['threeStone', 'halo', 'custom'],
  },
  {
    id: 'raggedPave',
    text: 'Ragged pavé: bald patches and uneven row ends',
    archetypes: ['halo', 'eternity', 'icedPendant', 'tennis'],
  },
  {
    id: 'deadGallery',
    text: 'A dead under-gallery: bare claws or a solid block from the side',
    archetypes: CLAWED,
  },
  {
    id: 'frontOnly',
    text: 'A front-only design: the profile and back never considered',
    archetypes: [
      'solitaire',
      'halo',
      'threeStone',
      'eternity',
      'band',
      'signet',
      'pendantSolitaire',
      'namePendant',
      'icedPendant',
      'medallion',
      'studs',
      'tennis',
      'cuban',
      'custom',
    ],
  },
]

/** The clay views the critique captures, per kind, before any reference angles are added. */
export const VIEW_SETS: Readonly<Record<PieceKind, readonly View[]>> = {
  ring: ['top', 'side', 'threeQuarter', 'under', 'onBody'],
  pendant: ['front', 'side', 'back', 'threeQuarter', 'onBody'],
  necklace: ['front', 'threeQuarter', 'onBody'],
  earrings: ['front', 'side', 'back', 'onBody'],
  bracelet: ['top', 'side', 'threeQuarter', 'onBody'],
  chain: ['top', 'side', 'threeQuarter'],
  brooch: ['front', 'side', 'back'],
  other: ['front', 'side', 'top', 'threeQuarter'],
}

/** Questions that change geometry or cost (research 09 §6 "Briefing"), by archetype. */
export const QUESTIONS: Readonly<Record<Archetype, readonly string[]>> = {
  solitaire: [
    'Ring size?',
    'Centre stone: shape, size or carat, natural or lab?',
    'Metal, and active hands or a flush-fit wedding band beside it?',
  ],
  halo: [
    'Ring size?',
    'Centre stone: shape, size or carat, natural or lab?',
    'Metal, and pavé on the band or plain?',
  ],
  threeStone: ['Ring size?', 'Centre and side stones: shapes and sizes?', 'Metal?'],
  eternity: [
    'Ring size (a full eternity cannot be resized)?',
    'Stone size and setting: pavé, channel or shared claws?',
    'Full, three-quarter or half?',
  ],
  band: [
    'Ring size?',
    'Width and profile?',
    'Metal and finish, and does it sit beside an engagement ring?',
  ],
  signet: [
    'Face size and what goes on it: crest, monogram or seal?',
    'Ring size and finger?',
    'Metal?',
  ],
  pendantSolitaire: ['Stone and size?', 'Metal and chain length?'],
  namePendant: ['The exact text and lettering?', 'Height and metal?', 'Chain length?'],
  icedPendant: [
    'Artwork and height?',
    'Ice level and stone tier: natural, lab or moissanite?',
    'Chain style, width and length?',
  ],
  medallion: ['Artwork for the relief, and the right to use it?', 'Diameter and metal?', 'Chain?'],
  studs: ['Stone size per ear (retail carats are pair totals)?', 'Metal and back?'],
  tennis: ['Wrist or neck measurement?', 'Stone size and quality?', 'Metal?'],
  cuban: ['Width, length and metal?', 'Clasp?'],
  custom: ['References or a sketch?', 'Size and metal?', 'Who wears it, and how often?'],
}

/** Research 09 §6 principles, briefing and directions, and §7 practice: the standing instructions. */
export const PRINCIPLES: readonly string[] = [
  'One hero: one element wins in a blink; the second-largest stone is at most 0.85 of the hero.',
  "One variant per piece (delicate, classic or bold): every number sits in that variant's band.",
  'Unity: at most two metal colours and two finishes, one claw-tip family, a motif once or three times and more.',
  'Every view is designed: top, profile, under-gallery and back, not the front alone.',
  'Absolute sizes with clamps, not bare ratios; the kernel outranks the canon.',
  'Read references before geometry: fix scale from one anchor (ring size or stone size, else assume ID 16.5 or 19.8 and say so), record ratios not millimetres, never infer what a view hides, never count or measure from pixels.',
  'Ask only what changes geometry or cost, three questions a turn at most: size, stone, metal, active hands, flush-fit band (bridal); face size and content (signet); artwork, height, ice level, stone tier, chain (iced). Never ask for claw wire, elevation, gaps or margins.',
  'Offer 2–3 directions that differ on at least two axes (silhouette, setting vocabulary, variant, profile, surface); hold what the client fixed; name each in 2–4 words, no brands; give grams, carats, height and one trade-off.',
  'Say plainly what cannot be built and offer the nearest stand-in plus a maker note.',
  'Numbers gate first (kernel diagnostics, style findings); pictures judge only gestalt.',
]
