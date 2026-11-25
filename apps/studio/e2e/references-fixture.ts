// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Prepares an offline fixture for the reference-panel run: the recorded museum answers
 * (apps/server/src/references/fixtures/museums.json) with a picture file for every thumbnail and
 * image address they name (the studio's template covers stand in, since the museums cannot be
 * reached here), plus a front-view drawing of a solitaire to scale an image plane against.
 *
 *   tsx apps/studio/e2e/references-fixture.ts <outDir>
 *   → <outDir>/recording.json  (PAVE_SEARCH_FIXTURES)   <outDir>/ring-front.png
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { aic } from '../../server/src/references/aic'
import { cleveland } from '../../server/src/references/cleveland'
import { recordedIO } from '../../server/src/references/io'
import { met } from '../../server/src/references/met'

const sharp = createRequire(new URL('../../server/package.json', import.meta.url))('sharp')
const [OUT] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const root = new URL('../../server/src/references/fixtures/museums.json', import.meta.url)
const museums = JSON.parse(await (await import('node:fs/promises')).readFile(root, 'utf8'))
const io = recordedIO(museums)
const covers = new URL('../src/features/cad/empty/covers/', import.meta.url).pathname
const coverFiles = readdirSync(covers)
  .filter((f) => f.endsWith('.webp'))
  .sort()

const images: Record<string, string> = {}
let n = 0
for (const p of [met, aic, cleveland]) {
  for (const openOnly of [false, true]) {
    const results = await p.search({ query: 'ring', openOnly, page: 1, limit: 12 }, io)
    for (const r of results) {
      for (const url of [r.thumbUrl, r.imageUrl]) {
        if (images[url]) continue
        const file = `pic-${n}.jpg`
        const cover = coverFiles[n % coverFiles.length]
        await sharp(join(covers, cover))
          .resize(url === r.imageUrl ? 800 : 400)
          .flatten({ background: '#f4f1ea' })
          .jpeg({ quality: 88 })
          .toFile(join(OUT, file))
        images[url] = file
        n++
      }
    }
  }
}
writeFileSync(join(OUT, 'recording.json'), JSON.stringify({ json: museums.json, images }, null, 2))

// A front view of a solitaire: the band's inside is 330 px across (US 6, 16.5 mm), so a
// 6.5 mm (1 ct) stone is 130 px wide. The run scales the plane by clicking the band's inner edges.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9cf86"/><stop offset="0.5" stop-color="#c49a3a"/><stop offset="1" stop-color="#8c6a22"/>
    </linearGradient>
    <linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c6d6"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="#fbfaf7"/>
  <path fill="url(#g)" fill-rule="evenodd" stroke="#6b5018" stroke-width="2"
    d="M400 260 a210 210 0 1 0 0.01 0 Z M400 305 a165 165 0 1 1 -0.01 0 Z"/>
  <path d="M352 268 L360 196 L372 196 L366 268 Z M448 268 L440 196 L428 196 L434 268 Z" fill="url(#g)" stroke="#6b5018" stroke-width="2"/>
  <path d="M335 200 L465 200 L440 176 L360 176 Z" fill="url(#d)" stroke="#5b6b80" stroke-width="2"/>
  <path d="M335 200 L465 200 L400 262 Z" fill="url(#d)" stroke="#5b6b80" stroke-width="2"/>
  <text x="400" y="760" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#8a857a">front view · inside Ø 16.5 mm</text>
</svg>`
await sharp(Buffer.from(svg)).png().toFile(join(OUT, 'ring-front.png'))
console.log(`fixture: ${n} pictures, recording.json and ring-front.png in ${OUT}`)
