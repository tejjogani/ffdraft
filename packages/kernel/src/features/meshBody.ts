/**
 * A sculpted body from an imported, scanned or AI-generated mesh (or a built-in model), made
 * castable: repaired to a closed manifold, scaled to height, simplified, smoothed, flat-backed
 * and hollowed (docs/research/06-freeform.md §4). The result stands in the XZ plane facing −Y
 * with its back on y = 0, so bails, pavé and chains treat it like any other flat piece.
 */
import type { NodeOf } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { BUILTINS } from '../builtin/index'
import { type BuildContext, defineFeature, metalOf, solidFromManifold } from '../core'
import { flatBack, flatPlacement, scaleToHeight } from '../mesh/fit'
import { parseMesh } from '../mesh/parse/index'
import { repairMesh } from '../mesh/repair'
import { hollowBody } from '../mesh/shell'
import { simplifyToDetail } from '../mesh/simplify'
import { smoothManifold } from '../mesh/smooth'

type MeshBodyNode = NodeOf<'meshBody'>

/** Hollow shells thinner than this risk casting failure (02-production.md: shell ≥ 0.7 mm). */
const MIN_HOLLOW_WALL = 0.7

async function sourceManifold(node: MeshBodyNode, ctx: BuildContext): Promise<Manifold> {
  if (node.source.type === 'builtin') return BUILTINS[node.source.name]()
  if (!ctx.assets) throw new Error('No asset store is connected, so the imported mesh cannot be loaded')
  const bytes = await ctx.assets(node.source.assetId)
  ctx.signal?.throwIfAborted()
  const { mesh, format } = parseMesh(bytes)
  const { manifold, report } = repairMesh(mesh)
  const label = format.toUpperCase()
  const fixes = [
    report.merged > 0 && `welded ${report.merged.toLocaleString('en')} duplicate vertices`,
    report.holes > 0 && `closed ${report.holes} hole${report.holes > 1 ? 's' : ''}`,
    report.flipped > 0 && `fixed the winding of ${report.flipped.toLocaleString('en')} triangles`,
    report.shells > 1 && `fused ${report.shells} overlapping shells`,
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
    ctx.report({ level: 'info', code: 'mesh.repaired', message: `Repaired the ${label} mesh: ${fixes.join(', ')}.` })
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
  // Scale first so every later tolerance is in millimetres.
  m = keep(scaleToHeight(m, node.height))
  m = keep(simplifyToDetail(m, node.detail, node.height))
  if (node.smooth > 0) m = keep(scaleToHeight(keep(smoothManifold(m, node.smooth)), node.height))
  const trimmed = keep(flatBack(m, node.flatBack))
  const offset = flatPlacement(trimmed)
  let body = keep(trimmed.translate(offset))

  if (node.hollow > 0) {
    // The cavity is offset from the body as it was before its back was sliced off, so a
    // flat-backed piece gets an open scoop instead of a sealed void.
    const envelope = trimmed === m ? body : keep(m.translate(offset))
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

  const pieces = body.decompose()
  for (const p of pieces) p.delete()
  if (pieces.length > 1)
    ctx.report({
      level: 'warning',
      code: 'mesh.disconnected',
      message: `The body is in ${pieces.length} separate pieces; join them so it casts as one part.`,
    })
  // The solid owns a handle of its own; `body` stays tracked and is freed with the build.
  return { bodies: [{ solid: solidFromManifold(body.translate([0, 0, 0])), ...metalOf(node) }] }
})
