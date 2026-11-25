/**
 * The docked placement's contract, read from the element tree Dialog returns (it uses no hooks,
 * and the package has no DOM test setup). The review found the docked Replace stone dialog
 * modal behind an invisible backdrop, so a drag to orbit the model closed it and threw away the
 * form; and with no height cap or scrolling body, its footer fell below a laptop-height window.
 */
import { Dialog as Base } from '@base-ui/react/dialog'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { Dialog, type DialogProps } from './dialog'

type Props = { children?: ReactNode; className?: string; style?: Record<string, unknown> }

/** Every element in the tree, depth first; components are not rendered, only walked. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Props>(node)) return []
  return [node, ...elements(node.props.children)]
}

const render = (props: Partial<DialogProps>) =>
  Dialog({ open: true, title: 'Replace stone', children: 'body', footer: 'footer', ...props })

const root = (props: Partial<DialogProps>) =>
  render(props) as ReactElement<{ modal?: boolean; disablePointerDismissal?: boolean }>

describe('Dialog placement="end"', () => {
  it('is not modal and has no backdrop, so the page keeps its pointer input', () => {
    const el = root({ placement: 'end' })
    expect(el.props.modal).toBe(false)
    expect(elements(el).some((e) => e.type === Base.Backdrop)).toBe(false)
  })

  it('does not close on a press outside it: a drag on the model is an orbit', () => {
    expect(root({ placement: 'end' }).props.disablePointerDismissal).toBe(true)
  })

  it('caps its height at the window and scrolls its body, with the footer outside the scroller', () => {
    const all = elements(render({ placement: 'end' }))
    const popup = all.find((e) => e.type === Base.Popup)!
    expect(popup.props.className).toMatch(/max-h-\[calc\(100dvh/)
    const scroller = all.find((e) => /overflow-y-auto/.test(e.props.className ?? ''))
    expect(scroller?.props.children).toBe('body')
    expect(popup.props.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ props: expect.objectContaining({ children: 'footer' }) }),
      ]),
    )
  })

  it('takes the place and height the caller docks it in', () => {
    const dock = { top: 137, right: 12, width: 360, height: 575 }
    const popup = elements(render({ placement: 'end', dock })).find((e) => e.type === Base.Popup)!
    expect(popup.props.style).toEqual(dock)
  })
})

describe('Dialog placement="center"', () => {
  it('stays modal with a backdrop', () => {
    const el = root({})
    expect(el.props.modal).toBe(true)
    expect(elements(el).some((e) => e.type === Base.Backdrop)).toBe(true)
  })
})
