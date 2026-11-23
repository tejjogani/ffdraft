/**
 * Engines the server delegates to — CAD kernel, image search and generation, render farm,
 * on-model imaging, production packaging. Each is an interface over @pave/schema types with a
 * default that refuses with a typed {@link NotConfiguredError} (HTTP 501), so handlers are
 * written once and deployments register real implementations:
 *
 *   createApp({ services: { geometry: myKernel } })   // or later:
 *   server.runtime.services.register('geometry', myKernel)
 */
import type {
  Actor,
  Asset,
  BrandModel,
  Capabilities,
  CommandParsedInput,
  Design,
  EvaluationSummary,
  ModelShot,
  Piece,
  ProductionPackage,
  Reference,
  RenderJob,
  SearchResult,
} from '@pave/schema'
import { NotConfiguredError } from './errors'
import type { NewAsset } from './assets/assets'
import type { NewUsage } from './usage'

/** A file produced or consumed by a service. */
export interface FileData {
  bytes: Uint8Array
  name: string
  mime: string
}

/**
 * What a service may do on behalf of the caller: meter what it spends and store what it makes,
 * both attributed to the caller's org, user and (for the assistant) run.
 */
export interface ServiceContext {
  readonly orgId: string
  readonly userId: string
  readonly actor: Actor
  recordUsage(event: NewUsage): Promise<void>
  putAsset(file: NewAsset): Promise<Asset>
  /** Reads an asset of the caller's org; rejects with 404 for anything else. */
  readAsset(id: string): Promise<FileData>
}

/** Lets a long-running job report back. Each update is persisted and published as `job.updated`. */
export interface JobHandle<Patch> {
  readonly id: string
  update(patch: Patch): Promise<void>
}

interface Service {
  /** What this implementation adds to `session.get` → `capabilities`. */
  readonly capabilities?: Partial<Capabilities>
}

export type ExportFormat = CommandParsedInput<'design.export'>['format']
export type PortraitView = BrandModel['portraits'][number]['view']

export interface GeometryService extends Service {
  /** Facts of a design: masses, stones, bounds and manufacturability diagnostics. */
  evaluate(design: Design, opts: { detail: 'draft' | 'production' }, sctx: ServiceContext): Promise<EvaluationSummary>
  export(
    design: Design,
    opts: { format: ExportFormat; stones: boolean },
    sctx: ServiceContext,
  ): Promise<{ file: FileData; notes: string[] }>
}

export interface SearchService extends Service {
  search(
    query: CommandParsedInput<'references.search'>,
    sctx: ServiceContext,
  ): Promise<{ results: SearchResult[]; providers: string[] }>
}

export interface ImageGenService extends Service {
  /**
   * `references` are already filtered to items whose rights allow generative use; read their
   * pixels with `sctx.readAsset(reference.assetId)`.
   */
  generate(
    request: Omit<CommandParsedInput<'references.generate'>, 'boardId' | 'referenceIds'> & {
      references: Reference[]
    },
    sctx: ServiceContext,
  ): Promise<{ model: string; images: FileData[] }>
}

export type RenderJobPatch = Partial<Pick<RenderJob, 'status' | 'progress' | 'assetIds' | 'error'>>

export interface RenderQueue extends Service {
  /** Accept a queued job and return promptly; report progress through `handle`. */
  submit(job: RenderJob, piece: Piece, handle: JobHandle<RenderJobPatch>, sctx: ServiceContext): Promise<void>
  cancel(jobId: string, sctx: ServiceContext): Promise<void>
}

export type ModelShotPatch = Partial<Pick<ModelShot, 'status' | 'assetId' | 'fidelity' | 'check'>>

export interface OnModelService extends Service {
  portraits(
    model: BrandModel,
    views: PortraitView[],
    sctx: ServiceContext,
  ): Promise<{ view: PortraitView; file: FileData }[]>
  /** Accept a queued shot and return promptly; report progress through `handle`. */
  submitShot(
    shot: ModelShot,
    subject: { model: BrandModel; piece: Piece },
    handle: JobHandle<ModelShotPatch>,
    sctx: ServiceContext,
  ): Promise<void>
}

export type ProductionPackagePatch = Partial<Pick<ProductionPackage, 'status' | 'assetId' | 'manifest'>>

export interface ProductionService extends Service {
  /** Accept a queued package build and return promptly; report progress through `handle`. */
  submit(
    pkg: ProductionPackage,
    request: { piece: Piece } & Omit<CommandParsedInput<'production.create'>, 'pieceId'>,
    handle: JobHandle<ProductionPackagePatch>,
    sctx: ServiceContext,
  ): Promise<void>
}

export interface Services {
  geometry: GeometryService
  search: SearchService
  imageGen: ImageGenService
  renderQueue: RenderQueue
  onModel: OnModelService
  production: ProductionService
}
export type ServiceName = keyof Services

const missing = (service: ServiceName, message: string) => () =>
  Promise.reject(new NotConfiguredError(service, message))

const DEFAULTS: Services = {
  geometry: {
    evaluate: missing('geometry', 'No geometry kernel is configured, so CAD cannot be evaluated.'),
    export: missing('geometry', 'No geometry kernel is configured, so CAD cannot be exported.'),
  },
  search: {
    search: missing('search', 'No image search providers are configured.'),
  },
  imageGen: {
    generate: missing('imageGen', 'No image generation provider is configured.'),
  },
  renderQueue: {
    submit: missing('renderQueue', 'No render queue is configured.'),
    cancel: missing('renderQueue', 'No render queue is configured.'),
  },
  onModel: {
    portraits: missing('onModel', 'No on-model imaging provider is configured, so portraits cannot be generated.'),
    submitShot: missing('onModel', 'No on-model imaging provider is configured, so shots cannot be created.'),
  },
  production: {
    submit: missing('production', 'No production packager is configured.'),
  },
}

const NO_CAPABILITIES: Capabilities = {
  assistant: false,
  imageSearch: [],
  imageGeneration: [],
  mesh3d: [],
  blender: false,
  sourcing: [],
}

/** The engines available to handlers, resolved per call so registration can happen at any time. */
export class ServiceRegistry {
  readonly #impls: Services = { ...DEFAULTS }
  readonly #registered = new Set<ServiceName>()

  constructor(initial: Partial<Services> = {}) {
    for (const [name, impl] of Object.entries(initial) as [ServiceName, Services[ServiceName]][])
      this.register(name, impl)
  }

  register<K extends ServiceName>(name: K, impl: Services[K]): void {
    this.#impls[name] = impl
    this.#registered.add(name)
  }

  get<K extends ServiceName>(name: K): Services[K] {
    return this.#impls[name]
  }

  isConfigured(name: ServiceName): boolean {
    return this.#registered.has(name)
  }

  /** Like {@link get}, but refuses up front — for handlers that persist rows before delegating. */
  require<K extends ServiceName>(name: K, message: string): Services[K] {
    if (!this.isConfigured(name)) throw new NotConfiguredError(name, message)
    return this.#impls[name]
  }

  capabilities(): Capabilities {
    const out: Capabilities = { ...NO_CAPABILITIES }
    for (const name of this.#registered) Object.assign(out, this.#impls[name].capabilities)
    return out
  }
}
