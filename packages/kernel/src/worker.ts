/**
 * The kernel as a module Worker (bundled by Vite): `new Worker(new URL('./worker.ts',
 * import.meta.url), { type: 'module' })`, which is what `createKernelClient()` does.
 *
 * The WASM binaries are referenced with Vite's `?url` imports so they are emitted as separate,
 * replaceable assets (the LGPL condition for OpenCascade) and fetched by the runtime loader.
 */
import manifoldWasm from 'manifold-3d/manifold.wasm?url'
import occtWasm from 'replicad-opencascadejs/wasm?url'
import { createKernel } from './kernel'
import type { Port, Request, Response } from './protocol'
import { configureRuntime } from './runtime/index'
import { serveKernel } from './workerHost'

configureRuntime({ occt: occtWasm, manifold: manifoldWasm })
serveKernel(createKernel(), globalThis as unknown as Port<Response, Request>)
