import { Box, Clock3, Diamond, FolderOutput, Grid2x2, Images, PersonStanding } from 'lucide-react'
import { STAGE_PATH } from '../assistant/jobs/status'

export const PROJECT_MENU = '/pieces/$id'
export const PROJECT_AREAS = [
  { title: 'Designs', to: STAGE_PATH.design, icon: Grid2x2, stage: 'design' },
  { title: 'CAD', to: STAGE_PATH.cad, icon: Box, stage: 'cad' },
  { title: 'Renders', to: STAGE_PATH.render, icon: Images, stage: 'render' },
  { title: 'Sourcing', to: '/pieces/$id/sourcing', icon: Diamond },
  { title: 'History', to: '/pieces/$id/history', icon: Clock3 },
  { title: 'On model', to: '/pieces/$id/on-model', icon: PersonStanding },
  { title: 'Production', to: '/pieces/$id/production', icon: FolderOutput },
] as const

export type ProjectArea = (typeof PROJECT_AREAS)[number]
