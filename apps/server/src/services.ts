/**
 * Engines the server delegates to — CAD kernel, image search and generation, render farm,
 * on-model imaging, production packaging, the assistant, freeform analysis and image-to-3D.
 * Each is an interface over @pave/schema types with a default that refuses with a typed
 * {@link NotConfiguredError} (HTTP 501), so handlers are written once and deployments register
 * real implementations:
 *
 *   createApp({ services: { geometry: myKernel } })   // or later:
 *   server.runtime.services.register('geometry', myKernel)
 *
 * What a registered implementation can do shows in `session.get` → `capabilities`. Deployments
 * build their services (and extra routes) in `src/compose.ts`.
 *
 * Shared engines, decided once so two teams do not build them twice:
 *  - Image generation: ONE provider family (Gemini image, BFL, fake; research 04's
 *    `ImageGenProvider` shape) lives in `packages/ideation`, owned by the ideate workstream.
 *    `imageGen` and `onModel` are both built on it; there is no second client in the server.
 *  - Vision: the render workstream's vision provider is registered as `vision` and implements
 *    {@link VisionService.describe} for freeform. The on-model fidelity judge and the screening
 *    of card and direction text for real names are internal to `onModel`, not part of `vision`.
 *  - Attestation: the server refuses export, image-to-3D and production of a piece that needs
 *    one; a client-side export must check `originNeedsAttestation(piece.origin)` itself first.
 *  - Restart recovery: `Runtime.recover()` runs once at boot and hands every unfinished job and
 *    run to its service's `resume` (render, image-to-3D, on-model, assistant). A job whose
 *    service cannot resume it is failed as interrupted; browser renders are left to their window.
 */
import type {
  Actor,
  Asset,
  BrandModel,
  Capabilities,
  CommandOutput,
  CommandParsedInput,
  Design,
  Estimate,
  EvaluationSummary,
  FinishId,
  GemMaterialId,
  JobKind,
  JobStatus,
  MeshJob,
  MetalId,
  ModelShot,
  OriginFlag,
  Piece,
  PlatingId,
  ProductionPackage,
  Reference,
  RenderEngineStatus,
  RenderJob,
  Run,
  SearchResult,
  Thread,
} from '@pave/schema'
import type { NewAsset } from './assets/assets'
import type { Invoke } from './context'
import { NotConfiguredError } from './errors'
import type { NewUsage } from './usage'

/** A file produced or consumed by a service. */
export interface FileData {
  bytes: Uint8Array
  name: string
  mime: string
}

export type TerminalStatus = Extract<JobStatus, 'done' | 'failed' | 'canceled'>

/**
 * What a service may do on behalf of the caller: meter what it spends, store what it makes and
 * run further commands, all attributed to the caller's org, user and (for the assistant) run.
 */
