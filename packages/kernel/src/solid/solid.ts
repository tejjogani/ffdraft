/**
 * The one `Solid` implementation behind the contract in ../core.ts.
 *
 * A solid can hold up to three things, each created on first use and cached:
 *  - an exact B-rep (an OpenCascade shape, built by a recipe or handed in),
 *  - welded triangles per tessellation quality (from a recipe's analytic mesher, or BRepMesh),
 *  - a Manifold for robust booleans (from those triangles, or handed in for mesh-only bodies).
 * Interactive evaluation therefore never pays for a B-rep it does not need, while STEP export
 * and exact booleans can still ask for one.
 */
import type { Manifold } from 'manifold-3d'
import type { Shape3D } from 'replicad'
import type { Solid, SolidRecipe, SurfaceMesh } from '../core'
import { type Mat4, uniformScaleOf } from '../geometry/vec'
import { isRuntimeFault, runtime } from '../runtime/index'
import type { Bounds } from '../types'
import {
  boundsOfPositions,
  featureEdges,
  type IndexedTriangles,
  meshArea,
  meshVolume,
  surfaceDefects,
  type Tessellation,
  tessellationOf,
  transformTessellation,
  transformTriangles,
  weld,
} from './meshing'
import {
  occtError,
  type Quality,
  shapeArea,
  shapeBounds,
  shapeVolume,
  tessellateShape,
  transformShape,
} from './occt'

/** Tessellation presets per detail level (chord per docs/research/01-cad.md §5: ≤ 0.005–0.01 mm). */
export const QUALITY = {
  draft: { chord: 0.02, angle: 0.35 },
  production: { chord: 0.005, angle: 0.3 },
} as const satisfies Record<string, Quality>

/**
 * The chord tolerance never asks for more than one part in 10 000 of the body's size: a 0.005 mm
 * chord is right for a ring but would mesh a 200 mm sculpture (or a mistyped 1 km sphere) into
 * tens of millions of triangles. Bodies under 50 mm across are unaffected.
 */
const RELATIVE_CHORD = 1e-4
function relativeQuality(quality: Quality, box: Bounds): Quality {
  const size = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2])
  const chord = Math.max(quality.chord, size * RELATIVE_CHORD)
  return chord === quality.chord ? quality : { ...quality, chord }
}

interface Level {
  surface?: SurfaceMesh
  manifold?: Manifold
  tessellation?: Tessellation
}

/** Mesh-only solids have a single tessellation regardless of the requested quality. */
const ANY = '*'
const levelKey = (q: Quality): string => `${q.chord}/${q.angle}`

// ── Build scopes ─────────────────────────────────────────────────────────────────────────────

let scope: Set<SolidImpl> | null = null

/**
 * Runs `fn` and disposes every solid created inside it that `keep` does not return — which is
 * all of them if `fn` throws. This is what frees a feature's intermediate solids (and all of a
 * failed feature's solids) without the feature having to track anything.
 */
export async function withSolidScope<T>(
  fn: () => T | Promise<T>,
  keep: (value: T) => Iterable<Solid>,
): Promise<T> {
  if (scope) throw new Error('Solid scopes do not nest; evaluations run one node at a time')
  const created = new Set<SolidImpl>()
  scope = created
  try {
    const value = await fn()
    const kept = new Set(keep(value))
    for (const solid of kept)
      if (!created.has(solid as SolidImpl))
        throw new Error('A feature returned a solid it does not own; return a transformed copy')
    scope = null
    for (const solid of created) if (!kept.has(solid)) solid.dispose()
    return value
  } catch (error) {
    scope = null
    // After a fault the heap is corrupt: freeing would touch it again and could replace the
    // fault with a misleading error. The solids are forgotten with the runtime instead.
    if (!isRuntimeFault(error)) for (const solid of created) solid.dispose()
    throw error
  }
}

// ── Manifold conversion ──────────────────────────────────────────────────────────────────────

export function manifoldFromTriangles(tris: IndexedTriangles): Manifold {
  const { manifold: mf } = runtime()
  const mesh = new mf.Mesh({ numProp: 3, vertProperties: tris.positions, triVerts: tris.indices })
  let result: Manifold
  try {
    result = new mf.Manifold(mesh)
  } catch (error) {
    throw occtError(error, 'Surface is not a closed manifold')
  }
  const status = result.status()
  if (status !== 'NoError') {
    result.delete()
    throw new Error(`Surface is not a closed manifold (${status})`)
  }
  return result
}

