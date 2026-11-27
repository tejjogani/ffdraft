import { afterAll, beforeAll, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

let server: AssistantServer
let api: Client
beforeAll(async () => {
  server = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-00000000000000000-CONTEXT' },
  })
  api = client(server.server)
}, BOOT_TIMEOUT)
afterAll(() => server?.server.dispose())

it('tells Claude which saved shot was open per message without pinning the project thread', async () => {
  const project = await api.call('pieces.create', { title: 'Current render view' })
  const other = await api.call('pieces.create', { title: 'Other render view' })
  const [firstShot, secondShot, foreignShot] = await Promise.all(
    [project.id, project.id, other.id].map((pieceId) =>
      api.call('scenes.create', { pieceId, title: 'Hero', scene: {} }),
    ),
  )
  const message = (clientMessageId: string, sceneId?: string, threadId?: string) => ({
    text: 'Look at this view',
    clientId: 'test',
    clientMessageId,
    threadId,
    context: { pieceId: project.id, stage: 'render' as const, sceneId },
  })
  const send = async (input: ReturnType<typeof message>) => {
    server.model.push({ content: [text('Viewed')], stop_reason: 'end_turn' })
    const out = await api.call('threads.send', input)
    await settled(server.parts, out.run.id)
    const messages = JSON.stringify(server.model.requests.at(-1)!.messages)
    return { ...out, lines: messages.match(/Open render shot: [^\n]*?\(id scn_[\w-]+\)/g) ?? [] }
  }
  const first = await send(message('render-view-first', firstShot!.id))
  expect(first.lines.at(-1)).toContain(firstShot!.id)
  expect(first.thread.context.sceneId).toBeNull()
  const second = await send(message('render-view-second', secondShot!.id, first.thread.id))
  expect(second.thread.id).toBe(first.thread.id)
  expect(second.lines.at(-1)).toContain(secondShot!.id)
  const third = await send(message('render-view-cleared', undefined, first.thread.id))
  expect(third.lines).toEqual(second.lines)
  const invalid = await api.fail(
    'threads.send',
    message('render-view-foreign', foreignShot!.id, first.thread.id),
  )
  expect(invalid.status).toBe(400)
})

it('keeps a project thread while changing focus and records the instructions actually sent', async () => {
  const brief = 'A 32 mm Cuban-chain pendant in white gold'
  const project = await api.call('pieces.create', {
    title: 'Pendant A',
    brief,
    spec: {
      kind: 'pendant',
      archetype: 'custom',
      title: 'Pendant A',
      summary: 'Approved linework',
      body: { heightMm: 32, thicknessMm: 1.4 },
      metal: { alloy: 'au18k-white', finish: 'brushed' },
    },
  })
  const other = await api.call('pieces.create', { title: 'Pendant B' })
  const board = await api.call('boards.create', { title: 'Other project board', pieceId: other.id })
  const [foreignRef] = await api.call('references.save', {
    boardId: board.id,
    items: [{ note: 'Private other project sketch', title: 'Other sketch' }],
  })
  const send = async (clientMessageId: string, stage: 'design' | 'cad', threadId?: string) => {
    const out = await api.call('threads.send', {
      text: 'Discuss this project',
      referenceIds: [foreignRef!.id],
      clientId: 'test',
      clientMessageId,
      threadId,
      context: { pieceId: project.id, stage },
    })
    await settled(server.parts, out.run.id)
    const { steps } = await api.call('traces.run', { id: out.run.id })
    const prompt = steps.find((s) => s.kind === 'model')?.input as {
      prompt: { focus: string; hash: string; skills: string[] }
    }
    expect(prompt.prompt.focus).toBe(stage)
    expect(prompt.prompt.skills.length).toBeGreaterThan(2)
    return out
  }
  server.model.push({ content: [text('Design ideas')], stop_reason: 'end_turn' })
  const first = await send('design', 'design')
  expect(JSON.stringify(server.model.requests.at(-1)!.messages)).toContain(brief)
  const firstContext = JSON.stringify(server.model.requests.at(-1)!.messages)
  expect(firstContext).toContain('Saved design specification')
  expect(firstContext).toContain(JSON.stringify('"heightMm":32').slice(1, -1))
  expect(firstContext).toContain('au18k-white')
  expect(firstContext).not.toContain(foreignRef!.id)
  const systemBefore = JSON.stringify(server.model.requests.at(-1)!.system)
  server.model.push(
    { content: [tool('pieces_get', { id: other.id }, 'readOther')], stop_reason: 'tool_use' },
    { content: [text('CAD feedback')], stop_reason: 'end_turn' },
  )
  const second = await send('cad', 'cad', first.thread.id)
  expect(second.thread.id).toBe(first.thread.id)
  expect(JSON.stringify(server.model.requests.at(-1)!.system)).not.toEqual(systemBefore)
  expect(JSON.stringify(server.model.requests.at(-1)!.messages)).toContain('Design ideas')
  const { steps } = await api.call('traces.run', { id: second.run.id })
  expect(steps.find((s) => s.name === 'pieces.get')).toMatchObject({ isError: true })
  expect(JSON.stringify(server.model.requests.at(-1)!.messages)).not.toContain('Pendant B')
})

