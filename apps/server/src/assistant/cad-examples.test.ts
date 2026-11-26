import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { designChange } from '../db/schema'
import { BOOT_TIMEOUT, client, type TestServer, testServer } from '../test/harness'
import {
  CadExampleSchema,
  type CadExamplesCall,
  cadExamples,
  writeCadExamples,
} from './cad-examples'

let server: TestServer
beforeAll(async () => {
  server = await testServer()
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('exports only opted-in numeric CAD examples and walks older pages after an unrepresented edit', async () => {
  const api = client(server)
  const p = await api.call('pieces.create', {
    title: 'PRIVATE PROJECT TITLE',
    templateId: 'solitaire',
  })
  const edits = [
    { id: 'band', patch: { thicknessBottom: 1.87 } },
    { id: 'head', patch: { prongTipOffsetsMm: { '2': 0.25 } } },
    { id: 'band', patch: { name: 'PRIVATE DESIGNER NAME' } },
  ]
  for (const op of edits) {
    await api.call('design.apply', {
      pieceId: p.id,
      label: 'PRIVATE EDIT LABEL',
      ops: [{ t: 'update', ...op }],
    })
  }
  const collect = async (call = api.call) => {
    const rows = []
    for await (const row of cadExamples(call, p.id, 1)) rows.push(row)
    return rows
  }
  const reads: string[] = []
  await expect(
    collect((name, input) => {
      reads.push(name)
      return api.call(name, input)
    }),
  ).rejects.toThrow(/evaluation use/i)
  expect(reads).toEqual(['org.settings.get'])
  await api.call('org.settings.update', { allowEvalUse: true })
  const examples = await collect()
  expect(examples).toHaveLength(2)
  expect(examples[0]).toMatchObject({
    feature: 'setting',
    field: 'prongTipOffsetsMm',
    prong: 2,
    beforeMm: 0,
    afterMm: 0.25,
  })
  expect(examples[1]).toMatchObject({
    feature: 'ringShank',
    field: 'thicknessBottom',
    afterMm: 1.87,
    actor: 'user',
  })
  expect(JSON.stringify(examples)).not.toContain('PRIVATE')
  expect(JSON.stringify(examples)).not.toContain(p.id)
  await api.call('design.revert', { pieceId: p.id, seq: 2 })
  expect((await collect())[0]).toMatchObject({ beforeMm: 0.25, afterMm: 0, undo: true })
})

it('keeps the starting snapshot and skips edits with more than one target or field', async () => {
  const api = client(server)
  await api.call('org.settings.update', { allowEvalUse: true })
  const p = await api.call('pieces.create', { templateId: 'solitaire' })
  await api.call('design.apply', {
    pieceId: p.id,
    label: 'One band width',
    ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.45 } }],
  })
  await api.call('design.apply', {
    pieceId: p.id,
    label: 'Both band dimensions in one edit',
    ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.55, thicknessTop: 1.95 } }],
  })
  await api.call('design.apply', {
    pieceId: p.id,
    label: 'Two features in one edit',
    ops: [
      { t: 'update', id: 'band', patch: { widthTop: 2.65 } },
      { t: 'update', id: 'head', patch: { prongTipOffsetsMm: { '2': 0.25 } } },
    ],
  })
  await api.call('design.apply', {
    pieceId: p.id,
    label: 'Two prongs in one edit',
    ops: [{ t: 'update', id: 'head', patch: { prongTipOffsetsMm: { '1': 0.1, '2': 0.3 } } }],
  })

  let intervened = false
  const call: CadExamplesCall = async (name, input) => {
    if (name === 'design.history' && !intervened) {
      intervened = true
      await api.call('design.apply', {
        pieceId: p.id,
        label: 'A later edit',
        ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.75 } }],
      })
    }
    return api.call(name, input)
  }
  const examples = []
  for await (const example of cadExamples(call, p.id, 1)) examples.push(example)
  expect(examples).toEqual([
    {
      schemaVersion: 1,
      actor: 'user',
      undo: false,
      feature: 'ringShank',
      field: 'widthTop',
      beforeMm: expect.any(Number),
      afterMm: 2.45,
    },
  ])
})

it('discards staged rows if consent is revoked and never overwrites an export', async () => {
  const api = client(server)
  await api.call('org.settings.update', { allowEvalUse: true })
  const p = await api.call('pieces.create', { templateId: 'solitaire' })
  await api.call('design.apply', {
    pieceId: p.id,
    label: 'Private edit',
    ops: [{ t: 'update', id: 'band', patch: { thicknessTop: 1.91 } }],
  })
  const dir = await mkdtemp(join(tmpdir(), 'pave-examples-test-'))
  const output = join(dir, 'examples.jsonl')
  try {
    let settingsReads = 0
    const revoke: CadExamplesCall = async (name, input) => {
      if (name === 'org.settings.get' && ++settingsReads === 2)
        await api.call('org.settings.update', { allowEvalUse: false })
      return api.call(name, input)
    }
    await expect(writeCadExamples(revoke, p.id, output)).rejects.toThrow(/evaluation use/i)
    expect(await readdir(dir)).toEqual([])

    await api.call('org.settings.update', { allowEvalUse: true })
    expect(await writeCadExamples(api.call, p.id, output)).toBe(1)
    const data = await readFile(output, 'utf8')
    expect(CadExampleSchema.parse(JSON.parse(data))).toMatchObject({
      feature: 'ringShank',
      field: 'thicknessTop',
      afterMm: 1.91,
    })
    if (process.platform !== 'win32') expect((await stat(output)).mode & 0o777).toBe(0o600)
    await expect(writeCadExamples(api.call, p.id, output)).rejects.toThrow(/already exists/)
    expect(await readFile(output, 'utf8')).toBe(data)
    expect(await readdir(dir)).toEqual(['examples.jsonl'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('publishes no examples if the project history has a missing revision', async () => {
  const api = client(server)
  await api.call('org.settings.update', { allowEvalUse: true })
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  for (const widthBottom of [2.45, 2.55])
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Band width',
      ops: [{ t: 'update', id: 'band', patch: { widthBottom } }],
    })
  const ctx = await server.runtime.context(server.runtime.local!)
  await ctx.repo.changes.delete(
    and(eq(designChange.pieceId, piece.id), eq(designChange.seq, piece.version + 1))!,
  )
  const dir = await mkdtemp(join(tmpdir(), 'pave-incomplete-history-'))
  try {
    await expect(writeCadExamples(api.call, piece.id, join(dir, 'examples.jsonl'))).rejects.toThrow(
      /history is incomplete/i,
    )
    expect(await readdir(dir)).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
