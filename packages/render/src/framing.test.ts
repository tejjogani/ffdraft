import { type RenderSceneInput, RenderSceneSchema } from '@pave/schema'
import { PerspectiveCamera, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { solitaireRing } from '../fixtures'
import { cameraPose } from './camera'
import {
  customCameraPatch,
  dollyBy,
  orbitBy,
  panBy,
  poseOf,
  predictFraming,
  projectPoint,
  resetCameraPatch,
  rollBy,
  sceneHash,
} from './framing'
import type { Vec3 } from './math'
import { resolveScene } from './resolve'
import { boundsCenter, boundsRadius, subjectOf } from './subject'
import { toThreePoint } from './three/space'
import { applyResolvedScene } from './three/stage'

const scene = (input: RenderSceneInput = {}) => RenderSceneSchema.parse(input)
const ring = solitaireRing()
const subject = subjectOf(ring)
const center = boundsCenter(subject.bounds)
const radius = boundsRadius(subject.bounds)
const vertices: Vec3[] = ring.parts.flatMap((part) =>
  Array.from(
    { length: part.mesh.positions.length / 3 },
    (_, i) => Array.from(part.mesh.positions.subarray(i * 3, i * 3 + 3)) as Vec3,
  ),
)

const merge = (base: RenderSceneInput, patch: { camera: Record<string, unknown> }) =>
  scene({
    ...base,
    camera: Object.fromEntries(
      Object.entries({ ...(base.camera ?? {}), ...patch.camera }).filter(([, v]) => v !== null),
    ) as RenderSceneInput['camera'],
  })

describe('custom camera', () => {
  it('stores a viewfinder pose and resolves back to exactly that pose', () => {
    const start = resolveScene(scene({ camera: { preset: 'hero' } }), ring).camera
    const moved = rollBy(orbitBy(dollyBy(poseOf(start, radius), 0.8), 20, -10), 12)
    const patch = customCameraPatch(moved, { center, radius }, 'hero')
    const r = resolveScene(merge({}, patch), ring).camera
    expect(r.azimuth).toBeCloseTo(moved.azimuth, 2)
    expect(r.elevation).toBeCloseTo(moved.elevation, 2)
    expect(r.distance).toBeCloseTo(moved.distance, 2)
    expect(r.roll).toBe(12)
    expect(r.target).toEqual(patch.camera.target)
  })

  it('holds elevation short of straight down and keeps the camera off the piece', () => {
    const start = poseOf(resolveScene(scene(), ring).camera, radius)
    expect(orbitBy(start, 0, 500).elevation).toBe(89.5)
    expect(orbitBy(start, 0, -500).elevation).toBe(-89.5)
    expect(orbitBy(start, 400, 0).azimuth).toBeCloseTo(start.azimuth + 40)
    expect(dollyBy(start, 0.0001).distance).toBe(radius * 0.25)
  })

  it('pans camera and target together, in shares of the frame', () => {
    const start = poseOf(resolveScene(scene(), ring).camera, radius)
    const panned = panBy(start, 0.25, 0, 1)
    // The old target now sits a quarter of the frame left of centre.
    const at = projectPoint(panned, 1, start.target)!
    expect(at[0]).toBeCloseTo(0.25, 5)
    expect(at[1]).toBeCloseTo(0.5, 5)
    expect(panned.distance).toBe(start.distance)
  })

  it('turns the picture clockwise for a positive roll', () => {
    const c = resolveScene(scene(), ring).camera
    const above: Vec3 = [c.target[0], c.target[1], c.target[2] + 1]
    // Upright, a point above the target is straight up in the picture…
    const upright = projectPoint(c, 1, above)!
    expect(upright[0]).toBeCloseTo(0.5, 5)
    expect(upright[1]).toBeLessThan(0.5)
    // …and a quarter turn clockwise puts it to the right of centre.
    const rolled = projectPoint({ ...c, roll: 90 }, 1, above)!
    expect(rolled[0]).toBeGreaterThan(0.5)
    expect(rolled[1]).toBeCloseTo(0.5, 5)
  })

  it('scales with a piece of another size, and is exact on its own piece', () => {
    const start = poseOf(resolveScene(scene(), ring).camera, radius)
    const patch = customCameraPatch(orbitBy(start, 15, 5), { center, radius })
    const own = resolveScene(merge({}, patch), ring).camera
    const big = solitaireRing({ stoneWidth: 9 })
    const onBig = resolveScene(merge({}, patch), big).camera
    const bigRadius = boundsRadius(big.report.bounds)
    expect(onBig.distance / own.distance).toBeCloseTo(bigRadius / radius, 3)
    expect(onBig.azimuth).toBeCloseTo(own.azimuth, 3)
    const fill = (e: typeof ring, c: typeof own) =>
      predictFraming(c, 1, subjectOf(e).silhouette!).fill
    expect(fill(big, onBig)).toBeCloseTo(fill(ring, own), 1)
  })

  it('resets to the preset it started from', () => {
    const patch = resetCameraPatch(
      RenderSceneSchema.shape.camera.parse({
        preset: 'custom',
        position: [1, 2, 3],
        target: [0, 0, 0],
        basePreset: 'top',
        focalLength: 90,
      }),
    )
    expect(patch.camera).toMatchObject({ preset: 'top', position: null, roll: null })
  })
})

describe('the browser camera', () => {
  // The live preview places a three.js camera from the resolved scene; the projection here
  // is what Blender's camera is built from. They must agree point for point.
  it('projects every vertex where projectPoint says, with roll and a wide frame', () => {
    const s = scene({
      camera: {
        preset: 'custom',
        position: [40, -55, 30],
        target: [0.5, 0, 6],
        roll: 17,
        focalLength: 80,
      },
      output: { width: 2400, height: 1600, quality: 'standard' },
    })
    const r = resolveScene(s, ring)
    // The aspect both renderers use is the resolved output's (2048×1366 here, not 3:2).
    const aspect = r.output.width / r.output.height
    const camera = new PerspectiveCamera(30, aspect, 0.1, 5000)
    applyResolvedScene(new Scene(), camera, r)
    camera.updateMatrixWorld()
    let worst = 0
    for (const p of vertices.filter((_, i) => i % 7 === 0)) {
      const ndc = toThreePoint(p).project(camera)
      const ours = projectPoint(r.camera, aspect, p)!
      worst = Math.max(
        worst,
        Math.abs((ndc.x + 1) / 2 - ours[0]),
        Math.abs((1 - ndc.y) / 2 - ours[1]),
      )
    }
    expect(worst).toBeLessThan(1e-6)
    // And the three.js camera stands where the pose says.
    const { position } = cameraPose(r.camera)
    expect(camera.position.distanceTo(toThreePoint(position))).toBeLessThan(1e-9)
    expect(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).length()).toBeCloseTo(1)
  })
})

