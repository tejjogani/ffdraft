import { expect, it } from 'vitest'
import { client } from '../test/harness'
import { assistantServer, settled, text, tool } from './testing'

it('builds an editable loft and a sheet through the project assistant and measures both', async () => {
  const s = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-section-modeling' },
    engines: true,
  })
  try {
    const api = client(s.server)
    const piece = await api.call('pieces.create', { title: 'Section modeling study' })
    const other = await api.call('pieces.create', { title: 'Separate project' })
    const rails = [0, 3].map((planeOffset, i) => ({
      kind: 'curve',
      id: 'profile' + i,
      plane: 'top',
      closed: true,
      planeOffset,
      points: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ].map(([u, v], n) => ({ id: String(n), u, v })),
    }))
    const ops = [
      ...rails,
      { kind: 'loft', id: 'shoulder', sections: ['profile0', 'profile1'], ruled: true },
      { kind: 'loft', id: 'skin', sections: ['profile0', 'profile1'], capped: false },
    ].map((node) => ({ t: 'add', node }))
    s.model.push(
      {
        content: [
          tool('design_apply', {
            pieceId: piece.id,
            label: 'Build shoulder and surface',
            baseVersion: piece.version,
            ops,
          }),
        ],
      },
      { content: [tool('design_evaluate', { pieceId: piece.id, detail: 'production' })] },
      { content: [text('The shoulder is ready.')] },
    )
    const { run } = await api.call('threads.send', {
      text: 'Loft a four millimetre square shoulder between two sections three millimetres apart and keep its surface.',
      clientId: 'section-test',
      clientMessageId: 'section-test-1',
      context: { pieceId: piece.id },
    })
    await settled(s.parts, run.id)
    const trace = await api.call('traces.run', { id: run.id })
    expect(trace.run.status).toBe('done')
    expect(
      trace.steps
        .filter((step) => step.name === 'design.apply' || step.name === 'design.evaluate')
        .map((step) => step.isError),
    ).toEqual([false, false])
    const summary = await api.call('design.evaluate', { pieceId: piece.id, detail: 'production' })
    expect(summary.metals[0]?.volumeMm3).toBeCloseTo(48, 3)
    expect(summary.modelingSurfaces?.[0]).toMatchObject({ nodeId: 'skin', areaMm2: 48 })
    expect((await api.call('design.history', { pieceId: piece.id }))[0]?.actor.type).toBe('agent')
    expect((await api.call('pieces.get', { id: other.id })).version).toBe(other.version)
  } finally {
    await s.server.dispose()
  }
}, 90_000)

it('thickens a linked project sheet through the assistant', async () => {
  const s = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-section-modeling' },
    engines: true,
  })
  try {
    const api = client(s.server)
    const piece = await api.call('pieces.create', { title: 'Thickened surface study' })
    const result = await api.call('design.apply', {
      pieceId: piece.id,
      baseVersion: piece.version,
      label: 'Build a sheet',
      ops: [
        ...[0, 10].map((z) => ({
          t: 'add' as const,
          node: {
            kind: 'nurbsCurve' as const,
            id: `profile-${z}`,
            degree: 1,
            knots: [0, 1],
            controlPoints: [
              [0, 0, z, 1],
              [5, 0, z, 1],
            ] as [number, number, number, number][],
          },
        })),
        {
          t: 'add',
          node: { id: 'sheet', kind: 'loft', sections: ['profile-0', 'profile-10'], capped: false },
        },
      ],
    })
    s.model.push(
      {
        content: [
          tool('design_apply', {
            pieceId: piece.id,
            label: 'Thicken sheet by 0.8 mm',
            baseVersion: result.version,
            ops: [
              {
                t: 'add',
                node: { id: 'body', kind: 'thickenSurface', surface: 'sheet', thickness: 0.8 },
              },
            ],
          }),
        ],
      },
      { content: [tool('design_evaluate', { pieceId: piece.id, detail: 'production' })] },
      { content: [text('The sheet is now 0.8 mm thick.')] },
    )
    const { run } = await api.call('threads.send', {
      text: 'Thicken the loft surface by 0.8 mm.',
      clientId: 'thicken-test',
      clientMessageId: 'thicken-test-1',
      context: { pieceId: piece.id },
    })
    await settled(s.parts, run.id)
    const trace = await api.call('traces.run', { id: run.id })
    expect(trace.run.status).toBe('done')
    expect(
      trace.steps
        .filter((step) => step.name === 'design.apply' || step.name === 'design.evaluate')
        .map((step) => step.isError),
    ).toEqual([false, false])
    const summary = await api.call('design.evaluate', { pieceId: piece.id, detail: 'production' })
    expect(summary.metals[0]?.volumeMm3).toBeCloseTo(40, 3)
    expect(summary.modelingSurfaces ?? []).toHaveLength(0)
  } finally {
    await s.server.dispose()
  }
}, 90_000)