it('links a scoped CAD inspection and write to the run trace and undoable project history', async () => {
  const project = await api.call('pieces.create', { templateId: 'solitaire' })
  const other = await api.call('pieces.create', { templateId: 'solitaire' })
  const inspect = { pieceId: project.id, nodeId: 'band' }
  const edit = {
    pieceId: project.id,
    baseVersion: project.version,
    label: 'Thicken the base to 1.8 mm',
    ops: [{ t: 'update', id: 'band', patch: { thicknessBottom: 1.8 } }],
  }
  server.model.push(
    {
      content: [tool('design_describe', { ...inspect, pieceId: other.id }, 'foreign')],
      stop_reason: 'tool_use',
    },
    { content: [tool('design_describe', inspect, 'inspect')], stop_reason: 'tool_use' },
    { content: [tool('design_apply', edit, 'apply')], stop_reason: 'tool_use' },
    { content: [text('The base is now 1.8 mm.')], stop_reason: 'end_turn' },
  )
  const { run } = await api.call('threads.send', {
    text: 'Thicken just the base to 1.8 mm',
    clientId: 'test',
    clientMessageId: 'thicken-base',
    context: { pieceId: project.id, stage: 'cad' },
  })
  await settled(server.parts, run.id)
  const { steps } = await api.call('traces.run', { id: run.id })
  expect(steps.filter((s) => s.name === 'design.describe').map((s) => s.isError)).toEqual([
    true,
    false,
  ])
  expect(steps.find((s) => s.name === 'design.apply')).toMatchObject({
    input: edit,
    isError: false,
  })
  const [change] = await api.call('design.history', { pieceId: project.id })
  expect(change).toMatchObject({ actor: { type: 'agent', runId: run.id }, ops: edit.ops })
  const edited = await api.call('design.describe', inspect)
  expect(edited.values.thicknessBottom).toBe(1.8)
  await api.call('design.revert', { pieceId: project.id, runId: run.id })
  expect((await api.call('design.describe', inspect)).values).toEqual(project.design.nodes.band)
  expect((await api.call('pieces.get', { id: other.id })).version).toBe(other.version)
})

it('records native face inspection and the signed thickness change through the project assistant', async () => {
  const { createRhinoSleeve } = await import('../test/rhino-sleeve')
  const ref = await createRhinoSleeve(server.server, api)
  const listed = await api.call('design.rhinoCapFaces', ref)
  const top = listed.faces.find((f) => f.normal[1] < -0.999)!
  server.model.push(
    { content: [tool('design_rhinoCapFaces', ref, 'inspectEnd')], stop_reason: 'tool_use' },
    {
      content: [
        tool(
          'design_offsetRhinoCap',
          {
            ...ref,
            baseVersion: listed.version,
            nativeAssetId: listed.nativeAssetId,
            faceIndex: top.faceIndex,
            offsetMm: 0.25,
          },
          'moveEnd',
        ),
      ],
      stop_reason: 'tool_use',
    },
    { content: [text('Moved the end by 0.25 mm.')], stop_reason: 'end_turn' },
  )
  const { run } = await api.call('threads.send', {
    text: 'Make this sleeve 0.25 mm longer.',
    clientId: 'test',
    clientMessageId: 'native-end-edit',
    context: { pieceId: ref.pieceId, stage: 'cad' },
  })
  await settled(server.parts, run.id)
  const history = await api.call('design.history', { pieceId: ref.pieceId })
  expect(history[0]?.actor).toMatchObject({ runId: run.id })
  const moved = await api.call('design.rhinoCapFaces', ref)
  expect(moved.faces.find((f) => f.faceIndex === top.faceIndex)?.spanMm).toBeCloseTo(2.25, 7)
  await api.call('design.revert', { pieceId: ref.pieceId, runId: run.id })
  expect((await api.call('design.rhinoCapFaces', ref)).faces).toEqual(listed.faces)
})

