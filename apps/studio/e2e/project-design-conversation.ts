// Use two disposable local Studio servers. The second serves a scripted assistant.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [base, assistantBase] = process.argv.slice(2)
if (!base) throw Error('Pass a disposable Studio URL, then a scripted assistant Studio URL')
const browser = await chromium.launch()

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const rpc = async (url: string, method: string, data: object) => {
    const response = await page.request.post(`${url}/api/rpc/${method}`, { data })
    assert.ok(response.ok(), await response.text())
    return response.json()
  }
  const addImage = async (url: string, pieceId: string) => {
    const image = await page.request.post(`${url}/api/assets`, {
      multipart: {
        file: {
          name: 'gallery-study.jpg',
          mimeType: 'image/jpeg',
          buffer: await readFile(
            new URL(
              '../../server/src/assistant/fixtures/recordings/ring-photo.jpg',
              import.meta.url,
            ),
          ),
        },
      },
    })
    assert.ok(image.ok(), await image.text())
    const asset = await image.json()
    await rpc(url, 'references.saveForPiece', {
      pieceId,
      items: [{ assetId: asset.id, title: 'Gallery shape study', rights: 'own' }],
    })
    return asset.id as string
  }
  const first = await rpc(base, 'pieces.create', {
    templateId: 'solitaire',
    title: 'Aster engagement ring',
    brief: 'Client wants a low-profile heirloom for daily wear.',
  })
  const second = await rpc(base, 'pieces.create', {
    templateId: 'halo',
    title: 'Reed anniversary ring',
    brief: 'Client wants an airy halo with a slim band.',
  })
  await rpc(base, 'pieces.setSpec', {
    id: first.id,
    spec: { ...first.spec, openQuestions: ['Confirm the height of the gallery with the client.'] },
  })
  const design = (url: string, id: string) => `${url}/pieces/${id}/directions`
  await page.goto(design(base, first.id))
  const conversation = page.getByRole('region', { name: 'Design conversation' })
  await conversation.waitFor({ timeout: 8000 })
  await conversation.getByRole('link', { name: 'Connect Claude' }).waitFor()
  await conversation
    .getByLabel('Design note')
    .fill('Leave room for a low gallery on the Aster ring.')
  await conversation.getByRole('button', { name: 'Save to design board' }).click()
  await page.getByText('Leave room for a low gallery on the Aster ring.').first().waitFor()
  const spec = page.getByRole('region', { name: 'Spec', exact: true })
  await spec.getByText(first.brief, { exact: true }).waitFor()
  await spec.getByText('1 ct round brilliant diamond', { exact: true }).waitFor()
  await spec.getByText('US 6', { exact: true }).waitFor()
  await spec.getByText('Confirm the height of the gallery with the client.').waitFor()
  await spec.getByRole('button', { name: 'Rebuild from specification only…' }).click()
  await page
    .getByRole('dialog', { name: 'Rebuild the CAD from this spec?' })
    .getByRole('button', { name: 'Cancel' })
    .click()

  const assetId = await addImage(base, first.id)
  await page.reload()
  await page.getByRole('button', { name: 'Select Gallery shape study', exact: true }).click()
  const selected = page.getByRole('region', { name: 'Selected item', exact: true })
  await selected.getByText('Gallery shape study', { exact: true }).waitFor()
  const captures = process.env.PAVE_E2E_SCREENSHOTS
  if (captures) {
    await mkdir(captures, { recursive: true })
    await page.screenshot({ path: join(captures, 'design-desktop.png') })
  }
  await selected.getByRole('button', { name: 'Open image in CAD', exact: true }).click()
  await page.waitForURL(`**/pieces/${first.id}/design`)
  const pinned = await rpc(base, 'references.pins', { pieceId: first.id })
  assert.ok(pinned.references.some((pin: { assetId: string }) => pin.assetId === assetId))

  await page.goto(design(base, second.id))
  await spec.getByText(second.brief, { exact: true }).waitFor()
  assert.equal(await page.getByText('Leave room for a low gallery on the Aster ring.').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await conversation.waitFor()
  assert.ok(await page.getByRole('main').evaluate((main) => main.scrollWidth <= main.clientWidth))
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  if (captures) await page.screenshot({ path: join(captures, 'design-mobile-dark.png') })
  console.log(
    'PASS project notes, client brief and specification, protected rebuild, selected visual handoff, and narrow dark layout.',
  )
  const blank = await rpc(base, 'pieces.create', {
    title: 'Manual spec project',
    brief: 'Low-set design for daily wear.',
  })
  await page.goto(design(base, blank.id))
  await spec.getByRole('button', { name: 'Start specification' }).click()
  const manual = spec.getByRole('form', { name: 'Start specification' })
  assert.equal(await manual.getByLabel('Alloy').inputValue(), '')
  assert.equal(await manual.getByLabel('Finish').inputValue(), '')
  assert.ok(await manual.getByRole('button', { name: 'Save specification' }).isDisabled())
  await manual.getByLabel('Construction').selectOption('solitaire')
  await manual.getByLabel('Alloy').selectOption('pt950')
  await manual.getByLabel('Finish').selectOption('matte')
  await manual
    .getByLabel('Other constraints')
    .fill('Keep the gallery below the visual shoulder line.')
  await manual.getByRole('button', { name: 'Save specification' }).click()
  await spec.getByText('Confirm the ring size.').waitFor()
  await spec.getByText('Decide which stones and settings to use.').waitFor()
  const saved = await rpc(base, 'pieces.get', { id: blank.id })
  assert.equal(saved.spec.metal.alloy, 'pt950')
  assert.equal(saved.spec.metal.finish, 'matte')
  assert.equal(saved.spec.ring, undefined)
  assert.equal(saved.design.order.length, 0)
  console.log(
    'PASS manual spec can save confirmed constraints and leave dimensions and stones open.',
  )
  if (assistantBase) {
    const a = await rpc(assistantBase, 'pieces.create', { title: 'Assistant project A' })
    const b = await rpc(assistantBase, 'pieces.create', { title: 'Assistant project B' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    const messages: {
      text: string
      context: { pieceId?: string; brainstorm?: boolean }
      attachments?: string[]
      job?: { stage: string }
    }[] = []
    page.on('request', (r) => {
      if (r.url().endsWith('/api/rpc/threads.send')) messages.push(r.postDataJSON())
    })
    await page.goto(design(assistantBase, a.id))
    const firstPrompt = 'Could we explore a sculptural low-profile setting?'
    await conversation.getByLabel('Message about this design').fill(firstPrompt)
    await conversation.getByRole('button', { name: 'Send design message' }).click()
    const log = conversation.getByRole('log', { name: 'Conversation' })
    await log.getByText(firstPrompt, { exact: true }).waitFor()
    await log.getByText('A low bezel would make the silhouette quieter.').waitFor()
    assert.deepEqual(messages[0]?.context.pieceId, a.id)
    assert.equal(messages[0]?.context.brainstorm, true)
    assert.equal(messages[0]?.job, undefined)

    await page.goto(design(assistantBase, b.id))
    const secondPrompt = 'What would make this pendant feel more playful?'
    await conversation.getByLabel('Message about this design').fill(secondPrompt)
    await conversation.getByRole('button', { name: 'Send design message' }).click()
    await log.getByText(secondPrompt, { exact: true }).waitFor()
    assert.equal(await log.getByText(firstPrompt, { exact: true }).count(), 0)
    assert.equal(messages[1]?.context.pieceId, b.id)
    await page.goto(design(assistantBase, a.id))
    await log.getByText(firstPrompt, { exact: true }).waitFor()
    assert.equal(await log.getByText(secondPrompt, { exact: true }).count(), 0)
    assert.equal((await rpc(assistantBase, 'pieces.get', { id: a.id })).version, a.version)
    if (captures) await page.screenshot({ path: join(captures, 'design-conversation.png') })

    const referenceAssetId = await addImage(assistantBase, a.id)
    await page.reload()
    await page.getByRole('button', { name: 'Select Gallery shape study', exact: true }).click()
    await page
      .getByRole('region', { name: 'Selected item', exact: true })
      .getByRole('button', {
        name: 'Build CAD from this image',
        exact: true,
      })
      .click()
    await page.waitForURL(`**/pieces/${a.id}/design`)
    const handoff = messages.find((request) => request.job?.stage === 'cad')
    assert.ok(handoff)
    assert.equal(handoff.context.pieceId, a.id)
    assert.deepEqual(handoff.attachments, [referenceAssetId])
    assert.equal(handoff.context.brainstorm, undefined)
    console.log(
      'PASS open-ended assistant transcript and isolated, explicit selected-image CAD handoff.',
    )
  }
} finally {
  await browser.close()
}
