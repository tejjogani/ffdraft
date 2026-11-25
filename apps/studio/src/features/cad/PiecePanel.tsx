/**
 * The inspector with nothing selected: the piece itself — its type, what it weighs and what
 * stones it carries — and how to get going. Its figures are the readout's (see hud/figures):
 * exact once the production check has run on this version, marked "≈" until then.
 */
import {
  type Design,
  GEM_CUTS,
  type GemCutId,
  METALS,
  type MetalId,
  PIECE_KINDS,
  type Piece,
} from '@pave/schema'
import { ScrollArea, Select } from '@pave/ui'
import { MousePointerClick } from 'lucide-react'
import type { DesignSession } from '../../lib/design-session/store'
import { KIND_LABEL } from '../../lib/domain'
import { carats, grams, mm, plural } from '../../lib/format'
import type { PieceFigures } from './hud/figures'
import { setPieceKind } from './ops'

export function PiecePanel({
  piece,
  design,
  figures,
  session,
  readOnly,
}: {
  piece: Piece
  design: Design
  figures: PieceFigures | null
  session: DesignSession | null
  readOnly: boolean
}) {
  const r = figures?.report
  const approx = figures?.exact ? '' : '≈ '
  const size = r ? ([0, 1, 2] as const).map((i) => r.bounds.max[i] - r.bounds.min[i]) : null
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-4 pt-3.5 pb-3">
        <h2 className="truncate text-sm font-medium text-fg">{piece.title || 'Untitled'}</h2>
        <p className="mt-0.5 text-xs text-fg-subtle">The whole piece</p>
      </header>
      <ScrollArea className="flex-1">
        <section className="border-b border-line px-4 py-3">
          <div className="grid min-h-8 grid-cols-[minmax(0,40%)_minmax(0,1fr)] items-center gap-3">
            <span className="text-sm text-fg-muted">Type</span>
            <Select
              value={design.kind}
              disabled={readOnly || !session}
              aria-label="Piece type"
              options={PIECE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              onChange={(k) => session?.commit([setPieceKind(k)])}
              className="h-7 w-full"
            />
          </div>
        </section>
        {r && size && r.metals.length + r.stoneCount > 0 && (
          <section className="border-b border-line px-4 py-3">
            <h3 className="mb-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
              Facts
            </h3>
            <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {r.metals.map((m) => (
                <Fact
                  key={m.material}
                  label={m.material in METALS ? METALS[m.material as MetalId].label : m.material}
                >
                  {approx}
                  <Num>{grams(m.massG)}</Num>
                </Fact>
              ))}
              <Fact label="Size">
                <Num>{size.map((v) => v.toFixed(1)).join(' × ')}</Num> mm
              </Fact>
              {r.ringInnerDiameter !== undefined && (
                <Fact label="Finger">
                  ⌀ <Num>{mm(r.ringInnerDiameter)}</Num>
                </Fact>
              )}
              {r.stoneCount > 0 && (
                <Fact label="Stones">
                  <Num>{carats(r.caratTotal)}</Num> · {plural(r.stoneCount, 'stone')}
                </Fact>
              )}
            </dl>
            {r.lots.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {r.lots.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3 text-xs text-fg-muted">
                    <span className="truncate">
                      {l.count} × {GEM_CUTS[l.cut as GemCutId]?.label ?? l.cut} {mm(l.width)}
                    </span>
                    <span className="font-mono tabular">{carats(l.caratTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="flex gap-2.5 px-4 py-4 text-xs text-fg-muted">
          <MousePointerClick className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
          <p className="text-pretty">
            {design.order.length
              ? 'Click a part of the model or a feature in the list to change it. Drag a value’s name to scrub it; the model follows.'
              : 'Pick a way to start on the left; settings appear here.'}
          </p>
        </div>
      </ScrollArea>
    </div>
  )
}

/** Words in the interface face, digits in mono (as in the facts strip over the view). */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="truncate text-fg-muted">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </>
  )
}

const Num = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-xs tabular">{children}</span>
)
