import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/** Local app installs and named Blender executables in absolute PATH directories. */
export async function installedBlenderCandidates(env: NodeJS.ProcessEnv): Promise<string[]> {
  const bin = process.platform === 'win32' ? 'blender.exe' : 'blender'
  const path = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1] ?? ''
  const candidates = path
    .split(delimiter)
    .filter(isAbsolute)
    .map((dir) => join(dir, bin))
  const home = env.HOME || env.USERPROFILE || homedir()

  switch (process.platform) {
    case 'darwin':
      for (const dir of [join(home, 'Applications'), '/Applications'])
        candidates.push(join(dir, 'Blender.app', 'Contents', 'MacOS', 'Blender'))
      break
    case 'linux':
      for (const dir of [join(home, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/snap/bin'])
        candidates.push(join(dir, bin))
      break
    case 'win32': {
      const roots = [
        env.ProgramFiles,
        env['ProgramFiles(x86)'],
        env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'),
      ]
      for (const root of roots) {
        if (!root || !isAbsolute(root)) continue
        const dir = join(root, 'Blender Foundation')
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries.toSorted((a, b) => b.name.localeCompare(a.name))) {
          if (entry.isDirectory() && /^Blender(?: |$)/i.test(entry.name))
            candidates.push(join(dir, entry.name, bin))
        }
      }
      if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', bin))
      break
    }
  }
  return [...new Set(candidates.filter(isAbsolute))]
}
