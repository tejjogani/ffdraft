/** The .pave contract: which names a file may hold, and how older design documents are read. */
import { describe, expect, it } from 'vitest'
import {
  buildDesign,
  DESIGN_VERSION,
  DesignVersionError,
  isPaveEntryName,
  parseDesignDocument,
  TEMPLATES,
} from './index'

describe('isPaveEntryName', () => {
  it('allows the fixed entries, content-addressed assets and thumbnails only', () => {
    for (const name of [
      'mimetype',
      'manifest.json',
      'checksum.sha256',
      'piece.json',
      'history.json',
      'geometry/exact.step',
      'geometry/display.glb',
      `assets/${'a'.repeat(64)}.png`,
      'thumbnails/cover.webp',
    ])
      expect(isPaveEntryName(name), name).toBe(true)
    for (const name of [
      '../piece.json',
      '/piece.json',
      'C:/piece.json',
      'assets\\x.png',
      `assets/../${'a'.repeat(64)}.png`,
      `assets/${'a'.repeat(63)}.png`,
      `assets/${'A'.repeat(64)}.png`,
      'thumbnails/../../etc/passwd',
      '.hidden',
      'piece.json/',
      'geometry/exact.stp',
      '',
    ])
      expect(isPaveEntryName(name), name).toBe(false)
  })
})

describe('parseDesignDocument', () => {
  const design = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)

  it('reads today’s documents unchanged', () => {
    expect(parseDesignDocument(structuredClone(design))).toEqual(design)
  })

  it('brings a document from before versions existed up to today’s, filling new fields', () => {
    const old = structuredClone(design) as Record<string, unknown> & typeof design
    delete (old as { schemaVersion?: number }).schemaVersion
    const shank = Object.values(old.nodes).find((n) => n.kind === 'ringShank')!
    delete (shank as { baseShape?: string }).baseShape
    const migrated = parseDesignDocument(old)
    expect(migrated.schemaVersion).toBe(DESIGN_VERSION)
    expect((migrated.nodes[shank.id] as { baseShape: string }).baseShape).toBe('round')
  })

  it('refuses a newer document, a broken one and one that is not a design', () => {
    expect(() => parseDesignDocument({ ...design, schemaVersion: DESIGN_VERSION + 1 })).toThrow(
      /newer version of Pavé/,
    )
    expect(() =>
      parseDesignDocument({ ...design, order: [...design.order, design.order[0]] }),
    ).toThrow(/exactly once/)
    const [first] = design.order
    expect(() =>
      parseDesignDocument({ ...design, nodes: { ...design.nodes, other: design.nodes[first!] } }),
    ).toThrow(DesignVersionError)
    expect(() => parseDesignDocument('ring')).toThrow(/not an object/)
    expect(() => parseDesignDocument({ ...design, schemaVersion: 'one' })).toThrow(
      /unreadable version/,
    )
  })
})
