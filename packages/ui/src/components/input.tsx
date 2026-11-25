import { type ComponentProps, useLayoutEffect, useRef } from 'react'
import { cn } from '../cn'

/** The shared look of single-line text controls. */
export const controlClass =
  'h-8 w-full min-w-0 rounded-sm bg-bg px-2.5 text-sm text-fg placeholder:text-fg-subtle ' +
  'shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow duration-120 ' +
  'hover:shadow-[inset_0_0_0_1px_var(--fg-faint)] ' +
  'focus-visible:shadow-[inset_0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)] focus-visible:outline-none ' +
  'disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_1px_var(--danger)]'

export interface InputProps extends ComponentProps<'input'> {
  /** Borderless until hovered or focused — for inline editing in documents and tables. */
  bare?: boolean
}

export function Input({ className, bare, ...props }: InputProps) {
  return (
    <input
      className={cn(
        bare
          ? 'w-full min-w-0 rounded-xs bg-transparent text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none'
          : controlClass,
        className,
      )}
      {...props}
    />
  )
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  bare?: boolean
  minRows?: number
}

/** A textarea that grows with its content. */
export function Textarea({
  className,
  bare,
  minRows = 2,
  onInput,
  ref: outer,
  ...props
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // The caller's ref (to focus it) and ours (to fit the height) both get the element.
  const setRef = (el: HTMLTextAreaElement | null) => {
    ref.current = el
    if (typeof outer === 'function') outer(el)
    else if (outer) outer.current = el
  }
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  // Re-fit whenever the value changes from outside (e.g. a server refresh).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the value is the trigger, not an input to `fit`
  useLayoutEffect(fit, [props.value])
  return (
    <textarea
      ref={setRef}
      rows={minRows}
      onInput={(e) => {
        fit()
        onInput?.(e)
      }}
      className={cn(
        'block w-full resize-none overflow-hidden text-sm text-fg placeholder:text-fg-subtle outline-none',
        bare
          ? 'bg-transparent focus-visible:outline-none'
          : cn(controlClass, 'h-auto py-1.5 leading-5'),
        className,
      )}
      {...props}
    />
  )
}
