import { createHash } from 'node:crypto'
import { parse } from 'node:path'
import { ProviderError, type ProviderReference } from '@pave/ideation'
import type { BrandModel, Estimate, ModelShot, Piece } from '@pave/schema'
import { and, desc, eq } from 'drizzle-orm'
import sharp from 'sharp'
import * as t from '../db/schema'
import { AppError, conflict, NotConfiguredError } from '../errors'
import { createId } from '../ids'
import { engineError } from '../jobs'
import type { Runtime } from '../runtime'
import type {
  FileData,
  ImageGenService,
  JobHandle,
  ModelShotPatch,
  OnModelService,
  PortraitView,
  ResolvedImageProvider,
  ServiceContext,
} from '../services'
import { assertBudget } from '../usage'

const rendersNeeded =
  'Save a finished still render of the current CAD in Render, without material overrides, then try again.'
const providerNeeded =
  'Choose an image model that accepts references in Settings → AI. An owner or admin can add its API key there.'
const portraitForPlacement: Record<ModelShot['placement'], PortraitView> = {
  hand: 'hands',
  wrist: 'hands',
  neck: 'neck',
  ear: 'ear',
}
const framing: Record<ModelShot['placement'], string> = {
  hand: 'Close-up of the hand wearing the jewelry naturally on a visible finger.',
  wrist: 'Close-up of the wrist and hand wearing the jewelry naturally.',
  neck: 'Close-up of the neckline and collarbones wearing the jewelry naturally.',
  ear: 'Close-up of the ear wearing the jewelry, with hair clear of the piece.',
}

const portraitFraming: Record<PortraitView, string> = {
  face: 'A natural front-facing headshot with a neutral expression.',
  hands: 'A close-up of both hands at rest, with bare wrists and fingers.',
  neck: 'A close-up of the bare neck and collarbones, with a plain shirt below.',
  ear: 'A close-up of an ear with hair pulled away.',
  body: 'A full-length front-facing standing portrait in simple clothing.',
}

const sketch = (card: BrandModel['card']) =>
  [
    `Fictional adult, age range ${card.ageRange}.`,
    card.description,
    card.skinTone && `Skin tone: ${card.skinTone}.`,
    card.monkTone && `Monk Skin Tone: ${card.monkTone}.`,
    card.undertone && `Undertone: ${card.undertone}.`,
    card.hair && `Hair: ${card.hair}.`,
    card.eyes && `Eyes: ${card.eyes}.`,
    card.marks && `Marks: ${card.marks}.`,
    card.build && `Build: ${card.build}.`,
    card.styling && `Styling: ${card.styling}.`,
    card.ringSizeUs && `US ring size: ${card.ringSizeUs}.`,
    card.wristMm && `Wrist circumference: ${card.wristMm} mm.`,
    card.neckMm && `Neck circumference: ${card.neckMm} mm.`,
    card.handLengthMm && `Hand length: ${card.handLengthMm} mm.`,
  ]
    .filter(Boolean)
    .join('\n')

function assertSynthetic(model: BrandModel) {
  if (!model.attestedSynthetic)
    throw conflict('Attest that this model represents a fictional adult.')
}

function estimate(resolved: ResolvedImageProvider, count: number): Estimate {
  const { provider, model, quality } = resolved
  return {
    provider: provider.id,
    model,
    usd: provider.perImageUsd(model, quality) * count,
    seconds: provider.seconds * count,
  }
}

function portraitPlan(model: BrandModel, views: PortraitView[]) {
  const unique = [...new Set(views.filter((view) => view !== 'face'))]
  return views.includes('face') || !model.portraits.some((p) => p.view === 'face')
    ? ['face' as const, ...unique]
    : unique
}

const pixelLimit = 40_000_000
const generatedImageXmp = [
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
  '<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>',
  '</rdf:Description></rdf:RDF></x:xmpmeta>',
].join('')