describe('predictFraming', () => {
  it('says how much of the frame the piece fills, in the critique’s words', () => {
    const r = resolveScene(scene({ camera: { preset: 'hero' } }), ring).camera
    const f = predictFraming(r, 1, vertices)
    // Presets aim at 68 %; the support points they frame by sit inside the true outline.
    expect(f.fill).toBeGreaterThan(0.6)
    expect(f.fill).toBeLessThan(0.75)
    expect(f.verdict).toBe('good')
    expect(f.label).toMatch(/^\d+% · good$/)
    const far = predictFraming(dollyBy(poseOf(r, radius), 3), 1, vertices)
    expect(far.verdict).toBe('small')
    const near = predictFraming(dollyBy(poseOf(r, radius), 0.4), 1, vertices)
    expect(near.verdict).toBe('cropped')
    const away = predictFraming(orbitBy(panBy(poseOf(r, radius), 3, 0, 1), 0, 0), 1, vertices)
    expect(away.verdict).toBe('empty')
  })
})

describe('sceneHash', () => {
  it('is the same for the same scene and design, and changes with either', () => {
    const a = resolveScene(scene({ camera: { preset: 'hero' } }), ring)
    const b = resolveScene(scene({ camera: { preset: 'hero' } }), ring)
    const design = { pieceId: 'pc_1', version: 3 }
    expect(sceneHash(a, design)).toBe(sceneHash(b, design))
    expect(sceneHash(a, design)).toMatch(/^[0-9a-f]{28}$/)
    expect(sceneHash(a, { ...design, version: 4 })).not.toBe(sceneHash(a, design))
    const rolled = resolveScene(scene({ camera: { preset: 'hero', roll: 1 } }), ring)
    expect(sceneHash(rolled, design)).not.toBe(sceneHash(a, design))
    // A last-bit difference in a sine (the browser and Node can differ there) does not matter.
    const nudged = structuredClone(a)
    nudged.rig.sparkles[0]!.position[0] += 1e-12
    expect(sceneHash(nudged, design)).toBe(sceneHash(a, design))
    // Key order does not matter.
    const reordered = Object.fromEntries(Object.entries(a).reverse())
    expect(sceneHash(reordered, design)).toBe(sceneHash(a, design))
  })
})
