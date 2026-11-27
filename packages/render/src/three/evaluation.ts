/**
 * The single place an Evaluation becomes three.js objects: one Mesh per metal part, one
 * InstancedMesh per (gem mesh, material, quality tier) so pavé fields cost one draw call and
 * one BVH. Everything is authored in the kernel's Z-up millimetres under a converting root.
 */
import type { Evaluation, MeshData, StoneInstance } from '@pave/kernel/types'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  type Matrix3,
  Matrix4,
  Mesh,
} from 'three'
import { gemKey, gemMaterial, metalKey, metalMaterial, type ResolvedMaterial } from '../materials'
import { boundsCenter } from '../subject'
import type { ResolvedScene } from '../types'
import type { PaveEnvironment } from './environment'
import { environmentRotation } from './environment'
import { createSurfaceGemMaterial, GEM_QUALITY, GemMaterial, type GemQuality } from './gem'
import { createMetalMaterialFrom } from './metal'
import { zUpGroup } from './space'

function geometryOf(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  g.setIndex(new BufferAttribute(mesh.indices, 1))
  g.computeBoundingSphere()
  return g
}

type Tier = 'hero' | 'melee'
const tierOf = (role: StoneInstance['role']): Tier =>
  role === 'center' || role === 'side' ? 'hero' : 'melee'

export interface EvaluationToThreeOptions {
  environment?: PaveEnvironment
  /** Gem shader quality per tier; drop melee to 1–2 bounces while orbiting (research §5). */
  gemQuality?: Partial<Record<Tier, GemQuality>>
}

export class PaveModel {
  /** Add this to the scene. Z-up → Y-up conversion is applied here. */
  readonly object: Group
  /** Turntables rotate this about the piece's vertical axis through the pivot. */
  readonly spin: Group
  private readonly gems: { material: GemMaterial; tier: Tier }[] = []
  private readonly disposables: { dispose(): void }[] = []

  constructor(
    evaluation: Evaluation,
    resolved?: ResolvedScene,
    options: EvaluationToThreeOptions = {},
  ) {
    this.object = zUpGroup('pave-piece')
    this.spin = new Group()
    this.spin.name = 'spin'
    const content = new Group()
    const pivot = resolved?.rig.pivot ?? boundsCenter(evaluation.report.bounds)
    this.spin.position.set(pivot[0], pivot[1], 0)
    content.position.set(-pivot[0], -pivot[1], 0)
    this.object.add(this.spin)
    this.spin.add(content)

    const materials = new Map<string, Material>()
    const resolve = (key: string, fallback: () => ResolvedMaterial): ResolvedMaterial =>
      resolved?.materials[key] ?? fallback()

    for (const part of evaluation.parts) {
      const key =
        resolved?.assignments[part.id] ?? metalKey(part.material, part.finish, part.plating)
      let material = materials.get(key)
      if (!material) {
        const m = resolve(key, () => metalMaterial(part.material, part.finish, part.plating))
        if (m.kind === 'gem') throw new Error(`Part ${part.id} is assigned gem material ${key}`)
        material = m.kind === 'surface' ? createSurfaceGemMaterial(m) : createMetalMaterialFrom(m)
        materials.set(key, material)
        this.disposables.push(material)
      }
      const geometry = geometryOf(part.mesh)
      this.disposables.push(geometry)
      const mesh = new Mesh(geometry, material)
      mesh.name = part.id
      mesh.userData = { nodeId: part.nodeId, role: 'metal' }
      mesh.castShadow = true
      mesh.receiveShadow = true
      content.add(mesh)
    }

    const gemGeometry = new Map<string, BufferGeometry>()
    const groups = new Map<string, StoneInstance[]>()
    for (const s of evaluation.stones) {
      const key = `${s.meshKey}|${resolved?.assignments[s.id] ?? gemKey(s.stone)}|${tierOf(s.role)}`
      groups.set(key, [...(groups.get(key) ?? []), s])
    }
    const quality = { ...GEM_QUALITY, ...options.gemQuality }
    for (const [key, stones] of groups) {
      const [meshKey, materialKey, tier] = key.split('|') as [string, string, Tier]
      let geometry = gemGeometry.get(meshKey)
      if (!geometry) {
        const data = evaluation.gemMeshes[meshKey]
        if (!data) throw new Error(`Missing gem mesh "${meshKey}"`)
        geometry = geometryOf(data)
        gemGeometry.set(meshKey, geometry)
        this.disposables.push(geometry)
      }
      const first = stones[0]!
      const m = resolve(materialKey, () => gemMaterial(first.stone))
      let material: Material
      if (m.kind === 'gem') {
        const gem = new GemMaterial(m, geometry, quality[tier])
        this.gems.push({ material: gem, tier })
        material = gem
      } else if (m.kind === 'surface') {
        material = createSurfaceGemMaterial(m)
      } else {
        throw new Error(`Stone ${first.id} is assigned metal material ${materialKey}`)
      }
      this.disposables.push(material)
      const mesh = new InstancedMesh(geometry, material, stones.length)
      const matrix = new Matrix4()
      for (const [i, s] of stones.entries()) mesh.setMatrixAt(i, matrix.fromArray(s.matrix))
      mesh.computeBoundingSphere()
      mesh.name = `gems:${materialKey}:${tier}`
      mesh.userData = { role: 'gem', stoneIds: stones.map((s) => s.id) }
      mesh.castShadow = true
      content.add(mesh)
    }
    if (options.environment) this.setEnvironment(options.environment)
  }

  /** Points every gem at the studio environment, optionally rotated (light sweep). */
  setEnvironment(env: PaveEnvironment, rotationDeg = env.rotation): void {
    const rotation: Matrix3 = environmentRotation(rotationDeg - env.rotation)
    const sparkles = env.sparklesAt(rotationDeg)
    for (const { material } of this.gems) material.setEnvironment(env.texture, rotation, sparkles)
  }

  setGemQuality(tier: Tier, quality: GemQuality): void {
    for (const g of this.gems) if (g.tier === tier) g.material.setQuality(quality)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.object.removeFromParent()
  }
}

export function evaluationToThree(
  evaluation: Evaluation,
  resolved?: ResolvedScene,
  options?: EvaluationToThreeOptions,
): PaveModel {
  return new PaveModel(evaluation, resolved, options)
}
