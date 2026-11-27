import { defaultRevolveOffset, type NodeOf, revolveProfileError } from '@pave/schema'
import { Button, Dialog, NumberField, Select } from '@pave/ui'
import { useState } from 'react'

type Axis = 'vertical' | 'horizontal'

export function RevolveDialog({
  source,
  onClose,
  onSave,
}: {
  source: NodeOf<'curve'>
  onClose(): void
  onSave(settings: { axis: Axis; axisOffset: number; angle: number }): void
}) {
  const [axis, setAxis] = useState<Axis>('vertical')
  const [offset, setOffset] = useState<number | null>(() =>
    defaultRevolveOffset(source, 'vertical'),
  )
  const [angle, setAngle] = useState<number | null>(360)
  const error =
    offset === null || angle === null
      ? 'Enter an offset and sweep angle.'
      : revolveProfileError(source, axis, offset)
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Revolve profile"
      description={`Turn this outline around an axis on the ${source.plane} plane. Editing the outline later will reshape the solid.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              if (!error && offset !== null && angle !== null)
                onSave({ axis, axisOffset: offset, angle })
            }}
          >
            Create solid
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[42%_1fr] items-center gap-3 text-sm">
        <span>Rotation axis</span>
        <Select
          aria-label="Rotation axis"
          value={axis}
          options={[
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ]}
          onChange={(a) => {
            setAxis(a)
            setOffset(defaultRevolveOffset(source, a))
          }}
        />
        <NumberField
          aria-label="Axis offset"
          rowLabel="Axis offset"
          value={offset}
          onChange={setOffset}
          min={-250}
          max={250}
          step={0.05}
          unit="mm"
        />
        <NumberField
          aria-label="Sweep angle"
          rowLabel="Sweep angle"
          value={angle}
          onChange={setAngle}
          min={1}
          max={360}
          step={1}
          unit="°"
        />
        {error && (
          <p role="alert" className="col-span-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
