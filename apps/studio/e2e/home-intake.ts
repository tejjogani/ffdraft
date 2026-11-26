// Run against disposable local servers, using scripted:home-intake or with no AI providers.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [base, mode, screenshot] = process.argv.slice(2)
if (!base || !['scripted', 'manual'].includes(mode ?? ''))
  throw new Error('Pass a disposable studio URL and scripted or manual')
const browser = await chromium.launch()
const brief = 'Turn my logo into an iced pendant with a Cuban chain'
const logo =
  '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110"><rect width="150" height="110" fill="#f7f4ed"/><path fill="#1e2920" d="M75 12 133 85H17Zm0 34-17 23h34Z" fill-rule="evenodd"/></svg>'
const visual =
  '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110"><rect width="150" height="110" fill="#f7f4ed"/><ellipse cx="75" cy="62" rx="42" ry="40" fill="none" stroke="#53534d" stroke-width="4"/><path d="M75 37 98 80H52Z" fill="none" stroke="#1e2920" stroke-width="5"/></svg>'

try {
  const page = await browser.newPage({
    viewport: { width: mode === 'manual' ? 390 : 1440, height: 880 },
  })
  async function rpc(name: string, data: unknown) {
    const result = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(result.ok(), `${name} returned ${result.status()}`)
    return result.json()
  }
  const attach = (name: string, bytes: string) =>
    page
      .locator('main input[type=file]')
      .first()
      .setInputFiles({
        name,
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(bytes),
      })
  const noDock = () => page.locator('aside[aria-label=Assistant]').waitFor({ state: 'hidden' })
  const projectId = () => new URL(page.url()).searchParams.get('intake')!
  const board = async (id: string) => {
    const boards = await rpc('boards.list', { pieceId: id })
    assert.equal(boards.length, 1)
    return rpc('boards.get', { id: boards[0].id })
  }

  await page.goto(base)
  await page.getByRole('textbox', { name: 'Describe a piece for the assistant' }).fill(brief)
  await attach('original-logo.svg', logo)
  await page.getByRole('img', { name: 'original-logo.svg' }).waitFor()
  await page.getByRole('button', { name: 'Start design intake' }).click()
  await page.waitForURL((url) => url.searchParams.has('intake'))
  const pieceId = projectId()
  const stored = await rpc('pieces.get', { id: pieceId })
  assert.equal(stored.brief, brief)
  assert.equal(stored.kind, 'pendant')
  assert.deepEqual(stored.design.order, [])
  const original = (await board(pieceId)).references[0]
  assert.equal(original.title, 'original-logo.svg')
  assert.equal(original.assetId, stored.origin.sourceAssetIds[0])
  await noDock()
  await page.reload()

  if (mode === 'scripted') {
    const questions = page.getByRole('region', { name: 'Quick questions' })
    await questions.getByText('What metal colour?').waitFor()
    await questions.getByText('What stone size?').waitFor()
    await questions.getByText('What pendant height?').waitFor()
    assert.equal(await questions.getByText(/what chain|which chain|want a chain/i).count(), 0)
    await questions.getByRole('button', { name: 'Go', exact: true }).click()
    await page.getByText(/continue without a style reference/i).waitFor()
    await page
      .getByRole('textbox', { name: 'Reply to the design assistant' })
      .fill('Continue without a style reference for now.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await page.getByRole('button', { name: 'Raised medallion', exact: true }).click()
    await noDock()
    assert.equal(
      await page.getByRole('button', { name: 'Build in CAD', exact: true }).isDisabled(),
      true,
    )
    await attach('medallion-sketch.svg', visual)
    await page.getByRole('img', { name: 'medallion-sketch.svg' }).waitFor()
    await page.getByRole('button', { name: 'Send reply' }).click()
    await page.waitForURL((url) => url.searchParams.has('visual'))
    const visualId = new URL(page.url()).searchParams.get('visual')
    const beforeHandoff = await board(pieceId)
    const sketch = beforeHandoff.references.find((r: { id: string }) => r.id === visualId)
    assert.equal(sketch.title, 'medallion-sketch.svg')
    const threadId = new URL(page.url()).searchParams.get('thread')
    assert.ok(threadId)
    await noDock()
    if (screenshot) await page.screenshot({ path: screenshot })
    await page.getByRole('button', { name: 'Build in CAD' }).click()
    await page.waitForURL(`**/pieces/${pieceId}/design`)
    const thread = await rpc('threads.get', { id: threadId })
    assert.equal(thread.run.job.stage, 'cad')
    assert.equal(thread.run.pieceId, pieceId)
    const last = thread.messages.filter((m: { runId: string }) => m.runId === thread.run.id)
    assert.equal(
      last[0].content.filter((block: { type: string }) => block.type === 'image').length,
      2,
    )
    const jobContext = JSON.stringify(last)
    for (const fact of [
      sketch.assetId,
      original.assetId,
      sketch.id,
      beforeHandoff.board.id,
      '1.2 mm',
      '32',
      '18k white gold',
      'Cuban chain',
    ]) {
      assert.ok(jobContext.includes(fact), `CAD job context is missing ${fact}`)
    }
    const durable = await rpc('pieces.get', { id: pieceId })
    assert.equal(durable.intake.details.heightMm, 32)
    assert.equal(durable.intake.details.metal, 'au18k-white')
    assert.equal(durable.intake.selection.visualAssetId, sketch.assetId)
    await page.goBack()
    await page.waitForURL((url) => url.searchParams.get('intake') === pieceId)
    await page.getByRole('button', { name: 'Raised medallion', exact: true }).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Raised medallion', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    await noDock()
  } else {
    await page.getByRole('heading', { name: 'Design details' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Chain preference' }).count(), 0)
    await page.getByRole('textbox', { name: 'Metal colour' }).fill('18k white gold')
    await page.getByRole('textbox', { name: 'Stone sizes' }).fill('1.2 mm')
    await page.getByRole('textbox', { name: 'Pendant height' }).fill('32 mm')
    await page.getByRole('textbox', { name: 'Body thickness' }).fill('2.4 mm')
    await page.getByRole('checkbox', { name: 'Continue without a style reference' }).check()
    await page.getByRole('button', { name: 'Show manual concepts' }).click()
    await page.getByRole('button', { name: 'Raised logo', exact: true }).click()
    assert.equal(
      await page.getByRole('button', { name: 'Open in CAD', exact: true }).isDisabled(),
      true,
    )
    await noDock()
    if (screenshot) await page.screenshot({ path: screenshot })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

    const outline =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="white"/><path fill="black" d="M22 12H98L110 38L82 135H38L10 38Z"/></svg>'
    await attach('selected-outline.svg', outline)
    await page.getByRole('img', { name: 'selected-outline.svg' }).waitFor()
    await page.getByRole('button', { name: 'Save to Design board' }).click()
    await page.waitForURL((url) => url.searchParams.has('visual'))
    const durable = await rpc('pieces.get', { id: pieceId })
    assert.equal(durable.spec, null)
    assert.deepEqual(durable.intake.details, {
      heightMm: 32,
      metal: 'au18k-white',
      metalDescription: '18k white gold',
      thicknessMm: 2.4,
      stoneMm: 1.2,
      chain: 'Cuban chain',
    })
    assert.notEqual(durable.intake.selection.visualAssetId, original.assetId)
    await page.getByRole('button', { name: 'Open in CAD', exact: true }).click()
    await page.waitForURL(`**/pieces/${pieceId}/design`)
    await page.goBack()
    await page.waitForURL((url) => url.searchParams.get('intake') === pieceId)

    // A new studio context has only database state. Reopen the same client from Projects.
    const reopened = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await reopened.goto(`${base}/pieces`)
    await reopened.locator(`main a[href="/pieces/${pieceId}"]`).click()
    await reopened
      .getByRole('navigation', { name: 'Project tools' })
      .getByRole('link', { name: /^CAD/ })
      .click()
    await reopened.getByRole('button', { name: 'Trace selected design' }).click()
    const trace = reopened.getByRole('dialog', { name: 'Trace a flat outline' })
    await trace.getByRole('img', { name: 'Traced outline' }).waitFor()
    assert.equal(await trace.getByRole('spinbutton', { name: 'Height (mm)' }).inputValue(), '32')
    assert.equal(
      await trace.getByRole('spinbutton', { name: 'Thickness (mm)' }).inputValue(),
      '2.4',
    )
    assert.equal(await trace.getByRole('combobox', { name: 'Metal' }).inputValue(), 'au18k-white')
    await trace.getByRole('button', { name: 'Add outline to CAD' }).click()
    await trace.waitFor({ state: 'hidden' })
    const evaluated = await rpc('design.evaluate', { pieceId, detail: 'draft' })
    const built = await rpc('pieces.get', { id: pieceId })
    assert.equal(built.brief, brief)
    const body = built.design.nodes[built.design.order[0]]
    assert.equal(body.kind, 'vectorBody')
    assert.equal(body.name, 'selected-outline.svg')
    const sourceTrace = await rpc('match.traceOutline', {
      pieceId,
      referenceId: durable.intake.selection.visualId,
    })
    assert.equal(body.source.d, sourceTrace.path)
    assert.equal(body.material, 'au18k-white')
    assert.equal(body.height, 32)
    assert.equal(body.thickness, 2.4)
    assert.ok(evaluated.metalMassG > 0)
    assert.equal(evaluated.metals[0].material, 'au18k-white')
    assert.ok(
      Object.values(evaluated.boundsMm).some(
        (dimension) => Math.abs(Number(dimension) - 32) < 0.01,
      ),
    )
    await reopened.close()

    await page.getByRole('link', { name: 'New brief' }).click()
    await page
      .getByRole('textbox', { name: 'Describe a piece for the assistant' })
      .fill('Make a pendant from my initials')
    await page.getByRole('button', { name: 'Start design intake' }).click()
    await page.getByRole('textbox', { name: 'Chain preference' }).waitFor()
    assert.notEqual(projectId(), pieceId)
    assert.deepEqual((await board(projectId())).references, [])
    await page.getByRole('link', { name: 'New brief' }).click()
    const count = (await rpc('pieces.list', {})).length
    await page.getByRole('button', { name: 'Brainstorm' }).click()
    await page
      .getByRole('textbox', { name: 'Brainstorm note' })
      .fill('Explore a cutout charm in rose gold.')
    await page.getByRole('button', { name: 'Keep note' }).click()
    await page.getByText('Explore a cutout charm in rose gold.', { exact: true }).waitFor()
    assert.equal((await rpc('pieces.list', {})).length, count)
    await page.reload()
    await page.getByText('Explore a cutout charm in rose gold.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Start a project' }).click()
    assert.equal((await rpc('pieces.list', {})).length, count)
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.waitForURL((url) => url.searchParams.has('intake'))
    assert.equal(
      (await rpc('pieces.get', { id: projectId() })).brief,
      'Explore a cutout charm in rose gold.',
    )
  }
  console.log(`${mode} Home intake passed`)
} finally {
  await browser.close()
}
