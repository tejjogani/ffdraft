/**
 * The live smoke test without a key: its checks on a run's trace, and its journeys end to end on
 * the real server (kernel workers, database, assistant loop) with scripted turns standing in for
 * Claude, so the harness the founder runs with a real key is itself tested. The refusal without a
 * key is checked by running the command line.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APIError } from '@anthropic-ai/sdk'
import { type PieceSpecInput, type Run, type Step, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { checkRun, runSmoke, smokeAnswers } from './smoke'
import { TestModel, text, tool } from './testing'

const run = (over: Partial<Run> = {}): Run => ({
  id: 'run_1',
  threadId: 'th_1',
  pieceId: null,
  userId: 'u_1',
  model: 'claude-opus-5-5',
  tier: 'standard',
  origin: 'studio',
  status: 'done',
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  startedAt: new Date(0).toISOString(),
  endedAt: new Date(0).toISOString(),
  error: null,
  errorCode: null,
  job: null,
  stage: null,
  ...over,
})

const modelStep = (index: number, cacheRead: number, output: unknown = {}): Step => ({
  id: `st_${index}`,
  runId: 'run_1',
  index,
  kind: 'model',
  name: 'claude-opus-5-5',
  toolCallId: null,
  status: 'done',
  input: {},
  output,
  isError: false,
  ms: 10,
  approval: null,
  usage: { input: 10, output: 10, cacheRead, cacheWrite: 0, costUsd: 0 },
  stopReason: 'end_turn',
  changeIds: [],
  startedAt: new Date(0).toISOString(),
})

describe('smokeAnswers', () => {
  const question = (id: string, options: [string, string][], defaults: string[]) => ({
    id,
    question: `${id}?`,
    options: options.map(([oid, label]) => ({ id: oid, label })),
    multiple: true,
    defaults,
  })

  it('keeps every default, as one press of Go', () => {
    const r = smokeAnswers({
      intro: 'x',
      questions: [
        question(
          'purpose',
          [
            ['product', 'Product page'],
            ['social', 'Social'],
          ],
          ['product'],
        ),
      ],
    })
    expect(r.answers).toEqual({})
    expect(r.line).toBe('answered 1 question with the defaults, as one press of Go')
  })

  it('answers stills only where it is offered, so the smoke render stays one quick take', () => {
    const r = smokeAnswers({
      intro: 'x',
      questions: [
        question(
          'aspects',
          [
            ['1x1', '1:1'],
            ['4x5', '4:5'],
          ],
          ['1x1'],
        ),
        question(
          'motion',
          [
            ['none', 'Stills only'],
            ['turntable', '360° turntable, 6 s'],
          ],
          ['turntable'],
        ),
        question(
          'anim',
          [
            ['spin', 'Turntable'],
            ['still', 'A still'],
          ],
          ['spin'],
        ),
      ],
    })
    expect(r.answers).toEqual({ motion: ['none'], anim: ['still'] })
    expect(r.line).toContain('motion? → Stills only')
  })

  it('reads nothing it does not understand', () => {
    expect(smokeAnswers(null).answers).toEqual({})
    expect(smokeAnswers({ questions: 'x' }).line).toContain('answered 0 questions')
  })
})

describe('checkRun', () => {
  it('passes a finished run whose second call read the cache', () => {
    const r = checkRun({ run: run(), steps: [modelStep(0, 0), modelStep(2, 30_000)] })
    expect(r.failures).toEqual([])
    expect(r.modelCalls).toBe(2)
    expect(r.notes.join()).toContain('30,000 tokens')
  })

  it('fails a second call that read nothing from the cache', () => {
    const r = checkRun({ run: run(), steps: [modelStep(0, 0), modelStep(2, 0)] })
    expect(r.failures).toEqual(['the second model call read nothing from the prompt cache'])
  })

  it('fails when the API dropped a replayed thinking block, and names it', () => {
    const dropped = { inputTransformations: [{ type: 'thinking_dropped', reason: 'x' }] }
    const r = checkRun({ run: run(), steps: [modelStep(0, 0), modelStep(2, 5, dropped)] })
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('thinking_dropped')
  })

  it('fails a run that did not finish, with its code and sentence', () => {
    const r = checkRun({
      run: run({ status: 'failed', errorCode: 'rate_limited', error: 'Claude is busy.' }),
      steps: [],
    })
    expect(r.failures).toEqual(['the run ended as failed (rate_limited): Claude is busy.'])
  })

  it('notes a call a fallback model answered', () => {
    const r = checkRun({
      run: run(),
      steps: [modelStep(0, 0, { servedBy: 'claude-opus-5', inputTransformations: [] })],
    })
    expect(r.failures).toEqual([])
    expect(r.notes.join()).toContain('claude-opus-5')
  })
})

const ring = (title: string, over: Partial<PieceSpecInput>): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'solitaire',
  title,
  summary: 'A ring.',
  style: ['classic'],
  metal: { alloy: 'au18k-yellow' },
  ring: { size: { system: 'us', value: 6 } },
  stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 4 }],
  ...over,
})

describe('the journeys, with scripted turns for Claude', () => {
  it('runs design, edit and render (skipped without Blender), approving what a run asks', async () => {
    const model = await new TestModel().start()
    const cached = { usage: { cache_read_input_tokens: 20_000, output_tokens: 50 } }
    model.push(
      // a. Try variants: it reads the piece, asks first, then proposes variants of the CAD.
      ({ pieceId }) => ({ content: [tool('pieces_get', { id: pieceId })] }),
      {
        ...cached,
        content: [
          tool('chat_ask', {
            intro: 'A ring for working hands; one thing before I propose directions.',
            questions: [
              {
                id: 'metal',
                question: 'Which metal?',
                options: [
                  { id: 'yellow', label: '18k yellow gold' },
                  { id: 'platinum', label: 'Platinum' },
                ],
                multiple: false,
                defaults: ['yellow'],
              },
            ],
          }),
        ],
      },
      ({ pieceId }) => ({
        ...cached,
        content: [
          tool('pieces_proposeDirections', {
            pieceId,
            directions: [
              {
                name: 'Low bezel',
                idea: 'A low bezel that never catches.',
                tradeOff: 'Shows less of the stone.',
                spec: ring('Low bezel', {
                  stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'bezel' }],
                }),
              },
              {
                name: 'Six claws',
                idea: 'Six low claws.',
                tradeOff: 'More claws to check.',
                spec: ring('Six claws', {
                  stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 6 }],
                }),
              },
            ],
          }),
        ],
      }),
      { ...cached, content: [text('Two directions: A protects the stone, B shows it.')] },
      // c. The edit: a rebuild that needs approval, then the change asked for.
      ({ pieceId }) => ({ content: [tool('pieces_buildFromSpec', { id: pieceId })] }),
      ({ pieceId }) => ({
        ...cached,
        content: [
          tool('design_apply', {
            pieceId,
            label: 'Wider band',
            ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.3, widthBottom: 2.3 } }],
          }),
        ],
      }),
      { ...cached, content: [text('The band is 0.3 mm wider.')] },
    )
    const lines: string[] = []
    const report = await runSmoke({
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000000000000-SMKE',
        PAVE_KERNEL_WORKERS: '1',
        // No Blender, whatever this machine has (nor a Blender chosen in its data folder).
        PAVE_DATA_DIR: join(tmpdir(), 'pave-smoke-test-no-data'),
        PAVE_PYTHON: join('/nonexistent', 'python'),
        PAVE_BLENDER: join('/nonexistent', 'blender'),
      },
      tier: 'standard',
      only: new Set(['design', 'edit', 'render']),
      model: model.factory,
      log: (l) => lines.push(l),
      runTimeoutMs: 120_000,
    })
    const [design, edit] = report.runs
    expect(design!.failures, JSON.stringify(design)).toEqual([])
    expect(design!.notes.join('\n')).toMatch(/direction A "Low bezel": [\d.]+ g, 1 stone/)
    expect(design!.notes.join('\n')).toContain('the design evaluates')
    expect(edit!.failures, JSON.stringify(edit)).toEqual([])
    expect(edit!.notes.join('\n')).toMatch(/design version \d+ → \d+/)
    expect(lines.join('\n')).toContain('approved pieces.buildFromSpec')
    // The job's question was answered with its default, as one press of Go, and the model read it.
    expect(lines.join('\n')).toContain('answered 1 question with the defaults, as one press of Go')
    const asked = model.requests[2]!.messages.at(-1)
    expect(JSON.stringify(asked)).toContain('18k yellow gold')
    expect(report.skipped.join()).toContain('Blender was not found')
    expect(report.ok).toBe(true)
    // Every request asked for the tier's model, with the key the run was given.
    expect(new Set(model.requests.map((r) => r.model))).toEqual(new Set(['claude-opus-5-5']))
  }, 240_000)
})

// With a key in apps/server/.env the command would really run (and spend), so the check is skipped.
const envFile = join(import.meta.dirname, '..', '..', '.env')
const keyInEnvFile =
  existsSync(envFile) && /^\s*ANTHROPIC_API_KEY\s*=\s*\S/m.test(readFileSync(envFile, 'utf8'))

describe('the photo journey, with scripted turns for Claude', () => {
  it('draws the photo with the kernel, takes it from the design board to CAD, and checks the piece', async () => {
    const model = await new TestModel().start()
    let attached = ''
    model.push(
      ({ params, pieceId }) => {
        // The photo reaches the model as an image block in the user turn, and the piece it was
        // taken to CAD from is the run's piece.
        const user = params.messages.findLast((m) => m.role === 'user')!
        attached = JSON.stringify(user.content)
        const spec = TEMPLATES.find((t) => t.id === 'solitaire')!.spec
        return { content: [tool('pieces_setSpec', { id: pieceId, spec })] }
      },
      ({ pieceId }) => ({
        usage: { cache_read_input_tokens: 20_000 },
        content: [tool('pieces_buildFromSpec', { id: pieceId })],
      }),
      {
        usage: { cache_read_input_tokens: 20_000 },
        content: [text('Built from the photo; the claw count is assumed.')],
      },
    )
    const report = await runSmoke({
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000000000000-SMKE',
        PAVE_KERNEL_WORKERS: '1',
      },
      tier: 'light',
      only: new Set(['photo', 'edit']),
      model: model.factory,
      runTimeoutMs: 120_000,
    })
    expect(attached).toContain('"type":"image"')
    const [photo] = report.runs
    expect(photo!.failures, JSON.stringify(photo)).toEqual([])
    expect(photo!.notes.join('\n')).toMatch(/the design has \d+ claws \(the photo shows 6\)/)
    expect(photo!.notes.join('\n')).toContain('the design evaluates')
    // The edit needs the design from (a), which was not run.
    expect(report.skipped).toEqual(['c. Edit: needs the design from (a)'])
    expect(model.requests[0]!.model).toBe('claude-sonnet-5-5')
  }, 240_000)
})

describe('a journey that fails', () => {
  it('is reported with the run’s code and sentence, and what depends on it is skipped', async () => {
    const model = await new TestModel().start()
    model.push({
      content: [],
      error: APIError.generate(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        'invalid x-api-key',
        new Headers(),
      ),
    })
    const report = await runSmoke({
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000000000000-SMKE',
        PAVE_KERNEL_WORKERS: '1',
      },
      tier: 'standard',
      only: new Set(['design', 'edit']),
      model: model.factory,
      runTimeoutMs: 60_000,
    })
    expect(report.ok).toBe(false)
    expect(report.runs).toHaveLength(1)
    expect(report.runs[0]!.failures.join()).toContain('the run ended as failed (provider_auth)')
    expect(report.skipped).toEqual(['c. Edit: needs the design from (a)'])
  }, 120_000)
})

describe('pnpm agent:smoke', () => {
  it.skipIf(keyInEnvFile)(
    'refuses to run without a key, says where to get one, and exits non-zero',
    () => {
      const env = { ...process.env }
      delete env.ANTHROPIC_API_KEY
      const r = spawnSync(
        process.execPath,
        ['--import', 'tsx', join(import.meta.dirname, '..', 'smoke-cli.ts')],
        { env, encoding: 'utf8', timeout: 60_000 },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('No Claude API key')
      expect(r.stdout).toContain('API keys page of the Claude Console')
    },
    90_000,
  )

  it('reports a key the API refuses, never prints it, and exits non-zero', async () => {
    const KEY = 'sk-ant-test-refused-0000000000000000000000000-ZQ9X'
    let auth = ''
    // A stand-in for Claude's API: the Models API answers 401, as it does for a bad key.
    const api = createServer((req, res) => {
      auth = String(req.headers.authorization ?? req.headers['x-api-key'] ?? '')
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
      )
    })
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
    const port = (api.address() as AddressInfo).port
    try {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', join(import.meta.dirname, '..', 'smoke-cli.ts')],
        {
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: KEY,
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          },
        },
      )
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      const code = await new Promise<number | null>((r) => child.on('exit', r))
      expect(code).toBe(1)
      expect(out).toContain('did not accept this key')
      expect(auth).toContain(KEY)
      expect(out).not.toContain(KEY)
      expect(out).not.toContain('ZQ9X')
    } finally {
      await new Promise((r) => api.close(r))
    }
  }, 90_000)
})
