/**
 * The Cleveland Museum of Art's Open Access API (keyless; openaccess-api.clevelandart.org).
 * Works marked CC0 may be kept; others keep their pictures with the museum (view-only here).
 * Image sizes arrive as strings in its answers, so they are read as numbers defensively.
 */
import type { SearchResult } from '@pave/schema'
import {
  CC0,
  CC0_URL,
  creditLine,
  itemId,
  num,
  obj,
  ProviderError,
  type SearchProvider,
  str,
} from './provider'

const API = 'https://openaccess-api.clevelandart.org/api/artworks'

export function clevelandSearchUrl(query: string, page: number, limit: number, openOnly: boolean) {
  const params = new URLSearchParams({
    q: query,
    has_image: '1',
    limit: String(limit),
    skip: String((page - 1) * limit),
  })
  if (openOnly) params.set('cc0', '1')
  return `${API}/?${params}`
}
export const clevelandArtworkUrl = (id: string) => `${API}/${id}`

export function clevelandResult(raw: unknown): SearchResult | null {
  const a = obj(raw)
  const id = a.id
  const images = obj(a.images)
  const web = obj(images.web)
  const print = obj(images.print)
  const thumb = str(web.url)
  if (typeof id !== 'number' || !thumb) return null
  const open = a.share_license_status === 'CC0'
  const creators = Array.isArray(a.creators) ? a.creators : []
  const culture = Array.isArray(a.culture) ? a.culture : []
  return {
    key: `cleveland:${id}`,
    provider: 'cleveland',
    title: str(a.title) || 'Untitled',
    thumbUrl: thumb,
    imageUrl: str(print.url) || thumb,
    pageUrl: str(a.url) || null,
    credit: creditLine(
      str(obj(creators[0]).description) || str(culture[0]),
      a.creation_date,
      'The Cleveland Museum of Art',
      a.credit_line,
    ),
    license: open ? CC0 : 'In copyright: shown by the Cleveland Museum of Art',
    licenseUrl: open ? CC0_URL : 'https://www.clevelandart.org/open-access',
    rights: open ? 'open' : 'viewOnly',
    mayStore: open,
    width: num(print.width) ?? num(web.width),
    height: num(print.height) ?? num(web.height),
  }
}

export const cleveland: SearchProvider = {
  id: 'cleveland',
  label: 'Cleveland Museum of Art',
  async search(q, io) {
    const body = obj(await io.json(clevelandSearchUrl(q.query, q.page, q.limit, q.openOnly)))
    const data = Array.isArray(body.data) ? body.data : []
    return data.map(clevelandResult).filter((r): r is SearchResult => r !== null)
  },
  async resolve(key, io) {
    const id = itemId('cleveland', key)
    if (!id) return null
    try {
      return clevelandResult(obj(await io.json(clevelandArtworkUrl(id))).data)
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null
      throw err
    }
  },
}
