// Runs against a disposable local server.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1490, height: 960 } })
  const rpc = async (name: string, data: object) => {
    const res = await page.request.post(base + '/api/rpc/' + name, { data })
    assert.ok(res.ok(), name + ': ' + res.status())
    return res.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Curve controls', kind: 'other' })
  const points = [
    [1, 0, 0, 1],
    [1, 1, 0, Math.SQRT1_2],
    [0, 1, 0, 1],
  ]
  await rpc('design.apply', {
    pieceId: id,
    label: 'Create measured arc',
    ops: [
      {
        t: 'add',
        node: {
          id: 'arc',
          kind: 'nurbsCurve',
          name: 'Gallery rail',
          degree: 2,
          knots: [0, 0, 1, 1],
          controlPoints: points,
        },
      },
    ],
  })
  const waitY = async (value: number) =>
    await page.waitForFunction(
      async ({ id, value }) => {
        const body = await (
          await fetch('/api/rpc/pieces.get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
        ).json()
        return body.design.nodes.arc.controlPoints[1][1] === value
      },
      { id, value },
    )
  const open = async () => {
    await page.getByRole('treeitem', { name: /Gallery rail/ }).click()
    await page.getByRole('button', { name: 'Edit control points', exact: true }).click()
    return page.getByRole('dialog', { name: 'Edit control points' })
  }
  await page.goto(base + '/pieces/' + id + '/design')
  await page.locator('[data-construction-curve]').first().waitFor({ state: 'attached' })
  const dialog = await open()
  await dialog.locator('circle[aria-label="Control point 2"]').click()
  const y = dialog.getByRole('textbox', { name: 'Control point Y', exact: true })
  await y.fill('1.25')
  await y.press('Tab')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal((await rpc('pieces.get', { id })).version, 1)
  await open()
  await dialog.locator('circle[aria-label="Control point 2"]').click()
  await y.fill('1.25')
  await y.press('Tab')
  await dialog.getByRole('button', { name: 'Save points' }).click()
  await waitY(1.25)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await waitY(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await waitY(1.25)
  await page.reload()
  await open()
  const n = await rpc('design.describe', { pieceId: id, nodeId: 'arc' })
  assert.deepEqual(n.values.controlPoints, [points[0], [1, 1.25, 0, Math.SQRT1_2], points[2]])
  assert.deepEqual(n.values.knots, [0, 0, 1, 1])
  console.log(
    'Saved a weighted NURBS point selected in the editor, verified cancel, undo/redo, reopen and unchanged knots and weight.',
  )
} finally {
  await browser.close()
}
