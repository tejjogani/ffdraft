/// <reference path="../export/rhino3dmModule.d.ts" />
/// <reference path="./vite.d.ts" />

import type { RhinoModule } from 'rhino3dm'
import { isNode, readPackageFile } from './host'

let loading: Promise<RhinoModule> | null = null

/**
 * rhino3dm, loaded on first use from its ES-module build (the CommonJS entry names Node's `ws`
 * package, which breaks browser bundles). Node reads the binary from the installed package, as
 * the core does for its WASM; in a browser the bundler serves it and Vite's `?url` import gives
 * its address — so 3DM export needs no setup from the host, in a Worker or anywhere else.
 */
export function loadRhino3dm(): Promise<RhinoModule> {
  loading ??= (async () => {
    const { default: factory } = await import('rhino3dm/rhino3dm.module.js')
    if (isNode()) return factory({ wasmBinary: await readPackageFile('rhino3dm/rhino3dm.wasm') })
    const { default: url } = await import('rhino3dm/rhino3dm.wasm?url')
    return factory({ locateFile: () => url })
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

/**
 * Frees a wrapped object's WASM memory with Embind's `delete()`, which rhino3dm's typings omit.
 * The object and string tables define a `delete(key)` of their own (remove an entry) that
 * hides it, so Embind's is looked up where it lives: on the last prototype of the chain.
 */
export function freeRhino(o: object): void {
  let embind: (() => void) | undefined
  for (let proto = Object.getPrototypeOf(o); proto; proto = Object.getPrototypeOf(proto))
    if (Object.hasOwn(proto, 'delete')) embind = (proto as { delete: () => void }).delete
  embind?.call(o)
}
