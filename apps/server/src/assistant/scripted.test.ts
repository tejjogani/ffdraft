import { readdirSync } from 'node:fs'
import { RateLimitError } from '@anthropic-ai/sdk'
import { parseToolCall } from '@pave/agent'
import { mapError } from '@pave/agent/anthropic'
import { describe, expect, it } from 'vitest'
import { FIXTURES_DIR, scriptedFactory, scriptedFromEnv } from './scripted'

const params = { model: 'claude-opus-5-5', max_tokens: 10, messages: [] } as never
const run = (pieceId: string | null = 'p1') => ({
  runId: 'run_abcdefgh',
  model: 'claude-opus-5-5',
  apiKey: null,
  pieceId: () => pieceId,
})

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
            const input = JSON.parse(JSON.stringify(block.input).replaceAll('{{pieceId}}', 'p_1'))
            const parsed = parseToolCall(block.name, input)
            expect(parsed.ok, `${name}: ${block.name} ${parsed.ok ? '' : parsed.error}`).toBe(true)
          }
    }
  })
})
