/** Solitaire, name and medallion pendants: research 09 §2 "Bail and chain", §5 cultural rows. */
import { exemplar } from './define'

/** A flowing calligraphic swash standing in for the client's own SVG artwork. */
const SWASH =
  'M0 12 C4 2 12 0 18 6 C22 10 26 14 32 10 C36 7 38 3 42 4 C46 5 46 10 42 13 C38 16 32 18 26 16 C20 14 16 18 10 20 C6 21 1 18 0 12 Z'

export const PENDANTS = [
  exemplar({
    id: 'pendant-bezel-minimal',
    title: 'Bezel solitaire pendant',
    kind: 'pendant',
    archetype: 'pendantSolitaire',
    styles: ['minimal'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'pendantSolitaire',
        title: 'Bezel solitaire pendant',
        summary: 'A 0.5 ct round in a closed bezel on a fine cable chain.',
        style: ['minimal'],
        metal: { alloy: 'au14k-yellow' },
        stones: [{ role: 'center', cut: 'round', carat: 0.5, setting: 'bezel' }],
        chain: { style: 'cable', lengthMm: 457, widthMm: 1.2 },
      },
    },
    why: [
      'A 0.6 mm bezel round a 5.1 mm stone: one clean circle.',
      'Chain about a fifth of the stone width; bail the size of the stone.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'bail', patch: { opening: 2.4 } }],
      fault: 'A bail the chain cannot pass',
      ruleId: 'bail.opening',
    },
    sizeKey: { W: 5.1 },
  }),
  exemplar({
    id: 'pendant-basket-classic',
    title: 'Four-claw solitaire pendant',
    kind: 'pendant',
    archetype: 'pendantSolitaire',
    styles: ['classic'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'pendantSolitaire',
        title: 'Four-claw solitaire pendant',
        summary: 'A 1 ct round in a four-claw basket on a cable chain.',
        style: ['classic'],
        metal: { alloy: 'au18k-white' },
        stones: [{ role: 'center', cut: 'round', carat: 1, prongs: 4 }],
        chain: { style: 'cable', lengthMm: 457, widthMm: 1.4 },
      },
    },
    why: [
      'Claws 0.08 × stone + 0.3, finer than on a ring: a pendant takes no knocks.',
      'Chain about a fifth of the stone width; railed basket for a clean profile.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'head', patch: { prongCount: 3 } }],
      fault: 'Three claws turned off-axis',
      ruleId: 'ring.head.clawSymmetry',
    },
    sizeKey: { W: 6.4 },
  }),
  exemplar({
    id: 'pendant-pear-edwardian',
    title: 'Pear drop pendant',
    kind: 'pendant',
    archetype: 'pendantSolitaire',
    styles: ['edwardian'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'pendantSolitaire',
        title: 'Pear drop pendant',
        summary: 'A 0.75 ct pear in five fine claws on a platinum cable chain.',
        style: ['edwardian'],
        metal: { alloy: 'pt950' },
        stones: [{ role: 'center', cut: 'pear', carat: 0.75 }],
        chain: { style: 'cable', lengthMm: 432, widthMm: 1.0 },
      },
    },
    why: [
      'Five claws, one a V on the point: the pear is held where it chips.',
      'A pear drop on 1.0 mm cable: Edwardian lightness.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'head', patch: { taper: 0.05 } }],
      fault: 'A head that never narrows: a lollipop',
      ruleId: 'ring.head.taper',
    },
    sizeKey: { W: 5.2 },
  }),
  exemplar({
    id: 'name-script-classic',
    title: 'Script name pendant',
    kind: 'pendant',
    archetype: 'namePendant',
    styles: ['personal'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'namePendant',
        title: 'Script name pendant',
        summary: 'A name in flowing script on a fine cable chain.',
        style: ['personal'],
        metal: { alloy: 'au14k-yellow' },
        body: { heightMm: 9, text: 'Amara' },
        chain: { style: 'cable', lengthMm: 406, widthMm: 1.2 },
      },
    },
    why: [
      'A 9 mm script name, 1.4 mm thick: light enough for 1.2 mm cable.',
      'A plain jump-ring bail lets the name hang flat.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'bail', patch: { opening: 2.0 } }],
      fault: 'A ring the chain cannot pass',
      ruleId: 'bail.opening',
    },
    sizeKey: { H: 9 },
  }),
  exemplar({
    id: 'name-script-large',
    title: 'Large script nameplate',
    kind: 'pendant',
    archetype: 'namePendant',
    styles: ['personal'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'namePendant',
        title: 'Large script nameplate',
        summary: 'A joined script name, 16 mm tall and 2 mm thick, on a rope chain.',
        style: ['personal'],
        metal: { alloy: 'au14k-yellow' },
        body: { heightMm: 16, text: 'Legend', thicknessMm: 2.0 },
        chain: { style: 'rope', lengthMm: 508, widthMm: 2.5 },
      },
    },
    why: [
      'Joined script casts as one piece; block capitals would fall apart into letters.',
      'At 16 mm it needs 2 mm of depth to read as solid.',
      'A rope chain under it wants a tube bail.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'bail', patch: { wire: 0.8 } }],
      fault: 'A bail wire that will bend open',
      ruleId: 'bail.wire',
    },
    sizeKey: { H: 16 },
  }),
  exemplar({
    id: 'name-calligraphy',
    title: 'Calligraphy nameplate',
    kind: 'pendant',
    archetype: 'namePendant',
    styles: ['middle eastern', 'calligraphy'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'namePendant',
        title: 'Calligraphy nameplate',
        summary:
          'A calligraphic nameplate in 22k from the client’s SVG (the swash here stands in for it).',
        style: ['middle eastern', 'calligraphy'],
        metal: { alloy: 'au22k-yellow' },
        body: { heightMm: 14, text: 'name', thicknessMm: 1.4 },
        chain: { style: 'cable', lengthMm: 457, widthMm: 1.5 },
      },
      ops: [{ t: 'update', id: 'body', patch: { source: { type: 'svg', d: SWASH } } }],
    },
    why: [
      'Calligraphy only from the client’s SVG: letters must join as written.',
      '22k yellow, the region’s gold (21k is not available here).',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'bail', patch: { wire: 0.9 } }],
      fault: 'A bail wire that will bend open',
      ruleId: 'bail.wire',
    },
    sizeKey: { H: 14 },
  }),
  exemplar({
    id: 'medallion-temple',
    title: 'Temple medallion',
    kind: 'pendant',
    archetype: 'medallion',
    styles: ['temple-inspired'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'medallion',
        title: 'Temple medallion',
        summary: 'A 30 mm 22k relief medallion for the client’s artwork, on a rope chain.',
        style: ['temple-inspired'],
        metal: { alloy: 'au22k-yellow', finish: 'matte' },
        body: { heightMm: 30 },
        chain: { style: 'rope', lengthMm: 508, widthMm: 3 },
      },
      ops: [{ t: 'update', id: 'body', patch: { depth: 1.0, rim: 1.0, baseThickness: 1.6 } }],
    },
    why: [
      'Relief 1.0 mm deep in 22k: deep enough to read, soft enough to wear.',
      'A 1 mm rim frames the artwork; about 24 g of 22k hangs on a 3 mm rope.',
      'The relief is the client’s height map; this exemplar fixes proportion only.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'bail', patch: { opening: 3.5 } }],
      fault: 'A bail the rope cannot pass',
      ruleId: 'bail.opening',
    },
    sizeKey: { H: 30 },
  }),
  exemplar({
    id: 'medallion-east-asian',
    title: '24k zodiac medallion',
    kind: 'pendant',
    archetype: 'medallion',
    styles: ['east asian-inspired', 'zodiac'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'pendant',
        archetype: 'medallion',
        title: '24k zodiac medallion',
        summary: 'A 24 mm pure-gold relief medallion for a zodiac motif, on a 3 mm rope chain.',
        style: ['east asian-inspired', 'zodiac'],
        metal: { alloy: 'au24k-yellow' },
        body: { heightMm: 24 },
        chain: { style: 'rope', lengthMm: 457, widthMm: 3 },
      },
      ops: [{ t: 'update', id: 'body', patch: { depth: 0.8, baseThickness: 1.6 } }],
    },
    why: [
      'Soft 24k needs a 1.6 mm plate under 0.8 mm of relief.',
      'Weight is part of the value: about 16 g of solid 24k, so a 3 mm rope, never a fine cable.',
    ],
    antiTwin: {
      ops: [
        { t: 'add', node: { id: 'ice', kind: 'pave', host: 'body', sizeMax: 1.0, sizeMin: 1.0 } },
      ],
      fault: 'Micro-pavé in 24k',
      ruleId: 'metals.softAlloyMicro',
    },
    sizeKey: { H: 24 },
  }),
]
