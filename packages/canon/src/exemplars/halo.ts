/** Halo exemplars: research 09 §1 "Halo", §5 vintage-revival and maximalist. */
import { exemplar, us } from './define'

export const HALOS = [
  exemplar({
    id: 'halo-cushion-classic',
    title: 'Cushion halo with pavé shoulders',
    kind: 'ring',
    archetype: 'halo',
    styles: ['classic'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'halo',
        title: 'Cushion halo with pavé shoulders',
        summary: 'A 1.2 ct cushion in a single halo on a pavé band.',
        style: ['classic'],
        metal: { alloy: 'au18k-white' },
        ring: { size: us(6) },
        stones: [
          { role: 'center', cut: 'cushion', carat: 1.2 },
          { role: 'halo', cut: 'round' },
          { role: 'accent', cut: 'round', setting: 'pave' },
        ],
      },
    },
    why: [
      'Halo melee 1.2 mm on a 6.1 mm centre takes the face to 1.6×, a frame not a tyre.',
      'The shoulder pavé matches the halo size, so the two zones read as one.',
      'The halo clears the claws by the claw wire less 0.5 mm.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'halo', patch: { offset: 0.1 } }],
      fault: 'Halo jammed into the claws',
      ruleId: 'halo.offset',
    },
    sizeKey: { W: 6.1 },
  }),
  exemplar({
    id: 'halo-vintage-round',
    title: 'Vintage halo on a cathedral',
    kind: 'ring',
    archetype: 'halo',
    styles: ['vintage'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'halo',
        title: 'Vintage halo on a cathedral',
        summary: 'A 1 ct round in a fine halo on a pavé cathedral band.',
        style: ['vintage'],
        metal: { alloy: 'pt950' },
        ring: { size: us(6), shoulder: 'cathedral' },
        stones: [
          { role: 'center', cut: 'round', carat: 1 },
          { role: 'halo', cut: 'round' },
          { role: 'accent', cut: 'round', setting: 'pave' },
        ],
      },
    },
    why: [
      'A moderate 6.4 mm centre lifted 1.2 mm above the band so the arches can rise.',
      'Cathedral arches meet the head 0.8 mm under the girdle.',
      'Fine pavé runs half way round, leaving the palm plain for sizing.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'band', patch: { shoulderHeight: 5 } }],
      fault: 'Arches climbing into the halo',
      ruleId: 'ring.cathedral.rise',
    },
    sizeKey: { W: 6.4 },
  }),
  exemplar({
    id: 'halo-oval-delicate',
    title: 'Delicate oval halo',
    kind: 'ring',
    archetype: 'halo',
    styles: ['delicate'],
    variant: 'delicate',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'halo',
        title: 'Delicate oval halo',
        summary: 'A 0.9 ct oval in a rose-gold halo on a fine band.',
        style: ['delicate'],
        metal: { alloy: 'au14k-rose' },
        ring: { size: us(5.5) },
        stones: [
          { role: 'center', cut: 'oval', carat: 0.9 },
          { role: 'halo', cut: 'round' },
        ],
      },
    },
    why: [
      'A 1.65 mm band under a 5.5 mm oval: delicate, and the halo makes it read larger.',
      'Fine 0.8 mm claws inside the halo; the halo guards the girdle.',
      'Outline 1.6× the centre: below the 1.8× limit for small stones.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'halo', patch: { stoneWidth: 1.6 } }],
      fault: 'Halo melee competing with the centre',
      ruleId: 'halo.melee',
    },
    sizeKey: { W: 5.5 },
  }),
  exemplar({
    id: 'halo-double-maximalist',
    title: 'Double halo cocktail ring',
    kind: 'ring',
    archetype: 'halo',
    styles: ['maximalist'],
    variant: 'bold',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'halo',
        title: 'Double halo cocktail ring',
        summary: 'A 10 mm lab-grown cushion in a double halo on a wide platinum band.',
        style: ['maximalist'],
        metal: { alloy: 'pt950' },
        ring: { size: us(6.5) },
        stones: [
          { role: 'center', cut: 'cushion', stone: 'diamond-lab', widthMm: 10 },
          { role: 'halo', cut: 'round', stone: 'diamond-lab' },
        ],
      },
      ops: [{ t: 'update', id: 'halo', patch: { rows: 2 } }],
    },
    why: [
      'A 10 mm centre on a 5 mm band that tapers to a 2.5 × 1.8 mm euro base: scale held steady.',
      'Two rows of 1.6 mm melee stop at 1.85× the centre.',
      'Claws of 1.1 mm inside the halo keep its gap at 0.6 mm: no moat round the centre.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.0, widthBottom: 2.0 } }],
      fault: 'A 2 mm band under a 10 mm stone',
      ruleId: 'ring.solitaire.bandWidth',
    },
    sizeKey: { W: 10 },
  }),
]
