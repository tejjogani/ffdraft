import type {
  Brep,
  File3dm,
  File3dmInstanceDefinitionTable,
  File3dmObjectTable,
  InstanceReference,
  ObjectAttributes,
  RhinoModule,
  Transform,
} from 'rhino3dm'
import type { Scene, ScenePart } from '../core'
import { IDENTITY, type Mat4, multiply } from '../geometry/vec'
import { MAX_RHINO_FILE_BYTES } from '../import/rhino'
import { freeRhino } from '../runtime/rhino'
import type { ExportOptions } from '../types'

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
  doc: File3dm,
  objects: File3dmObjectTable,
  scene: Scene,
  { assets, signal }: Pick<ExportOptions, 'assets' | 'signal'>,
) {
  const sources = new Map<string, Brep | null>()
  let definitions: File3dmInstanceDefinitionTable | undefined
  const definitionIds = new Map<string, string>()
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

  const addAffineInstance = (
    assetId: string,
    original: Brep,
    transform: Transform,
    attrs: ObjectAttributes,
  ): boolean => {
    // Some analytic Rhino surfaces cannot be baked through shear or nonuniform scale.
    // A new single-leaf block keeps the original exact surface and applies the affine
    // placement without bringing its siblings or any original definition into the file.
    const key = `${assetId}:${attrs.layerIndex}`
    let id = definitionIds.get(key)
    if (!id) {
      definitions ??= doc.instanceDefinitions()
      const leaf = new rhino.ObjectAttributes()
      leaf.name = 'Solid'
      leaf.layerIndex = attrs.layerIndex
      const index = definitions.add(
        `Pavé Rhino solid ${definitionIds.size + 1}`,
        '',
        '',
        '',
        [0, 0, 0],
        [original],
        [leaf],
      )
      freeRhino(leaf)
      if (index < 0) return false
      const definition = definitions.get(index)
      id = definition.id
      freeRhino(definition)
      definitionIds.set(key, id)
    }
    // The binding's (definition id, transform) constructor is missing from its .d.ts.
    const Ref = rhino.InstanceReference as unknown as new (
      id: string,
      transform: Transform,
    ) => InstanceReference
    const instance = new Ref(id, transform)
    const count = objects.count
    try {
      objects.addInstanceObject(instance, attrs)
      return objects.count === count + 1
    } finally {
      freeRhino(instance)
    }
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
        !part.preservesNativeSurface
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
          if (!transform.isAffine || determinant === 0 || !Number.isFinite(determinant))
            return useMesh()
          if (
            transform.similarityType === rhino.TransformSimilarityType.NotSimilarity &&
            !placed.makeDeformable()
          ) {
            if (!addAffineInstance(source.nativeAssetId!, original, transform, attrs))
              return useMesh()
            retained++
            return true
          }
          if (!placed.transform(transform)) return useMesh()
          if (determinant < 0) placed.flip()
          if (!placed.isSolid || !placed.isValid) return useMesh()
        }

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
    get count() {
      return retained
    },
    notes(): string[] {
      return unavailable.map(
        (name) =>
          `“${name}” uses the evaluated mesh because its native source archive could not be used.`,
      )
    },
    dispose() {
      if (definitions) freeRhino(definitions)
      for (const source of sources.values()) if (source) freeRhino(source)
    },
  }
}
