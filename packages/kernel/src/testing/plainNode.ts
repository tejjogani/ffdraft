/**
 * Run with plain Node (`node --import tsx src/testing/plainNode.ts`), outside any bundler or
 * test runner: proves the WASM runtimes, bundled fonts and CommonJS-only dependencies load the
 * way the server loads them. Prints one line of JSON.
 */
import { designFrom } from '@pave/schema'
import { createKernel } from '../kernel'

const kernel = createKernel()
const design = designFrom('ring', [
  { id: 'band', kind: 'ringShank', widthTop: 4, widthBottom: 4 },
  { id: 'stone', kind: 'gem', placement: { type: 'ringTop', shank: 'band' } },
  { id: 'head', kind: 'setting', gem: 'stone' },
  { id: 'text', kind: 'engraving', host: 'band', text: 'Pavé', font: 'script' },
])
const evaluation = await kernel.evaluate(design, { detail: 'production' })
console.log(
  JSON.stringify({
    parts: evaluation.parts.length,
    stones: evaluation.stones.length,
    massG: evaluation.report.metalMassG,
    failed: evaluation.diagnostics.filter((d) => d.code === 'feature.failed').map((d) => d.message),
  }),
)
