// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Renders the template picker's covers: each template is created as a piece, opened in the
 * Design tab and photographed from its default view through the live viewport (transparent
 * background, so the picker's stage gradient shows behind it in either theme). Run it after a
 * template changes:
 *
 *   PAVE_DATA_DIR=$(mktemp -d) tsx apps/studio/e2e/cad-server.ts   # terminal 1
 *   pnpm --filter @pave/studio dev                                  # terminal 2
 *   tsx apps/studio/e2e/template-covers.ts                          # terminal 3
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { TEMPLATES } from '@pave/schema'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:8787'
const OUT = new URL('../src/features/cad/empty/covers/', import.meta.url)
const SIZE = 320

const rpc = async (name, input) => {
  const r = await fetch(`${API}/api/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.json()
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() =>
  localStorage.setItem(
    'pave:cad',
    JSON.stringify({ state: { display: 'rendered', displayChosen: true }, version: 0 }),
  ),
)
for (const t of TEMPLATES) {
  const piece = await rpc('pieces.create', { templateId: t.id, title: `Cover: ${t.spec.title}` })
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.waitForFunction(() => window.paveViewer?.evaluation, null, { timeout: 300_000 })
  await page.waitForTimeout(1500)
  const data = await page.evaluate(async (size) => {
    const v = window.paveViewer
    const ring = v.evaluation.report.ringInnerDiameter !== undefined
    const [png] = await v.capture({ views: [ring ? 'hero' : 'front'], mode: 'rendered', size })
    const img = await createImageBitmap(png)
    const canvas = new OffscreenCanvas(size, size)
    canvas.getContext('2d').drawImage(img, 0, 0)
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    return [...new Uint8Array(await webp.arrayBuffer())]
  }, SIZE)
  writeFileSync(new URL(`${t.id}.webp`, OUT), Uint8Array.from(data))
  console.log('cover', t.id, data.length, 'bytes')
}
await browser.close()
