/**
 * Records real answers from the museum APIs for a query, in the format `recordedIO` plays back:
 * the search, a re-read of each provider's first result, and the pictures of those results.
 * Run where the museums are reachable, then point PAVE_SEARCH_FIXTURES at the file or use it in
 * a test:
 *
 *   pnpm exec tsx apps/server/src/references/record.ts "art deco ring" ./recordings/art-deco
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { safeFetch } from '../net/safe-fetch'
import { networkIO } from './io'
import type { ProviderIO } from './provider'
import { MUSEUMS, PAGE_SIZE } from './search'

async function main() {
  const [query, dir] = process.argv.slice(2)
  if (!query || !dir) throw new Error('Usage: record.ts <query> <out-folder>')
  const out = resolve(dir)
  mkdirSync(out, { recursive: true })
  const json: Record<string, unknown> = {}
  const images: Record<string, string> = {}
  const live = networkIO()
  const io: ProviderIO = {
    async json(url, headers) {
      const body = await live.json(url, headers)
      json[url] = body
      return body
    },
  }
  for (const p of MUSEUMS) {
    try {
      const results = await p.search({ query, openOnly: false, page: 1, limit: PAGE_SIZE }, io)
      console.log(`${p.label}: ${results.length} results`)
      const first = results[0]
      if (!first) continue
      await p.resolve(first.key, io)
      for (const r of results.slice(0, 2)) {
        for (const url of new Set([r.thumbUrl, r.imageUrl])) {
          const pic = await safeFetch(url, { accept: ['image/*'] })
          const file = `${r.key.replace(':', '-')}-${Object.keys(images).length}.jpg`
          writeFileSync(join(out, file), pic.bytes)
          images[url] = file
        }
      }
    } catch (err) {
      console.error(`${p.label}: ${(err as Error).message}`)
    }
  }
  writeFileSync(join(out, 'recording.json'), `${JSON.stringify({ json, images }, null, 2)}\n`)
  console.log(`Wrote ${join(out, 'recording.json')}`)
}

void main()