export function trianglesFromManifold(m: Manifold): IndexedTriangles {
  const mesh = m.getMesh()
  if (mesh.numProp === 3) return { positions: mesh.vertProperties, indices: mesh.triVerts }
  const count = mesh.vertProperties.length / mesh.numProp
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++)
    positions.set(mesh.vertProperties.subarray(i * mesh.numProp, i * mesh.numProp + 3), i * 3)
  return { positions, indices: mesh.triVerts }
}

// ── Solid ────────────────────────────────────────────────────────────────────────────────────

interface Inherited {
  from: SolidImpl
  matrix: Mat4
}

class SolidImpl implements Solid {
  private readonly levels = new Map<string, Level>()
  private volumeMm3: number | undefined
  private areaMm2: number | undefined
  private box: Bounds | undefined
  private disposed = false

  constructor(
    private shape: Shape3D | null,
    private native: Manifold | null,
    private readonly recipe: SolidRecipe | null,
    /** Set on moved copies: tessellations are derived from the source's cached arrays. */
    private readonly inherited: Inherited | null = null,
  ) {
    scope?.add(this)
  }

  get exact(): boolean {
    return this.shape !== null || this.recipe?.brep !== undefined
  }

  /** Backed by a Manifold, which cannot hold an open or non-manifold surface. */
  get closedByConstruction(): boolean {
    return this.native !== null
  }

  /** The recipe's own count of surface defects, when it has one. */
  recipeDefects(quality: Quality): { open: number; nonManifold: number } | undefined {
    this.assertAlive()
    return this.recipe?.defects?.(quality)
  }

  brep(): Shape3D | null {
    this.assertAlive()
    if (!this.shape && this.recipe?.brep) {
      try {
        this.shape = this.recipe.brep()
      } catch (error) {
        throw occtError(error, 'Building the exact B-rep')
      }
    }
    return this.shape
  }

  manifold(quality: Quality = QUALITY.production): Manifold {
    this.assertAlive()
    if (this.native) return this.native
    const level = this.level(quality)
    level.manifold ??= manifoldFromTriangles(this.triangles(quality))
    return level.manifold
  }

  triangles(quality: Quality = QUALITY.production): IndexedTriangles {
    this.assertAlive()
    return this.surface(this.level(quality), quality)
  }

  tessellate(quality: Quality = QUALITY.production): Tessellation {
    this.assertAlive()
    const level = this.level(quality)
    if (!level.tessellation) {
      const source = this.inherited?.from.levels.get(this.keyFor(quality))?.tessellation
      if (source) level.tessellation = transformTessellation(this.inherited!.matrix, source)
      else {
        const surface = this.surface(level, quality)
        level.tessellation ??= surface.display ?? tessellationOf(surface)
      }
    }
    return level.tessellation
  }

  volume(): number {
    this.assertAlive()
    this.volumeMm3 ??=
      this.recipe?.volume?.() ??
      (this.native
        ? this.native.volume()
        : this.exact
          ? shapeVolume(this.brep()!)
          : meshVolume(this.triangles()))
    return this.volumeMm3
  }

  area(): number {
    this.assertAlive()
    this.areaMm2 ??= this.recipe?.area
      ? this.recipe.area()
      : this.native
        ? this.native.surfaceArea()
        : this.shape
          ? shapeArea(this.shape)
          : meshArea(this.triangles())
    return this.areaMm2
  }

  bounds(): Bounds {
    this.assertAlive()
    if (!this.box) {
      if (this.native) {
        const b = this.native.boundingBox()
        this.box = { min: [...b.min], max: [...b.max] }
      } else if (this.shape) this.box = shapeBounds(this.shape)
      else this.box = boundsOfPositions(this.triangles(QUALITY.draft).positions)
    }
    return this.box
  }

