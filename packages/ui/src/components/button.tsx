import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../cn'
import { Tooltip } from './tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm text-sm font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,color,box-shadow,opacity] duration-120 ease-out ' +
  'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-ink-fg hover:opacity-88 active:opacity-80 shadow-sm',
  secondary:
    'bg-bg text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-bg-subtle active:bg-bg-muted [&_svg]:text-fg-muted',
  ghost: 'text-fg-muted hover:bg-bg-hover hover:text-fg active:bg-bg-active',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5',
  md: 'h-8 px-3',
}

/** Classes for anything that should look like a button (e.g. router links). */
export const buttonClass = ({
  variant = 'secondary',
  size = 'md',
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string =>
  cn(base, variants[variant], sizes[size])

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  /** Trailing content such as a <Kbd/>. */
  trailing?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  trailing,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={cn(buttonClass({ variant, size }), className)} {...props}>
      {Icon && <Icon aria-hidden />}
      {children}
      {trailing}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: LucideIcon
  /** Accessible name, also shown as the tooltip. */
  label: string
  shortcut?: string
  size?: ButtonSize
  /** Rendered pressed (e.g. a toggled panel). */
  active?: boolean
  tooltip?: boolean
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  size = 'md',
  active,
  tooltip = true,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-subtle select-none',
        'transition-colors duration-120 ease-out hover:bg-bg-hover hover:text-fg active:bg-bg-active',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
        size === 'sm' ? 'size-6' : 'size-7',
        active && 'bg-bg-active text-fg',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden />
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  )
}
