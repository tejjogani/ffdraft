/**
 * `pnpm match:bench`: runs benchmark cases on a real kernel at draft detail and prints the
 * tables. Node only (this file, not the package, writes overlays to disk).
 *
 *   --suite pr|grid           pr (default): the six pull-request cases; grid: templates × seeds × views × levels
 *   --templates a,b           grid templates (default: the v1 list)
 *   --views one,two,top       grid view sets (default: all three)
 *   --levels clean,noisy,hard,misspec   grid levels (default: all four)
 *   --seeds 1,2               grid seeds (default 1..8)
 *   --only 0,2                run only these pr case indices
 *   --budget 250              kernel evaluations per candidate
 *   --px 192                  target mask size
 *   --overlays DIR            write target | fit | difference PNGs per case
 *   --json FILE               write the raw results
 *   --check                   exit 1 when a floor is missed (for CI)
 *   --no-speed                skip the speed probe (one render plus score; one camera search)
 */
/// <reference types="node" />
/// <reference path="../../../kernel/src/runtime/opentype.d.ts" />
/// <reference path="../../../kernel/src/runtime/vite.d.ts" />
/// <reference path="../../../kernel/src/export/rhino3dmModule.d.ts" />
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createKernel } from '@pave/kernel'
import { buildDesign, TEMPLATES } from '@pave/schema'
import { defaultCamera } from '../camera'
import { viewAt, WORK_PX } from '../fit'
import { edges } from '../mask'
import { diffClasses } from '../overlay'
import { searchPose } from '../pose'
import { rasterize, triangleCount } from '../raster'
import { prepareTarget, scoreView } from '../score'
import type { Evaluate, FitResult, TargetView } from '../types'
import type { Level } from './degrade'
import { caseTable, checkTable, paramTable, recipeTable } from './report'
import { type CaseResult, runCase } from './run'
import { BENCH_RECIPES, type BenchCase, makeCase, PR_CASES, type ViewSet } from './synth'
import { type Check, checkThresholds, speedChecks } from './thresholds'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!
  if (a.startsWith('--'))
    args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? '' : (process.argv[++i] ?? ''))
}
const list = (k: string, d: string[]) => (args.get(k) ? args.get(k)!.split(',') : d)

const V1 = [
  'solitaire',
  'halo',
  'three-stone',
  'wedding-band',
  'eternity',
  'signet',
  'pendant-solitaire',
  'name-pendant',
  'studs',
  'iced-initial',
]
let cases: { templateId: string; views: ViewSet; level: Level; seed: number }[]
if ((args.get('suite') ?? 'pr') === 'grid') {
  cases = []
  for (const t of list('templates', V1))
    for (const s of list('seeds', ['1', '2', '3', '4', '5', '6', '7', '8']))
      for (const v of list('views', ['one', 'two', 'top']))
        for (const l of list('levels', ['clean', 'noisy', 'hard', 'misspec']))
          cases.push({ templateId: t, views: v as ViewSet, level: l as Level, seed: Number(s) })
} else {
  const only = args.get('only')?.split(',').map(Number)
  cases = PR_CASES.filter((_, i) => !only || only.includes(i))
}

const kernel = createKernel()
const evaluate: Evaluate = (d, signal) =>
  kernel.evaluate(d, { detail: 'draft', ...(signal ? { signal } : {}) })
const px = Number(args.get('px') ?? 192)
const budget = Number(args.get('budget') ?? 250)
const overlays = args.get('overlays')
if (overlays) mkdirSync(overlays, { recursive: true })

const results: CaseResult[] = []
const t0 = performance.now()
for (const c of cases) {
  const tpl = TEMPLATES.find((t) => t.id === c.templateId)
  if (!tpl || !BENCH_RECIPES[c.templateId]) throw new Error(`unknown template ${c.templateId}`)
  const bc = await makeCase({ ...c, px, template: buildDesign(tpl.spec) }, evaluate)
  const r = await runCase(bc, evaluate, { evaluations: budget })
  const { result, ...row } = r
  results.push(row)
  process.stderr.write(
    `${row.id}: IoU ${row.iouBefore.map((x) => x.toFixed(3)).join('/')} → ${row.iouAfter.map((x) => x.toFixed(3)).join('/')}, ${(row.ms / 1000).toFixed(1)} s${row.threw ? ` THREW ${row.threw.split('\n')[0]}` : ''}\n`,
  )
  if (overlays && result)
    await writeOverlay(join(overlays, `${row.id.replaceAll('/', '_')}.png`), bc, result, evaluate)
}

