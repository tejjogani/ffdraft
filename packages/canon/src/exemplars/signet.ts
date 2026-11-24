/** Signet exemplars: research 09 §4. */
import { exemplar, us } from './define'

export const SIGNETS = [
  exemplar({
    id: 'signet-cushion-heritage',
    title: 'Cushion signet',
    kind: 'ring',
    archetype: 'signet',
    styles: ['heritage', 'signet'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'signet',
        title: 'Cushion signet',
        summary: 'A landscape cushion face ready for a crest, on a hard-tapered shank.',
        style: ['heritage', 'signet'],
        metal: { alloy: 'au14k-yellow' },
        ring: { size: us(9) },
      },
    },
    why: [
      'Face 0.72 of the finger across and 0.83 as long: the stock 14 × 11 landscape face.',
      'Shank tapers to a third of its top; a 2.6 mm plate for a lifetime of wear.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'band', patch: { thicknessTop: 1.8 } }],
      fault: 'A plate too thin to engrave',
      ruleId: 'signet.plate',
    },
    sizeKey: {},
  }),
  exemplar({
    id: 'signet-oval-seal',
    title: 'Oval seal signet',
    kind: 'ring',
    archetype: 'signet',
    styles: ['heritage', 'seal'],
    variant: 'classic',
    build: {
      spec: {
        kind: 'ring',
        archetype: 'signet',
        title: 'Oval seal signet',
        summary: 'An oval face with a seal cut in reverse, to press into wax.',
        style: ['heritage', 'seal'],
        metal: { alloy: 'au18k-yellow' },
        ring: { size: us(10) },
      },
      ops: [
        {
          t: 'update',
          id: 'face',
          patch: { outline: 'oval', invert: true, depth: 0.8, baseThickness: 2.2 },
        },
      ],
    },
    why: [
      'The seal is cut 0.8 mm deep after casting, with 1.4 mm of plate behind it.',
      'An oval landscape face in 18k.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'face', patch: { baseThickness: 1.6 } }],
      fault: 'Too little plate behind the seal',
      ruleId: 'signet.sealPlate',
    },
    sizeKey: {},
  }),
  exemplar({
    id: 'signet-flush-sapphire',
    title: 'Gypsy signet with a flush sapphire',
    kind: 'ring',
    archetype: 'signet',
    styles: ['heritage'],
    variant: 'classic',
    build: {
      kind: 'ring',
      nodes: [
        {
          id: 'band',
          kind: 'ringShank',
          name: 'Signet shank',
          material: 'au18k-yellow',
          size: us(9),
          profile: 'dShape',
          widthTop: 11,
          widthBottom: 4,
          thicknessTop: 2.8,
          thicknessBottom: 1.8,
        },
        {
          id: 'center',
          kind: 'gem',
          name: 'Flush sapphire',
          cut: 'round',
          stone: 'sapphire-blue',
          width: 3.8,
          placement: { type: 'ringTop', shank: 'band', angle: 0, elevation: 0.45, spin: 0 },
        },
        {
          id: 'head',
          kind: 'setting',
          name: 'Flush seat',
          material: 'au18k-yellow',
          gem: 'center',
          style: 'flush',
        },
      ],
    },
    why: [
      'A 3.8 mm sapphire sinks fully into a 2.8 mm plate: (2.8 − 0.2)/0.615 = 4.2 at most.',
      'Sapphire (Mohs 9) survives flush setting.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'center', patch: { width: 4.6 } }],
      fault: 'A flush stone deeper than the plate',
      ruleId: 'signet.flushStone',
    },
    sizeKey: { W: 3.8 },
  }),
  // A championship ring needs a separate raised face body (rise 6–10 mm) and built-up
  // shoulders the shank cannot make yet: the canon carries it as a caveat, not an exemplar.
  exemplar({
    id: 'signet-onyx-bezel',
    title: "Men's onyx signet",
    kind: 'ring',
    archetype: 'signet',
    styles: ["men's", 'heritage'],
    variant: 'classic',
    build: {
      kind: 'ring',
      nodes: [
        {
          id: 'band',
          kind: 'ringShank',
          name: 'Signet shank',
          material: 'au14k-yellow',
          size: us(10),
          profile: 'dShape',
          widthTop: 13,
          widthBottom: 4.5,
          thicknessTop: 2.8,
          thicknessBottom: 1.9,
        },
        {
          id: 'center',
          kind: 'gem',
          name: 'Onyx tablet',
          cut: 'emerald',
          stone: 'onyx',
          width: 9,
          lw: 1.35,
          placement: { type: 'ringTop', shank: 'band', angle: 0, elevation: 0.6, spin: 90 },
        },
        {
          id: 'head',
          kind: 'setting',
          name: 'Bezel',
          material: 'au14k-yellow',
          gem: 'center',
          style: 'bezel',
          wall: 0.85,
        },
      ],
    },
    why: [
      'A 12 × 9 mm onyx across the finger: too big to sink flush in a 2.8 mm plate, so a proud bezel.',
      'A 0.85 mm wall for a stone over 7 mm; onyx (Mohs 7) is kept off flush and pavé.',
      'Tapers from 13 mm to 4.5 at the palm.',
    ],
    antiTwin: {
      ops: [{ t: 'update', id: 'head', patch: { wall: 0.4 } }],
      fault: 'A bezel wall too thin to cast',
      ruleId: 'bezel.wall',
    },
    sizeKey: { W: 9 },
  }),
]
