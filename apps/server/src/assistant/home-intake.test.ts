import { afterAll, beforeAll, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

let server: AssistantServer
let api: Client
const brief = 'Turn my logo into an iced pendant with a Cuban chain'
const start = (requestId: string, assetIds: string[] = []) =>
  api.call('pieces.startIntake', { requestId, brief, assetIds })

beforeAll(async () => {
  // Inject disallowed tool calls to verify the execution guard even if a model ignores its tool list.
  server = await assistantServer({
    transport: 'direct',
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-home-intake' },
  })
  api = client(server.server)
}, BOOT_TIMEOUT)
afterAll(async () => server.server.dispose())

it('creates one blank project and keeps the original logo on its own board across retries', async () => {
  const form = new FormData()
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X0AAAAASUVORK5CYII='
  form.set('file', new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }), 'client logo.png')
  const response = await api.request('/api/assets', { method: 'POST', body: form })
  expect(response.status).toBe(201)
  const { id } = (await response.json()) as { id: string }
  const requestId = 'logo-intake-fixture'
  const [first, retry] = await Promise.all([start(requestId, [id]), start(requestId, [id])])
  expect(retry).toEqual(first)
  const piece = await api.call('pieces.get', { id: first.pieceId })
  expect(piece).toMatchObject({ brief, kind: 'pendant', stage: 'idea', design: { order: [] } })
  expect(piece.origin?.sourceAssetIds).toEqual([id])
  const board = await api.call('boards.get', { id: first.boardId })
  expect(board.board.pieceId).toBe(first.pieceId)
  expect(board.references).toMatchObject([{ assetId: id, title: 'client logo.png' }])
  await Promise.all([
    api.call('pieces.addIntakeAssets', { ...first, assetIds: [id] }),
    api.call('pieces.addIntakeAssets', { ...first, assetIds: [id] }),
  ])
  expect((await api.call('boards.get', { id: first.boardId })).references).toHaveLength(1)
  const other = await start('another-client-intake')
  expect(other.pieceId).not.toBe(first.pieceId)
  expect((await api.call('boards.get', { id: other.boardId })).references).toEqual([])
  expect(
    await api.fail('pieces.addIntakeAssets', { ...other, boardId: first.boardId, assetIds: [id] }),
  ).toMatchObject({ status: 404 })
})

it('saves the chosen name and folder with the initial brief and preserves them on retry', async () => {
  const folder = await api.call('collections.create', { name: 'Client commissions' })
  const input = {
    requestId: 'named-intake-fixture',
    brief,
    title: '  Calder pendant  ',
    collectionId: folder.id,
  }
  const [created, duplicate] = await Promise.all([
    api.call('pieces.startIntake', input),
    api.call('pieces.startIntake', input),
  ])
  expect(duplicate).toEqual(created)
  await api.call('pieces.startIntake', { ...input, title: 'Different', collectionId: null })
  expect(await api.call('pieces.get', { id: created.pieceId })).toMatchObject({
    title: 'Calder pendant',
    collectionId: folder.id,
    brief,
  })
  const count = (await api.call('pieces.list', {})).length
  const rejected = await api.fail('pieces.startIntake', {
    ...input,
    requestId: 'missing-intake-folder',
    collectionId: 'col_missing',
  })
  expect(rejected.status).toBe(404)
  expect(await api.call('pieces.list', {})).toHaveLength(count)
  const plain = await start('untitled-default-intake')
  expect(await api.call('pieces.get', { id: plain.pieceId })).toMatchObject({
    title: brief,
    collectionId: null,
  })
})

it('keeps an intake run in Design and stores the concepts on that project', async () => {
  const p = await start('intake-concepts-fixture')
  const spec = {
    kind: 'pendant',
    archetype: 'icedPendant',
    title: 'Logo pendant',
    summary: 'A pendant in white gold',
  }
  server.model.push(
    {
      content: [
        tool('references_proposeConcepts', {
          boardId: p.boardId,
          concepts: [
            { title: 'Cutout silhouette', note: 'Pavé follows the perimeter of the cutout logo.' },
            { title: 'Raised medallion', note: 'The logo stands in relief on a pavé disc.' },
          ],
        }),
      ],
    },
    { content: [tool('pieces_create', { title: 'Unrequested project', spec })] },
    { content: [text('Choose a concept to take forward.')] },
  )
  const sent = await api.call('threads.send', {
    text: brief,
    context: { ...p, stage: 'design', intake: true },
    clientId: 'home-test',
    clientMessageId: 'home-concepts-send',
  })
  await settled(server.parts, sent.run.id)
  const stored = await api.call('threads.get', { id: sent.thread.id })
  expect(stored.thread.context).toMatchObject(p)
  expect((await api.call('pieces.get', { id: p.pieceId })).design.order).toEqual([])
  const projects = await api.call('pieces.list', {})
  expect(projects.some((piece) => piece.title === 'Unrequested project')).toBe(false)
  const board = await api.call('boards.get', { id: p.boardId })
  expect(board.references.map((r) => r.title)).toEqual(['Cutout silhouette', 'Raised medallion'])
})

