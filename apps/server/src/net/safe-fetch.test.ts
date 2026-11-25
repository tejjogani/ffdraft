/**
 * The safe fetch: what addresses it refuses before sending anything, and how it behaves against
 * a real local HTTP server (redirects re-checked, size and time caps, content types). The local
 * server lives on 127.0.0.1, which the public-web policy refuses, so those tests use a policy
 * that allows exactly that one address and port, and names resolve through a stand-in resolver.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCaptureService, previewImageOf } from '../references/capture'
import {
  checkUrl,
  type FetchPolicy,
  FetchRefused,
  isPublicAddress,
  type ResolvedAddress,
  safeFetch,
} from './safe-fetch'

const refusal = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    if (err instanceof FetchRefused) return err.reason
    throw err
  }
  throw new Error('expected a refusal')
}

describe('which addresses are public', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.10', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['198.18.0.1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['ff02::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:169.254.169.254', false],
    ['64:ff9b::a00:1', false],
    ['2001:db8::1', false],
    ['8.8.8.8', true],
    ['151.101.1.69', true],
    ['::ffff:8.8.8.8', true],
    ['2606:4700::6810:84e5', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })
})

describe('addresses refused before anything is sent', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/a.jpg', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['not a url', 'scheme'],
    ['http://user:pw@example.com/a.jpg', 'credentials'],
    ['http://example.com:22/a.jpg', 'port'],
    ['https://example.com:8443/a.jpg', 'port'],
    ['http://127.0.0.1/a.jpg', 'address'],
    ['http://2130706433/a.jpg', 'address'],
    ['http://0x7f.0.0.1/a.jpg', 'address'],
    ['http://[::1]/a.jpg', 'address'],
    ['http://[::ffff:127.0.0.1]/a.jpg', 'address'],
    ['http://169.254.169.254/latest/meta-data/', 'address'],
  ])('%s', (url, reason) => {
    try {
      checkUrl(url)
      throw new Error('accepted')
    } catch (err) {
      expect((err as FetchRefused).reason).toBe(reason)
    }
  })

  it('refuses a name that resolves to a private address, or to a mix', async () => {
    const resolve = async (host: string): Promise<ResolvedAddress[]> =>
      host === 'inside.test'
        ? [{ address: '10.0.0.5', family: 4 }]
        : [
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ]
    expect(
      await refusal(safeFetch('http://inside.test/a.jpg', { accept: ['image/*'], resolve })),
    ).toBe('address')
    expect(
      await refusal(safeFetch('http://mixed.test/a.jpg', { accept: ['image/*'], resolve })),
    ).toBe('address')
  })
})

describe('against a local server', () => {
  let server: Server
  let port = 0
  let png: Buffer
  let policy: FetchPolicy
  const resolve = async (): Promise<ResolvedAddress[]> => [{ address: '127.0.0.1', family: 4 }]
  const at = (path: string) => `http://museum.test:${port}${path}`

  beforeAll(async () => {
    png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#a08040' } })
      .png()
      .toBuffer()
    server = createServer((req, res) => {
      const url = req.url ?? '/'
      if (url === '/pic.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.byteLength })
        res.end(png)
      } else if (url === '/hop') {
        res.writeHead(302, { location: '/pic.png' })
        res.end()
      } else if (url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
      } else if (url === '/to-loopback-name') {
        res.writeHead(301, { location: `http://localhost:${port}/pic.png` })
        res.end()
      } else if (url === '/loop') {
        res.writeHead(302, { location: '/loop' })
        res.end()
      } else if (url === '/big') {
        // No content-length: the cap must hold while streaming.
        res.writeHead(200, { 'content-type': 'image/jpeg' })
        const chunk = Buffer.alloc(64 * 1024, 1)
        let sent = 0
        const pump = () => {
          while (sent < 40 && res.write(chunk)) sent++
          if (sent < 40) res.once('drain', pump)
          else res.end()
        }
        pump()
      } else if (url === '/slow') {
        // Never answers.
      } else if (url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          `<html><head><meta property="og:image" content="/pic.png"><title>x</title></head></html>`,
        )
      } else if (url === '/svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' })
        res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
      } else if (url === '/missing') {
        res.writeHead(404)
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
    policy = {
      allowAddress: (a) => a === '127.0.0.1',
      allowPort: (p) => p === port,
    }
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  const opts = (extra: object = {}) => ({ accept: ['image/*'], policy, resolve, ...extra })

  it('fetches a picture and follows a redirect it re-checks', async () => {
    const direct = await safeFetch(at('/pic.png'), opts())
    expect(direct.mime).toBe('image/png')
    expect(Buffer.from(direct.bytes).equals(png)).toBe(true)
    const hopped = await safeFetch(at('/hop'), opts())
    expect(hopped.url).toBe(at('/pic.png'))
  })

  it('refuses a redirect to cloud metadata, a loop and a wrong port', async () => {
    expect(await refusal(safeFetch(at('/to-metadata'), opts()))).toBe('port')
    expect(
      await refusal(
        safeFetch(at('/to-metadata'), opts({ policy: { ...policy, allowPort: () => true } })),
      ),
    ).toBe('address')
    expect(await refusal(safeFetch(at('/loop'), opts()))).toBe('redirects')
  })

  it('checks the address of a redirect target name when connecting', async () => {
    // localhost resolves (through the real resolver here) to loopback, which the public web
    // policy refuses; with the test policy it would pass, so use the public policy's address
    // rule with the test port.
    const publicAddresses: FetchPolicy = {
      allowAddress: (a, f) => a !== '127.0.0.1' && f === 4,
      allowPort: (p) => p === port,
    }
    expect(
      await refusal(
        safeFetch(`http://localhost:${port}/pic.png`, {
          accept: ['image/*'],
          policy: publicAddresses,
        }),
      ),
    ).toBe('address')
  })

  it('caps the size, the time and the content type', async () => {
    expect(await refusal(safeFetch(at('/big'), opts({ maxBytes: 1024 * 1024 })))).toBe('size')
    expect(await refusal(safeFetch(at('/pic.png'), opts({ maxBytes: 10 })))).toBe('size')
    expect(await refusal(safeFetch(at('/slow'), opts({ timeoutMs: 150 })))).toBe('timeout')
    expect(await refusal(safeFetch(at('/json'), opts()))).toBe('type')
    expect(await refusal(safeFetch(at('/missing'), opts()))).toBe('status')
  })

  it('stops when the caller cancels', async () => {
    const ac = new AbortController()
    const p = safeFetch(at('/slow'), opts({ signal: ac.signal }))
    setTimeout(() => ac.abort(new Error('canceled')), 30)
    await expect(p).rejects.toThrow('canceled')
  })

  it('captures a page’s preview picture and refuses SVG', async () => {
    const capture = createCaptureService({ policy, resolve })
    const fromPage = await capture.capture(at('/page'), {} as never)
    expect(fromPage.sourceUrl).toBe(at('/pic.png'))
    expect(fromPage.file.mime).toBe('image/png')
    await expect(capture.capture(at('/svg'), {} as never)).rejects.toThrow(
      /did not give a picture|not a picture/,
    )
    await expect(capture.capture('http://127.0.0.1/x.png', {} as never)).rejects.toThrow(
      /Couldn’t capture the image/,
    )
  })
})

describe('preview pictures in a page', () => {
  it('reads og:image in any attribute order and quoting, resolved against the page', () => {
    expect(
      previewImageOf(
        `<meta content='/a/b.jpg?x=1&amp;y=2' property='og:image'>`,
        'https://shop.example/p/1',
      ),
    ).toBe('https://shop.example/a/b.jpg?x=1&y=2')
    expect(
      previewImageOf(
        `<meta name=twitter:image content=https://cdn.example/t.png>`,
        'https://x.example',
      ),
    ).toBe('https://cdn.example/t.png')
    expect(previewImageOf('<meta name="description" content="x">', 'https://x.example')).toBeNull()
  })
})
