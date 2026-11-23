import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Client, client, type TestServer, testServer } from './test/harness'
import { recordUsage } from './usage'

let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer()
  api = client(server)
})
afterAll(() => server.dispose())

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c9a13b' } })
    .png()
    .toBuffer()

async function upload(bytes: Uint8Array, name: string, type = '') {
  const form = new FormData()
  form.set('file', new File([bytes], name, { type }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('assets', () => {
  it('uploads an image, detecting kind, mime and dimensions', async () => {
    const bytes = await png(1200, 800)
    // A misleading client type and extension must not win over the bytes.
    const { status, body } = await upload(
      bytes,
      'C:\\Users\\me\\photo.jpg',
      'application/octet-stream',
    )
    expect(status).toBe(201)
    expect(body).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      name: 'photo.jpg',
      width: 1200,
      height: 800,
      bytes: bytes.byteLength,
    })
    expect(body.url).toBe(`/api/assets/${body.id}`)

    const res = await api.request(body.url as string)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)

    const etag = res.headers.get('etag')!
    const again = await api.request(body.url as string, { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
  })

  it('serves cached WebP thumbnails', async () => {
    const { body } = await upload(await png(1200, 800), 'big.png')
    const res = await api.request(`${body.url}?w=300`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    const thumb = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(thumb).metadata()
    expect(meta.width).toBe(480)
    expect(meta.height).toBe(320)

    const second = await api.request(`${body.url}?w=480`)
    expect(Buffer.from(await second.arrayBuffer()).equals(thumb)).toBe(true)
    const ctx = await server.runtime.context(server.runtime.local!)
    expect(await ctx.repo.assetVariants.count()).toBe(1)

    // Never upscaled.
    const { body: small } = await upload(await png(100, 50), 'small.png')
    const tiny = await api.request(`${small.url}?w=900`)
    expect((await sharp(Buffer.from(await tiny.arrayBuffer())).metadata()).width).toBe(100)

    expect((await api.request(`${body.url}?w=abc`)).status).toBe(400)
  })

  it('classifies non-image files by extension and stores identical bytes once', async () => {
    const stl = new TextEncoder().encode('solid ring\nendsolid ring\n')
    const a = await upload(stl, 'ring.STL')
    const b = await upload(stl, 'copy.stl')
    expect(a.body).toMatchObject({ kind: 'mesh', mime: 'model/stl', width: null })
    expect(b.body.id).not.toBe(a.body.id)
    const ctx = await server.runtime.context(server.runtime.local!)
    const blobs = await ctx.repo.blobs.many()
    expect(blobs.filter((x) => x.mime === 'model/stl')).toHaveLength(1)

    const res = await api.request(a.body.url as string)
    expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''ring.STL")
    // Thumbnails only apply to images; anything else is served as is.
    expect((await api.request(`${a.body.url}?w=64`)).headers.get('content-type')).toBe('model/stl')
  })

  it('validates uploads and 404s unknown assets', async () => {
    const form = new FormData()
    form.set('other', 'x')
    expect((await api.request('/api/assets', { method: 'POST', body: form })).status).toBe(400)
    expect((await api.request('/api/assets/as_missing')).status).toBe(404)
  })

  it('rejects uploads over the size limit', async () => {
    const small = await testServer({ config: { maxUploadBytes: 1024 } })
    const form = new FormData()
    form.set('file', new File([new Uint8Array(4096)], 'big.bin'))
    const res = await client(small).request('/api/assets', { method: 'POST', body: form })
    expect(res.status).toBe(413)
    await small.dispose()
  })
})

describe('usage ledger', () => {
  it('ignores a repeated idempotency key', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const event = {
      meter: 'render',
      provider: 'blender',
      quantity: 30,
      unit: 'gpu-seconds',
      costUsd: 0.05,
      idempotencyKey: 'run_1:3:render',
    } as const
    expect(await recordUsage(ctx, event)).toBe(true)
    expect(await recordUsage(ctx, event)).toBe(false)
    const summary = await api.call('usage.summary', { days: 1 })
    expect(summary.byMeter).toEqual([
      { meter: 'render', unit: 'gpu-seconds', quantity: 30, costUsd: 0.05 },
    ])
    expect(summary.recent[0]).toMatchObject({ userId: ctx.user.id, runId: null })
  })
})
