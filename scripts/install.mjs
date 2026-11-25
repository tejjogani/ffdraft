#!/usr/bin/env node
/**
 * Sets Pavé up on this computer, the same way on macOS, Windows and Linux.
 *
 *   node scripts/install.mjs            install, build, and check that it starts
 *   node scripts/install.mjs --render   also install Blender's renderer (about 1 GB, optional)
 *   node scripts/install.mjs --start    start Pavé when the install is done
 *   node scripts/install.mjs --check    change nothing; report what is and is not ready
 *   node scripts/install.mjs --no-smoke skip the start-up check
 *
 * Safe to run again: every step is skipped or repeated without harm. Nothing is installed
 * outside this folder except pnpm (through Node's own corepack), and nothing is deleted.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const flags = new Set(process.argv.slice(2))
const checkOnly = flags.has('--check')
const NODE_MAJOR = 22

const HELP = `Sets Pavé up on this computer.

  node scripts/install.mjs             install, build, and check that it starts
  node scripts/install.mjs --render    also install the photoreal renderer (about 1 GB)
  node scripts/install.mjs --start     start Pavé when the install is done
  node scripts/install.mjs --check     change nothing; report what is and is not ready
  node scripts/install.mjs --no-smoke  skip the start-up check
`

const known = ['--render', '--start', '--check', '--no-smoke', '--help', '-h']
const unknown = [...flags].filter((f) => !known.includes(f))
if (unknown.length > 0 || flags.has('--help') || flags.has('-h')) {
  if (unknown.length > 0) console.error(`Unknown option: ${unknown.join(' ')}\n`)
  console.log(HELP)
  process.exit(unknown.length > 0 ? 2 : 0)
}

const results = []
const note = (ok, label, detail = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}
/** Something worth knowing that is neither ready nor broken (an optional part not set up). */
const info = (label) => console.log(`  --   ${label}`)
const step = (title) => console.log(`\n${title}`)

/** Runs a command in the repository, showing its output. `.cmd` shims on Windows need a shell. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...opts })
  return r.status === 0
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: isWindows })
  return r.status === 0 ? r.stdout.trim() : null
}
function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// ── 1. Node ──────────────────────────────────────────────────────────────────────────────────
step('1. Node.js')
const nodeMajor = Number(process.versions.node.split('.')[0])
note(nodeMajor >= NODE_MAJOR, `Node ${process.versions.node}`, `needs ${NODE_MAJOR} or newer`)
if (nodeMajor < NODE_MAJOR)
  fail(
    `Pavé needs Node ${NODE_MAJOR} or newer. Install it from https://nodejs.org (the LTS installer),\n` +
      'or with a version manager (nvm, fnm, volta), then run this again.',
  )

// ── 2. pnpm ──────────────────────────────────────────────────────────────────────────────────
step('2. pnpm (the package manager)')
const wanted = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
let pnpm = capture('pnpm', ['--version'])
if (!pnpm && !checkOnly) {
  console.log(`  pnpm was not found; turning it on through corepack (${wanted})…`)
  // corepack ships with Node and installs the exact pnpm this repository pins.
  run('corepack', ['enable']) && run('corepack', ['prepare', wanted, '--activate'])
  pnpm = capture('pnpm', ['--version'])
}
note(Boolean(pnpm), pnpm ? `pnpm ${pnpm}` : 'pnpm', pnpm ? '' : 'not found')
if (!pnpm)
  fail(
    'pnpm could not be set up automatically. Install it with:\n\n' +
      `  npm install --global ${wanted.split('+')[0]}\n\n` +
      '(on macOS or Linux you may need to put `sudo` in front), then run this again.',
  )

// ── 3. Dependencies ──────────────────────────────────────────────────────────────────────────
step('3. Dependencies')
if (checkOnly) {
  note(existsSync(join(root, 'node_modules', '.pnpm')), 'dependencies installed')
} else {
  const ok = run('pnpm', ['install', '--frozen-lockfile'])
  note(ok, 'dependencies installed')
  if (!ok)
    fail(
      'Installing dependencies failed. The lines above say why; the usual causes are no\n' +
        'internet connection or a proxy that blocks registry.npmjs.org.',
    )
}

// ── 4. Build the studio ──────────────────────────────────────────────────────────────────────
step('4. The studio (the application you open in the browser)')
const studioIndex = join(root, 'apps', 'studio', 'dist', 'index.html')
if (!checkOnly) {
  const ok = run('pnpm', ['build'])
  if (!ok) fail('Building the studio failed. The lines above say why.')
}
note(existsSync(studioIndex), 'studio built', existsSync(studioIndex) ? '' : 'run without --check')

// ── 5. Settings file ─────────────────────────────────────────────────────────────────────────
step('5. Settings')
const envFile = join(root, 'apps', 'server', '.env')
if (!existsSync(envFile) && !checkOnly) {
  // Every line of the example is a comment or a default, so the copy changes nothing until
  // someone edits it.
  copyFileSync(join(root, 'apps', 'server', '.env.example'), envFile)
  console.log('  created apps/server/.env from the example (every setting is optional)')
}
note(
  true,
  existsSync(envFile) ? 'apps/server/.env present' : 'no apps/server/.env (defaults apply)',
)

/**
 * Where the assistant's key comes from, without ever printing it: the terminal, then
 * apps/server/.env (the server reads them in that order), then a key saved in Settings, AI, which
 * the server notes (yes or no only) in assistant-key.json under its data folder.
 */
