/**
 * The museum adapters against the real APIs. Skipped unless PAVE_LIVE=1, because the hosts may
 * be unreachable (they were when the adapters were written, so the recorded fixtures are
 * hand-made in the documented shapes). Run where the network allows:
 *
 *   PAVE_LIVE=1 pnpm exec vitest run apps/server/src/references/live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { networkIO } from './io'
import { MUSEUMS, PAGE_SIZE } from './search'

const live = process.env.PAVE_LIVE === '1'

describe.skipIf(!live)('the museums, live', () => {
  for (const provider of MUSEUMS)
    it(`${provider.label} finds rings and re-reads the first one`, async () => {
      const io = networkIO()
      const results = await provider.search(
        { query: 'gold ring', openOnly: false, page: 1, limit: PAGE_SIZE },
        io,
      )
      expect(results.length).toBeGreaterThan(0)
      for (const r of results) {
        expect(r.thumbUrl).toMatch(/^https:\/\//)
        expect(r.mayStore).toBe(r.rights === 'open')
      }
      const again = await provider.resolve(results[0]!.key, io)
      expect(again?.key).toBe(results[0]!.key)
      expect(again?.rights).toBe(results[0]!.rights)
    }, 60_000)
})
