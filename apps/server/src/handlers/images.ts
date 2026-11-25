import { roleAllows } from '@pave/schema'
import { forbidden } from '../errors'
import { serviceContext } from '../service-context'
import type { HandlerGroup } from './types'

/** Image providers' keys and settings: people only (never tools), owners and admins for changes. */
export const images: HandlerGroup<'images'> = {
  'images.setup.get': async (ctx) =>
    ctx.services
      .get('imageSetup')
      .get(serviceContext(ctx), { admin: roleAllows(ctx.role, 'admin') }),

  'images.key.set': async (ctx, { provider, apiKey }) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can set an API key')
    return ctx.services.get('imageSetup').setKey(provider, apiKey, serviceContext(ctx))
  },

  'images.key.test': async (ctx, { provider, apiKey }) =>
    ctx.services.get('imageSetup').testKey(provider, apiKey ?? null, serviceContext(ctx)),

  'images.key.remove': async (ctx, { provider }) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can remove an API key')
    return ctx.services.get('imageSetup').removeKey(provider, serviceContext(ctx))
  },

  'images.settings.update': async (ctx, input) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can change image settings')
    return ctx.services.get('imageSetup').update(input, serviceContext(ctx))
  },
}
