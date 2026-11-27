import { expect, it } from 'vitest'
import { client } from '../test/harness'
import { assistantServer, settled, text, tool } from './testing'

it('adds a measured custom band through the project assistant with a version guard', async () => {
  const s = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-ring-profile' },
    engines: true,
  })
  try {
    const api = client(s.server)
    const piece = await api.call('pieces.create', { title: 'Measured custom band', kind: 'ring' })
    const section = await api.call('design.apply', {
      pieceId: piece.id,
      baseVersion: piece.version,
      label: 'Draw a 4 by 2 mm band section',
      ops: [
        {
          t: 'add',
          node: {
            kind: 'curve',
            id: 'section',
            plane: 'top',
            closed: true,
            points: [
              { id: 'a', u: -1, v: -2 },
              { id: 'b', u: 1, v: -2 },
              { id: 'c', u: 1, v: 2 },
              { id: 'd', u: -1, v: 2 },
            ],
          },
        },
      ],
    })
    const apply = (baseVersion: number) =>
      tool('design_apply', {
        pieceId: piece.id,
        baseVersion,
        label: 'Make a US 7 ring band from the section',
        ops: [
          {
            t: 'add',
            node: {
              kind: 'revolve',
              id: 'band',
              curve: 'section',
              size: { system: 'us', value: 7 },
            },
          },
        ],
      })
    s.model.push(
      { content: [apply(piece.version)] },
      { content: [tool('pieces_get', { id: piece.id })] },
      { content: [apply(section.version)] },
      { content: [tool('design_evaluate', { pieceId: piece.id, detail: 'production' })] },
      { content: [text('The custom ring band is ready.')] },
    )
    const { run } = await api.call('threads.send', {
      text: 'Make a US 7 ring band from my section and verify the geometry.',
      clientId: 'custom-band-test',
      clientMessageId: 'custom-band-test-1',
      context: { pieceId: piece.id },
    })
    await settled(s.parts, run.id)
    const trace = await api.call('traces.run', { id: run.id })
    expect(trace.run.status).toBe('done')
    expect(
      trace.steps.filter((step) => step.name === 'design.apply').map((step) => step.isError),
    ).toEqual([true, false])
    const saved = await api.call('pieces.get', { id: piece.id })
    expect(saved.design.nodes.band).toMatchObject({
      kind: 'revolve',
      curve: 'section',
      size: { system: 'us', value: 7 },
    })
    const result = await api.call('design.evaluate', { pieceId: piece.id, detail: 'production' })
    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    expect(result.boundsMm.y).toBeCloseTo(4, 3)
    expect(result.metals[0]?.volumeMm3).toBeCloseTo(Math.PI * 8 * 19.3196, 3)
    expect((await api.call('design.history', { pieceId: piece.id }))[0]?.actor.type).toBe('agent')
  } finally {
    await s.server.dispose()
  }
}, 90_000)
