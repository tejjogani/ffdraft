#!/usr/bin/env node
/**
 * Creates workers/render/.venv with the pinned bpy on macOS, Windows and Linux.
 *
 *   node workers/render/setup.mjs [--wheel-dir <dir>]
 *
 * bpy 5.3 needs CPython 3.13. The interpreter used to create the venv is, in order:
 * $PAVE_BOOTSTRAP_PYTHON, `py -3.13` (Windows launcher), `python3.13`, `python3`, `python`.
 * `--wheel-dir` (or $BPY_WHEEL_DIR) installs from a pre-downloaded wheel instead of PyPI.
 * Where no bpy wheel exists for the platform, skip this and point PAVE_BLENDER at a Blender
 * 5.3 install instead.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const venv = join(here, '.venv')
const isWindows = process.platform === 'win32'
const venvPython = isWindows ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')

const args = process.argv.slice(2)
const wheelFlag = args.indexOf('--wheel-dir')
const wheelDir = wheelFlag >= 0 ? args[wheelFlag + 1] : process.env.BPY_WHEEL_DIR

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: false })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status ?? r.error})`)
}

function findPython() {
  const candidates = [
    ...(process.env.PAVE_BOOTSTRAP_PYTHON ? [[process.env.PAVE_BOOTSTRAP_PYTHON, []]] : []),
    ...(isWindows ? [['py', ['-3.13']]] : []),
    ['python3.13', []],
    ['python3', []],
    ['python', []],
  ]
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
      encoding: 'utf8',
      shell: false,
    })
    if (r.status === 0 && r.stdout.trim() === '3.13') return [cmd, pre]
  }
  throw new Error('CPython 3.13 not found. Install it or set PAVE_BOOTSTRAP_PYTHON.')
}

if (!existsSync(venvPython)) {
  const [cmd, pre] = findPython()
  run(cmd, [...pre, '-m', 'venv', venv])
}
run(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'])
run(venvPython, [
  '-m',
  'pip',
  'install',
  '--quiet',
  ...(wheelDir ? ['--find-links', wheelDir] : []),
  '-r',
  join(here, 'requirements.txt'),
])
run(venvPython, ['-c', 'import bpy; print("bpy", bpy.app.version_string)'])
