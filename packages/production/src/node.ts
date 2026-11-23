/// <reference types="node" />
/**
 * Node entry: the same builder, with the embedded fonts loaded from the fontsource packages.
 * Paths resolve from this module's URL (not the working directory), so the server finds them on
 * macOS, Linux and Windows alike.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { type BuildInput, type ProductionPackage, buildProductionPackage as build } from './bundle'
import { FONT_FILES, type FontSet } from './fonts'

export * from './index'

const require = createRequire(import.meta.url)
const load = async (spec: string) => new Uint8Array(await readFile(require.resolve(spec)))

let cached: Promise<FontSet> | undefined

export function loadFonts(): Promise<FontSet> {
  cached ??= Promise.all([
    load(FONT_FILES.regular),
    load(FONT_FILES.medium),
    load(FONT_FILES.semibold),
    load(FONT_FILES.serif),
  ]).then(([regular, medium, semibold, serif]) => ({ sans: { regular, medium, semibold }, serif }))
  return cached
}

/** {@link build} with `fonts` optional: defaults to the bundled Inter and Instrument Serif. */
export async function buildProductionPackage(
  input: Omit<BuildInput, 'fonts'> & { fonts?: FontSet },
): Promise<ProductionPackage> {
  return build({ ...input, fonts: input.fonts ?? (await loadFonts()) })
}
