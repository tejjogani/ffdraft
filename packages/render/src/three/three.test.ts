import { RenderSceneSchema } from '@pave/schema'
import { InstancedMesh, Mesh, PerspectiveCamera, Scene, ShadowMaterial, Vector3 } from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { describe, expect, it } from 'vitest'
import { paveBar, solitaireRing } from '../../fixtures'
import { cameraPose } from '../camera'
import { resolveScene } from '../resolve'
import { buildRigScene, captureFloor, sparkleUniforms } from './environment'
import { evaluationToThree } from './evaluation'
import { GemMaterial } from './gem'
import { toThreePoint, toThreeQuat, zUpGroup } from './space'
import { applyResolvedScene } from './stage'

const resolved = (look: 'studio-soft' | 'black-acrylic' | 'editorial-warm' = 'studio-soft') =>
  resolveScene(RenderSceneSchema.parse({ look }), solitaireRing())

describe('space', () => {
  it('maps the Z-up frame onto three.js Y-up consistently for groups, points and rotations', () => {
    const group = zUpGroup('g')
    group.updateMatrixWorld()
    const p = new Vector3(1, 2, 3).applyMatrix4(group.matrixWorld)
    expect(p.toArray()).toEqual(
      toThreePoint([1, 2, 3])
        .toArray()
        .map((v) => expect.closeTo(v)),
    )
    // A camera pose looks at its target after conversion.
    const r = resolved()
    const { position, quaternion } = cameraPose(r.camera)
    const forward = new Vector3(0, 0, -1).applyQuaternion(toThreeQuat(quaternion))
    const toTarget = toThreePoint(r.camera.target).sub(toThreePoint(position)).normalize()
    expect(forward.dot(toTarget)).toBeCloseTo(1, 5)
  })
})

describe('evaluationToThree', () => {
  it('builds one mesh per part and instanced gems', () => {
    const model = evaluationToThree(solitaireRing(), resolved())
    const meshes: Mesh[] = []
    model.object.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o)
    })
    expect(meshes.filter((m) => m.userData.role === 'metal').map((m) => m.name)).toEqual([
      'shank',
      'head',
    ])
    const gems = meshes.filter((m): m is InstancedMesh => m instanceof InstancedMesh)
    expect(gems).toHaveLength(1)
    expect(gems[0]!.material).toBeInstanceOf(GemMaterial)
    model.dispose()
  })

  it('instances a pavé field in one draw with the melee quality tier', () => {
    const model = evaluationToThree(paveBar())
    const gems: InstancedMesh[] = []
    model.object.traverse((o) => {
      if (o instanceof InstancedMesh) gems.push(o)
    })
    expect(gems).toHaveLength(1)
    expect(gems[0]!.count).toBe(300)
    expect((gems[0]!.material as GemMaterial).uniforms.bounces!.value).toBe(2)
    model.setGemQuality('melee', { bounces: 1, dispersion: false })
    expect((gems[0]!.material as GemMaterial).uniforms.bounces!.value).toBe(1)
    model.dispose()
  })
})

describe('environment', () => {
  it('captures every panel, plus a mirrored rig under acrylic', () => {
    const soft = resolved()
    let panels = 0
    buildRigScene(soft.rig, soft.subject.radius, captureFloor(soft)).traverse((o) => {
      if (o instanceof Mesh && soft.rig.panels.some((p) => p.id === o.name)) panels++
    })
    expect(panels).toBe(soft.rig.panels.length)

    const acrylic = resolved('black-acrylic')
    const floor = captureFloor(acrylic)
    expect(floor?.kind).toBe('mirror')
    expect(floor?.kind === 'mirror' && floor.reflectance).toBeGreaterThan(0.2)
    expect(captureFloor(resolved('editorial-warm'))?.kind).toBe('emitter')
  })

  it('turns sparkle lights with the rig', () => {
    const r = resolved()
    const a = sparkleUniforms(r.rig, 0)
    const b = sparkleUniforms(r.rig, 90)
    expect(a.positions).toHaveLength(r.rig.sparkles.length)
    expect(a.positions[0]!.distanceTo(b.positions[0]!)).toBeGreaterThan(1)
    expect(a.radiance[0]!.x).toBeGreaterThan(0)
  })

  it('previews White gloss with a reflector, contact shadow and diffuse floor bounce', () => {
    const white = resolveScene(RenderSceneSchema.parse({ ground: 'white-gloss' }), solitaireRing())
    const floor = captureFloor(white)
    expect(floor?.kind).toBe('emitter')
    if (floor?.kind === 'emitter') expect(Math.min(...floor.radiance)).toBeGreaterThan(0)

    const scene = new Scene()
    const controller = applyResolvedScene(scene, new PerspectiveCamera(), white)
    let reflector: Reflector | undefined
    let shadow = false
    scene.traverse((object) => {
      if (object instanceof Reflector) reflector = object
      if (object instanceof Mesh && object.material instanceof ShadowMaterial) shadow = true
    })
    expect(reflector).toBeDefined()
    expect(shadow).toBe(true)

    let disposed = 0
    const material = reflector?.material
    if (material && !Array.isArray(material)) material.addEventListener('dispose', () => disposed++)
    controller.dispose()
    expect(disposed).toBe(1)
  })
})
