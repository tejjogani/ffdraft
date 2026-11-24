import { applyOps, buildDesign, type Design, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createDesignSession } from '../../../lib/design-session/session'
import { createFieldEdit } from './edit'

const iced = buildDesign(TEMPLATES.find((t) => t.id === 'iced-initial')!.spec)
const bodyId = iced.order.find((id) => iced.nodes[id]!.kind === 'vectorBody')!

function sessionFor(design: Design) {
  return createDesignSession(
    'p1',
    { design, version: 0 },
    {
      // Never answers: the test looks at what the window recorded, not at the server.
      transport: {
        apply: () => new Promise(() => {}),
        history: async () => [],
        snapshot: async () => ({ design, version: 0 }),
      },
      classify: () => 'reject',
      describe: String,
    },
  )
}

describe('field edits', () => {
  it('records typed text as one change on blur, though the view already shows it', () => {
    const session = sessionFor(iced)
    const edit = () =>
      createFieldEdit(session.get().view.nodes[bodyId]!, session.get().view, session, false, null)
    // Typing previews each keystroke; the row then reads the previewed text back.
    for (const text of ['AQ', 'AQZ']) edit().preview(['source', 'text'], text)
    edit().commit(['source', 'text'], 'AQZ')
    const { pending, gesture } = session.get()
    expect(gesture).toBeNull()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.ops).toEqual([
      { t: 'update', id: bodyId, patch: { source: { text: 'AQZ' } } },
    ])
  })

  it('drops typed text on cancel', () => {
    const session = sessionFor(iced)
    const edit = createFieldEdit(iced.nodes[bodyId]!, iced, session, false, null)
    edit.preview(['source', 'text'], 'QQ')
    edit.cancel(['source', 'text'])
    expect(session.get().gesture).toBeNull()
    expect(session.get().view).toBe(session.get().settled)
    expect(session.get().pending).toHaveLength(0)
  })

  it('writes nothing for a viewer', () => {
    const session = sessionFor(iced)
    const edit = createFieldEdit(iced.nodes[bodyId]!, iced, session, true, null)
    edit.preview(['source', 'text'], 'QQ')
    edit.commit(['source', 'text'], 'QQ')
    expect(edit.switchVariant(['source'], 'svg')).toBeNull()
    expect(session.get().gesture).toBeNull()
    expect(session.get().pending).toHaveLength(0)
  })

  it('marks only the fields the assistant changed, down to the nested value', () => {
    const design = applyOps(iced, [
      { t: 'update', id: bodyId, patch: { source: { text: 'B' } } },
    ]).design
    const prior = { [bodyId]: { source: (iced.nodes[bodyId] as { source: unknown }).source } }
    const edit = createFieldEdit(design.nodes[bodyId]!, design, null, false, prior)
    expect(edit.prior(['source', 'text'])).toMatchObject({ changed: true })
    expect(edit.prior(['source', 'text']).label).toMatch(/A.*→.*B/)
    expect(edit.prior(['source', 'font'])).toEqual({ changed: false })
  })
})
