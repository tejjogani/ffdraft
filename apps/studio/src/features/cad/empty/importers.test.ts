import { describe, expect, it } from 'vitest'
import {
  builtinNode,
  classifyImport,
  IMPORT_ACCEPT,
  meshNode,
  outlineNode,
  reliefNode,
  textNode,
} from './importers'

describe('classifying a dropped file', () => {
  it('goes by the extension, whatever its case', () => {
    expect(classifyImport('ring.stl')).toBe('mesh')
    expect(classifyImport('RING.STL')).toBe('mesh')
    expect(classifyImport('crest.final.SVG')).toBe('svg')
    expect(classifyImport('photo.jpeg')).toBe('image')
    expect(classifyImport('scan.3mf')).toBe('mesh')
  })

  it('refuses what it cannot read', () => {
    expect(classifyImport('notes.txt')).toBeNull()
    expect(classifyImport('README')).toBeNull()
    expect(classifyImport('')).toBeNull()
    expect(classifyImport('archive.stl.zip')).toBeNull()
  })

  it('refuses extensions that happen to be names every object has', () => {
    // `BY_EXTENSION['constructor']` is Object.prototype's: truthy, so the file was let through.
    for (const name of [
      'model.constructor',
      'a.toString',
      'b.valueOf',
      'c.__proto__',
      'hasOwnProperty',
    ])
      expect(classifyImport(name)).toBeNull()
  })

  it('accepts in the file dialog what it classifies, and STEP only to say it is planned', () => {
    const planned = new Set(['.step', '.stp'])
    for (const ext of IMPORT_ACCEPT.split(','))
      if (planned.has(ext)) expect(classifyImport(`file${ext}`)).toBeNull()
      else expect(classifyImport(`file${ext}`)).not.toBeNull()
  })
})

describe('the node an import becomes', () => {
  it('names it after the file, without the extension, within the name limit', () => {
    expect(meshNode('as_1', 'Lion head.v3.stl')).toMatchObject({
      kind: 'meshBody',
      name: 'Lion head.v3',
      source: { type: 'asset', assetId: 'as_1' },
    })
    expect(reliefNode('as_2', 'coin.png')).toMatchObject({ kind: 'relief', assetId: 'as_2' })
    expect(outlineNode('M0 0L1 1Z', `${'x'.repeat(200)}.svg`).name).toHaveLength(80)
    expect(meshNode('as_1', '.stl').name).toBeUndefined()
  })

  it('gives every import its own id', () => {
    expect(meshNode('as_1', 'a.stl').id).not.toBe(meshNode('as_1', 'a.stl').id)
  })

  it('makes built-in models and text', () => {
    expect(builtinNode('crown')).toMatchObject({
      name: 'Crown',
      source: { type: 'builtin', name: 'crown' },
    })
    expect(textNode('Tej')).toMatchObject({
      kind: 'vectorBody',
      name: 'Tej',
      source: { type: 'text', text: 'Tej' },
    })
  })
})
