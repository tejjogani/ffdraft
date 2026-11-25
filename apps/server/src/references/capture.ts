/**
 * The `capture` service: the picture at a web address, or the one a page presents as its
 * preview (`og:image`, `twitter:image`), fetched through the safe fetch. Only raster formats a
 * browser and Claude both read are kept; SVG is refused (it can carry script). It is only ever
 * called by an explicit action (pinning a result whose terms allow keeping it, or "Capture
 * image" on a link), never on paste.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { badRequest, conflict } from '../errors'
import { FetchRefused, type SafeFetchOptions, safeFetch } from '../net/safe-fetch'
import type { CaptureService, FileData } from '../services'
import type { Recordings } from './io'

const PICTURES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
/** A page is read only far enough to find its preview picture. */
const PAGE_BYTES = 1024 * 1024
const PICTURE_BYTES = 15 * 1024 * 1024
const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heif: 'image/avif',
}

/** The preview picture a page names, resolved against the page's address. */
export function previewImageOf(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    const key = attr('property') ?? attr('name')
    const keyText = (key?.[2] ?? key?.[3] ?? key?.[4] ?? '').toLowerCase()
    if (!['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image'].includes(keyText))
      continue
    const content = attr('content')
    const value = (content?.[2] ?? content?.[3] ?? content?.[4] ?? '').replace(/&amp;/g, '&').trim()
    if (!value) continue
    try {
      return new URL(value, pageUrl).toString()
    } catch {}
  }
  return null
}

/** Checks the bytes really are a picture of a kept format, and names the file. */
async function asPicture(bytes: Uint8Array, url: string): Promise<FileData> {
  let format: string | undefined
  try {
    format = (await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata()).format
  } catch {}
  const mime = format ? FORMAT_MIME[format] : undefined
  if (!mime) throw badRequest('The address did not give a picture that can be kept')
  const name = decodeURIComponent(basename(new URL(url).pathname)) || 'capture'
  return { bytes, name: name.slice(0, 120), mime }
}

const refusal = (err: unknown) =>
  err instanceof FetchRefused ? badRequest(`Couldn’t capture the image: ${err.message}`) : err

export function createCaptureService(
  fetchOptions: Omit<SafeFetchOptions, 'accept' | 'maxBytes'> = {},
): CaptureService {
  return {
    async capture(url) {
      try {
        const first = await safeFetch(url, {
          ...fetchOptions,
          accept: [...PICTURES, 'text/html', 'application/xhtml+xml'],
          maxBytes: PICTURE_BYTES,
        })
        if (first.mime.startsWith('image/'))
          return { file: await asPicture(first.bytes, first.url), sourceUrl: first.url }
        const html = new TextDecoder().decode(first.bytes.subarray(0, PAGE_BYTES))
        const image = previewImageOf(html, first.url)
        if (!image) throw conflict('That page names no preview picture to capture')
        const picture = await safeFetch(image, {
          ...fetchOptions,
          accept: PICTURES,
          maxBytes: PICTURE_BYTES,
        })
        return { file: await asPicture(picture.bytes, picture.url), sourceUrl: picture.url }
      } catch (err) {
        throw refusal(err)
      }
    },
  }
}

/** Fixture mode: pictures come from the recording's files; anything else is refused as offline. */
export function recordedCaptureService(recordings: Recordings): CaptureService {
  return {
    async capture(url) {
      const file = recordings.images?.[url]
      if (!file)
        throw badRequest('Couldn’t capture the image: this server is offline (fixture mode)')
      const bytes = new Uint8Array(await readFile(file))
      return { file: await asPicture(bytes, url), sourceUrl: url }
    },
  }
}
