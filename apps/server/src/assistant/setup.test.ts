/**
 * The key and the tiers: entering a key in the app turns the assistant on at once and removing
 * it turns it off; the key never comes back out of the server; only owners and admins handle it;
 * .env wins; each tier runs on its model with that model's request shape; test mode.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BOOT_TIMEOUT, type Client, client, joinOrg, signUp } from '../test/harness'
import { scriptedFromEnv } from './scripted'
import { KEY_NOTE_FILE } from './setup'
import { type AssistantServer, assistantServer, settled, text } from './testing'

const KEY = 'sk-ant-api03-SECRETSECRETSECRETSECRET-abcdefghijklmnop-WXYZ'

const sendInput = (n: string, extra: Record<string, unknown> = {}) =>
  ({ text: 'Hello', clientId: 'w1', clientMessageId: n, ...extra }) as never

describe('the API key, entered in the app', () => {
  let s: AssistantServer
  let api: Client
  const seen: string[] = []
  const spies: ReturnType<typeof vi.spyOn>[] = []

  beforeAll(async () => {
    // Everything the server prints, to search it for the key afterwards.
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      spies.push(
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          seen.push(
            args
              .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)))
              .join(' '),
          )
        }),
      )
    s = await assistantServer({ env: {} })
    api = client(s.server)
  }, BOOT_TIMEOUT)
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore()
    await s.server.dispose()
  })

  /** Every response body, to search for the key. */
  const bodies: string[] = []
  const call = async <T>(name: string, input: unknown): Promise<T> => {
    const res = await api.request(`/api/rpc/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await res.text()
    bodies.push(body)
    if (!res.ok)
      throw Object.assign(new Error(body), { status: res.status, body: JSON.parse(body) })
    return JSON.parse(body) as T
  }

  it('without a key: the assistant is off, says how to add one, and setup works', async () => {
    const session = await call<{ capabilities: { assistant: boolean } }>('session.get', {})
    expect(session.capabilities.assistant).toBe(false)
    const setup = await call<{ configured: boolean; key: unknown }>('assistant.setup.get', {})
    expect(setup).toMatchObject({
      configured: false,
      key: { source: 'none', last4: null, editable: true },
    })
    const refused = await api.fail('threads.send', sendInput('k1'))
    expect(refused.status).toBe(501)
    expect(refused.error.message).toMatch(/Claude API key.*Settings, AI/)
  })

  it('saving a key turns the assistant on at once; testing checks it; removing turns it off', async () => {
    const saved = await call<{ configured: boolean; key: { source: string; last4: string } }>(
      'assistant.key.set',
      { apiKey: KEY },
    )
    expect(saved).toMatchObject({ configured: true, key: { source: 'settings', last4: 'WXYZ' } })
    expect(
      (await call<{ capabilities: { assistant: boolean } }>('session.get', {})).capabilities
        .assistant,
    ).toBe(true)

    s.model.push({ content: [text('Hello! What shall we make?')] })
    const { run } = await call<{ run: { id: string } }>('threads.send', sendInput('k2'))
    await settled(s.parts, run.id)
    expect(s.model.keys.at(-1)).toBe(KEY)
    const detail = await call<{ run: { status: string } }>('traces.run', { id: run.id })
    expect(detail.run.status).toBe('done')
    await call('usage.summary', {})
    await call('threads.list', {})
    await call('traces.runs', {})

    // Test: the saved key, or one pasted.
    const tested = await call<{ ok: boolean; models: string[] }>('assistant.key.test', {})
    expect(tested).toMatchObject({ ok: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] })
    expect(s.checks.at(-1)).toBe(KEY)
    expect((tested as unknown as { message: string }).message).toMatch(
      /cannot use Claude Fable 5.2/,
    )

    const removed = await call<{ configured: boolean }>('assistant.key.remove', {})
    expect(removed.configured).toBe(false)
    expect(
      (await call<{ capabilities: { assistant: boolean } }>('session.get', {})).capabilities
        .assistant,
    ).toBe(false)
    expect((await api.fail('threads.send', sendInput('k3'))).status).toBe(501)
    await call('assistant.key.set', { apiKey: KEY })
  })

  it('maps a failed key check to a plain message', async () => {
    const bad = await assistantServer({
      env: {},
      check: () => ({ ok: false, code: 'unreachable', message: 'Could not reach Claude’s API.' }),
    })
    try {
      const r = await client(bad.server).call('assistant.key.test', { apiKey: KEY })
      expect(r).toEqual({
        ok: false,
        code: 'unreachable',
        message: 'Could not reach Claude’s API.',
        models: [],
      })
      const none = await client(bad.server).call('assistant.key.test', {})
      expect(none).toMatchObject({
        ok: false,
        code: 'invalid',
        message: expect.stringMatching(/no key/),
      })
    } finally {
      await bad.server.dispose()
    }
  })

  it('the key appears in no output, log line, trace, usage row or audit entry', async () => {
    const ctx = await s.server.runtime.context(s.server.runtime.local!)
    const tables = await Promise.all([
      ctx.repo.audit.many(),
      ctx.repo.runs.many(),
      ctx.repo.steps.many(),
      ctx.repo.messages.many(),
      ctx.repo.usage.many(),
      ctx.repo.settings.many(),
      ctx.repo.assistantKeys.many(),
    ])
    const haystacks = [...bodies, ...seen, JSON.stringify(tables)]
    // The whole key, and any long piece of it.
    for (const needle of [KEY, KEY.slice(8, 30), KEY.slice(-20)])
      for (const h of haystacks) expect(h.includes(needle)).toBe(false)
    // The audit log kept that the key was set, not what it was.
    const audit = tables[0].filter((a) => a.action === 'assistant.key.set')
    expect(audit.length).toBeGreaterThan(0)
    expect(audit[0]!.input).toEqual({ apiKey: '[secret]' })
    expect(bodies.some((b) => b.includes('WXYZ'))).toBe(true)
  })
})

describe('in accounts mode the key is the organisation’s', () => {
  let s: AssistantServer
  let owner: Client
  let designer: Client
  let stranger: Client
  beforeAll(async () => {
    s = await assistantServer({ env: {}, auth: 'accounts' })
    owner = await signUp(s.server, 'Olu', 'olu@example.com')
    designer = await signUp(s.server, 'Dee', 'dee@example.com')
    stranger = await signUp(s.server, 'Sam', 'sam@example.com')
    await joinOrg(s.server, owner, designer, 'dee@example.com', 'designer')
  }, BOOT_TIMEOUT)
  afterAll(() => s.server.dispose())

  it('only owners and admins set, test or remove it; members see that one is set', async () => {
    for (const [name, input] of [
      ['assistant.key.set', { apiKey: KEY }],
      ['assistant.key.test', {}],
      ['assistant.key.remove', {}],
    ] as const)
      expect((await designer.fail(name, input)).status).toBe(403)
    await owner.call('assistant.key.set', { apiKey: KEY })
    expect((await owner.call('assistant.setup.get', {})).key.last4).toBe('WXYZ')
    expect((await designer.call('assistant.setup.get', {})).key).toMatchObject({
      source: 'settings',
      last4: null,
    })
    expect((await designer.call('session.get', {})).capabilities.assistant).toBe(true)
  })

  it('another organisation has no key, and cannot see this one’s run events', async () => {
    expect((await stranger.call('session.get', {})).capabilities.assistant).toBe(false)
    expect((await stranger.fail('threads.send', sendInput('x1'))).status).toBe(501)

    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    s.model.push(async () => {
      await gate
      return { content: [text('Hi')] }
    })
    const { run } = await designer.call('threads.send', sendInput('a1'))
    expect((await stranger.request(`/api/runs/${run.id}/events`)).status).toBe(404)
    // In the same org: the owner (an admin) may watch; the run is the designer's.
    const watched = await owner.request(`/api/runs/${run.id}/events`)
    expect(watched.status).toBe(200)
    release()
    expect(await watched.text()).toMatch(/event: run.finished/)
    await settled(s.parts, run.id)
  })
})

describe('.env and the tiers', () => {
  let s: AssistantServer
  let api: Client
  beforeAll(async () => {
    s = await assistantServer({
      env: {
        ANTHROPIC_API_KEY: KEY,
        PAVE_ASSISTANT_MODEL_STANDARD: 'claude-sonnet-5-5',
        PAVE_ASSISTANT_MODEL_POWER: 'gpt-9',
      },
    })
    api = client(s.server)
  }, BOOT_TIMEOUT)
  afterAll(() => s.server.dispose())
  afterEach(() => {
    s.model.queue.length = 0
  })

  async function runOn(tier?: 'power' | 'standard' | 'light') {
    s.model.push({ content: [text('ok')] })
    const { run } = await api.call(
      'threads.send',
      sendInput(`t${Math.random()}`, tier ? { tier } : {}),
    )
    await settled(s.parts, run.id)
    return {
      run,
      request: s.model.requests.at(-1)! as BetaMessageStreamParams & Record<string, unknown>,
    }
  }

  it('the .env key wins and cannot be edited in the app; overrides are listed and bad ones warned about', async () => {
    const setup = await api.call('assistant.setup.get', {})
    expect(setup.key).toMatchObject({ source: 'env', last4: 'WXYZ', editable: false })
    expect(setup.envOverrides).toEqual([
      'ANTHROPIC_API_KEY',
      'PAVE_ASSISTANT_MODEL_POWER',
      'PAVE_ASSISTANT_MODEL_STANDARD',
    ])
    expect(setup.warnings).toEqual([
      expect.stringMatching(/PAVE_ASSISTANT_MODEL_POWER=gpt-9 .*ignored/),
    ])
    expect(setup.tiers.map((x) => [x.tier, x.model, x.source])).toEqual([
      ['power', 'claude-fable-5-2', 'default'],
      ['standard', 'claude-sonnet-5-5', 'env'],
      ['light', 'claude-sonnet-5-5', 'default'],
    ])
    expect(setup.tiers[0]!.price).toEqual({ input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 })
    expect(setup.tiers.every((x) => x.typicalRunUsd > 0)).toBe(true)
    expect((await api.fail('assistant.key.set', { apiKey: KEY })).status).toBe(409)
    expect((await api.fail('assistant.key.remove', {})).status).toBe(409)
  })

  it('each tier runs on its model with that model’s request shape', async () => {
    await api.call('org.settings.update', { assistantModels: { light: 'claude-haiku-5-5' } })

    const power = await runOn('power')
    expect(power.run).toMatchObject({ tier: 'power', model: 'claude-fable-5-2' })
    expect(power.request).toMatchObject({
      model: 'claude-fable-5-2',
      fallbacks: 'default',
      output_config: { effort: 'high' },
      thinking: { type: 'adaptive', display: 'summarized' },
      tool_choice: { type: 'auto' },
      max_tokens: 64_000,
    })
    expect(power.request.betas).toContain('server-side-fallback-2026-07-01')

    // .env wins over settings for Standard.
    const standard = await runOn()
    expect(standard.run).toMatchObject({ tier: 'standard', model: 'claude-sonnet-5-5' })
    expect(standard.request.fallbacks).toBe('default')

    // Haiku has no server-side fallback: neither the parameter nor its beta is sent.
    const light = await runOn('light')
    expect(light.run).toMatchObject({ tier: 'light', model: 'claude-haiku-5-5' })
    expect(light.request.fallbacks).toBeUndefined()
    expect(light.request.betas).not.toContain('server-side-fallback-2026-07-01')
    for (const r of [power, standard, light]) {
      expect(r.request).not.toHaveProperty('temperature')
      expect(r.request).not.toHaveProperty('top_p')
      expect(r.request.output_config).toEqual({ effort: 'high' })
    }

    // The organisation's default tier applies when the composer names none.
    await api.call('org.settings.update', { assistantTier: 'light' })
    expect((await runOn()).run).toMatchObject({ tier: 'light', model: 'claude-haiku-5-5' })
    await api.call('org.settings.update', { assistantTier: null, assistantModels: { light: null } })
  })
})

describe('test mode (PAVE_ASSISTANT=scripted:…)', () => {
  it('is refused in production, for unknown fixtures and for anything but scripted:<name>', () => {
    expect(scriptedFromEnv({})).toBeNull()
    expect(() => scriptedFromEnv({ PAVE_ASSISTANT: 'on' })).toThrow(/not understood/)
    expect(() => scriptedFromEnv({ PAVE_ASSISTANT: 'scripted:../etc' })).toThrow(/not understood/)
    expect(() => scriptedFromEnv({ PAVE_ASSISTANT: 'scripted:nope' })).toThrow(/no fixture/)
    expect(() =>
      scriptedFromEnv({ PAVE_ASSISTANT: 'scripted:brief-to-ring', NODE_ENV: 'production' }),
    ).toThrow(/production/)
    expect(
      scriptedFromEnv({ PAVE_ASSISTANT: 'scripted:brief-to-ring' })?.fixture.runs,
    ).toHaveLength(2)
  })

  it('plays a fixture through the real loop with no key, and says so loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { testServer } = await import('../test/harness')
    const { createAssistant } = await import('./index')
    let parts: ReturnType<typeof createAssistant> | null = null
    const server = await testServer({
      services: (runtime) => {
        parts = createAssistant(runtime, { env: { PAVE_ASSISTANT: 'scripted:brief-to-ring' } })
        return parts.services
      },
      routes: (app, _rt, withCtx) => parts?.routes(app, withCtx),
    })
    try {
      expect(warn.mock.calls.flat().join(' ')).toMatch(/TEST SCRIPT, not Claude/)
      const api = client(server)
      const setup = await api.call('assistant.setup.get', {})
      expect(setup).toMatchObject({ configured: true, scripted: true, key: { editable: false } })
      const { run } = await api.call(
        'threads.send',
        sendInput('s1', { text: 'A halo engagement ring' }),
      )
      await settled(parts!, run.id)
      const waiting = (await api.call('traces.run', { id: run.id })).steps.find(
        (x) => x.status === 'awaiting-approval',
      )!
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: waiting.toolCallId!,
        decision: 'approve',
      })
      await settled(parts!, run.id)
      const detail = await api.call('traces.run', { id: run.id })
      expect(detail.run.status).toBe('done')
      const piece = await api.call('pieces.get', { id: detail.run.pieceId! })
      expect(piece.version).toBe(1)
    } finally {
      warn.mockRestore()
      await server.dispose()
    }
  })
})

describe('the note the installer reads', () => {
  it('says whether a key is saved in the app, and never says the key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pave-note-'))
    const s = await assistantServer({ env: {}, config: { dataDir: dir } })
    try {
      const api = client(s.server)
      const note = () => readFile(join(dir, KEY_NOTE_FILE), 'utf8')
      expect(JSON.parse(await note())).toEqual({ keySavedInApp: false })
      await api.call('assistant.key.set', { apiKey: KEY })
      const saved = await note()
      expect(JSON.parse(saved)).toEqual({ keySavedInApp: true })
      expect(saved).not.toContain('WXYZ')
      await api.call('assistant.key.remove', {})
      expect(JSON.parse(await note())).toEqual({ keySavedInApp: false })
    } finally {
      await s.server.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
