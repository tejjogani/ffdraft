import { ContextMenu as BaseContext } from '@base-ui/react/context-menu'
import { Menu as Base } from '@base-ui/react/menu'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
} from 'react'
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

/**
 * The keys that open the context menu of whatever has the keyboard: Shift+F10 everywhere and
 * the Menu key where the keyboard has one. macOS sends no `contextmenu` for either, so menus
 * listen for the keys themselves.
 */
export const isMenuKey = (e: { key: string; shiftKey: boolean }): boolean =>
  e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')

export interface ContextMenuHandle {
  /** Opens the menu at a point in client coordinates, as a right-click there would. */
  openAt(x: number, y: number): void
}

export interface ContextMenuProps {
  /** Menu items. */
  content: ReactNode
  /** The area that opens the menu on right-click / long-press / Shift+F10. */
  children: ReactElement
  /**
   * For a menu opened by something other than a plain right-click on `children`: a 3D view
   * opens it only for a click without movement, since right-drag pans there.
   */
  handle?: Ref<ContextMenuHandle>
  onOpenChange?: (open: boolean) => void
}

/** A keyboard open followed by the platform's own `contextmenu` within this is one open. */
const KEYBOARD_ECHO_MS = 800

/**
 * Base UI opens a context menu on its trigger's `contextmenu` and anchors it at the event's
 * coordinates, so every way of opening (keys, a click on a canvas) goes through that one path.
 */
const openAt = (target: EventTarget | null, x: number, y: number) =>
  target?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  )

export function ContextMenu({ content, children, handle, onOpenChange }: ContextMenuProps) {
  const trigger = useRef<HTMLDivElement>(null)
  const keyboardAt = useRef(-Infinity)
  useImperativeHandle(handle, () => ({ openAt: (x, y) => openAt(trigger.current, x, y) }), [])
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || !isMenuKey(e)) return
    e.preventDefault()
    keyboardAt.current = performance.now()
    // Under the start of the focused element, where a pointer would not cover its label.
    const r = (e.target as HTMLElement).getBoundingClientRect()
    openAt(e.target, r.left + Math.min(24, r.width / 2), r.bottom)
  }
  return (
    <BaseContext.Root onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      <BaseContext.Trigger
        ref={trigger}
        render={children}
        onKeyDown={onKeyDown}
        onContextMenuCapture={(e) => {
          // Windows and Linux follow Shift+F10 with a `contextmenu` of their own.
          if (
            e.nativeEvent.isTrusted &&
            performance.now() - keyboardAt.current < KEYBOARD_ECHO_MS
          ) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      />
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
        // A disabled row's second line is often the reason it is disabled: it stays legible
        // while the label and icon fade.
        description &&
          'group/item h-auto min-h-7 items-start py-1.5 data-disabled:opacity-100 [&>svg]:mt-0.5',
        danger && 'text-danger [&_svg]:text-danger',
      )}
    >
      {Icon ? (
        <Icon aria-hidden className={description && 'group-data-disabled/item:opacity-40'} />
      ) : leading && description ? (
        <span className="flex shrink-0 group-data-disabled/item:opacity-40">{leading}</span>
      ) : (
        leading
      )}
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate group-data-disabled/item:opacity-40">{children}</span>
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
  /** A second line under the label, as on `MenuItem` (the current metal, say). */
  description?: string
  children: ReactNode
}

export function MenuSub({ label, icon: Icon, description, children }: MenuSubProps) {
  return (
    <Base.SubmenuRoot>
      <Base.SubmenuTrigger
        className={cn(
          floatingItem,
          'data-popup-open:bg-bg-active',
          description && 'h-auto min-h-7 items-start py-1.5 [&>svg]:mt-0.5',
        )}
      >
        {Icon && <Icon aria-hidden />}
        {description ? (
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate">{label}</span>
            <span className="text-xs text-fg-subtle">{description}</span>
          </span>
        ) : (
          <span className="flex-1">{label}</span>
        )}
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
  leading,
  closeOnClick,
}: {
  value: string
  children: ReactNode
  icon?: LucideIcon
  /** Leading visual other than an icon, e.g. a metal swatch. */
  leading?: ReactNode
  /** Close the menu on choosing, for a choice that is an edit rather than a view setting. */
  closeOnClick?: boolean
}) {
  return (
    <Base.RadioItem
      value={value}
      closeOnClick={closeOnClick}
      className={cn(floatingItem, 'pr-7 relative')}
    >
      {Icon ? <Icon aria-hidden /> : leading}
      <span className="flex-1">{children}</span>
      <Base.RadioItemIndicator className="absolute right-2 flex">
        <Check aria-hidden />
      </Base.RadioItemIndicator>
    </Base.RadioItem>
  )
}
