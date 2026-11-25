/**
 * `production`: real packages from `@pave/production`, built inside a kernel worker (the builder
 * exports CAD through the kernel many times, so it runs where the kernel's cache is), one build
 * at a time by default so packages never take every worker from interactive evaluation.
 */
import type { RenderImage } from '@pave/production'
import type { ProductionPackage } from '@pave/schema'
import { AppError } from '../errors'
import type {
  JobHandle,
  ProductionPackagePatch,
  ProductionRequest,
  ProductionService,
  ServiceContext,
} from '../services'
import { poolOptions } from './geometry'
import type { KernelPool } from './kernel/pool'
import { Limit } from './limit'

/** Finished takes embedded in the spec sheet, starred first, then newest. */
const MAX_RENDERS = 4

const IMAGE_MIMES = new Set<RenderImage['mime']>(['image/png', 'image/jpeg'])

async function finishedRenders(pieceId: string, sctx: ServiceContext): Promise<RenderImage[]> {
  const takes = (await sctx.invoke('renders.list', { pieceId, purpose: 'take', limit: 60 }))
    .filter((r) => r.status === 'done' && !r.stale && r.assetIds.length > 0)
    .sort((a, b) => Number(b.starred) - Number(a.starred))
    .slice(0, MAX_RENDERS)
  const images = await Promise.all(
    takes.map(async (take): Promise<RenderImage | null> => {
      const file = await sctx.readAsset(take.assetIds[0]!).catch(() => null)
      if (!file || !IMAGE_MIMES.has(file.mime as RenderImage['mime'])) return null
      const caption = take.variantLabel ? `${take.title} · ${take.variantLabel}` : take.title
      return { name: file.name, bytes: file.bytes, mime: file.mime as RenderImage['mime'], caption }
    }),
  )
  return images.filter((i) => i !== null)
}

/** Who the package is from, as the title block and RFQ name them. */
async function parties(sctx: ServiceContext) {
  const session = await sctx.invoke('session.get', {})
  const org = session.orgs.find((o) => o.id === session.activeOrgId)
  return {
    author: { name: session.user.name, email: session.user.email },
    org: { name: org?.name ?? 'Pavé' },
  }
}

export function createProduction(pool: KernelPool, options: { concurrency?: number } = {}) {
  const limit = new Limit(options.concurrency ?? 1)
  const builds = new Map<string, { controller: AbortController; done: Promise<void> }>()
  let closing = false

  async function build(
    pkg: ProductionPackage,
    { piece, ...request }: ProductionRequest,
    handle: JobHandle<ProductionPackagePatch>,
    sctx: ServiceContext,
    signal: AbortSignal,
  ): Promise<void> {
    const release = await limit.acquire(signal)
    try {
      // The row records the version it was asked for; a resumed build must not package a later one.
      if (piece.version !== pkg.sourceVersion)
        throw new AppError('conflict', 'The piece changed since this package was queued.')
      await handle.update({ status: 'running', progress: 0.05 })
      const [renders, who] = await Promise.all([finishedRenders(piece.id, sctx), parties(sctx)])
      await handle.update({ progress: 0.15 })
      const built = await pool.run(
        {
          kind: 'package',
          design: piece.design,
          build: {
            piece: { id: piece.id, title: piece.title, kind: piece.kind },
            revision: pkg.revision,
            spec: piece.spec,
            renders,
            options: {
              quantity: request.quantity,
              // Rows queued before the option existed had them; so do they still.
              includeCad: request.cadFiles !== false,
              ...(request.notes === undefined ? {} : { notes: request.notes }),
              ...(request.rates === undefined ? {} : { rates: request.rates }),
              // The row's creation time, so a build resumed after a restart is byte-identical.
              date: pkg.createdAt,
              sourceVersion: pkg.sourceVersion,
              ...who,
            },
          },
        },
        {
          ...poolOptions(sctx, { pieceId: piece.id, signal }),
          onProgress: (value) =>
            handle
              .update({ progress: 0.15 + value * 0.7 })
              .catch((err: unknown) => console.error(`Package ${pkg.id} progress:`, err)),
        },
      )
      const asset = await sctx.putAsset({
        bytes: built.zip,
        name: `${built.root}.zip`,
        mime: 'application/zip',
        kind: 'archive',
      })
      await handle.update({
        status: 'done',
        assetId: asset.id,
        manifest: built.manifest as unknown as Record<string, unknown>,
        progress: 1,
      })
    } finally {
      release()
    }
  }

  const start: ProductionService['submit'] = async (pkg, request, handle, sctx) => {
    const controller = new AbortController()
    const done = build(pkg, request, handle, sctx, controller.signal)
      .catch(async (err: unknown) => {
        // A build cut off by shutdown stays live, so boot recovery builds it again.
        if (closing) return
        console.error(`Production package ${pkg.id} failed:`, err)
        // The row has no error field yet; the manifest carries the reason until it does.
        const message =
          err instanceof AppError ? err.message : 'The package could not be built; try again.'
        await handle.update({ status: 'failed', manifest: { error: { message } } })
      })
      .catch((err: unknown) => console.error(`Recording package ${pkg.id} failed:`, err))
      .finally(() => builds.delete(pkg.id))
    builds.set(pkg.id, { controller, done })
  }

  return {
    submit: start,
    resume: start,
    async dispose() {
      closing = true
      for (const { controller } of builds.values()) controller.abort()
      await Promise.allSettled([...builds.values()].map((b) => b.done))
    },
  } satisfies ProductionService
}
