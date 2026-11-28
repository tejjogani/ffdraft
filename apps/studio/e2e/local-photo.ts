// Run against a disposable local Studio. Fixture assets stand in for rendered takes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Asset, Piece, RenderJob } from '@pave/schema'
import { decodePng } from '../../../packages/kernel/src/mesh/image/png'

const url = process.argv[2]
assert.ok(url, 'Pass a disposable local server URL.')
const base = new URL(url)
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser = await (process.env.PAVE_TEST_BROWSER === 'webkit' ? webkit : chromium).launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.addInitScript(() => {
    // Exercise the browser download path without opening the OS save dialog in headless Chrome.
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  const rpc = async <T>(name: string, data: object) => {
    const res = await page.request.post(new URL(`/api/rpc/${name}`, base).href, { data })
    assert.ok(res.ok(), `${name}: ${await res.text()}`)
    return (await res.json()) as T
  }
  const sample = Date.now().toString(36)
  const a = await rpc<Piece>('pieces.create', {
    title: `Photo A ${sample}`,
    templateId: 'wedding-band',
  })
  const b = await rpc<Piece>('pieces.create', { title: `Photo B ${sample}`, kind: 'bracelet' })

  const fixture = async (role: 'photo' | 'take' | 'opaque', mime = 'image/png') => {
    const dataUrl = await page.evaluate(
      ({ role, mime }) => {
        const canvas = document.createElement('canvas')
        canvas.width = role === 'photo' ? 1800 : 256
        canvas.height = role === 'photo' ? 1200 : 256
        const ctx = canvas.getContext('2d')!
        if (role !== 'take') {
          ctx.fillStyle = '#103050'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        if (role !== 'photo') {
          ctx.fillStyle = '#f02010'
          ctx.fillRect(20, 20, 120, 60)
        }
        return canvas.toDataURL(mime)
      },
      { role, mime },
    )
    return Buffer.from(dataUrl.split(',')[1]!, 'base64')
  }

  const prepareTake = async (
    piece: Piece,
    title: string,
    bytes: Buffer,
    background: 'transparent' | 'white' = 'transparent',
  ) => {
    const file = {
      name: `${title}.png`,
      mimeType: 'image/png',
      buffer: bytes,
    }
    const upload = await page.request.post(new URL('/api/assets', base).href, {
      multipart: { file },
    })
    assert.ok(upload.ok(), await upload.text())
    const asset = (await upload.json()) as Asset
    const render = await rpc<RenderJob>('renders.create', {
      pieceId: piece.id,
      title,
      engine: 'browser',
      scene: {
        environment: { background },
        ground: 'none',
        output: { width: 256, height: 256, quality: 'final' },
      },
    })
    return rpc<RenderJob>('renders.complete', { id: render.id, assetIds: [asset.id] })
  }

  const jpeg = await fixture('photo', 'image/jpeg')
  const photo = await fixture('photo')
  const cutout = await fixture('take')
  const take = await prepareTake(a, 'Cutout', cutout)
  const opaque = await prepareTake(a, 'Invalid cutout', await fixture('opaque'))
  const nonTransparent = await prepareTake(a, 'White backdrop', cutout, 'white')
  const otherProject = await prepareTake(b, 'Other project cutout', cutout)
  const requests: string[] = []
  page.on('request', (request) => {
    const target = new URL(request.url())
    if (
      ['http:', 'https:'].includes(target.protocol) &&
      (target.origin !== base.origin ||
        target.pathname === '/api/assets' ||
        target.pathname.startsWith('/api/rpc/shots.create'))
    ) {
      requests.push(request.url())
    }
  })

  await page.goto(new URL(`/pieces/${a.id}/on-model`, base).href)
  const layout = page.getByRole('region', { name: 'Photo layout' })
  const takeSelect = layout.getByLabel('Transparent CAD take')
  const file = layout.getByLabel('Your photo')
  const preview = layout.getByLabel('Photo layout preview')
  const save = layout.getByRole('button', { name: 'Download PNG' })
  await takeSelect.locator(`option[value="${take.id}"]`).waitFor({ state: 'attached' })
  assert.equal(await takeSelect.locator(`option[value="${otherProject.id}"]`).count(), 0)
  assert.equal(await takeSelect.locator(`option[value="${nonTransparent.id}"]`).count(), 0)
  await takeSelect.selectOption(opaque.id)
  await layout
    .getByRole('alert')
    .getByText(/transparent pixels/)
    .waitFor()
  assert.equal(await save.isEnabled(), false)

  await takeSelect.selectOption(take.id)
  await file.setInputFiles({
    name: 'oversized.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([photo.subarray(0, 16), Buffer.from([0, 0, 64, 0]), photo.subarray(20)]),
  })
  await layout
    .getByRole('alert')
    .getByText(/16 megapixels/)
    .waitFor()
  await file.setInputFiles({
    name: 'photo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  })
  await layout
    .getByRole('alert')
    .getByText(/JPEG or PNG/)
    .waitFor()
  await file.setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg })
  await preview.waitFor()
  await layout.getByText(/1800 × 1200 px/).waitFor()
  assert.equal(await preview.getAttribute('width'), '720')
  await file.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo })
  await preview.waitFor()
  const x = layout.getByLabel('Horizontal position')
  const y = layout.getByLabel('Vertical position')
  const size = layout.getByLabel('Jewelry size')
  const angle = layout.getByLabel('Rotation')
  await angle.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await angle.inputValue(), '1')
  const box = await preview.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 4 })
  await page.mouse.up()
  assert.equal(Math.round(Number(await x.inputValue())), 65)
  assert.equal(Math.round(Number(await y.inputValue())), 55)

  await x.fill('40')
  await y.fill('60')
  await size.fill('25')
  await angle.fill('90')
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
  assert.match(download.suggestedFilename(), /on-model\.png$/)
  const output = decodePng(await readFile((await download.path())!))
  assert.deepEqual([output.width, output.height], [1800, 1200])
  const pixel = (x: number, y: number) =>
    Array.from(output.rgba.subarray((y * 1800 + x) * 4, (y * 1800 + x) * 4 + 4), (v) =>
      Math.round(v * 255),
    )
  assert.deepEqual(pixel(720, 720), [240, 32, 16, 255])
  assert.deepEqual(pixel(720, 590), [240, 32, 16, 255])
  assert.deepEqual(pixel(640, 720), [16, 48, 80, 255])
  assert.deepEqual(pixel(0, 0), [16, 48, 80, 255])

  let unexpectedDownload = false
  page.on('download', () => {
    unexpectedDownload = true
  })
  await page.route(
    '**/api/rpc/renders.get',
    async (route) => {
      // Advance the real CAD between clicking Download and the final source check.
      await rpc('design.apply', {
        pieceId: a.id,
        label: 'Change the band thickness',
        ops: [{ t: 'update', id: 'band', patch: { thicknessTop: 2.1 } }],
      })
      const response = await route.fetch()
      assert.equal(((await response.json()) as RenderJob).stale, true)
      await route.fulfill({ response })
    },
    { times: 1 },
  )
  const [validation] = await Promise.all([
    page.waitForResponse('**/api/rpc/renders.get'),
    save.click(),
  ])
  assert.ok(validation.ok())
  await layout.getByText('No finished transparent stills for the current CAD.').waitFor()
  assert.equal(await save.isEnabled(), false)
  assert.equal(unexpectedDownload, false)

  const switchTo = async (piece: Piece) => {
    await page.getByRole('button', { name: 'Switch project' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill(piece.title)
    await page.getByRole('dialog').getByRole('link', { name: piece.title }).first().click()
    await page.waitForURL(`**/pieces/${piece.id}/on-model`)
  }
  await switchTo(b)
  await takeSelect.locator(`option[value="${otherProject.id}"]`).waitFor({ state: 'attached' })
  assert.equal(await takeSelect.locator(`option[value="${take.id}"]`).count(), 0)
  await takeSelect.selectOption(otherProject.id)
  assert.equal(await file.inputValue(), '')
  assert.equal(await preview.count(), 0)
  assert.equal(await save.isEnabled(), false)

  await switchTo(a)
  await layout.getByText('No finished transparent stills for the current CAD.').waitFor()
  assert.equal(await takeSelect.locator(`option[value="${take.id}"]`).count(), 0)
  assert.equal(await takeSelect.inputValue(), '')
  assert.equal(await file.inputValue(), '')
  assert.deepEqual(requests, [])
  console.log(
    'PASS transparent take validation, drag and keyboard placement, full-size PNG, private file, stale export rejection, and project switching.',
  )
} finally {
  await browser.close()
}
