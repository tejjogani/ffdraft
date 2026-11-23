/**
 * Shared recipe for every floating layer (menus, popovers, selects, palettes): frosted glass,
 * the pop shadow, 12 px radius and a 150 ms scale + fade from the trigger's origin.
 * Base UI sets `--transform-origin` and the starting/ending style attributes.
 */
export const floatingSurface =
  'glass shadow-pop rounded-lg text-fg outline-none origin-(--transform-origin) ' +
  'transition-[opacity,scale] duration-150 ease-out ' +
  'data-starting-style:opacity-0 data-starting-style:scale-[0.97] ' +
  'data-ending-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:duration-100'

/** A row inside a floating list: menu items, select options, palette results. */
export const floatingItem =
  'flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none ' +
  'data-highlighted:bg-bg-active data-disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted'

export const floatingLabel = 'px-2 pt-2 pb-1 text-2xs font-medium text-fg-subtle select-none'

export const floatingSeparator = '-mx-1 my-1 h-px bg-line'
