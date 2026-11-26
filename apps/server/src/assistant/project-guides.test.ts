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
