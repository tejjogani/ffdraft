/**
 * A gem cut as a line drawing of its girdle outline seen from above, length upright, with a hint
 * of its facets (a brilliant's diagonals, a step cut's inner table) so cuts that share an
 * outline (princess and asscher, emerald and radiant) still read apart at 24 px.
 */
import type { GemCutId } from '@pave/schema'
import { cn } from '@pave/ui'

/** [outline, facet hint] in a 16 × 16 box. */
const PATHS: Record<GemCutId, [string, string]> = {
  round: ['M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2Z', 'M8 5.2 10.8 8 8 10.8 5.2 8Z'],
  oval: [
    'M8 1.5c2.6 0 4.4 2.9 4.4 6.5S10.6 14.5 8 14.5 3.6 11.6 3.6 8 5.4 1.5 8 1.5Z',
    'M8 4.6 10 8 8 11.4 6 8Z',
  ],
  princess: ['M2.5 2.5h11v11h-11Z', 'M2.5 2.5l11 11M13.5 2.5l-11 11'],
  emerald: ['M5.5 1.5h5l2 2v9l-2 2h-5l-2-2v-9Z', 'M6.5 4h3l.8.8v6.4l-.8.8h-3l-.8-.8V4.8Z'],
  asscher: [
    'M5.3 2h5.4L14 5.3v5.4L10.7 14H5.3L2 10.7V5.3Z',
    'M6.4 4.6h3.2l1.8 1.8v3.2l-1.8 1.8H6.4L4.6 9.6V6.4Z',
  ],
  cushion: [
    'M5.5 2h5C12.7 2 14 3.3 14 5.5v5c0 2.2-1.3 3.5-3.5 3.5h-5C3.3 14 2 12.7 2 10.5v-5C2 3.3 3.3 2 5.5 2Z',
    'M8 4.5 11.5 8 8 11.5 4.5 8Z',
  ],
  radiant: [
    'M4.8 1.5h6.4l1.3 1.3v10.4l-1.3 1.3H4.8l-1.3-1.3V2.8Z',
    'M3.5 2.8l9 10.4M12.5 2.8l-9 10.4',
  ],
  marquise: [
    'M8 1.2C11.4 4.2 12.6 6 12.6 8S11.4 11.8 8 14.8C4.6 11.8 3.4 10 3.4 8S4.6 4.2 8 1.2Z',
    'M8 4.5v7',
  ],
  pear: [
    'M8 1.5c2.3 2.7 4.7 5.3 4.7 8.1a4.7 4.7 0 0 1-9.4 0c0-2.8 2.4-5.4 4.7-8.1Z',
    'M8 5.5 9.9 9.8 8 12 6.1 9.8Z',
  ],
  heart: [
    'M8 14C5 11.6 2 9.2 2 6.1 2 4 3.6 2.5 5.3 2.5c1.2 0 2.2.6 2.7 1.6.5-1 1.5-1.6 2.7-1.6C12.4 2.5 14 4 14 6.1c0 3.1-3 5.5-6 7.9Z',
    'M8 6v5',
  ],
  baguette: ['M5.2 1.5h5.6v13H5.2Z', 'M6.8 3.5h2.4v9H6.8Z'],
  trillion: [
    'M8 2.2c.4 0 6.2 10.4 6 10.9-.2.4-11.8.4-12 0C1.8 12.6 7.6 2.2 8 2.2Z',
    'M8 2.2v6.2l6 4.7M8 8.4l-6 4.7',
  ],
  cabochon: [
    'M8 1.5c2.6 0 4.4 2.9 4.4 6.5S10.6 14.5 8 14.5 3.6 11.6 3.6 8 5.4 1.5 8 1.5Z',
    'M6 5.2c.4-.8 1-1.3 1.7-1.5',
  ],
}

export function CutIcon({ cut, className }: { cut: GemCutId; className?: string }) {
  const [outline, facets] = PATHS[cut]
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
    >
      <path d={outline} strokeWidth={1.2} />
      <path d={facets} strokeWidth={0.8} opacity={0.55} />
    </svg>
  )
}
