// Run against a disposable server: pnpm exec tsx apps/studio/e2e/reference-board.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { chromium as chromiumType } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const museumRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/rpc/references.search')) museumRequests.push(request.url())
  })
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name} ${response.status()}`)
    return response.json()
  }

  const photoPiece = await rpc('pieces.create', { title: 'Photo references' })
  const searchPiece = await rpc('pieces.create', { title: 'Search references' })
  const board = () => page.getByRole('region', { name: 'Design board', exact: true })
  const addPhoto = () => board().getByRole('button', { name: 'Add reference photo' })
  const boardsFor = (pieceId: string) => rpc('boards.list', { pieceId })
  const openDesign = (pieceId: string, boardId?: string) => {
    const url = new URL(`/pieces/${pieceId}/directions`, base)
    if (boardId) url.searchParams.set('board', boardId)
    return page.goto(url.href)
  }

  await openDesign(photoPiece.id)
  await addPhoto().waitFor()
  assert.equal(await board().getByRole('button', { name: 'Grid', exact: true }).count(), 0)
  const cancelled = page.waitForEvent('filechooser')
  await addPhoto().click()
  await (await cancelled).setFiles([])
  assert.deepEqual(await boardsFor(photoPiece.id), [])

  const picked = page.waitForEvent('filechooser')
  await addPhoto().click()
  await (await picked).setFiles({
    name: 'ring-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iOuoAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await board().getByRole('article', { name: 'Picture: ring-photo' }).waitFor()
  const [photoBoard] = await boardsFor(photoPiece.id)
  assert.equal(photoBoard.pieceId, photoPiece.id)
  assert.deepEqual(await boardsFor(searchPiece.id), [])
  await board().getByRole('button', { name: 'Grid', exact: true }).waitFor()
  await board().getByRole('button', { name: 'Arrange by hand', exact: true }).waitFor()

  await context.route(/^https:\/\/www\.(google|pinterest)\.com\//, (route) =>
    route.fulfill({ body: 'Provider navigation', contentType: 'text/plain' }),
  )
  await openDesign(searchPiece.id, photoBoard.id)
  await board().getByRole('button', { name: 'Search for references' }).click()
  const search = board().getByRole('textbox', { name: 'Search terms' })
  await search.fill('oval & yellow gold')
  const checkProvider = async (name: string, expected: string) => {
    const opened = page.waitForEvent('popup')
    await board().getByRole('link', { name, exact: true }).click()
    const popup = await opened
    await popup.waitForLoadState()
    assert.equal(popup.url(), expected)
    await popup.close()
  }
  await checkProvider(
    'Google Images',
    'https://www.google.com/search?tbm=isch&q=oval+%26+yellow+gold',
  )
  await checkProvider('Pinterest', 'https://www.pinterest.com/search/pins/?q=oval+%26+yellow+gold')
  assert.deepEqual(await boardsFor(searchPiece.id), [])

  const link = 'https://www.pinterest.com/pin/1234567890/'
  await board().getByRole('textbox', { name: 'Reference link' }).fill(link)
  await board().getByRole('button', { name: 'Save link' }).click()
  await board().getByRole('article', { name: 'Link: pinterest.com' }).waitFor()
  const [searchBoard] = await boardsFor(searchPiece.id)
  assert.notEqual(searchBoard.id, photoBoard.id)
  const references = (await rpc('boards.get', { id: searchBoard.id })).references
  assert.equal(references.length, 1)
  assert.equal(references[0].source.url, link)
  assert.equal(references[0].rights, 'viewOnly')
  assert.equal((await rpc('boards.get', { id: photoBoard.id })).references.length, 1)

  await board().getByRole('button', { name: 'Search for references' }).click()
  await search.fill('signet ring')
  await checkProvider('Pinterest', 'https://www.pinterest.com/search/pins/?q=signet+ring')

  const linkedEmpty = await rpc('boards.create', {
    title: 'Another board',
    pieceId: searchPiece.id,
  })
  await openDesign(searchPiece.id, linkedEmpty.id)
  await addPhoto().waitFor()
  assert.equal(await board().getByRole('button', { name: 'Grid', exact: true }).count(), 0)
  await board().getByRole('button', { name: 'Write a note' }).click()
  const note = page.getByRole('textbox', { name: 'Write a note' })
  await note.fill('Lower the bezel')
  await page.getByRole('button', { name: 'Add the note' }).click()
  await board().getByRole('article', { name: 'Note: Untitled' }).waitFor()
  assert.equal(
    (await rpc('boards.get', { id: linkedEmpty.id })).references[0].note,
    'Lower the bezel',
  )
  assert.equal((await rpc('boards.get', { id: searchBoard.id })).references.length, 1)
  console.log(
    'Passed native picker and cancellation, lazy saves, provider navigation, and board scope.',
  )
} finally {
  await browser.close()
}
