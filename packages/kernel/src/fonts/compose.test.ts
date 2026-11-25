/**
 * Composed letters (fonts/compose.ts) against their base letters, at pendant size: the stroke
 * of Ł crosses the stem and stands clear of it, and a mark hung under a letter (an ogonek, a
 * cedilla) is only the hook, joined to the letter where the language puts it.
 */
import type { CrossSection } from 'manifold-3d'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime, runtime } from '../runtime/index'
import { type FontId, layoutText, loadFont } from '../text'

beforeAll(() => loadRuntime())

const FONTS: FontId[] = ['sans', 'serif', 'script', 'block']

/** The letter as one filled section, capitals 12 mm tall. */
async function letter(font: FontId, c: string): Promise<CrossSection> {
  const { manifold: mf } = runtime()
  const glyphs = layoutText(await loadFont(font), c, 12).glyphs.map(
    (g) =>
      new mf.CrossSection(
        g.contours.map((c) => c.map(([x, y]): [number, number] => [x, y])),
        'EvenOdd',
      ),
  )
  const s = mf.CrossSection.union(glyphs)
  for (const g of glyphs) g.delete()
  return s
}

describe('composed letters', () => {
  // The script Ł got a stroke about 1 mm long and as thin as the font's hyphen, low on a swash
  // where the box put it: at pendant size Łukasz read as Lukasz.
  it('strikes Ł and ł across the stem, standing clear of it on both sides', async () => {
    const { manifold: mf } = runtime()
    for (const font of FONTS)
      for (const [c, base] of [
        ['Ł', 'L'],
        ['ł', 'l'],
      ] as const) {
        const composed = await letter(font, c)
        const plain = await letter(font, base)
        expect(composed.decompose().length, `${font} ${c}`).toBe(1)
        const extra = mf.CrossSection.difference(composed, plain)
        const sides = extra
          .decompose()
          .filter((p) => p.area() > 0.05)
          .sort((p, q) => p.bounds().min[0] - q.bounds().min[0])
        // One part each side of the stem, each a clear bar end of real weight.
        expect(sides.length, `${font} ${c}`).toBe(2)
        for (const side of sides) expect(side.area(), `${font} ${c}`).toBeGreaterThan(0.4)
        const [l, r] = sides as [CrossSection, CrossSection]
        expect(l.bounds().max[0], `${font} ${c}`).toBeLessThan(r.bounds().min[0])
        // Across one stroke, the stem, not a swash crossing: what lies between the two ends at
        // their height is a single run of metal no wider than a stem.
        const y =
          (l.bounds().min[1] + l.bounds().max[1] + r.bounds().min[1] + r.bounds().max[1]) / 4
        const band = mf.CrossSection.square([
          r.bounds().min[0] - l.bounds().max[0],
          0.02,
        ]).translate([l.bounds().max[0], y - 0.01])
        const stem = mf.CrossSection.intersection(plain, band).decompose()
        expect(stem.length, `${font} ${c}`).toBeLessThanOrEqual(1)
      }
  })

  // The ogonek was cut from Ç with a shelf of its bowl and centred under the letter, as the
  // cedilla is: on Ą it hung between the legs. It belongs at the foot of the right leg.
  it('hangs the ogonek from the right foot, and a cedilla from the bottom, as a hook only', async () => {
    const { manifold: mf } = runtime()
    for (const font of FONTS)
      for (const [c, base, right] of [
        ['Ą', 'A', true],
        ['ą', 'a', true],
        ['Ę', 'E', true],
        ['ę', 'e', true],
        ['Ş', 'S', false],
        ['ş', 's', false],
        ['Ţ', 'T', false],
      ] as const) {
        const composed = await letter(font, c)
        const plain = await letter(font, base)
        expect(composed.decompose().length, `${font} ${c}`).toBe(1)
        const box = plain.bounds()
        const h = box.max[1] - box.min[1]
        const extra = mf.CrossSection.difference(composed, plain)
        // Nothing of the donor's bowl: no metal added above the letter's bottom.
        const shelf = mf.CrossSection.intersection(
          extra,
          mf.CrossSection.square([100, 100]).translate([-50, box.min[1] + 0.03 * h]),
        )
        expect(shelf.area(), `${font} ${c}`).toBeLessThan(0.05)
        const hook = extra.bounds()
        // The middle of the letter's bottom (a slanted script's box leans right of it).
        const foot = mf.CrossSection.intersection(
          plain,
          mf.CrossSection.square([100, 0.08 * h]).translate([-50, box.min[1]]),
        ).bounds()
        const mid = (foot.min[0] + foot.max[0]) / 2
        const cx = (hook.min[0] + hook.max[0]) / 2
        if (right) {
          // Under the right half, and meeting the letter there: its neck, just under the
          // letter's bottom, is right of the middle.
          expect(cx, `${font} ${c}`).toBeGreaterThan(mid)
          const neck = mf.CrossSection.intersection(
            extra,
            mf.CrossSection.square([100, 0.3]).translate([-50, box.min[1] - 0.3]),
          ).bounds()
          expect((neck.min[0] + neck.max[0]) / 2, `${font} ${c}`).toBeGreaterThan(mid)
        }
      }
  })
})