  transformed(matrix: Mat4): Solid {
    this.assertAlive()
    const scale = uniformScaleOf(matrix)
    const recipe = this.recipe
    const moved = new SolidImpl(
      // A handed-in shape is moved eagerly (cheap: rigid moves share the underlying geometry);
      // a recipe's shape is rebuilt on demand so the copy never depends on this solid's heap.
      this.shape && !recipe?.brep ? transformShape(this.shape, matrix) : null,
      this.native
        ? this.native.transform(matrix as number[] as Parameters<Manifold['transform']>[0])
        : null,
      recipe && {
        ...(recipe.brep && {
          brep: () => {
            if (!this.disposed && this.shape) return transformShape(this.shape, matrix)
            const base = recipe.brep!()
            try {
              return transformShape(base, matrix)
            } finally {
              base.delete()
            }
          },
        }),
        ...(recipe.mesh && {
          mesh: (q: Quality) => {
            const base = this.levels.get(levelKey(q))?.surface ?? recipe.mesh!(q)
            return transformTriangles(matrix, base)
          },
        }),
        ...(recipe.volume && { volume: () => recipe.volume!() * scale ** 3 }),
        ...(recipe.area && { area: () => recipe.area!() * scale ** 2 }),
        // A similarity moves edges, never joins or splits them.
        ...(recipe.defects && { defects: recipe.defects }),
      },
      { from: this, matrix },
    )
    // Always from this solid's volume, never sometimes from the moved geometry: the two differ
    // in the last bits, and which one a copy got depended on whether the source had been
    // measured yet, so the same design gave different volumes after different edit histories.
    moved.volumeMm3 = this.volume() * scale ** 3
    return moved
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.shape?.delete()
    this.shape = null
    this.native?.delete()
    this.native = null
    // The typed arrays stay: moved copies derive their tessellations from them.
    for (const level of this.levels.values()) {
      level.manifold?.delete()
      level.manifold = undefined
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Solid used after it was disposed')
  }

  private keyFor(quality: Quality): string {
    return this.native ? ANY : levelKey(quality)
  }

  private level(quality: Quality): Level {
    const key = this.keyFor(quality)
    let level = this.levels.get(key)
    if (!level) {
      level = {}
      this.levels.set(key, level)
    }
    return level
  }

  private surface(level: Level, quality: Quality): SurfaceMesh {
    this.assertAlive()
    if (level.surface) return level.surface
    const source = this.inherited?.from.levels.get(this.keyFor(quality))?.surface
    if (source) level.surface = transformTriangles(this.inherited!.matrix, source)
    else if (this.native) level.surface = trianglesFromManifold(this.native)
    else if (this.recipe?.mesh) level.surface = this.recipe.mesh(quality)
    else {
      const shape = this.brep()
      if (!shape) throw new Error('Solid has neither a B-rep nor a mesh')
      const mesh = tessellateShape(shape, relativeQuality(quality, this.bounds()))
      const welded = weld(mesh.positions, mesh.indices)
      level.surface = welded
      // Keep the kernel's surface normals for display; creases come from the welded mesh.
      level.tessellation = { mesh, edges: featureEdges(welded) }
    }
    return level.surface
  }
}

/** Open and non-manifold edges of the solid's mesh at `quality` (see `SolidRecipe.defects`). */
export const surfaceDefectsOf = (
  solid: Solid,
  quality: Quality,
): { open: number; nonManifold: number } =>
  (solid instanceof SolidImpl && solid.recipeDefects(quality)) ||
  surfaceDefects(solid.triangles(quality))

/** True for solids that are a Manifold already, so checking their surface would be wasted work. */
export const isClosedByConstruction = (solid: Solid): boolean =>
  solid instanceof SolidImpl && solid.closedByConstruction

/** Wraps an exact B-rep. The solid owns the shape from here on. */
export const solidFromBrep = (shape: Shape3D): Solid => new SolidImpl(shape, null, null)

/** Wraps a Manifold mesh body. The solid owns the Manifold from here on. */
export const solidFromManifold = (manifold: Manifold): Solid => {
  if (manifold.isEmpty()) {
    manifold.delete()
    throw new Error('Mesh body is empty')
  }
  return new SolidImpl(null, manifold, null)
}

/** A solid whose representations are produced on demand by pure-JS recipes. */
export function lazySolid(recipe: SolidRecipe): Solid {
  if (!recipe.brep && !recipe.mesh) throw new Error('A solid recipe needs a brep or a mesh')
  return new SolidImpl(null, null, recipe)
}
