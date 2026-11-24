/**
 * The frozen system prompt, as the text blocks every request sends after the tools. Its hash,
 * together with the tool list, identifies the cached prefix a thread was started with.
 */
import { hash } from '../hash'
import { toolDefs } from '../tools'
import { CORE_PROMPT, DESIGN_KNOWLEDGE } from './core'
import { NODE_REFERENCE } from './node-reference'
import { ASK_SKILL } from './skills/ask'
import { EDITING_SKILL } from './skills/editing'
import { PHOTO_SKILL } from './skills/photo'
import { SPEC_SKILL } from './skills/spec'
import { STONE_SKILL } from './skills/stone'

export const SKILLS = [
  '# Skills',
  SPEC_SKILL,
  EDITING_SKILL,
  STONE_SKILL,
  PHOTO_SKILL,
  ASK_SKILL,
].join('\n\n')

/** In order; the cache breakpoint goes on the last block. */
export const SYSTEM_BLOCKS: readonly string[] = Object.freeze([
  CORE_PROMPT,
  SKILLS,
  DESIGN_KNOWLEDGE,
  NODE_REFERENCE,
])

/** Changes whenever the system prompt or any tool definition changes. */
export const PROMPT_HASH = `prompt-${hash(JSON.stringify({ system: SYSTEM_BLOCKS, tools: toolDefs() }))}`

export {
  type ContextPiece,
  type ContextSelection,
  canonText,
  renderContext,
  type TurnContext,
} from './context'
export { NODE_REFERENCE } from './node-reference'
