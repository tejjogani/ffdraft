import type { PieceKind } from '@pave/schema'
import type { ReactNode } from 'react'

/**
 * Monochrome line drawings standing in for a piece until it has a rendered cover. Hairline
 * strokes (non-scaling) so they stay delicate at any size.
 */
export function KindGlyph({ kind, className }: { kind: PieceKind; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <g vectorEffect="non-scaling-stroke">{GLYPHS[kind]}</g>
    </svg>
  )
}

const ns = { vectorEffect: 'non-scaling-stroke' } as const

/** A brilliant seen from the side: crown, girdle, pavilion and a few facet lines. */
const brilliant = (cx: number, y: number, w: number) => {
  const h = w / 2
  const t = w * 0.28
  const crown = w * 0.24
  const pav = w * 0.48
  return (
    <>
      <path
        {...ns}
        d={`M${cx - h} ${y} L${cx - t} ${y - crown} H${cx + t} L${cx + h} ${y} L${cx} ${y + pav} Z`}
      />
      <path {...ns} d={`M${cx - h} ${y} H${cx + h}`} />
      <path
        {...ns}
        strokeOpacity={0.55}
        d={`M${cx - t} ${y - crown} L${cx - t * 0.5} ${y} L${cx} ${y + pav} L${cx + t * 0.5} ${y} L${cx + t} ${y - crown} M${cx} ${y - crown} L${cx - t * 0.5} ${y} M${cx} ${y - crown} L${cx + t * 0.5} ${y}`}
      />
    </>
  )
}

/** A brilliant seen from above: girdle circle, octagonal table, star facets. */
const topView = (cx: number, cy: number, r: number) => {
  const table = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i + Math.PI / 8
    return [cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52] as const
  })
  return (
    <>
      <circle {...ns} cx={cx} cy={cy} r={r} />
      <path
        {...ns}
        d={`M${table.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`}
      />
      <path
        {...ns}
        strokeOpacity={0.5}
        d={table
          .map(([x, y], i) => {
            const a = (Math.PI / 4) * i + Math.PI / 8
            return `M${x.toFixed(2)} ${y.toFixed(2)} L${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`
          })
          .join(' ')}
      />
    </>
  )
}

/** Points along a cubic Bézier, for strands of stones and links. */
const bezier = (p: number[][], n: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const u = 1 - t
    const [a, b, c, d] = p as [number[], number[], number[], number[]]
    return [0, 1].map(
      (k) => u * u * u * a[k]! + 3 * u * u * t * b[k]! + 3 * u * t * t * c[k]! + t * t * t * d[k]!,
    ) as [number, number]
  })

const GLYPHS: Record<PieceKind, ReactNode> = {
  ring: (
    <>
      <ellipse {...ns} cx="32" cy="42" rx="16" ry="6.5" />
      <path {...ns} strokeOpacity={0.55} d="M17.6 44.6c2.4 2.6 8 4.4 14.4 4.4s12-1.8 14.4-4.4" />
      <path {...ns} d="M28.4 35.6 27 27.4M35.6 35.6 37 27.4" />
      {brilliant(32, 26.5, 15)}
    </>
  ),
  pendant: (
    <>
      <path {...ns} strokeOpacity={0.55} d="M13 6c4 10 11 15.5 19 15.5S47 16 51 6" />
      <ellipse {...ns} cx="32" cy="24.2" rx="2" ry="2.8" />
      <path {...ns} d="M32 28c5.6 6 8.6 11 8.6 15.6a8.6 8.6 0 0 1-17.2 0C23.4 39 26.4 34 32 28Z" />
      <path {...ns} strokeOpacity={0.5} d="M32 32.5 27.4 43.4 32 49.4l4.6-6zM27.4 43.4h9.2" />
    </>
  ),
  earrings: (
    <>
      {topView(21, 30, 7.5)}
      {topView(43, 30, 7.5)}
      <path {...ns} strokeOpacity={0.45} d="M21 37.5v6M43 37.5v6" />
    </>
  ),
  bracelet: (
    <>
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2
        const depth = (Math.sin(a) + 1) / 2
        return (
          <circle
            key={i}
            {...ns}
            cx={(32 + Math.cos(a) * 19).toFixed(2)}
            cy={(34 + Math.sin(a) * 8).toFixed(2)}
            r={(1.5 + depth * 1.3).toFixed(2)}
            strokeOpacity={0.45 + depth * 0.55}
          />
        )
      })}
    </>
  ),
  necklace: (
    <>
      {bezier(
        [
          [12, 8],
          [14, 36],
          [24, 46],
          [32, 46],
        ],
        11,
      )
        .concat(
          bezier(
            [
              [32, 46],
              [40, 46],
              [50, 36],
              [52, 8],
            ],
            11,
          ).slice(1),
        )
        .map(([x, y], i, all) => {
          const mid = Math.abs(i - (all.length - 1) / 2) / ((all.length - 1) / 2)
          return (
            <circle
              key={i}
              {...ns}
              cx={x.toFixed(2)}
              cy={y.toFixed(2)}
              r={(2.4 - mid * 1.4).toFixed(2)}
            />
          )
        })}
    </>
  ),
  chain: (
    <>
      {[
        [17, 45, 4.2],
        [25.5, 37.5, 2.2],
        [34, 30, 4.2],
        [42.5, 22.5, 2.2],
        [51, 15, 4.2],
      ].map(([x, y, ry], i) => (
        <ellipse
          key={i}
          {...ns}
          cx={x}
          cy={y}
          rx="7.4"
          ry={ry}
          transform={`rotate(-41 ${x} ${y})`}
        />
      ))}
    </>
  ),
  brooch: (
    <>
      {topView(32, 32, 6)}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i
        return (
          <circle
            key={i}
            {...ns}
            cx={(32 + Math.cos(a) * 12.5).toFixed(2)}
            cy={(32 + Math.sin(a) * 12.5).toFixed(2)}
            r="3.6"
          />
        )
      })}
      <circle {...ns} strokeOpacity={0.4} cx="32" cy="32" r="18.5" />
    </>
  ),
  other: (
    <>
      <path {...ns} d="M24 14h16l6 6v24l-6 6H24l-6-6V20z" />
      <path {...ns} strokeOpacity={0.6} d="M27 20h10l3 3v18l-3 3H27l-3-3V23z" />
      <path
        {...ns}
        strokeOpacity={0.4}
        d="M24 14l3 6M40 14l-3 6M46 20l-6 3M46 44l-6-3M40 50l-3-6M24 50l3-6M18 44l6-3M18 20l6 3"
      />
    </>
  ),
}
