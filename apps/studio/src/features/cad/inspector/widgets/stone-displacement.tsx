import { MAX_STONE_OFFSET_MM } from '@pave/schema'
import { Button, Input } from '@pave/ui'
import { useId } from 'react'

type Displacement = [number, number, number]
const AXES = ['X', 'Y', 'Z'] as const
const ZERO: Displacement = [0, 0, 0]

export function StoneDisplacement({
  saved,
  disabled,
  onSave,
}: {
  saved: Displacement | undefined
  disabled: boolean
  onSave(value: Displacement | null): void
}) {
  const offset = saved ?? ZERO
  const id = useId()
  return (
    <form
      key={offset.join(',')}
      aria-label="Stone displacement"
      className="flex flex-col gap-2 border-b border-line px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled) return
        const data = new FormData(event.currentTarget)
        const next: Displacement = [
          Number(data.get('X')),
          Number(data.get('Y')),
          Number(data.get('Z')),
        ]
        if (next.every((value, axis) => value === offset[axis])) return
        onSave(next.every((value) => value === 0) ? null : next)
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-fg">Stone displacement</h3>
        <span className="text-xs text-fg-muted">Model axes · mm</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {AXES.map((axis, i) => (
          <label
            key={axis}
            htmlFor={`${id}-${axis}`}
            className="flex min-w-0 flex-col gap-1 text-xs text-fg-muted"
          >
            {axis}
            <Input
              id={`${id}-${axis}`}
              aria-label={`Stone displacement ${axis} in millimetres`}
              name={axis}
              type="number"
              inputMode="decimal"
              min={-MAX_STONE_OFFSET_MM}
              max={MAX_STONE_OFFSET_MM}
              step="any"
              required
              defaultValue={offset[i]}
              disabled={disabled}
              className="h-7 px-2 font-mono text-xs tabular"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        Offset from the generated position. Seats and shared metal stay in place.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={disabled}>
          Apply displacement
        </Button>
        <Button size="sm" type="button" disabled={disabled || !saved} onClick={() => onSave(null)}>
          Reset position
        </Button>
      </div>
    </form>
  )
}
