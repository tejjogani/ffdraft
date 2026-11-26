import { describe, expect, it } from 'vitest'
import { buildRequest } from '../anthropic'
import { focusFor, guideFor } from './routing'

describe('one assistant with a focus for each turn', () => {
  it('keeps the same identity and selects system instructions by project task', () => {
    const cad = guideFor('cad'),
      render = guideFor('render'),
      ideas = guideFor('brainstorm')
    expect(cad.blocks[0]).toEqual(ideas.blocks[0])
    expect(cad.blocks).toContainEqual(expect.stringContaining('## Skill: a design from a photo'))
    expect(render.hash).not.toBe(cad.hash)
    expect(ideas.blocks.join('\n')).not.toContain('## Skill: a design from a photo')
    const req = buildRequest({ model: 'claude-opus-5-5', messages: [], guide: cad })
    expect(req.system).toEqual(
      cad.blocks.map((text, i) => ({
        type: 'text',
        text,
        ...(i === cad.blocks.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
    )
  })
  it('uses a deliberate job over the current page and keeps discovery in its own mode', () => {
    expect(focusFor({ mode: 'intake', piece: true, stage: 'design' })).toBe('commission')
    expect(focusFor({ mode: 'brainstorm', piece: true, stage: 'cad' })).toBe('brainstorm')
    expect(focusFor({ piece: true, stage: 'design', job: 'cad' })).toBe('cad')
    expect(focusFor({ piece: true })).toBe('project')
    expect(focusFor({ piece: false })).toBe('studio')
  })
})
