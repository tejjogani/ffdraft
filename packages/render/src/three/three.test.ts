import { RenderSceneSchema } from '@pave/schema'
import {
  DirectionalLight,
  InstancedMesh,
  type Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import type { MeshBVHUniformStruct } from 'three-mesh-bvh'
import { describe, expect, it, vi } from 'vitest'
import { paveBar, roundBrilliant, solitaireRing } from '../../fixtures'
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
  it('keeps the original triangle order and vertex buffers of an off-origin imported gem', () => {
    const ring = solitaireRing()
    const mesh = roundBrilliant()
    for (let i = 0; i < mesh.positions.length; i += 3) mesh.positions[i]! += 36
    const original = mesh.indices.slice()
    const bounds: typeof ring.report.bounds = { min: [35.5, -0.5, -0.5], max: [36.5, 0.5, 0.5] }
    const imported = {
      ...ring.parts[0]!,
      id: 'imported-diamond',
      nodeId: 'imported-diamond',
      importRole: 'unassigned' as const,
      sourceAppearance: { kind: 'gem', stone: 'diamond' } as const,
      mesh,
      bounds,
    }
    const evaluation = {
      ...ring,
      parts: [imported],
      stones: [],
      report: { ...ring.report, bounds: imported.bounds },
    }
    const settings = RenderSceneSchema.parse({
      includeUnassignedRhino: true,
      importedBodyLook: 'source',
    })
    const model = evaluationToThree(evaluation, resolveScene(settings, evaluation))
    const rendered = model.object.getObjectByName(imported.id)
    expect(rendered).toBeInstanceOf(Mesh)
    const { geometry, material } = rendered as Mesh
    expect(material).toBeInstanceOf(GemMaterial)
    expect(geometry.getAttribute('position').array).toBe(mesh.positions)
    expect(geometry.getAttribute('normal').array).toBe(mesh.normals)
    expect(geometry.index?.array).toBe(mesh.indices)
    expect(mesh.indices).toEqual(original)
    model.dispose()
    expect(mesh.indices).toEqual(original)
  })

  it('releases shared gem textures once after the last material is disposed', () => {
    const ring = solitaireRing()
    ring.stones.push({ ...ring.stones[0]!, id: 'melee:0', role: 'melee' })
    const model = evaluationToThree(ring)
    const batches: InstancedMesh[] = []
    model.object.traverse((o) => {
      if (o instanceof InstancedMesh) batches.push(o)
    })
    expect(batches).toHaveLength(2)
    const [hero, melee] = batches as [InstancedMesh, InstancedMesh]
    expect(hero.geometry).toBe(melee.geometry)
    const material = hero.material as GemMaterial
    const bvh = material.uniforms.bvh!.value as MeshBVHUniformStruct
    expect((melee.material as GemMaterial).uniforms.bvh!.value).toBe(bvh)
    const dispose = vi.spyOn(bvh, 'dispose')
    material.dispose()
    expect(dispose).not.toHaveBeenCalled()
    model.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

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

  it('uses the resolved grade in the browser’s diffuse floor approximation', () => {
    const graded = resolveScene(
      RenderSceneSchema.parse({ ground: 'white-gloss-graded' }),
      solitaireRing(),
    )
    if (graded.ground.kind !== 'white-gloss') throw new Error('Expected a white gloss floor')
    const capture = captureFloor(graded)
    expect(capture).toMatchObject({
      kind: 'emitter',
      reflectionGrade: graded.ground.reflectionGrade,
    })
    const rig = buildRigScene(graded.rig, graded.subject.radius, capture)
    expect(rig.getObjectByName('graded-floor')).toBeInstanceOf(Mesh)
  })
})

describe('render stage disposal', () => {
  it('releases the directional shadow and blur targets when rebuilding a preview', () => {
    const scene = new Scene()
    const stage = applyResolvedScene(scene, new PerspectiveCamera(), resolved())
    const light = scene.getObjectByProperty('type', 'DirectionalLight') as DirectionalLight
    expect(light).toBeInstanceOf(DirectionalLight)
    // WebGLRenderer allocates these on the first draw.
    light.shadow.map = new WebGLRenderTarget(1, 1)
    light.shadow.mapPass = new WebGLRenderTarget(1, 1)
    const shadow = vi.spyOn(light.shadow.map, 'dispose')
    const blur = vi.spyOn(light.shadow.mapPass, 'dispose')
    stage.dispose()
    expect(shadow).toHaveBeenCalledTimes(1)
    expect(blur).toHaveBeenCalledTimes(1)
  })

  it('lets the acrylic reflector dispose its material and render target once', () => {
    const scene = new Scene()
    const stage = applyResolvedScene(scene, new PerspectiveCamera(), resolved('black-acrylic'))
    const mirror = scene.getObjectByProperty('isReflector', true) as Reflector
    expect(mirror).toBeInstanceOf(Reflector)
    const material = vi.spyOn(mirror.material as Material, 'dispose')
    const target = vi.spyOn(mirror.getRenderTarget(), 'dispose')
    stage.dispose()
    expect(material).toHaveBeenCalledTimes(1)
    expect(target).toHaveBeenCalledTimes(1)
  })
})
