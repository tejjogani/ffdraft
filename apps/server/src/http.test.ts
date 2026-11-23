import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedIfEmpty } from './seed'
import { client, type TestServer, testServer } from './test/harness'

describe('http surface', () => {
  let server: TestServer
  let dist: string

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'pave-dist-'))
    await mkdir(join(dist, 'assets'))
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Pavé</title>')
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)')
    server = await testServer({ config: { studioDist: dist } })
  })
  afterAll(async () => {
    await server.dispose()
    await rm(dist, { recursive: true, force: true })
  })

  it('serves the studio with an SPA fallback, but never for /api', async () => {
    const api = client(server)
    expect(await (await api.request('/')).text()).toContain('<title>Pavé</title>')
    expect(await (await api.request('/pieces/pc_1')).text()).toContain('<title>Pavé</title>')
    expect(await (await api.request('/assets/app.js')).text()).toBe('console.log(1)')
    const missing = await api.request('/api/nothing')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } })
    expect((await api.fail('no.such.command' as never, {})).status).toBe(404)
  })

  it('allows the Vite dev origin with credentials', async () => {
    const res = await server.app.request('/api/rpc/session.get', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('requires JSON for command input', async () => {
    const res = await server.app.request('/api/rpc/collections.create', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"name":"x"}',
    })
    expect(res.status).toBe(400)
    const empty = await server.app.request('/api/rpc/collections.list', { method: 'POST' })
    expect(empty.status).toBe(200)
  })

  it('streams org events over SSE', async () => {
    const api = client(server)
    const abort = new AbortController()
    const res = await api.request('/api/events', { signal: abort.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let text = ''
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read()
        if (done) throw new Error(`stream ended before ${needle}`)
        text += value
      }
    }
    await readUntil('event: ready')
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Kind',
      ops: [{ t: 'setKind', kind: 'ring' }],
    })
    await readUntil('event: design.changed')
    expect(text).toContain('event: piece.updated')
    expect(text).toContain(`"pieceId":"${piece.id}","version":1`)
    abort.abort()
    await reader.cancel().catch(() => {})
  })
})

describe('welcome workspace', () => {
  it('seeds a first-run org once, through the command pipeline', async () => {
    const server = await testServer({ config: { seed: true } })
    try {
      const api = client(server)
      const collections = await api.call('collections.list', {})
      expect(collections.map((c) => c.name)).toEqual(['Bridal', 'Iced', 'Bands'])
      expect(collections.every((c) => c.pieceCount >= 3)).toBe(true)
      const [board] = await api.call('boards.list', {})
      const { references } = await api.call('boards.get', { id: board!.id })
      expect(references.filter((r) => r.type === 'note').length).toBeGreaterThan(0)
      expect(references.filter((r) => r.type === 'swatch').every((r) => r.palette.length > 0)).toBe(
        true,
      )

      for (const p of await api.call('pieces.list', {}))
        await api.call('pieces.delete', { id: p.id })
      const ctx = await server.runtime.context(server.runtime.local!)
      expect(await seedIfEmpty(server.runtime, ctx)).toBe(false)
      const audit = await ctx.repo.audit.many()
      expect(audit.some((a) => a.action === 'pieces.create' && a.actor.type === 'system')).toBe(
        true,
      )
    } finally {
      await server.dispose()
    }
  })
})
