import { Tooltip as Base } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { Kbd } from './kbd'

export interface TooltipProps {
  content: ReactNode
  /** A shortcut in registry notation, e.g. "mod+k". */
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** The trigger element; it receives the tooltip's props. */
  children: ReactElement
}

/** Small, quick, solid ink label. Not glass: it is read at a glance and must be crisp. */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <Base.Root>
      <Base.Trigger delay={500} render={children} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={6} className="z-50">
          <Base.Popup
            className={
              'flex items-center gap-2 rounded-sm bg-ink px-2 py-1 text-xs text-ink-fg shadow-md ' +
              'origin-(--transform-origin) transition-[opacity,scale] duration-120 ease-out ' +
              'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:opacity-0 ' +
              'data-instant:transition-none'
            }
          >
            {content}
            {shortcut && <Kbd shortcut={shortcut} tone="inverse" />}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export const TooltipProvider = Base.Provider
