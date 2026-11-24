/**
 * A deterministic demo workspace built from the real schema (templates, recipes, domain data),
 * served to the browser by request interception in `shots.ts`. Test-only: the app never sees
 * this module.
 */
import {
  buildDesign,
  type CommandName,
  type CommandOutput,
  gemDimsFromCarat,
  METALS,
  type Piece,
  PieceSpecSchema,
  type PieceSummary,
  type StoredChange,
  TEMPLATES,
} from '@pave/schema'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-23T17:40:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const user = { id: 'u_ana', name: 'Ana Moreau', email: 'ana@ateliermoreau.com', image: null }
const members = [
  { user, role: 'owner' as const, joinedAt: iso(120 * DAY) },
  {
    user: { id: 'u_leo', name: 'Léo Martin', email: 'leo@ateliermoreau.com', image: null },
    role: 'designer' as const,
    joinedAt: iso(60 * DAY),
  },
  {
    user: { id: 'u_sam', name: 'Sam Okafor', email: 'sam@ateliermoreau.com', image: null },
    role: 'viewer' as const,
    joinedAt: iso(9 * DAY),
  },
]

const collections = [
  { id: 'c_bridal', name: 'Bridal 2027', icon: null, position: 0, pieceCount: 4 },
  { id: 'c_iced', name: 'Iced capsule', icon: null, position: 1, pieceCount: 3 },
  { id: 'c_commissions', name: 'Commissions', icon: null, position: 2, pieceCount: 2 },
]

const STAGE_BY_TEMPLATE: Record<string, PieceSummary['stage']> = {
  solitaire: 'production',
  'oval-pave': 'design',
  halo: 'render',
  'three-stone': 'spec',
  'wedding-band': 'done',
  eternity: 'design',
  signet: 'idea',
  'pendant-solitaire': 'render',
  'name-pendant': 'spec',
  'iced-trophy': 'design',
  'iced-initial': 'idea',
  studs: 'done',
  cuban: 'production',
  tennis: 'render',
}
const COLLECTION_BY_TEMPLATE: Record<string, string> = {
  solitaire: 'c_bridal',
  'oval-pave': 'c_bridal',
  halo: 'c_bridal',
  'three-stone': 'c_bridal',
  'iced-trophy': 'c_iced',
  'iced-initial': 'c_iced',
  cuban: 'c_iced',
  signet: 'c_commissions',
  'name-pendant': 'c_commissions',
}
const TITLE: Record<string, string> = {
  'oval-pave': 'Oval “Aurore”',
  'three-stone': 'Deco three-stone',
  signet: 'Okafor family signet',
  'name-pendant': 'Amara script pendant',
  'iced-trophy': 'Championship trophy',
}

/** Rough facts so cards and tables have real-looking numbers. */
function factsFor(spec: ReturnType<typeof PieceSpecSchema.parse>) {
  const density = METALS[spec.metal.alloy].density
  const volume =
    spec.kind === 'ring' ? 260 : spec.kind === 'chain' ? 3200 : spec.kind === 'bracelet' ? 900 : 180
  let carat = 0
  let count = 0
  for (const s of spec.stones) {
    const n =
      s.count ??
      (s.role === 'pave' || s.role === 'accent'
        ? 24
        : s.role === 'halo'
          ? 18
          : s.role === 'side'
            ? 2
            : 1)
    const each =
      s.carat ?? (s.widthMm ? gemDimsFromCarat(s.cut, 1).width ** -3 * s.widthMm ** 3 : 0.01)
    carat += each * n
    count += n
  }
  return {
    metalMassG: (volume / 1000) * density,
    caratTotal: Number(carat.toFixed(2)),
    stoneCount: count,
    metal: spec.metal.alloy,
  }
}

