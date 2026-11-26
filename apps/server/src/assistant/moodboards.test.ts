import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text } from './testing'

let server: AssistantServer
let api: Client
beforeAll(async () => {
  server = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-000000000000-MOODBOARD' },
  })
  api = client(server.server)
}, BOOT_TIMEOUT)
afterAll(() => server?.server.dispose())

async function picture(name: string, background: string) {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([bytes], name, { type: 'image/png' }))
  const response = await api.request('/api/assets', { method: 'POST', body: form })
  expect(response.status).toBe(201)
  return (await response.json()).id as string
}

it('gives a project turn the chosen moodboard notes and permitted images', async () => {
  const project = await api.call('pieces.create', { title: 'Pendant' })
  const other = await api.call('pieces.create', { title: 'Other client' })
  const source = await api.call('boards.create', { title: 'Studio reference board' })
  const privateSource = await api.call('boards.create', { title: 'Other reference board' })
  const own = await picture('owned-sketch.png', '#83a123')
  const restricted = await picture('restricted-photo.png', '#1234ac')
  await api.call('references.save', {
    boardId: source.id,
    items: [
      { assetId: own, title: 'Stepped Sketch' },
      { assetId: restricted, title: 'Inspiration photo', rights: 'viewOnly' },
      { note: 'Keep the stepped shoulders.' },
      { url: 'https://www.pinterest.com/pin/123/', title: 'Source link' },
    ],
  })
  await api.call('references.save', {
    boardId: privateSource.id,
    items: [{ note: 'Other client only.' }],
  })
  const { board } = await api.call('boards.importMoodboard', {
    pieceId: project.id,
    sourceBoardId: source.id,
  })
  const { board: otherBoard } = await api.call('boards.importMoodboard', {
    pieceId: other.id,
    sourceBoardId: privateSource.id,
  })
  server.model.push({
    content: [text('I would start with the stepped shoulders.')],
    stop_reason: 'end_turn',
  })
  const { run } = await api.call('threads.send', {
    text: 'What should we make?',
    clientId: 'moodboards',
    clientMessageId: 'first',
    context: { pieceId: project.id, boardId: otherBoard.id },
  })
  await settled(server.parts, run.id)
  const request = server.model.requests.at(-1)!
  const body = JSON.stringify(request.messages)
  expect(body).toContain(board.id)
  expect(body).toContain('Keep the stepped shoulders.')
  expect(body).toContain('Stepped Sketch')
  expect(body).toContain('Inspiration photo')
  expect(body).toContain('https://www.pinterest.com/pin/123/')
  expect(body).not.toContain('Other client only.')
  expect(body).not.toContain(restricted)
  expect(body.match(/"type":"image"/g)).toHaveLength(1)
})
