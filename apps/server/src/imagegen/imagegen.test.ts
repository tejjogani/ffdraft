/**
 * Concept images on the design board, end to end through the real pipeline: Claude (the fake
 * Claude API, answering as scripted) writes the brief and checks the images; the fake image
 * provider draws them. Covers prompt enhancement with references, four results, variations and
 * refinements, metering, every guardrail refusal, rights attestation, the provider's own filter,
 * keys in Settings, AI, the no-key state, and the assistant doing it inside a run.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type FakeProvider, fakeProvider, openaiProvider } from '@pave/ideation'
import {
  type BriefRead,
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_WORDS,
  type GuardrailCategory,
  type ImageCheckRead,
} from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { putAsset } from '../assets/assets'
import { type AssistantServer, assistantServer, settled, text, tool } from '../assistant/testing'
import * as t from '../db/schema'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'

const KEY = 'sk-ant-test-0123456789abcdef'
const PROMPT =
  'An 18k yellow gold pendant shaped like the trophy in reference 1, with the milgrain border and round bail of reference 2, about 25 mm tall, front view, centred, soft studio light, on a plain light grey background.'

const briefJson = (o: Partial<BriefRead> = {}) =>
  JSON.stringify({
    verdict: 'allow',
    category: null,
    reason: 'A trophy-shaped pendant in the style of the second pendant.',
    rightsSubject: null,
    understanding: 'The trophy as a pendant, in the style of the pendant.',
    piece: { kind: 'pendant', metal: '18k yellow gold', stones: null, view: 'front' },
    prompt: PROMPT,
    ...o,
  } satisfies BriefRead)

const checkJson = (verdicts: ImageCheckRead['images']) => JSON.stringify({ images: verdicts })
const allAllowed = (n: number) =>
  checkJson(
    Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      verdict: 'allow' as const,
      category: null,
      reason: 'A gold pendant.',
    })),
  )

const png = (color: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .png()
    .toBuffer()

/** Images in a Claude request, with the text label before each. */
function imagesIn(params: BetaMessageStreamParams): string[] {
  const content = params.messages[0]?.content
  if (!content || typeof content === 'string') return []
  const labels: string[] = []
  content.forEach((b, i) => {
    if (b.type === 'image') {
      const before = content[i - 1]
      labels.push(before?.type === 'text' ? before.text : '?')
    }
  })
  return labels
}

let s: AssistantServer
let api: Client
let fake: FakeProvider

async function boardWithPictures(title = 'Trophy pendant') {
  const piece = await api.call('pieces.create', { kind: 'pendant', title })
  const board = await api.call('boards.create', { title, pieceId: piece.id })
  const ctx = await s.server.runtime.context(s.server.runtime.local!)
  const trophy = await putAsset(ctx, { bytes: await png('#c9a13b'), name: 'trophy.png' })
  const pendant = await putAsset(ctx, { bytes: await png('#888888'), name: 'pendant.png' })
  const [a, b] = await api.call('references.save', {
    boardId: board.id,
    items: [
      { assetId: trophy.id, title: 'The trophy' },
      { assetId: pendant.id, title: 'A pendant I like' },
    ],
  })
  return { piece, board, trophy: a!, pendant: b! }
}

async function assetCount() {
  const ctx = await s.server.runtime.context(s.server.runtime.local!)
  return (await ctx.repo.assets.many()).length
}

