import { Avatar as Base } from '@base-ui/react/avatar'
import { cn } from '../cn'

export interface AvatarProps {
  name: string
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Organisations get a rounded square; people a circle. */
  shape?: 'circle' | 'square'
  className?: string
}

const sizes = { xs: 'size-4 text-[8px]', sm: 'size-5 text-[9px]', md: 'size-6 text-2xs', lg: 'size-9 text-sm' }

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?'

export function Avatar({ name, src, size = 'md', shape = 'circle', className }: AvatarProps) {
  return (
    <Base.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-bg-inset font-medium text-fg-muted select-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-sm',
        sizes[size],
        className,
      )}
    >
      {src && <Base.Image src={src} alt="" className="size-full object-cover" />}
      <Base.Fallback>{initials(name)}</Base.Fallback>
    </Base.Root>
  )
}
