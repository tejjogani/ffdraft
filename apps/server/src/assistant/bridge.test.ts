/**
 * The client-tool bridge with several windows: the first window that can answer wins, a window
 * that cannot (that piece is not open there) does not block the others, and when none can, the
 * caller gets a NoWindow error it can fall back from.
 */
import type { ServerEvent } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Ctx } from '../context'
import { BOOT_TIMEOUT } from '../test/harness'
import { ClientBridge, NoWindow } from './bridge'
import { type AssistantServer, assistantServer } from './testing'

let s: AssistantServer
let c: Ctx
beforeAll(async () => {
  s = await assistantServer()
  c = await s.server.runtime.context(s.server.runtime.local!)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

const output = {
  version: 3,
  source: 'studio',
  images: [{ view: 'front', assetId: 'as_1' }],
  summary: {
    metalMassG: 3,
    metals: [],
    stoneCount: 1,
    caratTotal: 1,
    lots: [],
    boundsMm: { x: 20, y: 20, z: 10 },
    diagnostics: [],
  },
}

/** A window that answers each client request after `ms`, with `answer`. */
function windowThat(
  bridge: ClientBridge,
  clientId: string,
  answer: { output?: unknown; error?: string } | null,
  seen: ServerEvent[] = [],
  ms = 5,
) {
  return c.events.subscribe(
    c.orgId,
    (e) => {
      if (e.type !== 'client.request') return
      seen.push(e)
      if (!answer) return
      setTimeout(() => {
        try {
          bridge.respond(
            { orgId: c.orgId, userId: c.user.id },
            { requestId: e.requestId, ...answer },
          )
        } catch {
          // Settled already: a later answer is not found, as a late window's would be.
        }
      }, ms)
    },
    { userId: c.user.id, clientId },
  )
}

const ask = (bridge: ClientBridge, o: { clientId?: string | null; timeoutMs?: number } = {}) =>
  bridge.request(c, {
    runId: 'run_1',
    clientId: o.clientId ?? null,
    tool: 'viewport.capture',
    input: { pieceId: 'pc_1', views: ['front'] },
    signal: new AbortController().signal,
    atVersion: 3,
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
  })

describe('ClientBridge', () => {
  it('takes the window that can answer when another says it cannot', async () => {
    const bridge = new ClientBridge()
    const seen: ServerEvent[] = []
    const offA = windowThat(
      bridge,
      'wa',
      { error: 'That piece is not open in this window' },
      seen,
      1,
    )
    const offB = windowThat(bridge, 'wb', { output }, seen, 20)
    try {
      await expect(ask(bridge)).resolves.toMatchObject({ version: 3, source: 'studio' })
      // Both windows were asked, with the version to wait for.
      expect(seen).toHaveLength(2)
      expect(seen[0]).toMatchObject({ atVersion: 3, tool: 'viewport.capture' })
    } finally {
      offA()
      offB()
    }
  })

  it('fails with NoWindow, carrying their reasons, when every window says it cannot', async () => {
    const bridge = new ClientBridge()
    const offA = windowThat(bridge, 'wa', { error: 'That piece is not open in this window' })
    const offB = windowThat(bridge, 'wb', { error: 'No viewport is open' })
    try {
      const err = await ask(bridge).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NoWindow)
      expect(String((err as Error).message)).toMatch(/not open in this window.*No viewport/)
    } finally {
      offA()
      offB()
    }
  })

  it('asks only the window the message came from while it is connected', async () => {
    const bridge = new ClientBridge()
    const seenA: ServerEvent[] = []
    const seenB: ServerEvent[] = []
    const offA = windowThat(bridge, 'wa', { output }, seenA)
    const offB = windowThat(bridge, 'wb', { output }, seenB)
    try {
      await ask(bridge, { clientId: 'wb' })
      expect(seenA).toHaveLength(0)
      expect(seenB).toHaveLength(1)
    } finally {
      offA()
      offB()
    }
  })

  it('fails with NoWindow when no window is open, or none answers in time', async () => {
    const bridge = new ClientBridge()
    await expect(ask(bridge)).rejects.toBeInstanceOf(NoWindow)
    const off = windowThat(bridge, 'wa', null)
    try {
      await expect(ask(bridge, { timeoutMs: 50 })).rejects.toBeInstanceOf(NoWindow)
    } finally {
      off()
    }
  })
})
