// Run against a disposable local server with the built Studio and Playwright.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import type { EvaluationSummary, NodeInput, Piece } from '@pave/schema'

const base = process.argv[2]
assert.ok(base, 'Pass the URL of a disposable local server.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(30_000)
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const result = await page.request.post(base + '/api/rpc/' + name, { data })
    assert.ok(result.ok(), name + ' ' + (await result.text()))
    return result.json()
  }
  const section = (id: string, planeOffset: number): NodeInput => ({
    id,
    kind: 'curve',
    name: id,
    plane: 'top',
    closed: true,
    planeOffset,
    points: [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ].map(([u, v], i) => ({ id: String(i), u: u!, v: v! })),
  })
  const curves: NodeInput[] = [
    section('Base profile', 0),
    section('Rim profile', 10),
    {
      id: 'inner',
      kind: 'nurbsCurve',
      name: 'Inner rail',
      degree: 1,
      knots: [0, 1],
      controlPoints: [
        [0, 0, 0, 1],
        [0, 0, 10, 1],
      ],
    },
    {
      id: 'outer',
      kind: 'nurbsCurve',
      name: 'Outer rail',
      degree: 2,
      knots: [0, 0, 1, 1],
      controlPoints: [
        [4, 0, 0, 1],
        [9, 0, 3, 1],
        [4, 0, 10, 1],
      ],
    },
  ]
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  for (const [title, inputs] of [
    [
      'Loft',
      [
        ['Section 1', 'Base profile'],
        ['Section 2', 'Rim profile'],
      ],
    ],
    [
      'Sweep 1 rail',
      [
        ['Rail 1', 'Inner rail'],
        ['Section 1', 'Base profile'],
      ],
    ],
    [
      'Sweep 2 rails',
      [
        ['Rail 1', 'Inner rail'],
        ['Rail 2', 'Outer rail'],
        ['Section 1', 'Base profile'],
      ],
    ],
  ] as const) {
    const { id } = await rpc<Piece>('pieces.create', {
      kind: 'other',
      title: title + ' browser proof',
    })
    await rpc('design.apply', {
      pieceId: id,
      label: 'Draw measured curves',
      ops: curves.map((node) => ({ t: 'add', node })),
    })
    await page.goto(base + '/pieces/' + id + '/design')
    await button('Add feature').click()
    await page.getByRole('menuitem', { name: title, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: title })
    for (const [field, option] of inputs) {
      const control = dialog.getByRole('combobox', { name: field, exact: true })
      await control.click()
      // The previous picker can still render its closing animation when this one opens.
      const listId = await control
        .and(page.locator('[aria-expanded="true"][aria-controls]'))
        .getAttribute('aria-controls')
      assert.ok(listId, `${field} must identify its open list`)
      await page
        .getByRole('listbox')
        .and(page.locator(`[id=${JSON.stringify(listId)}]`))
        .getByRole('option', { name: new RegExp(`^${option}(?: |$)`) })
        .click()
      assert.equal(await control.textContent(), option)
    }
    await dialog.getByRole('button', { name: 'Create feature' }).click()
    await dialog.waitFor({ state: 'hidden' })
    const deadline = Date.now() + 30_000
    let piece = await rpc<Piece>('pieces.get', { id })
    while (piece.version < 2 && Date.now() < deadline) {
      await setTimeout(100)
      piece = await rpc<Piece>('pieces.get', { id })
    }
    assert.equal(piece.version, 2)
    const output = Object.values(piece.design.nodes).find(
      (n) => n.kind === 'loft' || n.kind === 'railSweep',
    )
    assert.ok(output)
    const facts = await rpc<EvaluationSummary>('design.evaluate', {
      pieceId: id,
      detail: 'production',
    })
    assert.deepEqual(
      facts.diagnostics.filter((d) => d.level === 'error'),
      [],
    )
    assert.ok(Math.abs(facts.boundsMm.z - 10) < 0.01)
    const volume = facts.metals[0]!.volumeMm3
    if (title === 'Sweep 2 rails') assert.ok(volume > 95)
    else assert.ok(Math.abs(volume - 80) < 0.01)
    await page.reload()
    await page.locator('[data-node="' + output.id + '"]').click()
    await button(title === 'Loft' ? 'Edit loft' : 'Edit sweep').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    console.log(title, id, volume.toFixed(3) + ' mm³')
  }
} finally {
  await browser.close()
}
