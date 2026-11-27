import { COMMAND_NAMES, type CommandName } from '@pave/schema'
import { bodyLimit } from 'hono/body-limit'
import { AppError, badRequest, forbidden, notFound } from '../errors'
import type { Runtime } from '../runtime'
import type { App, HttpContext } from './types'

const isCommand = (name: string): name is CommandName => (COMMAND_NAMES as string[]).includes(name)

async function readJson(c: HttpContext, requireObject = false) {
  const text = await c.req.text()
  if (!requireObject && text.trim() === '') return {}
  // Requiring a JSON content type means a cross-site form post can never reach a command.
  const contentType = c.req.header('content-type')?.toLowerCase()
  const json = requireObject
    ? contentType?.split(';')[0]?.trim() === 'application/json'
    : contentType?.startsWith('application/json')
  if (!json) throw badRequest('Send the command input as application/json')
  let input: unknown
  try {
    input = JSON.parse(text) as unknown
  } catch {
    throw badRequest('The request body is not valid JSON')
  }
  if (requireObject && input === null) throw badRequest('Send an empty JSON object')
  return input
}

const renderInstall = (name: CommandName) =>
  name === 'renders.installStatus' ||
  name === 'renders.installEngine' ||
  name === 'renders.cancelInstall'

const canRequestRenderInstall = (name: CommandName) =>
  name === 'renders.create' ||
  name === 'renders.estimate' ||
  name === 'threads.send' ||
  name === 'runs.decide' ||
  name === 'runs.resume'

/** An installation changes this computer. The generic local guard also permits LAN and dev
 * origins, so require a loopback bind and the browser's exact loopback request origin here. */
function localInstallRequest(c: HttpContext, runtime: Runtime, strict: boolean): boolean {
  const { auth, host } = runtime.config
  if (auth !== 'local' || !['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase()))
    return false

  const url = new URL(c.req.url)
  const hostHeader = c.req.header('host')
  const fetchSite = c.req.header('sec-fetch-site')
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    (hostHeader !== undefined && hostHeader.toLowerCase() !== url.host) ||
    c.req.header('origin') !== url.origin ||
    c.req.header('authorization') !== undefined ||
    (fetchSite !== undefined && fetchSite !== 'same-origin')
  ) {
    if (strict) throw forbidden('Open Pavé on this computer to manage the Blender installation.')
    return false
  }
  return true
}

/**
 * Files travel through `POST /api/assets`, with asset IDs in the command input. This separate
 * bound keeps a batch with large inline paths from filling the server's memory.
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
      const install = renderInstall(name)
      const ctx =
        install || canRequestRenderInstall(name)
          ? {
              ...c.var.ctx,
              localRenderInstall:
                c.var.ctx.role === 'owner' && localInstallRequest(c, runtime, install),
            }
          : c.var.ctx
      const output = await runtime.execute(name, await readJson(c, install), ctx)
      return c.json(output as object)
    },
  )
}
