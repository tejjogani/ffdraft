/**
 * Fetching a web address someone pasted, on the server's behalf, without letting that address
 * reach anything but the public internet (SSRF). The rules, in the order they are checked:
 *
 *  - only http and https, on their usual ports, with no user name or password in the address;
 *  - the host's every address must be public: loopback, private, link-local (cloud metadata at
 *    169.254.169.254), carrier-grade NAT, multicast, documentation and reserved ranges are
 *    refused, for IPv4, IPv6 and IPv4 inside IPv6;
 *  - the addresses are checked inside the connection's own DNS lookup, so the address checked
 *    is the address connected to (a name cannot resolve to a public address for the check and a
 *    private one for the connection);
 *  - redirects are followed by hand, at most a few, and each hop is checked again;
 *  - one deadline covers the whole fetch, redirects included, and the body is cut off at a size
 *    cap, whether or not the server declared its length;
 *  - the content type must be one the caller accepts.
 *
 * It uses node:http directly (no proxy, no cookies, no compression), so it behaves the same on
 * macOS, Windows and Linux. Network failures come back as a {@link FetchRefused} with a reason
 * in plain words, never as a raw socket error.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

export type RefusalReason =
  | 'address'
  | 'scheme'
  | 'port'
  | 'credentials'
  | 'dns'
  | 'redirects'
  | 'status'
  | 'type'
  | 'size'
  | 'timeout'
  | 'network'

export class FetchRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message)
    this.name = 'FetchRefused'
  }
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** Which addresses and ports a fetch may reach. Tests widen it to reach a local server. */
export interface FetchPolicy {
  allowAddress(address: string, family: 4 | 6): boolean
  allowPort(port: number, protocol: 'http:' | 'https:'): boolean
}

export interface SafeFetchOptions {
  /** Content types (without parameters) the caller can use, e.g. `image/jpeg`; `image/*` allowed. */
  accept: readonly string[]
  maxBytes?: number
  /** One deadline for the whole fetch, redirects included. */
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
  policy?: FetchPolicy
  /** Name resolution; the system resolver unless a test stands in for it. */
  resolve?: (host: string) => Promise<ResolvedAddress[]>
}

export interface SafeResponse {
  /** The address the bytes finally came from, after redirects. */
  url: string
  mime: string
  bytes: Uint8Array
}

export const SAFE_FETCH_DEFAULTS = {
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 4,
} as const

const USER_AGENT = 'Pave/0.1 (reference capture)'

/** Addresses no fetch on someone's behalf may reach (IANA special-purpose registries). */
const BLOCKED = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, bits, 'ipv6')

/** The IPv4 address inside an IPv4-mapped (::ffff:a.b.c.d), compatible or NAT64 IPv6 address. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase()
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1]!
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const hi = Number.parseInt(hex[1]!, 16)
  const lo = Number.parseInt(hex[2]!, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** Whether an address is on the public internet. */
export function isPublicAddress(
  address: string,
  family: 4 | 6 = isIP(address) === 6 ? 6 : 4,
): boolean {
  if (family === 6) {
    const v4 = embeddedIpv4(address)
    if (v4) return isIP(v4) === 4 && !BLOCKED.check(v4, 'ipv4')
    return !BLOCKED.check(address, 'ipv6')
  }
  return !BLOCKED.check(address, 'ipv4')
}

export const PUBLIC_WEB: FetchPolicy = {
  allowAddress: isPublicAddress,
  allowPort: (port, protocol) => port === (protocol === 'https:' ? 443 : 80),
}

const systemResolve = async (host: string): Promise<ResolvedAddress[]> =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }))

/** Parses and checks an address before anything is resolved or sent. */
export function checkUrl(raw: string, policy: FetchPolicy = PUBLIC_WEB): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchRefused('scheme', 'That is not a web address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchRefused('scheme', 'Only http and https addresses can be fetched')
  if (url.username || url.password)
    throw new FetchRefused('credentials', 'Addresses with a user name or password are not fetched')
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (!policy.allowPort(port, url.protocol))
    throw new FetchRefused('port', `Port ${port} is not fetched; only the usual web ports are`)
  // The URL parser has already turned decimal, octal and hex forms into dotted IPv4.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family && !policy.allowAddress(host, family === 6 ? 6 : 4))
    throw new FetchRefused('address', 'That address is not on the public internet')
  return url
}

