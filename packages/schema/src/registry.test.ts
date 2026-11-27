import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BrandModelSchema,
  CLIENT_TOOL_NAMES,
  COMMAND_NAMES,
  type CommandDef,
  clientTools,
  commands,
  isToolCommand,
  minimumRole,
  needsConfirmation,
  originNeedsAttestation,
  RenderSceneSchema,
  RunEventSchema,
  SERVER_EVENT_TYPES,
  ServerEventSchema,
  ViewSchema,
} from './index'

const all: [string, CommandDef][] = [
  ...COMMAND_NAMES.map((n): [string, CommandDef] => [n, commands[n]]),
  ...CLIENT_TOOL_NAMES.map((n): [string, CommandDef] => [n, clientTools[n]]),
]

describe('the command registry', () => {
  it('allows a larger batch of measured model additions or removals from one recorded change', () => {
    const accepts = (ops: unknown[], reverts?: string[]) =>
      commands['design.apply'].input.safeParse({
        pieceId: 'project',
        label: 'Import',
        ops,
        reverts,
      }).success
    const adds = Array.from({ length: 1001 }, (_, i) => ({
      t: 'add',
      node:
        i % 2 === 0
          ? {
              id: `body-${i}`,
              kind: 'meshBody',
              source: { type: 'asset', assetId: 'stl' },
              keepSourcePlacement: true,
            }
          : {
              id: `curve-${i}`,
              kind: 'nurbsCurve',
              degree: 1,
              knots: [0, 1],
              controlPoints: [
                [0, 0, 0, 1],
                [1, 0, 0, 1],
              ],
            },
    }))
    expect(accepts(adds.slice(0, 1000))).toBe(true)
    expect(accepts(adds)).toBe(false)
    const other = { t: 'update', id: 'body-0', patch: { visible: false } }
    expect(accepts([...adds.slice(0, 499), other])).toBe(true)
    expect(accepts([...adds.slice(0, 500), other])).toBe(false)
    expect(
      accepts([
        ...adds.slice(0, 500),
        { t: 'add', node: { kind: 'meshBody', source: { type: 'builtin' } } },
      ]),
    ).toBe(false)
    const removals = adds.slice(0, 501).map(({ node }) => ({ t: 'remove', id: node.id }))
    expect(accepts(removals)).toBe(false)
    expect(accepts(removals, ['import'])).toBe(true)
    expect(accepts(removals, ['import', 'other'])).toBe(false)
    expect(
      accepts([...removals.slice(0, 500), { ...removals[500], cascade: true }], ['import']),
    ).toBe(false)
  })

  it('names every command noun.verb, once across commands and client tools', () => {
    for (const [name] of all) expect(name).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/)
    const names = all.map(([n]) => n)
    expect(new Set(names).size).toBe(names.length)
    // Tools travel as `noun_verb`; the mapping must stay reversible.
    const wire = names.map((n) => n.replaceAll('.', '_'))
    expect(new Set(wire).size).toBe(names.length)
    expect(names.every((n) => !n.includes('_'))).toBe(true)
  })

  it('takes a top-level object as every input and emits JSON Schema for every tool', () => {
    for (const [name, def] of all) {
      const js = z.toJSONSchema(def.input, { io: 'input' }) as { type?: string }
      expect(js.type, name).toBe('object')
      if ('tool' in def) expect(() => z.toJSONSchema(def.output), name).not.toThrow()
      expect(def.description.length, name).toBeGreaterThan(10)
    }
  })

  it('keeps attestations, approvals and relays away from the assistant', () => {
    for (const name of [
      'pieces.attest',
      'models.create',
      'models.update',
      'references.update',
      'runs.decide',
      'runs.cancel',
      'client.respond',
      'threads.send',
      'renders.complete',
      'renders.configureEngine',
    ] as const)
      expect(isToolCommand(name), name).toBe(false)
  })

  it('asks for confirmation before spending money or destroying work', () => {
    for (const name of [
      'mesh3d.create',
      'shots.create',
      'references.generate',
      'models.generatePortraits',
      'pieces.buildFromSpec',
      'pieces.delete',
      'boards.delete',
    ] as const)
      expect(needsConfirmation(name), name).toBe(true)
    for (const name of [
      'freeform.analyze',
      'mesh3d.estimate',
      'shots.estimate',
      'references.estimate',
      'models.estimatePortraits',
      'scenes.update',
    ] as const)
      expect(needsConfirmation(name), name).toBe(false)
    // A generation is four images from a checked brief unless asked otherwise, priced by count.
    const generate = commands['references.generate'].input.parse({ briefId: 'b' })
    expect(generate.count).toBe(4)
    expect(commands['references.estimate'].input.parse({ boardId: 'x' }).count).toBe(4)
    // Attesting rights to a brand is a person's act: never a tool.
    expect(isToolCommand('references.attestBrief')).toBe(false)
    expect(isToolCommand('references.brief')).toBe(true)
    expect(isToolCommand('references.estimate') && isToolCommand('models.estimatePortraits')).toBe(
      true,
    )
  })

  it('sets roles deliberately', () => {
    expect(minimumRole('renders.configureEngine')).toBe('owner')
    expect(minimumRole('client.respond')).toBe('viewer')
    expect(minimumRole('pieces.attest')).toBe('designer')
    expect(clientTools['viewport.capture'].role).toBe('designer')
  })

  it('validates inputs that need exactly one of two fields', () => {
    const revert = commands['design.revert'].input
    expect(revert.safeParse({ pieceId: 'p', seq: 3 }).success).toBe(true)
    expect(revert.safeParse({ pieceId: 'p', runId: 'run_1' }).success).toBe(true)
    expect(revert.safeParse({ pieceId: 'p' }).success).toBe(false)
    expect(revert.safeParse({ pieceId: 'p', seq: 3, runId: 'run_1' }).success).toBe(false)

    const render = commands['renders.create'].input
    expect(render.safeParse({ pieceId: 'p' }).success).toBe(false)
    expect(render.parse({ pieceId: 'p', sceneId: 's' })).toMatchObject({
      engine: 'auto',
      autoTune: false,
      purpose: 'take',
    })
    const complete = commands['renders.complete'].input
    expect(complete.safeParse({ id: 'r', assetIds: ['a'] }).success).toBe(true)
    expect(complete.safeParse({ id: 'r', error: 'WebGL lost' }).success).toBe(true)
    expect(complete.safeParse({ id: 'r' }).success).toBe(false)
    expect(commands['client.respond'].input.safeParse({ requestId: 'q' }).success).toBe(false)
    expect(commands['references.similar'].input.safeParse({}).success).toBe(false)
  })

  it('refuses inputs that would be silently misread', () => {
    const save = commands['references.save'].input
    const item = (x: object) => save.safeParse({ boardId: 'b', items: [x] }).success
    expect(item({ url: 'https://example.com/a' })).toBe(true)
    expect(item({ url: 'https://example.com/a', note: 'why' })).toBe(true)
    expect(item({ note: 'just a thought' })).toBe(true)
    expect(item({ swatch: { hex: '#AABBCC' }, pieceId: 'p' })).toBe(true)
    expect(item({ url: 'https://example.com/a', swatch: { hex: '#AABBCC' } })).toBe(false)
    expect(item({ assetId: 'a', url: 'https://example.com/a' })).toBe(false)
    expect(item({ title: 'nothing to save' })).toBe(false)

    // Nothing to change is a bad request, not an empty write.
    expect(commands['renders.update'].input.safeParse({ id: 'r' }).success).toBe(false)
    expect(commands['renders.update'].input.safeParse({ id: 'r', starred: true }).success).toBe(
      true,
    )
    const ref = commands['references.update'].input
    expect(ref.safeParse({ id: 'r' }).success).toBe(false)
    expect(ref.safeParse({ id: 'r', attestation: true }).success).toBe(false)
    expect(ref.safeParse({ id: 'r', rights: 'own', attestation: true }).success).toBe(true)
  })

  it('changes only the card fields a partial model edit gives', () => {
    const update = commands['models.update'].input.parse({ id: 'm', card: { hair: 'braids' } })
    expect(update.card).toEqual({ hair: 'braids' })
    const created = commands['models.create'].input.parse({
      name: 'Mara',
      attestedSynthetic: true,
      card: {
        description: '',
        ageRange: '25-34',
        skinTone: '',
        hair: '',
        build: '',
        styling: '',
        ringSizeUs: null,
        wristMm: null,
        neckMm: null,
      },
    })
    expect(created.card).toMatchObject({
      monkTone: null,
      undertone: null,
      eyes: '',
      marks: '',
      handLengthMm: null,
    })
  })
})

