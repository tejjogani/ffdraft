/**
 * A sculpted body from an imported, scanned or AI-generated mesh (or a built-in model), made
 * castable: repaired to a closed manifold, scaled to height, simplified, smoothed, flat-backed
 * and hollowed (docs/research/06-freeform.md §4). By default it stands in the XZ plane facing −Y
 * with its back on y = 0. Measured imports keep the asset's millimetre scale and placement.
 */
import type { NodeOf } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { BUILTINS } from '../builtin/index'
import { type BuildContext, defineFeature, metalOf, solidFromManifold } from '../core'
import { applyMeshVertexEdits } from '../mesh/edit'
import { flatBack, flatPlacement, scaleToHeight } from '../mesh/fit'
import { parseMesh } from '../mesh/parse/index'
import type { HiddenSurfaces } from '../mesh/pave/region'
import { solidPieceCount } from '../mesh/pieces'
import { repairMesh } from '../mesh/repair'
import { hollowBody } from '../mesh/shell'
import { simplifyToDetail } from '../mesh/simplify'
import { smoothManifold } from '../mesh/smooth'

type MeshBodyNode = NodeOf<'meshBody'>

/** Hollow shells thinner than this risk casting failure (02-production.md: shell ≥ 0.7 mm). */
const MIN_HOLLOW_WALL = 0.7
/** Smoothing works on a mesh this even, relative to the height (~0.27 mm on a 40 mm piece). */
const SMOOTH_EDGE = 1 / 150

async function sourceManifold(node: MeshBodyNode, ctx: BuildContext): Promise<Manifold> {
  if (node.source.type === 'builtin') return BUILTINS[node.source.name]()
  if (!ctx.assets)
    throw new Error('No asset store is connected, so the imported mesh cannot be loaded')
  const bytes = await ctx.assets(node.source.assetId)
  ctx.signal?.throwIfAborted()
  const { mesh, format } = parseMesh(bytes)
  const edits = node.meshEdits?.vertices
  const edited = edits && Object.keys(edits).length ? applyMeshVertexEdits(mesh, edits) : mesh
  const { manifold, report } = repairMesh(edited)
  const label = format.toUpperCase()
  const fixes = [
    report.merged > 0 && `welded ${report.merged.toLocaleString('en')} duplicate vertices`,
    report.holes > 0 && `closed ${report.holes} hole${report.holes > 1 ? 's' : ''}`,
    report.flipped > 0 && `fixed the winding of ${report.flipped.toLocaleString('en')} triangles`,
    report.shells > 1 && `fused ${report.shells} overlapping shells`,
    report.voids > 0 &&
      `filled ${report.voids === 1 ? 'a sealed inner void' : `${report.voids} sealed inner voids`} (a closed cavity cannot be cast; use Hollow for one with escape holes)`,
    report.fragments > 0 &&
      `removed ${report.fragments} loose fragment${report.fragments > 1 ? 's' : ''}`,
    report.specks > 0 &&
      `removed ${report.specks} loose speck${report.specks > 1 ? 's' : ''} floating clear of the model`,
  ].filter(Boolean)
  if (report.resurfaced)
    ctx.report({
      level: 'info',
      code: 'mesh.resurfaced',
      message:
        `The ${label} mesh was not a clean closed surface, so it was rebuilt from a distance ` +
        'field. Very fine detail may be softened; re-export a watertight mesh to keep it.',
    })
  else if (fixes.length > 0)
    ctx.report({
      level: 'info',
      code: 'mesh.repaired',
      message: `Repaired the ${label} mesh: ${fixes.join(', ')}.`,
    })
  return manifold
}

export const meshBody = defineFeature('meshBody', async (node, ctx) => {
  // Steps may return their input unchanged; every distinct handle is freed when the build ends.
  const tracked = new Set<Manifold>()
  const keep = (m: Manifold): Manifold => {
    if (!tracked.has(m)) tracked.add(ctx.track(m))
    return m
  }
  let m = keep(await sourceManifold(node, ctx))
  // Measured meshes are already in mm. Fit the others before applying millimetre tolerances.
  const sourceBounds = m.boundingBox()
  const height = node.keepSourcePlacement ? sourceBounds.max[2] - sourceBounds.min[2] : node.height
  if (!node.keepSourcePlacement) m = keep(scaleToHeight(m, height))
  m = keep(simplifyToDetail(m, node.detail, height))
  if (node.smooth > 0) {
    m = keep(smoothManifold(m, node.smooth, height * SMOOTH_EDGE))
    if (!node.keepSourcePlacement) m = keep(scaleToHeight(m, height))
  }
  const trimmed = keep(flatBack(m, node.flatBack))
  const offset = node.keepSourcePlacement ? undefined : flatPlacement(trimmed)
  let body = offset ? keep(trimmed.translate(offset)) : trimmed
  // Faces pavé must leave alone: the flat back and any cavity.
  const hidden: HiddenSurfaces = {
    within: 0,
    ...(trimmed !== m && { back: offset ? 0 : trimmed.boundingBox().max[1] }),
  }

  if (node.hollow > 0) {
    // The cavity is offset from the body as it was before its back was sliced off, so a
    // flat-backed piece gets an open scoop instead of a sealed void.
    const envelope = trimmed === m ? body : offset ? keep(m.translate(offset)) : m
    const hollowed = hollowBody(body, envelope, node.hollow)
    if (!hollowed)
      ctx.report({
        level: 'warning',
        code: 'mesh.hollowFailed',
        message: `The body is too thin to hollow with ${node.hollow} mm walls, so it was left solid.`,
        value: node.hollow,
      })
    else {
      body = keep(hollowed.manifold)
      // Cavity faces lie on the cut surface; the outside is at least a wall away from it.
      hidden.cavity = hollowed.cavity
      hidden.within = node.hollow / 2
      if (hollowed.drains > 0)
        ctx.report({
          level: 'info',
          code: 'mesh.drains',
          message: `Hollowed with ${hollowed.drains} Ø2 mm escape hole${hollowed.drains > 1 ? 's' : ''} through the back for casting.`,
        })
    }
    if (node.hollow < MIN_HOLLOW_WALL)
      ctx.report({
        level: 'warning',
        code: 'wall.thin',
        message: `Hollow walls of ${node.hollow} mm are below the ${MIN_HOLLOW_WALL} mm most casters require.`,
        value: node.hollow,
        limit: MIN_HOLLOW_WALL,
      })
  }

  // A closed sheet thinner than any casting can hold passes every topology check.
  const box = body.boundingBox()
  const thinnest = Math.min(...[0, 1, 2].map((k) => box.max[k]! - box.min[k]!))
  if (thinnest < MIN_HOLLOW_WALL)
    ctx.report({
      level: 'warning',
      code: 'wall.thin',
      message: `The body is only ${thinnest < 0.01 ? thinnest.toExponential(1) : thinnest.toFixed(2)} mm thick; casting needs at least ${MIN_HOLLOW_WALL} mm of metal.`,
      value: thinnest,
      limit: MIN_HOLLOW_WALL,
    })
  // Sealed voids are shells too (of negative volume); only solid pieces cast apart.
  const pieces = solidPieceCount(body)
  if (pieces > 1)
    ctx.report({
      level: 'warning',
      code: 'mesh.disconnected',
      message: `The body is in ${pieces} separate pieces; join them so it casts as one part.`,
    })
  // The solid owns a handle of its own; `body` stays tracked and is freed with the build.
  return {
    bodies: [{ solid: solidFromManifold(body.translate([0, 0, 0])), ...metalOf(node) }],
    data: { hidden },
  }
})
