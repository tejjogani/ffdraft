import { fakeProvider, sleep } from '@pave/ideation'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { putAsset } from '../assets/assets'
import { createImageGen } from '../imagegen'
import {
  BOOT_TIMEOUT,
  type Client,
  client,
  signUp,
  type TestServer,
  testServer,
} from '../test/harness'

const fake = fakeProvider({ size: 96 })
const generate = fake.generate
let heldRequest: AbortSignal | undefined
fake.generate = async (call) => {
  if (call.prompt.includes('Hold for cancellation')) {
    heldRequest = call.signal
    await sleep(30_000, call.signal)
  }
  return generate(call)
}
let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer({
    services: (runtime) =>
      createImageGen(runtime, { env: { PAVE_IMAGE_GEN: 'fake' }, providers: { fake } }).services,
  })
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const draft = (as = api) =>
  as.call('models.create', {
    name: 'River',
    attestedSynthetic: true,
    card: {
      description: 'Dark curls, freckles, natural nails',
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

async function completeTake(pieceId: string, color: string) {
  const take = await api.call('renders.create', { pieceId, scene: {}, engine: 'browser' })
  const bytes = await sharp({
    create: { width: 80, height: 100, channels: 3, background: color },
  })
    .png()
    .toBuffer()
  const ctx = await server.runtime.context(server.runtime.local!)
  const asset = await putAsset(ctx, { bytes, name: 'cad.png', mime: 'image/png' })
  await api.call('renders.complete', { id: take.id, assetIds: [asset.id] })
  return { take, bytes }
}

it('requires a finished still from the current CAD version before sending image references', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  const { id } = await draft()
  await api.call('models.update', { id, status: 'approved' })
  await completeTake(piece.id, '#ff0000')
  await api.call('design.apply', {
    pieceId: piece.id,
    label: 'Add a body',
    ops: [{ t: 'add', node: { id: 'body_extra', kind: 'primitive', shape: 'sphere' } }],
  })

  const input = { modelId: id, pieceId: piece.id, placement: 'hand' as const }
  const calls = fake.calls.length
  expect(await api.fail('shots.estimate', input)).toMatchObject({
    error: { code: 'conflict', message: expect.stringMatching(/still.*current/i) },
  })
  expect(await api.fail('shots.create', input)).toMatchObject({ status: 409 })
  expect(await api.call('shots.list', { pieceId: piece.id })).toEqual([])
  expect(fake.calls).toHaveLength(calls)
})

it('conditions a shot on the CAD render and generated portrait, saves the image, and records provenance', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  const { take, bytes } = await completeTake(piece.id, '#003366')
  const { id } = await draft()
  const portrait = await api.call('models.generatePortraits', { id, views: ['face'] })
  const model = await api.call('models.update', { id, status: 'approved' })
  const input = {
    modelId: id,
    pieceId: piece.id,
    placement: 'hand' as const,
    aspect: '4:5' as const,
  }
  expect((await api.call('session.get', {})).capabilities.onModel).toEqual(['fake'])
  expect(await api.call('shots.estimate', input)).toMatchObject({ usd: 0.01, provider: 'fake' })
  const [submitted] = await api.call('shots.create', input)

  await expect
    .poll(async () => (await api.call('shots.get', { id: submitted!.id })).status)
    .toBe('done')
  const shot = await api.call('shots.get', { id: submitted!.id })
  expect(shot).toMatchObject({
    sourceVersion: piece.version,
    modelVersion: model.version,
    stale: false,
    attempts: 1,
    fidelity: 'concept',
    check: null,
    provenance: {
      provider: 'fake',
      model: 'fake-image-1',
      referenceRenderIds: [take.id],
      portraitAssetIds: [portrait.portraits[0]!.assetId],
      disclosure: expect.stringMatching(/test/i),
    },
  })
  const call = fake.calls.at(-1)!
  expect(call.aspect).toBe('4:5')
  expect(call.references.map((r) => r.role)).toEqual(['product', 'identity'])
  const pixels = (image: Uint8Array) => sharp(image).raw().toBuffer()
  expect(await pixels(call.references[0]!.bytes)).toEqual(await pixels(bytes))
  const image = await api.request(`/api/assets/${shot.assetId}`)
  expect(image.ok).toBe(true)
  const preview = await sharp(Buffer.from(await image.arrayBuffer())).metadata()
  expect(preview.xmp).toBeUndefined()
  expect(preview).toMatchObject({
    format: 'png',
    width: 96,
    height: 96,
  })
  expect(await api.fail('shots.export', { id: shot.id })).toMatchObject({ status: 409 })
  const ctx = await server.runtime.context(server.runtime.local!)
  expect(await ctx.repo.usage.many()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        meter: 'image',
        provider: 'fake',
        pieceId: piece.id,
        costMicros: 10_000,
      }),
    ]),
  )
})

