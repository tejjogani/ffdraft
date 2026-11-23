/**
 * Renders the fixture ring and pavé bar through the full pipeline (writeGlb → resolveScene →
 * Blender) for visual review of looks and materials.
 *
 *   pnpm --filter @pave/render shots <outDir> [shot …]
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type RenderSceneInput, RenderSceneSchema } from '@pave/schema'
import { writeGlb } from '../../kernel/src/export/glb'
import { paveBar, solitaireRing } from '../fixtures'
import { resolveScene } from '../src'
import { renderWithBlender } from '../src/node'

const preview = { quality: 'preview', width: 768, height: 768 } as const
const SHOTS: Record<
  string,
  { piece: () => ReturnType<typeof solitaireRing>; scene: RenderSceneInput }
> = {
  'studio-soft': { piece: solitaireRing, scene: { look: 'studio-soft', output: preview } },
  'catalog-white': { piece: solitaireRing, scene: { look: 'catalog-white', output: preview } },
  'black-acrylic': {
    piece: () => solitaireRing({ material: 'pt950' }),
    scene: { look: 'black-acrylic', output: preview },
  },
  'editorial-warm': {
    piece: () => solitaireRing({ material: 'au18k-rose' }),
    scene: { look: 'editorial-warm', output: preview },
  },
  'studio-contrast': {
    piece: () => solitaireRing({ material: 'au18k-white', plating: 'rhodium' }),
    scene: { look: 'studio-contrast', output: preview },
  },
  daylight: {
    piece: () => solitaireRing({ stone: 'sapphire-blue' }),
    scene: { look: 'daylight', output: preview },
  },
  macro: {
    piece: solitaireRing,
    scene: {
      look: 'studio-soft',
      camera: { preset: 'macro', focalLength: 100, fStop: 5.6 },
      output: preview,
    },
  },
  pave: {
    piece: paveBar,
    scene: { look: 'studio-soft', camera: { preset: 'front' }, output: preview },
  },
  turntable: {
    piece: solitaireRing,
    scene: {
      look: 'studio-soft',
      animation: { type: 'turntable', seconds: 1, fps: 12 },
      output: { quality: 'preview', width: 512, height: 512 },
    },
  },
}

const [outArg, ...only] = process.argv.slice(2)
if (!outArg) throw new Error('usage: blender-shots.ts <outDir> [shot …]')
const out = resolve(outArg)
await mkdir(out, { recursive: true })
for (const [name, shot] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue
  const evaluation = shot.piece()
  const resolved = resolveScene(RenderSceneSchema.parse(shot.scene), evaluation)
  const started = Date.now()
  const result = await renderWithBlender({
    resolved,
    glb: writeGlb(evaluation),
    outDir: join(out, 'jobs', name),
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (result.files.image) await copyFile(result.files.image, join(out, `${name}.png`))
  if (result.files.frames?.[0])
    await copyFile(result.files.frames[0], join(out, `${name}-frame0.png`))
  if (result.files.video)
    await copyFile(
      result.files.video,
      join(out, `${name}${result.files.video.slice(-5).replace(/^[^.]*/, '')}`),
    )
  console.log(name, `${seconds}s`, result.device, JSON.stringify(result.metrics))
}
