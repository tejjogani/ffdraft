/**
 * spec-sheet.pdf: the document a manufacturer prints. Sections follow the research definition
 * (Decisions, "Spec-sheet sections"): header and revision, views, metal, size, stones, finish
 * and plating, marks and engraving, findings, commercial, QC, compliance, packaging, notes —
 * plus the cost and manufacturability summaries and the renders.
 */

import { FINISHES, GEM_MATERIALS, METALS, metalMassG, PLATINGS } from '@pave/schema'
import fontkit from '@pdf-lib/fontkit'
import type { StoneRow } from '../bom'
import { platingSpec } from '../bom'
import { type PackageContext, stampLocation } from '../context'
import { type CostEstimate, type CostInput, PLACEHOLDER_NOTE } from '../cost'
import type { CheckStatus, DfmReport } from '../dfm/checks'
import { INK } from '../drawing/model'
import { composeArrangement, type DrawingSet, fitView, type TitleInfo } from '../drawing/sheet'
import type { ExportNote } from '../exports'
import { TABULAR, type Typesetter } from '../fonts'
import { DIAMETER, fmtCarat, fmtGrams, fmtLength, fmtMoney } from '../format'
import type { PdfFonts } from './canvas'
import { type Cell, createPdf, drawingFrame, Flow, PAPER, STYLE } from './flow'

export interface SpecSheetInput {
  ctx: PackageContext
  drawings: DrawingSet
  title: TitleInfo
  stones: StoneRow[]
  cost: CostEstimate
  dfm: DfmReport
  exportNotes: ExportNote[]
  ts: Typesetter
}