function reportKey() {
  const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
  const shellKey = process.env.ANTHROPIC_API_KEY?.trim()
  const fileKey = fileEnv.ANTHROPIC_API_KEY?.trim()
  const key = shellKey || fileKey
  if (key) {
    info(
      shellKey
        ? 'a key is set in this terminal (ANTHROPIC_API_KEY); it wins over apps/server/.env'
        : 'a key is set in apps/server/.env (ANTHROPIC_API_KEY)',
    )
    if (!key.startsWith('sk-ant-'))
      info(
        'it does not look like a Claude API key (those start with sk-ant-); check it was copied whole',
      )
    info('check it against Claude with: pnpm agent:smoke (spends a few dollars)')
    return
  }
  // `pnpm start` runs the server from apps/server, so a relative PAVE_DATA_DIR is resolved there.
  const dataSetting = process.env.PAVE_DATA_DIR || fileEnv.PAVE_DATA_DIR
  const dataDir = dataSetting ? resolve(root, 'apps', 'server', dataSetting) : join(root, '.data')
  const noteFile = join(dataDir, 'assistant-key.json')
  let saved = null
  try {
    saved = JSON.parse(readFileSync(noteFile, 'utf8')).keySavedInApp === true
  } catch {
    // No note yet: Pavé has not run with this data folder since keys could be saved in the app.
  }
  if (saved) info('a key is saved in the app (Settings, AI)')
  else
    info(
      `no key${saved === null ? ' found' : ''}: the assistant is off. Paste one in Settings, AI, or put ANTHROPIC_API_KEY in apps/server/.env (README: "Use the assistant with your Claude API key")`,
    )
}

// ── 6. The assistant's key (optional) ────────────────────────────────────────────────────────
step('6. The assistant (your Claude API key, optional)')
reportKey()

// ── 7. Blender renderer (optional) ───────────────────────────────────────────────────────────
step('7. Photoreal renderer (optional)')
const venvPython = join(
  root,
  'workers',
  'render',
  '.venv',
  ...(isWindows ? ['Scripts', 'python.exe'] : ['bin', 'python']),
)
if (flags.has('--render') && !checkOnly) {
  console.log('  installing Blender as a Python module (needs Python 3.13; about 1 GB)…')
  const ok = run(process.execPath, [join('workers', 'render', 'setup.mjs')], { shell: false })
  note(ok, 'Blender renderer installed')
  if (!ok)
    console.log(
      '  Pavé still works without it. To retry later: node scripts/install.mjs --render\n' +
        '  Or install Blender 5.3 yourself and set PAVE_BLENDER in apps/server/.env.',
    )
} else if (existsSync(venvPython)) {
  note(true, 'Blender renderer installed')
} else {
  console.log('  not installed. Add it any time with: node scripts/install.mjs --render')
}

// ── 8. Does it start? ────────────────────────────────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

/** Starts the server on a spare port with a throwaway data folder, asks it three things, stops it. */
async function smoke() {
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), 'pave-check-'))
  const child = spawn('pnpm', ['--filter', '@pave/server', 'start'], {
    cwd: root,
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), PAVE_DATA_DIR: dataDir, PAVE_AUTH: 'local' },
    // A process group of its own, so the server behind pnpm can be stopped with it.
    detached: !isWindows,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const base = `http://127.0.0.1:${port}`
  try {
    const deadline = Date.now() + 90_000
    let up = false
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        if ((await fetch(`${base}/health`)).ok) {
          up = true
          break
        }
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!up) return { ok: false, detail: `the server did not start:\n${log.slice(-1500)}` }
    const session = await fetch(`${base}/api/rpc/session.get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (!session.ok) return { ok: false, detail: `the API answered ${session.status}` }
    const page = await fetch(base)
    const html = page.ok ? await page.text() : ''
    if (!html.includes('<div id="root"')) return { ok: false, detail: 'the studio page is missing' }
    return { ok: true, detail: '' }
  } finally {
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
    await new Promise((r) => {
      if (child.exitCode !== null) r()
      else {
        child.once('exit', r)
        setTimeout(r, 10_000)
      }
    })
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
}

step('8. Start-up check')
if (flags.has('--no-smoke')) console.log('  skipped (--no-smoke)')
else if (!existsSync(studioIndex))
  note(false, 'starts and serves the studio', 'the studio is not built')
else {
  const r = await smoke()
  note(r.ok, 'starts and serves the studio', r.detail)
}

// ── Summary ──────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
if (failed.length > 0) fail(`Not ready: ${failed.map((f) => f.label).join('; ')}.`)

console.log(`
Pavé is ready.

  Start it:        pnpm start
  Then open:       http://localhost:8787

  Your work is kept in the .data folder here. Back that folder up; delete it to start over.
  Settings:        apps/server/.env
  The assistant:   paste your Claude API key in Settings, AI (see README.md)
  More:            README.md
`)

if (flags.has('--start') && !checkOnly) {
  const child = spawn('pnpm', ['start'], { cwd: root, shell: isWindows, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
}