beforeAll(async () => {
  fake = fakeProvider({ size: 96 })
  s = await assistantServer({
    env: { ANTHROPIC_API_KEY: KEY },
    images: { env: { PAVE_IMAGE_GEN: 'fake' }, providers: { fake } },
  })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

describe('prompt enhancement, references and four results', () => {
  it('adds imported notes and link details to the active board’s image brief', async () => {
    const piece = await api.call('pieces.create', { title: 'Ring from studio' })
    const source = await api.call('boards.create', { title: 'Ring moodboard' })
    await api.call('references.save', {
      boardId: source.id,
      items: [
        { note: 'Keep a low profile for gloves.' },
        { title: 'Oval reference', url: 'https://www.pinterest.com/pin/789/' },
      ],
    })
    const { board } = await api.call('boards.importMoodboard', {
      pieceId: piece.id,
      sourceBoardId: source.id,
    })
    let request: BetaMessageStreamParams | null = null
    s.model.push(({ params }) => {
      request = params
      return { content: [text(briefJson())] }
    })
    await api.call('references.brief', { boardId: board.id, request: 'A clean oval ring' })
    const content = JSON.stringify(request!.messages)
    expect(content).toContain('Keep a low profile for gloves.')
    expect(content).toContain('https://www.pinterest.com/pin/789/')
    expect(imagesIn(request!)).toEqual([])
  })

  it('briefs the request with its references, then generates four checked images with lineage and metering', async () => {
    const { piece, board, trophy, pendant } = await boardWithPictures()
    let briefReq: BetaMessageStreamParams | null = null
    let checkReq: BetaMessageStreamParams | null = null
    s.model.push(
      ({ params }) => {
        briefReq = params
        return { content: [text(briefJson())] }
      },
      ({ params }) => {
        checkReq = params
        return { content: [text(allAllowed(4))] }
      },
    )
    const brief = await api.call('references.brief', {
      boardId: board.id,
      request: 'this trophy as a pendant, in the style of this pendant',
      referenceIds: [trophy.id, pendant.id],
      roles: [
        { id: trophy.id, role: 'subject' },
        { id: pendant.id, role: 'style' },
      ],
    })
    // The brief is a structured call that sees both pictures, labelled in order with their roles.
    expect(briefReq!.output_config?.format?.type).toBe('json_schema')
    expect(briefReq!.output_config?.effort).toBe('high')
    expect(imagesIn(briefReq!)).toEqual([
      'Reference 1 (subject): The trophy',
      'Reference 2 (style): A pendant I like',
    ])
    expect(JSON.stringify(briefReq!.system)).toContain('plain, seamless')
    expect(brief).toMatchObject({
      verdict: 'allow',
      prompt: PROMPT,
      provider: 'fake',
      referenceIds: [trophy.id, pendant.id],
      estimate: { count: 4, perImageUsd: 0.01, usd: 0.04 },
      decisions: [{ stage: 'request', verdict: 'allow' }],
    })
    expect(brief.claudeUsd).toBeGreaterThan(0)

    const before = await assetCount()
    const out = await api.call('references.generate', { briefId: brief.id })
    // The provider got exactly the prompt shown, the references in order, four images.
    const call = fake.calls.at(-1)!
    expect(call.prompt).toBe(PROMPT)
    expect(call.count).toBe(4)
    expect(call.references.map((r) => [r.title, r.role])).toEqual([
      ['The trophy', 'subject'],
      ['A pendant I like', 'style'],
    ])
    // Claude looked at all four before any was stored.
    expect(imagesIn(checkReq!)).toEqual(['Image 1', 'Image 2', 'Image 3', 'Image 4'])
    expect(out.references).toHaveLength(4)
    expect(out.refused).toEqual([])
    expect((await assetCount()) - before).toBe(4)
    expect(out.references[0]).toMatchObject({
      type: 'generated',
      rights: 'own',
      generation: {
        prompt: PROMPT,
        request: 'this trophy as a pendant, in the style of this pendant',
        briefId: brief.id,
        provider: 'fake',
        costUsd: 0.01,
        parentIds: [trophy.id, pendant.id],
        inputs: [
          { id: trophy.id, role: 'subject', title: 'The trophy' },
          { id: pendant.id, role: 'style', title: 'A pendant I like' },
        ],
      },
    })
    expect(out.cost.imageUsd).toBeCloseTo(0.04, 6)
    expect(out.cost.claudeUsd).toBeGreaterThan(0)
    expect(out.brief.generations).toBe(1)
    expect(out.brief.decisions.filter((d) => d.stage === 'image')).toHaveLength(4)

    // Metered as Design work on the project: Claude's brief and check, and the four images.
    const ctx = await s.server.runtime.context(s.server.runtime.local!)
    const rows = await ctx.repo.usage.many({ where: eq(t.usageEvent.pieceId, piece.id) })
    const image = rows.filter((r) => r.meter === 'image')
    expect(image).toHaveLength(1)
    expect(image[0]).toMatchObject({ provider: 'fake', quantity: 4, stage: 'design' })
    const llm = rows.filter((r) => r.meter === 'llm')
    expect(llm.map((r) => r.idempotencyKey.split(':').at(-1)).sort()).toEqual(['brief', 'check'])
    expect(llm.every((r) => r.stage === 'design')).toBe(true)
    expect(s.model.problems()).toEqual([])
  })

  it('varies one image and refines another, each starting from its parent', async () => {
    const { board, trophy } = await boardWithPictures('Variations')
    s.model.push({ content: [text(briefJson())] }, { content: [text(allAllowed(1))] })
    const brief = await api.call('references.brief', {
      boardId: board.id,
      request: 'the trophy as a pendant',
      referenceIds: [trophy.id],
    })
    const [first] = (await api.call('references.generate', { briefId: brief.id, count: 1 }))
      .references

    let varyReq: BetaMessageStreamParams | null = null
    s.model.push(
      ({ params }) => {
        varyReq = params
        return {
          content: [text(briefJson({ prompt: `${PROMPT} A variation: a bezel-set stone.` }))],
        }
      },
      { content: [text(allAllowed(2))] },
    )
    const vary = await api.call('references.brief', {
      boardId: board.id,
      request: 'try a variation',
      mode: 'vary',
      parentId: first!.id,
    })
    expect(imagesIn(varyReq!)).toEqual(['Parent image'])
    const varied = await api.call('references.generate', { briefId: vary.id, count: 2 })
    expect(fake.calls.at(-1)!.references.map((r) => r.role)).toEqual(['subject'])
    expect(varied.references[0]!.generation?.parentIds).toEqual([first!.id])

    let refineReq: BetaMessageStreamParams | null = null
    s.model.push(
      ({ params }) => {
        refineReq = params
        return { content: [text(briefJson({ prompt: `${PROMPT} The bail is smaller.` }))] }
      },
      { content: [text(allAllowed(1))] },
    )
    const refine = await api.call('references.brief', {
      boardId: board.id,
      request: 'make the bail smaller',
      mode: 'refine',
      parentId: varied.references[0]!.id,
      referenceIds: [trophy.id],
    })
    expect(JSON.stringify(refineReq!.messages)).toContain('refines the parent image')
    const refined = await api.call('references.generate', { briefId: refine.id, count: 1 })
    expect(refined.references[0]!.generation?.parentIds).toEqual([
      varied.references[0]!.id,
      trophy.id,
    ])
    // Regenerate: the same brief again makes new images and counts the generation.
    s.model.push({ content: [text(allAllowed(1))] })
    const again = await api.call('references.generate', { briefId: refine.id, count: 1 })
    expect(again.brief.generations).toBe(2)
    expect((await api.call('references.briefs', { boardId: board.id })).map((b) => b.id)).toEqual([
      refine.id,
      vary.id,
      brief.id,
    ])
    // Vary without a parent is refused before Claude is asked.
    const bad = await api.fail('references.brief', {
      boardId: board.id,
      request: 'vary it',
      mode: 'vary',
    })
    expect(bad.status).toBe(400)
  })

  it('checks an edited prompt again before generating from it', async () => {
    const { board } = await boardWithPictures('Edited')
    s.model.push({ content: [text(briefJson())] })
    const brief = await api.call('references.brief', { boardId: board.id, request: 'a pendant' })
    const calls = fake.calls.length
    s.model.push({
      content: [
        text(
          briefJson({
            verdict: 'refuse',
            category: 'hate',
            reason: 'The edited prompt adds an extremist symbol.',
            prompt: '',
          }),
        ),
      ],
    })
    const refused = await api.fail('references.generate', {
      briefId: brief.id,
      prompt: `${PROMPT} With a hate symbol engraved.`,
    })
    expect(refused.status).toBe(409)
    expect(refused.error.message).toContain(GUARDRAIL_WORDS.hate)
    expect(fake.calls.length).toBe(calls)
    const edited = `${PROMPT} In rose gold.`
    s.model.push(
      { content: [text(briefJson({ prompt: edited }))] },
      { content: [text(allAllowed(1))] },
    )
    const out = await api.call('references.generate', {
      briefId: brief.id,
      prompt: edited,
      count: 1,
    })
    expect(fake.calls.at(-1)!.prompt).toBe(edited)
    expect(out.brief.prompt).toBe(edited)
    expect(out.brief.decisions.map((d) => `${d.stage}:${d.verdict}`)).toEqual([
      'request:allow',
      'request:refuse',
      'request:allow',
      'image:allow',
    ])
  })
})

describe('guardrails', () => {
  const refusable = GUARDRAIL_CATEGORIES.filter(
    (c): c is Exclude<GuardrailCategory, 'trademark'> => c !== 'trademark',
  )

  it.each(refusable)('refuses a %s request before anything is generated', async (category) => {
    const { board } = await boardWithPictures(`Refused ${category}`)
    s.model.push({
      content: [
        text(
          briefJson({
            verdict: 'refuse',
            category,
            reason: 'This asks for something Pavé does not make.',
            prompt: '',
          }),
        ),
      ],
    })
    const calls = fake.calls.length
    const brief = await api.call('references.brief', { boardId: board.id, request: 'a request' })
    expect(brief).toMatchObject({ verdict: 'refuse', category, prompt: '' })
    expect(brief.reason).toContain(GUARDRAIL_WORDS[category])
    const go = await api.fail('references.generate', { briefId: brief.id })
    expect([go.status, go.error.category]).toEqual([409, category])
    expect(fake.calls.length).toBe(calls)
    // A refusal cannot be attested away.
    expect((await api.fail('references.attestBrief', { id: brief.id, rights: 'own' })).status).toBe(
      409,
    )
  })

  it('needs the person’s attestation for another company’s trademark; the assistant cannot give it', async () => {
    const { board } = await boardWithPictures('Team crest')
    s.model.push({
      content: [
        text(
          briefJson({
            verdict: 'needs_rights',
            category: 'trademark',
            reason: 'This uses a football club’s crest.',
            rightsSubject: 'the club’s crest',
          }),
        ),
      ],
    })
    const brief = await api.call('references.brief', {
      boardId: board.id,
      request: 'a pendant with my club’s crest',
    })
    expect(brief).toMatchObject({ verdict: 'needs_rights', rightsSubject: 'the club’s crest' })
    expect(brief.reason).toContain(GUARDRAIL_WORDS.trademark)
    expect((await api.fail('references.generate', { briefId: brief.id })).status).toBe(409)

    const agent = await s.server.runtime.context({
      ...s.server.runtime.local!,
      actor: { type: 'agent', runId: 'run_x' },
    })
    await expect(
      s.server.runtime.invoke('references.attestBrief', { id: brief.id, rights: 'own' }, agent),
    ).rejects.toMatchObject({ status: 403 })

    const attested = await api.call('references.attestBrief', { id: brief.id, rights: 'licensed' })
    expect(attested.attestation).toMatchObject({ rights: 'licensed' })
    expect(attested.decisions.at(-1)).toMatchObject({ verdict: 'attested', category: 'trademark' })
    let checkReq: BetaMessageStreamParams | null = null
    s.model.push(({ params }) => {
      checkReq = params
      return {
        content: [
          text(
            checkJson([
              { index: 1, verdict: 'allow', category: 'trademark', reason: 'The crest, attested.' },
            ]),
          ),
        ],
      }
    })
    const out = await api.call('references.generate', { briefId: brief.id, count: 1 })
    expect(out.references).toHaveLength(1)
    expect(JSON.stringify(checkReq!.messages)).toContain(
      'attested the right to use: the club’s crest',
    )
  })

  it('never stores an image Claude refuses after generating, nor one the provider withheld', async () => {
    const { board } = await boardWithPictures('After')
    s.model.push({ content: [text(briefJson({ prompt: `${PROMPT} [fake:block 4]` }))] })
    const brief = await api.call('references.brief', { boardId: board.id, request: 'a pendant' })
    s.model.push({
      content: [
        text(
          checkJson([
            { index: 1, verdict: 'allow', category: null, reason: 'A pendant.' },
            { index: 2, verdict: 'refuse', category: 'sexual', reason: 'The image shows nudity.' },
            { index: 3, verdict: 'allow', category: null, reason: 'A pendant.' },
          ]),
        ),
      ],
    })
    const before = await assetCount()
    const out = await api.call('references.generate', { briefId: brief.id })
    expect(out.references).toHaveLength(2)
    expect((await assetCount()) - before).toBe(2)
    expect(out.refused.map((r) => [r.index, r.category])).toEqual([
      [2, 'sexual'],
      [4, 'other'],
    ])
    expect(out.refused[0]!.reason).toContain(GUARDRAIL_WORDS.sexual)
    expect(out.notes.join(' ')).toContain('2 of 4 images were refused')
    expect(out.brief.decisions.map((d) => `${d.stage}:${d.index}:${d.verdict}`)).toEqual([
      'request:null:allow',
      'provider:4:refuse',
      'image:1:allow',
      'image:2:refuse',
      'image:3:allow',
    ])
  })

  it('keeps nothing when Claude declines to check the images (fails closed)', async () => {
    const { board } = await boardWithPictures('Declined')
    s.model.push({ content: [text(briefJson())] })
    const brief = await api.call('references.brief', { boardId: board.id, request: 'a pendant' })
    s.model.push({ content: [], stop_reason: 'refusal' })
    const before = await assetCount()
    const out = await api.call('references.generate', { briefId: brief.id, count: 2 })
    expect(out.references).toEqual([])
    expect(out.refused).toHaveLength(2)
    expect((await assetCount()) - before).toBe(0)
  })

  it('checks the budget against the price before the provider is called', async () => {
    const { board } = await boardWithPictures('Budget')
    s.model.push({ content: [text(briefJson())] })
    const brief = await api.call('references.brief', { boardId: board.id, request: 'a pendant' })
    const ctx = await s.server.runtime.context(s.server.runtime.local!)
    const spent = (await ctx.repo.usage.many()).reduce((sum, r) => sum + r.costMicros, 0) / 1e6
    await api.call('org.settings.update', { monthlyBudgetUsd: spent + 0.02 })
    const calls = fake.calls.length
    const over = await api.fail('references.generate', { briefId: brief.id })
    expect([over.status, over.error.code]).toEqual([402, 'budget_exceeded'])
    expect(fake.calls.length).toBe(calls)
    await api.call('org.settings.update', { monthlyBudgetUsd: null })
  })
})

describe('the assistant generates inside a run', () => {
  it('briefs, asks approval with the enhanced prompt and price, and bills Claude to the run', async () => {
    const { board, trophy } = await boardWithPictures('In a run')
    s.model.push(
      {
        content: [
          tool(
            'references_brief',
            { boardId: board.id, request: 'the trophy as a pendant', referenceIds: [trophy.id] },
            'tb',
          ),
        ],
      },
      { content: [text(briefJson())] },
      ({ params }) => {
        const last = params.messages.at(-1)!
        const result = JSON.stringify(last.content)
        const id = /"id\\":\\"(brf_[A-Za-z0-9_-]+)/.exec(result)?.[1]
        return { content: [tool('references_generate', { briefId: id, count: 2 }, 'tg')] }
      },
    )
    const { run } = await api.call('threads.send', {
      text: 'Make concepts of the trophy as a pendant',
      clientId: 'w1',
      clientMessageId: 'gen-1',
    } as never)
    await settled(s.parts, run.id, 60_000)
    let detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status).toBe('awaiting-approval')
    const waiting = detail.steps.find((x) => x.name === 'references.generate')!
    expect(waiting.status).toBe('awaiting-approval')

    s.model.push(
      { content: [text(allAllowed(2))] },
      { content: [text('Two concepts are on the board.')] },
    )
    await api.call('runs.decide', { runId: run.id, toolCallId: 'tg', decision: 'approve' } as never)
    await settled(s.parts, run.id, 60_000)
    detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status, JSON.stringify(detail.run)).toBe('done')
    const ctx = await s.server.runtime.context(s.server.runtime.local!)
    const runLlm = await ctx.repo.usage.many({
      where: and(eq(t.usageEvent.runId, run.id), eq(t.usageEvent.meter, 'llm')),
    })
    // The turns, plus the brief and the check, all on the run.
    expect(runLlm.some((r) => r.idempotencyKey.endsWith(':brief'))).toBe(true)
    expect(runLlm.some((r) => r.idempotencyKey.endsWith(':check'))).toBe(true)
    const images = await ctx.repo.references.many({
      where: and(eq(t.reference.boardId, board.id), eq(t.reference.type, 'generated')),
    })
    expect(images).toHaveLength(2)
    expect(images[0]!.generation?.runId).toBe(run.id)
    expect(s.model.problems()).toEqual([])
  })
})

