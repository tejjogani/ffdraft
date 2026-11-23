/**
 * @pave/render/node — runs the Blender worker (workers/render/pave_render.py) as a child process.
 *
 * Runtime resolution, in order (one helper shared by detection and rendering):
 *   1. an explicit `pythonPath` / `blenderPath` option;
 *   2. `PAVE_PYTHON` — a Python with the bpy module;
 *   3. `PAVE_BLENDER` — a Blender 5.3 executable, for platforms without a bpy wheel;
 *   4. the worker's venv: `.venv/bin/python` (POSIX) or `.venv\Scripts\python.exe` (Windows),
 *      created by `pnpm --filter @pave/render setup:blender`.
 * Processes are spawned without a shell, with argument arrays only.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { RenderMetrics } from '../assess'
import type { ResolvedScene } from '../types'

/** `PAVE_RENDER_WORKER_DIR` relocates the worker when this package is bundled or installed. */
export const WORKER_DIR = resolve(
  process.env.PAVE_RENDER_WORKER_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../../../../workers/render'),
)
const RUNNER = join(WORKER_DIR, 'pave_render.py')

export interface RuntimeOptions {
  pythonPath?: string
  blenderPath?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export interface BlenderRuntime {
  kind: 'bpy' | 'blender'
  command: string
  /** Arguments that run a Python script with trailing arguments. */
  scriptArgs(script: string, args: string[]): string[]
}

export function venvPython(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(WORKER_DIR, '.venv', 'Scripts', 'python.exe')
    : join(WORKER_DIR, '.venv', 'bin', 'python')
}

const bpy = (command: string): BlenderRuntime => ({
  kind: 'bpy',
  command,
  scriptArgs: (script, args) => [script, ...args],
})

const blender = (command: string): BlenderRuntime => ({
  kind: 'blender',
  command,
  // --python-exit-code makes an uncaught Python error fail the process instead of exiting 0.
  scriptArgs: (script, args) => ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', ...args],
})

export function resolveRuntime(options: RuntimeOptions = {}): BlenderRuntime {
  const env = options.env ?? process.env
  if (options.pythonPath) return bpy(options.pythonPath)
  if (options.blenderPath) return blender(options.blenderPath)
  if (env.PAVE_PYTHON) return bpy(env.PAVE_PYTHON)
  if (env.PAVE_BLENDER) return blender(env.PAVE_BLENDER)
  return bpy(venvPython(options.platform))
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

const TAIL = 16_000

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; timeoutMs: number; onLine?: (line: string) => void },
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let killedFor: string | null = null
    const kill = (why: string) => {
      killedFor = why
      child.kill()
    }
    const timer = setTimeout(() => kill(`timed out after ${Math.round(opts.timeoutMs / 1000)} s`), opts.timeoutMs)
    const onAbort = () => kill('aborted')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    createInterface({ input: child.stdout }).on('line', (line) => {
      stdout = (stdout + line + '\n').slice(-TAIL)
      opts.onLine?.(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-TAIL)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (killedFor) reject(new Error(`Blender render ${killedFor}`))
      else resolvePromise({ code, stdout, stderr })
    })
  })
}

export interface BlenderCapability {
  available: boolean
  runtime: BlenderRuntime['kind']
  command: string
  /** Blender version string, e.g. "5.3.0". */
  version?: string
  reason?: string
}

/** Whether renders can run here; the server reports this as a capability. */
export async function detectBlender(options: RuntimeOptions = {}): Promise<BlenderCapability> {
  const runtime = resolveRuntime(options)
  const base = { runtime: runtime.kind, command: runtime.command }
  if (runtime.kind === 'bpy' && !existsSync(runtime.command) && runtime.command === venvPython(options.platform))
    return { ...base, available: false, reason: 'Render worker not set up: run `pnpm --filter @pave/render setup:blender`.' }
  const args =
    runtime.kind === 'bpy'
      ? ['-c', 'import bpy; print("PAVE_BLENDER_VERSION", bpy.app.version_string)']
      : ['-b', '--factory-startup', '--python-expr', 'import bpy; print("PAVE_BLENDER_VERSION", bpy.app.version_string)']
  try {
    const { code, stdout, stderr } = await run(runtime.command, args, { timeoutMs: 120_000 })
    const version = /PAVE_BLENDER_VERSION (\S+)/.exec(stdout)?.[1]
    if (code === 0 && version) return { ...base, available: true, version }
    return { ...base, available: false, reason: (stderr || stdout).trim().split('\n').slice(-3).join('\n') }
  } catch (err) {
    return { ...base, available: false, reason: (err as Error).message }
  }
}

export interface BlenderRenderFiles {
  /** Still: the composited render. */
  image?: string
  /** Animation: composited frames, and the encoded video when an encoder was available. */
  frames?: string[]
  video?: string | null
  /** Subject matte (alpha). */
  mask: string
}

export interface BlenderRenderResult {
  files: BlenderRenderFiles
  metrics: RenderMetrics
  /** Cycles device used: CPU, OPTIX, CUDA, HIP, ONEAPI or METAL. */
  device: string
  seconds: number
}

export interface RenderWithBlenderOptions extends Omit<RuntimeOptions, 'env' | 'platform'> {
  resolved: ResolvedScene
  glb: Uint8Array
  outDir: string
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  /** Default: 2 hours. */
  timeoutMs?: number
}

export async function renderWithBlender(options: RenderWithBlenderOptions): Promise<BlenderRenderResult> {
  const runtime = resolveRuntime(options)
  const outDir = resolve(options.outDir)
  await mkdir(outDir, { recursive: true })
  const glbPath = join(outDir, 'piece.glb')
  const jobPath = join(outDir, 'job.json')
  await writeFile(glbPath, options.glb)
  await writeFile(jobPath, JSON.stringify({ scene: options.resolved, glb: glbPath, outDir }))

  const { code, stdout, stderr } = await run(runtime.command, runtime.scriptArgs(RUNNER, [jobPath]), {
    cwd: outDir,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 2 * 60 * 60 * 1000,
    onLine: (line) => {
      if (!line.startsWith('{"progress"')) return
      const value = (JSON.parse(line) as { progress: number }).progress
      options.onProgress?.(value)
    },
  })
  if (code !== 0) {
    const tail = (stderr.trim() || stdout.trim()).split('\n').slice(-12).join('\n')
    throw new Error(`Blender render failed (exit ${code}):\n${tail}`)
  }
  return JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8')) as BlenderRenderResult
}
