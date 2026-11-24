import { ContextMenu as BaseContext } from '@base-ui/react/context-menu'
import { Menu as Base } from '@base-ui/react/menu'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../cn'
import { floatingItem, floatingLabel, floatingSeparator, floatingSurface } from './floating'
import { Kbd } from './kbd'

type Side = 'top' | 'bottom' | 'left' | 'right'
type Align = 'start' | 'center' | 'end'

export interface MenuProps {
  /** The trigger element; it receives the menu's props. */
  trigger: ReactElement
  children: ReactNode
  side?: Side
  align?: Align
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

const popupClass = (className?: string) =>
  cn(floatingSurface, 'min-w-52 max-h-(--available-height) overflow-y-auto p-1', className)

export function Menu({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  className,
}: MenuProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner side={side} align={align} sideOffset={6} className="z-50 outline-none">
          <Base.Popup className={popupClass(className)}>{children}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export interface ContextMenuProps {
  /** Menu items. */
  content: ReactNode
  /** The area that opens the menu on right-click / long-press. */
  children: ReactElement
}

export function ContextMenu({ content, children }: ContextMenuProps) {
  return (
    <BaseContext.Root>
      <BaseContext.Trigger render={children} />
      <BaseContext.Portal>
        <BaseContext.Positioner className="z-50 outline-none">
          <BaseContext.Popup className={popupClass()}>{content}</BaseContext.Popup>
        </BaseContext.Positioner>
      </BaseContext.Portal>
    </BaseContext.Root>
  )
}

export interface MenuItemProps {
  children: ReactNode
  icon?: LucideIcon
  /** Leading visual other than an icon, e.g. an avatar or swatch. */
  leading?: ReactNode
  shortcut?: string
  /** A second line under the label, e.g. what an export is for. The row grows to fit it. */
  description?: string
  /** A short tag at the end of the row, e.g. a file format. */
  tag?: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  /** Render as another element, e.g. a router link. */
  render?: ReactElement
}

export function MenuItem({
  children,
  icon: Icon,
  leading,
  shortcut,
  description,
  tag,
  onClick,
  disabled,
  danger,
  render,
}: MenuItemProps) {
  return (
    <Base.Item
      onClick={onClick}
      disabled={disabled}
      render={render}
      className={cn(
        floatingItem,
        description && 'h-auto min-h-7 items-start py-1.5 [&>svg]:mt-0.5',
        danger && 'text-danger [&_svg]:text-danger',
      )}
    >
      {Icon ? <Icon aria-hidden /> : leading}
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{children}</span>
          <span className="text-xs text-fg-subtle">{description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      )}
      {tag && <span className="shrink-0 pt-0.5 font-mono text-2xs text-fg-subtle">{tag}</span>}
      {shortcut && <Kbd shortcut={shortcut} />}
    </Base.Item>
  )
}

export function MenuSeparator() {
  return <Base.Separator className={floatingSeparator} />
}

export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Base.Group>
      {label && <Base.GroupLabel className={floatingLabel}>{label}</Base.GroupLabel>}
      {children}
    </Base.Group>
  )
}

export interface MenuSubProps {
  label: string
  icon?: LucideIcon
  children: ReactNode
}

export function MenuSub({ label, icon: Icon, children }: MenuSubProps) {
  return (
    <Base.SubmenuRoot>
      <Base.SubmenuTrigger className={cn(floatingItem, 'data-popup-open:bg-bg-active')}>
        {Icon && <Icon aria-hidden />}
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-3.5! text-fg-subtle!" aria-hidden />
      </Base.SubmenuTrigger>
      <Base.Portal>
        <Base.Positioner sideOffset={4} alignOffset={-4} className="z-50 outline-none">
          <Base.Popup className={popupClass('min-w-44')}>{children}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.SubmenuRoot>
  )
}

export interface MenuRadioGroupProps<V extends string> {
  value: V
  onChange: (value: V) => void
  children: ReactNode
}

export function MenuRadioGroup<V extends string>({
  value,
  onChange,
  children,
}: MenuRadioGroupProps<V>) {
  return (
    <Base.RadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
      {children}
    </Base.RadioGroup>
  )
}

export function MenuRadioItem({
  value,
  children,
  icon: Icon,
}: {
  value: string
  children: ReactNode
  icon?: LucideIcon
}) {
  return (
    <Base.RadioItem value={value} className={cn(floatingItem, 'pr-7 relative')}>
      {Icon && <Icon aria-hidden />}
      <span className="flex-1">{children}</span>
      <Base.RadioItemIndicator className="absolute right-2 flex">
        <Check aria-hidden />
      </Base.RadioItemIndicator>
    </Base.RadioItem>
  )
}
