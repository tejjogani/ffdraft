import { FINISH_IDS, GEM_MATERIAL_IDS, GEM_MATERIALS, METAL_IDS, PLATING_IDS, RenderSceneSchema, type RenderSceneInput } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { paveBar, solitaireRing } from '../fixtures'
import { ease, sampleTrack } from './animation'
import { cameraBasis, cameraPose, viewTangents } from './camera'
import { LOOK_IDS } from './looks'
import { gemMaterial, metalKey, metalMaterial } from './materials'
import { dot, rotate, sub, type Vec3 } from './math'
import { resolveScene } from './resolve'
import { subjectOf } from './subject'

const scene = (input: RenderSceneInput = {}) => RenderSceneSchema.parse(input)
const ring = solitaireRing()
// Every metal vertex plus the stone's support points.
const points: Vec3[] = [
  ...ring.parts.flatMap((part) =>
    Array.from({ length: part.mesh.positions.length / 3 }, (_, i) => Array.from(part.mesh.positions.subarray(i * 3, i * 3 + 3)) as Vec3),
  ),
  ...subjectOf(ring).silhouette!,
]

describe('material library', () => {
  it('covers every metal, finish and plating', () => {
    for (const m of METAL_IDS)
      for (const f of FINISH_IDS)
        for (const p of PLATING_IDS) {
          const mat = metalMaterial(m, f, p)
          expect(mat.roughness).toBeGreaterThan(0)
          for (const c of [...mat.color, ...mat.edgeTint]) expect(c).toBeGreaterThan(0)
        }
  })

  it('lets a plating replace the alloy colour', () => {
    expect(metalMaterial('au18k-white', 'polished', 'rhodium').color).toEqual([0.8, 0.77, 0.745])
    expect(metalMaterial('au18k-white', 'polished', 'none').color).not.toEqual([0.8, 0.77, 0.745])
  })

  it('shades opaque stones as surfaces and derives dispersion from the Abbe number', () => {
    for (const id of GEM_MATERIAL_IDS) {
      const m = gemMaterial(id)
      expect(m.kind === 'surface').toBe(Boolean((GEM_MATERIALS[id] as { opaque?: boolean }).opaque))
      expect(m.ior).toBe(GEM_MATERIALS[id].ri)
    }
    const diamond = gemMaterial('diamond')
    expect(diamond.kind === 'gem' && diamond.dispersion).toBeCloseTo(0.36, 2)
  })
})

