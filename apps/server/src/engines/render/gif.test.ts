/**
 * The GIF that rides along with an animation take: made from the composited frames, small, at
 * most 15 fps, looping; nothing (not an error) when there is too little to animate.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gifOf } from './take'

let dir: string
const frames: string[] = []

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pave-gif-'))
  for (let i = 0; i < 24; i++) {
    const path = join(dir, `frame_${String(i).padStart(4, '0')}.png`)
    await sharp({
      create: {
        width: 640,
        height: 800,
        channels: 4,
        background: { r: 10 * i, g: 80, b: 160, alpha: 1 },
      },
    })
      .png()
      .toFile(path)
    frames.push(path)
  }
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('the take’s GIF', () => {
  it('is a looping GIF at most 360 px on the long side and 15 fps', async () => {
    const out = await gifOf(frames, 30, join(dir, 'take.gif'))
    expect(out).toBe(join(dir, 'take.gif'))
    const meta = await sharp(out!, { animated: true }).metadata()
    expect(meta.format).toBe('gif')
    // 30 fps becomes every other frame: 12 pages, each 2/30 s.
    expect(meta.pages).toBe(12)
    expect(meta.loop).toBe(0)
    // GIF stores centiseconds: 67 ms is kept as 70.
    expect(meta.delay?.every((d) => d >= 60 && d <= 70)).toBe(true)
    expect(meta.width).toBe(288)
    expect(meta.pageHeight).toBe(360)
  })

  it('keeps every frame at 15 fps or less', async () => {
    const out = await gifOf(frames.slice(0, 6), 12, join(dir, 'slow.gif'))
    expect((await sharp(out!, { animated: true }).metadata()).pages).toBe(6)
  })

  it('makes nothing from a single frame', async () => {
    expect(await gifOf(frames.slice(0, 1), 30, join(dir, 'one.gif'))).toBeNull()
  })
})
