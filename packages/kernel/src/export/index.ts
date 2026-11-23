/**
 * The exporter registry: one writer per file format. A format that is not listed here makes
 * `Kernel.export` reject with a clear message.
 *
 * To add a format, create `export/<format>.ts` exporting `defineExporter({ format, detail, run })`
 * (see ../core.ts for the `Scene` it receives) and add it to this list.
 */
import type { Exporter } from '../core'
import { glb } from './glbFormat'

export const EXPORTERS: readonly Exporter[] = [glb]