describe('resolveScene', () => {
  it('is deterministic and JSON-clean', () => {
    const a = resolveScene(scene({ look: 'black-acrylic', animation: { type: 'turntable' } }), ring)
    const b = resolveScene(scene({ look: 'black-acrylic', animation: { type: 'turntable' } }), subjectOf(ring))
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  it('resolves every look', () => {
    for (const look of LOOK_IDS) {
      const r = resolveScene(scene({ look }), ring)
      expect(r.rig.panels.length).toBeGreaterThan(0)
      expect(r.rig.sparkles.length).toBeGreaterThan(0)
    }
  })

  it('frames the silhouette inside the 55–75 % fill band, centred', () => {
    for (const preset of ['hero', 'front', 'side', 'top', 'three-quarter'] as const) {
      const r = resolveScene(scene({ camera: { preset }, output: { width: 1600, height: 1200 } }), ring)
      const { position, quaternion } = cameraPose(r.camera)
      const [tx, ty] = viewTangents(r.camera.focalLength, 1600 / 1200)
      const right = rotate(quaternion, [1, 0, 0])
      const up = rotate(quaternion, [0, 1, 0])
      const fwd = rotate(quaternion, [0, 0, -1])
      let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity]
      for (const p of points) {
        const rel = sub(p, position)
        const depth = dot(rel, fwd)
        u0 = Math.min(u0, dot(rel, right) / depth / tx)
        u1 = Math.max(u1, dot(rel, right) / depth / tx)
        v0 = Math.min(v0, dot(rel, up) / depth / ty)
        v1 = Math.max(v1, dot(rel, up) / depth / ty)
      }
      const fill = Math.max((u1 - u0) / 2, (v1 - v0) / 2)
      expect(fill, preset).toBeGreaterThan(0.55)
      expect(fill, preset).toBeLessThanOrEqual(0.75)
      expect(Math.abs(u0 + u1), preset).toBeLessThan(0.05)
      expect(Math.abs(v0 + v1), preset).toBeLessThan(0.05)
    }
  })

  it('keeps top views upright and the orbit basis orthonormal', () => {
    const { right, up, back } = cameraBasis(30, 90)
    expect(dot(right, up)).toBeCloseTo(0)
    expect(dot(up, back)).toBeCloseTo(0)
    expect(back[2]).toBeCloseTo(1)
  })

  it('focuses on the centre stone by default and honours a custom camera', () => {
    const r = resolveScene(scene({ camera: { preset: 'hero', fStop: 4 } }), ring)
    expect(r.camera.fStop).toBe(4)
    expect(r.camera.focusDistance).toBeGreaterThan(r.camera.distance * 0.8)
    const c = resolveScene(scene({ camera: { preset: 'custom', position: [0, -100, 0], target: [0, 0, 0] } }), ring)
    expect(c.camera.azimuth).toBeCloseTo(0)
    expect(c.camera.elevation).toBeCloseTo(0)
    expect(c.camera.distance).toBeCloseTo(100)
  })

  it('applies per-node overrides and assigns every part and stone', () => {
    const r = resolveScene(scene({ overrides: { shank: { material: 'au18k-rose' }, center: { stone: 'sapphire-blue' } } }), ring)
    expect(r.assignments.shank).toBe(metalKey('au18k-rose', 'polished', 'none'))
    expect(r.assignments.head).toBe(metalKey('au18k-yellow', 'polished', 'none'))
    expect(r.assignments['center:0']).toBe('gem:sapphire-blue')
    for (const key of Object.values(r.assignments)) expect(r.materials[key]).toBeDefined()

    const bar = resolveScene(scene(), paveBar())
    expect(Object.keys(bar.assignments)).toHaveLength(301)
    expect(Object.keys(bar.materials)).toHaveLength(2)
  })

  it('scales the rig with the piece so reflections are size-independent', () => {
    const small = resolveScene(scene(), subjectOf(ring))
    const s = subjectOf(ring)
    const double = (v: Vec3) => v.map((x) => x * 2) as Vec3
    const big = resolveScene(scene(), {
      ...s,
      bounds: { min: double(s.bounds.min), max: double(s.bounds.max) },
      silhouette: s.silhouette!.map(double),
    })
    const [p0, p1] = [small.rig.panels[0]!, big.rig.panels[0]!]
    expect(p1.size[0]).toBeCloseTo(p0.size[0] * 2)
    expect(p1.radiance).toEqual(p0.radiance)
    expect(big.camera.distance).toBeCloseTo(small.camera.distance * 2, 1)
  })

  it('rotates the environment and scales its intensity', () => {
    const r = resolveScene(scene({ environment: { rotation: 45, intensity: 2 } }), ring)
    const base = resolveScene(scene(), ring)
    expect(r.rig.rotation).toBe(45)
    expect(r.rig.panels[0]!.radiance[0]).toBeCloseTo(base.rig.panels[0]!.radiance[0] * 2)
    expect(resolveScene(scene({ sparkle: 0 }), ring).rig.sparkles).toHaveLength(0)
  })

  it('resolves grounds and backgrounds', () => {
    expect(resolveScene(scene({ look: 'black-acrylic' }), ring).ground.kind).toBe('reflective')
    const sweep = resolveScene(scene({ ground: 'sweep' }), ring).ground
    expect(sweep.kind === 'sweep' && sweep.z).toBe(ring.report.bounds.min[2])
    expect(resolveScene(scene({ environment: { background: 'transparent' } }), ring).background).toEqual({ kind: 'transparent' })
    expect(resolveScene(scene({ environment: { background: 'color', color: '#ff0000' } }), ring).background).toEqual({
      kind: 'solid',
      color: [1, 0, 0],
    })
  })

  it('caps resolution and sets bounces per tier', () => {
    const preview = resolveScene(scene({ output: { quality: 'preview', width: 2000, height: 1000 } }), ring).output
    expect([preview.width, preview.height]).toEqual([768, 384])
    expect(preview.bounces.transmission).toBeGreaterThanOrEqual(24)
    expect(preview.bounces.glossy).toBeGreaterThanOrEqual(12)
    const final = resolveScene(scene({ output: { quality: 'final', width: 3000, height: 3000 } }), ring).output
    expect(final.width).toBe(3000)
    expect(final.clampIndirect).toBe(0)
  })
})

describe('animation', () => {
  it('builds a seamless turntable', () => {
    const r = resolveScene(scene({ animation: { type: 'turntable', seconds: 4, fps: 30 } }), ring)
    expect(r.animation?.frameCount).toBe(120)
    expect(r.animation?.loop).toBe(true)
    const keys = r.animation!.tracks.pieceRotation!
    expect(sampleTrack(keys, 60)).toBeCloseTo(180)
    expect(sampleTrack(keys, 120)).toBe(360)
  })

  it('stops down for rack focus and travels near → far', () => {
    const r = resolveScene(scene({ animation: { type: 'rack-focus' } }), ring)
    expect(r.camera.fStop).toBe(2.8)
    const keys = r.animation!.tracks.focusDistance!
    expect(sampleTrack(keys, 0)).toBeLessThan(sampleTrack(keys, r.animation!.frameCount - 1))
  })

  it('eases with Penner cubics', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(e, 0)).toBe(0)
      expect(ease(e, 1)).toBe(1)
    }
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5)
    expect(ease('easeIn', 0.5)).toBeCloseTo(0.125)
  })
})
