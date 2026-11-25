/**
 * Journey f, replayed: the API key in Settings › AI, tested and saved against the fake Claude
 * API's Models endpoint through the real SDK (`checkKey`), as the founder will do with his own key.
 * A wrong key is refused with the API's 401 and a plain sentence; the right key lists the four
 * tier models; Save stores it (last four characters only, never the key) and turns the assistant
 * on. The recorded outcome is fixtures/recordings/f-key.outcome.json.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkKey } from '@pave/agent/anthropic'
import { type FakeApi, scriptedSource, startFakeApi } from '@pave/agent/testing/fake-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer } from './testing'

const KEY = 'sk-ant-api03-fake-harness-key-0000'
let fake: FakeApi
let s: AssistantServer
let api: Client

beforeAll(async () => {
  fake = await startFakeApi({ source: scriptedSource(), apiKey: KEY })
  s = await assistantServer({
    // No ANTHROPIC_API_KEY: the key is entered in the app.
    env: {},
    check: (key) => checkKey({ apiKey: key, baseURL: fake.url, maxRetries: 0 }),
  })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(async () => {
  await s.server.dispose()
  await fake.close()
})

describe('the key in Settings › AI, against the fake Models API', () => {
  it('refuses a wrong key, accepts the right one, saves it and turns the assistant on', async () => {
    const before = await api.call('assistant.setup.get', {} as never)
    expect(before.configured).toBe(false)

    const wrong = await api.call('assistant.key.test', {
      apiKey: 'sk-ant-wrong-key-0000000000',
    } as never)
    expect(wrong).toMatchObject({ ok: false, code: 'invalid' })
    expect(wrong.message).toMatch(/did not accept this key/)

    const right = await api.call('assistant.key.test', { apiKey: KEY } as never)
    expect(right).toMatchObject({ ok: true, message: 'The key works with every tier model.' })
    expect(right.models).toEqual([
      'claude-fable-5-2',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ])

    await api.call('assistant.key.set', { apiKey: KEY } as never)
    const after = await api.call('assistant.setup.get', {} as never)
    const recorded = JSON.parse(
      readFileSync(
        join(import.meta.dirname, 'fixtures', 'recordings', 'f-key.outcome.json'),
        'utf8',
      ),
    ) as {
      setup: { configured: boolean; key: { source: string; last4: string; editable: boolean } }
    }
    expect(after.configured).toBe(recorded.setup.configured)
    expect(after.key).toMatchObject({
      source: recorded.setup.key.source,
      last4: recorded.setup.key.last4,
      editable: recorded.setup.key.editable,
    })
    // The key itself never comes back.
    expect(JSON.stringify(after)).not.toContain(KEY)

    // The fake saw the SDK's real requests: the wrong key refused by its auth rule, the right one served.
    const models = fake.exchanges.filter((e) => e.path === '/v1/models')
    expect(models.map((e) => e.violation?.rule ?? 'served')).toEqual(['auth.key', 'served'])
  })
})
