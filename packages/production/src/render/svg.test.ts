import { describe, expect, it } from 'vitest'
import type { Sheet } from '../drawing/model'
import { escapeXml, sheetToSvg } from './svg'

/** Characters XML 1.0 forbids anywhere in a document, escaped or not. */
const forbidden = (s: string) =>
  [...s].filter((ch) => {
    const c = ch.codePointAt(0)!
    return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff
  })

describe('SVG text', () => {
  it('escapes markup', () => {
    expect(escapeXml(`<b a="1" c='2'>&</b>`)).toBe(
      '&lt;b a=&quot;1&quot; c=&apos;2&apos;&gt;&amp;&lt;/b&gt;',
    )
  })

  it('drops the control characters that would make the file unreadable', () => {
    // A piece title pasted with a backspace, a NUL or a form feed: one such character anywhere
    // and no browser, Illustrator or Rhino opens the drawing.
    const title = 'Ring\u0008 \u0000one\u000b\u000c\u001f￾￿'
    expect(escapeXml(title)).toBe('Ring one')
    // Tabs and line breaks are legal XML and stay.
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd')
    const sheet: Sheet = {
      width: 100,
      height: 50,
      items: [{ t: 'text', x: 1, y: 2, text: title, style: { size: 8 } }],
    }
    const svg = sheetToSvg(sheet, title)
    expect(forbidden(svg)).toEqual([])
    expect(svg).toContain('<title>Ring one</title>')
    expect(svg).toContain('>Ring one</text>')
  })
})
