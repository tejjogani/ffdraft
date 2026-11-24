/**
 * WASM runtimes: OpenCascade (exact B-rep, through replicad) and Manifold (robust mesh booleans).
 *
 * One loader for every host. In Node (tests, the server, Electron's main process) the binaries
 * are read from the installed packages through the module resolver (see ./host.ts). In a
 * browser the host passes asset URLs (`worker.ts` gets them from Vite's `?url` imports). Both
 * builds are single-threaded: no SharedArrayBuffer and no cross-origin isolation is required,
 * which keeps Safari/WKWebView and Electron renderers working.
 */
import type { ManifoldToplevel } from 'manifold-3d'
import type { OpenCascadeInstance } from 'replicad-opencascadejs'
import { isNode, readPackageFile } from './host'

export interface Runtime {
  oc: OpenCascadeInstance
  manifold: ManifoldToplevel
}

/** Where a `.wasm` comes from: a URL to fetch, or the bytes themselves. */
export type WasmSource = string | URL | ArrayBuffer | Uint8Array

export interface RuntimeSources {
  occt?: WasmSource
  manifold?: WasmSource
}

let sources: RuntimeSources = {}
let loading: Promise<Runtime> | null = null
let loaded: Runtime | null = null

/** Sets where the binaries come from. Call before the first `loadRuntime()`; browsers must. */
export function configureRuntime(next: RuntimeSources): void {
  if (loading) throw new Error('configureRuntime() must be called before the runtime loads')
  sources = { ...sources, ...next }
}

/** Emscripten options for a source: bytes are handed over, URLs are left for it to fetch. */
function moduleOptions(source: WasmSource): Record<string, unknown> {
  // OpenCascade reports progress (e.g. STEP "Statistics on Transfer") on stdout; in a server or
  // CLI that is noise in the caller's output, and nothing in it is needed. Errors still go out.
  const quiet = { print: () => {} }
  if (typeof source === 'string' || source instanceof URL) {
    const href = source.toString()
    return { ...quiet, locateFile: () => href }
  }
  return { ...quiet, wasmBinary: source }
}

async function resolveSources(): Promise<Required<RuntimeSources>> {
  if (sources.occt && sources.manifold) return sources as Required<RuntimeSources>
  if (!isNode())
    throw new Error(
      'Kernel WASM locations are not configured. In a browser, run the kernel through ' +
        'createKernelClient() or call configureRuntime({ occt, manifold }) with asset URLs.',
    )
  return {
    occt: sources.occt ?? (await readPackageFile('replicad-opencascadejs/wasm')),
    manifold: sources.manifold ?? (await readPackageFile('manifold-3d/manifold.wasm')),
  }
}

async function load(): Promise<Runtime> {
  const src = await resolveSources()
  const [replicad, occtModule, manifoldModule] = await Promise.all([
    import('replicad'),
    import('replicad-opencascadejs'),
    import('manifold-3d'),
  ])
  // The generated typings under-declare the Emscripten options (`wasmBinary`, `locateFile`).
  type Init<T> = (options: Record<string, unknown>) => Promise<T>
  const [oc, manifold] = await Promise.all([
    (occtModule.default as unknown as Init<OpenCascadeInstance>)(moduleOptions(src.occt)),
    (manifoldModule.default as unknown as Init<ManifoldToplevel>)(moduleOptions(src.manifold)),
  ])
  manifold.setup()
  replicad.setOC(oc)
  replicad.setManifold(manifold)
  loaded = { oc, manifold }
  return loaded
}

/** Loads both runtimes once; concurrent and repeated calls share the same promise. */
export function loadRuntime(): Promise<Runtime> {
  loading ??= load().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

/** The loaded runtimes. Feature builders only ever run after `loadRuntime()` has resolved. */
export function runtime(): Runtime {
  if (!loaded) throw new Error('Kernel runtime is not loaded; await kernel.ready() first')
  return loaded
}

/**
 * True for a fault inside a WASM module (out-of-bounds memory or table access, `unreachable`):
 * the module's heap can no longer be trusted, so nothing allocated in it may be reused.
 */
export const isRuntimeFault = (error: unknown): boolean =>
  typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError

/**
 * Drops the loaded runtimes after a fault so the next `loadRuntime()` instantiates fresh ones.
 * Objects allocated in the old heaps must be forgotten, not deleted: their memory is gone with it.
 */
export function discardRuntime(): void {
  loaded = null
  loading = null
}
