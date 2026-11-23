/**
 * The manufacturability report: the "DFM checks" of docs/research/02-production.md (Decisions)
 * evaluated against a manufacturer profile, merged with the kernel's own diagnostics. Every check
 * is listed with its threshold and a status — including the ones that could not be evaluated
 * from this data, so a caster can see what was and was not verified.
 */
import type { Diagnostic, StoneInstance } from '@pave/kernel/types'
import { METALS, type MetalFamily, metalMassG } from '@pave/schema'
import { type PackageContext, stampLocation } from '../context'
import { TriangleBVH } from '../geometry/bvh'
import type { Topology } from '../geometry/mesh'
import { type ThicknessReport, wallThickness } from './thickness'

export type Severity = 'error' | 'warning' | 'info'
export type CheckStatus = 'pass' | 'warning' | 'error' | 'not-evaluated'

export interface Finding {
  severity: Severity
  code: string
  message: string
  value?: number
  limit?: number
  unit?: string
  location?: [number, number, number]
  nodeId?: string
  partId?: string
  file?: string
  source: 'pave' | 'kernel'
}

export interface Check {
  code: string
  title: string
  threshold: string
  status: CheckStatus
  findings: Finding[]
  note?: string
}

export interface DfmReport {
  profile: { id: string; name: string }
  summary: { errors: number; warnings: number; passed: number; notEvaluated: number }
  checks: Check[]
  thickness: Record<string, ThicknessReport>
}

/** An exported casting STL with its topology, as read back from the bytes that ship. */
export interface StlCheck {
  path: string
  partId: string
  nodeId: string
  bytes: number
  topology: Topology
}

/** Approximate stroke width of engraving fonts as a fraction of letter height. */
const STROKE_RATIO: Record<string, number> = { sans: 0.12, serif: 0.08, script: 0.07, block: 0.18 }

/** UK Hallmarking Act 1973 exemption weights, g (research §5). */
const UK_HALLMARK_G: Partial<Record<MetalFamily, number>> = {
  gold: 1,
  silver: 7.78,
  platinum: 0.5,
  palladium: 1,
}

const mm = (v: number) => `${v.toFixed(2)} mm`

