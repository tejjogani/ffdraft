/** One synthetic reference through the product's CAD and render tools, with withheld ground truth. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { TAKE_TO_CAD_GOAL } from '@pave/agent/studio'
import {
  type AssistantTier,
  type ClientToolOutput,
  type CommandOutput,
  type PieceSpecInput,
  type Run,
  resolveDesign,
  type Step,
} from '@pave/schema'
import sharp from 'sharp'
import { assetBytes } from '../test/engines'
import {
  encodeReference,
  referenceDesign,
  referenceOverlap,
  referencePixels,
  SCRIPTED_READ,
} from './reference-replication-fixture'
import { bootSmoke, follow } from './smoke'
import { TestModel, text, tool } from './testing'

type Detail = CommandOutput<'traces.run'>
type Read = CommandOutput<'references.read'>
type Fit = CommandOutput<'match.fit'>
type Capture = ClientToolOutput<'viewport.capture'>
type Mode = 'scripted' | 'live'

interface ReplicationOptions {
  mode: Mode
  blender: boolean
  tier: AssistantTier
  out: string
  env: NodeJS.ProcessEnv
  log: (line: string) => void
}

interface Check {
  status: 'not_run' | 'passed' | 'failed' | 'skipped'
  reason?: string
}

interface Report {
  status: 'passed' | 'failed' | 'skipped'
  mode: Mode
  transport: 'fake_claude_http' | 'live_claude_http'
  usageSource: 'simulated' | 'claude_api'
  fixture: 'synthetic_six_claw_solitaire'
  vision: Check & {
    answerSource: 'scripted' | 'live'
    observed?: Read['read']
    model?: string
    file?: string
  }
  cad: Check & {
    pieceId?: string
    version?: number
    fitOverlap?: number | null
    registeredOverlap?: number
    features?: Record<string, number | null>
    referencePlaneView?: string
    files?: string[]
  }
  blender: Check & {
    version?: number
    engineVersion?: string | null
    jobId?: string
    device?: string | null
    seconds?: number | null
    file?: string
  }
  runs: Pick<Run, 'id' | 'model' | 'status' | 'costUsd' | 'tokens'>[]
}

const TAKE_PROMPT = `${TAKE_TO_CAD_GOAL} Apply the fit to the built CAD and capture the edited result in three-quarter view so I can compare. Use this project.`
const SIZE_OPTION = 'us-6'
const RENDER_SIZE = 256
const RENDER_SCENE = {
  look: 'catalog-white',
  camera: { preset: 'three-quarter' },
  output: { quality: 'preview', width: RENDER_SIZE, height: RENDER_SIZE },
} as const

/** Pulls one result out of the simulated tool caller's next request. The live branch never uses this. */
function scriptValue<T>(params: BetaMessageStreamParams, toolUseId: string): T {
  for (const message of params.messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type !== 'tool_result' || block.tool_use_id !== toolUseId) continue
      assert.ok(!block.is_error, JSON.stringify(block.content))
      assert.ok(Array.isArray(block.content))
      const first = block.content[0]
      assert.ok(first?.type === 'text')
      return JSON.parse(first.text) as T
    }
  }
  throw new Error(`No scripted tool result for ${toolUseId}.`)
}

function scriptCad(model: TestModel, pieceId: string, assetId: string) {
  let spec: PieceSpecInput
  model.push(
    { content: [tool('references_read', { assetIds: [assetId] }, 'toolu_read')] },
    ({ params }) => {
      assert.equal(params.output_config?.format?.type, 'json_schema')
      assert.ok(
        params.messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((block) => block.type === 'image'),
        ),
        'The structured read request lacked the reference image.',
      )
      return { content: [text(JSON.stringify(SCRIPTED_READ))] }
    },
    ({ params }) => {
      const { specDraft, questions } = scriptValue<Read>(params, 'toolu_read')
      spec = specDraft
      return {
        content: [tool('chat_ask', { intro: SCRIPTED_READ.observations, questions }, 'toolu_ask')],
      }
    },
    () => ({
      content: [
        tool('pieces_setSpec', { id: pieceId, spec }, 'toolu_spec'),
        tool('pieces_estimate', { id: pieceId, spec }, 'toolu_estimate'),
      ],
    }),
    { content: [tool('pieces_buildFromSpec', { id: pieceId }, 'toolu_build')] },
    {
      content: [
        tool('match_fit', { pieceId, assetId, view: 'threeQuarter', seconds: 40 }, 'toolu_fit'),
      ],
    },
    ({ params }) => {
      const fit = scriptValue<Fit>(params, 'toolu_fit')
      assert.equal(fit.quality, 'good', fit.reason)
      return {
        content: [
          tool(
            'design_apply',
            { pieceId, baseVersion: fit.version, ops: fit.ops, label: 'Fit CAD to reference' },
            'toolu_apply',
          ),
        ],
      }
    },
    {
      content: [tool('viewport_capture', { pieceId, views: ['three-quarter'] }, 'toolu_capture')],
    },
    { content: [text('The fitted CAD is ready to compare in the reference view.')] },
  )
}

