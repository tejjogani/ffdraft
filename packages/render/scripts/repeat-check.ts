/**
 * Renders one resolved scene twice with Blender and compares the pixels, to measure whether a
 * take is reproducible on this machine. The second run can use another Cycles thread count
 * (PAVE_RENDER_THREADS) to see whether that matters too.
 *
 *   pnpm --filter @pave/render repeat-check <outDir> [size] [quality] [threads1] [threads2]
 */
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RenderSceneSchema } from '@pave/schema'
import { writeGlb } from '../../kernel/src/export/glb'
import { solitaireRing } from '../fixtures'
import { resolveScene } from '../src'
import { renderWithBlender } from '../src/node'

const [outArg = 'repeat-check', sizeArg = '384', quality = 'preview', ...threads] =
  process.argv.slice(2)
const out = resolve(outArg)
const size = Number(sizeArg)
await mkdir(out, { recursive: true })
const evaluation = solitaireRing()
const scene = RenderSceneSchema.parse({
  look: 'studio-soft',
  output: { quality, width: size, height: size },
})
const resolved = resolveScene(scene, evaluation)
const glb = writeGlb(evaluation)
const shots: Buffer[] = []
for (const run of [0, 1]) {
  const t = threads[run]
  if (t) process.env.PAVE_RENDER_THREADS = t
  else delete process.env.PAVE_RENDER_THREADS
  const r = await renderWithBlender({ resolved, glb, outDir: join(out, `run-${run + 1}`) })
  console.log(`run ${run + 1}: ${r.seconds} s on ${r.device}, threads ${t ?? 'auto'}`)
  shots.push(await readFile(r.files.image!))
}
console.log(shots[0]!.equals(shots[1]!) ? 'identical PNG bytes' : 'PNG bytes differ')
