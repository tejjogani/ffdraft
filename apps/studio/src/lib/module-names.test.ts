/**
 * Two source files in one folder whose names differ only by letter case (`Viewfinder.tsx` beside
 * `viewfinder.ts`) build on Linux and break on a Mac or on Windows, where the file system ignores
 * case: `./Viewfinder` finds `viewfinder.ts` first. Nothing on a Linux build machine notices, so
 * this test does.
 */
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const SOURCE = /\.(ts|tsx|mts|js|jsx|mjs)$/
const NOT_IMPORTED_BY_NAME = /\.(test|spec|d)\.[a-z]+$/
const SKIP = new Set(['node_modules', 'dist', '.git', '.data', '.venv'])

/** `Viewfinder.tsx` → `Viewfinder`: the name an import without an extension asks for. */
const importName = (file: string) => file.replace(SOURCE, '')

function clashes(dir: string, found: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const byLower = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isFile() || !SOURCE.test(entry.name) || NOT_IMPORTED_BY_NAME.test(entry.name))
      continue
    const name = importName(entry.name)
    const other = byLower.get(name.toLowerCase())
    if (other !== undefined && importName(other) !== name)
      found.push(`${relative(REPO, join(dir, other))} and ${entry.name}`)
    byLower.set(name.toLowerCase(), entry.name)
  }
  for (const entry of entries)
    if (entry.isDirectory() && !SKIP.has(entry.name)) clashes(join(dir, entry.name), found)
  return found
}

it('no two source files in a folder differ only by letter case', () => {
  const found = ['apps', 'packages', 'workers', 'scripts'].flatMap((top) =>
    clashes(join(REPO, top)),
  )
  expect(found).toEqual([])
})
