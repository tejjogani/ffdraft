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
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { RenderMetrics } from '../assess'
import type { ResolvedScene } from '../types'

/** `PAVE_RENDER_WORKER_DIR` relocates the worker when this package is bundled or installed. */
export const WORKER_DIR = resolve(
  process.env.PAVE_RENDER_WORKER_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '../../../../workers/render'),
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
  scriptArgs: (script, args) => [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '-P',
    script,
    '--',
    ...args,
  ],
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

/** How long a process gets to exit after SIGTERM before it is killed outright. */
const KILL_GRACE_MS = 5_000

/**
 * Every Blender process this module started and has not seen exit. When this process ends —
 * normally, on SIGINT or SIGTERM — they are killed too, so no render outlives the app that
 * asked for it. (A hard kill of this process cannot run handlers: the worker then exits when
 * its stdin pipe closes, see pave_render.py.)
 */
const children = new Set<ChildProcess>()

function killChildren(): void {
  for (const child of children) child.kill('SIGKILL')
  children.clear()
}

/** Kills the children, then lets the signal do what it would have done without this handler. */
function onSignal(signal: NodeJS.Signals): void {
  killChildren()
  untrack()
  process.kill(process.pid, signal)
}

function track(child: ChildProcess): void {
  if (children.size === 0) {
    process.on('exit', killChildren)
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  }
  children.add(child)
}

function untrack(child?: ChildProcess): void {
  if (child) children.delete(child)
  if (children.size > 0) return
  process.off('exit', killChildren)
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
}

/**
 * Variables a render process may see. Blender, its add-ons and the scripts it runs get what they
 * need to find tools, temp space, a GPU and colour config, never the server's secrets (the
 * Claude and image-provider keys and the auth secret that apps/server/.env loads into the
 * environment). Names are compared upper-cased: Windows treats them without case.
 */
const CHILD_ENV = [
  /^PAVE_CYCLES_DEVICE$/,
  /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|TMPDIR|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|USER|USERNAME|LOGNAME|SHELL|LANG|LANGUAGE|TZ|DISPLAY|WAYLAND_DISPLAY|LD_LIBRARY_PATH|OCIO)$/,
  /^(LC|XDG|PAVE_RENDER|BLENDER|CYCLES|CUDA|NVIDIA|HIP|ROCR|HSA|OPTIX|ONEAPI|SYCL|DYLD|__NV)_/,
]

export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env))
    if (v !== undefined && CHILD_ENV.some((re) => re.test(k.toUpperCase()))) out[k] = v
  return out
}

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; timeoutMs: number; onLine?: (line: string) => void },
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    // Never start a process for a job that is already cancelled.
    if (opts.signal?.aborted) {
      reject(new Error('Blender render aborted'))
      return
    }
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      // stdin stays open for the worker's lifetime: it exits when the pipe closes (we died).
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...childEnv(), PAVE_RENDER_STDIN_WATCH: '1' },
    })
    track(child)
    let stdout = ''
    let stderr = ''
    let killedFor: string | null = null
    let escalate: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(escalate)
      opts.signal?.removeEventListener('abort', onAbort)
      untrack(child)
      settle()
    }
    const kill = (why: string) => {
      if (killedFor) return
      killedFor = why
      child.kill('SIGTERM')
      // A process that ignores SIGTERM (Blender mid-render can) is killed outright.
      escalate = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
    }
    const timer = setTimeout(
      () => kill(`timed out after ${Math.round(opts.timeoutMs / 1000)} s`),
      opts.timeoutMs,
    )
    const onAbort = () => kill('aborted')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdin?.on('error', () => {}) // the worker may exit before reading; that is fine
    createInterface({ input: child.stdout! }).on('line', (line) => {
      stdout = `${stdout}${line}\n`.slice(-TAIL)
      opts.onLine?.(line)
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-TAIL)
    })
    child.on('error', (err) => finish(() => reject(err)))
    // A killed process settles on 'exit': 'close' also waits for its pipes, which a grandchild
    // (an encoder) can hold open.
    child.on('exit', () => {
      if (killedFor) finish(() => reject(new Error(`Blender render ${killedFor}`)))
    })
    child.on('close', (code) => finish(() => resolvePromise({ code, stdout, stderr })))
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
export async function detectBlender(
  options: RuntimeOptions = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BlenderCapability> {
  const runtime = resolveRuntime(options)
  const base = { runtime: runtime.kind, command: runtime.command }
  if (
    runtime.kind === 'bpy' &&
    !existsSync(runtime.command) &&
    runtime.command === venvPython(options.platform)
  )
    return {
      ...base,
      available: false,
      reason: 'Render worker not set up: run `pnpm --filter @pave/render setup:blender`.',
    }
  const args =
    runtime.kind === 'bpy'
      ? ['-c', 'import bpy; print("PAVE_BLENDER_VERSION", bpy.app.version_string)']
      : [
          '-b',
          '--factory-startup',
          '--python-expr',
          'import bpy; print("PAVE_BLENDER_VERSION", bpy.app.version_string)',
        ]
  try {
    const { code, stdout, stderr } = await run(runtime.command, args, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 120_000,
    })
    const version = /PAVE_BLENDER_VERSION (\S+)/.exec(stdout)?.[1]
    if (code === 0 && version) return { ...base, available: true, version }
    return {
      ...base,
      available: false,
      reason: (stderr || stdout).trim().split('\n').slice(-3).join('\n'),
    }
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
  /** Auto follows the host's Cycles configuration. An explicit CPU request applies to this job. */
  device?: 'auto' | 'cpu'
  glb: Uint8Array
  outDir: string
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  /** Default: 2 hours. */
  timeoutMs?: number
}

/**
 * The worker's `{"progress": 0.42}` lines. Blender and its add-ons write to the same stdout, so
 * a line that only looks like one is skipped: throwing here would be an uncaught exception in
 * the stream handler, not a failed render.
 */
function progressOf(line: string): number | null {
  if (!line.startsWith('{"progress"')) return null
  try {
    const value = (JSON.parse(line) as { progress?: unknown }).progress
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export async function renderWithBlender(
  options: RenderWithBlenderOptions,
): Promise<BlenderRenderResult> {
  options.signal?.throwIfAborted()
  const runtime = resolveRuntime(options)
  const outDir = resolve(options.outDir)
  await mkdir(outDir, { recursive: true })
  const glbPath = join(outDir, 'piece.glb')
  const jobPath = join(outDir, 'job.json')
  await writeFile(glbPath, options.glb)
  await writeFile(
    jobPath,
    JSON.stringify({
      scene: options.resolved,
      glb: glbPath,
      outDir,
      ...(options.device === 'cpu' && { device: 'cpu' }),
    }),
  )
  // Cancelled while the job files were written: do not start Blender for it.
  options.signal?.throwIfAborted()

  const { code, stdout, stderr } = await run(
    runtime.command,
    runtime.scriptArgs(RUNNER, [jobPath]),
    {
      cwd: outDir,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 2 * 60 * 60 * 1000,
      onLine: (line) => {
        const value = progressOf(line)
        if (value !== null) options.onProgress?.(value)
      },
    },
  )
  if (code !== 0) {
    const tail = (stderr.trim() || stdout.trim()).split('\n').slice(-12).join('\n')
    throw new Error(`Blender render failed (exit ${code}):\n${tail}`)
  }
  return JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8')) as BlenderRenderResult
}