/** Normalize reference bytes to a supported still image type and bound provider upload size. */
async function imageReference(file: FileData, title: string, role: ProviderReference['role']) {
  if (!file.mime.startsWith('image/')) throw conflict(`${title} must be a still image.`)
  try {
    const bytes = await sharp(file.bytes, { limitInputPixels: pixelLimit })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return { title, role, bytes, mime: 'image/png' } satisfies ProviderReference
  } catch {
    throw conflict(`${title} could not be read. Save a new image and try again.`)
  }
}

async function labelledImage(file: FileData, label: 'AI · Concept' | 'AI · Test') {
  const image = sharp(file.bytes, { limitInputPixels: pixelLimit })
  const { width, height, autoOrient } = await image.metadata()
  if (!width || !height) throw conflict('The image provider returned an unreadable image.')
  const w = autoOrient?.width ?? width
  const h = autoOrient?.height ?? height
  const font = Math.max(1, Math.round(Math.min(w, h) * 0.034))
  const pad = Math.max(1, Math.round(font * 0.45))
  const labelWidth = Math.min(w, Math.ceil(font * label.length * 0.64 + pad * 2))
  const labelHeight = Math.min(h, font + pad * 2)
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#161616" fill-opacity="0.88"/>
      <text x="${pad}" y="${pad + font * 0.82}" font-family="sans-serif" font-size="${font}" fill="#fff">${label}</text>
    </svg>`,
  )
  const tagged = image.rotate().composite([{ input: svg, gravity: 'southeast' }])
  if (label === 'AI · Concept') tagged.withXmp(generatedImageXmp)
  const bytes = await tagged.png().toBuffer()
  return { bytes, mime: 'image/png', name: `${parse(file.name).name}.png` } satisfies FileData
}

type ActiveShot = { controller: AbortController; task: Promise<void> }

export class OnModelImpl implements OnModelService {
  readonly #active = new Map<string, ActiveShot>()
  readonly #orgTail = new Map<string, Promise<void>>()

  constructor(
    private readonly runtime: Runtime,
    private readonly images: ImageGenService,
  ) {}

  async available(sctx: ServiceContext): Promise<string[]> {
    if (!this.images.available(sctx.orgId).length) return []
    const { provider, model } = await this.images.price(sctx, null)
    return provider.models.some((m) => m.id === model && m.takesReferences) ? [provider.id] : []
  }

  #ctx(sctx: ServiceContext) {
    return this.runtime.context({ orgId: sctx.orgId, userId: sctx.userId })
  }

  async #provider(sctx: ServiceContext) {
    if (!this.images.available(sctx.orgId).length)
      throw new NotConfiguredError('onModel', providerNeeded)
    const resolved = await this.images.resolve(sctx, null)
    if (!resolved.provider.models.some((m) => m.id === resolved.model && m.takesReferences))
      throw new NotConfiguredError('onModel', providerNeeded)
    return resolved
  }

  async #render(piece: Piece, sctx: ServiceContext) {
    const ctx = await this.#ctx(sctx)
    const rows = await ctx.repo.renders.many({
      where: and(
        eq(t.renderJob.pieceId, piece.id),
        eq(t.renderJob.sourceVersion, piece.version),
        eq(t.renderJob.status, 'done'),
        eq(t.renderJob.purpose, 'take'),
      ),
      orderBy: desc(t.renderJob.createdAt),
    })
    const run = rows.find(
      (r) => r.assetIds[0] && !r.scene.animation && !Object.keys(r.scene.overrides ?? {}).length,
    )
    if (!run) throw conflict(rendersNeeded)
    return { id: run.id, assetId: run.assetIds[0]! }
  }

  async #generate(
    resolved: ResolvedImageProvider,
    request: {
      prompt: string
      references: ProviderReference[]
      aspect: ModelShot['aspect']
      key: string
      pieceId?: string
      signal?: AbortSignal
    },
    sctx: ServiceContext,
  ) {
    const { provider, model, quality, apiKey } = resolved
    const { prompt, references, aspect, key, pieceId, signal } = request
    // Serialize spend checks and image calls within an org, so its own queued shots and
    // portrait generation do not spend the same remaining budget concurrently.
    const previous = this.#orgTail.get(sctx.orgId) ?? Promise.resolve()
    const next = previous.then(async () => {
      signal?.throwIfAborted()
      await assertBudget(await this.#ctx(sctx), estimate(resolved, 1).usd)
      signal?.throwIfAborted()
      const safetyId = createHash('sha256')
        .update(`${sctx.orgId}:${sctx.userId}`)
        .digest('hex')
        .slice(0, 32)
      const result = await provider
        .generate({
          apiKey,
          model,
          quality,
          prompt,
          references,
          aspect,
          count: 1,
          signal,
          safetyId,
        })
        .catch((error: unknown) => {
          signal?.throwIfAborted()
          if (error instanceof ProviderError) {
            const fix =
              error.code === 'invalid' || error.code === 'forbidden'
                ? ' Check the API key in Settings → AI.'
                : ''
            throw new AppError('provider_unavailable', `${error.message}${fix}`)
          }
          throw error
        })
      if (result.costUsd > 0 || result.images.length) {
        await sctx.recordUsage({
          meter: 'image',
          provider: provider.id,
          model: result.model,
          quantity: result.images.length + result.blocked.length,
          unit: 'images',
          costUsd: result.costUsd,
          idempotencyKey: key,
          pieceId,
          stage: pieceId ? 'render' : null,
        })
      }
      signal?.throwIfAborted()
      const picture = result.images[0]
      if (!picture) throw conflict(result.blocked[0]?.reason ?? 'The provider returned no image.')
      return { picture, model: result.model }
    })
    const tail = next.then(
      () => {},
      () => {},
    )
    this.#orgTail.set(sctx.orgId, tail)
    try {
      return await next
    } finally {
      if (this.#orgTail.get(sctx.orgId) === tail) this.#orgTail.delete(sctx.orgId)
    }
  }

  async estimatePortraits(model: BrandModel, views: PortraitView[], sctx: ServiceContext) {
    assertSynthetic(model)
    return estimate(await this.#provider(sctx), portraitPlan(model, views).length)
  }

  async portraits(model: BrandModel, views: PortraitView[], sctx: ServiceContext) {
    assertSynthetic(model)
    const resolved = await this.#provider(sctx)
    const plan = portraitPlan(model, views)
    const keptFace = plan.includes('face')
      ? undefined
      : model.portraits.find((p) => p.view === 'face')
    let face = keptFace
      ? await imageReference(await sctx.readAsset(keptFace.assetId), 'Model headshot', 'identity')
      : undefined
    const portraits: Awaited<ReturnType<OnModelService['portraits']>>['portraits'] = []
    let usedModel = resolved.model
    const generationId = createId('prt')
    for (const view of plan) {
      const result = await this.#generate(
        resolved,
        {
          prompt: [
            'Generate a photoreal, clothed studio reference of the following fictional adult. Do not imitate a real person. Use even lighting and no jewelry.',
            sketch(model.card),
            portraitFraming[view],
            face && 'Keep the same fictional person as the identity reference.',
          ]
            .filter(Boolean)
            .join('\n'),
          references: face ? [face] : [],
          aspect: '4:5',
          key: `${generationId}:${view}:image`,
          signal: sctx.signal,
        },
        sctx,
      )
      usedModel = result.model
      const name = `model-${model.id}-${view}.png`
      const normalized = await imageReference(
        { ...result.picture, name },
        'Generated portrait',
        'identity',
      )
      if (view === 'face') face = normalized
      portraits.push({ view, file: { bytes: normalized.bytes, mime: normalized.mime, name } })
    }
    return { recipe: { provider: resolved.provider.id, model: usedModel, seed: null }, portraits }
  }

  async estimate(
    request: Parameters<OnModelService['estimate']>[0],
    { model, piece }: { model: BrandModel; piece: Piece },
    sctx: ServiceContext,
  ) {
    assertSynthetic(model)
    if (model.status !== 'approved')
      throw conflict('Approve this model before making on-model images.')
    const resolved = await this.#provider(sctx)
    await this.#render(piece, sctx)
    return estimate(resolved, request.count)
  }

  async submitShot(
    shot: ModelShot,
    { piece, model }: { piece: Piece; model: BrandModel },
    handle: JobHandle<ModelShotPatch>,
    sctx: ServiceContext,
  ) {
    if (this.#active.has(shot.id)) return
    const controller = new AbortController()
    const signal = controller.signal
    const task = this.#shoot(shot, piece, model, handle, sctx, signal)
      .catch(async (error: unknown) => {
        if (signal.aborted) return
        if (!(error instanceof AppError)) console.error(`On-model shot ${shot.id} failed`, error)
        await handle.update({ status: 'failed', error: engineError(error) })
      })
      .finally(() => this.#active.delete(shot.id))
    this.#active.set(shot.id, { controller, task })
  }

  async #shoot(
    shot: ModelShot,
    piece: Piece,
    model: BrandModel,
    handle: JobHandle<ModelShotPatch>,
    sctx: ServiceContext,
    signal: AbortSignal,
  ) {
    await handle.update({ status: 'running', stage: 'references' })
    assertSynthetic(model)
    const resolved = await this.#provider(sctx)
    const render = await this.#render(piece, sctx)
    const portraits = model.portraits.filter(
      (p) => p.view === 'face' || p.view === portraitForPlacement[shot.placement],
    )
    const references = await Promise.all([
      sctx
        .readAsset(render.assetId)
        .then((f) => imageReference(f, 'CAD jewelry render', 'product')),
      ...portraits.map((p) =>
        sctx.readAsset(p.assetId).then((f) => imageReference(f, `Model ${p.view}`, 'identity')),
      ),
    ])
    signal.throwIfAborted()
    const prompt = [
      'Create a photoreal jewelry campaign photograph of a fully clothed fictional adult. Do not imitate any real person.',
      framing[shot.placement],
      'Use the CAD image as the reference for the jewelry only. Match its silhouette, materials, stone layout and setting as closely as possible. Keep jewelry at believable scale. Show no extra jewelry, props on the jewelry, text or logos.',
      portraits.length &&
        'Use the portrait references to maintain the fictional model’s appearance.',
      sketch(model.card),
      shot.direction &&
        `Photographic direction for pose, styling, camera or light: ${shot.direction}`,
    ]
      .filter(Boolean)
      .join('\n')
    await handle.update({ stage: 'generate', attempts: 1 })
    const result = await this.#generate(
      resolved,
      {
        prompt,
        references,
        aspect: shot.aspect,
        key: `${shot.id}:image`,
        pieceId: piece.id,
        signal,
      },
      sctx,
    )
    const disclosure = resolved.provider.id === 'fake' ? 'AI · Test' : 'AI · Concept'
    await handle.update({ stage: 'label' })
    const file = await labelledImage({ ...result.picture, name: `${shot.id}.png` }, disclosure)
    signal.throwIfAborted()
    const asset = await sctx.putAsset({ ...file, kind: 'image' })
    signal.throwIfAborted()
    await handle.update({
      status: 'done',
      assetId: asset.id,
      provenance: {
        provider: resolved.provider.id,
        model: result.model,
        seed: null,
        prompt,
        referenceRenderIds: [render.id],
        portraitAssetIds: portraits.map((p) => p.assetId),
        disclosure,
      },
    })
  }

  async cancelShot(id: string) {
    this.#active.get(id)?.controller.abort()
  }

  async exportShot(shot: ModelShot, sctx: ServiceContext) {
    if (!shot.check?.passed || !shot.assetId)
      throw conflict('This image has no passed CAD fidelity check.')
    return labelledImage(
      await sctx.readAsset(shot.assetId),
      shot.provenance?.provider === 'fake' ? 'AI · Test' : 'AI · Concept',
    )
  }

  async dispose() {
    const active = [...this.#active.values()]
    for (const { controller } of active) controller.abort()
    await Promise.allSettled(active.map(({ task }) => task))
  }
}