console.log(
  `\n## Cases (${results.length}, ${((performance.now() - t0) / 1000).toFixed(0)} s, budget ${budget} evaluations per candidate, ${px} px masks)\n`,
)
console.log(caseTable(results))
console.log('\n## Parameters\n')
console.log(paramTable(results))
console.log('\n## Per recipe\n')
console.log(recipeTable(results))
const checks: Check[] = checkThresholds(results)
if (!args.has('no-speed')) checks.push(...(await speedProbe()))
console.log('\n## Thresholds\n')
console.log(checkTable(checks))
if (args.get('json')) writeFileSync(args.get('json')!, JSON.stringify(results, null, 2))
const missed = checks.filter((c) => c.pass === false)
if (missed.length)
  console.log(`\n${missed.length} floor(s) missed: ${missed.map((c) => c.measure).join('; ')}`)
process.exit(args.has('check') && missed.length ? 1 : 0)

/** The plan's speed floors on the solitaire template (about 8k triangles at draft detail). */
async function speedProbe(): Promise<Check[]> {
  const tpl = TEMPLATES.find((t) => t.id === 'solitaire')!
  const e = await evaluate(buildDesign(tpl.spec))
  const cam = { ...defaultCamera(e, 'threeQuarter'), roll: 3 }
  const size = { width: 192, height: 192 }
  const r = rasterize(e, cam, size)
  const t = prepareTarget({
    id: 'speed',
    ...size,
    matte: r.cls.map((v) => (v ? 1 : 0)),
    stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
  })
  const n = 200
  const t0 = performance.now()
  for (let k = 0; k < n; k++)
    scoreView(rasterize(e, { ...cam, azimuth: cam.azimuth + k * 0.01 }, size), t, cam)
  const renderMs = (performance.now() - t0) / n
  const t1 = performance.now()
  await searchPose(e, t)
  return speedChecks(renderMs, performance.now() - t1, triangleCount(e))
}

/** One row per view: target | fit | difference (grey both, orange model only, blue photo only). */
async function writeOverlay(path: string, c: BenchCase, r: FitResult, ev: Evaluate) {
  const e = await ev(r.design)
  const rows: { w: number; h: number; rgb: Uint8Array }[] = []
  for (const v of c.views) {
    const cam = r.cameras[v.id]
    if (!cam) continue
    const t = prepareTarget(viewAt(v, v.heldOut ? 384 : WORK_PX) as TargetView)
    const { width: w, height: h } = t.view
    const ras = rasterize(e, cam, { width: w, height: h }, { hide: c.recipe.hide })
    const diff = diffClasses(ras, t)
    const metal = ras.cls.map((x) => (x ? 1 : 0))
    const me = edges(metal, { width: w, height: h })
    const rgb = new Uint8Array(w * 3 * h * 3).fill(255)
    const put = (panel: number, k: number, col: [number, number, number]) => {
      const x = k % w
      const y = (k - x) / w
      const o = (y * w * 3 + panel * w + x) * 3
      rgb[o] = col[0]
      rgb[o + 1] = col[1]
      rgb[o + 2] = col[2]
    }
    for (let k = 0; k < w * h; k++) {
      if (t.view.matte[k]) put(0, k, t.view.stones?.[k] ? [120, 160, 230] : [90, 90, 90])
      if (ras.cls[k]) put(1, k, ras.cls[k] === 2 ? [120, 160, 230] : [150, 130, 90])
      const d = diff[k]
      put(
        2,
        k,
        d === 1
          ? [200, 200, 200]
          : d === 2
            ? [240, 120, 30]
            : d === 3
              ? [40, 90, 230]
              : [255, 255, 255],
      )
      if (me[k]) put(2, k, [0, 0, 0])
    }
    rows.push({ w: w * 3, h, rgb })
  }
  const W = Math.max(...rows.map((x) => x.w))
  const H = rows.reduce((s, x) => s + x.h, 0)
  const img = new Uint8Array(W * H * 3).fill(255)
  let y0 = 0
  for (const row of rows) {
    for (let y = 0; y < row.h; y++)
      img.set(row.rgb.subarray(y * row.w * 3, (y + 1) * row.w * 3), (y0 + y) * W * 3)
    y0 += row.h
  }
  writeFileSync(path, png(W, H, img))
}

function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1)
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
