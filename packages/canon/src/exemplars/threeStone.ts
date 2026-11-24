/** Three-stone exemplars: research 09 §1 "Three-stone", §5 Art Deco and mid-century. */
import { exemplar, us } from './define'

export const THREE_STONES = [
  exemplar({
    id: 'ts-round-classic',
    title: 'Classic round three-stone',
    kind: 'ring',
    archetype: 'threeStone',
    styles: ['classic'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'threeStone',
        title: 'Classic round three-stone',
        summary: 'A 1 ct round between two rounds of three-quarters its width, on a pavé band.',
        style: ['classic'],
        metal: { alloy: 'pt950' },
        ring: { size: us(6) },
        stones: [
          { role: 'center', cut: 'round', carat: 1 },
          { role: 'side', cut: 'round' },
          { role: 'accent', cut: 'round', setting: 'pave' },
        ],
      },
    },
    why: [
      'Sides at 0.75 of the centre width: balanced, each about 40 % of its weight.',
      'Side tables step 0.6 mm below the centre, so the row reads as an arch.',
      'The pavé starts past the side heads, not under them.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'row', patch: { skipCenter: 0 } }],
      fault: 'Shoulder pavé running under the side heads',
      ruleId: 'rows.skipCenter',
    },
    sizeKey: { W: 6.4 },
  }),
  exemplar({
    id: 'ts-oval-centre-dominant',
    title: 'Oval three-stone, centre dominant',
    kind: 'ring',
    archetype: 'threeStone',
    styles: ['delicate'],
    variant: 'delicate',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'threeStone',
        title: 'Oval three-stone, centre dominant',
        summary: 'A 1.2 ct oval between two small rounds.',
        style: ['delicate'],
        metal: { alloy: 'au18k-yellow' },
        ring: { size: us(6) },
        stones: [
          { role: 'center', cut: 'oval', carat: 1.2 },
          { role: 'side', cut: 'round' },
        ],
      },
    },
    why: [
      'Sides at 0.6 of the centre width let the oval dominate: "1 ct and two quarters".',
      'Brilliant with brilliant: the flash matches across all three.',
      'A slim band keeps the whole ring delicate.',
    ],
    antiTwin: {
      ops: [
        { t: 'update', id: 'side1', patch: { cut: 'emerald' } },
        { t: 'update', id: 'side2', patch: { cut: 'emerald' } },
        { t: 'update', id: 'sideHead1', patch: { taper: 0.25 } },
        { t: 'update', id: 'sideHead2', patch: { taper: 0.25 } },
      ],
      fault: 'Step-cut sides beside a brilliant centre',
      ruleId: 'threeStone.cutPairing',
    },
    sizeKey: { W: 6.0 },
  }),
  exemplar({
    id: 'ts-deco-baguette',
    title: 'Emerald cut with baguettes',
    kind: 'ring',
    archetype: 'threeStone',
    styles: ['art deco'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'threeStone',
        title: 'Emerald cut with baguettes',
        summary:
          'A 1.5 ct emerald cut flanked by baguettes along the band (straight baguettes stand in for tapered).',
        style: ['art deco'],
        metal: { alloy: 'pt950' },
        ring: { size: us(6), profile: 'flat' },
        stones: [
          { role: 'center', cut: 'emerald', carat: 1.5, lw: 1.4 },
          { role: 'side', cut: 'baguette', widthMm: 2.55 },
        ],
      },
      ops: [
        { t: 'update', id: 'head', patch: { prongTip: 'tab' } },
        { t: 'update', id: 'sideHead1', patch: { prongTip: 'tab' } },
        { t: 'update', id: 'sideHead2', patch: { prongTip: 'tab' } },
      ],
    },
    why: [
      'Step with step: baguettes lie along the band and point at the emerald cut.',
      'Baguettes of 1.6 L:W, about half the centre’s length, as in Deco three-stones.',
      'Tab claws throughout: one claw-tip family.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'sideHead1', patch: { prongTip: 'round' } }],
      fault: 'Two claw-tip families',
      ruleId: 'metals.tipFamily',
    },
    sizeKey: { W: 5.7 },
  }),
  exemplar({
    id: 'ts-midcentury-marquise',
    title: 'Round with marquise sides',
    kind: 'ring',
    archetype: 'threeStone',
    styles: ['mid-century'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'threeStone',
        title: 'Round with marquise sides',
        summary: 'A 0.9 ct round between two marquise, in satin yellow gold.',
        style: ['mid-century'],
        metal: { alloy: 'au18k-yellow', finish: 'satin' },
        ring: { size: us(6) },
        stones: [
          { role: 'center', cut: 'round', carat: 0.9 },
          { role: 'side', cut: 'marquise' },
        ],
      },
    },
    why: [
      'Marquise sides at half the centre width and 2.0 L:W fan out like a spray.',
      'Six claws hold each marquise, a V-claw on each point.',
      'Satin gold against bright stones.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 3.5 } }],
      fault: 'A band that outweighs the stones',
      ruleId: 'ring.solitaire.bandWidth',
    },
    sizeKey: { W: 6.2 },
  }),
]
