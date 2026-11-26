// Use a disposable Studio. Exercise destructive actions only on projects created by this walk.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [base, widthArg = '834'] = process.argv.slice(2)
const width = Number(widthArg)
if (!base) throw Error('Pass a disposable server URL')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width, height: width < 500 ? 844 : 1112 },
    hasTouch: true,
    isMobile: true,
  })
  const create = async (title: string) => {
    const response = await page.request.post(`${base}/api/rpc/pieces.create`, { data: { title } })
    assert.ok(response.ok())
    return (await response.json()).id as string
  }
  const suffix = crypto.randomUUID().slice(0, 6)
  const titles = ['Gallery', 'Table', 'Detail', 'Palette'].map(
    (where) => `${where} test project ${suffix}`,
  )
  const ids = await Promise.all(titles.map(create))
  const projectHeading = page.getByRole('heading', { name: 'Projects', exact: true })
  const options = page.getByRole('button', { name: 'Piece options' })
  const openPalette = async (on = page) => {
    const mod = await on.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
    await on.keyboard.press(`${mod}+k`)
    await on.getByRole('combobox').filter({ visible: true }).fill('Delete project')
  }
  const hasFocus = (selector: string) =>
    page.waitForFunction((s) => document.activeElement?.matches(s), selector)
  const assertTouchTarget = async (item: ReturnType<typeof page.getByRole>) => {
    const dimensions = await item.evaluate((node) => ({
      width: (node as HTMLElement).offsetWidth,
      height: (node as HTMLElement).offsetHeight,
    }))
    assert.ok(
      dimensions.width >= 44 && dimensions.height >= 44,
      `Small target: ${JSON.stringify(dimensions)}`,
    )
  }

  for (const [index, title] of titles.entries()) {
    const detail = index >= 2
    const path = detail ? `/pieces/${ids[index]}` : index === 1 ? '/pieces?view=table' : '/pieces'
    await page.goto(base + path)
    const confirm = page.getByRole('dialog', { name: `Delete “${title}”?` })
    const cancel = confirm.getByRole('button', { name: 'Cancel', exact: true })
    const submit = confirm.getByRole('button', { name: 'Delete project', exact: true })
    await page.waitForFunction(() => matchMedia('(any-pointer:coarse)').matches)
    if (detail) {
      await options.focus()
      if (index === 2) {
        await assertTouchTarget(options)
        await options.press('Enter')
        const menuItem = page.getByRole('menuitem', { name: 'Delete project' })
        await assertTouchTarget(menuItem)
        await menuItem.press('Enter')
      } else {
        await openPalette()
        const command = page.getByRole('option', { name: 'Delete project', exact: true })
        await assertTouchTarget(command)
        await command.press('Enter')
      }
      await hasFocus('[role="dialog"] button')
      assert.equal(await cancel.evaluate((el) => el === document.activeElement), true)
      await cancel.press('Escape')
      await hasFocus('[aria-label="Piece options"]')
      await options.click()
      await page.getByRole('menuitem', { name: 'Delete project' }).click()
    } else {
      await projectHeading.waitFor()
      assert.match(await projectHeading.evaluate((h) => getComputedStyle(h).fontFamily), /Inter/)
      const trash = page.getByRole('button', { name: `Delete project ${title}`, exact: true })
      await assertTouchTarget(trash)
      const link = page.locator(`main a[href="/pieces/${ids[index]}"]`)
      await link.focus()
      await page.keyboard.press('Tab')
      assert.equal(await trash.evaluate((el) => el === document.activeElement), true)
      await trash.press('Enter')
      await hasFocus('[role="dialog"] button')
      assert.equal(await cancel.evaluate((el) => el === document.activeElement), true)
      await cancel.press('Enter')
      await hasFocus(`[aria-label="Delete project ${title}"]`)
      assert.equal(new URL(page.url()).pathname, '/pieces')
      await trash.press('Enter')
    }
    await assertTouchTarget(cancel)
    await assertTouchTarget(submit)
    await submit.focus()
    await page.keyboard.press('Enter')
    await confirm.waitFor({ state: 'detached' })
    await page.waitForURL((url) => url.pathname === '/pieces')
    await hasFocus('main h1')
    const list = await page.request.post(`${base}/api/rpc/pieces.list`, { data: {} })
    const remaining = (await list.json()) as { id: string }[]
    assert.equal(
      remaining.some((p) => p.id === ids[index]),
      false,
    )
    for (const untouched of ids.slice(index + 1))
      assert.ok(remaining.some((p) => p.id === untouched))
  }

  const protectedTitle = `Protected test project ${suffix}`
  const protectedId = await create(protectedTitle)
  const viewer = await browser.newPage({ viewport: { width: 834, height: 1112 } })
  await viewer.route('**/api/rpc/session.get', async (route) => {
    const response = await route.fetch()
    const session = await response.json()
    await route.fulfill({
      response,
      json: {
        ...session,
        orgs: session.orgs.map((org: { id: string }) => ({ ...org, role: 'viewer' })),
      },
    })
  })
  for (const variant of ['/pieces', '/pieces?view=table']) {
    await viewer.goto(base + variant)
    await viewer.getByRole('link', { name: new RegExp(protectedTitle) }).waitFor()
    assert.equal(
      await viewer.getByRole('button', { name: `Delete project ${protectedTitle}` }).count(),
      0,
    )
  }
  await viewer.goto(`${base}/pieces/${protectedId}`)
  await viewer.getByRole('button', { name: 'Piece options' }).click()
  await viewer.getByRole('menuitem', { name: 'Duplicate' }).waitFor()
  assert.equal(await viewer.getByRole('menuitem', { name: 'Delete project' }).count(), 0)
  await viewer.keyboard.press('Escape')
  await openPalette(viewer)
  assert.equal(await viewer.getByRole('option', { name: 'Delete project', exact: true }).count(), 0)
  console.log(
    `Passed ${width}px touch targets, keyboard focus, viewer visibility, and scoped project deletion.`,
  )
} finally {
  await browser.close()
}
