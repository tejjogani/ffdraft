/**
 * Every export format from a browser Worker, bundled by a plain Vite build — no aliases or
 * host setup — as an app that imports the kernel would ship it.
 */
import { describe, expect, it } from 'vitest'

interface NodeApi {
  'node:url': { fileURLToPath(url: URL): string }
  'node:module': { createRequire(from: string): (id: string) => unknown }
  'node:fs': {
    mkdtempSync(prefix: string): string
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void
    readFileSync(path: string): Uint8Array
  }
  'node:os': { tmpdir(): string }
  'node:path': { join(...parts: string[]): string; extname(path: string): string }
  'node:http': {
    createServer(
      handler: (
        req: { url?: string },
        res: {
          writeHead(status: number, headers?: Record<string, string>): void
          end(body?: Uint8Array): void
        },
      ) => void,
    ): { listen(port: number, done: () => void): void; address(): { port: number }; close(): void }
  }
}
const builtin = <K extends keyof NodeApi>(name: K): NodeApi[K] =>
  (
    globalThis as unknown as { process: { getBuiltinModule(n: K): NodeApi[K] } }
  ).process.getBuiltinModule(name)

interface Browser {
  newPage(): Promise<{
    goto(url: string): Promise<unknown>
    waitForFunction(
      expression: string,
      arg?: unknown,
      options?: { timeout: number },
    ): Promise<unknown>
    evaluate(expression: string): Promise<unknown>
  }>
  close(): Promise<void>
}

/** Playwright, if this machine has it (it is not a dependency of the package). */
function findChromium(): { launch(): Promise<Browser> } | null {
  try {
    const playwright = builtin('node:module').createRequire(import.meta.url)('playwright')
    return (playwright as { chromium: { launch(): Promise<Browser> } }).chromium
  } catch {
    return null
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

describe('exports in a browser', () => {
  const chromium = findChromium()
  it.skipIf(!chromium)(
    'writes every format from the Worker of a plain Vite build',
    async () => {
      const { build } = await import('vite')
      const fs = builtin('node:fs')
      const path = builtin('node:path')
      const outDir = fs.mkdtempSync(path.join(builtin('node:os').tmpdir(), 'pave-exports-'))
      await build({
        root: builtin('node:url').fileURLToPath(new URL('./testing', import.meta.url)),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, target: 'esnext', minify: false },
        worker: { format: 'es' },
      })
      const server = builtin('node:http').createServer((req, res) => {
        const file = path.join(
          outDir,
          decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/$/, '/index.html'),
        )
        try {
          const body = fs.readFileSync(file)
          res.writeHead(200, {
            'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
          })
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
        await page.goto(`http://localhost:${server.address().port}/`)
        await page.waitForFunction('window.exportCheck !== undefined', undefined, {
          timeout: 150_000,
        })
        const sizes = (await page.evaluate('window.exportCheck')) as Record<string, unknown>
        for (const format of ['glb', 'stl', '3mf', 'obj', 'step', '3dm'])
          expect(sizes[format], format).toBeGreaterThan(1000)
      } finally {
        await browser.close()
        server.close()
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    },
    240_000,
  )
})
