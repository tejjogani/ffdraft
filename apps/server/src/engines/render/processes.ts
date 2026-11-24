/**
 * Finding and killing Blender processes by the work directory on their command line.
 * `@pave/render/node` does not expose the child it spawns, yet the server must be able to stop
 * one that ignores its single SIGTERM, and, after a crash, one its previous run left behind.
 * Every pass is started as `… pave_render.py <workDir>/pass-N/job.json`, so the path names it.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const LIST_TIMEOUT_MS = 10_000

/** Every process as `pid` and command line. */
async function processList(): Promise<{ pid: number; command: string }[]> {
  if (process.platform === 'linux') {
    const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name))
    const all = await Promise.all(
      pids.map(async (pid) => ({
        pid: Number(pid),
        // Arguments are NUL-separated; a process may vanish while we read.
        command: (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).replaceAll(
          '\0',
          ' ',
        ),
      })),
    )
    return all
  }
  const { stdout } =
    process.platform === 'win32'
      ? await run(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
          ],
          { timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
        )
      : await run('ps', ['-axww', '-o', 'pid=,args='], {
          timeout: LIST_TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
        })
  return stdout
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ pid: Number(m[1]), command: m[2]! }))
}

/** Pids of render processes whose command line mentions a path inside `dir`; never this process. */
export async function renderProcessesIn(dir: string): Promise<number[]> {
  const inside = dir.endsWith(sep) ? dir : `${dir}${sep}`
  const list = await processList().catch((err: unknown) => {
    console.error('Listing processes failed:', err)
    return []
  })
  return list
    .filter((p) => p.pid !== process.pid && p.command.includes(inside))
    .filter((p) => p.command.includes('pave_render'))
    .map((p) => p.pid)
}

/** Kills (SIGKILL; on Windows, terminates) every render process working in `dir`. */
export async function killRenderProcessesIn(dir: string): Promise<number[]> {
  const pids = await renderProcessesIn(dir)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Exited between listing and killing.
    }
  }
  return pids
}