it('scopes the exact-edge tool and records duplication as an undoable assistant edit', async () => {
  const { createRhinoSleeve } = await import('../test/rhino-sleeve')
  const ref = await createRhinoSleeve(server.server, api)
  const inspect = { ...ref, edgeIndex: 0 }
  const exact = await api.call('design.rhinoEdges', inspect)
  const other = await createRhinoSleeve(server.server, api)
  const edit = {
    pieceId: ref.pieceId,
    baseVersion: exact.version,
    label: 'Duplicate the Rhino rim',
    ops: [{ t: 'add', node: { kind: 'nurbsCurve', id: 'native-rim', ...exact.curve! } }],
  }
  server.model.push(
    {
      content: [tool('design_rhinoEdges', { ...inspect, pieceId: other.pieceId }, 'foreign')],
      stop_reason: 'tool_use',
    },
    { content: [tool('design_rhinoEdges', inspect, 'readNative')], stop_reason: 'tool_use' },
    { content: [tool('design_apply', edit, 'duplicateNative')], stop_reason: 'tool_use' },
    { content: [text('Duplicated the rim to an editable curve.')], stop_reason: 'end_turn' },
  )
  const { run } = await api.call('threads.send', {
    text: 'Duplicate the sleeve rim as an editable Rhino curve.',
    clientId: 'test',
    clientMessageId: 'native-edge-copy',
    context: { pieceId: ref.pieceId, stage: 'cad' },
  })
  await settled(server.parts, run.id)
  const { steps } = await api.call('traces.run', { id: run.id })
  expect(
    steps.filter((step) => step.name === 'design.rhinoEdges').map((step) => step.isError),
  ).toEqual([true, false])
  const [change] = await api.call('design.history', { pieceId: ref.pieceId })
  expect(change?.actor).toMatchObject({ runId: run.id })
  expect(
    (await api.call('pieces.get', { id: ref.pieceId })).design.nodes['native-rim'],
  ).toMatchObject(exact.curve!)
  await api.call('design.revert', { pieceId: ref.pieceId, runId: run.id })
  expect(
    (await api.call('pieces.get', { id: ref.pieceId })).design.nodes['native-rim'],
  ).toBeUndefined()
})

