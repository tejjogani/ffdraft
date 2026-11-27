import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderSceneSchema } from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { writeGlb } from '../../../kernel/src/export/glb'
import { decodePng } from '../../../kernel/src/mesh/image/png'
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

  it('keeps the softbox out of the black acrylic floor at a high angle', async () => {
    const evaluation = solitaireRing()
    const scene = RenderSceneSchema.parse({
      look: 'black-acrylic',
      camera: { preset: 'three-quarter' },
      output: { quality: 'preview', width: 256, height: 256 },
    })
    const outDir = await mkdtemp(join(tmpdir(), 'pave-render-acrylic-'))
    dirs.push(outDir)
    const result = await renderWithBlender({
      resolved: resolveScene(scene, evaluation),
      glb: writeGlb(evaluation),
      outDir,
    })
    const image = decodePng(await readFile(result.files.image!))
    // The floor next to the ring should be dark at both heights, without a bright band.
    for (const y of [198, 230])
      for (const x of [196, 205, 214])
        expect(image.rgba[(y * image.width + x) * 4]).toBeLessThan(0.14)
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

// Cancellation against a stand-in worker (a script that ignores SIGTERM and "renders" for ten
// minutes), so it runs without Blender. POSIX only: it relies on a shebang and signals.
describe.skipIf(process.platform === 'win32')('cancelling a render', () => {
  const fake = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pave-render-cancel-'))
    const script = join(dir, 'fake-worker')
    const marker = join(dir, 'started')
    const { writeFile, chmod } = await import('node:fs/promises')
    await writeFile(
      script,
      `#!/usr/bin/env python3\nimport signal, time\nopen(${JSON.stringify(marker)}, 'w').write('1')\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(600)\n`,
    )
    await chmod(script, 0o755)
    return { dir, script, marker }
  }
  const job = (script: string, outDir: string, signal: AbortSignal, timeoutMs?: number) =>
    renderWithBlender({
      resolved: {} as never,
      glb: new Uint8Array(),
      outDir,
      pythonPath: script,
      signal,
      ...(timeoutMs ? { timeoutMs } : {}),
    })
  const exists = (path: string) =>
    readFile(path).then(
      () => true,
      () => false,
    )

  it('never starts a process for a job cancelled before it starts', async () => {
    const { dir, script, marker } = await fake()
    const controller = new AbortController()
    controller.abort()
    await expect(job(script, join(dir, 'out'), controller.signal)).rejects.toThrow(/abort/i)
    await new Promise((r) => setTimeout(r, 300))
    expect(await exists(marker)).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })

  it('kills a process that ignores SIGTERM, on abort and on timeout', async () => {
    for (const how of ['abort', 'timeout'] as const) {
      const { dir, script, marker } = await fake()
      const controller = new AbortController()
      const started = performance.now()
      const running = job(
        script,
        join(dir, 'out'),
        controller.signal,
        how === 'timeout' ? 1000 : undefined,
      )
      for (let i = 0; i < 50 && !(await exists(marker)); i++)
        await new Promise((r) => setTimeout(r, 100))
      if (how === 'abort') controller.abort()
      await expect(running, how).rejects.toThrow(how === 'abort' ? /aborted/ : /timed out/)
      // SIGTERM, then SIGKILL after the grace period: settled well before the 10-minute sleep.
      expect(performance.now() - started, how).toBeLessThan(15_000)
      await rm(dir, { recursive: true, force: true })
    }
  }, 40_000)
})

// What the runner makes of a worker's output and exit, against stand-in workers, so it runs
// without Blender. POSIX only: it relies on a shebang.
describe.skipIf(process.platform === 'win32')('reading a worker', () => {
  const run = async (body: string, onProgress?: (p: number) => void) => {
    const { writeFile, chmod } = await import('node:fs/promises')
    const dir = await mkdtemp(join(tmpdir(), 'pave-render-read-'))
    dirs.push(dir)
    const script = join(dir, 'fake-worker')
    await writeFile(script, `#!/usr/bin/env python3\nimport json, sys\n${body}\n`)
    await chmod(script, 0o755)
    return renderWithBlender({
      resolved: {} as never,
      glb: new Uint8Array(),
      outDir: join(dir, 'out'),
      pythonPath: script,
      ...(onProgress ? { onProgress } : {}),
    })
  }

  it('forwards progress and survives a line that only looks like progress', async () => {
    // Blender and its add-ons print to the same stdout. A garbled line must not throw inside
    // the stream handler: that is an uncaught exception in the server, and it used to drop
    // every progress line after it.
    const seen: number[] = []
    const result = await run(
      [
        `print('{"progress": 0.1}', flush=True)`,
        `print('{"progress": oops', flush=True)`,
        `print('{"progress": "half"}', flush=True)`,
        `print('{"progress": 1}', flush=True)`,
        `open('result.json', 'w').write(json.dumps({'device': 'CPU', 'seconds': 1}))`,
      ].join('\n'),
      (p) => seen.push(p),
    )
    expect(seen).toEqual([0.1, 1])
    expect(result).toMatchObject({ device: 'CPU' })
  })

  it('reports the exit code and the end of stderr when the worker fails', async () => {
    await expect(
      run(`sys.stderr.write('Traceback\\nValueError: no camera\\n')\nsys.exit(3)`),
    ).rejects.toThrow(/Blender render failed \(exit 3\):[\s\S]*ValueError: no camera/)
  })
})
