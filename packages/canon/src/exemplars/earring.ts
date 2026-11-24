/** Stud and hoop exemplars: research 09 §3. */
import { exemplar } from './define'

const R = 11
const hoop = Array.from({ length: 24 }, (_, i) => {
  const t = (i / 24) * 2 * Math.PI
  return [
    Number((-14 + R * Math.sin(t)).toFixed(3)),
    0,
    Number((-12 + R * Math.cos(t)).toFixed(3)),
  ] as [number, number, number]
})

export const EARRINGS = [
  exemplar({
    id: 'studs-classic-basket',
    title: 'Classic basket studs',
    kind: 'earrings',
    archetype: 'studs',
    styles: ['classic'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'earrings',
        archetype: 'studs',
        title: 'Classic basket studs',
        summary: 'A pair of 0.5 ct rounds in four-claw baskets: 1 ct the pair.',
        style: ['classic'],
        metal: { alloy: 'au18k-white' },
        stones: [{ role: 'center', cut: 'round', carat: 0.5, count: 2 }],
      },
    },
    why: [
      '5.1 mm per ear (1 ct the pair): the usual default.',
      'Claws 0.9 mm, posts 0.85 × 10 mm.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'post', patch: { wire: 0.6 } }],
      fault: 'A post that bends in the ear',
      ruleId: 'earring.post.wire',
    },
    sizeKey: { W: 5.1 },
  }),
  exemplar({
    id: 'studs-bezel-south-asian',
    title: '22k bezel studs',
    kind: 'earrings',
    archetype: 'studs',
    styles: ['south asian-inspired', 'bridal 22k'],
    variant: 'delicate',
    build: {
      spec: {
        kind: 'earrings',
        archetype: 'studs',
        title: '22k bezel studs',
        summary: 'Rubies in closed 22k bezels with a matte finish.',
        style: ['south asian-inspired', 'bridal 22k'],
        metal: { alloy: 'au22k-yellow', finish: 'matte' },
        stones: [{ role: 'center', cut: 'round', stone: 'ruby', widthMm: 4, setting: 'bezel' }],
      },
    },
    why: [
      'A closed bezel 0.75 mm thick: 22k needs 0.2 mm more wall than 14k.',
      'Matte 22k with a ruby: the bridal palette.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'head', patch: { wall: 0.55 } }],
      fault: 'A 22k bezel too thin to hold',
      ruleId: 'bezel.wall',
    },
    sizeKey: { W: 4 },
  }),
  exemplar({
    id: 'studs-statement',
    title: 'Statement studs',
    kind: 'earrings',
    archetype: 'studs',
    styles: ['hip hop'],
    variant: 'bold',
    build: {
      spec: {
        kind: 'earrings',
        archetype: 'studs',
        title: 'Statement studs',
        summary: 'Lab-grown 6.8 mm rounds in four-claw baskets.',
        style: ['hip hop'],
        metal: { alloy: 'au14k-white' },
        stones: [{ role: 'center', cut: 'round', stone: 'diamond-lab', widthMm: 6.8 }],
      },
    },
    why: [
      '6.8 mm per ear: the hip-hop standard and up.',
      'Four claws; three would not hold past 6.5 mm.',
      'Screw backs suit this size: a maker note.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'post', patch: { length: 7 } }],
      fault: 'A post too short for the lobe',
      ruleId: 'earring.post.length',
    },
    sizeKey: { W: 6.8 },
  }),
  exemplar({
    id: 'custom-hammered-hoops',
    title: 'Hammered hoops',
    kind: 'earrings',
    archetype: 'custom',
    styles: ['organic', 'hammered'],
    variant: 'classic',
    build: {
      kind: 'earrings',
      nodes: [
        {
          id: 'hoop',
          kind: 'pipe',
          name: 'Hoop',
          material: 'au14k-yellow',
          finish: 'hammered',
          points: hoop,
          closed: true,
          section: 'round',
          width: 2.0,
          thickness: 2.0,
        },
        // A hoop has no back face to mount on: the post leaves the top of the wire, through the lobe.
        {
          id: 'post',
          kind: 'finding',
          name: 'Post',
          material: 'au14k-yellow',
          type: 'earringPost',
          transform: { position: [-14, 0, -1.5], rotation: [0, 0, 0], scale: 1 },
        },
        {
          id: 'pair',
          kind: 'pattern',
          name: 'Pair',
          sources: ['hoop', 'post'],
          type: 'mirror',
          axis: 'x',
        },
      ],
    },
    why: [
      'A 20 mm hoop in 2.0 mm wire: under the 2.5 mm solid limit for its size.',
      'Hammered 14k catches light unevenly, the hand-made look.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'hoop', patch: { width: 3.2 } }],
      fault: 'A solid hoop too heavy for the lobe',
      ruleId: 'earring.hoop.wire',
    },
    sizeKey: { H: 22 },
  }),
]
