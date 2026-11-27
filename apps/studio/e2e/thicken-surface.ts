// Run against a disposable Studio with pnpm exec tsx apps/studio/e2e/thicken-surface.ts <base>.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { CommandInput, CommandOutput } from '@pave/schema'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  async function rpc<K extends 'pieces.create' | 'pieces.get' | 'design.apply' | 'design.evaluate'>(
    name: K,
    data: CommandInput<K>,
  ): Promise<CommandOutput<K>> {
    const res = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(res.ok(), `${name}: ${res.status()} ${await res.text()}`)
    return res.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Surface thickness test', kind: 'other' })
  await rpc('design.apply', {
    pieceId: id,
    baseVersion: 0,
    label: 'Build loft surface for thickening',
    ops: [
      ...[0, 10].map((z) => ({
        t: 'add' as const,
        node: {
          id: `section-${z}`,
          kind: 'nurbsCurve' as const,
          degree: 1,
          knots: [0, 1],
          controlPoints: [
            [0, 0, z, 1],
            [5, 0, z, 1],
          ] as [number, number, number, number][],
        },
      })),
      {
        t: 'add',
        node: {
          id: 'sheet',
          kind: 'loft',
          name: 'Test surface',
          sections: ['section-0', 'section-10'],
          capped: false,
        },
      },
    ],
  })
  const untilThickness = async (mm: number, version: number) => {
    await page.waitForFunction(
      async ({ id, mm, version }) => {
        const res = await fetch('/api/rpc/pieces.get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        const piece = await res.json()
        return (
          piece.version >= version &&
          Object.values(piece.design.nodes).some((node) => {
            const n = node as { kind: string; surface?: string; thickness?: number }
            return n.kind === 'thickenSurface' && n.surface === 'sheet' && n.thickness === mm
          })
        )
      },
      { id, mm, version },
    )
  }
  const volume = async () => {
    const facts = await rpc('design.evaluate', { pieceId: id, detail: 'production' })
    assert.deepEqual(
      facts.diagnostics.filter((d) => d.level === 'error'),
      [],
    )
    assert.equal(facts.metals.length, 1)
    return facts.metals[0]!.volumeMm3
  }
  await page.goto(`${base}/pieces/${id}/design`)
  await page.getByRole('treeitem', { name: /Test surface/ }).click()
  await page.getByRole('button', { name: 'Add feature' }).click()
  await page.getByRole('menuitem', { name: 'Thicken surface' }).click()
  await untilThickness(1, 2)
  assert.ok(Math.abs((await volume()) - 50) < 0.01)

  const field = page.getByRole('textbox', { name: 'Thickness', exact: true })
  await field.fill('1.6')
  await field.press('Tab')
  await untilThickness(1.6, 3)
  assert.ok(Math.abs((await volume()) - 80) < 0.01)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await untilThickness(1, 4)
  assert.ok(Math.abs((await volume()) - 50) < 0.01)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await untilThickness(1.6, 5)
  await page.reload()
  await page.getByRole('treeitem', { name: /Thicken surface/ }).click()
  assert.equal(Number(await field.inputValue()), 1.6)
  assert.ok(Math.abs((await volume()) - 80) < 0.01)
  console.log(
    'Thicken surface created, edited, undone, redone and reloaded in Chromium at 50 and 80 mm³.',
  )
} finally {
  await browser.close()
}