const STATUS: Record<CheckStatus, { label: string; color: string }> = {
  pass: { label: 'Pass', color: INK.ok },
  warning: { label: 'Warning', color: INK.warn },
  error: { label: 'Error', color: INK.danger },
  'not-evaluated': { label: 'Not evaluated', color: INK.faint },
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function specSheetPdf(input: SpecSheetInput): Promise<Uint8Array> {
  const { ctx, ts } = input
  const { piece, evaluation, options, revision } = ctx.input
  const L = (v: number) => `${fmtLength(v, ctx.units)} mm`
  const date = new Date(options.date)
  const doc = await createPdf(
    `${piece.title} — ${ctx.sku} rev ${revision}`,
    options.author.name,
    date,
  )
  doc.registerFontkit(fontkit)
  // Stable subset names keep the bytes identical for identical input.
  const fonts: PdfFonts = {
    regular: await doc.embedFont(ts.fonts.sans.regular, {
      subset: true,
      customName: 'Inter-Regular',
    }),
    medium: await doc.embedFont(ts.fonts.sans.medium, { subset: true, customName: 'Inter-Medium' }),
    semibold: await doc.embedFont(ts.fonts.sans.semibold, {
      subset: true,
      customName: 'Inter-SemiBold',
    }),
    serif: await doc.embedFont(ts.fonts.serif, {
      subset: true,
      customName: 'InstrumentSerif-Regular',
    }),
    regularTabular: await doc.embedFont(ts.fonts.sans.regular, {
      subset: true,
      features: TABULAR,
      customName: 'Inter-Regular-Tnum',
    }),
    mediumTabular: await doc.embedFont(ts.fonts.sans.medium, {
      subset: true,
      features: TABULAR,
      customName: 'Inter-Medium-Tnum',
    }),
  }
  const paper = PAPER[options.paper ?? 'a4']
  const flow = new Flow(
    doc,
    fonts,
    ts,
    paper,
    `${options.org.name}  ·  ${ctx.sku}  ·  Revision ${revision}`,
  )
  const facts = ctx.facts
  const parts = evaluation.parts
  const report = evaluation.report

  // ── Cover: identity, key facts, pictorial ──
  const c = flow.newPage(false)
  const x0 = flow.left
  const W = flow.width
  c.text(x0, flow.y + 3, options.org.name.toUpperCase(), { ...STYLE.label, color: INK.fg })
  c.text(x0 + W, flow.y + 3, 'PRODUCTION SPECIFICATION', STYLE.label, 'end')
  flow.y += 20
  c.text(x0, flow.y, piece.title, STYLE.title)
  flow.y += 7
  c.text(
    x0,
    flow.y,
    `${cap(piece.kind)}   ·   SKU ${ctx.sku}   ·   Revision ${revision}   ·   ${options.date.slice(0, 10)}   ·   For quotation`,
    STYLE.bodyMuted,
  )
  flow.y += 6
  c.line(x0, flow.y, x0 + W, flow.y, INK.fg, 0.4)
  flow.y += 6

  const alloyLabels = [...new Set(parts.map((p) => METALS[p.material].label))]
  const lotsText = ctx.lots.length
    ? `${report.stoneCount} · ${fmtCarat(report.caratTotal)}`
    : 'None'
  const facts5: [string, string, string][] = [
    [
      'Metal',
      alloyLabels.join(', '),
      [
        ...new Set(
          parts.map(
            (p) => `${METALS[p.material].hallmark} · ${FINISHES[p.finish].label.toLowerCase()}`,
          ),
        ),
      ].join('; '),
    ],
    ['Net metal', fmtGrams(report.metalMassG), `per piece, ±${ctx.profile.weightTolerancePct}%`],
    facts.ring
      ? ['Size', facts.ring.sizes.us, `${DIAMETER}${L(facts.ring.innerDiameter)} inside`]
      : ['Height', L(facts.extent[2]), facts.bail?.built ? 'overall incl. bail' : 'overall'],
    [
      'Stones',
      lotsText,
      ctx.lots.length
        ? `${ctx.lots.length} lot${ctx.lots.length > 1 ? 's' : ''}, ${[...new Set(ctx.lots.map((l) => GEM_MATERIALS[l.lot.stone].label.toLowerCase()))].join(', ')}`
        : '—',
    ],
    [
      'Quantity',
      `${ctx.quantity} pc${ctx.quantity > 1 ? 's' : ''}`,
      `${ctx.metals.reduce((t, m) => t + m.orderGrams, 0).toFixed(1)} g metal per piece to order`,
    ],
  ]
  const colW = W / facts5.length
  facts5.forEach(([label, value, sub], i) => {
    const x = x0 + i * colW
    c.text(x, flow.y, label.toUpperCase(), STYLE.label)
    const big = { size: 12, weight: 'medium', tabular: true } as const
    c.text(x, flow.y + 6.5, fitText(ts, value, big, colW - 3), big)
    c.wrap(sub, STYLE.small, colW - 4)
      .slice(0, 2)
      .forEach((line, j) => {
        c.text(x, flow.y + 11 + j * 3.3, line, STYLE.small)
      })
  })
  flow.y += 20
  const heroH = 92
  c.rect(x0, flow.y, W, heroH, { fill: '#faf9f7' })
  const render = ctx.input.renders?.[0]
  if (render) {
    const img =
      render.mime === 'image/png'
        ? await doc.embedPng(render.bytes)
        : await doc.embedJpg(render.bytes)
    const s = Math.min((W - 8) / img.width, (heroH - 8) / img.height)
    c.image(
      img,
      x0 + (W - img.width * s) / 2,
      flow.y + (heroH - img.height * s) / 2,
      img.width * s,
      img.height * s,
    )
  } else {
    const iso = fitView(input.drawings, 'iso', W - 40, heroH - 14, ts.measure)
    if (iso) c.sheet(iso, x0 + 20, flow.y + 7)
    c.text(x0 + W - 3, flow.y + heroH - 3, 'Isometric view · not to scale', STYLE.small, 'end')
  }
  flow.y += heroH + 4

  // ── 01 Metal ──
  flow.section('Metal')
  const allowance = ctx.profile.castingAllowancePct
  flow.kv([
    ['Alloy', alloyLabels.join(', ')],
    [
      'Fineness',
      [
        ...new Set(
          parts.map(
            (p) =>
              `${METALS[p.material].fineness} parts per thousand (${METALS[p.material].hallmark})`,
          ),
        ),
      ].join(', '),
    ],
    [
      'Construction',
      parts.some((p) => !p.exact)
        ? 'Lost-wax cast from printed pattern; solid'
        : 'Lost-wax cast; solid',
    ],
    [
      'Net weight',
      `${fmtGrams(report.metalMassG)} per piece, target ±${ctx.profile.weightTolerancePct}%`,
    ],
    [
      'Order weight',
      ctx.metals
        .map(
          (m) =>
            `${fmtGrams(m.orderGrams)} ${METALS[m.metal].label} (+${allowance}% casting allowance)`,
        )
        .join('; '),
    ],
    [
      'Density used',
      [...new Set(parts.map((p) => `${METALS[p.material].density} g/cm³`))].join(', '),
    ],
  ])
  if (ctx.groups.length > 1 || ctx.groups.some((g) => g.count > 1)) {
    flow.table(
      [
        { title: 'Part', width: 30 },
        { title: 'Qty', width: 9, align: 'right' },
        { title: 'Alloy', width: 28 },
        { title: 'Volume each', width: 20, align: 'right' },
        { title: 'Net weight', width: 18, align: 'right' },
        { title: 'Finish', width: 20 },
        { title: 'Plating', width: 20 },
      ],
      ctx.groups.map((g) => {
        const p = g.parts[0]!
        return [
          { text: g.name },
          { text: String(g.count) },
          { text: METALS[p.material].label },
          { text: `${(g.volumeMm3 / g.count).toFixed(1)} mm³` },
          { text: fmtGrams(metalMassG(p.material, g.volumeMm3)) },
          { text: FINISHES[p.finish].label },
          { text: PLATINGS[p.plating].label },
        ]
      }),
    )
  }

  // ── 02 Size ──
  flow.section('Size')
  const [ew, ed, eh] = facts.extent
  const sizeRows: [string, string][] = [['Overall', `${L(ew)} W × ${L(eh)} H × ${L(ed)} D`]]
  if (facts.ring) {
    const r = facts.ring
    sizeRows.push(
      ['Ring size', `${r.sizes.us}  ·  ${r.sizes.uk}  ·  ${r.sizes.eu}`],
      [
        'Inside diameter',
        `${DIAMETER}${L(r.innerDiameter)} ±${ctx.profile.tolerances.ringIdMm} mm`,
      ],
      ['Size tolerance', ctx.profile.tolerances.ringSize],
      [
        'Band',
        `${L(r.node.widthTop)} wide at top, ${L(r.node.widthBottom)} at base; ${L(r.node.thicknessTop)} / ${L(r.node.thicknessBottom)} thick; ${r.node.profile} profile`,
      ],
      ['Size run', options.sizeRun?.length ? options.sizeRun.join(', ') : 'Single size as drawn'],
    )
  }
  if (facts.bail?.built) {
    if (facts.body)
      sizeRows.push(['Body height', L(facts.body.bounds.max[2] - facts.body.bounds.min[2])])
    sizeRows.push([
      'Bail opening',
      `${L(facts.bail.node.opening)} clear (${facts.bail.node.style}, ${L(facts.bail.node.width)} wide)`,
    ])
  }
  for (const ch of facts.chains)
    sizeRows.push(['Chain length', `${ch.length} mm (${(ch.length / 25.4).toFixed(1)} in)`])
  flow.kv(sizeRows)

  // ── Drawings ──
  flow.newPage()
  flow.c.text(flow.left, flow.y + 3.6, 'Drawings', STYLE.section)
  flow.c.text(
    flow.left + W,
    flow.y + 3.6,
    'Third-angle projection · dimensions in mm',
    STYLE.small,
    'end',
  )
  flow.y += 7
  const { sheet } = composeArrangement(input.drawings, ts.measure, drawingFrame(paper), input.title)
  flow.c.sheet(sheet, flow.left, flow.y)
  flow.newPage()

  // ── 03 Stones ──
  flow.section('Stones', 30)
  if (input.stones.length) {
    flow.table(
      [
        { title: 'Lot', width: 9 },
        { title: 'Qty', width: 9, align: 'right' },
        { title: 'Stone', width: 30 },
        { title: 'Cut', width: 22 },
        { title: 'Size mm', width: 20, align: 'right' },
        { title: 'ct each', width: 13, align: 'right' },
        { title: 'ct total', width: 13, align: 'right' },
        { title: 'Setting', width: 15 },
        { title: 'Quality', width: 20 },
        { title: 'Supply', width: 18 },
      ],
      input.stones.map((s) => [
        { text: s.lot, style: { ...STYLE.td, weight: 'semibold' } },
        { text: String(s.count) },
        {
          text: s.type.toLowerCase().startsWith(s.origin.split('-')[0]!)
            ? s.type
            : `${s.type}\n${s.origin}`,
          style: STYLE.td,
        },
        { text: s.cut },
        {
          text:
            s.shape === 'round'
              ? `${DIAMETER}${s.widthMm.toFixed(2)}`
              : `${s.lengthMm.toFixed(2)} × ${s.widthMm.toFixed(2)}`,
        },
        { text: s.ctEach.toFixed(s.ctEach < 0.1 ? 4 : 2) },
        { text: s.ctTotal.toFixed(s.ctTotal < 0.1 ? 3 : 2) },
        { text: s.setting },
        {
          text:
            [s.color, s.clarity].filter(Boolean).join(' · ') + (s.certified ? '\ncertified' : '') ||
            '—',
        },
        {
          text:
            s.suppliedBy === 'brand'
              ? `Brand${s.sourcingSku ? `\n${s.sourcingProvider} ${s.sourcingSku}` : ''}`
              : 'Manufacturer',
        },
      ]),
      {
        footnote: `Lots are keyed S1… on the drawings and in stones.csv. Seat tolerance per lot is in stones.csv (prong −0.10/+0.15 mm; bezel, channel and pavé tighter). Stones in each lot must match in colour and size.`,
      },
    )
  } else flow.paragraph('No stones.', STYLE.bodyMuted)

  // ── 04 Finish & plating ──
  flow.section('Finish and plating')
  const platings = [...new Set(parts.map((p) => p.plating))].filter((p) => p !== 'none')
  flow.kv(
    [
      ...ctx.groups.map((g): [string, string] => [
        g.name,
        `${FINISHES[g.parts[0]!.finish].label}, all surfaces`,
      ]),
      ...(platings.length
        ? platings.map((p): [string, string] => [
            PLATINGS[p].label,
            `${platingSpec(ctx, p)}${options.plating?.layers ? `; ${options.plating.layers}` : ''}; verify by XRF`,
          ])
        : [['Plating', 'None'] as [string, string]]),
    ],
    1,
    38,
  )

  // ── 05 Marks & engraving ──
  flow.section('Marks and engraving')
  const markRows: [string, string][] = [
    [
      'Fineness mark',
      [...new Set(parts.map((p) => METALS[p.material].hallmark).filter(Boolean))].join(', ') || '—',
    ],
    ['Maker’s mark', options.marks?.makerMark ?? 'Manufacturer’s sponsor mark'],
    ['Location', stampLocation(ctx)],
  ]
  if (options.marks?.logo) markRows.push(['Logo', options.marks.logo])
  for (const e of facts.engravings) {
    markRows.push([
      `${e.mode === 'engrave' ? 'Engraving' : 'Embossed'}`,
      `“${e.text}” — ${e.font}, ${L(e.size)} letters, ${L(e.depth)} ${e.mode === 'engrave' ? 'deep' : 'high'}, ${e.where.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
    ])
  }
  flow.kv(markRows, 1, 38)

  // ── 06 Findings ──
  flow.section('Findings')
  const findingRows: [string, string][] = []
  if (facts.bail) {
    const b = facts.bail
    findingRows.push([
      'Bail',
      `${cap(b.node.style)}, ${L(b.node.opening)} opening, ${L(b.node.width)} wide, ${L(b.node.wire)} wire; ${!b.built ? 'not in this revision’s CAD (see manufacturability) — please quote as a separate finding' : b.part ? 'cast as a separate part' : 'cast with the body'}`,
    ])
  }
  for (const ch of facts.chains)
    findingRows.push([
      'Chain',
      `${cap(ch.style)}, ${ch.length} mm, ${ch.linkWidth} mm links, ${METALS[ch.material].label}`,
    ])
  for (const f of facts.findings)
    findingRows.push([
      cap(f.type.replace(/([A-Z])/g, ' $1').toLowerCase()),
      `${L(f.length)}, ${L(f.wire)} wire, ${METALS[f.material].label}`,
    ])
  if (!findingRows.length) findingRows.push(['Findings', 'None'])
  findingRows.push(['Weight', 'Finished weight includes all findings, posts, backs and chains'])
  flow.kv(findingRows, 1, 38)

  // ── 07 Commercial ──
  flow.section('Commercial')
  const cm = options.commercial ?? {}
  flow.kv([
    ['Quantity', `${ctx.quantity} pc${ctx.quantity > 1 ? 's' : ''}`],
    ['MOQ', cm.moq ? `${cm.moq} pcs` : 'Please state'],
    ['Target cost', cm.targetCostUsd ? fmtMoney(cm.targetCostUsd, 'USD') : 'Please quote'],
    ['Lead time', cm.leadTimeDays ? `${cm.leadTimeDays} days` : 'Please state, sample and bulk'],
    ['Sample', cm.sampleFirst === false ? 'Not required' : 'One sample for approval before bulk'],
    [
      'Target weight',
      `${fmtGrams(report.metalMassG)} net metal ±${ctx.profile.weightTolerancePct}%`,
    ],
  ])

  // ── 08 QC ──
  flow.section('Quality control and acceptance')
  const t = ctx.profile.tolerances
  flow.bullets([
    `Finished metal weight within ±${ctx.profile.weightTolerancePct}% of ${fmtGrams(report.metalMassG)}, all components included.`,
    ...(facts.ring
      ? [
          `Ring size ${facts.ring.sizes.us} within ${t.ringSize}; inside diameter ±${t.ringIdMm} mm.`,
        ]
      : []),
    `Dimensions within ±${t.dimensionalPct}% of the drawings (not less than ±${t.dimensionalFloorMm} mm).`,
    ...(ctx.lots.length
      ? [
          'Every stone secure under a tap test; no movement; settings smooth to the touch; stones in each lot matched in colour and size.',
        ]
      : []),
    ...(platings.length
      ? ['Plating thickness measured by XRF on the sample and on 1 in 10 production pieces.']
      : []),
    'Surfaces as specified; free of porosity, pits, fire scale and tool marks; edges smooth.',
    'Marks legible and placed as specified.',
    'CAD approval is not sample approval: bulk starts only after written approval of a physical sample.',
  ])

  // ── 09 Compliance ──
  flow.section('Compliance')
  flow.bullets(complianceNotes(ctx))

  // ── 10 Packaging ──
  flow.section('Packaging', 10)
  flow.paragraph(
    options.packaging ??
      'Each piece individually in an anti-tarnish bag, tagged with SKU, size and revision. Customer-supplied stones not used are returned labelled by lot.',
  )

  // ── 11 Notes ──
  flow.section('Notes', 10)
  const notes = [
    'CAD files are nominal geometry in millimetres, not shrink-compensated; apply your own shrinkage scaling. Do not scale the drawings.',
    'One watertight binary STL per castable part, metal only, no sprues. The stones STL is reference only.',
    'Changes go back into CAD: please send change requests rather than altering waxes.',
    ...(options.notes ? [options.notes] : []),
    ...(ctx.input.spec?.notes ? [ctx.input.spec.notes] : []),
    ...input.exportNotes.flatMap((n) => n.notes.map((x) => `${n.file}: ${x}`)),
  ]
  flow.bullets(notes)

  // ── 12 Cost ──
  flow.section('Cost estimate', 40)
  const cost = input.cost
  const money = (v: number) => fmtMoney(v, cost.currency)
  flow.kv([
    ['Cost per piece', money(cost.perPiece.cost)],
    ['Price per piece', money(cost.perPiece.price)],
    [
      'Order cost',
      `${money(cost.order.cost)} for ${cost.quantity} pc${cost.quantity > 1 ? 's' : ''}`,
    ],
    [
      'Metal price',
      cost.priceSource
        ? `${cost.priceSource}${cost.priceTimestamp ? `, ${cost.priceTimestamp}` : ''}`
        : 'Manual rates (no live prices)',
    ],
  ])
  const anyPlaceholder = cost.lines.some((l) => l.inputs.some((i) => i.source === 'default'))
  flow.table(
    [
      { title: 'Item', width: 46 },
      { title: 'Formula', width: 52 },
      { title: 'Inputs', width: 62 },
      { title: 'Amount', width: 22, align: 'right' },
    ],
    cost.lines
      .filter((l) => l.amount !== 0 || l.group === 'stones')
      .map((l): Cell[] => [
        { text: l.label },
        { text: l.formula, style: { ...STYLE.td, color: INK.muted } },
        {
          text: l.inputs.map((i) => fmtInput(i)).join(' · ') + (l.note ? `\n${l.note}` : ''),
          style: { ...STYLE.td, size: 7.25 },
        },
        { text: money(l.amount) },
      ]),
    {
      footnote: `${cost.formula}.${anyPlaceholder ? ` Values marked * are a ${PLACEHOLDER_NOTE}.` : ''} No prices are fetched live; every rate is in cost-estimate.json.`,
    },
  )

  // ── 13 Manufacturability ──
  flow.section('Manufacturability', 40)
  const s = input.dfm.summary
  flow.paragraph(
    `Checked against “${input.dfm.profile.name}”: ${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'}, ${s.passed} passed, ${s.notEvaluated} not evaluated. Details with locations are in dfm-report.json.`,
    STYLE.bodyMuted,
  )
  flow.table(
    [
      { title: 'Status', width: 24 },
      { title: 'Check', width: 46 },
      { title: 'Threshold', width: 52 },
      { title: 'Result', width: 60 },
    ],
    input.dfm.checks.map((ch): Cell[] => [
      { text: STATUS[ch.status].label, dot: STATUS[ch.status].color },
      { text: ch.title },
      { text: ch.threshold, style: { ...STYLE.td, size: 7.25, color: INK.muted } },
      {
        text: ch.findings.length
          ? ch.findings
              .slice(0, 3)
              .map((f) => f.message)
              .join('\n') + (ch.findings.length > 3 ? `\n+ ${ch.findings.length - 3} more` : '')
          : (ch.note ?? (ch.status === 'pass' ? 'OK' : '—')),
        style: { ...STYLE.td, size: 7.25 },
      },
    ]),
  )

  // ── Renders ──
  const renders = ctx.input.renders ?? []
  if (renders.length) {
    flow.newPage()
    flow.c.text(flow.left, flow.y + 3.6, 'Renders', STYLE.section)
    flow.y += 9
    for (const r of renders) {
      const img = r.mime === 'image/png' ? await doc.embedPng(r.bytes) : await doc.embedJpg(r.bytes)
      const maxH = (flow.bottom - flow.margin.top - 30) / 2
      const sc = Math.min(W / img.width, maxH / img.height)
      flow.ensure(img.height * sc + 8)
      flow.c.image(
        img,
        flow.left + (W - img.width * sc) / 2,
        flow.y,
        img.width * sc,
        img.height * sc,
      )
      flow.y += img.height * sc + 2
      flow.c.text(flow.left, flow.y + 3, r.caption ?? r.name, STYLE.small)
      flow.y += 8
    }
  }

  flow.footers({
    left: `${piece.title} — ${ctx.sku}`,
    centre: `Revision ${revision} · ${options.date.slice(0, 10)}`,
  })
  return doc.save({ useObjectStreams: false })
}

function fitText(
  ts: Typesetter,
  text: string,
  style: Parameters<Typesetter['measure']>[1],
  width: number,
): string {
  if (ts.measure(text, style) <= width) return text
  let t = text
  while (t.length > 1 && ts.measure(`${t}…`, style) > width) t = t.slice(0, -1)
  return `${t}…`
}

function fmtInput(i: CostInput): string {
  const v =
    i.unit === '%'
      ? `${i.value}%`
      : i.unit.includes('/') || i.unit === 'USD' || i.unit.length === 3
        ? `${i.value} ${i.unit}`
        : `${i.value}${i.unit ? ` ${i.unit}` : ''}`
  return `${i.name} ${v}${i.source === 'default' ? '*' : ''}`
}

/** Compliance lines for the selected markets (research §5). */
function complianceNotes(ctx: PackageContext): string[] {
  const { evaluation, options } = ctx.input
  const markets = options.markets ?? ['US', 'UK', 'EU']
  const out: string[] = []
  const metals = evaluation.report.metals.map((m) => ({ ...m, metal: METALS[m.material] }))
  if (markets.includes('UK')) {
    const thresholds: Record<string, number> = {
      gold: 1,
      silver: 7.78,
      platinum: 0.5,
      palladium: 1,
    }
    for (const m of metals) {
      const limit = thresholds[m.metal.family]
      if (limit === undefined) continue
      const grams = metalMassG(m.material, m.volumeMm3)
      out.push(
        grams > limit
          ? `UK: ${m.metal.label} ${grams.toFixed(2)} g exceeds the ${limit} g exemption — hallmark required (sponsor’s mark, fineness ${m.metal.hallmark}, assay office mark).`
          : `UK: ${m.metal.label} ${grams.toFixed(2)} g is under the ${limit} g exemption; hallmarking optional.`,
      )
    }
  }
  if (markets.includes('US'))
    out.push(
      'US: quality mark (e.g. 14K, PLAT, 925) with a registered trademark beside it; gold within 3 parts per thousand (7 with solder), silver within 4.',
    )
  if (markets.includes('EU')) {
    const posts = ctx.facts.findings.some((f) => f.type === 'earringPost')
    out.push(
      `EU REACH: nickel release ≤ 0.5 µg/cm²/week for skin contact${posts ? ', ≤ 0.2 for piercing posts' : ''}; test to EN 1811:2023. Vienna Convention Common Control Mark accepted where applicable.`,
    )
  }
  if (markets.includes('IN'))
    out.push(
      'India: BIS hallmark with a 6-character HUID on every gold article; HUID also required on hallmarked silver.',
    )
  const origins = new Set(ctx.lots.map((l) => l.origin))
  if (origins.has('lab-grown'))
    out.push(
      'Lab-grown diamonds: describe as “laboratory-grown” or “[maker]-created” on all documents and labels (FTC Jewelry Guides).',
    )
  if (origins.has('lab-created')) {
    const names = [
      ...new Set(
        ctx.lots
          .filter((l) => l.origin === 'lab-created')
          .map((l) => GEM_MATERIALS[l.lot.stone].label.toLowerCase()),
      ),
    ]
    out.push(
      `Lab-created stones (${names.join(', ')}): disclose as “lab-created”; never described as diamond (FTC Jewelry Guides).`,
    )
  }
  if (origins.has('simulant'))
    out.push('Simulants: disclose as simulated stones on every document.')
  if (ctx.lots.some((l) => l.lot.stone.startsWith('diamond') && l.origin !== 'lab-grown')) {
    out.push(
      'Natural diamonds: Kimberley Process / WDC System of Warranties statement on every B2B invoice.',
    )
  }
  if (evaluation.parts.some((p) => p.plating.endsWith('vermeil')))
    out.push('Vermeil: at least 2.5 µm of 10K-or-finer gold over sterling silver (FTC).')
  for (const l of ctx.lots)
    if (l.origin === 'unspecified')
      out.push(`${l.key}: origin not specified — state natural or lab-grown before ordering.`)
  return out
}
