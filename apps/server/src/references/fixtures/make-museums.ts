/**
 * Writes museums.json: answers in the three providers' documented response shapes for the query
 * "ring", keyed by the exact addresses the adapters ask for. The museum hosts were not reachable
 * when this was written, so the records are hand-made stand-ins, not real collection data;
 * `record.ts` replaces them with real answers wherever the network allows.
 *
 *   pnpm exec tsx apps/server/src/references/fixtures/make-museums.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aicArtworkUrl, aicSearchUrl } from '../aic'
import { clevelandArtworkUrl, clevelandSearchUrl } from '../cleveland'
import { metObjectUrl, metSearchUrl } from '../met'
import { PAGE_SIZE } from '../search'

const Q = 'ring'
const MET_IMG = 'https://images.metmuseum.org/CRDImages/es'
const metObject = (id: number, title: string, date: string, credit: string, pd = true) => ({
  objectID: id,
  isHighlight: false,
  accessionNumber: `00.${id}`,
  isPublicDomain: pd,
  primaryImage: pd ? `${MET_IMG}/original/DP${id}.jpg` : '',
  primaryImageSmall: pd ? `${MET_IMG}/web-large/DP${id}.jpg` : '',
  additionalImages: [],
  constituents: null,
  department: 'European Sculpture and Decorative Arts',
  objectName: 'Ring',
  title,
  culture: 'British',
  artistDisplayName: '',
  objectDate: date,
  medium: 'Gold, enamel, diamonds',
  creditLine: credit,
  objectURL: `https://www.metmuseum.org/art/collection/search/${id}`,
  tags: [{ term: 'Rings' }],
  repository: 'Metropolitan Museum of Art, New York, NY',
})

const met = {
  [metSearchUrl(Q)]: { total: 5, objectIDs: [900001, 900002, 900003, 900004, 900005] },
  [metObjectUrl(900001)]: metObject(900001, 'Posy ring', 'ca. 1700', 'Gift of a donor, 1900'),
  [metObjectUrl(900002)]: metObject(
    900002,
    'Mourning ring',
    '1786',
    'Bequest of a collector, 1910',
  ),
  [metObjectUrl(900003)]: metObject(
    900003,
    'Ring with a table-cut diamond',
    'early 17th century',
    'Rogers Fund, 1920',
  ),
  // Not Open Access: the API gives no picture, so it is not a result.
  [metObjectUrl(900004)]: metObject(900004, 'Ring in copyright', '1952', 'Purchase, 1990', false),
  [metObjectUrl(900005)]: { message: 'Not a valid object', $status: 404 },
}

const aicItem = (id: number, title: string, image: string | null, pd: boolean) => ({
  _score: 100 - (id % 7),
  id,
  title,
  image_id: image,
  artist_display: pd ? 'England\nGoldsmiths' : 'A living designer\nAmerican, born 1960',
  date_display: pd ? '1780–1800' : '1999',
  credit_line: 'Gift of a donor',
  is_public_domain: pd,
  thumbnail: image
    ? {
        lqip: 'data:image/gif;base64,R0lGODlhBQAFAPQAAA==',
        width: 2400,
        height: 2000,
        alt_text: title,
      }
    : null,
})
const aicConfig = { iiif_url: 'https://www.artic.edu/iiif/2', website_url: 'http://www.artic.edu' }
const aicInfo = {
  license_text:
    'All data in this response is licensed under a Creative Commons Zero (CC0) 1.0 designation and the Terms and Conditions of artic.edu.',
  license_links: [
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'https://www.artic.edu/terms',
  ],
  version: '1.10',
}
const aicItems = [
  aicItem(800001, 'Ring with garnets', 'a1b2c3d4-0001-4e5f-8a9b-000000000001', true),
  aicItem(800002, 'Marquise ring', 'a1b2c3d4-0002-4e5f-8a9b-000000000002', true),
  aicItem(800003, 'Modern ring', 'a1b2c3d4-0003-4e5f-8a9b-000000000003', false),
  aicItem(800004, 'Ring (no picture)', null, true),
]
const aic = {
  [aicSearchUrl(Q, 1, PAGE_SIZE, false)]: {
    preference: null,
    pagination: { total: 4, limit: PAGE_SIZE, offset: 0, total_pages: 1, current_page: 1 },
    data: aicItems,
    info: aicInfo,
    config: aicConfig,
  },
  [aicSearchUrl(Q, 1, PAGE_SIZE, true)]: {
    preference: null,
    pagination: { total: 2, limit: PAGE_SIZE, offset: 0, total_pages: 1, current_page: 1 },
    data: aicItems.filter((a) => a.is_public_domain && a.image_id),
    info: aicInfo,
    config: aicConfig,
  },
  [aicArtworkUrl('800001')]: { data: aicItems[0], info: aicInfo, config: aicConfig },
  [aicArtworkUrl('800003')]: { data: aicItems[2], info: aicInfo, config: aicConfig },
}

const CMA_IMG = 'https://openaccess-cdn.clevelandart.org'
const cmaItem = (id: number, acc: string, title: string, cc0: boolean) => ({
  id,
  accession_number: acc,
  share_license_status: cc0 ? 'CC0' : 'Copyrighted',
  title,
  creation_date: cc0 ? 'c. 1900' : '1975',
  culture: [cc0 ? 'France, 20th century' : 'America, 20th century'],
  technique: 'gold, platinum and diamonds',
  type: 'Jewelry',
  department: 'Decorative Art and Design',
  url: `https://clevelandart.org/art/${acc}`,
  images: {
    web: {
      url: `${CMA_IMG}/${acc}/${acc}_web.jpg`,
      width: '893',
      height: '1000',
      filesize: '201843',
      filename: `${acc}_web.jpg`,
    },
    print: {
      url: `${CMA_IMG}/${acc}/${acc}_print.jpg`,
      width: '3400',
      height: '3807',
      filesize: '2918311',
      filename: `${acc}_print.jpg`,
    },
  },
  creators: cc0
    ? [{ id: 1, description: 'Atelier of a Paris jeweller (French)', role: 'maker' }]
    : [],
  credit_line: cc0 ? 'Gift of a donor' : 'Purchase from a fund',
  copyright: cc0 ? null : '© the designer',
  tombstone: `${title}, ${cc0 ? 'c. 1900' : '1975'}.`,
})
const cmaItems = [
  cmaItem(700001, '1966.1', 'Ring with a cushion-cut sapphire', true),
  cmaItem(700002, '1972.2', 'Belle Époque ring', true),
  cmaItem(700003, '1990.3', 'Studio ring', false),
]
const cleveland = {
  [clevelandSearchUrl(Q, 1, PAGE_SIZE, false)]: {
    info: { total: 3, parameters: { q: Q, has_image: 1, limit: PAGE_SIZE, skip: 0 } },
    data: cmaItems,
  },
  [clevelandSearchUrl(Q, 1, PAGE_SIZE, true)]: {
    info: { total: 2, parameters: { q: Q, has_image: 1, cc0: 1, limit: PAGE_SIZE, skip: 0 } },
    data: cmaItems.filter((a) => a.share_license_status === 'CC0'),
  },
  [clevelandArtworkUrl('700001')]: { data: cmaItems[0] },
}

const out = {
  _note:
    'Hand-made stand-ins in the providers’ documented response shapes (the hosts were unreachable when written); not real collection records. Regenerate with make-museums.ts, or record real answers with ../record.ts.',
  json: { ...met, ...aic, ...cleveland },
}
writeFileSync(join(import.meta.dirname, 'museums.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${Object.keys(out.json).length} recorded answers`)