export function runDfm(ctx: PackageContext, stls: readonly StlCheck[]): DfmReport {
  const { profile: P, input } = ctx
  const { design, evaluation } = input
  const checks: Check[] = []
  const add = (
    code: string,
    title: string,
    threshold: string,
    findings: Finding[],
    note?: string,
    evaluated = true,
  ) => {
    const status: CheckStatus = !evaluated
      ? 'not-evaluated'
      : findings.some((f) => f.severity === 'error')
        ? 'error'
        : findings.some((f) => f.severity === 'warning')
          ? 'warning'
          : 'pass'
    checks.push({ code, title, threshold, status, findings, ...(note ? { note } : {}) })
  }
  const kernel = (prefixes: string[]) =>
    evaluation.diagnostics
      .filter((d) => prefixes.some((p) => d.code.startsWith(p)))
      .map(fromDiagnostic)
  const nodes = design.order.map((id) => design.nodes[id]!).filter(Boolean)

  // ── Mesh closed, manifold, outward, one shell per part ──
  {
    const f: Finding[] = []
    for (const s of stls) {
      const t = s.topology
      const base = { source: 'pave' as const, partId: s.partId, nodeId: s.nodeId, file: s.path }
      if (t.boundaryEdges)
        f.push({
          ...base,
          severity: 'error',
          code: 'mesh.open',
          message: `${s.path}: ${t.boundaryEdges} open edges — not watertight`,
          value: t.boundaryEdges,
          limit: 0,
        })
      if (t.nonManifoldEdges)
        f.push({
          ...base,
          severity: 'error',
          code: 'mesh.nonManifold',
          message: `${s.path}: ${t.nonManifoldEdges} non-manifold edges`,
          value: t.nonManifoldEdges,
          limit: 0,
        })
      if (t.misorientedEdges)
        f.push({
          ...base,
          severity: 'error',
          code: 'mesh.orientation',
          message: `${s.path}: ${t.misorientedEdges} edges with inconsistent winding`,
          value: t.misorientedEdges,
          limit: 0,
        })
      if (t.volumeMm3 <= 0)
        f.push({
          ...base,
          severity: 'error',
          code: 'mesh.inverted',
          message: `${s.path}: normals point inward (negative volume)`,
        })
      const solids = t.shellVolumes.filter((v) => v > 0).length
      if (solids > 1)
        f.push({
          ...base,
          severity: 'error',
          code: 'mesh.shells',
          message: `${s.path}: ${solids} separate shells in one part`,
          value: solids,
          limit: 1,
        })
    }
    add(
      'mesh',
      'Mesh closed, manifold, normals outward, single shell per part',
      'any failure = error',
      f,
      `Checked on the exported STL bytes (${stls.length} file${stls.length === 1 ? '' : 's'}).`,
    )
  }

  // ── Envelope and minimum extent ──
  {
    const f: Finding[] = []
    const env = [...P.envelopeMm].sort((a, b) => a - b)
    for (const part of evaluation.parts) {
      const ext = [0, 1, 2]
        .map((a) => part.bounds.max[a]! - part.bounds.min[a]!)
        .sort((a, b) => a - b)
      const base = { source: 'pave' as const, partId: part.id, nodeId: part.nodeId, unit: 'mm' }
      if (ext.some((e, i) => e > env[i]!)) {
        f.push({
          ...base,
          severity: 'error',
          code: 'envelope.exceeded',
          message: `${part.name} ${ext.map((e) => e.toFixed(1)).join(' × ')} mm exceeds the ${env.join(' × ')} mm envelope`,
        })
      }
      if (ext[0]! < P.minExtentMm) {
        f.push({
          ...base,
          severity: 'warning',
          code: 'envelope.small',
          message: `${part.name} is only ${mm(ext[0]!)} in its smallest extent`,
          value: ext[0]!,
          limit: P.minExtentMm,
        })
      }
    }
    add(
      'envelope',
      'Units and bounding box',
      `envelope ${P.envelopeMm.join(' × ')} mm; warn below ${P.minExtentMm} mm`,
      f,
      'All files are in millimetres.',
    )
  }

  // ── File size and triangle count ──
  {
    const f: Finding[] = []
    for (const s of stls) {
      const mb = s.bytes / (1024 * 1024)
      if (mb > P.maxFileMb)
        f.push({
          source: 'pave',
          severity: 'error',
          code: 'file.size',
          message: `${s.path} is ${mb.toFixed(1)} MB`,
          value: mb,
          limit: P.maxFileMb,
          unit: 'MB',
          file: s.path,
        })
      if (s.topology.triangles > P.maxTriangles)
        f.push({
          source: 'pave',
          severity: 'error',
          code: 'file.triangles',
          message: `${s.path} has ${s.topology.triangles.toLocaleString('en-US')} triangles`,
          value: s.topology.triangles,
          limit: P.maxTriangles,
          file: s.path,
        })
    }
    add(
      'file',
      'File size / triangle count',
      `> ${P.maxFileMb} MB or > ${P.maxTriangles.toLocaleString('en-US')} triangles = error`,
      f,
    )
  }

  // ── Wall thickness (measured) ──
  const thickness: Record<string, ThicknessReport> = {}
  const inPaveZone = paveZones(evaluation.stones)
  const bvhs = new Map<string, TriangleBVH>()
  {
    const f: Finding[] = []
    for (const part of evaluation.parts) {
      const tris = { positions: part.mesh.positions, indices: part.mesh.indices }
      const bvh = new TriangleBVH(tris)
      bvhs.set(part.id, bvh)
      const r = wallThickness(tris, bvh, { threshold: P.wall.warnMm, exclude: inPaveZone })
      thickness[part.id] = r
      // A region needs two readings: a single ray can graze a seat edge or a sliver facet.
      for (const g of r.regions.filter((g) => g.samples >= 2)) {
        const severity: Severity = g.thicknessMm < P.wall.errorMm ? 'error' : 'warning'
        f.push({
          source: 'pave',
          severity,
          code: 'wall.thin',
          message: `${part.name}: wall ${mm(g.thicknessMm)} near (${g.at.map((v) => v.toFixed(1)).join(', ')}) — ${g.samples} thin readings`,
          value: round3(g.thicknessMm),
          limit: severity === 'error' ? P.wall.errorMm : P.wall.warnMm,
          unit: 'mm',
          location: g.at.map(round3) as [number, number, number],
          partId: part.id,
          nodeId: part.nodeId,
        })
      }
    }
    for (const n of nodes) {
      if (n.kind !== 'ringShank') continue
      for (const [where, t] of [
        ['top', n.thicknessTop],
        ['base', n.thicknessBottom],
      ] as const) {
        if (t < P.wall.ringShankWarnMm)
          f.push({
            source: 'pave',
            severity: t < P.wall.errorMm ? 'error' : 'warning',
            code: 'wall.shank',
            message: `Ring shank ${mm(t)} thick at the ${where}`,
            value: t,
            limit: P.wall.ringShankWarnMm,
            unit: 'mm',
            nodeId: n.id,
          })
      }
    }
    f.push(...kernel(['wall.']))
    const skipped = Object.values(thickness).reduce((t, r) => t + r.excluded, 0)
    add(
      'wall',
      'Wall thickness',
      `< ${P.wall.errorMm} mm error; < ${P.wall.warnMm} mm warn; ring shank < ${P.wall.ringShankWarnMm} mm warn`,
      f,
      `Sampled inward ray casts on each casting mesh (deterministic)${skipped ? '; pavé seat zones are left to the seat, bead and border rules' : ''}.`,
    )
  }

  // ── Prongs ──
  {
    const f: Finding[] = []
    let evaluated = false
    for (const n of nodes) {
      if (n.kind !== 'setting' || (n.style !== 'prong' && n.style !== 'basket')) continue
      evaluated = true
      const d = n.prongDiameter
      const gem = design.nodes[n.gem]
      const stone = evaluation.stones.find((s) => s.nodeId === n.gem)
      const clearance =
        gem?.kind === 'gem' && gem.placement.type === 'ringTop' ? gem.placement.elevation : 0
      // Claw length ≈ the stone's depth plus its seat clearance: base of the head to the tip.
      const length = (stone?.dims.depth ?? 0) + clearance
      const base = { source: 'pave' as const, nodeId: n.id, unit: 'mm', value: d }
      if (d < P.prong.errorMm)
        f.push({
          ...base,
          severity: 'error',
          code: 'prong.thin',
          message: `${n.name ?? n.id}: prong ${mm(d)}`,
          limit: P.prong.errorMm,
        })
      else if (d < P.prong.warnMm)
        f.push({
          ...base,
          severity: 'warning',
          code: 'prong.thin',
          message: `${n.name ?? n.id}: prong ${mm(d)}`,
          limit: P.prong.warnMm,
        })
      else if (length > P.prong.longRatio * d && d < P.prong.longWarnMm) {
        f.push({
          ...base,
          severity: 'warning',
          code: 'prong.long',
          message: `${n.name ?? n.id}: ${mm(d)} prong about ${mm(length)} long (> ${P.prong.longRatio}× diameter)`,
          limit: P.prong.longWarnMm,
        })
      }
    }
    f.push(...kernel(['prong.']))
    add(
      'prong',
      'Prong / claw diameter',
      `< ${P.prong.errorMm} mm error; < ${P.prong.warnMm} mm warn; < ${P.prong.longWarnMm} mm if longer than ${P.prong.longRatio}× diameter`,
      f,
      undefined,
      evaluated || f.length > 0,
    )
  }

  // ── Bezel and channel walls ──
  {
    const f: Finding[] = []
    let evaluated = false
    for (const n of nodes) {
      if (n.kind === 'setting' && (n.style === 'bezel' || n.style === 'halfBezel')) {
        evaluated = true
        if (n.wall < P.bezelWallMm)
          f.push({
            source: 'pave',
            severity: 'error',
            code: 'bezel.thin',
            message: `${n.name ?? n.id}: bezel wall ${mm(n.wall)}`,
            value: n.wall,
            limit: P.bezelWallMm,
            unit: 'mm',
            nodeId: n.id,
          })
      }
    }
    f.push(...kernel(['bezel.', 'channel.']))
    const hasChannel = nodes.some((n) => n.kind === 'gemRow' && n.setting === 'channel')
    add(
      'bezel',
      'Bezel wall / channel wall',
      `< ${P.bezelWallMm} / < ${P.channelWallMm} mm error`,
      f,
      hasChannel ? 'Channel walls are covered by the measured wall check.' : undefined,
      evaluated || hasChannel || f.length > 0,
    )
  }

  // ── Beads ──
  {
    const f = kernel(['bead.'])
    const beaded = nodes.some((n) => n.kind === 'pave' && n.beads)
    add(
      'bead',
      'Bead diameter',
      `outside ${P.beadMm.min}–${P.beadMm.max} mm = error`,
      f,
      beaded && !f.length
        ? 'Bead size is set by the kernel layout and was not reported; confirm on the wax.'
        : undefined,
      f.length > 0 || !beaded,
    )
  }

  // ── Pavé border ──
  {
    const f: Finding[] = []
    for (const n of nodes) {
      if (n.kind !== 'pave') continue
      if (n.margin < P.paveBorderWarnMm) {
        const host = design.nodes[n.host]
        const rim = host?.kind === 'vectorBody' ? host.border : 0
        if (rim + n.margin < P.paveBorderWarnMm) {
          f.push({
            source: 'pave',
            severity: 'warning',
            code: 'pave.border',
            message: `${n.name ?? n.id}: ${mm(rim + n.margin)} of metal between the outer stones and the edge`,
            value: round3(rim + n.margin),
            limit: P.paveBorderWarnMm,
            unit: 'mm',
            nodeId: n.id,
          })
        }
      }
    }
    add(
      'pave-border',
      'Pavé border',
      `< ${P.paveBorderWarnMm} mm warn`,
      f,
      undefined,
      nodes.some((n) => n.kind === 'pave'),
    )
  }

  // ── Openings ──
  {
    const f = kernel(['opening.', 'gap.'])
    add(
      'opening',
      'Opening or slot width',
      `< ${P.opening.errorMm} mm error; < ${P.opening.warnMm} mm warn`,
      f,
      f.length ? undefined : 'Needs the kernel’s opening analysis; none reported.',
      f.length > 0,
    )
  }

  // ── Engraving text ──
  {
    const f: Finding[] = []
    const engr = nodes.filter((n) => n.kind === 'engraving')
    for (const n of engr) {
      const width = n.size * (STROKE_RATIO[n.font] ?? 0.1)
      const base = { source: 'pave' as const, nodeId: n.id, unit: 'mm' }
      if (n.mode === 'engrave') {
        if (width < P.recessedText.minWidthMm)
          f.push({
            ...base,
            severity: 'error',
            code: 'text.recessed.width',
            message: `“${n.text}”: strokes about ${mm(width)} wide`,
            value: round3(width),
            limit: P.recessedText.minWidthMm,
          })
        if (n.depth > P.recessedText.maxDepthMm)
          f.push({
            ...base,
            severity: 'error',
            code: 'text.recessed.depth',
            message: `“${n.text}”: ${mm(n.depth)} deep`,
            value: n.depth,
            limit: P.recessedText.maxDepthMm,
          })
        else if (n.depth / width > P.recessedText.maxDepthToWidth)
          f.push({
            ...base,
            severity: 'warning',
            code: 'text.recessed.ratio',
            message: `“${n.text}”: depth:width ${(n.depth / width).toFixed(2)}:1`,
            value: round3(n.depth / width),
            limit: P.recessedText.maxDepthToWidth,
            unit: '',
          })
      } else {
        if (width < P.raisedText.minWidthMm)
          f.push({
            ...base,
            severity: 'error',
            code: 'text.raised.width',
            message: `“${n.text}”: strokes about ${mm(width)} wide`,
            value: round3(width),
            limit: P.raisedText.minWidthMm,
          })
        if (n.depth > P.raisedText.maxHeightMm)
          f.push({
            ...base,
            severity: 'warning',
            code: 'text.raised.height',
            message: `“${n.text}”: raised ${mm(n.depth)}`,
            value: n.depth,
            limit: P.raisedText.maxHeightMm,
          })
      }
    }
    add(
      'text',
      'Recessed / raised text',
      `recessed: width < ${P.recessedText.minWidthMm} or depth > ${P.recessedText.maxDepthMm} mm error, depth:width > 1:1 warn; raised: width < ${P.raisedText.minWidthMm} error, height > ${P.raisedText.maxHeightMm} mm warn`,
      f,
      engr.length ? 'Stroke width estimated from letter height and font.' : undefined,
      engr.length > 0,
    )
  }

  // ── Polish allowance ──
  {
    const f: Finding[] = []
    for (const part of evaluation.parts) {
      const t = thickness[part.id]
      if (part.finish !== 'polished' || !t) continue
      const thin = t.regions.filter((g) => g.samples >= 2 && g.thicknessMm < P.polishWallWarnMm)
      if (thin.length)
        f.push({
          source: 'pave',
          severity: 'warning',
          code: 'polish.allowance',
          message: `${part.name}: high-polish wall down to ${mm(thin[0]!.thicknessMm)}; polishing removes 0.1–0.2 mm`,
          value: round3(thin[0]!.thicknessMm),
          limit: P.polishWallWarnMm,
          unit: 'mm',
          partId: part.id,
          nodeId: part.nodeId,
          location: thin[0]!.at.map(round3) as [number, number, number],
        })
    }
    add('polish', 'Polish allowance', `high-polish wall < ${P.polishWallWarnMm} mm warn`, f)
  }

  // ── Stone seats ──
  {
    const f: Finding[] = kernel(['seat.', 'stone.'])
    for (const s of evaluation.stones) {
      const c: [number, number, number] = [s.matrix[12]!, s.matrix[13]!, s.matrix[14]!]
      for (const part of evaluation.parts) {
        const b = part.bounds
        if (c.some((v, a) => v < b.min[a]! || v > b.max[a]!)) continue
        if (bvhs.get(part.id)!.contains(...c)) {
          f.push({
            source: 'pave',
            severity: 'error',
            code: 'seat.collision',
            message: `Stone ${s.id} sits inside ${part.name}: no seat cut`,
            location: c.map(round3) as [number, number, number],
            nodeId: s.nodeId,
            partId: part.id,
          })
          break
        }
      }
    }
    add(
      'seat',
      'Stone seat fit',
      `stone inside metal = error; seat outside ${P.seatGirdlePct.min}–${P.seatGirdlePct.max}% of girdle warn`,
      f,
      'Collision tested at every stone’s girdle centre; seat proportion needs the kernel’s seat report.',
      evaluation.stones.length > 0,
    )
  }

  // ── Hollow parts ──
  {
    const f: Finding[] = []
    for (const s of stls) {
      const cavities = s.topology.shellVolumes.filter((v) => v < 0).length
      if (cavities)
        f.push({
          source: 'pave',
          severity: 'error',
          code: 'hollow.sealed',
          message: `${s.path}: ${cavities} sealed internal cavit${cavities === 1 ? 'y' : 'ies'} — no escape hole`,
          partId: s.partId,
          nodeId: s.nodeId,
          file: s.path,
        })
    }
    for (const n of nodes) {
      if (n.kind !== 'meshBody' || n.hollow <= 0) continue
      if (!P.hollow.accepted)
        f.push({
          source: 'pave',
          severity: 'error',
          code: 'hollow.refused',
          message: `${n.name ?? n.id} is hollow; this manufacturer does not cast hollow pieces`,
          nodeId: n.id,
        })
      if (n.hollow < P.hollow.minShellMm)
        f.push({
          source: 'pave',
          severity: 'warning',
          code: 'hollow.shell',
          message: `${n.name ?? n.id}: shell ${mm(n.hollow)}`,
          value: n.hollow,
          limit: P.hollow.minShellMm,
          unit: 'mm',
          nodeId: n.id,
        })
    }
    f.push(...kernel(['hollow.']))
    add(
      'hollow',
      'Hollow part',
      `no escape hole = error; shell < ${P.hollow.minShellMm} mm or hole < ${P.hollow.minHoleMm} mm warn`,
      f,
    )
  }

  // ── Shrinkage declaration ──
  add(
    'shrinkage',
    'Shrinkage flag',
    'manifest flag missing = error; scaled model when the caster compensates = warn',
    P.casterCompensatesShrinkage
      ? []
      : [
          {
            source: 'pave',
            severity: 'warning',
            code: 'shrinkage.compensation',
            message:
              'This manufacturer expects shrink-compensated files; Pavé sends nominal geometry — agree the scale factor before casting.',
          },
        ],
    'Files are nominal (shrinkage_compensated: false in manifest.json).',
  )

  // ── Weight against target ──
  {
    const f: Finding[] = []
    const target = input.spec?.targetWeightG
    const mass = evaluation.report.metalMassG
    if (target) {
      const dev = ((mass - target) / target) * 100
      if (Math.abs(dev) > P.weightTolerancePct)
        f.push({
          source: 'pave',
          severity: 'warning',
          code: 'weight.target',
          message: `Metal weight ${mass.toFixed(2)} g is ${dev > 0 ? '+' : ''}${dev.toFixed(1)}% from the ${target} g target`,
          value: round3(mass),
          limit: target,
          unit: 'g',
        })
    }
    add(
      'weight',
      'Weight',
      `outside target ±${P.weightTolerancePct}% warn`,
      f,
      target ? undefined : 'No target weight in the piece spec.',
      !!target,
    )
  }

  // ── Hallmark ──
  {
    const f: Finding[] = []
    // The drawings always place the stamp (designer's choice or the default for the piece kind).
    const location = stampLocation(ctx)
    for (const m of evaluation.report.metals) {
      const metal = METALS[m.material]
      const limit = UK_HALLMARK_G[metal.family]
      const grams = metalMassG(m.material, m.volumeMm3)
      if (limit !== undefined && grams > limit && !location) {
        f.push({
          source: 'pave',
          severity: 'warning',
          code: 'hallmark.location',
          message: `${metal.label} ${grams.toFixed(2)} g is above the UK ${limit} g hallmarking threshold and no mark location is set`,
          value: round3(grams),
          limit,
          unit: 'g',
        })
      }
    }
    add(
      'hallmark',
      'Hallmark',
      'above UK weight threshold with no mark location = warn',
      f,
      `Mark location: ${location}${input.options.marks?.location ? '' : ' (default)'}.`,
    )
  }

  // ── Plating claims ──
  {
    const f: Finding[] = []
    const microns = input.options.plating?.microns
    for (const part of evaluation.parts) {
      if (part.plating === 'none') continue
      const base = { source: 'pave' as const, partId: part.id, nodeId: part.nodeId }
      if (part.plating.endsWith('vermeil')) {
        if (part.material !== 'ag925-sterling')
          f.push({
            ...base,
            severity: 'error',
            code: 'plating.vermeil.base',
            message: `${part.name}: vermeil requires a sterling silver base (FTC), not ${METALS[part.material].label}`,
          })
        if (microns !== undefined && microns < 2.5)
          f.push({
            ...base,
            severity: 'error',
            code: 'plating.vermeil.thickness',
            message: `${part.name}: ${microns} µm is below the 2.5 µm vermeil minimum`,
            value: microns,
            limit: 2.5,
            unit: 'µm',
          })
      }
      if (microns === undefined)
        f.push({
          ...base,
          severity: 'warning',
          code: 'plating.thickness',
          message: `${part.name}: plating thickness unspecified`,
        })
    }
    add(
      'plating',
      'Plating claim',
      '“vermeil” below 2.5 µm or not on sterling = error; thickness unspecified = warn',
      f,
    )
  }

  // Kernel diagnostics no check above claimed.
  const claimed = [
    'wall.',
    'prong.',
    'bezel.',
    'channel.',
    'bead.',
    'opening.',
    'gap.',
    'seat.',
    'stone.',
    'hollow.',
  ]
  const rest = evaluation.diagnostics
    .filter((d) => !claimed.some((p) => d.code.startsWith(p)))
    .map(fromDiagnostic)
  if (rest.length) add('kernel', 'Kernel diagnostics', 'as reported by the geometry kernel', rest)

  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length
  return {
    profile: { id: P.id, name: P.name },
    summary: {
      errors: count('error'),
      warnings: count('warning'),
      passed: count('pass'),
      notEvaluated: count('not-evaluated'),
    },
    checks,
    thickness,
  }
}

