/**
 * Connected pieces of a body. Booleans, edge collapses and level sets leave debris behind —
 * zero-volume sliver shells, sealed specks of a cavity — that is not part of the design but
 * would be reported as loose pieces and break later tolerance-based steps.
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'

/** Volumes of the connected shells (a sealed void inside a body counts negative). */
export function pieceVolumes(m: Manifold): number[] {
  const pieces = m.decompose()
  const volumes = pieces.map((p) => p.volume())
  for (const p of pieces) p.delete()
  return volumes
}

/**
 * Shells smaller than this (mm³, either sign) are boolean debris: a few triangles enclosing
 * nothing, left where a cut grazes a surface. No casting has a part that small.
 */
export const SPECK_VOLUME = 1e-3

/** Pieces that are solid parts: positive volume above `minVolume` (mm³), specks never. */
export const solidPieceCount = (m: Manifold, minVolume = SPECK_VOLUME): number =>
  pieceVolumes(m).filter((v) => v > minVolume).length

/** `m` without its speck shells (see SPECK_VOLUME). Consumes `m`; returns it when it has none. */
export const dropSpecks = (m: Manifold): Manifold =>
  keepPieces(m, (volume) => Math.abs(volume) >= SPECK_VOLUME)

/**
 * The pieces for which `keep(volume, largest, piece)` holds, composed into one body. Consumes `m`;
 * returns `m` itself when every piece is kept.
 */
export function keepPieces(
  m: Manifold,
  keep: (volume: number, largest: number, piece: Manifold) => boolean,
): Manifold {
  const pieces = m.decompose()
  try {
    const volumes = pieces.map((p) => p.volume())
    const largest = Math.max(0, ...volumes)
    const kept = pieces.filter((piece, i) => keep(volumes[i]!, largest, piece))
    if (kept.length === pieces.length) return m
    m.delete()
    return runtime().manifold.Manifold.compose(kept)
  } finally {
    for (const p of pieces) p.delete()
  }
}