it('lets a Home brainstorm answer without creating a project even when a tool call tries to', async () => {
  const count = (await api.call('pieces.list', {})).length
  server.model.push(
    { content: [tool('pieces_create', { title: 'Do not save this idea' })] },
    { content: [text('A cutout would emphasize the silhouette.')] },
  )
  const sent = await api.call('threads.send', {
    text: 'What would make the logo readable at 25 mm?',
    context: { brainstorm: true },
    clientId: 'home-test',
    clientMessageId: 'home-brainstorm-send',
  })
  await settled(server.parts, sent.run.id)
  const stored = await api.call('threads.get', { id: sent.thread.id })
  expect(stored.thread.context.pieceId).toBeNull()
  expect(
    stored.messages.some((m) => JSON.stringify(m.content).includes('emphasize the silhouette')),
  ).toBe(true)
  expect((await api.call('pieces.list', {})).length).toBe(count)
})

it('refuses cross-project reads and conversation reuse during a project brainstorm', async () => {
  const a = await start('brainstorm-project-a')
  const b = await start('brainstorm-project-b')
  server.model.push(
    {
      content: [
        tool('pieces_get', { id: a.pieceId }),
        tool('pieces_get', { id: b.pieceId }),
        tool('boards_get', { id: b.boardId }),
        tool('pieces_list', {}),
      ],
    },
    { content: [text('Here are some ideas scoped to the current project.')] },
  )
  const sent = await api.call('threads.send', {
    text: 'What could make this project read more cleanly?',
    context: { ...a, brainstorm: true },
    clientId: 'home-test',
    clientMessageId: 'scoped-brainstorm-send',
  })
  await settled(server.parts, sent.run.id)
  const trace = await api.call('traces.run', { id: sent.run.id })
  expect(trace.steps.filter((s) => s.kind === 'tool').map((s) => [s.name, s.isError])).toEqual([
    ['pieces.get', false],
    ['pieces.get', true],
    ['boards.get', true],
    ['pieces.list', true],
  ])
  const reused = await api.fail('threads.send', {
    threadId: sent.thread.id,
    text: 'Keep this conversation for the other piece',
    context: b,
    clientId: 'home-test',
    clientMessageId: 'scoped-brainstorm-wrong-project',
  })
  expect(reused.status).toBe(400)
})

it('persists the chosen concept, visual and confirmed partial measurements on the piece', async () => {
  const p = await start('durable-intake-details')
  const upload = new FormData()
  upload.set(
    'file',
    new Blob(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>',
      ],
      { type: 'image/svg+xml' },
    ),
    'outline.svg',
  )
  const { id } = (await (
    await api.request('/api/assets', { method: 'POST', body: upload })
  ).json()) as { id: string }
  const [visual] = await api.call('pieces.addIntakeAssets', { ...p, assetIds: [id] })
  const [concept] = await api.call('references.proposeConcepts', {
    boardId: p.boardId,
    concepts: [{ title: 'Logo outline', note: 'Preserve the logo silhouette.' }],
  })
  await api.call('pieces.confirmIntake', {
    ...p,
    details: { heightMm: 32, metal: 'au18k-white', stoneMm: 1.2, chain: 'Cuban chain' },
    selection: { conceptId: concept!.id, visualId: visual!.id },
  })
  const piece = await api.call('pieces.get', { id: p.pieceId })
  expect(piece).toMatchObject({
    brief,
    kind: 'pendant',
    spec: null,
    intake: {
      details: { heightMm: 32, metal: 'au18k-white', stoneMm: 1.2, chain: 'Cuban chain' },
      selection: {
        boardId: p.boardId,
        conceptId: concept!.id,
        visualId: visual!.id,
        visualAssetId: id,
      },
    },
  })
  expect(piece.intake?.details.thicknessMm).toBeUndefined()
  const other = await start('distinct-client-visual')
  expect(
    (
      await api.fail('pieces.confirmIntake', {
        ...other,
        selection: { conceptId: concept!.id, visualId: visual!.id },
      })
    ).status,
  ).toBe(404)
})

it('persists only measurements that the designer confirms in intake quick replies', async () => {
  const p = await start('confirmed-quick-reply')
  server.model.push(
    {
      content: [
        tool(
          'chat_ask',
          {
            intro: 'Confirm the height and metal',
            questions: [
              {
                id: 'height',
                question: 'Pendant height?',
                options: [
                  { id: 'tall', label: '32 mm' },
                  { id: 'small', label: '25 mm' },
                ],
                defaults: ['small'],
              },
              {
                id: 'metal',
                question: 'Alloy?',
                options: [
                  { id: 'white', label: '18k White Gold' },
                  { id: 'yellow', label: '18k Yellow Gold' },
                ],
                defaults: ['yellow'],
              },
            ],
          },
          't_confirm_intake',
        ),
      ],
    },
    { content: [text('32 mm in white gold.')] },
  )
  const sent = await api.call('threads.send', {
    text: brief,
    context: { ...p, intake: true },
    clientId: 'home-test',
    clientMessageId: 'confirm-intake-quick-reply',
  })
  await settled(server.parts, sent.run.id)
  const pieceBefore = await api.call('pieces.get', { id: p.pieceId })
  expect(pieceBefore.intake?.details.heightMm).toBeUndefined()
  await api.call('runs.decide', {
    runId: sent.run.id,
    toolCallId: 't_confirm_intake',
    decision: 'approve',
    answers: { height: ['tall'], metal: ['white'] },
  })
  await settled(server.parts, sent.run.id)
  const piece = await api.call('pieces.get', { id: p.pieceId })
  expect(piece.intake?.details).toMatchObject({ heightMm: 32, metal: 'au18k-white' })
  expect(piece.intake?.details.thicknessMm).toBeUndefined()
  expect(piece.spec).toBeNull()
})