export const pieces: Piece[] = TEMPLATES.map((t, i) => {
  const spec = PieceSpecSchema.parse({ ...t.spec, title: TITLE[t.id] ?? t.spec.title })
  const stage = STAGE_BY_TEMPLATE[t.id] ?? 'idea'
  const hasDesign = stage !== 'idea' && stage !== 'spec'
  return {
    id: `p_${t.id}`,
    title: spec.title,
    kind: spec.kind,
    stage,
    collectionId: COLLECTION_BY_TEMPLATE[t.id] ?? null,
    coverAssetId: null,
    facts: hasDesign ? factsFor(spec) : null,
    createdBy: i % 3 === 1 ? 'u_leo' : 'u_ana',
    createdAt: iso((40 - i * 2) * DAY),
    updatedAt: iso(i * 0.37 * DAY + i * 3_600_000),
    brief:
      i === 1
        ? 'An engagement ring for Claire — she loves warm gold and things that catch the light without shouting. Low enough to wear every day at the hospital; hidden details for her alone.'
        : '',
    spec:
      t.id === 'oval-pave'
        ? {
            ...spec,
            budgetUsd: 9000,
            openQuestions: [
              'Should the pavé continue down the shoulders, or stop at the bridge?',
              'Natural or lab-grown centre stone?',
            ],
          }
        : stage === 'idea'
          ? null
          : spec,
    design: hasDesign
      ? buildDesign(spec)
      : buildDesign({ ...spec, archetype: 'custom', stones: [] }),
    version: 7,
    boardIds: i === 1 ? ['b_aurore', 'b_light'] : [],
  }
})

const summary = ({
  brief: _b,
  spec: _s,
  design: _d,
  version: _v,
  boardIds: _bi,
  ...rest
}: Piece): PieceSummary => rest

const history = (pieceId: string): StoredChange[] => {
  const piece = pieces.find((p) => p.id === pieceId)!
  const ids = piece.design.order
  const first = ids[0] ?? 'band'
  const entries: Omit<StoredChange, 'seq' | 'pieceId'>[] = [
    {
      id: 'ch7',
      label: 'Lowered the head 0.4 mm and opened the gallery',
      actor: { type: 'agent', runId: 'run_3', model: 'claude-opus-5-5' },
      at: iso(40 * 60_000),
      ops: [{ t: 'update', id: ids[2] ?? first, patch: { prongDiameter: 1.05, style: 'basket' } }],
      inverse: [
        { t: 'update', id: ids[2] ?? first, patch: { prongDiameter: 0.95, style: 'prong' } },
      ],
    },
    {
      id: 'ch6',
      label: 'Band width 1.8 → 2.0 mm',
      actor: { type: 'user', id: 'u_ana' },
      at: iso(3 * 3_600_000),
      ops: [{ t: 'update', id: first, patch: { widthTop: 2, widthBottom: 2 } }],
      inverse: [{ t: 'update', id: first, patch: { widthTop: 1.8, widthBottom: 1.8 } }],
    },
    {
      id: 'ch5',
      label: 'Added pavé to the shoulders',
      actor: { type: 'agent', runId: 'run_2', model: 'claude-opus-5-5' },
      at: iso(26 * 3_600_000),
      ops: [{ t: 'add', node: { id: 'pave1', kind: 'pave', name: 'Shoulder pavé' } }],
      inverse: [{ t: 'remove', id: 'pave1' }],
    },
    {
      id: 'ch4',
      label: 'Switched to 18k yellow gold',
      actor: { type: 'user', id: 'u_leo' },
      at: iso(2 * DAY),
      ops: [{ t: 'update', id: first, patch: { material: 'au18k-yellow' } }],
      inverse: [{ t: 'update', id: first, patch: { material: 'pt950' } }],
    },
    {
      id: 'ch1',
      label: 'Built from spec',
      actor: { type: 'system' },
      at: iso(4 * DAY),
      ops: ids.slice(0, 4).map((id) => ({
        t: 'add' as const,
        node: piece.design.nodes[id] as Record<string, unknown>,
      })),
      inverse: ids.slice(0, 4).map((id) => ({ t: 'remove' as const, id })),
    },
  ]
  return entries.map((e, i) => ({ ...e, seq: 7 - i, pieceId }))
}

