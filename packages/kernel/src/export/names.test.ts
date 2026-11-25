/**
 * What a recipient's program has to cope with: object names taken from what a designer typed
 * (quotes, accents, pasted control characters, repeats) and selections that hold nothing.
 */
import { type Design, designFrom, emptyDesign } from '@pave/schema'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { loadRhino3dm } from './rhino3dm'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const blocks = (names: readonly string[]): Design =>
  designFrom(
    'other',
    names.map((name, i) => ({
      id: `n${i}`,
      kind: 'primitive' as const,
      name,
      shape: 'box' as const,
      size: [4, 4, 4] as [number, number, number],
      transform: {
        position: [10 * i, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: 1,
      },
    })),
  )

const modelXml = async (design: Design): Promise<string> =>
  new TextDecoder().decode(
    unzipSync((await kernel.export(design, '3mf')).bytes)['3D/3dmodel.model'],
  )

const xmlNames = (xml: string): string[] =>
  [...xml.matchAll(/<object id="\d+" type="model" name="([^"]*)"/g)].map((m) =>
    m[1]!
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  )

const rhinoNames = async (design: Design): Promise<Map<string, string>> => {
  const rhino = await loadRhino3dm()
  const doc = rhino.File3dm.fromByteArray((await kernel.export(design, '3dm')).bytes)
  const objects = doc.objects()
  const names = new Map<string, string>()
  for (let i = 0; i < objects.count; i++) {
    const attributes = objects.get(i).attributes()
    names.set(attributes.getUserString('nodeIds'), attributes.name)
  }
  return names
}

describe('object names in exported files', () => {
  it('numbers a repeated name past the names already taken', async () => {
    // "Block" twice and a part the designer already called "Block 2".
    const design = blocks(['Block', 'Block', 'Block 2'])
    const names = xmlNames(await modelXml(design))
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(3)
    expect([...names].sort()).toEqual(['Block', 'Block 2', 'Block 3'])
    const obj = new TextDecoder().decode((await kernel.export(design, 'obj')).bytes)
    const groups = [...obj.matchAll(/^g (.+)$/gm)].map((m) => m[1])
    expect(new Set(groups).size).toBe(3)
    expect(new Set((await rhinoNames(design)).values()).size).toBe(3)
  })

  it('keeps accents, quotes, CJK and emoji, and takes control characters out', async () => {
    const typed = [
      'Bague "d\'été" <A&B>',
      '石の指輪 💍',
      'Tab\there',
      'Line\nbreak',
      'Bell\u0007\u000b!',
    ]
    const clean = ['Bague "d\'été" <A&B>', '石の指輪 💍', 'Tab here', 'Line break', 'Bell !']
    const design = blocks(typed)

    // 3MF: XML 1.0 has no way to write U+0001–U+001F other than tab and line ends; one such
    // character in a name makes the whole model unreadable.
    const xml = await modelXml(design)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is what is looked for
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)).toBe(false)
    expect([...xmlNames(xml)].sort()).toEqual([...clean].sort())

    // 3DM: OpenNURBS drops a name with a control character in it altogether.
    const rhino = await rhinoNames(design)
    for (const [i, name] of clean.entries()) expect(rhino.get(`n${i}`), typed[i]).toBe(name)

    const obj = new TextDecoder().decode((await kernel.export(design, 'obj')).bytes)
    const groups = [...obj.matchAll(/^g (.+)$/gm)].map((m) => m[1])
    expect([...groups].sort()).toEqual(clean.map((n) => n.replace(/\s+/g, '_')).sort())
  })
})

describe('a selection with nothing in it', () => {
  it('is refused by every format, GLB and STEP included', async () => {
    const one = blocks(['Block'])
    for (const format of ['glb', 'stl', '3mf', 'obj', '3dm', 'step'] as const) {
      await expect(kernel.export(one, format, { only: ['nope'] }), format).rejects.toThrow(
        /Nothing/,
      )
      await expect(kernel.export(emptyDesign('ring'), format), format).rejects.toThrow(/Nothing/)
    }
  })
})
