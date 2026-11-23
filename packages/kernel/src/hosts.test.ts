/**
 * The kernel outside vitest's module loader: under plain Node (as the server runs it) and in a
 * browser Worker bundled by Vite (as the studio runs it).
 */
import { describe, expect, it } from 'vitest'

interface NodeApi {
  'node:child_process': { execFileSync(file: string, args: string[], options: { encoding: 'utf8'; cwd?: string }): string }
  'node:url': { fileURLToPath(url: URL): string }
  'node:module': { createRequire(from: string): (id: string) => unknown }
  'node:fs': { mkdtempSync(prefix: string): string; rmSync(path: string, options: { recursive: boolean; force: boolean }): void; readFileSync(path: string): Uint8Array }
  'node:os': { tmpdir(): string }
  'node:path': { join(...parts: string[]): string; extname(path: string): string }
  'node:http': {
    createServer(handler: (req: { url?: string }, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: Uint8Array): void }) => void): {
      listen(port: number, done: () => void): void
      address(): { port: number }
      close(): void
    }
  }
}
type NodeProcess = { execPath: string; getBuiltinModule<K extends keyof NodeApi>(name: K): NodeApi[K] }
const node = (globalThis as unknown as { process: NodeProcess }).process
const builtin = <K extends keyof NodeApi>(name: K): NodeApi[K] => node.getBuiltinModule(name)
const here = (relative: string): string => builtin('node:url').fileURLToPath(new URL(relative, import.meta.url))

interface Browser {
  newPage(): Promise<{
    goto(url: string): Promise<unknown>
    waitForFunction(expression: string, arg?: unknown, options?: { timeout: number }): Promise<unknown>
    evaluate(expression: string): Promise<unknown>
    on(event: 'console' | 'pageerror', listener: (message: { text?(): string; message?: string }) => void): void
  }>
  close(): Promise<void>
}

/** Playwright, if this machine has it (it is not a dependency of the package). */
function findChromium(): { launch(options?: { args?: string[] }): Promise<Browser> } | null {
  try {
    const playwright = builtin('node:module').createRequire(import.meta.url)('playwright')
    return (playwright as { chromium: { launch(): Promise<Browser> } }).chromium
  } catch {
    return null
  }
}

describe('hosts', () => {
  it('runs under plain Node: WASM, fonts and CommonJS dependencies load without a bundler', () => {
    const output = builtin('node:child_process').execFileSync(node.execPath, ['--import', 'tsx', here('./testing/plainNode.ts')], {
      encoding: 'utf8',
    })
    const result = JSON.parse(output.trim().split('\n').pop() as string)
    expect(result).toMatchObject({ parts: 1, stones: 1, failed: [] })
    expect(result.massG).toBeGreaterThan(3)
  })

  const chromium = findChromium()
  it.skipIf(!chromium)(
    'runs in a browser Worker bundled by Vite and round-trips evaluations',
    async () => {
      const { build } = await import('vite')
      const fs = builtin('node:fs')
      const path = builtin('node:path')
      const outDir = fs.mkdtempSync(path.join(builtin('node:os').tmpdir(), 'pave-kernel-'))
      await build({
        root: here('./testing/browser'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, target: 'esnext', minify: false },
        worker: { format: 'es' },
        // rhino3dm's Emscripten glue names Node's `ws` package on a path browsers never take.
        resolve: { alias: { ws: here('./testing/browser/empty.ts') } },
      })
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }
      const server = builtin('node:http').createServer((req, res) => {
        const file = path.join(outDir, decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/$/, '/index.html'))
        try {
          const body = fs.readFileSync(file)
          res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
          res.end(body)
        } catch {
          res.writeHead(404)
          res.end()
        }
      })
      await new Promise<void>((resolve) => server.listen(0, resolve))
      const browser = await chromium!.launch()
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message ?? ''))
        await page.goto(`http://localhost:${server.address().port}/`)
        await page.waitForFunction('window.kernelCheck !== undefined', undefined, { timeout: 90_000 })
        const result = (await page.evaluate('window.kernelCheck')) as Record<string, unknown>
        expect(errors).toEqual([])
        expect(result).toMatchObject({
          parts: ['band', 'head'],
          typedArrays: true,
          stones: 1,
          bandReused: true,
          productionParts: 1,
          failed: 0,
        })
        expect(result.kinds).toEqual(expect.arrayContaining(['ringShank', 'gem', 'setting']))
        expect(result.carat as number).toBeCloseTo(1, 1)
      } finally {
        await browser.close()
        server.close()
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