it('cancels a live image request and leaves no delivered result', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  await completeTake(piece.id, '#995522')
  const { id } = await draft()
  await api.call('models.update', { id, status: 'approved' })
  const [shot] = await api.call('shots.create', {
    modelId: id,
    pieceId: piece.id,
    placement: 'hand',
    direction: 'Hold for cancellation',
  })
  await expect.poll(() => !!heldRequest).toBe(true)
  expect(await api.call('shots.cancel', { id: shot!.id })).toMatchObject({
    status: 'canceled',
    assetId: null,
    provenance: null,
  })
  expect(heldRequest?.aborted).toBe(true)
})

it('records a provider refusal as a failed shot with no picture', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  await completeTake(piece.id, '#997722')
  const { id } = await draft()
  await api.call('models.update', { id, status: 'approved' })
  const [shot] = await api.call('shots.create', {
    modelId: id,
    pieceId: piece.id,
    placement: 'hand',
    direction: '[fake:block 1]',
  })
  await expect
    .poll(async () => api.call('shots.get', { id: shot!.id }))
    .toMatchObject({
      status: 'failed',
      assetId: null,
      error: expect.stringMatching(/withheld this image/i),
    })
})

it('refuses a shot that exceeds the workspace budget before writing a job', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  await completeTake(piece.id, '#116622')
  const { id } = await draft()
  await api.call('models.update', { id, status: 'approved' })
  await api.call('org.settings.update', { monthlyBudgetUsd: 0 })
  try {
    expect(
      await api.fail('shots.create', { modelId: id, pieceId: piece.id, placement: 'hand' }),
    ).toMatchObject({ status: 402, error: { code: 'budget_exceeded' } })
    expect(await api.call('shots.list', { pieceId: piece.id })).toEqual([])
  } finally {
    await api.call('org.settings.update', { monthlyBudgetUsd: null })
  }
})

it(
  'reports a reference-capable provider only to the organisation that configured it',
  async () => {
    const accounts = await testServer({
      auth: 'accounts',
      services: (runtime) => createImageGen(runtime, { env: {} }).services,
    })
    try {
      const a = await signUp(accounts, 'First Owner', 'first-owner@example.test')
      const b = await signUp(accounts, 'Second Owner', 'second-owner@example.test')
      await a.call('images.key.set', { provider: 'higgsfield', apiKey: 'test-no-request' })
      expect((await a.call('session.get', {})).capabilities.onModel).toEqual([])
      await a.call('images.key.set', { provider: 'openai', apiKey: 'test-no-request' })
      expect((await a.call('session.get', {})).capabilities.onModel).toEqual(['openai'])
      expect((await b.call('session.get', {})).capabilities.onModel).toEqual([])
      await a.call('images.settings.update', { defaultProvider: 'higgsfield' })
      expect((await a.call('session.get', {})).capabilities.onModel).toEqual([])
      const { id } = await draft(a)
      expect(await a.fail('models.estimatePortraits', { id, views: ['face'] })).toMatchObject({
        status: 501,
        error: { message: expect.stringMatching(/Settings → AI/) },
      })
      await a.call('images.settings.update', { defaultProvider: 'openai' })
      expect(await a.call('models.estimatePortraits', { id, views: ['face'] })).toMatchObject({
        provider: 'openai',
      })
      const other = await draft(b)
      expect(
        await b.fail('models.estimatePortraits', { id: other.id, views: ['face'] }),
      ).toMatchObject({
        status: 501,
        error: { message: expect.stringMatching(/Settings → AI/) },
      })
    } finally {
      await accounts.dispose()
    }
  },
  BOOT_TIMEOUT,
)
