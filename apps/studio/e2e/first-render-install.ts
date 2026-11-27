// Run against a fresh local server with no supported Blender installation.
// A single click downloads the real pinned release into that server's data directory.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import type { RenderInstallStatus, RenderJob } from '@pave/schema'

const [base, file] = process.argv.slice(2)
assert.ok(base && file, 'Pass the disposable local URL and output PNG path.')
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const response = await page.request.post(base + '/api/rpc/' + name, {
      data,
      headers: { origin: base, 'sec-fetch-site': 'same-origin' },
    })
    assert.ok(response.ok(), name + ' ' + (await response.text()))
    return response.json()
  }
  const { id } = await rpc<{ id: string }>('pieces.create', {
    templateId: 'solitaire',
    title: 'First render installation proof',
  })
  await rpc('scenes.create', {
    pieceId: id,
    title: 'Catalog',
    scene: { look: 'catalog-white', output: { width: 768, height: 768, quality: 'standard' } },
  })
  await page.goto(base + '/pieces/' + id + '/render')
  await page
    .getByText('Blender installs with your first render', { exact: true })
    .first()
    .waitFor({ timeout: 60_000 })
  assert.equal((await rpc<RenderInstallStatus>('renders.installStatus', {})).phase, 'idle')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await page.getByText('Downloading Blender', { exact: false }).first().waitFor({ timeout: 90_000 })
  let lastPhase = ''
  const phases = new Set<string>()
  const deadline = Date.now() + 18 * 60_000
  while (Date.now() < deadline) {
    const state = await rpc<RenderInstallStatus>('renders.installStatus', {})
    phases.add(state.phase)
    if (state.phase !== lastPhase) {
      console.log(state.phase, state.downloadedBytes, state.totalBytes)
      lastPhase = state.phase
    }
    assert.ok(state.phase !== 'failed' && state.phase !== 'cancelled', state.reason ?? state.phase)
    const takes = await rpc<RenderJob[]>('renders.list', { pieceId: id })
    assert.equal(takes.length, 1)
    const job = takes[0]!
    assert.equal(job.engine, 'blender')
    assert.ok(job.status !== 'failed', job.error ?? 'Render failed')
    if (job.status === 'done') {
      assert.ok(phases.has('downloading') && phases.has('ready'))
      const result = await page.request.get(base + '/api/assets/' + job.assetIds[0])
      assert.ok(result.ok())
      const bytes = await result.body()
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(bytes.readUInt32BE(16), 768)
      await writeFile(file, bytes)
      console.log('Single Render click produced', job.id, job.device, job.seconds + 's', file)
      break
    }
    await setTimeout(600)
  }
  assert.ok(
    lastPhase === 'ready' &&
      (await rpc<RenderJob[]>('renders.list', { pieceId: id }))[0]?.status === 'done',
    'First render timed out',
  )
} finally {
  await browser.close()
}
