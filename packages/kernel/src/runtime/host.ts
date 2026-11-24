/**
 * Host detection and file access that works in Node, Electron and browsers from one module.
 *
 * Node built-ins are reached through `process.getBuiltinModule` (Node ≥ 20.16) instead of
 * `import 'node:…'`, so browser bundles contain no Node imports and the package typechecks
 * without Node typings. Files are always addressed by URL or through the module resolver —
 * never by string-built paths or the working directory — so Windows drive letters and spaces
 * in paths are handled by the platform.
 */

interface NodeBuiltins {
  'node:fs/promises': { readFile(path: string | URL): Promise<Uint8Array> }
  'node:module': { createRequire(from: string | URL): { resolve(specifier: string): string } }
}

interface NodeProcess {
  versions?: { node?: string }
  getBuiltinModule?<K extends keyof NodeBuiltins>(name: K): NodeBuiltins[K]
}

const nodeProcess = (): NodeProcess | undefined => (globalThis as { process?: NodeProcess }).process

/** The Node version when running under Node (whether or not its built-ins are reachable). */
export const nodeVersion = (): string | undefined => nodeProcess()?.versions?.node

/** True when Node's built-in modules are available (Node, Electron main, vitest). */
export const isNode = (): boolean => typeof nodeProcess()?.getBuiltinModule === 'function'

function builtin<K extends keyof NodeBuiltins>(name: K): NodeBuiltins[K] {
  const get = nodeProcess()?.getBuiltinModule
  if (!get) throw new Error('Node built-in modules are not available in this environment')
  return get(name)
}

/** Reads a file exported by an installed package, e.g. `manifold-3d/manifold.wasm`. */
export function readPackageFile(specifier: string): Promise<Uint8Array> {
  const { resolve } = builtin('node:module').createRequire(import.meta.url)
  return builtin('node:fs/promises').readFile(resolve(specifier))
}

/**
 * Loads a file bundled with this package (fonts). Build the URL with
 * `new URL('./file', import.meta.url)`: Vite rewrites that to a hashed asset URL, Node resolves
 * it to a `file:` URL.
 */
export async function loadBundledAsset(url: URL): Promise<Uint8Array> {
  if (url.protocol === 'file:') return builtin('node:fs/promises').readFile(url)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** `setImmediate` where it exists (Node), otherwise undefined. */
export const hostSetImmediate = (globalThis as { setImmediate?: (fn: () => void) => unknown })
  .setImmediate
