import type { CommandParsedInput } from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import type { RunHost } from './host'

const PREFIX = 'Home commission board '
const BRAINSTORM = 'Brainstorm only.'
const BRAINSTORM_TOOLS = new Set(['boards.get', 'pieces.get', 'pieces.estimate', 'references.pins'])
const DESIGN_TOOLS = new Set([
  'boards.get',
  'chat.ask',
  'pieces.get',
  'references.brief',
  'references.estimate',
  'references.generate',
  'references.proposeConcepts',
  'references.read',
])

export function designToolsFor(
  mode: 'intake' | 'brainstorm',
  scoped: boolean,
): ReadonlySet<string> {
  return mode === 'intake'
    ? DESIGN_TOOLS
    : new Set(['chat.ask', ...(scoped ? BRAINSTORM_TOOLS : [])])
}

export function intakeContext(input: CommandParsedInput<'threads.send'>): string {
  if (input.context.brainstorm)
    return `${BRAINSTORM} Discuss the designer’s ideas, questions and alternatives. The designer can choose to start a project or job separately. Do not start one, generate media, change a project, or navigate.\n\n`
  if (!input.context.intake || !input.context.boardId) return ''
  return `${PREFIX}${JSON.stringify(input.context.boardId)}
This is a Home commission, in discovery. The original brief and uploaded artwork have already been saved on this piece and its project Design board. Follow the Home commission skill. Stay in this conversation until the designer uses the CAD handoff.

`
}

type Mode = { kind: 'intake'; boardId: string } | { kind: 'brainstorm' }

export async function designModeForRun(ctx: Ctx, runId: string): Promise<Mode | null> {
  const message = await ctx.repo.messages.first(
    and(eq(t.agentMessage.runId, runId), eq(t.agentMessage.role, 'system')),
  )
  const text = message?.content[0]?.text
  if (typeof text !== 'string') return null
  if (text.startsWith(BRAINSTORM)) return { kind: 'brainstorm' }
  if (!text.startsWith(PREFIX)) return null
  return {
    kind: 'intake',
    boardId: JSON.parse(text.slice(PREFIX.length).split('\n', 1)[0]!) as string,
  }
}

export async function intakeRefusal(
  host: RunHost,
  mode: Mode,
  command: string,
  input: unknown,
): Promise<string | null> {
  const args = input as Record<string, string | undefined>
  if (mode.kind === 'brainstorm') {
    if (command === 'chat.ask') return null
    const reason =
      'This is a brainstorm. Read only the current project and leave any change or job to the designer.'
    if (!host.pieceId || !BRAINSTORM_TOOLS.has(command)) return reason
    if (command === 'boards.get') {
      const board = await host.ctx.repo.boards.first(eq(t.board.id, args.id!))
      return board?.pieceId === host.pieceId && !board.pinsFor ? null : reason
    }
    return (args.id ?? args.pieceId) === host.pieceId ? null : reason
  }
  const { boardId } = mode
  if (!DESIGN_TOOLS.has(command))
    return 'Stay in Design. Only the designer can choose a concept and start CAD from Home.'
  if (
    (args.boardId && args.boardId !== boardId) ||
    (command === 'boards.get' && args.id !== boardId) ||
    (command === 'pieces.get' && args.id !== host.pieceId)
  )
    return 'Use this commission’s project and Design board.'
  if (command === 'references.generate') {
    const brief = await host.ctx.repo.imageBriefs.first(eq(t.imageBrief.id, args.briefId!))
    if (brief?.boardId !== boardId) return 'Use an image brief made for this Design board.'
  }
  return null
}
