import { COMMAND_NAMES, type CommandName } from '@pave/schema'
import { bodyLimit } from 'hono/body-limit'
import { AppError, badRequest, notFound } from '../errors'
import type { Runtime } from '../runtime'
import type { App } from './types'

const isCommand = (name: string): name is CommandName => (COMMAND_NAMES as string[]).includes(name)

async function readJson(c: {
  req: { text(): Promise<string>; header(name: string): string | undefined }
}) {
  const text = await c.req.text()
  if (text.trim() === '') return {}
  // Requiring a JSON content type means a cross-site form post can never reach a command.
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
    throw badRequest('Send the command input as application/json')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw badRequest('The request body is not valid JSON')
  }
}

/**
 * The most a command's input may weigh. Files travel through `POST /api/assets`; the largest
 * input the contract's own bounds allow is a `design.apply` of 200 ops with 200 kB paths (40 MB),
 * so nothing valid is refused, and the server never buffers a body without end.
 */
const MAX_COMMAND_BYTES = 64 * 1024 * 1024

/** `POST /api/rpc/:name` — every command in the registry, with the input as the JSON body. */
export function mountRpc(app: App, runtime: Runtime) {
  app.post(
    '/api/rpc/:name',
    bodyLimit({
      maxSize: MAX_COMMAND_BYTES,
      onError: () => {
        throw new AppError(
          'payload_too_large',
          `Command input is limited to ${MAX_COMMAND_BYTES} bytes; upload files to /api/assets`,
        )
      },
    }),
    async (c) => {
      const name = c.req.param('name')
      if (!isCommand(name)) throw notFound('Command', name)
      const output = await runtime.execute(name, await readJson(c), c.var.ctx)
      return c.json(output as object)
    },
  )
}
