import { projectsSummary } from '../projects'
import type { HandlerGroup } from './types'

export const projects: HandlerGroup<'projects'> = {
  'projects.summary': (ctx, input) => projectsSummary(ctx, input),
}
