/**
 * `geometry`: `@pave/kernel` behind the kernel pool. Local compute, so nothing is metered; assets
 * a design references are read through the caller's org-scoped store, never across tenants.
 */
import type { GeometryCall, GeometryService, ServiceContext } from '../services'
import type { KernelPool, RunOptions } from './kernel/pool'

/** How the pool should run a call for `sctx`: in its org, near the piece's earlier work. */
export function poolOptions(sctx: ServiceContext, call: GeometryCall = {}): RunOptions {
  return {
    tenant: sctx.orgId,
    ...(call.pieceId === undefined ? {} : { affinity: `${sctx.orgId}:${call.pieceId}` }),
    ...(call.signal === undefined ? {} : { signal: call.signal }),
    ...(call.background ? { background: true } : {}),
    readAsset: async (assetId) => (await sctx.readAsset(assetId)).bytes,
  }
}

export function createGeometry(pool: KernelPool): GeometryService {
  return {
    evaluate: (design, { detail, ...call }, sctx) =>
      pool.run({ kind: 'evaluate', design, detail }, poolOptions(sctx, call)),

    async export(design, { format, stones, ...call }, sctx) {
      const result = await pool.run(
        { kind: 'export', design, format, stones },
        poolOptions(sctx, call),
      )
      return {
        file: { bytes: result.bytes, name: `piece.${result.extension}`, mime: result.mime },
        notes: result.notes,
      }
    },

    async renderInput(design, sctx, call) {
      const { glb, subject } = await pool.run(
        { kind: 'renderInput', design },
        poolOptions(sctx, call),
      )
      return { glb: { bytes: glb, name: 'piece.glb', mime: 'model/gltf-binary' }, subject }
    },

    subject: (design, sctx, call) => pool.run({ kind: 'subject', design }, poolOptions(sctx, call)),

    picture: (design, { views, size, focus, shots, metal, ...call }, sctx) =>
      pool.run(
        {
          kind: 'picture',
          design,
          views,
          size,
          focus,
          ...(shots ? { shots } : {}),
          ...(metal ? { metal } : {}),
        },
        poolOptions(sctx, call),
      ),

    fitPhoto: (design, { fit, ...call }, sctx) =>
      pool.run({ kind: 'photoFit', design, fit }, poolOptions(sctx, call)),

    dispose: () => pool.dispose(),
  }
}
