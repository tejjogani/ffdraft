// Run against a disposable Studio. Check a jeweler's Inspector edits through the same API used by project AI.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'

const base = process.argv[2]
if (!base) throw new Error('Pass a disposable local server URL.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser = await (process.env.PAVE_TEST_BROWSER === 'webkit' ? webkit : chromium).launch()

try {
  const page = await browser.newPage({
    viewport: { width: 1530, height: 940 },
    reducedMotion: 'reduce',
  })
  async function rpc<N extends CommandName>(
    name: N,
    data: CommandInput<N>,
  ): Promise<CommandOutput<N>> {
    const reply = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(reply.ok(), `${name}: ${await reply.text()}`)
    return reply.json()
  }

  const { id: pieceId, version } = await rpc('pieces.create', {
    templateId: 'wedding-band',
    title: 'Stone displacement proof',
  })
  const nodeId = 'row'
  await rpc('design.apply', {
    pieceId,
    baseVersion: version,
    label: 'Add a shoulder row',
    ops: [
      {
        t: 'add',
        node: {
          id: nodeId,
          kind: 'gemRow',
          name: 'Shoulder row',
          host: 'band',
          coverage: 50,
          stoneWidth: 1.3,
          skipCenter: 0,
        },
      },
    ],
  })
  const placements = () => rpc('design.stoneInstances', { pieceId, nodeId })
  async function waitForPlacement(number: number, x: number) {
    const deadline = Date.now() + 20_000
    let result = await placements()
    while (result.stones[number - 1]?.offsetMm[0] !== x && Date.now() < deadline) {
      await delay(100)
      result = await placements()
    }
    assert.equal(result.stones[number - 1]?.offsetMm[0], x, `Stone ${number} X displacement`)
    return result
  }

  const tree = page.getByRole('tree', { name: 'Features' })
  const shoulder = tree.locator('[data-node=row]')
  const selected = tree.getByRole('treeitem', { name: 'Stone 2 of Shoulder row', exact: true })
  async function selectSecondStone() {
    const show = page.getByRole('button', { name: /^(Show Features|Features)$/ })
    await shoulder.or(show).first().waitFor()
    if (!(await shoulder.isVisible())) await show.click()
    await shoulder.waitFor()
    if (!(await selected.isVisible())) {
      await shoulder.press('ArrowRight')
      await tree.getByRole('treeitem', { name: /^Stones, / }).press('ArrowRight')
    }
    await selected.click()
    const inspector = page.getByRole('button', { name: 'Inspector', exact: true })
    if (await inspector.isVisible()) await inspector.click()
  }
  const axis = (name: string) =>
    page.getByRole('spinbutton', { name: `Stone displacement ${name} in millimetres` })
  await page.goto(`${base}/pieces/${pieceId}/design`)
  await selectSecondStone()
  const before = await placements()
  assert.ok(before.stoneCount > 2)
  await axis('X').fill('0.125')
  await axis('Y').fill('-0.04')
  await axis('Z').fill('0.085')
  await page.getByRole('button', { name: 'Apply displacement' }).click()
  const after = await waitForPlacement(2, 0.125)
  assert.deepEqual(after.stones[1]!.offsetMm, [0.125, -0.04, 0.085])
  const neighbors = (result: typeof before) => result.stones.filter((stone) => stone.number !== 2)
  assert.deepEqual(neighbors(after), neighbors(before))

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual((await waitForPlacement(2, 0)).stones, before.stones)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.deepEqual((await waitForPlacement(2, 0.125)).stones, after.stones)
  await page.reload()
  await selectSecondStone()
  assert.deepEqual(await Promise.all(['X', 'Y', 'Z'].map((name) => axis(name).inputValue())), [
    '0.125',
    '-0.04',
    '0.085',
  ])
  await page.getByRole('button', { name: 'Reset position' }).click()
  assert.deepEqual((await waitForPlacement(2, 0)).stones, before.stones)
  console.log(
    'Moved one stone in XYZ, checked every neighbor, and verified Undo, Redo, reload and reset.',
  )
} finally {
  await browser.close()
}
