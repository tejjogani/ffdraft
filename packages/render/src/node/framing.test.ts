/**
 * What you frame is what Blender renders. A custom, rolled, non-square view is rendered by
 * Blender (low samples) and its subject matte compared with the same view drawn through the
 * browser preview's camera (the three.js camera `applyResolvedScene` places), rasterised here
 * triangle by triangle. Then the same scene is rendered again and the pixels compared: with the
 * fixed seed a take is reproducible. Skipped where the Blender worker is not set up.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Evaluation } from '@pave/kernel/types'
import { RenderSceneSchema } from '@pave/schema'
import { PerspectiveCamera, Scene, Vector3 } from 'three'
import { afterAll, describe, expect, it } from 'vitest'
import { writeGlb } from '../../../kernel/src/export/glb'
import { decodePng } from '../../../kernel/src/mesh/image/png'
import { solitaireRing } from '../../fixtures'
import { resolveScene } from '../resolve'
import { toThreePoint } from '../three/space'
import { applyResolvedScene } from '../three/stage'
import type { ResolvedScene } from '../types'
import { detectBlender, renderWithBlender } from './index'

/** The piece's coverage through the browser camera: 1 where a pixel centre is inside a triangle. */
function browserSilhouette(e: Evaluation, resolved: ResolvedScene): Uint8Array {
  const { width: w, height: h } = resolved.output
  const camera = new PerspectiveCamera(30, w / h, 0.1, 5000)
  applyResolvedScene(new Scene(), camera, resolved)
  camera.updateMatrixWorld()
  const mask = new Uint8Array(w * h)
  const v = new Vector3()
  const toPixel = (x: number, y: number, z: number): [number, number] => {
    v.copy(toThreePoint([x, y, z])).project(camera)
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]
  }
  const fill = (a: [number, number], b: [number, number], c: [number, number]) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(area) < 1e-12) return
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const e0 = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / area
        const e1 = ((c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0])) / area
        const e2 = ((a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0])) / area
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) mask[y * w + x] = 1
      }
  }
  const draw = (pos: Float32Array, idx: Uint32Array, m?: number[]) => {
    const p = (i: number): [number, number] => {
      const x = pos[i * 3]!
      const y = pos[i * 3 + 1]!
      const z = pos[i * 3 + 2]!
      if (!m) return toPixel(x, y, z)
      // Column-major instance matrix, as the kernel stores it.
      return toPixel(
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      )
    }
    for (let t = 0; t < idx.length; t += 3) fill(p(idx[t]!), p(idx[t + 1]!), p(idx[t + 2]!))
  }
  for (const part of e.parts) draw(part.mesh.positions, part.mesh.indices)
  for (const s of e.stones) {
    const mesh = e.gemMeshes[s.meshKey]!
    draw(mesh.positions, mesh.indices, s.matrix)
  }
  return mask
}

async function blenderSilhouette(
  path: string,
): Promise<{ mask: Uint8Array; w: number; h: number }> {
  const png = decodePng(await readFile(path))
  const mask = new Uint8Array(png.width * png.height)
  for (let i = 0; i < mask.length; i++) mask[i] = png.rgba[i * 4 + 3]! >= 0.5 ? 1 : 0
  return { mask, w: png.width, h: png.height }
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0
  let either = 0
  for (let i = 0; i < a.length; i++) {
    both += a[i]! & b[i]!
    either += a[i]! | b[i]!
  }
  return either ? both / either : 1
}

const capability = await detectBlender()
const dirs: string[] = []
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))))

describe.skipIf(!capability.available)('framing in Blender', () => {
  it('renders the silhouette the browser camera frames, and the same pixels twice', async () => {
    const evaluation = solitaireRing()
    // A view no preset gives: low, to the left, rolled, landscape.
    const scene = RenderSceneSchema.parse({
      look: 'studio-soft',
      camera: {
        preset: 'custom',
        position: [-38, -52, 16],
        target: [0.8, 0, 7.5],
        roll: -14,
        focalLength: 85,
      },
      environment: { background: 'transparent' },
      ground: 'none',
      output: { width: 480, height: 320, quality: 'preview' },
    })
    const resolved = resolveScene(scene, evaluation)
    expect(resolved.camera.roll).toBe(-14)
    const glb = writeGlb(evaluation)
    const outDir = await mkdtemp(join(tmpdir(), 'pave-framing-'))
    dirs.push(outDir)
    const first = await renderWithBlender({ resolved, glb, outDir: join(outDir, 'a') })
    const { mask, w, h } = await blenderSilhouette(first.files.mask)
    expect([w, h]).toEqual([resolved.output.width, resolved.output.height])
    const browser = browserSilhouette(evaluation, resolved)
    const overlap = iou(mask, browser)
    console.log(`Blender vs browser camera silhouette IoU: ${overlap.toFixed(4)}`)
    expect(overlap).toBeGreaterThanOrEqual(0.98)

    const second = await renderWithBlender({ resolved, glb, outDir: join(outDir, 'b') })
    const [a, b] = await Promise.all([readFile(first.files.image!), readFile(second.files.image!)])
    expect(a.equals(b)).toBe(true)
  }, 600_000)
})
