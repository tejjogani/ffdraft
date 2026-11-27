/** Test helpers: an evaluator with the core features and small base designs to vary. */
import type { Design, NodeInput } from '@pave/schema'
import { designFrom } from '@pave/schema'
import { Evaluator } from '../evaluate/evaluate'
import { bail } from '../features/bail'
import { booleanFeature } from '../features/boolean'
import { engraving } from '../features/engraving'
import { gem } from '../features/gem'
import { gemRow } from '../features/gemRow'
import { halo } from '../features/halo'
import { pipe } from '../features/pipe'
import { primitive } from '../features/primitive'
import { revolve } from '../features/revolve'
import { ringShank } from '../features/ringShank'
import { setting } from '../features/setting'
import { loadRuntime } from '../runtime/index'
import type { Detail, Evaluation } from '../types'

export const CORE_FEATURES = [
  ringShank,
  gem,
  setting,
  halo,
  gemRow,
  revolve,
  pipe,
  engraving,
  booleanFeature,
  bail,
  primitive,
]

export async function coreEvaluator(): Promise<Evaluator> {
  await loadRuntime()
  return new Evaluator(CORE_FEATURES)
}

export const evaluate = async (
  evaluator: Evaluator,
  design: Design,
  detail: Detail = 'draft',
): Promise<Evaluation> => (await evaluator.scene(design, { detail })).evaluation

const band: NodeInput = { id: 'band', kind: 'ringShank' }
const stone: NodeInput = { id: 'stone', kind: 'gem', placement: { type: 'ringTop', shank: 'band' } }

/** For each core kind: the nodes it needs around it and the node under test (last). */
export const BASES: Record<string, NodeInput[]> = {
  ringShank: [band],
  gem: [band, stone],
  setting: [band, stone, { id: 'node', kind: 'setting', gem: 'stone' }],
  halo: [band, stone, { id: 'node', kind: 'halo', around: 'stone' }],
  gemRow: [
    { ...band, widthTop: 3, widthBottom: 3 } as NodeInput,
    { id: 'node', kind: 'gemRow', host: 'band' },
  ],
  revolve: [{ id: 'node', kind: 'revolve', profile: 'M0 0 L4 0 C6 2 2 5 3 8 L0 8 Z' }],
  pipe: [
    {
      id: 'node',
      kind: 'pipe',
      points: [
        [0, 0, 0],
        [5, 0, 4],
        [10, 2, 0],
        [14, 0, 5],
      ],
    },
  ],
  primitive: [{ id: 'node', kind: 'primitive' }],
  boolean: [
    { id: 'a', kind: 'primitive', size: [6, 6, 3] },
    { id: 'b', kind: 'primitive', shape: 'cylinder', size: [3, 3, 8] },
    { id: 'node', kind: 'boolean', target: 'a', tools: ['b'] },
  ],
  bail: [
    { id: 'a', kind: 'primitive', size: [10, 2, 14] },
    { id: 'node', kind: 'bail', host: 'a' },
  ],
  engraving: [
    { ...band, widthTop: 4, widthBottom: 4 } as NodeInput,
    { id: 'node', kind: 'engraving', host: 'band' },
  ],
}

/** The base design of a kind with a patch merged into the node under test. */
export function variant(kind: string, patch: Record<string, unknown>): Design {
  // In-plane axis controls belong to the linked profile variant. Keep the section clear
  // of the chosen axis at both parameter extremes so the generated test input is valid.
  if (kind === 'revolve' && ('axis' in patch || 'axisOffset' in patch)) {
    const side = Number(patch.axisOffset ?? 0) <= 0 ? 1 : -1
    return designFrom('ring', [
      {
        id: 'profile',
        kind: 'curve',
        closed: true,
        plane: 'front',
        points: [
          [2, 2],
          [5, 2],
          [5, 4],
          [2, 4],
        ].map(([u, v], i) => ({ id: String(i), u: side * u!, v: side * v! })),
      },
      { id: 'node', kind: 'revolve', curve: 'profile', ...patch },
    ])
  }
  const nodes = BASES[kind]!
  const last = nodes[nodes.length - 1]!
  return designFrom('ring', [...nodes.slice(0, -1), { ...last, ...patch } as NodeInput])
}

export const failures = (e: Evaluation): string[] =>
  e.diagnostics.filter((d) => d.code === 'feature.failed').map((d) => d.message)
