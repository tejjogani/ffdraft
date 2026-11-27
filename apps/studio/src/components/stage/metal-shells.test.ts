import { createKernel, type Part } from '@pave/kernel'
import { designFrom } from '@pave/schema'
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import { describe, expect, it } from 'vitest'
import { geometryOf, MetalBatch } from './metal-shells'
import { createViewVisibility } from './visibility'

/** BoxGeometry duplicates positions across the face seams, as crease-normal CAD meshes do. */
function boxes(specs: readonly { size: number; z: number; inverted?: boolean }[]): Part {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const { size, z, inverted } of specs) {
    const box = new BoxGeometry(size, size, size).translate(0, 0, z)
    const offset = positions.length / 3
    positions.push(...box.getAttribute('position').array)
    normals.push(...box.getAttribute('normal').array)
    const source = box.getIndex()!.array
    for (let i = 0; i < source.length; i += 3) {
      indices.push(
        offset + source[i]!,
        offset + source[i + (inverted ? 2 : 1)]!,
        offset + source[i + (inverted ? 1 : 2)]!,
      )
    }
  }
  return {
    id: 'links',
    nodeId: 'links',
    rev: '1',
    name: 'Links',
    material: 'au18k-yellow',
    finish: 'polished',
    plating: 'none',
    mesh: {
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
    },
    edges: new Float32Array([0.5, 0.5, 3.5, 0.5, -0.5, 3.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5]),
    volumeMm3: 2,
    areaMm2: 12,
    bounds: { min: [-2, -2, -2], max: [2, 2, 4] },
    exact: false,
  }
}

function pickBatch(part: Part) {
  const mesh = new Mesh(geometryOf(part), new MeshBasicMaterial())
  const batch = new MetalBatch(mesh, part)
  mesh.raycast = acceleratedRaycast
  const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1))
  const pick = () => {
    mesh.geometry.boundsTree ??= new MeshBVH(mesh.geometry, { indirect: true })
    return batch.pick(ray.intersectObject(mesh)[0]?.faceIndex ?? undefined, false, true)
  }
  return { mesh, batch, pick }
}

describe('disconnected metal shells', () => {
  it('isolates one link in a single evaluated draft chain mesh', async () => {
    const kernel = createKernel()
    try {
      const evaluation = await kernel.evaluate(
        designFrom('chain', [
          {
            id: 'links',
            kind: 'chain',
            style: 'cable',
            layout: 'straight',
            length: 100,
            linkWidth: 4,
            wire: 0.8,
          },
        ]),
        { detail: 'draft' },
      )
      expect(evaluation.parts).toHaveLength(1)
      const part = evaluation.parts[0]!
      const { batch, mesh } = pickBatch(part)
      const link = batch.pick(0, false, true)
      expect(link.partId).toBe('links#shell:0')
      batch.setVisibility(createViewVisibility({ hidden: [], isolated: [link] }), true)
      expect(mesh.visible).toBe(true)
      expect(mesh.geometry.getIndex()!.count).toBeLessThan(part.mesh.indices.length / 2)
      expect(batch.pick(0, false, true)).toEqual(link)
    } finally {
      kernel.dispose()
    }
  })

  it('picks a connected, unwelded box as one target', () => {
    const { batch, pick } = pickBatch(boxes([{ size: 1, z: 0 }]))
    expect(pick()).toEqual({ nodeId: 'links' })
    expect(batch.pick(0, false, true)).toEqual({ nodeId: 'links' })
  })

  it('reveals the next part through the hidden shell and restores the original draw buffer', () => {
    const { mesh, batch, pick } = pickBatch(
      boxes([
        { size: 1, z: 3 },
        { size: 1, z: 0 },
      ]),
    )
    const original = mesh.geometry
    const first = pick()
    expect(first).toEqual({ nodeId: 'links', partId: 'links#shell:0' })
    batch.setVisibility(createViewVisibility({ hidden: [], hiddenParts: [first.partId!] }), true)
    expect(pick()).toEqual({ nodeId: 'links', partId: 'links#shell:1' })
    expect(mesh.geometry.getIndex()?.count).toBe(36)
    expect(batch.visiblePart.edges.length).toBe(6)
    expect(batch.visiblePart.bounds.max).toEqual([0.5, 0.5, 0.5])
    batch.setVisibility(createViewVisibility({ hidden: [] }), false)
    expect(mesh.geometry).toBe(original)
    expect(pick()).toEqual(first)
  })

  it('keeps a closed inward cavity together with the metal that surrounds it', () => {
    const part = boxes([
      { size: 4, z: 0 },
      { size: 1, z: 0, inverted: true },
    ])
    const { batch, pick } = pickBatch(part)
    expect(pick()).toEqual({ nodeId: 'links' })
    expect(batch.pick(18, false, true)).toEqual({ nodeId: 'links' })
  })

  it('separates parts that touch at a single vertex', () => {
    const part = boxes([
      { size: 1, z: 0 },
      { size: 1, z: 1 },
    ])
    for (let i = 24 * 3; i < part.mesh.positions.length; i += 3) {
      part.mesh.positions[i]! += 1
      part.mesh.positions[i + 1]! += 1
    }
    const { batch } = pickBatch(part)
    expect(batch.pick(0, false, true)).toEqual({ nodeId: 'links', partId: 'links#shell:0' })
    expect(batch.pick(12, false, true)).toEqual({ nodeId: 'links', partId: 'links#shell:1' })
  })
})
