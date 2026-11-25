/**
 * The museum adapters and the search fan-out, on recorded answers (fixtures/museums.json): what
 * each provider is asked, how its answer maps to results, the rights tier and whether pixels may
 * be kept. No network: a recording that lacks an address fails the test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aic } from './aic'
import { cleveland } from './cleveland'
import { type Recordings, recordedIO } from './io'
import { met } from './met'
import { itemId, type ProviderIO } from './provider'
import { createSearchService, PAGE_SIZE } from './search'

const recordings = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'museums.json'), 'utf8'),
) as Recordings

/** A recorded IO that also lists the addresses asked for, in order. */
function io(rec: Recordings = recordings): ProviderIO & { asked: string[] } {
  const inner = recordedIO(rec)
  const asked: string[] = []
  return {
    asked,
    json: (url, headers) => {
      asked.push(url)
      return inner.json(url, headers)
    },
  }
}

const q = (query: string, openOnly = false) => ({ query, openOnly, page: 1, limit: PAGE_SIZE })

describe('the Met', () => {
  it('reads each object of the page and keeps only Open Access pictures', async () => {
    const x = io()
    const results = await met.search(q('ring'), x)
    expect(x.asked).toEqual([
      'https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=ring',
      ...[900001, 900002, 900003, 900004, 900005].map(
        (id) => `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      ),
    ])
    // 900004 is not public domain (no picture); 900005 answered 404 and is skipped.
    expect(results.map((r) => r.key)).toEqual(['met:900001', 'met:900002', 'met:900003'])
    expect(results[0]).toEqual({
      key: 'met:900001',
      provider: 'met',
      title: 'Posy ring',
      thumbUrl: 'https://images.metmuseum.org/CRDImages/es/web-large/DP900001.jpg',
      imageUrl: 'https://images.metmuseum.org/CRDImages/es/original/DP900001.jpg',
      pageUrl: 'https://www.metmuseum.org/art/collection/search/900001',
      credit: 'British, ca. 1700. The Metropolitan Museum of Art, Gift of a donor, 1900',
      license: 'CC0 1.0 (public domain)',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      rights: 'open',
      mayStore: true,
      width: null,
      height: null,
    })
  })

  it('re-reads one result by key and refuses keys that are not its own', async () => {
    const x = io()
    expect((await met.resolve('met:900002', x))?.title).toBe('Mourning ring')
    expect(await met.resolve('met:900005', x)).toBeNull()
    expect(await met.resolve('met:../../search?q=x', x)).toBeNull()
    expect(await met.resolve('aic:900001', x)).toBeNull()
    expect(x.asked).toHaveLength(2)
  })
})

describe('the Art Institute of Chicago', () => {
  it('builds IIIF picture addresses and keeps works in copyright view-only', async () => {
    const x = io()
    const results = await aic.search(q('ring'), x)
    expect(x.asked).toEqual([
      'https://api.artic.edu/api/v1/artworks/search?q=ring&page=1&limit=12&fields=id%2Ctitle%2Cimage_id%2Cartist_display%2Cdate_display%2Ccredit_line%2Cis_public_domain%2Cthumbnail',
    ])
    // The item with no image_id is dropped.
    expect(results.map((r) => [r.key, r.rights, r.mayStore])).toEqual([
      ['aic:800001', 'open', true],
      ['aic:800002', 'open', true],
      ['aic:800003', 'viewOnly', false],
    ])
    expect(results[0]).toMatchObject({
      thumbUrl:
        'https://www.artic.edu/iiif/2/a1b2c3d4-0001-4e5f-8a9b-000000000001/full/400,/0/default.jpg',
      imageUrl:
        'https://www.artic.edu/iiif/2/a1b2c3d4-0001-4e5f-8a9b-000000000001/full/843,/0/default.jpg',
      pageUrl: 'https://www.artic.edu/artworks/800001',
      credit: 'England, Goldsmiths, 1780–1800. The Art Institute of Chicago, Gift of a donor',
      width: 2400,
      height: 2000,
    })
    expect(results[2]).toMatchObject({
      license: 'In copyright: shown by the Art Institute of Chicago',
      licenseUrl: 'https://www.artic.edu/terms',
    })
  })

  it('asks the museum for public-domain works only when open-only', async () => {
    const x = io()
    const results = await aic.search(q('ring', true), x)
    expect(x.asked[0]).toContain('query%5Bterm%5D%5Bis_public_domain%5D=true')
    expect(results.every((r) => r.rights === 'open')).toBe(true)
    expect((await aic.resolve('aic:800003', x))?.rights).toBe('viewOnly')
  })
})

describe('the Cleveland Museum of Art', () => {
  it('reads sizes given as strings and the CC0 status', async () => {
    const x = io()
    const results = await cleveland.search(q('ring'), x)
    expect(x.asked).toEqual([
      'https://openaccess-api.clevelandart.org/api/artworks/?q=ring&has_image=1&limit=12&skip=0',
    ])
    expect(results.map((r) => [r.key, r.rights, r.mayStore, r.width])).toEqual([
      ['cleveland:700001', 'open', true, 3400],
      ['cleveland:700002', 'open', true, 3400],
      ['cleveland:700003', 'viewOnly', false, 3400],
    ])
    expect(results[0]).toMatchObject({
      thumbUrl: 'https://openaccess-cdn.clevelandart.org/1966.1/1966.1_web.jpg',
      imageUrl: 'https://openaccess-cdn.clevelandart.org/1966.1/1966.1_print.jpg',
      pageUrl: 'https://clevelandart.org/art/1966.1',
      credit:
        'Atelier of a Paris jeweller (French), c. 1900. The Cleveland Museum of Art, Gift of a donor',
    })
    const open = await cleveland.search(q('ring', true), io())
    expect(open.map((r) => r.key)).toEqual(['cleveland:700001', 'cleveland:700002'])
    expect((await cleveland.resolve('cleveland:700001', x))?.title).toBe(
      'Ring with a cushion-cut sapphire',
    )
  })
})

describe('the search fan-out', () => {
  it('gathers every museum and names the ones that could not answer', async () => {
    const down: Recordings = {
      json: {
        ...recordings.json,
        'https://openaccess-api.clevelandart.org/api/artworks/?q=ring&has_image=1&limit=12&skip=0':
          { $status: 503 },
      },
    }
    const search = createSearchService({ io: io(down) })
    const out = await search.search(
      { query: 'ring', openOnly: false, page: 1, providers: ['met', 'aic', 'cleveland', 'nope'] },
      {} as never,
    )
    expect(out.providers).toEqual(['met', 'aic'])
    expect(out.results.map((r) => r.provider)).toEqual(['met', 'met', 'met', 'aic', 'aic', 'aic'])
    expect(out.unavailable).toEqual([
      { provider: 'nope', reason: '“nope” is not a search provider here' },
      { provider: 'cleveland', reason: 'Cleveland Museum of Art answered 503' },
    ])
  })

  it('reports a slow provider instead of waiting for it', async () => {
    const stuck: ProviderIO = { json: () => new Promise(() => {}) }
    const search = createSearchService({ io: stuck, timeoutMs: 30 })
    const out = await search.search(
      { query: 'ring', openOnly: false, page: 1, providers: ['aic'] },
      {} as never,
    )
    expect(out.results).toEqual([])
    expect(out.unavailable).toEqual([
      { provider: 'aic', reason: 'Art Institute of Chicago took too long to answer' },
    ])
  })

  it('keeps only pictures that may be kept when open-only, and re-reads by provider', async () => {
    const search = createSearchService({ io: io() })
    const out = await search.search({ query: 'ring', openOnly: true, page: 1 }, {} as never)
    expect(out.results.every((r) => r.mayStore && r.rights === 'open')).toBe(true)
    expect(out.results).toHaveLength(7)
    expect((await search.resolve({ provider: 'aic', key: 'aic:800001' }, {} as never))?.title).toBe(
      'Ring with garnets',
    )
    // A key from another provider is not looked up anywhere.
    expect(await search.resolve({ provider: 'aic', key: 'met:900001' }, {} as never)).toBeNull()
    expect(search.capabilities).toEqual({ imageSearch: ['met', 'aic', 'cleveland'] })
  })

  it('reads item ids as numbers only', () => {
    expect(itemId('met', 'met:123')).toBe('123')
    expect(itemId('met', 'met:12a')).toBeNull()
    expect(itemId('met', 'met:1/../2')).toBeNull()
  })
})
