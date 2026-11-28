// Run against a disposable local Studio. Pass --blender to compare its native takes too.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import type { Piece, RenderJob, SavedScene } from '@pave/schema'
import { decodePng } from '../../../packages/kernel/src/mesh/image/png'

const [url, mode] = process.argv.slice(2)
assert.ok(url, 'Pass the URL of a disposable local Studio.')
const base = new URL(url)
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const engine = process.env.PAVE_TEST_BROWSER === 'webkit' ? webkit : chromium
const browser = await engine.launch(
  engine === webkit ? {} : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
)

function checkCircle(png: Uint8Array, label: string) {
  const { width, height, rgba } = decodePng(png)
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! < 0.5) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  const w = right - left + 1
  const h = bottom - top + 1
  assert.ok(w > 0 && h > 0, `${label}: empty silhouette`)
  assert.ok(Math.abs(w - h) <= 2, `${label}: stretched silhouette ${w}×${h} in ${width}×${height}`)
  // For a circular subject the 66% Top preset fill is measured against the limiting side.
  assert.ok(Math.abs(w / Math.min(width, height) - 0.66) < 0.02, `${label}: framing changed`)
  assert.ok(Math.abs(left + right + 1 - width) <= 4 && Math.abs(top + bottom + 1 - height) <= 4)
  return { width, height, w, h }
}

try {
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } })
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const response = await page.request.post(new URL(`/api/rpc/${name}`, base).href, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const piece = await rpc<Piece>('pieces.create', {
    templateId: 'wedding-band',
    title: 'Browser framing test',
  })
  await rpc('design.apply', {
    pieceId: piece.id,
    label: 'Lay a uniform band flat for a circular Top silhouette',
    ops: [
      {
        t: 'update',
        id: 'band',
        patch: {
          thicknessTop: 1.8,
          thicknessBottom: 1.8,
          transform: { position: [0, 0, 0], rotation: [90, 0, 0], scale: 1 },
        },
      },
    ],
  })
  const before = await rpc<Piece>('pieces.get', { id: piece.id })
  const takes = () => rpc<RenderJob[]>('renders.list', { pieceId: piece.id })
  const imageOf = async (shotId: string, wantedEngine: RenderJob['engine']) => {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const take = (await takes()).find(
        (job) => job.sceneId === shotId && job.engine === wantedEngine,
      )
      if (take?.status === 'done') {
        const result = await page.request.get(new URL(`/api/assets/${take.assetIds[0]}`, base).href)
        assert.ok(result.ok(), `${wantedEngine}: take asset returned ${result.status()}`)
        return result.body()
      }
      assert.ok(
        take?.status !== 'failed' && take?.status !== 'canceled',
        take?.error ?? wantedEngine,
      )
      await setTimeout(250)
    }
    throw new Error(`${wantedEngine} take did not complete.`)
  }
  for (const [width, height] of [
    [640, 420],
    [420, 640],
  ] as const) {
    const shot = await rpc<SavedScene>('scenes.create', {
      pieceId: piece.id,
      title: `Top ${width}×${height}`,
      scene: {
        camera: { preset: 'top' },
        environment: { background: 'transparent' },
        ground: 'none',
        output: {
          width,
          height,
          quality: 'preview',
          ...(mode === '--blender' ? { device: 'cpu' } : {}),
        },
      },
    })
    await page.goto(new URL(`/pieces/${piece.id}/render?shot=${shot.id}`, base).href)
    const canvas = page.getByLabel(`Live preview of the ${shot.title} shot`, { exact: true })
    await canvas.waitFor({ timeout: 30_000 })
    const previewUrl = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL('image/png'))
    const action = page.getByRole('group', { name: 'Render actions' })
    await action.getByRole('button', { name: /^(Browser preview|Render preview)$/ }).click()
    const browserTake = checkCircle(await imageOf(shot.id, 'browser'), `${engine.name()} take`)
    assert.deepEqual([browserTake.width, browserTake.height], [width, height])
    const viewfinder = checkCircle(Buffer.from(previewUrl.split(',')[1]!, 'base64'), 'viewfinder')
    assert.ok(Math.abs(viewfinder.width / viewfinder.height - width / height) < 0.01)
    if (mode === '--blender') {
      await rpc('renders.create', { pieceId: piece.id, sceneId: shot.id, engine: 'blender' })
      const blender = checkCircle(await imageOf(shot.id, 'blender'), 'Blender')
      assert.deepEqual([blender.width, blender.height], [width, height])
      assert.ok(
        Math.abs(browserTake.w - blender.w) <= 2 && Math.abs(browserTake.h - blender.h) <= 2,
      )
      console.log(`Blender ${width}×${height}: ${blender.w}×${blender.h} silhouette`)
    }
    console.log(`${engine.name()} ${width}×${height}: ${browserTake.w}×${browserTake.h} silhouette`)
  }
  assert.equal((await rpc<Piece>('pieces.get', { id: piece.id })).version, before.version)
} finally {
  await browser.close()
}
