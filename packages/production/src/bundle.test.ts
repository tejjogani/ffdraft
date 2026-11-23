import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sha256 } from './manifest'
import { buildProductionPackage, loadFonts } from './node'
import { fixtureKernel, pavePendant, solitaireRing } from './testing/fixtures'
import type { BuildInput } from './types'

async function build(which: 'ring' | 'pendant', options: Partial<BuildInput['options']> = {}) {
  const { design, evaluation } = which === 'ring' ? solitaireRing(0.2) : pavePendant(0.3)
  return buildProductionPackage({
    piece: {
      id: 'pc_1',
      title: which === 'ring' ? 'Solitaire' : 'Iced A',
      kind: which,
      sku: which === 'ring' ? 'SOL/01' : 'ICE-A',
    },
    revision: 2,
    design,
    evaluation,
    kernel: fixtureKernel(evaluation),
    options: {
      quantity: 10,
      date: '2026-11-23T10:00:00Z',
      author: { name: 'M. Rossi' },
      org: { name: 'Atelier' },
      ...options,
    },
  })
}

describe('production package', () => {
  it('contains the research bundle layout with matching hashes', async () => {
    const pkg = await build('ring')
    expect(pkg.root).toBe('SOL-01_r2_production')
    const paths = pkg.files.map((f) => f.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'spec-sheet.pdf',
        'drawings/front.svg',
        'drawings/top.svg',
        'drawings/side.svg',
        'drawings/iso.svg',
        'drawings/section.svg',
        'cad/SOL-01_Ring_pt950_US6.stl',
        'cad/SOL-01_stones_REFERENCE.stl',
        'cad/SOL-01.3dm',
        'cad/SOL-01.step',
        'cad/SOL-01.3mf',
        'bom.csv',
        'stones.csv',
        'cost-estimate.json',
        'dfm-report.json',
        'rfq-email.md',
      ]),
    )
    for (const p of paths) expect(p).toMatch(/^[A-Za-z0-9._/-]+$/)

    const m = pkg.manifest
    expect(m).toMatchObject({ units: 'mm', shrinkageCompensated: false, revision: 2, quantity: 10 })
    expect(m.files.map((f) => f.path)).toEqual(paths.filter((p) => p !== 'manifest.json'))
    for (const f of m.files)
      expect(f.sha256).toBe(await sha256(pkg.files.find((x) => x.path === f.path)!.bytes))
    expect(m.parts[0]).toMatchObject({
      alloy: 'pt950',
      watertight: true,
      file: 'cad/SOL-01_Ring_pt950_US6.stl',
    })
    expect(m.parts[0]!.sha256).toBe(m.files.find((f) => f.path === m.parts[0]!.file)!.sha256)

    const zip = unzipSync(pkg.zip)
    expect(Object.keys(zip).sort()).toEqual(paths.map((p) => `${pkg.root}/${p}`).sort())
    expect(new TextDecoder().decode(zip[`${pkg.root}/spec-sheet.pdf`]!.subarray(0, 5))).toBe(
      '%PDF-',
    )
    const bom = zip[`${pkg.root}/bom.csv`]!
    expect([...bom.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bom)).toContain('\r\n')

    const rfq = new TextDecoder().decode(zip[`${pkg.root}/rfq-email.md`]!)
    expect(rfq).toContain('10 × Solitaire')
    for (const p of paths.filter((p) => p !== 'rfq-email.md')) expect(rfq).toContain(`\`${p}\``)
  })

  it('is byte-for-byte deterministic', async () => {
    const [a, b] = [await build('ring'), await build('ring')]
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path))
    for (const [i, f] of a.files.entries())
      expect(await sha256(f.bytes), f.path).toBe(await sha256(b.files[i]!.bytes))
    expect(await sha256(a.zip)).toBe(await sha256(b.zip))
  })

  it('builds a pavé pendant with keyed stone lots', async () => {
    const pkg = await build('pendant', { paper: 'letter', units: 'in' })
    const stones = new TextDecoder().decode(pkg.files.find((f) => f.path === 'stones.csv')!.bytes)
    expect(stones.split('\r\n')[1]).toMatch(/^S1,melee,Moissanite,lab-created,round,/)
    expect(pkg.manifest.stones.count).toBeGreaterThan(20)
    const front = new TextDecoder().decode(
      pkg.files.find((f) => f.path === 'drawings/front.svg')!.bytes,
    )
    // Both graded lots of the one pavé field share a callout.
    expect(front).toContain('>S1–S2</text>')
    expect(front).toMatch(/\d\.\d{3} \[\d+\.\d{2}\]/)
  })

  it('rejects invalid options', async () => {
    await expect(build('ring', { date: 'yesterday' })).rejects.toThrow(/date/)
    await expect(build('ring', { quantity: 0 })).rejects.toThrow(/quantity/)
  })

  it('loads the embedded fonts from the fontsource packages', async () => {
    const f = await loadFonts()
    expect(f.sans.regular.length).toBeGreaterThan(10_000)
    expect(new TextDecoder().decode(f.serif.subarray(0, 4))).toBe('wOFF')
  })
})
