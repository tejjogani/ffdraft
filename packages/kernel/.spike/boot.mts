import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as r from 'replicad'
import ocInit from 'replicad-opencascadejs'
import Module from 'manifold-3d'
const require = createRequire(import.meta.url)
export async function boot() {
  const wasmBinary = await readFile(require.resolve('replicad-opencascadejs/wasm'))
  const oc: any = await (ocInit as any)({ wasmBinary })
  r.setOC(oc)
  const mf: any = await (Module as any)({ wasmBinary: await readFile(require.resolve('manifold-3d/manifold.wasm')) })
  mf.setup(); r.setManifold(mf)
  return { oc, r, mf }
}
