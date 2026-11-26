// Exercises Home, Design and the CAD dock with a disposable scripted-assistant server.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw new Error('Pass the disposable scripted Studio URL')
const browser = await chromium.launch()

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const sent: {
    threadId?: string
    text: string
    attachments?: string[]
    referenceIds?: string[]
    context: { pieceId?: string; boardId?: string; brainstorm?: boolean; intake?: boolean }
    job?: { stage?: string }
  }[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/rpc/threads.send')) sent.push(request.postDataJSON())
  })
  const rpc = async (method: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${method}`, { data })
    assert.ok(response.ok(), await response.text())
    return response.json()
  }
  const brief = 'A low-profile engagement ring to mark the Aster commission.'
  await page.goto(base)
  await page.getByRole('textbox', { name: 'Describe a piece for the assistant' }).fill(brief)
  await page.getByRole('button', { name: 'Start design intake' }).click()
  await page.waitForURL((url) => url.searchParams.has('intake') && url.searchParams.has('thread'))
  const opened = new URL(page.url())
  const pieceId = opened.searchParams.get('intake')
  const threadId = opened.searchParams.get('thread')
  assert.ok(pieceId && threadId)
  assert.equal(sent[0]?.context.intake, true)
  assert.equal(sent[0]?.job, undefined)

  const design = `${base}/pieces/${pieceId}/directions`
  const section = page.getByRole('region', { name: 'Design conversation' })
  const log = section.getByRole('log', { name: 'Conversation' })
  await page.goto(design)
  await log.getByText(brief, { exact: false }).first().waitFor({ timeout: 8000 })
  await log.getByText('A low bezel would make the silhouette quieter.').waitFor()

  const other = await rpc('pieces.create', {
    title: 'Separate B commission',
    templateId: 'solitaire',
  })
  await rpc('pieces.setSpec', {
    id: pieceId,
    spec: {
      ...other.spec,
      title: 'Aster workshop specification',
      openQuestions: ['Confirm gallery height.'],
    },
  })
  const upload = await page.request.post(`${base}/api/assets`, {
    multipart: {
      file: {
        name: 'aster-study.jpg',
        mimeType: 'image/jpeg',
        buffer: await readFile(
          new URL('../../server/src/assistant/fixtures/recordings/ring-photo.jpg', import.meta.url),
        ),
      },
    },
  })
  assert.ok(upload.ok(), await upload.text())
  const asset = await upload.json()
  const [reference] = await rpc('references.saveForPiece', {
    pieceId,
    items: [{ assetId: asset.id, title: 'Aster shape study', rights: 'own' }],
  })
  const [board] = await rpc('boards.list', { pieceId })
  await page.reload()
  await page.getByRole('button', { name: 'Select Aster shape study', exact: true }).click()
  const selection = page.getByRole('region', { name: 'Selected item' })
  await selection.getByRole('button', { name: 'Discuss this reference' }).click()
  await section.getByText('Aster shape study', { exact: true }).waitFor()
  const question = 'Could we preserve the curve of this gallery?'
  await section.getByRole('textbox', { name: 'Message about this design' }).fill(question)
  await section.getByRole('button', { name: 'Send design message' }).click()
  await log.getByText(question, { exact: true }).waitFor()
  await log
    .getByText('A gently asymmetrical outline would give the pendant more movement.')
    .waitFor()
  const discussion = sent.find((send) => send.text === question)
  assert.ok(discussion)
  assert.equal(discussion.threadId, threadId)
  assert.deepEqual(discussion.context, {
    pieceId,
    boardId: board.id,
    stage: 'design',
    selection: [],
    brainstorm: true,
  })
  assert.deepEqual(discussion.attachments, [asset.id])
  assert.deepEqual(discussion.referenceIds, [reference.id])
  assert.equal(discussion.job, undefined)

  const [concept] = await rpc('references.proposeConcepts', {
    boardId: board.id,
    concepts: [{ title: 'Low gallery', note: 'Preserve the selected profile.' }],
  })
  await rpc('pieces.confirmIntake', {
    pieceId,
    boardId: board.id,
    selection: { conceptId: concept.id, visualId: reference.id },
    details: { thicknessMm: 2.1 },
  })
  await page.evaluate(() => localStorage.removeItem('pave:selected-design'))
  await page.reload()
  await selection.getByText('Aster shape study', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Build CAD with Claude', exact: true }).click()
  await page.waitForURL(`**/pieces/${pieceId}/design`)
  const cad = sent.find((send) => send.job?.stage === 'cad')
  assert.equal(cad?.threadId, threadId)
  assert.equal(cad?.context.pieceId, pieceId)
  assert.deepEqual(cad?.attachments, [asset.id])
  assert.deepEqual(cad?.referenceIds, [reference.id])
  assert.equal(cad?.context.brainstorm, undefined)
  assert.match(cad.text, /Aster workshop specification/)
  assert.match(cad.text, /Confirm gallery height/)
  assert.match(cad.text, /thickness 2.1 mm/)
  assert.match(cad.text, /Aster shape study/)
  const dock = page.getByRole('complementary', { name: 'Assistant', exact: true })
  await dock.getByRole('log').getByText(question, { exact: true }).waitFor()
  await dock.getByRole('log').getByText(brief, { exact: false }).first().waitFor()
  const threads = await rpc('threads.list', { pieceId, limit: 10 })
  assert.deepEqual(
    threads.map((thread: { id: string }) => thread.id),
    [threadId],
  )

  await page.goto(`${base}/pieces/${other.id}/directions`)
  await section.getByRole('textbox', { name: 'Message about this design' }).waitFor()
  assert.equal(await page.getByText(question, { exact: true }).count(), 0)
  assert.equal(await page.getByText(brief, { exact: true }).count(), 0)
  await page.goto(design)
  await log.getByText(question, { exact: true }).waitFor()
  console.log(
    'PASS Home, Design and CAD share one project thread and the selected image; another project stays separate.',
  )
} finally {
  await browser.close()
}
