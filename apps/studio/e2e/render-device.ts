// Run against a disposable local Studio with Blender configured.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { RenderJob, SavedScene } from '@pave/schema'

const base = process.argv[2]
assert.ok(base, 'Pass the URL of a disposable Studio with Blender configured.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const until = async <T>(read: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const result = await read()
      if (result !== undefined) return result
      await page.waitForTimeout(250)
    }
    throw new Error('The saved render setting or take did not settle.')
  }
  const piece = await rpc<{ id: string; version: number }>('pieces.create', {
    templateId: 'solitaire',
    title: 'Shot render device check',
  })
  const [shot, other] = await Promise.all(
    ['Hero', 'Front'].map((title) =>
      rpc<SavedScene>('scenes.create', {
        pieceId: piece.id,
        title,
        scene: { output: { width: 320, height: 320, quality: 'preview' } },
      }),
    ),
  )
  const shots = () => rpc<SavedScene[]>('scenes.list', { pieceId: piece.id })
  const savedDevice = async () =>
    (await shots()).find(({ id }) => id === shot!.id)?.scene.output.device
  const path = `${base}/pieces/${piece.id}/render?shot=${shot!.id}`
  const output = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Output', exact: true }) })
  const device = output.getByRole('group', { name: 'Render device' })
  const automatic = device.getByRole('button', { name: 'Automatic', exact: true })
  const cpu = device.getByRole('button', { name: 'CPU', exact: true })
  await page.goto(path)
  await automatic.waitFor({ timeout: 10_000 })
  assert.equal(await automatic.getAttribute('aria-pressed'), 'true')
  await cpu.click()
  await until(async () => (await savedDevice()) === 'cpu' || undefined)
  await page.reload()
  await cpu.waitFor()
  assert.equal(await cpu.getAttribute('aria-pressed'), 'true')
  await automatic.click()
  await until(async () => (await savedDevice()) === 'auto' || undefined)

  const canceled = await rpc<RenderJob>('renders.create', {
    pieceId: piece.id,
    sceneId: shot!.id,
    engine: 'blender',
  })
  await rpc('renders.cancel', { id: canceled.id })
  await page.goto(path)
  const actions = page.getByRole('group', { name: 'Render actions' })
  const recovery = actions.getByRole('button', { name: 'Use CPU', exact: true })
  await recovery.waitFor()
  await actions.getByText('Render canceled', { exact: true }).waitFor()
  const box = await recovery.boundingBox()
  assert.ok(
    box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844,
  )
  await recovery.click()
  await actions.getByText(/CPU selected/).waitFor()
  await actions.getByRole('button', { name: 'Render', exact: true }).click()
  const done = await until(async () => {
    const takes = await rpc<RenderJob[]>('renders.list', { pieceId: piece.id })
    const take = takes.find(({ id }) => id !== canceled.id)
    assert.notEqual(take?.status, 'failed', take?.error ?? undefined)
    return take?.status === 'done' ? take : undefined
  }, 120_000)
  assert.equal(done.sceneId, shot!.id)
  assert.equal(done.scene.output.device, 'cpu')
  assert.equal(done.device, 'CPU')
  assert.equal(await savedDevice(), 'cpu')
  assert.equal((await shots()).find(({ id }) => id === other!.id)?.scene.output.device, undefined)
  assert.equal(
    (await rpc<{ version: number }>('pieces.get', { id: piece.id })).version,
    piece.version,
  )
  console.log(
    'Saved CPU preference on the active shot and completed a real CPU take from the compact toolbar.',
  )
} finally {
  await browser.close()
}