const dayCosts = Array.from({ length: 90 }, (_, i) => {
  const wave = Math.sin(i * 0.9) * 0.5 + Math.cos(i * 0.31) * 0.8 + 1.6
  const weekend = new Date(NOW - i * DAY).getUTCDay() % 6 === 0 ? 0.25 : 1
  return {
    day: new Date(NOW - i * DAY).toISOString().slice(0, 10),
    costUsd: Number((wave * weekend * 1.9).toFixed(2)),
  }
})

const runs = [
  {
    id: 'run_3',
    status: 'done' as const,
    model: 'claude-opus-5-5',
    costUsd: 0.184,
    ago: 40 * 60_000,
    tokens: { input: 18_420, output: 2_310, cacheRead: 41_200, cacheWrite: 3_100 },
  },
  {
    id: 'run_2',
    status: 'done' as const,
    model: 'claude-opus-5-5',
    costUsd: 0.412,
    ago: 26 * 3_600_000,
    tokens: { input: 32_800, output: 5_120, cacheRead: 88_000, cacheWrite: 6_400 },
  },
  {
    id: 'run_1',
    status: 'awaiting-approval' as const,
    model: 'claude-sonnet-5',
    costUsd: 0.051,
    ago: 2 * DAY,
    tokens: { input: 9_100, output: 880, cacheRead: 12_000, cacheWrite: 0 },
  },
  {
    id: 'run_0',
    status: 'failed' as const,
    model: 'claude-sonnet-5',
    costUsd: 0.012,
    ago: 5 * DAY,
    tokens: { input: 4_000, output: 120, cacheRead: 0, cacheWrite: 0 },
  },
].map((r) => ({
  id: r.id,
  threadId: 't_1',
  pieceId: 'p_oval-pave',
  userId: 'u_ana',
  model: r.model,
  status: r.status,
  tokens: r.tokens,
  costUsd: r.costUsd,
  startedAt: iso(r.ago),
  endedAt: r.status === 'awaiting-approval' ? null : iso(r.ago - 23_400),
  error:
    r.status === 'failed'
      ? 'Tool design.apply failed: "head" references missing node "center2"'
      : null,
}))

type Handler = { [N in CommandName]?: (input: Record<string, unknown>) => CommandOutput<N> }

