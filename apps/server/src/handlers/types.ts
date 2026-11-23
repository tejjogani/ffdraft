import type { CommandName, CommandOutput, CommandParsedInput } from '@pave/schema'
import type { Ctx } from '../context'

export type Handler<N extends CommandName> = (
  ctx: Ctx,
  input: CommandParsedInput<N>,
) => Promise<CommandOutput<N>>

/** One handler per command; the compiler rejects a missing or mistyped entry. */
export type Handlers = { [N in CommandName]: Handler<N> }

/** The handlers for every command whose name starts with `<prefix>.`. */
export type HandlerGroup<P extends string> = Pick<Handlers, Extract<CommandName, `${P}.${string}`>>
