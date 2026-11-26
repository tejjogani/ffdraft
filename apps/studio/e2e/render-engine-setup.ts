// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Starts, cancels and retries the real Blender installer in a fresh local Pavé server.
 * This downloads the pinned release and writes to the server's data folder.
 *
 *   pnpm build
 *   PORT=18943 PAVE_DATA_DIR=$(mktemp -d) pnpm start
 *   pnpm exec tsx apps/studio/e2e/render-engine-setup.ts http://127.0.0.1:18943 [screenshotDir]
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [base, screenshots] = process.argv.slice(2)
if (!base) throw new Error('Pass the URL of a fresh, loopback-only Pavé server.')
if (screenshots) await mkdir(screenshots, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const offer = page.getByRole('complementary', { name: 'Render engine setup' })
  const setup = page.getByRole('dialog', { name: 'Render engine' })
  const shot = (name: string) =>
    screenshots ? page.screenshot({ path: join(screenshots, `${name}.png`) }) : null
  const rpc = async (name: string, input: object = {}) => {
    const response = await page.evaluate(
      ({ name, input }) =>
        fetch(`/api/rpc/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }).then(async (res) => ({ status: res.status, json: await res.json() })),
      { name, input },
    )
    assert.equal(response.status, 200, JSON.stringify(response.json))
    return response.json
  }

  await page.goto(base)
  await offer.getByRole('button', { name: 'Set up Blender' }).click()
  await setup.getByRole('heading', { name: /^Install Blender 5\.3\./ }).waitFor()
  await setup.getByText(/Allow Pavé to download \d+ MB/).waitFor()
  assert.equal((await rpc('renders.installStatus')).phase, 'idle')
  assert.equal((await rpc('session.get')).capabilities.blender, false)
  await shot('01-permission')

  await setup.getByRole('button', { name: 'Install render engine' }).click()
  await setup.getByRole('progressbar', { name: 'Blender download' }).waitFor()
  await shot('02-downloading')
  await setup.getByRole('button', { name: 'Cancel installation' }).click()
  await setup.getByText('Installation cancelled.').waitFor()
  assert.equal((await rpc('renders.installStatus')).phase, 'cancelled')
  assert.equal((await rpc('renders.engine')).available, false)
  console.log('Verified explicit permission, download progress and cancellation.')

  await setup.getByRole('button', { name: 'Retry installation' }).click()
  await setup.getByRole('progressbar', { name: 'Blender download' }).waitFor()
  await setup.getByRole('button', { name: 'Close', exact: true }).click()
  await offer.getByRole('button', { name: 'View progress' }).click()
  await setup.getByText('Blender is ready', { exact: true }).waitFor({ timeout: 6 * 60_000 })
  const engine = await rpc('renders.engine')
  assert.equal(engine.available, true)
  assert.match(engine.version, /^5\.3\./)
  assert.match(engine.path, /[/\\]managed[/\\]blender[/\\]/)
  assert.equal((await rpc('session.get')).capabilities.blender, true)
  await shot('03-ready')
  await setup.getByRole('button', { name: 'Done', exact: true }).click()
  await offer.waitFor({ state: 'hidden' })

  const piece = await rpc('pieces.create', {
    templateId: 'solitaire',
    title: 'Blender setup check',
  })
  await page.goto(`${base}/pieces/${piece.id}/render`)
  await page.getByRole('button', { name: /^Blender 5\.3\./ }).click()
  await setup.getByText('Blender is ready', { exact: true }).waitFor()
  console.log(
    `Verified Blender ${engine.version} from the managed folder and reopened setup in Render.`,
  )
} finally {
  await browser.close()
}
