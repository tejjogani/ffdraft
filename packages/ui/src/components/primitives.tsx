import { ScrollArea as BaseScroll } from '@base-ui/react/scroll-area'
import { Separator as BaseSeparator } from '@base-ui/react/separator'
import type { ReactNode } from 'react'
import { cn } from '../cn'

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-4 w-px',
        className,
      )}
    />
  )
}

export function ScrollArea({
  children,
  className,
  viewportClassName,
}: {
  children: ReactNode
  className?: string
  viewportClassName?: string
}) {
  return (
    <BaseScroll.Root className={cn('relative min-h-0 overflow-hidden', className)}>
      <BaseScroll.Viewport
        className={cn('size-full overscroll-contain outline-none', viewportClassName)}
      >
        {children}
      </BaseScroll.Viewport>
      <BaseScroll.Scrollbar
        orientation="vertical"
        className={cn(
          'm-0.5 flex w-1.5 justify-center rounded-full opacity-0 transition-opacity duration-180',
          'data-hovering:opacity-100 data-scrolling:opacity-100',
        )}
      >
        <BaseScroll.Thumb className="w-full rounded-full bg-fg-faint" />
      </BaseScroll.Scrollbar>
    </BaseScroll.Root>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-sm bg-bg-muted', className)} />
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      role="status"
      aria-label={label}
      className={cn('size-4 animate-spin text-fg-subtle', className)}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface SwatchProps {
  color: string
  /** Metals get a soft radial highlight; stones a facet glint. */
  kind?: 'metal' | 'gem' | 'flat'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  title?: string
}

const swatchSizes = { sm: 'size-2.5', md: 'size-3.5', lg: 'size-6' }

/** A colour dot for a metal or gem. The jewelry is the colour; this is where it shows. */
export function Swatch({ color, kind = 'flat', size = 'md', className, title }: SwatchProps) {
  const shading =
    kind === 'metal'
      ? 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75), rgba(255,255,255,0) 55%), linear-gradient(160deg, rgba(255,255,255,0.1), rgba(0,0,0,0.18))'
      : kind === 'gem'
        ? 'linear-gradient(135deg, rgba(255,255,255,0.65) 0 22%, rgba(255,255,255,0) 22% 60%, rgba(0,0,0,0.12) 60%)'
        : 'none'
  return (
    <span
      title={title}
      aria-hidden={!title}
      className={cn(
        'inline-block shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]',
        swatchSizes[size],
        className,
      )}
      style={{ backgroundColor: color, backgroundImage: shading }}
    />
  )
}