function latestTool<T>(detail: Detail, name: string, accepts: (value: T) => boolean = () => true) {
  for (const step of detail.steps.toReversed()) {
    if (step.name !== name || step.status !== 'done' || step.isError) continue
    const value = (step.output as { value?: T } | null)?.value
    if (value && accepts(value)) return { step, value }
  }
  throw new Error(`The run did not complete ${name} with the expected result.`)
}

export async function runReferenceReplication(options: ReplicationOptions): Promise<Report> {
  const { mode, out, env, log } = options
  const report: Report = {
    status: 'failed',
    mode,
    transport: mode === 'scripted' ? 'fake_claude_http' : 'live_claude_http',
    usageSource: mode === 'scripted' ? 'simulated' : 'claude_api',
    fixture: 'synthetic_six_claw_solitaire',
    vision: { status: 'not_run', answerSource: mode },
    cad: { status: 'not_run' },
    blender: options.blender
      ? { status: 'not_run' }
      : { status: 'skipped', reason: 'not_requested' },
    runs: [],
  }
  await mkdir(out, { recursive: true })
  const reportFile = join(out, 'report.json')
  if (mode === 'live' && !env.ANTHROPIC_API_KEY?.trim()) {
    report.status = 'skipped'
    report.vision = { status: 'skipped', reason: 'no_key', answerSource: 'live' }
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`)
    return report
  }

  let model: TestModel | undefined
  let s: Awaited<ReturnType<typeof bootSmoke>> | undefined
  let stage: 'vision' | 'cad' | 'blender' = 'vision'
  try {
    if (mode === 'scripted') model = await new TestModel({ transport: 'fake' }).start()
    s = await bootSmoke({
      env: model ? { ...env, ANTHROPIC_API_KEY: 'sk-ant-test-reference-replication' } : env,
      model: model?.factory,
    })
    const { api, server } = s
    if (options.blender) {
      const engine = await api.call('renders.engine', {})
      if (!engine.available) {
        stage = 'blender'
        throw new Error(engine.reason ?? 'Blender was unavailable.')
      }
      report.blender.engineVersion = engine.version
    }

    const { truth, width, band } = referenceDesign()
    const source = await referencePixels(server, truth)
    const jpeg = await encodeReference(source).jpeg({ quality: 92 }).toBuffer()
    await writeFile(join(out, 'reference.jpg'), jpeg)
    const form = new FormData()
    form.set('file', new File([new Uint8Array(jpeg)], 'reference.jpg', { type: 'image/jpeg' }))
    const upload = await api.request('/api/assets', { method: 'POST', body: form })
    assert.equal(upload.status, 201, await upload.clone().text())
    const photo = (await upload.json()) as { id: string }
    const target = await api.call('pieces.create', { title: 'Reference replication' })
    const board = await api.call('boards.forPiece', { pieceId: target.id })
    const [ref] = await api.call('references.save', {
      boardId: board.id,
      items: [{ assetId: photo.id, title: 'Reference' }],
    })
    const { assetId, pin } = await api.call('pieces.takeToCad', {
      pieceId: target.id,
      referenceId: ref!.id,
    })
    assert.equal(pin.plane, null)

    const approved = new Set<string>()
    const run = async (
      prompt: string,
      tab: 'design' | 'render',
      decide: NonNullable<Parameters<typeof follow>[2]['decide']>,
    ) => {
      const { run: started } = await api.call('threads.send', {
        text: prompt,
        attachments: tab === 'design' ? [assetId] : [],
        context: { pieceId: target.id, selection: [], stage: tab },
        ...(tab === 'design' ? { job: { stage: 'cad' as const, goal: TAKE_PROMPT } } : {}),
        tier: options.tier,
        clientId: 'reference-replication',
        clientMessageId: tab,
      })
      try {
        return await follow(api, started.id, {
          timeoutMs: 15 * 60_000,
          log,
          decide: (step) => {
            const decision = decide(step)
            if (decision.decision === 'approve') approved.add(step.name)
            return decision
          },
        })
      } finally {
        const current = (await api.call('traces.run', { id: started.id })).run
        const { id, model, status, costUsd, tokens } = current
        report.runs.push({ id, model, status, costUsd, tokens })
      }
    }

    if (model) scriptCad(model, target.id, assetId)
    const cad = await run(TAKE_PROMPT, 'design', (step: Step) => {
      if (step.name === 'chat.ask') {
        const { questions } = step.input as { questions: Read['questions'] }
        const asksSize = questions.some(
          (question) =>
            question.id === 'size' && question.options.some((option) => option.id === SIZE_OPTION),
        )
        return { decision: 'approve', ...(asksSize ? { answers: { size: [SIZE_OPTION] } } : {}) }
      }
      if (step.name === 'pieces.buildFromSpec' && (step.input as { id: string }).id === target.id)
        return { decision: 'approve' }
      return { decision: 'deny' }
    })

    const read = latestTool<Read>(cad, 'references.read').value
    const { kind, view, archetype, stones } = read.read
    report.vision.observed = read.read
    report.vision.model = read.model
    report.vision.file = 'reference-read.json'
    await writeFile(join(out, report.vision.file), `${JSON.stringify(read, null, 2)}\n`)
    const centre = stones.find((stone) => stone.role === 'center')
    assert.equal(kind.value, 'ring')
    assert.equal(view, 'threeQuarter')
    assert.equal(archetype.value, 'solitaire')
    assert.ok(centre?.cut === 'round' && centre.setting === 'prong' && centre.prongs === 6)
    assert.equal(read.cutout.ok, true, read.cutout.reason)
    report.vision.status = 'passed'

    stage = 'cad'
    assert.equal(cad.run.status, 'done', cad.run.error ?? undefined)
    assert.equal(cad.run.pieceId, target.id)
    assert.ok(approved.has('chat.ask') && approved.has('pieces.buildFromSpec'))
    const doneStep = (name: string) =>
      cad.steps.find((step) => step.name === name && step.status === 'done' && !step.isError)
    const asked = doneStep('chat.ask')
    const estimated = doneStep('pieces.estimate')
    const built = doneStep('pieces.buildFromSpec')
    assert.ok(
      asked && estimated && built && asked.index < estimated.index && estimated.index < built.index,
    )
    const fit = latestTool<Fit>(cad, 'match.fit', (value) => value.quality === 'good')
    const patch = latestTool<CommandOutput<'design.apply'>>(cad, 'design.apply')
    assert.ok(fit.step.index < patch.step.index, 'Fit operations were not followed by a CAD edit.')
    assert.ok(fit.value.ops.length > 0 && patch.value.version > fit.value.version)
    report.cad.fitOverlap = fit.value.overlap
    assert.ok((fit.value.overlap ?? 0) >= 0.8, 'The fitter overlap was below 80%.')
    const piece = await api.call('pieces.get', { id: target.id })
    report.cad.pieceId = piece.id
    report.cad.version = piece.version
    assert.equal(patch.value.version, piece.version)
    const registered = (await api.call('references.pins', { pieceId: piece.id })).references.find(
      (reference) => reference.id === pin.id,
    )
    // Image planes are orthographic. Take to CAD puts an oblique photo in the front plane.
    assert.equal(registered?.plane?.view, 'front')
    report.cad.referencePlaneView = registered.plane.view
    assert.ok(registered?.plane && registered.plane.width > 0, 'The reference plane has no scale.')
    const resolved = resolveDesign(piece.design)
    const shapedBand = Object.values(resolved.nodes).find((node) => node.kind === 'ringShank')
    const shapedStone = Object.values(resolved.nodes).find((node) => node.kind === 'gem')
    const setting = Object.values(resolved.nodes).find((node) => node.kind === 'setting')
    const evaluated = await api.call('design.evaluate', { pieceId: piece.id, detail: 'draft' })
    assert.equal(evaluated.stoneCount, 1)
    assert.ok(evaluated.metalMassG > 0)
    assert.deepEqual(piece.spec?.ring?.size, { system: 'us', value: 6 })
    const fitted = await referencePixels(server, piece.design)
    report.cad.registeredOverlap = referenceOverlap(source, fitted)
    const matchedFile = 'fitted-cad.png'
    await writeFile(join(out, matchedFile), await encodeReference(fitted).png().toBuffer())
    report.cad.files = ['reference.jpg', matchedFile]
    const capture = latestTool<Capture>(
      cad,
      'viewport.capture',
      (value) =>
        value.version === piece.version &&
        value.source === 'server' &&
        value.images.some((image) => image.view === 'three-quarter'),
    ).value
    const captureId = capture.images.find((image) => image.view === 'three-quarter')!.assetId
    const captureFile = 'assistant-capture.png'
    await writeFile(
      join(out, captureFile),
      await assetBytes(api, { url: `/api/assets/${captureId}` }),
    )
    report.cad.files.push(captureFile)
    const prongs = setting && 'prongCount' in setting ? setting.prongCount : null
    report.cad.features = {
      prongs: prongs ?? null,
      stoneWidthMm: shapedStone?.width ?? null,
      referenceStoneWidthMm: width,
      bandWidthMm: shapedBand?.widthTop ?? null,
      referenceBandWidthMm: band,
      referencePlaneWidthMm: registered.plane.width,
    }
    assert.equal(prongs, 6, 'The edited CAD did not preserve the reference setting.')
    assert.equal(shapedStone?.cut, 'round')
    assert.ok(
      shapedStone && Math.abs(shapedStone.width - width) <= 1,
      'Stone width differed by over 1 mm.',
    )
    assert.ok(
      shapedBand && Math.abs(shapedBand.widthTop - band) <= 0.65,
      'Band width differed by over 0.65 mm.',
    )
    assert.ok(
      report.cad.registeredOverlap >= 0.8,
      'The final CAD did not overlap the source at the same pose.',
    )
    const saved = await api.call('pieces.saveFile', { id: piece.id })
    const cadFile = 'fitted-cad.pave'
    await writeFile(join(out, cadFile), await assetBytes(api, saved.asset))
    report.cad.files.push(cadFile)
    report.cad.status = 'passed'

    if (options.blender) {
      stage = 'blender'
      model?.push(
        {
          content: [
            tool(
              'renders_create',
              {
                pieceId: piece.id,
                baseVersion: piece.version,
                engine: 'blender',
                scene: RENDER_SCENE,
              },
              'toolu_blender',
            ),
          ],
        },
        { content: [text('Blender finished the still of the reference revision.')] },
      )
      const rendered = await run(
        `Render this exact CAD revision (version ${piece.version}) once as a Blender still. Use renders.create with baseVersion, the three-quarter camera, catalog-white, preview quality at ${RENDER_SIZE}×${RENDER_SIZE}, and no design edits, animation or auto tune.`,
        'render',
        (step) => {
          if (step.name !== 'renders.create' || approved.has(step.name)) return { decision: 'deny' }
          const input = step.input as {
            pieceId: string
            baseVersion?: number
            engine: string
            autoTune: boolean
            scene?: {
              camera?: { preset: string }
              animation: unknown
              output?: typeof RENDER_SCENE.output
            }
          }
          const scene = input.scene
          return {
            decision:
              input.pieceId === piece.id &&
              input.baseVersion === piece.version &&
              input.engine === 'blender' &&
              !input.autoTune &&
              scene &&
              !scene.animation &&
              scene.camera?.preset === 'three-quarter' &&
              scene.output?.quality === 'preview' &&
              scene.output?.width === RENDER_SIZE &&
              scene.output.height === RENDER_SIZE
                ? 'approve'
                : 'deny',
          }
        },
      )
      assert.ok(approved.has('renders.create'), 'The Blender call did not pass the approval gate.')
      assert.equal(rendered.run.status, 'done', rendered.run.error ?? undefined)
      const call = latestTool<{ id: string }>(rendered, 'renders.create')
      const take = await api.call('renders.get', { id: call.value.id })
      report.blender = {
        ...report.blender,
        version: take.sourceVersion,
        jobId: take.id,
        device: take.device,
        seconds: take.seconds,
      }
      assert.ok(
        take.engine === 'blender' && take.status === 'done' && !take.stale,
        take.error ?? undefined,
      )
      assert.equal(take.sourceVersion, piece.version)
      assert.equal((await api.call('pieces.get', { id: piece.id })).version, piece.version)
      assert.ok(take.seconds && take.seconds > 0 && take.assetIds.length === 1)
      const png = await assetBytes(api, { url: `/api/assets/${take.assetIds[0]}` })
      const pngImage = sharp(png)
      const metadata = await pngImage.metadata()
      const stats = await pngImage.stats()
      assert.deepEqual(
        [metadata.format, metadata.width, metadata.height],
        ['png', RENDER_SIZE, RENDER_SIZE],
      )
      assert.ok(
        stats.channels[0]!.max - stats.channels[0]!.min > 40,
        'Blender returned a flat image.',
      )
      await writeFile(join(out, 'blender.png'), png)
      report.blender.file = 'blender.png'
      report.blender.status = 'passed'
    }
    report.status = 'passed'
  } catch (error) {
    report[stage].status = 'failed'
    report[stage].reason = error instanceof Error ? error.message : String(error)
  } finally {
    await s?.dispose()
    await model?.close()
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}
