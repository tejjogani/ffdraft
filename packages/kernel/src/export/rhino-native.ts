import type { Brep, File3dmObjectTable, ObjectAttributes, RhinoModule, Transform } from 'rhino3dm'
import type { Quality, Scene, ScenePart } from '../core'
import { IDENTITY, type Mat4, multiply } from '../geometry/vec'
import { MAX_RHINO_FILE_BYTES } from '../import/rhino'
import { freeRhino } from '../runtime/rhino'
import type { ExportOptions } from '../types'

/** A cut, union or separated shell can have the original node as its only named source. */
function isWholeSource(part: ScenePart, quality: Quality): boolean {
  const source = part.sources[0]
  if (!source || part.sources.length !== 1 || !part.fused) return false

  const original = source.body.solid.manifold(quality)
  const final = part.fused.manifold(quality)
  if (original === final) return true
  const volume = original.volume()
  if (Math.abs(final.volume() - volume) > volume * 1e-6) return false

  // Re-triangulated coplanar faces can differ while their solid is identical. Verify both
  // directions, allowing only the roundoff from tessellation and boolean arithmetic.
  const roundoff = volume * 1e-12
  const removed = original.subtract(final)
  try {
    if (!removed.isEmpty() && Math.abs(removed.volume()) > roundoff) return false
  } finally {
    removed.delete()
  }
  const added = final.subtract(original)
  try {
    return added.isEmpty() || Math.abs(added.volume()) <= roundoff
  } finally {
    added.delete()
  }
}

function rhinoTransform(rhino: RhinoModule, m: Mat4): Transform {
  // The kernel stores matrices column-major, while Rhino's member names are row, column.
  return Object.assign(rhino.Transform.identity(), {
    m00: m[0]!,
    m01: m[4]!,
    m02: m[8]!,
    m03: m[12]!,
    m10: m[1]!,
    m11: m[5]!,
    m12: m[9]!,
    m13: m[13]!,
    m20: m[2]!,
    m21: m[6]!,
    m22: m[10]!,
    m23: m[14]!,
    m30: m[3]!,
    m31: m[7]!,
    m32: m[11]!,
    m33: m[15]!,
  })
}

function readBrep(rhino: RhinoModule, bytes: Uint8Array): Brep | null {
  if (bytes.byteLength > MAX_RHINO_FILE_BYTES) return null
  const archive = rhino.File3dm.fromByteArray(bytes)
  if (!archive) return null
  const settings = archive.settings()
  const objects = archive.objects()
  try {
    if (settings.modelUnitSystem !== rhino.UnitSystem.Millimeters || objects.count !== 1)
      return null
    const object = objects.get(0)
    const geometry = object.geometry()
    try {
      if (!(geometry instanceof rhino.Brep) || !geometry.isSolid || !geometry.isValid) return null
      return geometry.duplicate() as Brep
    } finally {
      freeRhino(geometry)
      freeRhino(object)
    }
  } finally {
    freeRhino(objects)
    freeRhino(settings)
    freeRhino(archive)
  }
}

/** Native solid geometry shared by placements is read once. Each export object owns its placement. */
export function nativeSolidWriter(
  rhino: RhinoModule,
  objects: File3dmObjectTable,
  scene: Scene,
  { assets, signal }: Pick<ExportOptions, 'assets' | 'signal'>,
) {
  const sources = new Map<string, Brep | null>()
  const unavailable: string[] = []
  let retained = 0

  const load = async (assetId: string) => {
    if (sources.has(assetId)) return sources.get(assetId) ?? null
    let source: Brep | null = null
    try {
      if (assets) source = readBrep(rhino, await assets(assetId))
    } catch {
      // Missing or damaged sidecars still have production mesh geometry.
    }
    sources.set(assetId, source)
    signal?.throwIfAborted()
    return source
  }

  return {
    async write(part: ScenePart, attrs: ObjectAttributes): Promise<boolean> {
      const result = scene.nodes.get(part.sources[0]?.nodeId ?? '')
      const node = result?.node
      if (
        !result ||
        node?.kind !== 'meshBody' ||
        node.source.type !== 'asset' ||
        !node.source.nativeAssetId ||
        !(result.data as { nativeMeshUnmodified?: boolean })?.nativeMeshUnmodified ||
        !isWholeSource(part, scene.quality)
      )
        return false
      const source = node.source
      const original = await load(source.nativeAssetId!)
      const useMesh = () => {
        unavailable.push(attrs.name)
        return false
      }
      if (!original) return useMesh()
      const placed = original.duplicate() as Brep
      const matrix = source.nativeTransform
        ? multiply(result.matrix, source.nativeTransform)
        : result.matrix
      const transform = matrix === IDENTITY ? null : rhinoTransform(rhino, matrix)
      try {
        if (transform) {
          const determinant = transform.determinant()
          if (
            !transform.isAffine ||
            determinant === 0 ||
            !Number.isFinite(determinant) ||
            // OpenNURBS can silently distort analytic surfaces under a non-uniform scale.
            (transform.similarityType === rhino.TransformSimilarityType.NotSimilarity &&
              !placed.makeDeformable()) ||
            !placed.transform(transform)
          )
            return useMesh()
          if (determinant < 0) placed.flip()
          if (!placed.isSolid || !placed.isValid) return useMesh()
        }

        if (source.rhinoObjectId) attrs.setUserString('rhinoObjectId', source.rhinoObjectId)
        if (source.rhinoInstancePath?.length)
          attrs.setUserString('rhinoInstancePath', JSON.stringify(source.rhinoInstancePath))

        const count = objects.count
        objects.addBrep(placed, attrs)
        if (objects.count !== count + 1) return useMesh()
        retained++
        return true
      } finally {
        if (transform) freeRhino(transform)
        freeRhino(placed)
      }
    },
    notes(): string[] {
      return [
        `${retained} native Rhino solid${retained === 1 ? '' : 's'} retained. Other bodies export as meshes. STEP carries exact Pavé geometry where available.`,
        ...unavailable.map(
          (name) =>
            `“${name}” uses the evaluated mesh because its native source archive could not be used.`,
        ),
      ]
    },
    dispose() {
      for (const source of sources.values()) if (source) freeRhino(source)
    },
  }
}
