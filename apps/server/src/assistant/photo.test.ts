/**
 * Photo to design end to end, on a real server with the kernel workers and a scripted model: a
 * synthetic product photo (a kernel render of a template whose numbers were changed, so the truth
 * is known) is read on the run's tier, built from the read's spec draft through the canon, fitted
 * to the photo's outline, and looked at from the photo's angle, with no studio window open (so
 * the server draws the capture). The model's turns stand in for Claude; everything else is real.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as t from '../db/schema'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import {
  encodeReference,
  referenceDesign,
  referencePixels,
  SCRIPTED_READ,
} from './reference-replication-fixture'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-KEYZ'

let s: AssistantServer
let api: Client
beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, engines: true })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

/** The tool result for `id` in a request, parsed from its first text block. */
function result<T>(params: BetaMessageStreamParams, id: string): { json: T; blocks: string[] } {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === id) {
          const content = b.content as { type: string; text?: string }[]
          return {
            json: JSON.parse(content[0]!.text!) as T,
            blocks: content.map((c) => c.text ?? `[${c.type}]`),
          }
        }
  throw new Error(`no result for ${id}`)
}

describe('a design from a photo', () => {
  it('reads, builds through the canon, fits to the outline and looks from the photo’s angle', async () => {
    const { truth, width, band } = referenceDesign()
    // Drawn by the server's own kernel worker, the way a capture with no window is.
    const jpeg = await encodeReference(await referencePixels(s.server, truth, false))
      .jpeg({ quality: 92 })
      .toBuffer()
    const form = new FormData()
    form.set('file', new File([jpeg], 'ring-photo.jpg', { type: 'image/jpeg' }))
    const photo = (await (
      await api.request('/api/assets', { method: 'POST', body: form })
    ).json()) as { id: string }

    let readRequest: BetaMessageStreamParams | null = null
    let fit: {
      quality: string
      ops: unknown[]
      params: { key: string; from: number; to: number }[]
    } | null = null
    s.model.push(
      { content: [tool('references_read', { assetIds: [photo.id] }, 'tr')] },
      // The read itself: a separate structured-output call on the run's own client.
      ({ params }) => {
        readRequest = params
        return { content: [text(JSON.stringify(SCRIPTED_READ))] }
      },
      ({ params }) => {
        const { json } = result<{ specDraft: unknown; cutout: { ok: boolean } }>(params, 'tr')
        expect(json.cutout.ok).toBe(true)
        return {
          content: [
            tool(
              'pieces_create',
              {
                title: 'From the photo',
                spec: json.specDraft,
                origin: { kind: 'image', sourceAssetIds: [photo.id] },
              },
              'tc',
            ),
          ],
        }
      },
      ({ pieceId }) => ({
        content: [
          tool(
            'match_fit',
            { pieceId, assetId: photo.id, view: 'threeQuarter', seconds: 40 },
            'tf',
          ),
        ],
      }),
      ({ params, pieceId }) => {
        fit = result<NonNullable<typeof fit>>(params, 'tf').json
        return {
          content: [
            tool('design_apply', { pieceId, ops: fit!.ops, label: 'Fit to the photo' }, 'ta'),
          ],
        }
      },
      ({ pieceId }) => ({
        content: [tool('viewport_capture', { pieceId, views: ['three-quarter'] }, 'tv')],
      }),
      { content: [text('It matches the photo; the band profile and the scale are assumed.')] },
    )
    const { run } = await api.call('threads.send', {
      text: 'Make this ring',
      attachments: [photo.id],
      clientId: 'w1',
      clientMessageId: 'photo-1',
    } as never)
    await settled(s.parts, run.id, 200_000)
    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status, JSON.stringify(detail.run)).toBe('done')
    const failed = detail.steps.filter((x) => x.isError).map((x) => [x.name, x.output])
    expect(failed, JSON.stringify(failed)).toEqual([])

    // The read ran on the run's tier with structured output, and was billed to the run.
    expect(readRequest!.model).toBe(detail.run.model)
    expect(readRequest!.output_config?.format?.type).toBe('json_schema')
    expect(readRequest!).not.toHaveProperty('tools')
    const c = await s.server.runtime.context(s.server.runtime.local!)
    const ledger = await c.repo.usage.many({
      where: and(eq(t.usageEvent.runId, run.id), like(t.usageEvent.idempotencyKey, '%:read')),
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.meter).toBe('llm')

    // Built through the canon from the read: six claws, white gold.
    const piece = await api.call('pieces.get', { id: detail.run.pieceId! })
    expect((piece.design.nodes.head as { prongCount: number }).prongCount).toBe(6)

    // The fit explained the photo and moved the stone and the band toward the truth.
    expect(fit!.quality).toBe('good')
    const moved = (key: string, truthValue: number) => {
      const p = fit!.params.find((x) => x.key === key)!
      return Math.abs(p.to - truthValue) < Math.abs(p.from - truthValue)
    }
    expect(moved('center.width', width)).toBe(true)
    expect(moved('band.widthTop', band)).toBe(true)
    expect((piece.design.nodes.center as { width: number }).width).toBeCloseTo(
      fit!.params.find((x) => x.key === 'center.width')!.to,
      2,
    )

    // No window was open: the server drew the capture, and the model was told so.
    const last = s.model.requests.at(-1)!
    const capture = result<{ source: string; images: { assetId: string }[] }>(last, 'tv')
    expect(capture.json.source).toBe('server')
    expect(capture.blocks).toContain('[image]')
    expect(capture.blocks.join('\n')).toMatch(/drawn on the server/)
    const png = await api.request(`/api/assets/${capture.json.images[0]!.assetId}`)
    expect(png.ok).toBe(true)
  }, 240_000)
})
