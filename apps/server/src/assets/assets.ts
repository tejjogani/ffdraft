import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { ASSET_KINDS, type Asset } from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { notFound } from '../errors'
import { createId } from '../ids'

export type AssetKind = (typeof ASSET_KINDS)[number]

export interface NewAsset {
  bytes: Uint8Array
  name: string
  /** Detected from the bytes for images; otherwise taken from here or the file extension. */
  mime?: string
  /** Defaults to what the bytes or extension say (`image`, `mesh`, …). */
  kind?: AssetKind
}

type AssetRow = typeof t.asset.$inferSelect

const EXTENSIONS: Record<string, { kind: AssetKind; mime: string }> = {
  '.stl': { kind: 'mesh', mime: 'model/stl' },
  '.step': { kind: 'mesh', mime: 'model/step' },
  '.stp': { kind: 'mesh', mime: 'model/step' },
  '.3dm': { kind: 'mesh', mime: 'model/vnd.3dm' },
  '.glb': { kind: 'mesh', mime: 'model/gltf-binary' },
  '.gltf': { kind: 'mesh', mime: 'model/gltf+json' },
  '.obj': { kind: 'mesh', mime: 'model/obj' },
  '.3mf': { kind: 'mesh', mime: 'model/3mf' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.pdf': { kind: 'document', mime: 'application/pdf' },
  '.txt': { kind: 'document', mime: 'text/plain' },
  '.md': { kind: 'document', mime: 'text/markdown' },
  '.zip': { kind: 'archive', mime: 'application/zip' },
}

const IMAGE_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heif: 'image/heif',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
}

/** Thumbnail widths we render; requests snap up to the next one so the cache stays small. */
const THUMB_WIDTHS = [64, 128, 256, 480, 640, 960, 1280, 1920] as const

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function imageInfo(bytes: Uint8Array) {
  try {
    const m = await sharp(bytes).metadata()
    const mime = IMAGE_MIME[m.format]
    if (!mime) return null
    // EXIF orientations 5–8 are stored rotated a quarter turn.
    const swap = (m.orientation ?? 1) >= 5
    return { mime, width: (swap ? m.height : m.width) ?? null, height: (swap ? m.width : m.height) ?? null }
  } catch {
    return null
  }
}

/** Strips any directory part a client sent and bounds the length. */
const cleanName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file'

export const assetUrl = (id: string) => `/api/assets/${id}`

export const toAsset = (r: AssetRow): Asset => ({
  id: r.id,
  kind: r.kind,
  mime: r.mime,
  name: r.name,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  url: assetUrl(r.id),
  createdAt: r.createdAt.toISOString(),
})

async function storeBlob(ctx: Ctx, bytes: Uint8Array, mime: string): Promise<string> {
  const hash = sha256(bytes)
  await ctx.blobs.put(hash, bytes)
  await ctx.repo.blobs.insertIfAbsent({ sha256: hash, size: bytes.byteLength, mime })
  return hash
}

/** Stores bytes as a new asset of the caller's org. The building block for every other module. */
export async function putAsset(ctx: Ctx, input: NewAsset): Promise<Asset> {
  const name = cleanName(input.name)
  const byExt = EXTENSIONS[extname(name).toLowerCase()]
  const image = await imageInfo(input.bytes)
  const mime = image?.mime ?? input.mime ?? byExt?.mime ?? 'application/octet-stream'
  const kind = input.kind ?? (image ? 'image' : (byExt?.kind ?? 'document'))
  const hash = await storeBlob(ctx, input.bytes, mime)
  const row = await ctx.repo.assets.insert({
    id: createId('as'),
    sha256: hash,
    kind,
    mime,
    name,
    bytes: input.bytes.byteLength,
    width: image?.width ?? null,
    height: image?.height ?? null,
    createdBy: ctx.user.id,
  })
  return toAsset(row)
}

export async function getAssetRow(ctx: Ctx, id: string): Promise<AssetRow> {
  const row = await ctx.repo.assets.first(eq(t.asset.id, id))
  if (!row) throw notFound('Asset', id)
  return row
}

async function readBlob(ctx: Ctx, hash: string): Promise<Uint8Array> {
  const bytes = await ctx.blobs.get(hash)
  if (!bytes) throw new Error(`Blob ${hash} is missing from the blob store`)
  return bytes
}

/** The asset's bytes; 404 unless it belongs to the caller's org. */
export async function readAsset(ctx: Ctx, id: string): Promise<{ asset: AssetRow; bytes: Uint8Array }> {
  const asset = await getAssetRow(ctx, id)
  return { asset, bytes: await readBlob(ctx, asset.sha256) }
}

/** A WebP thumbnail at least `width` px wide (never upscaled), cached as its own blob. */
export async function readThumbnail(
  ctx: Ctx,
  asset: AssetRow,
  width: number,
): Promise<{ bytes: Uint8Array; mime: string; sha256: string }> {
  const w = THUMB_WIDTHS.find((x) => x >= width) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1]!
  const variant = `w${w}`
  const cached = await ctx.repo.assetVariants.first(
    and(eq(t.assetVariant.assetId, asset.id), eq(t.assetVariant.variant, variant)),
  )
  if (cached) return { bytes: await readBlob(ctx, cached.sha256), mime: cached.mime, sha256: cached.sha256 }

  const original = await readBlob(ctx, asset.sha256)
  const bytes = await sharp(original).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  const mime = 'image/webp'
  const hash = await storeBlob(ctx, bytes, mime)
  await ctx.repo.assetVariants.insertIfAbsent({ assetId: asset.id, variant, sha256: hash, mime, bytes: bytes.byteLength })
  return { bytes, mime, sha256: hash }
}
