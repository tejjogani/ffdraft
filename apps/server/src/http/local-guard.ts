/**
 * Local mode trusts every request, with no sign-in, so it must only answer requests that are
 * really for this computer. A page on another site can make the browser resolve its own name to
 * 127.0.0.1 (DNS rebinding); the browser then treats the local server as that site and CORS no
 * longer stands in the way. What gives it away is the name the request is addressed to: the Host
 * header (the request URL's hostname, as the node server builds it). Changes must also not come
 * from another site's page (Origin), which covers forms and other simple requests.
 */
import type { MiddlewareHandler } from 'hono'
import type { Config } from '../config'
import type { Env } from './types'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const hostnameOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** An address to listen on that names no one host: it adds no name the server answers to. */
const EVERY_ADDRESS = new Set(['0.0.0.0', '::', '[::]', ''])

export function localGuard(
  config: Pick<Config, 'publicUrl' | 'corsOrigins' | 'host' | 'allowedHosts'>,
): MiddlewareHandler<Env> {
  // The names this server may be addressed by: this computer, plus what the operator
  // configured: the public URL, the dev origins, the one address in HOST, and the explicit
  // list in PAVE_ALLOWED_HOSTS (a LAN address, a machine name).
  const hosts = new Set(LOOPBACK)
  const origins = new Set<string>()
  for (const url of [config.publicUrl, ...config.corsOrigins]) {
    const host = hostnameOf(url)
    if (host) hosts.add(host)
    const origin = originOf(url)
    if (origin) origins.add(origin)
  }
  const named = EVERY_ADDRESS.has(config.host)
    ? config.allowedHosts
    : [config.host, ...config.allowedHosts]
  for (const name of named) {
    const host = hostnameOf(
      `http://${name.includes(':') && !name.startsWith('[') ? `[${name}]` : name}`,
    )
    if (host) hosts.add(host)
  }
  /** `anything.localhost` is this computer by definition; `localhost.example` is not. */
  const mine = (host: string | null): host is string =>
    host !== null && (hosts.has(host) || host.endsWith('.localhost'))
  const refuse = (message: string) =>
    new Response(JSON.stringify({ error: { code: 'forbidden', message } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })

  return async (c, next) => {
    const host = hostnameOf(c.req.url)
    if (!mine(host))
      return refuse(
        'This Pavé server answers only on this computer (localhost). To use it from another address, set PAVE_PUBLIC_URL or add the name to PAVE_ALLOWED_HOSTS.',
      )
    const safe = c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS'
    const origin = c.req.header('origin')
    if (!safe && origin && !origins.has(origin)) {
      // A page served under one of this server's own names, whatever the scheme or port (a
      // TLS proxy in front, another port on this computer), is not another site.
      if (!mine(hostnameOf(origin))) return refuse('Changes from another site are not accepted.')
    }
    await next()
  }
}
