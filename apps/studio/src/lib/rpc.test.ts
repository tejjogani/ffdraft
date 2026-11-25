import { COMMAND_NAMES, commands } from '@pave/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { postJson, QUERY_NAMES, RpcError } from './rpc'

describe('rpc client', () => {
  it('lists exactly the registry’s query commands', () => {
    const queries = COMMAND_NAMES.filter((n) => commands[n].kind === 'query')
    expect([...QUERY_NAMES].sort()).toEqual(queries.sort())
  })
})

describe('postJson', () => {
  afterEach(() => vi.unstubAllGlobals())

  const answer = (body: string | null, init: ResponseInit = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, init)),
    )
  const failure = (run: Promise<unknown>) =>
    run.then(
      () => {
        throw new Error('expected a failure')
      },
      (e: unknown) => e as RpcError,
    )

  it('posts the input as JSON with the session cookie and returns the parsed answer', async () => {
    answer(JSON.stringify({ ok: true }))
    await expect(postJson('/api/rpc/pieces.list', { stage: 'design' })).resolves.toEqual({
      ok: true,
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/rpc/pieces.list')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"stage":"design"}',
    })
  })

  it('sends an empty object when there is no input, and reads an empty answer as null', async () => {
    answer(null)
    await expect(postJson('/api/auth/sign-out', undefined)).resolves.toBeNull()
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ body: '{}' })
  })

  it('reports an unreachable server with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const e = await failure(postJson('/api/rpc/pieces.list', {}))
    expect(e).toBeInstanceOf(RpcError)
    expect(e).toMatchObject({ code: 'network', status: 0 })
  })

  it('carries the server’s error code, message and status', async () => {
    answer(JSON.stringify({ error: { code: 'not_found', message: 'Piece p9 was not found' } }), {
      status: 404,
    })
    const e = await failure(postJson('/api/rpc/pieces.get', { id: 'p9' }))
    expect(e).toMatchObject({ code: 'not_found', message: 'Piece p9 was not found', status: 404 })
  })

  it('names a failure whose body is not JSON, even when the status has no text (HTTP/2)', async () => {
    answer('<html>Bad gateway</html>', { status: 502, statusText: '' })
    const e = await failure(postJson('/api/rpc/pieces.list', {}))
    expect(e).toMatchObject({ code: 'http_error', status: 502 })
    expect(e.message).not.toBe('')
    answer('', { status: 401 })
    expect(await failure(postJson('/api/rpc/session.get', {}))).toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('treats a connection lost while the answer is read as an unreachable server', async () => {
    // The request may have been applied: status 0 makes callers retry (design changes are sent
    // under a stable id) rather than drop the edit as refused.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => {
          throw new TypeError('network error')
        },
      })),
    )
    const e = await failure(postJson('/api/rpc/design.apply', {}))
    expect(e).toBeInstanceOf(RpcError)
    expect(e).toMatchObject({ code: 'network', status: 0 })
  })

  it('refuses a successful answer that is not JSON (a proxy’s or dev server’s HTML page)', async () => {
    answer('<!doctype html><title>Pavé</title>', { status: 200 })
    const e = await failure(postJson('/api/rpc/design.apply', {}))
    expect(e).toBeInstanceOf(RpcError)
    expect(e).toMatchObject({ code: 'invalid_response', status: 0 })
  })
})
