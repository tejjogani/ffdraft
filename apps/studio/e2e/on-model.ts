// Run against a disposable local server without an on-model provider.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable server URL')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const sample = Date.now().toString(36)
  const modelName = `Editorial sample ${sample}`
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name} ${await response.text()}`)
    return response.json()
  }
  const a = await rpc('pieces.create', { title: `Shoot A ${sample}`, kind: 'bracelet' })
  const b = await rpc('pieces.create', { title: `Shoot B ${sample}`, kind: 'ring' })
  await page.goto(`${base}/pieces/${a.id}/on-model`)
  await page.getByRole('heading', { name: 'On-model studio' }).waitFor()
  const casting = page.getByRole('region', { name: 'Brand model' })
  const setup = page.getByRole('region', { name: 'Shot setup' })
  await casting.getByRole('button', { name: 'Create model', exact: true }).click()
  await page.getByLabel('Model name').fill(modelName)
  await page
    .getByLabel('Appearance and styling')
    .fill('Fictional adult with short curls and a white shirt.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save model card' }).click()
  assert.equal(await casting.getByRole('button', { name: 'Use model' }).count(), 0)
  await casting.getByRole('button', { name: 'Approve for shoots' }).click()
  await setup.getByText('No model selected', { exact: true }).waitFor()
  await casting.getByRole('button', { name: 'Use model' }).click()
  await setup.getByText(modelName, { exact: true }).waitFor()
  const imageSettings = setup.getByRole('link', { name: 'Settings › AI' })
  await imageSettings.waitFor()
  assert.equal(await imageSettings.getAttribute('href'), '/settings/ai')
  assert.equal(await setup.getByRole('button', { name: 'Estimate image' }).count(), 0)
  assert.equal(await setup.getByLabel('Worn on').inputValue(), 'wrist')
  await setup.getByLabel('Image ratio').selectOption('3:2')
  await page.getByLabel('Shot direction').fill('Soft daylight at a casting bench.')
  await page.getByRole('button', { name: 'Save shot setup' }).click()
  await page.getByRole('status').getByText('Shot setup saved on this device.').waitFor()
  await page.reload()
  await setup.getByText(modelName, { exact: true }).waitFor()
  assert.equal(await setup.getByLabel('Image ratio').inputValue(), '3:2')
  assert.equal(
    await page.getByLabel('Shot direction').inputValue(),
    'Soft daylight at a casting bench.',
  )
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill(b.title)
  await page.getByRole('dialog').getByRole('link', { name: b.title }).first().click()
  await page.waitForURL(`**/pieces/${b.id}/on-model`)
  await setup.getByText('No model selected', { exact: true }).waitFor()
  assert.equal(await setup.getByLabel('Worn on').inputValue(), 'hand')
  assert.equal(await setup.getByLabel('Image ratio').inputValue(), '4:5')
  assert.equal(await page.getByLabel('Shot direction').inputValue(), '')
  await casting.getByLabel('Model card').selectOption({ label: `${modelName} · Approved` })
  await casting.getByRole('button', { name: 'Use model' }).waitFor()
  await setup.getByText('No model selected', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Generate image' }).count(), 0)
  assert.equal((await rpc('shots.list', { pieceId: a.id })).length, 0)
  console.log(
    'PASS model creation, approval, selection, saved setup, project switch and unavailable imaging.',
  )
} finally {
  await browser.close()
}
