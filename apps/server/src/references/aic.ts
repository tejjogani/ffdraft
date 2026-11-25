/**
 * The Art Institute of Chicago's public API (keyless; api.artic.edu/docs). Pictures come from its
 * IIIF image server at the 843-pixel width it caches. Public-domain works are CC0 and may be
 * kept; the museum also shows pictures of works in copyright, which stay view-only here.
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

const API = 'https://api.artic.edu/api/v1/artworks'
const IIIF = 'https://www.artic.edu/iiif/2'
const FIELDS =
  'id,title,image_id,artist_display,date_display,credit_line,is_public_domain,thumbnail'
/** The museum asks API users to say who they are. */
export const AIC_HEADERS = { 'AIC-User-Agent': 'Pave (jewelry design studio)' }

export function aicSearchUrl(query: string, page: number, limit: number, openOnly: boolean) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
    fields: FIELDS,
  })
  if (openOnly) params.set('query[term][is_public_domain]', 'true')
  return `${API}/search?${params}`
}
export const aicArtworkUrl = (id: string) =>
  `${API}/${id}?${new URLSearchParams({ fields: FIELDS })}`

export function aicResult(raw: unknown, iiifUrl: unknown): SearchResult | null {
  const a = obj(raw)
  const id = a.id
  const image = str(a.image_id)
  if (typeof id !== 'number' || !image) return null
  const iiif = str(iiifUrl) || IIIF
  const open = a.is_public_domain === true
  const thumb = obj(a.thumbnail)
  return {
    key: `aic:${id}`,
    provider: 'aic',
    title: str(a.title) || 'Untitled',
    thumbUrl: `${iiif}/${image}/full/400,/0/default.jpg`,
    imageUrl: `${iiif}/${image}/full/843,/0/default.jpg`,
    pageUrl: `https://www.artic.edu/artworks/${id}`,
    credit: creditLine(
      a.artist_display,
      a.date_display,
      'The Art Institute of Chicago',
      a.credit_line,
    ),
    license: open ? CC0 : 'In copyright: shown by the Art Institute of Chicago',
    licenseUrl: open ? CC0_URL : 'https://www.artic.edu/terms',
    rights: open ? 'open' : 'viewOnly',
    mayStore: open,
    width: num(thumb.width),
    height: num(thumb.height),
  }
}

export const aic: SearchProvider = {
  id: 'aic',
  label: 'Art Institute of Chicago',
  async search(q, io) {
    const body = obj(await io.json(aicSearchUrl(q.query, q.page, q.limit, q.openOnly), AIC_HEADERS))
    const iiif = obj(body.config).iiif_url
    const data = Array.isArray(body.data) ? body.data : []
    return data.map((a) => aicResult(a, iiif)).filter((r): r is SearchResult => r !== null)
  },
  async resolve(key, io) {
    const id = itemId('aic', key)
    if (!id) return null
    try {
      const body = obj(await io.json(aicArtworkUrl(id), AIC_HEADERS))
      return aicResult(body.data, obj(body.config).iiif_url)
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null
      throw err
    }
  },
}
