// Use a disposable Studio. Exercise destructive actions only on projects created by this walk.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable server URL')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const create = async (title: string) => {
    const response = await page.request.post(base + '/api/rpc/pieces.create', { data: { title } })
    assert.ok(response.ok())
    return (await response.json()).id as string
  }
  const titles = ['Gallery test project', 'Table test project', 'Detail test project']
  const ids = await Promise.all(titles.map(create))
  for (const [index, title] of titles.entries()) {
    const detail = index === 2
    const path = detail ? '/pieces/' + ids[index] : index === 1 ? '/pieces?view=table' : '/pieces'
    await page.goto(base + path)
    if (detail) {
      await page.getByRole('button', { name: 'Piece options' }).click()
      await page.getByRole('menuitem', { name: 'Delete project' }).click()
    } else {
      const heading = page.getByRole('heading', { name: 'Projects', exact: true })
      await heading.waitFor()
      assert.match(await heading.evaluate((h) => getComputedStyle(h).fontFamily), /Inter/)
      const trash = page.getByRole('button', { name: 'Delete project ' + title, exact: true })
      await trash.click()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(new URL(page.url()).pathname, '/pieces')
      await trash.click()
    }
    const confirm = page.getByRole('dialog', { name: 'Delete “' + title + '”?' })
    await confirm.getByRole('button', { name: 'Delete project', exact: true }).click()
    await confirm.waitFor({ state: 'detached' })
    await page.waitForURL((url) => url.pathname === '/pieces')
    const list = await page.request.post(base + '/api/rpc/pieces.list', { data: {} })
    const remaining = (await list.json()) as { id: string }[]
    assert.equal(
      remaining.some((p) => p.id === ids[index]),
      false,
    )
    for (const untouched of ids.slice(index + 1))
      assert.ok(remaining.some((p) => p.id === untouched))
  }
  console.log('Passed library title, gallery and table cancel/delete, and scoped project deletion.')
} finally {
  await browser.close()
}