export interface ServiceContext {
  readonly orgId: string
  readonly userId: string
  readonly actor: Actor
  recordUsage(event: NewUsage): Promise<void>
  putAsset(file: NewAsset): Promise<Asset>
  /** Reads an asset of the caller's org; rejects with 404 for anything else. */
  readAsset(id: string): Promise<FileData>
  /**
   * Runs a command as the same actor through the full pipeline (role, validation, audit) — e.g.
   * on-model queuing its CAD reference renders with `renders.create { purpose: 'reference' }`.
   */
  invoke: Invoke
  /**
   * Resolves with the terminal status once job `id` of `kind` settles (at once if it already
   * has); rejects with the abort reason when `signal` aborts.
   */
  jobSettled(kind: JobKind, id: string, signal?: AbortSignal): Promise<TerminalStatus>
  /** A finished (`done`) render of the caller's org with this cache key, newest first; else null. */
  cachedRender(cacheKey: string): Promise<RenderJob | null>
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

type Vec3 = [number, number, number]
type Box = { min: Vec3; max: Vec3 }

/**
 * The subject summary shots are framed from. Structurally identical to `@pave/render`'s
 * `SceneSubject` (kernel `Part` / `StoneInstance` picks), so one is assignable to the other
 * without the server depending on the render package.
 */
export interface RenderSubject {
  bounds: Box
  /** Support points of the geometry, so presets frame the real silhouette. */
  silhouette?: Vec3[]
  parts: {
    id: string
    nodeId: string
    material: MetalId
    finish: FinishId
    plating: PlatingId
    bounds: Box
  }[]
  stones: {
    id: string
    nodeId: string
    stone: GemMaterialId
    role: 'center' | 'side' | 'accent' | 'melee'
    /** Column-major 4×4. */
    matrix: number[]
  }[]
}

export interface GeometryService extends Service {
  /** Facts of a design: masses, stones, bounds and manufacturability diagnostics. */
  evaluate(
    design: Design,
    opts: { detail: 'draft' | 'production' },
    sctx: ServiceContext,
  ): Promise<EvaluationSummary>
  export(
    design: Design,
    opts: { format: ExportFormat; stones: boolean },
    sctx: ServiceContext,
  ): Promise<{ file: FileData; notes: string[] }>
  /** What a renderer needs: the design as GLB plus its subject summary. */
  renderInput(
    design: Design,
    sctx: ServiceContext,
  ): Promise<{ glb: FileData; subject: RenderSubject }>
}

export interface SearchService extends Service {
  /** Fans out to the providers; those that fail are listed in `unavailable`, not thrown. */
  search(
    query: CommandParsedInput<'references.search'>,
    sctx: ServiceContext,
  ): Promise<CommandOutput<'references.search'>>
  /**
   * Re-reads a result from its provider by `key`, so a saved reference's rights, URLs and
   * `mayStore` come from the provider, never from what the client echoed. Null when gone.
   */
  resolve(
    result: Pick<SearchResult, 'provider' | 'key'>,
    sctx: ServiceContext,
  ): Promise<SearchResult | null>
}

export type ImageGenRequest = Omit<CommandParsedInput<'references.estimate'>, 'referenceIds'> & {
  references: Reference[]
}

export interface ImageGenService extends Service {
  /**
   * What `generate` would cost for this request (`references.estimate`); the same figure is
   * checked against the org's budget before generating.
   */
  estimate(request: ImageGenRequest, sctx: ServiceContext): Promise<Estimate>
  /**
   * `references` are already filtered to items whose rights allow generative use; read their
   * pixels with `sctx.readAsset(reference.assetId)`. `roles` say what each one is for.
   */
  generate(
    request: ImageGenRequest,
    sctx: ServiceContext,
  ): Promise<{ model: string; images: FileData[]; seed?: number | null }>
}

/** Fetches pictures from the web on the server's behalf. */
export interface CaptureService extends Service {
  /**
   * The image at `url`, or the one a page at `url` presents (its `og:image`), fetched through the
   * SSRF guard with size and time caps.
   */
  capture(url: string, sctx: ServiceContext): Promise<{ file: FileData; sourceUrl: string }>
}

export type RenderJobPatch = Partial<
  Pick<
    RenderJob,
    'status' | 'progress' | 'assetIds' | 'error' | 'scene' | 'critique' | 'seconds' | 'device'
  >
> & {
  /** sha256 of piece, source version, requested scene, engine and runner version. */
  cacheKey?: string
}

export interface RenderQueue extends Service {
  /**
   * Accept a queued Blender job and return promptly; report progress through `handle`. Read
   * geometry with `services.get('geometry').renderInput`. Meter as `render`, key
   * `render:<jobId>:<pass>`. Terminal states are sticky: updates after one are ignored.
   */
  submit(
    job: RenderJob,
    piece: Piece,
    handle: JobHandle<RenderJobPatch>,
    sctx: ServiceContext,
  ): Promise<void>
  /**
   * Called at boot for each Blender job still queued or running, in the context of the user who
   * queued it; take it up again as `submit` would. Without it such jobs fail as interrupted.
   */
  resume?(
    job: RenderJob,
    piece: Piece,
    handle: JobHandle<RenderJobPatch>,
    sctx: ServiceContext,
  ): Promise<void>
  cancel(jobId: string, sctx: ServiceContext): Promise<void>
}

/** Finds and configures Blender on this machine. */
export interface RenderEngineService extends Service {
  status(sctx: ServiceContext): Promise<RenderEngineStatus>
  /** Probes `blenderPath` (null = discover again) and saves it only if it works. */
  configure(blenderPath: string | null, sctx: ServiceContext): Promise<RenderEngineStatus>
}

export type ModelShotPatch = Partial<
  Pick<
    ModelShot,
    'status' | 'assetId' | 'fidelity' | 'check' | 'stage' | 'attempts' | 'error' | 'provenance'
  >
>

export interface OnModelService extends Service {
  /** Generates portrait views; the face first, the others conditioned on the kept face. */
  portraits(
    model: BrandModel,
    views: PortraitView[],
    sctx: ServiceContext,
  ): Promise<{
    recipe: NonNullable<BrandModel['recipe']>
    portraits: { view: PortraitView; file: FileData }[]
  }>
  /** What `portraits` would cost (`models.estimatePortraits`); also checked against the budget. */
  estimatePortraits(
    model: BrandModel,
    views: PortraitView[],
    sctx: ServiceContext,
  ): Promise<Estimate>
  estimate(
    request: CommandParsedInput<'shots.estimate'>,
    subject: { model: BrandModel; piece: Piece },
    sctx: ServiceContext,
  ): Promise<Estimate>
  /**
   * Accept a queued shot and return promptly; report stages through `handle`. Queue CAD
   * references with `sctx.invoke('renders.create', { purpose: 'reference', … })` and wait with
   * `sctx.jobSettled`. Fail closed: a shot that does not match the design is `failed`.
   */
  submitShot(
    shot: ModelShot,
    subject: { model: BrandModel; piece: Piece },
    handle: JobHandle<ModelShotPatch>,
    sctx: ServiceContext,
  ): Promise<void>
  /** Called at boot for each shot still queued or running; without it they fail as interrupted. */
  resumeShot?(
    shot: ModelShot,
    subject: { model: BrandModel; piece: Piece },
    handle: JobHandle<ModelShotPatch>,
    sctx: ServiceContext,
  ): Promise<void>
  cancelShot(shotId: string, sctx: ServiceContext): Promise<void>
  /** A labelled copy of a passed shot (visible disclosure, XMP DigitalSourceType); the original stays as it is. */
  exportShot(shot: ModelShot, sctx: ServiceContext): Promise<FileData>
}

export type ProductionPackagePatch = Partial<
  Pick<ProductionPackage, 'status' | 'assetId' | 'manifest'>
>

export interface ProductionService extends Service {
  /** Accept a queued package build and return promptly; report progress through `handle`. */
  submit(
    pkg: ProductionPackage,
    request: { piece: Piece } & Omit<CommandParsedInput<'production.create'>, 'pieceId'>,
    handle: JobHandle<ProductionPackagePatch>,
    sctx: ServiceContext,
  ): Promise<void>
}

/**
 * The assistant runtime: run loop, approvals and the bridge to studio windows for client tools.
 * Register it even without a model key, so MCP and client tools work; report
 * `capabilities.assistant` only when a model is available, and reject `send` with
 * {@link NotConfiguredError} otherwise. Ids in inputs are already checked to belong to the org.
 */
export interface AssistantService extends Service {
  /** Stores the message and starts a run. Idempotent on `clientMessageId`; declines pending approvals. */
  send(
    input: CommandParsedInput<'threads.send'>,
    sctx: ServiceContext,
  ): Promise<{ thread: Thread; run: Run }>
  /** The run belongs to the caller, who is a person. */
  decide(input: CommandParsedInput<'runs.decide'>, sctx: ServiceContext): Promise<Run>
  cancel(runId: string, sctx: ServiceContext): Promise<Run>
  /** Completes a pending client-tool request; the first answer wins. */
  respond(input: CommandParsedInput<'client.respond'>, sctx: ServiceContext): Promise<void>
  /**
   * Called at boot for each run left `running` or `awaiting-approval`, as the run's user: fail
   * the running ones as `interrupted` and keep waiting on approvals. Without it, running runs
   * are failed as interrupted and waiting ones stay waiting.
   */
  resume?(run: Run, sctx: ServiceContext): Promise<void>
}

export type MeshJobPatch = Partial<
  Pick<MeshJob, 'status' | 'progress' | 'meshAssetId' | 'costUsd' | 'error' | 'model'>
> & {
  /** The provider's own job id, stored so polling can resume after a restart. */
  providerJobId?: string
}

export interface Mesh3DService extends Service {
  estimate(request: CommandParsedInput<'mesh3d.estimate'>, sctx: ServiceContext): Promise<Estimate>
  /**
   * Accept a queued job with its input images and return promptly; report through `handle`
   * (store the mesh with `sctx.putAsset`). Meter as `mesh3d`, key `mesh3d:<job id>`.
   */
  submit(
    job: MeshJob,
    images: FileData[],
    handle: JobHandle<MeshJobPatch>,
    sctx: ServiceContext,
  ): Promise<void>
  /**
   * Called at boot for each job still queued or running, with the provider job id it stored
   * (null if it never got one): resume polling. Without it such jobs fail as interrupted.
   */
  resume?(
    job: MeshJob,
    handle: JobHandle<MeshJobPatch>,
    sctx: ServiceContext,
    stored: { providerJobId: string | null },
  ): Promise<void>
  cancel(
    jobId: string,
    sctx: ServiceContext,
    stored: { providerJobId: string | null },
  ): Promise<void>
}

/** Built by the render workstream's vision provider; see the note at the top of this file. */
export interface VisionService extends Service {
  /** Tags for an image and what in it needs the person's attestation (logos, characters, faces). */
  describe(image: FileData, sctx: ServiceContext): Promise<{ tags: string[]; flags: OriginFlag[] }>
}

export interface DepthService extends Service {
  /** A depth map of the image: a greyscale PNG of the same size, white = near. */
  estimate(image: FileData, sctx: ServiceContext): Promise<FileData>
}

export type EmbeddingInput = { text: string } | { image: FileData }

export interface EmbeddingService extends Service {
  /** One vector per input, in order; all of the same length. */
  embed(inputs: EmbeddingInput[], sctx: ServiceContext): Promise<number[][]>
}

/**
 * Picture → jewelry analysis (`@pave/freeform`). It must not fail for want of the optional
 * helpers: without `vision`, `flags` is empty; without `depth`, height maps come from the
 * silhouette and luminance (`depthSource: 'basic'`). Store outputs with `sctx.putAsset`.
 */
export interface FreeformService extends Service {
  analyze(
    input: CommandParsedInput<'freeform.analyze'>,
    source: FileData,
    helpers: { vision: VisionService | null; depth: DepthService | null },
    sctx: ServiceContext,
  ): Promise<CommandOutput<'freeform.analyze'>>
}

export interface Services {
  geometry: GeometryService
  search: SearchService
  imageGen: ImageGenService
  capture: CaptureService
  renderQueue: RenderQueue
  renderEngine: RenderEngineService
  onModel: OnModelService
  production: ProductionService
  assistant: AssistantService
  mesh3d: Mesh3DService
  freeform: FreeformService
  vision: VisionService
  depth: DepthService
  embedding: EmbeddingService
}
export type ServiceName = keyof Services

const NOT_CONFIGURED: Record<ServiceName, string> = {
  geometry:
    'No geometry kernel is configured on this server, so CAD cannot be evaluated or exported.',
  search: 'No image search providers are configured on this server.',
  imageGen: 'No image generation provider is configured on this server.',
  capture: 'This server cannot fetch images from the web.',
  renderQueue: 'No render queue is configured on this server.',
  renderEngine: 'This server cannot look for a render engine.',
  onModel: 'No on-model imaging provider is configured on this server.',
  production: 'No production packager is configured on this server.',
  assistant: 'The assistant is not configured on this server.',
  mesh3d: 'No image-to-3D provider is configured on this server.',
  freeform: 'Picture-to-jewelry analysis is not available on this server.',
  vision: 'No vision model is configured on this server.',
  depth: 'No depth model is configured on this server.',
  embedding: 'No embedding model is configured on this server.',
}

const missing = (service: ServiceName) => () =>
  Promise.reject(new NotConfiguredError(service, NOT_CONFIGURED[service]))

const DEFAULTS: Services = {
  geometry: {
    evaluate: missing('geometry'),
    export: missing('geometry'),
    renderInput: missing('geometry'),
  },
  search: { search: missing('search'), resolve: missing('search') },
  imageGen: { estimate: missing('imageGen'), generate: missing('imageGen') },
  capture: { capture: missing('capture') },
  renderQueue: { submit: missing('renderQueue'), cancel: missing('renderQueue') },
  renderEngine: { status: missing('renderEngine'), configure: missing('renderEngine') },
  onModel: {
    portraits: missing('onModel'),
    estimatePortraits: missing('onModel'),
    estimate: missing('onModel'),
    submitShot: missing('onModel'),
    cancelShot: missing('onModel'),
    exportShot: missing('onModel'),
  },
  production: { submit: missing('production') },
  assistant: {
    send: missing('assistant'),
    decide: missing('assistant'),
    cancel: missing('assistant'),
    respond: missing('assistant'),
  },
  mesh3d: { estimate: missing('mesh3d'), submit: missing('mesh3d'), cancel: missing('mesh3d') },
  freeform: { analyze: missing('freeform') },
  vision: { describe: missing('vision') },
  depth: { estimate: missing('depth') },
  embedding: { embed: missing('embedding') },
}

const NO_CAPABILITIES: Capabilities = {
  assistant: false,
  imageSearch: [],
  imageGeneration: [],
  mesh3d: [],
  blender: false,
  sourcing: [],
  vision: false,
  embedding: false,
  depth: false,
  onModel: [],
  c2pa: false,
}

/** Capabilities that follow from registration alone; an implementation's own declaration wins. */
const IMPLIED: Partial<Record<ServiceName, Partial<Capabilities>>> = {
  vision: { vision: true },
  depth: { depth: true },
  embedding: { embedding: true },
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

  /** The implementation when registered, else null — for handlers with a fallback. */
  optional<K extends ServiceName>(name: K): Services[K] | null {
    return this.isConfigured(name) ? this.#impls[name] : null
  }

  /** Like {@link get}, but refuses up front — for handlers that persist rows before delegating. */
  require<K extends ServiceName>(name: K): Services[K] {
    if (!this.isConfigured(name)) throw new NotConfiguredError(name, NOT_CONFIGURED[name])
    return this.#impls[name]
  }

  capabilities(): Capabilities {
    const out: Capabilities = { ...NO_CAPABILITIES }
    for (const name of this.#registered)
      Object.assign(out, IMPLIED[name], this.#impls[name].capabilities)
    return out
  }
}
