/**
 * The Metropolitan Museum of Art's Collection API (keyless; metmuseum.github.io). A search gives
 * object ids only, so each page reads its objects one by one. The API only hands out pictures of
 * Open Access objects, which are public domain under CC0: every result here may be kept.
 */
import type { SearchResult } from '@pave/schema'
import {
  CC0,
  CC0_URL,
  creditLine,
  itemId,
  obj,
  ProviderError,
  type SearchProvider,
  str,
} from './provider'

const API = 'https://collectionapi.metmuseum.org/public/collection/v1'

export const metSearchUrl = (query: string) =>
  `${API}/search?${new URLSearchParams({ hasImages: 'true', q: query })}`
export const metObjectUrl = (id: string | number) => `${API}/objects/${id}`

/** One object as a result; null when it has no picture (not Open Access). */
export function metResult(raw: unknown): SearchResult | null {
  const o = obj(raw)
  const id = o.objectID
  const thumb = str(o.primaryImageSmall) || str(o.primaryImage)
  if (typeof id !== 'number' || !thumb || o.isPublicDomain !== true) return null
  return {
    key: `met:${id}`,
    provider: 'met',
    title: str(o.title) || str(o.objectName) || 'Untitled',
    thumbUrl: thumb,
    imageUrl: str(o.primaryImage) || thumb,
    pageUrl: str(o.objectURL) || `https://www.metmuseum.org/art/collection/search/${id}`,
    credit: creditLine(
      str(o.artistDisplayName) || str(o.culture),
      o.objectDate,
      'The Metropolitan Museum of Art',
      o.creditLine,
    ),
    license: CC0,
    licenseUrl: CC0_URL,
    rights: 'open',
    mayStore: true,
    width: null,
    height: null,
  }
}

export const met: SearchProvider = {
  id: 'met',
  label: 'The Met',
  async search(q, io) {
    const found = obj(await io.json(metSearchUrl(q.query)))
    const ids = Array.isArray(found.objectIDs) ? found.objectIDs : []
    const page = ids.slice((q.page - 1) * q.limit, q.page * q.limit)
    const objects = await Promise.all(
      page.map((id) =>
        io.json(metObjectUrl(String(id))).catch((err) => {
          // One missing object should not sink the page; anything else is the provider failing.
          if (err instanceof ProviderError && err.status === 404) return null
          throw err
        }),
      ),
    )
    return objects.map(metResult).filter((r): r is SearchResult => r !== null)
  },
  async resolve(key, io) {
    const id = itemId('met', key)
    if (!id) return null
    try {
      return metResult(await io.json(metObjectUrl(id)))
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null
      throw err
    }
  },
}
