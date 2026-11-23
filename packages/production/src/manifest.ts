/**
 * manifest.json (research Decisions): units, the shrinkage declaration, per-part volume,
 * triangles, weight and SHA-256, the profile and price provenance — the machine-readable record
 * a caster or an ERP can verify the bundle against. Deterministic: no clocks, no timings.
 */
import { METALS } from '@pave/schema'
import pkg from '../package.json' with { type: 'json' }
import type { PackageContext } from './context'
import type { CostEstimate } from './cost'
import type { DfmReport } from './dfm/checks'
import type { ManufacturerProfile } from './dfm/profile'
import type { CadExports, ExportNote } from './exports'
import type { PackageFile } from './types'

export const MANIFEST_SCHEMA = 'pave.production-package/1'
export const GENERATOR = { name: pkg.name, version: pkg.version }

export interface ManifestFile {
  path: string
  bytes: number
  sha256: string
  mime: string
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA
  generator: typeof GENERATOR
  piece: { id: string; title: string; kind: string; sku: string }
  revision: number
  sourceDesignVersion: number | null
  createdAt: string
  author: string
  org: string
  units: 'mm'
  shrinkageCompensated: false
  shrinkage: { note: string; typicalLinearPct: Record<string, number> }
  detail: string
  /** Chordal tessellation tolerance of the casting meshes; null when the kernel does not report it. */
  meshToleranceMm: number | null
  quantity: number
  extentMm: [number, number, number]
  parts: {
    id: string
    nodeId: string
    name: string
    alloy: string
    fineness: number
    densityGcm3: number
    volumeMm3: number
    areaMm2: number
    triangles: number
    netWeightG: number
    watertight: boolean
    file: string
    sha256: string
  }[]
  metals: {
    alloy: string
    netGrams: number
    castingAllowancePct: number
    orderGrams: number
    fineGrams: number
  }[]
  stones: {
    count: number
    caratTotal: number
    lots: {
      key: string
      role: string
      material: string
      cut: string
      widthMm: number
      lengthMm: number
      count: number
      caratEach: number
      caratTotal: number
      setting: string
      origin: string
      suppliedBy: string
    }[]
  }
  profile: ManufacturerProfile
  rates: {
    currency: string
    priceSource: string | null
    priceTimestamp: string | null
    placeholders: string[]
  }
  cost: CostEstimate['perPiece'] & { order: CostEstimate['order'] }
  dfm: DfmReport['summary']
  exportNotes: ExportNote[]
  files: ManifestFile[]
}

const r = (v: number, d: number) => Number(v.toFixed(d))

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildManifest(
  ctx: PackageContext,
  files: readonly PackageFile[],
  cad: CadExports,
  cost: CostEstimate,
  dfm: DfmReport,
): Promise<Manifest> {
  const { piece, evaluation, revision, options } = ctx.input
  const hashes = new Map<string, string>()
  for (const f of files) hashes.set(f.path, await sha256(f.bytes))
  const stl = new Map(cad.stls.map((s) => [s.partId, s]))
  const alloys = [...new Set(evaluation.parts.map((p) => p.material))]
  return {
    schema: MANIFEST_SCHEMA,
    generator: GENERATOR,
    piece: { id: piece.id, title: piece.title, kind: piece.kind, sku: ctx.sku },
    revision,
    sourceDesignVersion: options.sourceVersion ?? null,
    createdAt: options.date,
    author: options.author.name,
    org: options.org.name,
    units: 'mm',
    shrinkageCompensated: false,
    shrinkage: {
      note: 'Nominal geometry. The caster applies its own shrinkage scaling (research §3).',
      typicalLinearPct: Object.fromEntries(alloys.map((a) => [a, METALS[a].shrinkagePct])),
    },
    detail: evaluation.detail,
    // The kernel contract carries no tessellation tolerance yet; say so rather than guess.
    meshToleranceMm: null,
    quantity: ctx.quantity,
    extentMm: ctx.facts.extent.map((v) => r(v, 3)) as [number, number, number],
    parts: evaluation.parts.map((p) => {
      const s = stl.get(p.id)
      return {
        id: p.id,
        nodeId: p.nodeId,
        name: p.name,
        alloy: p.material,
        fineness: METALS[p.material].fineness,
        densityGcm3: METALS[p.material].density,
        volumeMm3: r(p.volumeMm3, 3),
        areaMm2: r(p.areaMm2, 2),
        triangles: cad.triangles[p.id] ?? p.mesh.indices.length / 3,
        netWeightG: r((p.volumeMm3 / 1000) * METALS[p.material].density, 3),
        watertight: s?.topology.watertight ?? false,
        file: s?.path ?? '',
        sha256: s ? (hashes.get(s.path) ?? '') : '',
      }
    }),
    metals: ctx.metals.map((m) => ({
      alloy: m.metal,
      netGrams: r(m.netGrams, 3),
      castingAllowancePct: m.castingAllowancePct,
      orderGrams: r(m.orderGrams, 3),
      fineGrams: r(m.fineGrams, 3),
    })),
    stones: {
      count: evaluation.report.stoneCount,
      caratTotal: r(evaluation.report.caratTotal, 4),
      lots: ctx.lots.map((l) => ({
        key: l.key,
        role: l.lot.role,
        material: l.lot.stone,
        cut: l.lot.cut,
        widthMm: r(l.lot.width, 3),
        lengthMm: r(l.lot.length, 3),
        count: l.lot.count,
        caratEach: r(l.lot.caratEach, 4),
        caratTotal: r(l.lot.caratTotal, 4),
        setting: l.lot.setting,
        origin: l.origin,
        suppliedBy: l.suppliedBy,
      })),
    },
    profile: ctx.profile,
    rates: {
      currency: cost.currency,
      priceSource: cost.priceSource,
      priceTimestamp: cost.priceTimestamp,
      placeholders: cost.placeholders,
    },
    cost: { ...cost.perPiece, order: cost.order },
    dfm: dfm.summary,
    exportNotes: cad.notes,
    files: files.map((f) => ({
      path: f.path,
      bytes: f.bytes.length,
      sha256: hashes.get(f.path)!,
      mime: f.mime,
    })),
  }
}