describe('client tools', () => {
  it('capture from named or orbit views with sensible defaults', () => {
    const input = clientTools['viewport.capture'].input.parse({
      pieceId: 'p',
      views: ['front', { azimuth: 30, elevation: 20 }],
    })
    expect(input).toMatchObject({ mode: 'clay', size: 768 })
    expect(ViewSchema.safeParse('custom').success).toBe(false)
    expect(
      clientTools['viewport.capture'].input.safeParse({ pieceId: 'p', views: [] }).success,
    ).toBe(false)
  })

  it('navigate to exactly one place, selecting only on a piece', () => {
    const go = (x: object) => clientTools['ui.navigate'].input.safeParse(x).success
    expect(go({ pieceId: 'p', tab: 'design', selectNodeIds: ['band'] })).toBe(true)
    expect(go({ boardId: 'b' })).toBe(true)
    expect(go({})).toBe(false)
    expect(go({ tab: 'design' })).toBe(false)
    expect(go({ pieceId: 'p', boardId: 'b' })).toBe(false)
    expect(go({ boardId: 'b', selectNodeIds: ['band'] })).toBe(false)
  })
})

describe('events', () => {
  it('describe every server event and validate payloads', () => {
    expect(SERVER_EVENT_TYPES).toEqual([
      'design.changed',
      'piece.updated',
      'board.updated',
      'scene.updated',
      'render.installRequested',
      'job.updated',
      'run.updated',
      'client.request',
    ])
    expect(
      ServerEventSchema.safeParse({
        type: 'job.updated',
        kind: 'mesh3d',
        id: 'm',
        pieceId: 'p',
        status: 'running',
        progress: 0.4,
      }).success,
    ).toBe(true)
    expect(
      ServerEventSchema.safeParse({
        type: 'client.request',
        requestId: 'q',
        runId: null,
        tool: 'viewport.capture',
        input: {},
      }).success,
    ).toBe(true)
    expect(
      ServerEventSchema.safeParse({
        type: 'client.request',
        requestId: 'q',
        runId: null,
        tool: 'design.apply',
      }).success,
    ).toBe(false)
  })

  it('number run events from 1', () => {
    const delta = { type: 'text.delta', runId: 'r', index: 0, text: 'Hi' }
    expect(RunEventSchema.safeParse({ ...delta, seq: 1 }).success).toBe(true)
    expect(RunEventSchema.safeParse({ ...delta, seq: 0 }).success).toBe(false)
  })
})

