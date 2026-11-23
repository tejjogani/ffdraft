/**
 * buildProductionPackage: one finished CAD in, the casting house's whole package out — drawings,
 * spec sheet, CAD, BOM, stone list, cost estimate, DFM report, RFQ and manifest — as files and a
 * zip in the research layout (`<sku>_r<rev>_production/…`). Pure: no clocks, no network, no
 * file system; identical input gives identical bytes.
 */

import { METALS } from '@pave/schema'
import { zipSync } from 'fflate'
import { billOfMaterials, bomCsv, stoneRows, stonesCsv } from './bom'
import { createContext, stampLocation } from './context'
import { estimateCost } from './cost'
import { encodeCsv } from './csv'
import { runDfm } from './dfm/checks'
import {
  buildDrawingSet,
  composeArrangement,
  composeViewSheet,
  type TitleInfo,
  VIEW_ORDER,
} from './drawing/sheet'
import { exportCad } from './exports'
import { createTypesetter } from './fonts'
import { buildManifest, type Manifest } from './manifest'
import { bundleRoot, joinPath, safeSegment, uniqueName } from './paths'
import { drawingFrame, PAPER } from './pdf/flow'
import { specSheetPdf } from './pdf/spec-sheet'
import { sheetToSvg } from './render/svg'
import { rfqEmail } from './rfq'
import type { BuildInput, PackageFile } from './types'

export type { BuildInput }

export interface ProductionPackage {
  zip: Uint8Array
  manifest: Manifest
  /** Paths are relative to `root`; the zip holds them under `root/`. */
  files: PackageFile[]
  root: string
  /** Wall-clock milliseconds per stage (not part of the bundle, which stays deterministic). */
  timings: Record<string, number>
}

const json = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`)
const text = (s: string) => new TextEncoder().encode(s)

export async function buildProductionPackage(input: BuildInput): Promise<ProductionPackage> {
  const date = new Date(input.options.date)
  if (Number.isNaN(date.getTime()))
    throw new Error(`options.date is not a valid date: ${input.options.date}`)
  if (!Number.isInteger(input.options.quantity) || input.options.quantity < 1)
    throw new Error('options.quantity must be a positive integer')

  const timings: Record<string, number> = {}
  const time = async <T>(stage: string, f: () => T | Promise<T>): Promise<T> => {
    const t0 = performance.now()
    const r = await f()
    timings[stage] = Math.round(performance.now() - t0)
    return r
  }

  const ctx = createContext(input)
  const ts = createTypesetter(input.fonts)
  const { piece, evaluation, options, revision } = input
  const root = bundleRoot(ctx.sku, revision)

  const drawings = await time('drawings', () =>
    buildDrawingSet(evaluation, ctx.facts, { units: ctx.units, stampLocation: stampLocation(ctx) }),
  )
  const cad = await time('cad', () => exportCad(ctx))
  const dfm = await time('dfm', () => runDfm(ctx, cad.stls))
  const cost = estimateCost(ctx)
  const stones = stoneRows(ctx)

  const title: TitleInfo = {
    org: options.org.name,
    title: piece.title,
    subtitle: `${piece.kind} · production drawing`,
    sku: ctx.sku,
    revision: `r${revision}`,
    date: options.date.slice(0, 10),
    author: options.author.name,
    material: [...new Set(evaluation.parts.map((p) => METALS[p.material].label))].join(', '),
    units: ctx.units,
  }

  const files: PackageFile[] = []
  const pdf = await time('pdf', () =>
    specSheetPdf({ ctx, drawings, title, stones, cost, dfm, exportNotes: cad.notes, ts }),
  )
  files.push({ path: 'spec-sheet.pdf', bytes: pdf, mime: 'application/pdf' })

  await time('svg', () => {
    // The sheet matches the PDF's drawing page, so the SVG and the printout share one scale.
    const { sheet, scale } = composeArrangement(
      drawings,
      ts.measure,
      drawingFrame(PAPER[options.paper ?? 'a4']),
      title,
    )
    files.push({
      path: 'drawings/sheet.svg',
      bytes: text(sheetToSvg(sheet, `${piece.title} — general arrangement`)),
      mime: 'image/svg+xml',
    })
    for (const id of VIEW_ORDER) {
      const view = composeViewSheet(drawings, id, scale, ts.measure, title)
      if (view)
        files.push({
          path: `drawings/${id}.svg`,
          bytes: text(sheetToSvg(view, `${piece.title} — ${id}`)),
          mime: 'image/svg+xml',
        })
    }
  })

  files.push(...cad.files)
  files.push({ path: 'bom.csv', bytes: encodeCsv(bomCsv(billOfMaterials(ctx))), mime: 'text/csv' })
  files.push({ path: 'stones.csv', bytes: encodeCsv(stonesCsv(stones)), mime: 'text/csv' })
  files.push({ path: 'cost-estimate.json', bytes: json(cost), mime: 'application/json' })
  files.push({ path: 'dfm-report.json', bytes: json(dfm), mime: 'application/json' })

  const taken = new Set<string>()
  for (const r of input.renders ?? []) {
    const ext = r.mime === 'image/png' ? 'png' : 'jpg'
    const name = uniqueName(
      `${safeSegment(r.name.replace(/\.(png|jpe?g)$/i, ''), 'render')}.${ext}`,
      taken,
    )
    files.push({ path: joinPath('renders', name), bytes: r.bytes, mime: r.mime })
  }

  const listed = [
    ...files,
    { path: 'rfq-email.md', bytes: new Uint8Array(0), mime: 'text/markdown' },
    { path: 'manifest.json', bytes: new Uint8Array(0), mime: 'application/json' },
  ]
  files.push({
    path: 'rfq-email.md',
    bytes: text(rfqEmail(ctx, listed, root, cost, dfm)),
    mime: 'text/markdown',
  })

  const manifest = await time('manifest', () => buildManifest(ctx, files, cad, cost, dfm))
  files.push({ path: 'manifest.json', bytes: json(manifest), mime: 'application/json' })

  const zip = await time('zip', () => {
    // fflate writes DOS timestamps from local-time fields; build the Date from the UTC fields
    // so the bytes do not depend on the machine's time zone.
    const mtime = new Date(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    )
    const entries: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {}
    for (const f of files)
      entries[`${root}/${f.path}`] = [f.bytes, { level: f.path.endsWith('.pdf') ? 0 : 6, mtime }]
    return zipSync(entries)
  })
  return { zip, manifest, files, root, timings }
}
