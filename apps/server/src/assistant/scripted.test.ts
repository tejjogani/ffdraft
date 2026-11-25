import { readdirSync } from 'node:fs'
import { RateLimitError } from '@anthropic-ai/sdk'
import { parseToolCall } from '@pave/agent'
import { mapError } from '@pave/agent/anthropic'
import { cinemaQuestions } from '@pave/render'
import { PhotoReadSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { FIXTURES_DIR, scriptedFactory, scriptedFromEnv } from './scripted'

const params = { model: 'claude-opus-5-5', max_tokens: 10, messages: [] } as never
const run = (pieceId: string | null = 'p1') => ({
  runId: 'run_abcdefgh',
  model: 'claude-opus-5-5',
  apiKey: null,
  pieceId: () => pieceId,
})

// What `scenes.suggest` gives a fixture's placeholders: a placed camera and the default questions.
const PLACED = { preset: 'custom', position: [50, -80, 40], target: [0, 0, 4], focalLength: 100 }
const QUESTIONS = cinemaQuestions({ halo: false, pave: false, stones: 1 })

describe('scripted fixtures', () => {
  it('fail with the SDK’s own typed error, so the studio shows the real error state', async () => {
    const factory = scriptedFactory({
      runs: [[{ content: [], error: { status: 429, type: 'rate_limit_error', message: 'slow' } }]],
    })
    const stream = factory(run()).stream(params, {})
    const err = await stream.finalMessage().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect(mapError(err, { model: 'claude-opus-5-5' }).code).toBe('rate_limited')
  })

  it('pace text a couple of words per event, ending with the same message', async () => {
    const factory = scriptedFactory({
      runs: [
        [{ paceMs: 1, content: [{ type: 'text', text: 'one two three four five {{pieceId}}' }] }],
      ],
    })
    const stream = factory(run('p9')).stream(params, {})
    const deltas: string[] = []
    for await (const e of stream)
      if (e.type === 'content_block_delta' && e.delta.type === 'text_delta')
        deltas.push(e.delta.text)
    expect(deltas.length).toBeGreaterThan(2)
    expect(deltas.join('')).toBe('one two three four five p9')
    const message = await stream.finalMessage()
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'one two three four five p9' })
  })

  it('ship fixtures whose every tool call is valid input for its tool', () => {
    for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))) {
      const name = file.replace(/\.json$/, '')
      const { fixture } = scriptedFromEnv({ PAVE_ASSISTANT: `scripted:${name}` })!
      for (const turn of fixture.runs.flat())
        for (const block of turn.content ?? [])
          if (block.type === 'tool_use') {
            const input = JSON.parse(
              JSON.stringify(block.input)
                .replaceAll('{{pieceId}}', 'p_1')
                .replaceAll('{{attachment}}', 'as_1')
                .replace(/"\{\{suggest:[a-z-]+\}\}"/g, JSON.stringify(PLACED))
                .replaceAll('"{{questions}}"', JSON.stringify(QUESTIONS)),
            )
            const parsed = parseToolCall(block.name, input)
            expect(parsed.ok, `${name}: ${block.name} ${parsed.ok ? '' : parsed.error}`).toBe(true)
          }
    }
  })

  it('fill {{attachment}} with the photo named in the latest context message', async () => {
    const factory = scriptedFactory({
      runs: [[{ content: [{ type: 'text', text: 'reading {{attachment}}' }] }]],
    })
    const withPhoto = {
      model: 'claude-opus-5-5',
      max_tokens: 10,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Make this' }] },
        {
          role: 'system',
          content: [{ type: 'text', text: 'Attachments: ring.jpg (asset as_photo1, image/jpeg)' }],
        },
      ],
    } as never
    const message = await factory(run()).stream(withPhoto, {}).finalMessage()
    expect(message.content[0]).toMatchObject({ text: 'reading as_photo1' })
  })

  it('answer the photo read in photo-to-ring with a read in its own format', () => {
    const { fixture } = scriptedFromEnv({ PAVE_ASSISTANT: 'scripted:photo-to-ring' })!
    const turns = fixture.runs[0]!
    const at = turns.findIndex((t) =>
      t.content.some((b) => b.type === 'tool_use' && b.name === 'references_read'),
    )
    const answer = turns[at + 1]!.content[0] as { type: 'text'; text: string }
    expect(PhotoReadSchema.safeParse(JSON.parse(answer.text)).success).toBe(true)
  })
})
