import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderSceneSchema } from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { writeGlb } from '../../../kernel/src/export/glb'
import { solitaireRing } from '../../fixtures'
import { assessRender } from '../assess'
import { resolveScene } from '../resolve'
import { detectBlender, renderWithBlender, resolveRuntime, venvPython, WORKER_DIR } from './index'

describe('resolveRuntime', () => {
  it('finds the venv interpreter per platform', () => {
    expect(venvPython('win32')).toBe(join(WORKER_DIR, '.venv', 'Scripts', 'python.exe'))
    expect(venvPython('darwin')).toBe(join(WORKER_DIR, '.venv', 'bin', 'python'))
    expect(resolveRuntime({ env: {}, platform: 'linux' }).command).toBe(venvPython('linux'))
  })

  it('prefers options, then PAVE_PYTHON, then PAVE_BLENDER', () => {
    const env = { PAVE_PYTHON: '/opt/py', PAVE_BLENDER: '/opt/blender' }
    expect(resolveRuntime({ env, pythonPath: '/x/python' }).command).toBe('/x/python')
    expect(resolveRuntime({ env }).kind).toBe('bpy')
    const blender = resolveRuntime({ env: { PAVE_BLENDER: '/opt/blender' } })
    expect(blender.kind).toBe('blender')
    expect(blender.scriptArgs('run.py', ['job.json'])).toEqual([
      '-b',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '-P',
      'run.py',
      '--',
      'job.json',
    ])
  })
})

// The real pipeline: fixture → GLB → resolved job → Blender → PNG + metrics. Skipped where the
// worker is not set up (`pnpm --filter @pave/render setup:blender`).
const capability = await detectBlender()
const dirs: string[] = []
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))))

describe.skipIf(!capability.available)('renderWithBlender', () => {
  it('renders a still and measures it', async () => {
    const evaluation = solitaireRing()
    const scene = RenderSceneSchema.parse({
      look: 'catalog-white',
      output: { quality: 'preview', width: 256, height: 256 },
    })
    const resolved = resolveScene(scene, evaluation)
    const outDir = await mkdtemp(join(tmpdir(), 'pave-render-'))
    dirs.push(outDir)
    const progress: number[] = []
    const result = await renderWithBlender({
      resolved,
      glb: writeGlb(evaluation),
      outDir,
      onProgress: (p) => progress.push(p),
    })

    const png = await readFile(result.files.image!)
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
    expect(progress.at(-1)).toBe(1)
    expect(result.metrics.width).toBe(256)
    expect(result.metrics.subjectBox).not.toBeNull()
    expect(assessRender(result.metrics, scene).filter((i) => i.severity === 'error')).toEqual([])
  }, 300_000)

  it('rejects when aborted', async () => {
    const evaluation = solitaireRing()
    const resolved = resolveScene(
      RenderSceneSchema.parse({ output: { quality: 'preview', width: 256, height: 256 } }),
      evaluation,
    )
    const outDir = await mkdtemp(join(tmpdir(), 'pave-render-'))
    dirs.push(outDir)
    const controller = new AbortController()
    const job = renderWithBlender({
      resolved,
      glb: writeGlb(evaluation),
      outDir,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 500)
    await expect(job).rejects.toThrow(/aborted/)
  }, 60_000)
})
