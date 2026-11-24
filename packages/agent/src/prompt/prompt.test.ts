import { NODE_KINDS, NODE_SCHEMAS, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
// The canon keeps its tables internal; the test reads them to hold the skill text to them.
import { PRONGS_BY_CUT } from '../../../canon/src/tables'
import { hash } from '../hash'
import { AGENT_TOOLS, toolDefs } from '../tools'
import { canonText, NODE_REFERENCE, PROMPT_HASH, renderContext, SYSTEM_BLOCKS } from './index'
import { CLAWS_BY_CUT } from './skills/stone'

const allText = SYSTEM_BLOCKS.join('\n')

describe('the frozen system prompt', () => {
  it('has a stable hash (snapshot) that covers the prompt and the tools', () => {
    expect(PROMPT_HASH).toBe(
      `prompt-${hash(JSON.stringify({ system: SYSTEM_BLOCKS, tools: toolDefs() }))}`,
    )
    expect({ hash: PROMPT_HASH, chars: SYSTEM_BLOCKS.map((b) => b.length) }).toMatchSnapshot()
  })

  it('holds nothing that varies by checkout, clock, user or piece', () => {
    expect(allText).not.toMatch(/\r/)
    expect(allText).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
    expect(allText).not.toMatch(/\b(pc|th|run|usr|asset)_[a-z0-9]{6,}/)
    expect(allText).not.toContain('undefined')
    expect(allText).not.toContain('[object Object]')
  })

  it('names only tools that exist', () => {
    const tools = new Set<string>(AGENT_TOOLS)
    const mentioned = new Set(
      [...allText.matchAll(/\b([a-z][a-z0-9]*\.[a-z][a-zA-Z]+)\b/g)]
        .map((m) => m[1]!)
        // Dotted words that are not commands: field paths of the node reference and canon ids.
        .filter((w) =>
          /^(collections|pieces|design|boards|references|freeform|mesh3d|scenes|renders|models|shots|production|viewport|ui|canon|org|threads|runs|traces|usage|session)\./.test(
            w,
          ),
        ),
    )
    expect(mentioned.size).toBeGreaterThan(8)
    for (const name of mentioned) expect(tools.has(name), name).toBe(true)
  })

  it('keeps the stone skill’s claw counts equal to the canon’s', () => {
    for (const [cut, [, typical]] of Object.entries(PRONGS_BY_CUT))
      expect(CLAWS_BY_CUT[cut as keyof typeof CLAWS_BY_CUT], cut).toBe(typical)
  })
})

describe('the node reference', () => {
  it('lists every node kind and every field', () => {
    for (const kind of NODE_KINDS) {
      expect(NODE_REFERENCE, kind).toContain(`## ${kind}:`)
      const section = NODE_REFERENCE.split(`## ${kind}:`)[1]!.split('\n## ')[0]!
      for (const key of Object.keys(NODE_SCHEMAS[kind].shape))
        if (!['id', 'kind', 'name', 'visible', 'transform'].includes(key))
          expect(section, `${kind}.${key}`).toMatch(new RegExp(`^\\s*- ${key}\\b`, 'm'))
    }
  })

  it('keeps ranges, defaults, references and conditions, and drops inspector metadata', () => {
    expect(NODE_REFERENCE).toContain('- widthTop: number 1–14 mm = 2.2')
    expect(NODE_REFERENCE).toContain('- gem (required): id of a gem node')
    expect(NODE_REFERENCE).toContain('only when shoulder is cathedral')
    expect(NODE_REFERENCE).not.toMatch(/widget|advanced|refKinds|\bstep\b/)
  })

  it('is stable (snapshot)', () => {
    expect(NODE_REFERENCE).toMatchSnapshot()
  })
})

describe('the context message', () => {
  it('renders the studio state, deterministically', () => {
    const ctx = {
      date: '2026-11-24',
      piece: {
        id: 'pc_1',
        title: 'Oval solitaire',
        kind: 'ring',
        stage: 'design',
        version: 7,
        archetype: 'solitaire',
        nodes: [
          { id: 'band', kind: 'ringShank', name: 'Band' },
          { id: 'center', kind: 'gem' },
        ],
      },
      selection: [{ nodeId: 'center', kind: 'gem' }],
      board: null,
      attachments: [{ assetId: 'as_9', name: 'ring.jpg', mime: 'image/jpeg' }],
      references: [{ id: 'rf_1', title: 'Pinterest ring', viewOnly: true }],
      designerEdits: [{ seq: 7, label: 'Band to 2 mm', by: 'Ada' }],
      canon: null,
    }
    const text = renderContext(ctx)
    expect(text).toBe(renderContext(structuredClone(ctx)))
    expect(text.startsWith('Context')).toBe(true)
    for (const s of ['pc_1', 'version 7', 'center (gem)', 'as_9', 'view only', 'v7 Band to 2 mm'])
      expect(text).toContain(s)
  })

  it('carries the canon slice of a piece', () => {
    const text = canonText({ spec: TEMPLATES.find((t) => t.id === 'solitaire')!.spec })
    expect(text).toMatch(/^# Canon /)
    expect(text).toContain('ringShank.widthTop')
  })
})