export const handlers: Handler = {
  'session.get': () => ({
    user,
    orgs: [
      { id: 'o_1', name: 'Atelier Moreau', slug: 'atelier-moreau', logo: null, role: 'owner' },
    ],
    activeOrgId: 'o_1',
    capabilities: {
      assistant: true,
      imageSearch: ['openverse', 'the-met'],
      imageGeneration: ['fal'],
      mesh3d: [],
      blender: false,
      sourcing: [],
    },
  }),
  'org.members': () => members,
  'org.settings.get': () => ({
    traceRetentionDays: 90,
    allowEvalUse: false,
    assistantTier: null,
    assistantModels: { power: null, standard: null, light: null },
    monthlyBudgetUsd: 150,
  }),
  'collections.list': () => collections,
  'pieces.list': (input) =>
    pieces
      .filter((p) => (input.collectionId ? p.collectionId === input.collectionId : true))
      .filter((p) => (input.stage ? p.stage === input.stage : true))
      .map(summary),
  'pieces.get': (input) => {
    const p = pieces.find((x) => x.id === input.id)
    if (!p) throw Object.assign(new Error('Not found'), { status: 404 })
    return p
  },
  'pieces.update': (input) => {
    const p = pieces.find((x) => x.id === input.id)!
    Object.assign(
      p,
      Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== 'id' && v !== undefined)),
      { updatedAt: new Date().toISOString() },
    )
    return summary(p)
  },
  'design.history': (input) => history(input.pieceId as string),
  'boards.list': (input) =>
    input.pieceId === 'p_oval-pave'
      ? [
          {
            id: 'b_aurore',
            title: 'Aurore — warm light',
            icon: null,
            description: '',
            pieceId: 'p_oval-pave',
            coverAssetIds: [],
            referenceCount: 23,
            createdAt: iso(9 * DAY),
            updatedAt: iso(DAY),
          },
          {
            id: 'b_light',
            title: 'Hidden halos',
            icon: null,
            description: '',
            pieceId: 'p_oval-pave',
            coverAssetIds: [],
            referenceCount: 11,
            createdAt: iso(7 * DAY),
            updatedAt: iso(3 * DAY),
          },
        ]
      : [],
  'renders.list': () => [],
  'usage.summary': (input) => {
    const days = (input.days as number) ?? 30
    const byDay = dayCosts.slice(0, days)
    const total = byDay.reduce((s, d) => s + d.costUsd, 0)
    return {
      totalUsd: Number(total.toFixed(2)),
      byMeter: [
        { meter: 'llm', quantity: 4_180_000 * (days / 30), unit: 'tokens', costUsd: total * 0.58 },
        { meter: 'image', quantity: 212 * (days / 30), unit: 'images', costUsd: total * 0.24 },
        { meter: 'render', quantity: 41 * (days / 30), unit: 'min', costUsd: total * 0.12 },
        { meter: 'search', quantity: 930 * (days / 30), unit: 'queries', costUsd: total * 0.04 },
        { meter: 'storage', quantity: 3.2, unit: 'GB', costUsd: total * 0.02 },
      ],
      byDay,
      recent: [
        {
          id: 'e1',
          meter: 'llm',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          quantity: 20_730,
          unit: 'tokens',
          costUsd: 0.184,
          userId: 'u_ana',
          runId: 'run_3',
          pieceId: 'p_oval-pave',
          at: iso(40 * 60_000),
        },
        {
          id: 'e2',
          meter: 'image',
          provider: 'fal',
          model: 'flux-2-pro',
          quantity: 4,
          unit: 'images',
          costUsd: 0.2,
          userId: 'u_leo',
          runId: null,
          pieceId: null,
          at: iso(5 * 3_600_000),
        },
        {
          id: 'e3',
          meter: 'search',
          provider: 'the-met',
          model: null,
          quantity: 12,
          unit: 'queries',
          costUsd: 0,
          userId: 'u_leo',
          runId: null,
          pieceId: null,
          at: iso(6 * 3_600_000),
        },
        {
          id: 'e4',
          meter: 'render',
          provider: 'blender-cloud',
          model: null,
          quantity: 3,
          unit: 'min',
          costUsd: 0.36,
          userId: 'u_ana',
          runId: null,
          pieceId: 'p_halo',
          at: iso(20 * 3_600_000),
        },
        {
          id: 'e5',
          meter: 'llm',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          quantity: 37_920,
          unit: 'tokens',
          costUsd: 0.412,
          userId: 'u_ana',
          runId: 'run_2',
          pieceId: 'p_oval-pave',
          at: iso(26 * 3_600_000),
        },
      ],
    }
  },
  'traces.runs': () => runs,
  'traces.run': (input) => ({
    run: runs.find((r) => r.id === input.id) ?? runs[0]!,
    steps: [
      {
        id: 's1',
        runId: input.id as string,
        index: 0,
        kind: 'model',
        name: 'claude-opus-5-5',
        input: { messages: 6 },
        output: { stop_reason: 'tool_use' },
        isError: false,
        ms: 2410,
        changeIds: [],
        startedAt: iso(40 * 60_000),
      },
      {
        id: 's2',
        runId: input.id as string,
        index: 1,
        kind: 'tool',
        name: 'design.evaluate',
        input: { pieceId: 'p_oval-pave' },
        output: { metalMassG: 3.41, caratTotal: 1.82 },
        isError: false,
        ms: 184,
        changeIds: [],
        startedAt: iso(40 * 60_000),
      },
      {
        id: 's3',
        runId: input.id as string,
        index: 2,
        kind: 'tool',
        name: 'design.apply',
        input: { label: 'Lowered the head 0.4 mm' },
        output: { version: 7 },
        isError: false,
        ms: 96,
        changeIds: ['ch7'],
        startedAt: iso(40 * 60_000),
      },
      {
        id: 's4',
        runId: input.id as string,
        index: 3,
        kind: 'model',
        name: 'claude-opus-5-5',
        input: { messages: 9 },
        output: { stop_reason: 'end_turn' },
        isError: false,
        ms: 1730,
        changeIds: [],
        startedAt: iso(39 * 60_000),
      },
    ],
  }),
}