/**
 * Points within a pavé stone's seat zone (girdle radius + 0.35 mm of its centre): beads and seat
 * walls there are governed by the bead, seat and border rules, not the structural wall rule.
 */
function paveZones(stones: readonly StoneInstance[]): (x: number, y: number, z: number) => boolean {
  const melee = stones.filter((s) => s.role === 'melee' || s.setting === 'pave')
  if (!melee.length) return () => false
  const cell = 2
  const grid = new Map<string, StoneInstance[]>()
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  for (const s of melee) {
    const k = key(s.matrix[12]!, s.matrix[13]!, s.matrix[14]!)
    grid.set(k, [...(grid.get(k) ?? []), s])
  }
  return (x, y, z) => {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = grid.get(key(x + i * cell, y + j * cell, z + k * cell))
          if (
            list?.some(
              (s) =>
                Math.hypot(x - s.matrix[12]!, y - s.matrix[13]!, z - s.matrix[14]!) <
                s.dims.width / 2 + 0.35,
            )
          )
            return true
        }
    return false
  }
}

function fromDiagnostic(d: Diagnostic): Finding {
  return {
    source: 'kernel',
    severity: d.level,
    code: d.code,
    message: d.message,
    ...(d.value !== undefined ? { value: d.value } : {}),
    ...(d.limit !== undefined ? { limit: d.limit } : {}),
    ...(d.at ? { location: d.at } : {}),
    ...(d.nodeId ? { nodeId: d.nodeId } : {}),
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
