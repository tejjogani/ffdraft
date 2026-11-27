import { applyOps, designFrom, type NodeInput, type RhinoContext } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { recoverRhinoLabels } from './recover-rhino-labels'
import type { RhinoCurveObject, RhinoMeshObject } from './rhino'

const meshId = 'de3a0000-0000-0000-0000-000000000001'
const pathId = 'de3a0000-0000-0000-0000-000000000002'
const curveId = 'de3a0000-0000-0000-0000-000000000003'
const otherPath = 'de3a0000-0000-0000-0000-000000000004'
const noFixtureId = 'de3a0000-0000-0000-0000-000000000005'
const group = { id: 'read-1:1', name: 'Workshop set' }
const context: RhinoContext = { groups: [group], placements: [], material: 'Reference enamel' }

const part: RhinoMeshObject = {
  name: 'Seat',
  layer: 'Original part',
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  bytes: new Uint8Array([1, 2, 3]),
  native: { bytes: new Uint8Array(), objectId: meshId, instancePath: [pathId] },
  rhinoContext: context,
}
const rail: RhinoCurveObject = {
  name: 'Guide',
  layer: 'Guide layer',
  bounds: { min: [0, 0, 0], max: [1, 2, 3] },
  converted: false,
  degree: 1,
  knots: [0, 1],
  controlPoints: [
    [0, 0, 0, 1],
    [1, 2, 3, 1],
  ],
  sourceObjectId: curveId,
  rhinoContext: { groups: [group], placements: [] },
}

function body(
  id = 'seat',
  options?: { path?: string; context?: RhinoContext; rawMesh?: boolean },
): NodeInput {
  return {
    kind: 'meshBody',
    id,
    keepSourcePlacement: true,
    source: {
      type: 'asset',
      assetId: id,
      rhinoLayer: 'Existing layer label',
      ...(!options?.rawMesh && {
        rhinoObjectId: meshId,
        rhinoInstancePath: [options?.path ?? pathId],
        nativeAssetId: `${id}-native`,
        nativeMeshAssetId: id,
      }),
      ...(options?.context && { rhinoContext: options.context }),
    },
  }
}

function guide(id = 'guide', sourceId = curveId, points = rail.controlPoints): NodeInput {
  return {
    kind: 'nurbsCurve',
    id,
    degree: rail.degree,
    knots: rail.knots,
    controlPoints: points,
    sourceObjectId: sourceId,
  }
}

describe('recoverRhinoLabels', () => {
  it('recovers only source context and keeps shared groups as one change', async () => {
    const design = designFrom('other', [body(), guide()])
    const result = await recoverRhinoLabels(
      design,
      { objects: [part], curves: [rail] },
      async () => part.bytes,
    )
    expect(result.counts).toMatchObject({ parts: 1, curves: 1, ambiguous: 0, unmatched: 0 })
    expect(result.ops).toEqual([
      { t: 'update', id: 'seat', patch: { source: { rhinoContext: context } } },
      { t: 'update', id: 'guide', patch: { rhinoContext: rail.rhinoContext } },
    ])
    const { design: changed, inverse } = applyOps(design, result.ops)
    expect(changed.nodes.seat).toMatchObject({
      source: { assetId: 'seat', nativeAssetId: 'seat-native', rhinoLayer: 'Existing layer label' },
    })
    expect(changed.nodes.guide).toMatchObject({
      controlPoints: rail.controlPoints,
      knots: rail.knots,
    })
    expect(applyOps(changed, inverse).design).toEqual(design)
  })

  it('skips duplicate legacy IDs even if one matching node already has labels', async () => {
    const design = designFrom('other', [
      body(),
      body('already-labeled', { context }),
      guide(),
      guide('copy'),
    ])
    const result = await recoverRhinoLabels(
      design,
      { objects: [part], curves: [rail] },
      async () => {
        throw Error('Ambiguous meshes do not need to be loaded')
      },
    )
    expect(result.ops).toEqual([])
    expect(result.counts).toMatchObject({ alreadyLabeled: 1, ambiguous: 3, unavailable: 0 })
  })

  it('requires the correct path, exact geometry, and available assets', async () => {
    const design = designFrom('other', [
      body(),
      body('stale', { path: otherPath }),
      body('anonymous', { rawMesh: true }),
      body('missing-path', { path: noFixtureId }),
      guide('modified', curveId, [
        [1, 0, 0, 1],
        [1, 2, 3, 1],
      ]),
    ])
    const result = await recoverRhinoLabels(
      design,
      {
        objects: [part, { ...part, native: { ...part.native!, instancePath: [otherPath] } }],
        curves: [rail],
      },
      async (asset) => {
        if (asset === 'stale') throw Error('Unavailable')
        return new Uint8Array([1, 2, 4])
      },
    )
    expect(result.ops).toEqual([])
    expect(result.counts).toMatchObject({ ambiguous: 0, unavailable: 1, unmatched: 4 })
  })

  it('skips repeated references to the same curve GUID in the original archive', async () => {
    const design = designFrom('other', [guide()])
    const repeated = {
      ...rail,
      controlPoints: [
        [1, 0, 0, 1],
        [2, 2, 3, 1],
      ],
    } satisfies RhinoCurveObject
    const result = await recoverRhinoLabels(
      design,
      { objects: [], curves: [rail, repeated] },
      async () => new Uint8Array(),
    )
    expect(result.ops).toEqual([])
    expect(result.counts.ambiguous).toBe(1)
  })
})