it('copies the outside rim and hole as a single scoped assistant change', async () => {
  const { createRhinoSleeve } = await import('../test/rhino-sleeve')
  const current = await createRhinoSleeve(server.server, api)
  const other = await createRhinoSleeve(server.server, api)
  const before = await api.call('pieces.get', { id: current.pieceId })
  const unrelated = await api.call('pieces.get', { id: other.pieceId })
  const cap = (await api.call('design.rhinoCapFaces', current)).faces.find(
    (f) => f.innerLoops === 1,
  )!
  const inspect = { ...current, faceIndex: cap.faceIndex }
  const border = await api.call('design.rhinoFaceBorders', inspect)
  expect(border.curves?.map((c) => c.kind)).toEqual(['outer', 'inner'])
  const ops = border.curves!.map(({ kind, degree, knots, controlPoints }) => ({
    t: 'add',
    node: { id: kind + '-rim', kind: 'nurbsCurve', degree, knots, controlPoints },
  }))
  server.model.push(
    {
      content: [tool('design_rhinoFaceBorders', { ...other, faceIndex: cap.faceIndex }, 'foreign')],
      stop_reason: 'tool_use',
    },
    { content: [tool('design_rhinoFaceBorders', inspect, 'readBorders')], stop_reason: 'tool_use' },
    {
      content: [
        tool(
          'design_apply',
          {
            pieceId: current.pieceId,
            baseVersion: border.version,
            ops,
            label: 'Copy the outside of the sleeve and its hole',
          },
          'copyBorders',
        ),
      ],
      stop_reason: 'tool_use',
    },
    { content: [text('Copied the two rims as editable curves.')], stop_reason: 'end_turn' },
  )
  const { run } = await api.call('threads.send', {
    text: 'Trace the top of this sleeve, including its hole, as separate editable curves.',
    clientId: 'test',
    clientMessageId: 'native-face-borders',
    context: { pieceId: current.pieceId, stage: 'cad' },
  })
  await settled(server.parts, run.id)
  const { steps } = await api.call('traces.run', { id: run.id })
  expect(steps.filter((s) => s.name === 'design.rhinoFaceBorders').map((s) => s.isError)).toEqual([
    true,
    false,
  ])
  const after = await api.call('pieces.get', { id: current.pieceId })
  expect(after.version).toBe(before.version + 1)
  for (const op of ops) expect(after.design.nodes[op.node.id]).toMatchObject(op.node)
  const [change] = await api.call('design.history', { pieceId: current.pieceId })
  expect(change?.actor).toMatchObject({ runId: run.id })
  await api.call('design.revert', { pieceId: current.pieceId, runId: run.id })
  expect((await api.call('pieces.get', { id: current.pieceId })).design).toEqual(before.design)
  expect((await api.call('pieces.get', { id: other.pieceId })).version).toBe(unrelated.version)
})

it('checks modeling support in this project and rejects an invented placement edit atomically', async () => {
  const ring = await api.call('pieces.create', { templateId: 'halo', title: 'Reference fit' })
  const other = await api.call('pieces.create', { title: 'Separate commission' })
  const lookup = { pieceId: ring.id, operation: 'moveGeneratedStone' }
  const availability = await api.call('design.capabilities', lookup)
  expect(availability).toMatchObject({
    version: ring.version,
    status: 'unavailable',
    tools: [],
  })
  expect(availability.projectKinds).toContain('gemRow')
  const loft = await api.call('design.capabilities', { pieceId: ring.id, operation: 'Loft' })
  expect(loft).toMatchObject({
    status: 'available',
    tools: ['design.apply'],
    schema: { properties: { sections: {} } },
  })
  expect(
    await api.call('design.capabilities', { pieceId: ring.id, operation: 'closedSweep2' }),
  ).toMatchObject({ status: 'unavailable' })
  expect(
    await api.call('design.capabilities', { pieceId: ring.id, operation: 'acmePluginCommand' }),
  ).toMatchObject({ status: 'unverified', tools: [] })
  server.model.push(
    { content: [tool('design_capabilities', { ...lookup, pieceId: other.id }, 'other')] },
    { content: [tool('design_capabilities', lookup, 'check')] },
    {
      content: [
        tool(
          'design_apply',
          {
            pieceId: ring.id,
            baseVersion: ring.version,
            label: 'Move one shoulder stone',
            ops: [
              {
                t: 'update',
                id: 'row',
                patch: { stoneWidth: 1.3, pinnedStoneOffsets: { 4: [0.2, 0, 0] } },
              },
            ],
          },
          'invalid',
        ),
      ],
    },
    {
      content: [
        text(
          'The generated row supports width and spacing. Individual permanent offsets are unavailable.',
        ),
      ],
    },
  )
  const { run } = await api.call('threads.send', {
    text: 'Move and lock just the fourth shoulder stone',
    context: { pieceId: ring.id, stage: 'cad' },
    clientId: 'test',
    clientMessageId: 'look-up-generated-stone-edit',
  })
  await settled(server.parts, run.id)
  const { steps } = await api.call('traces.run', { id: run.id })
  expect(steps.filter((s) => s.kind === 'tool').map((s) => [s.name, s.isError])).toEqual([
    ['design.capabilities', true],
    ['design.capabilities', false],
    ['design.apply', true],
  ])
  const unchanged = await api.call('pieces.get', { id: ring.id })
  expect(unchanged.version).toBe(ring.version)
  expect(unchanged.design).toEqual(ring.design)
  expect(await api.call('design.history', { pieceId: ring.id })).toEqual([])
})
