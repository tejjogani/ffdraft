/**
 * `viewport.capture` when no studio window can draw the piece: the server draws it itself, as
 * plain shaded clay from the software rasteriser in a kernel worker (see `@pave/match` `shade`),
 * so the assistant (and headless MCP) can still compare outlines. Chosen over the plan's
 * hidden-line drawing because a shaded silhouette is what a photo is compared with, and the
 * rasteriser is the very one the photo fit scores with. No materials, labels or highlights
 * beyond a tint on focused features; the output says `source: 'server'`.
 */
import type { ClientToolOutput, ClientToolParsedInput } from '@pave/schema'
import { putAsset } from '../assets/assets'
import type { Ctx } from '../context'
import { NotConfiguredError } from '../errors'
import { getPiece } from '../lookups'
import { pngOf } from '../photos'
import { serviceContext } from '../service-context'

export async function captureOnServer(
  ctx: Ctx,
  input: ClientToolParsedInput<'viewport.capture'>,
  signal?: AbortSignal,
): Promise<ClientToolOutput<'viewport.capture'>> {
  const geometry = ctx.services.get('geometry')
  if (!geometry.picture)
    throw new NotConfiguredError(
      'geometry',
      'No Pavé window is open and this server cannot draw pictures itself.',
    )
  const piece = await getPiece(ctx, input.pieceId)
  const { images, summary } = await geometry.picture(
    piece.design,
    {
      views: input.views,
      size: input.size,
      focus: input.focusNodeIds ?? [],
      pieceId: piece.id,
      ...(signal ? { signal } : {}),
    },
    serviceContext(ctx),
  )
  const assets = []
  for (const [i, rgba] of images.entries()) {
    const png = await pngOf(rgba, input.size, input.size)
    assets.push(
      await putAsset(ctx, {
        bytes: png,
        name: `capture-v${piece.version}-server-${i + 1}.png`,
        kind: 'image',
      }),
    )
  }
  return {
    version: piece.version,
    source: 'server',
    images: assets.map((a, i) => ({ view: input.views[i]!, assetId: a.id })),
    summary,
  }
}
