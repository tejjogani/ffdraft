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

export function localGuard(
  config: Pick<Config, 'publicUrl' | 'corsOrigins'>,
): MiddlewareHandler<Env> {
  // The names this server may be addressed by: this computer, plus the public URL and dev
  // origins the operator configured (for example a LAN address in PAVE_PUBLIC_URL).
  const hosts = new Set(LOOPBACK)
  const origins = new Set<string>()
  for (const url of [config.publicUrl, ...config.corsOrigins]) {
    const host = hostnameOf(url)
    if (host) hosts.add(host)
    const origin = originOf(url)
    if (origin) origins.add(origin)
  }
  const refuse = (message: string) =>
    new Response(JSON.stringify({ error: { code: 'forbidden', message } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })

  return async (c, next) => {
    const host = hostnameOf(c.req.url)
    if (!host || !hosts.has(host))
      return refuse(
        'This Pavé server answers only on this computer (localhost). To use it from another address, set PAVE_PUBLIC_URL.',
      )
    const safe = c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS'
    const origin = c.req.header('origin')
    if (!safe && origin && !origins.has(origin)) {
      const from = hostnameOf(origin)
      if (!from || !LOOPBACK.has(from)) return refuse('Changes from another site are not accepted.')
    }
    await next()
  }
}
