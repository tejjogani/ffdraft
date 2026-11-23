import { getAssetRow } from '../assets/assets'
import { badRequest } from '../errors'
import { serviceContext } from '../service-context'
import type { HandlerGroup } from './types'

export const freeform: HandlerGroup<'freeform'> = {
  // Vision and depth are optional helpers: the engine falls back without them, never 501s for them.
  'freeform.analyze': async (ctx, input) => {
    const asset = await getAssetRow(ctx, input.assetId)
    if (asset.kind !== 'image' && asset.kind !== 'mesh')
      throw badRequest('Choose a picture or a 3D model to turn into jewelry')
    const engine = ctx.services.require('freeform')
    const sctx = serviceContext(ctx)
    return engine.analyze(
      input,
      await sctx.readAsset(asset.id),
      { vision: ctx.services.optional('vision'), depth: ctx.services.optional('depth') },
      sctx,
    )
  },
}
