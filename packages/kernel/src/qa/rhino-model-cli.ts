import { ok } from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { MAX_RHINO_FILE_BYTES, readRhino3dm } from '../import/rhino'
import { createKernel } from '../kernel'
import { loadRhino3dm } from '../runtime/rhino'
import { archive, counts, sourceArchive } from './rhino-archive'
import { hasSolidPreview, probeBodies, probeCurves } from './rhino-model-probes'
import { probeNativeCaps, probeNativeEdges, retainedParts } from './rhino-native-probes'

const usage = 'Usage: pnpm cad:check-rhino <file.3dm> [more.3dm ...]'

async function sha256(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function check(file: string, index: number) {
  const report = {
    fileNumber: index + 1,
    result: 'failed' as 'passed' | 'failed',
    sha256: {} as { before?: string; after?: string },
    source: undefined as ReturnType<typeof sourceArchive>['report'] | undefined,
    imported: undefined as Record<string, unknown> | undefined,
    curves: undefined as Awaited<ReturnType<typeof probeCurves>> | undefined,
    bodies: undefined as Awaited<ReturnType<typeof probeBodies>> | undefined,
    nativeEdges: undefined as Awaited<ReturnType<typeof probeNativeEdges>> | undefined,
    nativeCaps: undefined as Awaited<ReturnType<typeof probeNativeCaps>> | undefined,
    failure: undefined as { stage: string; detail: string } | undefined,
  }
  const kernel = createKernel()
  let stage = 'read source'
  try {
    ok(/\.3dm$/i.test(file), 'Expected a local .3dm file.')
    const source = await stat(file)
    ok(source.isFile(), 'Expected a regular file.')
    ok(source.size <= MAX_RHINO_FILE_BYTES, 'The archive exceeds the Rhino import size limit.')
    const bytes = await readFile(file)
    report.sha256.before = createHash('sha256').update(bytes).digest('hex')

    stage = 'Rhino import'
    const imported = await readRhino3dm(bytes, { includeCurves: true })
    const parts = imported.objects.filter(hasSolidPreview)
    const total = imported.objects.length + imported.curves.length + imported.skipped.length
    const previewSkipped = imported.objects.length - parts.length
    report.imported = {
      units: imported.units,
      meshParts: parts.length,
      nativeParts: parts.filter(({ native }) => native).length,
      placedNativeParts: parts.filter(({ native }) => native?.instancePath.length).length,
      editableCurves: imported.curves.length,
      convertedCurves: imported.curves.filter(({ converted }) => converted).length,
      rationalCurves: imported.curves.filter(({ controlPoints }) =>
        controlPoints.some((point) => point[3] !== 1),
      ).length,
      layersWithGeometry: new Set([...parts, ...imported.curves].map(({ layer }) => layer)).size,
      skipped: imported.skipped.length + previewSkipped,
      previewSkipped,
      skipReasons: counts(imported.skipped.map(({ reason }) => reason)),
    }

    stage = 'source inventory'
    const rhino = await loadRhino3dm()
    const sourceData = archive(rhino, bytes, (doc, hold) => sourceArchive(rhino, doc, hold))
    report.source = sourceData.report
    ok(
      sourceData.report.visibleEntries === total,
      'Visible source entries differ from the imported and skipped totals.',
    )
    ok(sourceData.unit?.[1] === imported.units, 'Importer reported different model units.')

    stage = 'usable geometry'
    ok(
      parts.length || imported.curves.length,
      'No supported solid preview or editable curve can be checked.',
    )

    stage = 'NURBS readback'
    report.curves = await probeCurves(
      rhino,
      kernel,
      bytes,
      imported.curves,
      sourceData.directCurves,
      sourceData.unit?.[0],
    )

    stage = 'body edit readback'
    report.bodies = await probeBodies(rhino, kernel, parts)

    const native = retainedParts(parts)
    stage = 'exact native edge readback'
    report.nativeEdges = await probeNativeEdges(rhino, bytes, native, sourceData.unit[0])
    stage = 'native end-cap readback'
    report.nativeCaps = await probeNativeCaps(rhino, bytes, native, sourceData.unit[0])
    report.result = 'passed'
  } catch (error) {
    report.failure = {
      stage,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    kernel.dispose()
    if (report.sha256.before) {
      try {
        report.sha256.after = await sha256(file)
        ok(report.sha256.before === report.sha256.after, 'Source bytes changed during the check.')
      } catch (error) {
        report.result = 'failed'
        report.failure = {
          stage: 'source digest',
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }
  return report
}

try {
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  })
  if (values.help) {
    console.log(usage)
  } else {
    if (!positionals.length) throw new Error(usage)
    for (const [index, file] of positionals.entries()) {
      const report = await check(file, index)
      console.log(JSON.stringify(report))
      if (report.result === 'failed') process.exitCode = 1
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
