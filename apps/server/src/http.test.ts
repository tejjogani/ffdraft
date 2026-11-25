import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedIfEmpty } from './seed'
import { BOOT_TIMEOUT, client, type TestServer, testServer } from './test/harness'

describe('http surface', () => {
  let server: TestServer
  let dist: string

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'pave-dist-'))
    await mkdir(join(dist, 'assets'))
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Pavé</title>')
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)')
    server = await testServer({ config: { studioDist: dist } })
  }, BOOT_TIMEOUT)
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

  it('refuses a command body no valid input could need', async () => {
    const send = (body: string) =>
      server.app.request('/api/rpc/pieces.list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    const huge = await send(JSON.stringify({ q: 'ring', pad: 'x'.repeat(64 * 1024 * 1024) }))
    expect(huge.status).toBe(413)
    expect(await huge.json()).toMatchObject({ error: { code: 'payload_too_large' } })
    // A large but plausible body (a design with long paths) is still read.
    expect((await send(JSON.stringify({ q: 'ring', pad: 'x'.repeat(1024 * 1024) }))).status).toBe(
      200,
    )
  })

  // Local mode has no sign-in, so a browser on any website can reach it. A POST with no body, or
  // a multipart upload, needs no CORS preflight: only the Origin header tells them apart.
  it('refuses writes sent by a page of another website', async () => {
    const api = client(server)
    const upload = (headers: Record<string, string>, url = '/api/assets') => {
      const form = new FormData()
      form.set('file', new File([new TextEncoder().encode('hello')], 'note.txt'))
      return server.app.request(url, { method: 'POST', body: form, headers })
    }
    const pieces = async () => (await api.call('pieces.list', {})).length
    const before = await pieces()

    const command = await server.app.request('/api/rpc/pieces.create', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
    })
    expect(command.status).toBe(403)
    expect(await command.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect(await pieces()).toBe(before)
    expect((await upload({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await upload({ origin: 'null' })).status).toBe(403)

    // The studio served by this server, the configured dev origin, the public URL, and callers
    // that are not browsers (no Origin at all) are let through.
    expect((await upload({})).status).toBe(201)
    expect((await upload({ origin: 'http://localhost:5173' })).status).toBe(201)
    expect((await upload({ origin: 'http://localhost:8787' })).status).toBe(201)
    expect(
      (await upload({ origin: 'http://127.0.0.1:9999' }, 'http://127.0.0.1:9999/api/assets'))
        .status,
    ).toBe(201)
    // Reads are not writes: CORS already keeps their answers from other sites.
    const read = await server.app.request('/api/rpc/collections.list', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(read.status).toBeLessThan(400)
    expect(read.headers.get('access-control-allow-origin')).toBeNull()
  })

  // Needs a decision (which hosts a local install answers to), so it is recorded, not fixed.
  // A page whose domain is re-pointed at 127.0.0.1 (DNS rebinding) is same-origin with this
  // server: the Origin check above passes and, with no sign-in, it could read and change
  // everything. The Host it was sent to is what gives it away.
  it('refuses a request sent to a host name that is not this server (local mode)', async () => {
    const post = (url: string, headers: Record<string, string> = {}) =>
      server.app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{}',
      })
    const rebound = await post('http://attacker.example:8787/api/rpc/pieces.list', {
      origin: 'http://attacker.example:8787',
    })
    expect(rebound.status).toBe(403)
    expect(await rebound.json()).toMatchObject({ error: { code: 'forbidden' } })
    // Reads and the studio's own files are refused too, not only writes.
    expect((await server.app.request('http://attacker.example:8787/')).status).toBe(403)
    // A Host header that disagrees with the address is judged as well.
    expect(
      (await post('http://localhost:8787/api/rpc/pieces.list', { host: 'attacker.example:8787' }))
        .status,
    ).toBe(403)
    // A name that merely ends like loopback is not loopback.
    expect((await post('http://localhost.attacker.example/api/rpc/pieces.list')).status).toBe(403)
  })

  it('answers to loopback names, whatever the port (local mode)', async () => {
    for (const base of [
      'http://localhost:8787',
      'http://localhost:5173',
      'http://127.0.0.1:8787',
      'http://[::1]:8787',
      'http://pave.localhost:8787',
      'http://LOCALHOST:8787',
    ]) {
      const res = await server.app.request(`${base}/api/rpc/pieces.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status, base).toBe(200)
    }
  })

  it('answers to the names it was given: PAVE_ALLOWED_HOSTS, the public URL and HOST', async () => {
    const lan = await testServer({
      config: {
        host: '192.168.1.20',
        publicUrl: 'http://studio.example:8787',
        allowedHosts: ['bench-mac.local', '10.0.0.7'],
      },
    })
    try {
      const list = (base: string) =>
        lan.app.request(`${base}/api/rpc/pieces.list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      for (const base of [
        'http://bench-mac.local:8787',
        'http://10.0.0.7:8787',
        'http://studio.example:8787',
        'http://192.168.1.20:8787',
        'http://localhost:8787',
      ])
        expect((await list(base)).status, base).toBe(200)
      // Behind a TLS proxy the scheme differs while the host is the same: still this server.
      const form = new FormData()
      form.set('file', new File([new TextEncoder().encode('hello')], 'note.txt'))
      const viaProxy = await lan.app.request('http://bench-mac.local/api/assets', {
        method: 'POST',
        body: form,
        headers: { origin: 'https://bench-mac.local' },
      })
      expect(viaProxy.status).toBe(201)
      const refused = await list('http://192.168.1.99:8787')
      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
        'PAVE_ALLOWED_HOSTS',
      )
    } finally {
      await lan.dispose()
    }
  })

  it('listening on every address adds no name by itself (local mode)', async () => {
    const open = await testServer({ config: { host: '0.0.0.0' } })
    try {
      const res = await open.app.request('http://192.168.1.20:8787/api/rpc/pieces.list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(403)
    } finally {
      await open.dispose()
    }
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

describe('composition', () => {
  it('builds engines with the runtime, mounts extra routes before the catch-all, and listens across orgs', async () => {
    let built: unknown = null
    const server = await testServer({
      services: (runtime) => {
        built = runtime
        return { vision: { describe: async () => ({ tags: [], flags: [] }) } }
      },
      routes: (app, runtime, withCtx) => {
        app.use('/api/runs/*', withCtx)
        app.get('/api/runs/:id/events', (c) =>
          c.json({ run: c.req.param('id'), user: c.var.ctx.user.id, local: runtime.local?.userId }),
        )
      },
    })
    try {
      expect(built).toBe(server.runtime)
      const api = client(server)
      expect((await api.call('session.get', {})).capabilities.vision).toBe(true)
      const res = await api.request('/api/runs/run_1/events')
      expect(await res.json()).toEqual({
        run: 'run_1',
        user: server.runtime.local!.userId,
        local: server.runtime.local!.userId,
      })
      expect((await api.request('/api/runs')).status).toBe(404)

      const seen: [string, string][] = []
      const off = server.runtime.events.subscribeAll((orgId, e) => seen.push([orgId, e.type]))
      const { orgId, userId } = server.runtime.local!
      server.runtime.events.publish(orgId, { type: 'piece.updated', pieceId: 'p' })
      server.runtime.events.publish(
        orgId,
        { type: 'client.request', requestId: 'q', runId: null, tool: 'ui.context', input: {} },
        { userId },
      )
      off()
      server.runtime.events.publish(orgId, { type: 'piece.updated', pieceId: 'p' })
      expect(seen).toEqual([[orgId, 'piece.updated']])
    } finally {
      await server.dispose()
    }
  })
})
