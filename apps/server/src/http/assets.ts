import { ASSET_KINDS, roleAllows } from '@pave/schema'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { assetBytes, getAssetRow, putAsset, readThumbnail } from '../assets/assets'
import { writeAudit } from '../audit'
import { AppError, badRequest, forbidden } from '../errors'
import type { Runtime } from '../runtime'
import type { App, HttpContext } from './types'

const UploadSchema = z.object({
  file: z.instanceof(File, { message: 'Attach the file as the "file" field' }),
  kind: z.enum(ASSET_KINDS).optional(),
})

const INLINE = /^(image|video|audio)\/|^application\/pdf$/

/** Content-addressed, so a URL's bytes never change: cache for a year, revalidate never. */
async function sendBytes(
  c: HttpContext,
  load: () => Promise<Uint8Array<ArrayBuffer>>,
  opts: { mime: string; etag: string; name?: string },
) {
  const etag = `"${opts.etag}"`
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    // Uploaded SVG or HTML must never run script in our origin.
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  }
  if (opts.name)
    headers['Content-Disposition'] =
      `${INLINE.test(opts.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.name)}`
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers)
  const bytes = await load()
  headers['Content-Type'] = opts.mime
  headers['Content-Length'] = String(bytes.byteLength)
  return c.body(bytes, 200, headers)
}

/** `POST /api/assets` (multipart upload) and `GET /api/assets/:id[?w=<px>]`. */
export function mountAssets(app: App, runtime: Runtime) {
  app.post(
    '/api/assets',
    bodyLimit({
      maxSize: runtime.config.maxUploadBytes,
      onError: () => {
        throw new AppError(
          'payload_too_large',
          `Uploads are limited to ${runtime.config.maxUploadBytes} bytes`,
        )
      },
    }),
    async (c) => {
      const ctx = c.var.ctx
      if (!roleAllows(ctx.role, 'designer')) throw forbidden('Uploading needs the designer role')
      const parsed = UploadSchema.safeParse(await c.req.parseBody())
      if (!parsed.success) throw badRequest(z.prettifyError(parsed.error), parsed.error.issues)
      const { file, kind } = parsed.data
      const asset = await putAsset(ctx, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        mime: file.type || undefined,
        kind,
      })
      await writeAudit(ctx, {
        action: 'assets.upload',
        input: { name: asset.name, kind: asset.kind },
        targetId: asset.id,
      })
      return c.json(asset, 201)
    },
  )

  app.get('/api/assets/:id', async (c) => {
    const ctx = c.var.ctx
    const asset = await getAssetRow(ctx, c.req.param('id'))
    const w = c.req.query('w')
    if (w !== undefined && asset.mime.startsWith('image/')) {
      const width = Number.parseInt(w, 10)
      if (!Number.isFinite(width) || width < 1)
        throw badRequest('w must be a positive width in pixels')
      const thumb = await readThumbnail(ctx, asset, width)
      return sendBytes(c, async () => thumb.bytes, { mime: thumb.mime, etag: thumb.sha256 })
    }
    return sendBytes(c, () => assetBytes(ctx, asset), {
      mime: asset.mime,
      etag: asset.sha256,
      name: asset.name,
    })
  })
}
