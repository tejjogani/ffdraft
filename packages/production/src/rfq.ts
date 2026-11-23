/** rfq-email.md: a ready-to-send request for quote that summarises the piece and its attachments. */
import { FINISHES, METALS, PLATINGS } from '@pave/schema'
import type { PackageContext } from './context'
import type { CostEstimate } from './cost'
import type { DfmReport } from './dfm/checks'
import { DIAMETER, fmtCarat, fmtGrams, fmtLength, fmtMoney } from './format'
import type { PackageFile } from './types'

export function rfqEmail(
  ctx: PackageContext,
  files: readonly PackageFile[],
  root: string,
  cost: CostEstimate,
  dfm: DfmReport,
): string {
  const { piece, evaluation, options, revision } = ctx.input
  const L = (v: number) => `${fmtLength(v, ctx.units)} mm`
  const parts = evaluation.parts
  const alloys = [...new Set(parts.map((p) => METALS[p.material].label))].join(', ')
  const finishes = [...new Set(parts.map((p) => FINISHES[p.finish].label))].join(', ')
  const platings = [...new Set(parts.map((p) => p.plating))]
    .filter((p) => p !== 'none')
    .map((p) => PLATINGS[p].label)
  const [w, d, h] = ctx.facts.extent
  const c = options.commercial ?? {}
  const lines: string[] = []
  lines.push(
    `**Subject:** RFQ — ${piece.title} (${ctx.sku}, rev ${revision}) × ${ctx.quantity}`,
    '',
  )
  lines.push('Hello,', '')
  lines.push(
    `We would like a quotation to produce **${ctx.quantity} × ${piece.title}** (${piece.kind}, SKU ${ctx.sku}, revision ${revision}). The complete production package is attached as \`${root}.zip\`; the spec sheet PDF is the reference document.`,
    '',
  )
  lines.push('## The piece', '')
  lines.push(
    `- **Metal:** ${alloys}; finish ${finishes.toLowerCase()}${platings.length ? `; ${platings.join(', ').toLowerCase()} plating` : ''}`,
  )
  lines.push(
    `- **Net metal weight:** ${fmtGrams(evaluation.report.metalMassG)} per piece (target ±${ctx.profile.weightTolerancePct}%)`,
  )
  lines.push(`- **Overall size:** ${L(w)} W × ${L(h)} H × ${L(d)} D`)
  if (ctx.facts.ring) {
    const r = ctx.facts.ring
    lines.push(
      `- **Ring size:** ${r.sizes.us} (${r.sizes.uk}, ${r.sizes.eu}), inside ${DIAMETER}${L(r.innerDiameter)}${options.sizeRun?.length ? `; size run ${options.sizeRun.join(', ')}` : ''}`,
    )
  }
  if (ctx.lots.length) {
    lines.push(
      `- **Stones:** ${evaluation.report.stoneCount} in ${ctx.lots.length} lot${ctx.lots.length === 1 ? '' : 's'}, ${fmtCarat(evaluation.report.caratTotal)} total:`,
    )
    for (const l of ctx.lots) {
      const size =
        l.lot.cut === 'round'
          ? `${DIAMETER}${L(l.lot.width)}`
          : `${L(l.lot.length)} × ${L(l.lot.width)}`
      lines.push(
        `  - ${l.key}: ${l.lot.count} × ${l.lot.stone} ${l.lot.cut} ${size}, ${l.lot.setting} setting — ${l.suppliedBy === 'brand' ? 'we supply' : 'please quote'} (${l.origin})`,
      )
    }
  }
  if (ctx.facts.engravings.length)
    lines.push(
      `- **Engraving:** ${ctx.facts.engravings.map((e) => `“${e.text}” (${e.where})`).join('; ')}`,
    )
  lines.push('')
  lines.push('## What we need from you', '')
  lines.push('1. Unit price at this quantity, with metal, setting, finishing and plating itemised')
  lines.push('2. Your metal price basis and the date it is valid until')
  lines.push(
    `3. Lead time for a sample${c.sampleFirst === false ? '' : ' (we approve a sample before bulk)'} and for bulk`,
  )
  lines.push(
    '4. Any changes your process needs — please send them back as CAD change requests rather than altering the wax',
  )
  lines.push('')
  if (c.targetCostUsd || c.leadTimeDays || c.moq) {
    lines.push('## Our targets', '')
    if (c.targetCostUsd) lines.push(`- Target unit cost: ${fmtMoney(c.targetCostUsd, 'USD')}`)
    if (c.leadTimeDays) lines.push(`- Target lead time: ${c.leadTimeDays} days`)
    if (c.moq) lines.push(`- Expected MOQ: ${c.moq} pcs`)
    lines.push('')
  }
  lines.push('## Notes for production', '')
  lines.push(
    '- CAD files are **nominal, not shrink-compensated**, in millimetres; please apply your own shrinkage scaling.',
  )
  lines.push(
    '- One watertight STL per castable part, metal only, no sprues. The stones STL is for reference only.',
  )
  lines.push(
    `- Our manufacturability check: ${dfm.summary.errors} error${dfm.summary.errors === 1 ? '' : 's'}, ${dfm.summary.warnings} warning${dfm.summary.warnings === 1 ? '' : 's'} against “${ctx.profile.name}” (see dfm-report.json).`,
  )
  lines.push(
    `- Our internal estimate is ${fmtMoney(cost.perPiece.cost, cost.currency)} per piece${cost.placeholders.length ? ' (several rates are placeholders)' : ''}; it is included for transparency, not as a target.`,
  )
  if (options.notes) lines.push(`- ${options.notes.replace(/\s*\n\s*/g, ' ')}`)
  lines.push('')
  lines.push('## Attachments', '')
  lines.push(`\`${root}.zip\` contains:`, '')
  for (const f of files) lines.push(`- \`${f.path}\` — ${describe(f.path)}`)
  lines.push('')
  lines.push('Thank you — we look forward to your quotation.', '')
  lines.push(options.author.name)
  lines.push(options.org.name)
  for (const v of [
    options.author.email ?? options.org.email,
    options.author.phone ?? options.org.phone,
    options.org.website,
  ])
    if (v) lines.push(v)
  return `${lines.join('\n')}\n`
}

function describe(path: string): string {
  if (path === 'spec-sheet.pdf') return 'specification sheet (print this)'
  if (path === 'manifest.json') return 'file list, units, hashes, weights'
  if (path === 'bom.csv') return 'bill of materials'
  if (path === 'stones.csv') return 'stone list keyed to the drawings'
  if (path === 'cost-estimate.json') return 'our cost estimate with every rate'
  if (path === 'dfm-report.json') return 'manufacturability checks'
  if (path.startsWith('drawings/')) return 'dimensioned drawing (SVG, mm)'
  if (path.endsWith('_REFERENCE.stl')) return 'stones, reference only — do not cast'
  if (path.endsWith('.stl')) return 'casting mesh (binary STL, mm)'
  if (path.endsWith('.3dm')) return 'editable Rhino model'
  if (path.endsWith('.step')) return 'STEP assembly'
  if (path.endsWith('.3mf')) return '3MF for print bureaus'
  if (path.startsWith('renders/')) return 'render'
  return 'supporting file'
}