describe('keys and the no-key state', () => {
  let bare: AssistantServer
  let bareApi: Client
  const seen: string[] = []
  beforeAll(async () => {
    // OpenAI's adapter over a fetch that answers like OpenAI: the model list for a key check.
    const openai = openaiProvider({
      fetch: (async (url: string, init: RequestInit = {}) => {
        const auth = new Headers(init.headers).get('authorization') ?? ''
        seen.push(auth)
        return auth.endsWith('good-key-1234')
          ? new Response(JSON.stringify({ data: [{ id: 'gpt-image-2.5-flare' }] }), { status: 200 })
          : new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
              status: 401,
            })
      }) as typeof fetch,
    })
    bare = await assistantServer({
      env: { ANTHROPIC_API_KEY: KEY },
      images: { env: {}, providers: { openai } },
    })
    bareApi = client(bare.server)
  }, BOOT_TIMEOUT)
  afterAll(() => bare.server.dispose())

  it('says calmly how to add a key, and everything else on the board still works', async () => {
    const setup = await bareApi.call('images.setup.get', {})
    expect(setup.providers.map((p) => [p.id, p.key.source])).toEqual([
      ['gemini', 'none'],
      ['openai', 'none'],
      ['higgsfield', 'none'],
    ])
    expect(setup.defaultProvider).toBeNull()
    expect((await bareApi.call('session.get', {})).capabilities.imageGeneration).toEqual([])
    const board = await bareApi.call('boards.create', { title: 'No key' })
    await bareApi.call('references.save', {
      boardId: board.id,
      items: [{ note: 'a trophy pendant' }],
    })
    const r = await bareApi.fail('references.brief', { boardId: board.id, request: 'a pendant' })
    expect(r.status).toBe(501)
    expect(r.error.message).toContain('Settings, AI')
  })

  it('tests, saves and removes a key without ever returning it', async () => {
    const bad = await bareApi.call('images.key.test', {
      provider: 'openai',
      apiKey: 'sk-bad-key-0000',
    })
    expect(bad).toEqual({
      ok: false,
      code: 'invalid',
      message: 'OpenAI did not accept this API key.',
    })
    const good = await bareApi.call('images.key.test', {
      provider: 'openai',
      apiKey: 'sk-good-key-1234',
    })
    expect(good.ok).toBe(true)
    const saved = await bareApi.call('images.key.set', {
      provider: 'openai',
      apiKey: 'sk-good-key-1234',
    })
    const openai = saved.providers.find((p) => p.id === 'openai')!
    expect(openai.key).toMatchObject({ source: 'settings', last4: '1234', editable: true })
    expect(JSON.stringify(saved)).not.toContain('sk-good-key')
    expect(saved.defaultProvider).toBe('openai')
    // Takes effect at once: the organisation can generate now.
    expect((await bareApi.call('session.get', {})).capabilities.imageGeneration).toEqual(['openai'])
    // The key is sealed in the database and kept out of the audit log.
    const ctx = await bare.server.runtime.context(bare.server.runtime.local!)
    const row = await ctx.repo.imageKeys.first()
    expect(row!.sealed).not.toContain('good-key')
    const audit = await ctx.repo.audit.many()
    expect(JSON.stringify(audit)).not.toContain('sk-good-key')
    // A stored key is tested without sending it again.
    expect((await bareApi.call('images.key.test', { provider: 'openai' })).ok).toBe(true)
    expect(seen.at(-1)).toBe('Bearer sk-good-key-1234')

    const updated = await bareApi.call('images.settings.update', {
      quality: 'draft',
      models: { openai: 'gpt-image-1-mini' },
    })
    expect(updated.quality).toBe('draft')
    expect(updated.providers.find((p) => p.id === 'openai')!.model).toBe('gpt-image-1-mini')
    expect(
      (await bareApi.fail('images.settings.update', { models: { openai: 'dall-e-9' } })).status,
    ).toBe(409)

    const removed = await bareApi.call('images.key.remove', { provider: 'openai' })
    expect(removed.providers.find((p) => p.id === 'openai')!.key.source).toBe('none')
    expect((await bareApi.call('session.get', {})).capabilities.imageGeneration).toEqual([])
  })

  it('lets a key in apps/server/.env win and refuses editing it in the app', async () => {
    const withEnv = await assistantServer({
      env: { ANTHROPIC_API_KEY: KEY },
      images: { env: { OPENAI_API_KEY: 'sk-env-key-9999' } },
    })
    try {
      const c = client(withEnv.server)
      const setup = await c.call('images.setup.get', {})
      expect(setup.providers.find((p) => p.id === 'openai')!.key).toMatchObject({
        source: 'env',
        last4: '9999',
        editable: false,
        envName: 'OPENAI_API_KEY',
      })
      const refused = await c.fail('images.key.set', {
        provider: 'openai',
        apiKey: 'sk-other-key-1',
      })
      expect(refused.status).toBe(409)
      expect(refused.error.message).toContain('OPENAI_API_KEY')
    } finally {
      await withEnv.server.dispose()
    }
  })
})
