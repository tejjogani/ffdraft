import type { JobStage } from '@pave/schema'
import { hash } from '../hash'
import { CORE_PROMPT, DESIGN_KNOWLEDGE } from './core'
import { NODE_REFERENCE } from './node-reference'
import { ASK_SKILL } from './skills/ask'
import { BOARD_SKILL } from './skills/board'
import { CINEMA_SKILL } from './skills/cinema'
import { DIRECTIONS_SKILL } from './skills/directions'
import { EDITING_SKILL } from './skills/editing'
import { INTAKE_SKILL } from './skills/intake'
import { PHOTO_SKILL } from './skills/photo'
import { PRODUCTION_SKILL } from './skills/production'
import { RENDER_SKILL } from './skills/render'
import { SPEC_SKILL } from './skills/spec'
import { STONE_SKILL } from './skills/stone'

export type AssistantFocus = JobStage | 'studio' | 'project' | 'brainstorm' | 'commission'
export function focusFor(input: {
  piece: boolean
  stage?: JobStage | null
  job?: JobStage | null
  mode?: 'intake' | 'brainstorm' | null
}): AssistantFocus {
  if (input.mode === 'intake') return 'commission'
  if (input.mode === 'brainstorm') return input.piece && input.stage ? input.stage : 'brainstorm'
  return input.job ?? input.stage ?? (input.piece ? 'project' : 'studio')
}

const skills = {
  intake: INTAKE_SKILL,
  questions: ASK_SKILL,
  references: BOARD_SKILL,
  specification: SPEC_SKILL,
  directions: DIRECTIONS_SKILL,
  editing: EDITING_SKILL,
  stones: STONE_SKILL,
  photo: PHOTO_SKILL,
  workshop: PRODUCTION_SKILL,
  rendering: RENDER_SKILL,
  cinema: CINEMA_SKILL,
}
const focusSkills = {
  studio: ['questions', 'specification', 'references', 'photo'],
  project: [
    'questions',
    'specification',
    'references',
    'editing',
    'stones',
    'workshop',
    'rendering',
  ],
  brainstorm: ['questions'],
  commission: ['intake', 'questions', 'references', 'specification'],
  design: ['questions', 'references', 'directions', 'specification', 'photo'],
  cad: ['questions', 'specification', 'photo', 'editing', 'stones', 'workshop'],
  render: ['questions', 'rendering', 'cinema'],
} as const satisfies Record<AssistantFocus, readonly (keyof typeof skills)[]>

const directions: Record<AssistantFocus, string> = {
  studio: 'Help the designer select or start work. Use the project named in this conversation.',
  project:
    'Work within the active project. Draw on its brief and specification, selected references and existing CAD. Ask which visual direction to use when a choice is open.',
  brainstorm:
    'Discuss ideas and alternatives. Let the designer decide when to save a direction or start work.',
  commission:
    'Stay in discovery on this project. Confirm the missing design choices and let the designer choose a visual direction before starting CAD.',
  design:
    'Use the project brief and permitted board references to explore visual directions. Separate proposed decisions from agreed specifications.',
  cad: 'Use the selected visual for silhouette, proportions and placement. Use the agreed specification for scale, materials and dimensional constraints. Surface conflicts before building. Compare the result with the visual.',
  render:
    'Work with the current CAD, selected shot references and saved scenes. Keep the product geometry and agreed materials intact unless the designer asks for a CAD edit.',
}
export function guideFor(focus: AssistantFocus, readOnly = false) {
  const names = focusSkills[focus]
  const blocks = [
    CORE_PROMPT,
    directions[focus],
    names.map((name) => skills[name]).join('\n\n'),
    DESIGN_KNOWLEDGE,
  ]
  if (focus === 'cad' || focus === 'project' || focus === 'studio') blocks.push(NODE_REFERENCE)
  if (readOnly)
    blocks.push(
      directions.brainstorm +
        ' Only the scoped read and question tools listed for this turn are available.',
    )
  return { focus, skills: names, blocks, hash: hash(JSON.stringify(blocks)) }
}
export type PromptGuide = ReturnType<typeof guideFor>
