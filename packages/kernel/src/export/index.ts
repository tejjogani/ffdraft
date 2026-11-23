/**
 * The exporter registry: one writer per file format. A format that is not listed here makes
 * `Kernel.export` reject with a clear message.
 *
 * To add a format, create `export/<format>.ts` exporting `defineExporter({ format, detail, run })`
 * (see ../core.ts for the `Scene` it receives) and add it to this list.
 */
import type { Exporter } from '../core'
import { glb } from './glbFormat'
import { obj } from './obj'
import { rhino3dm } from './rhino3dm'
import { step } from './step'
import { stl } from './stl'
import { threeMf } from './threemf'

export const EXPORTERS: readonly Exporter[] = [glb, stl, threeMf, obj, step, rhino3dm]
