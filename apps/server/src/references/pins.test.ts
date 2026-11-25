/**
 * A piece's pinned references (the panel beside CAD) on a real server: pinning keeps provenance
 * and rights from the provider, pins can be reordered, captured and laid in a view, and — the
 * rule that matters most — a view-only reference's picture never reaches the model: not with the
 * message, not through a photo read, not through a fit, not as an attachment.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { modelImage } from '../assistant/images'
import { type AssistantServer, assistantServer, settled, text, tool } from '../assistant/testing'
import type { Services } from '../services'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type Recordings, recordedIO } from './io'
import { createSearchService } from './search'

const KEY = 'sk-ant-test-0000000000000000000000000000-PINS'
const recordings = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'museums.json'), 'utf8'),
) as Recordings

/** A distinct picture per address, so each one's pixels can be told apart in a request. */
const colourOf = (url: string) =>
  `#${([...url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) & 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
const pictureFor = (url: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: colourOf(url) } })
    .png()
    .toBuffer()
const captured: string[] = []
const capture: Services['capture'] = {
  async capture(url) {
    captured.push(url)
    return {
      file: { bytes: new Uint8Array(await pictureFor(url)), name: 'pic.png', mime: 'image/png' },
      sourceUrl: url,
    }
  },
}

let s: AssistantServer
let api: Client
beforeAll(async () => {
  s = await assistantServer({
    env: { ANTHROPIC_API_KEY: KEY },
    services: { search: createSearchService({ io: recordedIO(recordings) }), capture },
  })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

async function upload(name: string, colour: string): Promise<string> {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: colour } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([bytes], name, { type: 'image/png' }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  return ((await res.json()) as { id: string }).id
}

describe('pinning references to a piece', () => {
  it('keeps provenance and rights, dedupes, reorders, captures and places', async () => {
    const piece = await api.call('pieces.create', { title: 'Deco ring' })
    expect(await api.call('references.pins', { pieceId: piece.id })).toEqual({
      boardId: null,
      references: [],
    })
    const found = await api.call('references.search', { query: 'ring', providers: ['aic'] })
    const openResult = found.results.find((r) => r.key === 'aic:800001')!
    const inCopyright = found.results.find((r) => r.key === 'aic:800003')!
    const own = await upload('sketch.png', '#336699')

    const [open, viewOnly, link, mine] = await api.call('references.pin', {
      pieceId: piece.id,
      items: [
        // What a browser echoes is ignored: rights come from the provider.
        { result: { ...openResult, title: 'tampered' } },
        { result: { ...inCopyright, rights: 'open', mayStore: true } },
        { url: 'https://www.pinterest.com/pin/123/' },
        { assetId: own },
      ],
    })
    expect(open).toMatchObject({
      type: 'image',
      title: 'Ring with garnets',
      rights: 'open',
      source: {
        provider: 'aic',
        license: 'CC0 1.0 (public domain)',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
    })
    expect(open!.assetId).not.toBeNull()
    expect(captured).toContain(openResult.imageUrl)
    expect(viewOnly).toMatchObject({ rights: 'viewOnly', assetId: null })
    expect(viewOnly!.thumbUrl).toBe(inCopyright.thumbUrl)
    expect(captured).not.toContain(inCopyright.imageUrl)
    expect(link).toMatchObject({ type: 'link', rights: 'viewOnly', assetId: null })
    expect(mine).toMatchObject({ type: 'image', rights: 'own', assetId: own })

    // Pinning the same things again adds nothing.
    const again = await api.call('references.pin', {
      pieceId: piece.id,
      items: [{ result: openResult }, { assetId: own }],
    })
    expect(again.map((r) => r.id)).toEqual([open!.id, mine!.id])
    const pins = await api.call('references.pins', { pieceId: piece.id })
    expect(pins.references.map((r) => r.id)).toEqual([open!.id, viewOnly!.id, link!.id, mine!.id])
    // The pin board is the panel's, not a moodboard.
    expect((await api.call('boards.list', {})).map((b) => b.id)).not.toContain(pins.boardId)

    await api.call('references.arrange', {
      boardId: pins.boardId!,
      items: [{ id: mine!.id, position: 0 }],
    })
    expect(
      (await api.call('references.pins', { pieceId: piece.id })).references.map((r) => r.id)[0],
    ).toBe(mine!.id)

    // Capturing a link's picture stores pixels and keeps it view-only.
    const capturedLink = await api.call('references.capture', { id: link!.id })
    expect(capturedLink).toMatchObject({ rights: 'viewOnly' })
    expect(capturedLink.assetId).not.toBeNull()

    // A board reference can be pinned too, copied with its provenance.
    const board = await api.call('boards.create', { title: 'Deco' })
    const [onBoard] = await api.call('references.save', {
      boardId: board.id,
      items: [{ assetId: await upload('other.png', '#996633'), note: 'From the board' }],
    })
    const [copy] = await api.call('references.pin', {
      pieceId: piece.id,
      items: [{ referenceId: onBoard!.id }],
    })
    expect(copy).toMatchObject({ assetId: onBoard!.assetId, note: 'From the board', rights: 'own' })
    expect(copy!.boardId).toBe(pins.boardId)

    // Laying a pin in a view: a picture on the pin board only.
    const plane = {
      view: 'front' as const,
      center: [0, 2] as [number, number],
      width: 24,
      opacity: 0.5,
      locked: false,
    }
    expect((await api.call('references.place', { id: open!.id, plane })).plane).toEqual(plane)
    expect((await api.fail('references.place', { id: viewOnly!.id, plane })).status).toBe(409)
    expect((await api.fail('references.place', { id: onBoard!.id, plane })).status).toBe(409)
    // Undo of a placement is placing the earlier value back.
    expect((await api.call('references.place', { id: open!.id, plane: null })).plane).toBeNull()

    // The pins go with the piece.
    await api.call('pieces.delete', { id: piece.id })
    const c = await s.server.runtime.context(s.server.runtime.local!)
    expect(await c.repo.references.many({})).not.toContainEqual(
      expect.objectContaining({ id: open!.id }),
    )
  })
})

/** Every base64 picture in a request, in order. */
function pictures(params: BetaMessageStreamParams): string[] {
  const out: string[] = []
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[]) {
        if (b.type === 'image') out.push((b.source as { data: string }).data)
        if (b.type === 'tool_result' && Array.isArray(b.content))
          for (const c of b.content as Record<string, unknown>[])
            if (c.type === 'image') out.push((c.source as { data: string }).data)
      }
  return out
}

const systemText = (params: BetaMessageStreamParams) =>
  params.messages
    .filter((m) => (m.role as string) === 'system')
    .map((m) => JSON.stringify(m.content))
    .join('\n')

function toolResult(params: BetaMessageStreamParams, id: string) {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === id) return b
  throw new Error(`no result for ${id}`)
}

describe('what the model is shown of pinned references', () => {
  it('never sends a view-only picture: not with the message, a read, a fit or an attachment', async () => {
    const piece = await api.call('pieces.create', { title: 'Mourning ring' })
    const found = await api.call('references.search', { query: 'ring', providers: ['met'] })
    const metResult = found.results[0]!
    const [open, page] = await api.call('references.pin', {
      pieceId: piece.id,
      items: [{ result: metResult }, { url: 'https://shop.example/rings/1' }],
    })
    // The page's picture is captured for display; it stays view-only.
    const viewOnly = await api.call('references.capture', { id: page!.id })
    const blockedAsset = viewOnly.assetId!

    const encode = async (url: string) =>
      (await modelImage(new Uint8Array(await pictureFor(url)), 'image/png'))!.data
    const openData = await encode(metResult.imageUrl)
    const blockedData = await encode('https://shop.example/rings/1')
    expect(openData).not.toBe(blockedData)

    s.model.push(
      { content: [tool('references_read', { assetIds: [blockedAsset] }, 'r1')] },
      {
        content: [
          tool('match_fit', { pieceId: piece.id, assetId: blockedAsset, seconds: 10 }, 'f1'),
        ],
      },
      { content: [text('I can see the Met ring; the shop page is view only.')] },
      { content: [text('Noted.')] },
    )
    const { run } = await api.call('threads.send', {
      text: 'Use my pinned references',
      // The person attaches the view-only picture too: it is withheld.
      attachments: [blockedAsset],
      clientId: 'w1',
      clientMessageId: 'pins-1',
      context: { pieceId: piece.id },
    } as never)
    await settled(s.parts, run.id)
    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status).toBe('done')

    const requests = s.model.requests.slice(-3)
    const first = requests[0]!
    // Exactly one picture went with the message: the open pin, after its label.
    expect(pictures(first)).toEqual([openData])
    const user = first.messages.at(-2)!
    const blocks = user.content as unknown as { type: string; text?: string }[]
    expect(blocks[0]).toEqual({
      type: 'text',
      text: `[Pinned reference 1: “${metResult.title}” (${open!.id})]`,
    })
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text'])
    // The context names both pins; the view-only one by its details only.
    const context = systemText(first)
    expect(context).toContain(`“${metResult.title}” (id ${open!.id}; met;`)
    expect(context).toContain('its picture is in the message above, labelled')
    expect(context).toContain(`(id ${viewOnly.id}; web; view only:`)
    expect(context).toContain('Not shown to you (view-only references')

    // A photo read and a fit of the view-only picture were refused, before any model call.
    for (const [id, req] of [
      ['r1', requests[1]!],
      ['f1', requests[2]!],
    ] as const) {
      const r = toolResult(req, id)
      expect(r.is_error).toBe(true)
      expect(JSON.stringify(r.content)).toContain('is a view-only reference')
    }
    // And nowhere in any request did the view-only pixels appear.
    for (const req of s.model.requests) expect(JSON.stringify(req)).not.toContain(blockedData)

    // The next message does not send the open pin again: it was shown earlier.
    const before = s.model.requests.length
    const next = await api.call('threads.send', {
      threadId: detail.run.threadId,
      text: 'Thanks',
      attachments: [],
      clientId: 'w1',
      clientMessageId: 'pins-2',
      context: { pieceId: piece.id },
    } as never)
    await settled(s.parts, next.run.id)
    const second = s.model.requests[before]!
    const lastUser = second.messages.at(-2)!
    expect(
      (lastUser.content as unknown as { type: string }[]).filter((b) => b.type === 'image'),
    ).toEqual([])
    expect(systemText(second)).toContain(
      `its picture was shown earlier in this conversation (asset ${open!.assetId})`,
    )
  })
})
