import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { StoneBatch } from './stone-batch'
import { createViewVisibility } from './visibility'

const first = { nodeId: 'pave', stoneId: 'pave:0' }
const second = { nodeId: 'pave', stoneId: 'pave:1' }

function setting() {
  const geometry = new BoxGeometry()
  const material = new MeshBasicMaterial()
  const gems = new InstancedMesh(geometry, material, 2)
  gems.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, 2))
  gems.setMatrixAt(1, new Matrix4().makeTranslation(0, 0, 0))
  gems.computeBoundingSphere()
  const band = new Mesh(geometry, material)
  band.position.set(0, 0, -2)
  band.updateMatrixWorld()
  const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1))
  const batch = new StoneBatch(gems, [first, second])
  return { batch, closest: () => ray.intersectObjects([gems, band])[0], band }
}

describe('stone batches', () => {
  it('preserves the identity of a stone revealed by hiding the stone in front', () => {
    const { batch, closest } = setting()
    expect(batch.targets[closest()!.instanceId!]).toEqual(first)
    batch.setVisibility(createViewVisibility({ hidden: [], hiddenStones: ['pave:0'] }))
    expect(batch.mesh.count).toBe(1)
    expect(batch.targets[closest()!.instanceId!]).toEqual(second)
  })

  it('picks the metal behind a fully hidden batch', () => {
    const { batch, closest, band } = setting()
    batch.setVisibility(createViewVisibility({ hidden: ['pave'] }))
    expect(batch.mesh.count).toBe(0)
    expect(closest()?.object).toBe(band)
  })

  it('restores original placements and identities after switching isolation', () => {
    const { batch, closest } = setting()
    batch.setVisibility(createViewVisibility({ hidden: [], isolated: [second] }))
    expect(batch.targets[closest()!.instanceId!]).toEqual(second)
    batch.setVisibility(createViewVisibility({ hidden: [], isolated: [first] }))
    expect(batch.targets[closest()!.instanceId!]).toEqual(first)
    batch.setVisibility(createViewVisibility({ hidden: [] }))
    expect(batch.mesh.count).toBe(2)
    expect(batch.targets[closest()!.instanceId!]).toEqual(first)
  })
})
