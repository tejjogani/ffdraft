/**
 * Markdown for the assistant's answers and briefs: paragraphs, headings, lists, quotes, code,
 * bold, italic, inline code and links. Never raw HTML: every piece of text becomes a React text
 * node, so a model's or a person's text cannot inject markup. Links open outside, and only
 * http(s) and mailto links are links at all.
 *
 * Blocks are memoised by their source, so while an answer streams only its last block re-renders.
 */
import { memo, type ReactNode } from 'react'
import { cn } from '../cn'

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }

/** Splits markdown into blocks. Exported for tests. */
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) body.push(lines[i++]!)
      i++ // the closing fence (or the end, while streaming)
      blocks.push({ t: 'code', text: body.join('\n') })
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ t: 'h', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! })
      i++
      continue
    }
    const bullet = /^\s*[-*•]\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const kind = bullet.test(line) ? 'ul' : 'ol'
      const re = kind === 'ul' ? bullet : numbered
      const items: string[] = []
      while (i < lines.length && lines[i]!.trim()) {
        const l = lines[i]!
        if (re.test(l)) items.push(l.replace(re, ''))
        else if (items.length) items[items.length - 1] += ` ${l.trim()}`
        i++
      }
      blocks.push({ t: kind, items })
      continue
    }
    if (line.startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>'))
        body.push(lines[i++]!.replace(/^>\s?/, ''))
      blocks.push({ t: 'quote', text: body.join(' ') })
      continue
    }
    const body: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,3})\s/.test(lines[i]!) &&
      !lines[i]!.trimStart().startsWith('```') &&
      !bullet.test(lines[i]!) &&
      !numbered.test(lines[i]!)
    )
      body.push(lines[i++]!)
    blocks.push({ t: 'p', text: body.join('\n') })
  }
  return blocks
}

const SAFE_URL = /^(https?:|mailto:)/i

/** Inline marks: `code`, **bold**, *italic* / _italic_, [text](url). */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}.${n++}`
    const s = m[0]
    if (m[1])
      out.push(
        <code key={k} className="rounded-xs bg-bg-muted px-1 py-px font-mono text-[0.9em]">
          {s.slice(1, -1)}
        </code>,
      )
    else if (m[2]) out.push(<strong key={k}>{inline(s.slice(2, -2), k)}</strong>)
    else if (m[3]) out.push(<em key={k}>{inline(s.slice(1, -1), k)}</em>)
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s)!
      out.push(
        SAFE_URL.test(url!) ? (
          <a key={k} href={url} target="_blank" rel="noreferrer noopener" className="underline">
            {label}
          </a>
        ) : (
          label
        ),
      )
    }
    last = m.index + s.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const BlockView = memo(
  function BlockView({ block }: { block: Block }) {
    switch (block.t) {
      case 'p':
        return <p className="whitespace-pre-wrap">{inline(block.text)}</p>
      case 'h':
        return (
          <p className={cn('font-medium', block.level === 1 ? 'text-base' : 'text-sm')}>
            {inline(block.text)}
          </p>
        )
      case 'ul':
      case 'ol': {
        const List = block.t
        return (
          <List
            className={cn(
              'flex flex-col gap-1 pl-5',
              block.t === 'ul' ? 'list-disc' : 'list-decimal',
            )}
          >
            {block.items.map((item, i) => (
              <li key={i}>{inline(item, `l${i}`)}</li>
            ))}
          </List>
        )
      }
      case 'quote':
        return (
          <blockquote className="border-l-2 border-line-strong pl-3 text-fg-muted">
            {inline(block.text)}
          </blockquote>
        )
      case 'code':
        return (
          <pre className="overflow-x-auto rounded-md bg-bg-muted p-3 font-mono text-xs leading-5">
            {block.text}
          </pre>
        )
    }
  },
  (a, b) => JSON.stringify(a.block) === JSON.stringify(b.block),
)

export function Markdown({ children, className }: { children: string; className?: string }) {
  const blocks = parseBlocks(children)
  return (
    <div className={cn('flex flex-col gap-2.5 text-sm leading-6', className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
}