describe('entities', () => {
  it('describes render scene fields for a generated inspector without changing defaults', () => {
    const js = z.toJSONSchema(RenderSceneSchema, { io: 'input' }) as {
      properties: Record<
        string,
        { title?: string; properties?: Record<string, { title?: string; unit?: string }> }
      >
    }
    expect(js.properties.camera!.properties!.focalLength).toMatchObject({
      title: 'Lens',
      unit: 'mm',
    })
    expect(js.properties.sparkle).toMatchObject({ title: 'Sparkle' })
    const scene = RenderSceneSchema.parse({ overrides: { '*': { material: 'au18k-rose' } } })
    expect(scene).toMatchObject({
      look: 'studio-soft',
      camera: { preset: 'hero', focalLength: 90 },
    })
    expect(scene.overrides['*']).toEqual({ material: 'au18k-rose' })
  })

  it('requires attestation only for pieces made from someone’s sources', () => {
    const origin = { kind: 'image' as const, sourceAssetIds: ['as_1'], referenceIds: [], flags: [] }
    expect(originNeedsAttestation(null)).toBe(false)
    expect(originNeedsAttestation({ ...origin, attestation: null })).toBe(true)
    expect(
      originNeedsAttestation({ ...origin, sourceAssetIds: [], kind: 'text', attestation: null }),
    ).toBe(false)
    expect(
      originNeedsAttestation({
        ...origin,
        attestation: { rights: 'own', likenessConsent: false, by: 'u', at: '2026-01-01' },
      }),
    ).toBe(false)
  })

  it('keeps brand models adult', () => {
    const card = BrandModelSchema.shape.card
    const newCard = commands['models.create'].input.shape.card
    const base = {
      description: '',
      skinTone: '',
      hair: '',
      build: '',
      styling: '',
      ringSizeUs: null,
      wristMm: null,
      neckMm: null,
    }
    expect(newCard.safeParse({ ...base, ageRange: '25-34' }).success).toBe(true)
    expect(newCard.safeParse({ ...base, ageRange: '16-17' }).success).toBe(false)
    expect(card.partial().safeParse({ ageRange: '16-17' }).success).toBe(false)
    // The stored card has no defaults (a partial edit must not fill them); a new card does.
    expect(card.safeParse({ ...base, ageRange: '25-34' }).success).toBe(false)
    expect(newCard.parse({ ...base, ageRange: '25-34' })).toMatchObject({
      monkTone: null,
      eyes: '',
      marks: '',
    })
  })
})
