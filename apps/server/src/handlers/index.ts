import { assistant } from './assistant'
import { collections } from './collections'
import { design } from './design'
import { freeform } from './freeform'
import { ideate } from './ideate'
import { match } from './match'
import { mesh3d } from './mesh3d'
import { models } from './models'
import { org } from './org'
import { pieces } from './pieces'
import { plan } from './plan'
import { production } from './production'
import { render } from './render'
import { session } from './session'
import type { Handlers } from './types'
import { usage } from './usage'

export const handlers: Handlers = {
  ...session,
  ...org,
  ...collections,
  ...pieces,
  ...design,
  ...ideate,
  ...freeform,
  ...match,
  ...mesh3d,
  ...render,
  ...models,
  ...production,
  ...assistant,
  ...usage,
  ...plan,
}
