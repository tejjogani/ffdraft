// Run against a disposable Studio with pnpm exec tsx apps/studio/e2e/revolve.ts <base>.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  const rpc = async (name: string, data: object) => {
    const res = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(res.ok(), name)
    return res.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Bezel revolve test', kind: 'ring' })
  await rpc('design.apply', {
    pieceId: id,
    ops: [
      {
        t: 'add',
        node: {
          kind: 'curve',
          id: 'section',
          name: 'Bezel section',
          closed: true,
          plane: 'front',
          points: [
            [3, 0],
            [5, 0],
            [5, 4],
            [3, 4],
          ].map(([u, v], i) => ({ id: String(i), u, v })),
        },
      },
    ],
    label: 'Draw bezel section',
  })
  const piece = () => rpc('pieces.get', { id })
  const until = async (count: number) => {
    await page.waitForFunction(
      async ({ id, count }) => {
        const res = await fetch('/api/rpc/pieces.get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        return (await res.json()).design.order.length === count
      },
      { id, count },
    )
  }
  await page.goto(`${base}/pieces/${id}/design`)
  const open = async () => {
    await page.getByRole('treeitem', { name: /Bezel section/ }).click()
    await page.getByRole('button', { name: 'Revolve', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Revolve profile' })
  await open()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal((await piece()).version, 1)
  await open()
  const offset = dialog.getByRole('textbox', { name: 'Axis offset' })
  await offset.fill('4')
  await offset.press('Tab')
  const create = dialog.getByRole('button', { name: 'Create solid' })
  assert.ok(await create.isDisabled())
  await offset.fill('1')
  await offset.press('Tab')
  await create.click()
  await until(2)
  const saved = await piece()
  assert.equal(saved.design.nodes[saved.design.order[1]].axisOffset, 1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await until(1)
  assert.deepEqual((await piece()).design.order, ['section'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await until(2)
  await page.reload()
  await page.getByRole('treeitem', { name: /Revolve/ }).click()
  await page.getByText('Axis offset', { exact: true }).first().waitFor()
  assert.deepEqual((await piece()).design, saved.design)
  console.log(
    'Revolve passed cancel, axis validation, creation, reopen and undo through the CAD editor.',
  )
} finally {
  await browser.close()
}