const typeOf = (header: string | string[] | undefined) =>
  (Array.isArray(header) ? header[0] : header)?.split(';')[0]?.trim().toLowerCase() ?? ''

const accepts = (accept: readonly string[], mime: string) =>
  accept.some((a) => a === mime || (a.endsWith('/*') && mime.startsWith(a.slice(0, -1))))

/**
 * A lookup for node:http that resolves, checks every address and only then lets the socket
 * connect. Node may ask for one address or all of them (happy eyeballs); both are answered.
 */
function guardedLookup(
  policy: FetchPolicy,
  resolve: (host: string) => Promise<ResolvedAddress[]>,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (!addresses.length)
          return callback(new FetchRefused('dns', `${hostname} has no address`), '', 4)
        // Refuse if any address is private: a name mixing public and private ones is a trick.
        const bad = addresses.find((a) => !policy.allowAddress(a.address, a.family))
        if (bad)
          return callback(
            new FetchRefused('address', `${hostname} points to an address that is not public`),
            '',
            4,
          )
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses
        if (!usable.length)
          return callback(new FetchRefused('dns', `${hostname} has no usable address`), '', 4)
        if (options.all)
          (callback as unknown as (e: null, a: ResolvedAddress[]) => void)(null, usable)
        else callback(null, usable[0]!.address, usable[0]!.family)
      },
      () => callback(new FetchRefused('dns', `${hostname} could not be found`), '', 4),
    )
  }
}

interface Hop {
  status: number
  location: string | null
  mime: string
  bytes: Uint8Array | null
}

/** One request; reads the body only for a 200 with an accepted type, under the size cap. */
function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, 'accept' | 'maxBytes'>> & {
    signal: AbortSignal
    lookup: LookupFunction
  },
): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      url,
      {
        method: 'GET',
        lookup: opts.lookup,
        signal: opts.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept.join(', '),
          'accept-encoding': 'identity',
        },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        const mime = typeOf(res.headers['content-type'])
        if (status !== 200 || !accepts(opts.accept, mime)) {
          res.resume()
          resolve({ status, location: res.headers.location ?? null, mime, bytes: null })
          return
        }
        const declared = Number(res.headers['content-length'] ?? 0)
        if (declared > opts.maxBytes) {
          res.destroy()
          reject(new FetchRefused('size', 'The file is too large to fetch'))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > opts.maxBytes) {
            res.destroy()
            reject(new FetchRefused('size', 'The file is too large to fetch'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({ status, location: null, mime, bytes: new Uint8Array(Buffer.concat(chunks)) }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** Fetches `raw` under the rules above, or throws a {@link FetchRefused}. */
export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const policy = options.policy ?? PUBLIC_WEB
  const maxBytes = options.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects
  const deadline = AbortSignal.timeout(options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const lookup = guardedLookup(policy, options.resolve ?? systemResolve)

  let url = checkUrl(raw, policy)
  for (let hop = 0; ; hop++) {
    let res: Hop
    try {
      res = await requestOnce(url, { accept: options.accept, maxBytes, signal, lookup })
    } catch (err) {
      if (err instanceof FetchRefused) throw err
      if (options.signal?.aborted) throw options.signal.reason
      if (deadline.aborted) throw new FetchRefused('timeout', 'The site took too long to answer')
      // The guarded lookup's refusal arrives wrapped by node's socket on some versions.
      const cause = (err as { cause?: unknown }).cause
      if (cause instanceof FetchRefused) throw cause
      throw new FetchRefused('network', `Could not reach ${url.hostname}`)
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= maxRedirects)
        throw new FetchRefused('redirects', 'The address redirects too many times')
      url = checkUrl(new URL(res.location, url).toString(), policy)
      continue
    }
    if (res.status !== 200) throw new FetchRefused('status', `The site answered ${res.status}`)
    if (!res.bytes)
      throw new FetchRefused(
        'type',
        res.mime
          ? `The address gives ${res.mime}, not a picture or a page`
          : 'The address gave no content type',
      )
    return { url: url.toString(), mime: res.mime, bytes: res.bytes }
  }
}
