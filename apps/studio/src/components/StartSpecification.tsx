import {
  FINISH_IDS,
  FINISHES,
  METAL_IDS,
  METALS,
  type Piece,
  type PieceSpec,
  RING_SIZE_SYSTEMS,
  TEMPLATES,
} from '@pave/schema'
import { Button, controlClass, Field, InlineError, NumberField, Textarea } from '@pave/ui'
import { useState } from 'react'
import { useRpcMutation } from '../lib/query'
import { activeOrg, useSession } from '../lib/session'

export function StartSpecification({ piece }: { piece: Piece }) {
  const role = activeOrg(useSession())?.role
  const [open, setOpen] = useState(false)
  const [construction, setConstruction] = useState('')
  const [alloy, setAlloy] = useState('')
  const [finish, setFinish] = useState('')
  const [size, setSize] = useState<number | null>(null)
  const [system, setSystem] = useState<NonNullable<PieceSpec['ring']>['size']['system']>('us')
  const [stones, setStones] = useState<'open' | 'none'>('open')
  const [notes, setNotes] = useState('')
  const save = useRpcMutation('pieces.setSpec', { meta: { silent: true } })
  const options = new Map(
    TEMPLATES.filter((template) => template.spec.kind === piece.kind).map(
      ({ spec }) => [spec.archetype, spec.title] as const,
    ),
  )
  options.set('custom', 'Custom')
  const archetype = [...options.keys()].find((id) => id === construction)
  const metal = METAL_IDS.find((id) => id === alloy)
  const surface = FINISH_IDS.find((id) => id === finish)
  const ring = piece.kind === 'ring'
  const body = piece.kind === 'pendant' || piece.kind === 'earrings'
  const canSave = Boolean(archetype && metal && surface) && !save.isPending

  function submit() {
    if (!archetype || !metal || !surface || save.isPending) return
    save.mutate({
      id: piece.id,
      spec: {
        kind: piece.kind,
        archetype,
        title: piece.title,
        summary: '',
        metal: { alloy: metal, finish: surface },
        ...(ring && size !== null ? { ring: { size: { system, value: size } } } : {}),
        ...(body && size !== null ? { body: { heightMm: size } } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        openQuestions: [
          ...(!ring && !body ? ['Confirm the overall dimensions.'] : []),
          ...(ring && size === null ? ['Confirm the ring size.'] : []),
          ...(body && size === null ? ['Confirm the overall height.'] : []),
          ...(stones === 'open' ? ['Decide which stones and settings to use.'] : []),
        ],
      },
    })
  }

  if (role === undefined || role === 'viewer' || role === 'guest') return null
  if (!open)
    return (
      <div className="px-4 pb-4">
        <Button size="sm" onClick={() => setOpen(true)}>
          Start specification
        </Button>
      </div>
    )
  return (
    <form
      aria-label="Start specification"
      className="space-y-3 border-t border-line px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Field label="Construction">
        {(id) => (
          <select
            id={id}
            className={controlClass}
            value={construction}
            onChange={(e) => setConstruction(e.target.value)}
          >
            <option value="">Choose construction</option>
            {[...options].map(([value, title]) => (
              <option value={value} key={value}>
                {title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Alloy">
          {(id) => (
            <select
              id={id}
              className={controlClass}
              value={alloy}
              onChange={(e) => setAlloy(e.target.value)}
            >
              <option value="">Choose alloy</option>
              {METAL_IDS.map((value) => (
                <option value={value} key={value}>
                  {METALS[value].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Finish">
          {(id) => (
            <select
              id={id}
              className={controlClass}
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
            >
              <option value="">Choose finish</option>
              {FINISH_IDS.map((value) => (
                <option value={value} key={value}>
                  {FINISHES[value].label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {ring && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Size system">
            {(id) => (
              <select
                id={id}
                className={controlClass}
                value={system}
                onChange={(e) => {
                  const next = RING_SIZE_SYSTEMS.find((s) => s === e.target.value)
                  if (next && next !== system) {
                    setSystem(next)
                    setSize(null)
                  }
                }}
              >
                {RING_SIZE_SYSTEMS.map((value) => (
                  <option value={value} key={value}>
                    {value === 'mm' ? 'mm diameter' : value.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <NumberField
            label="Ring size"
            value={size}
            onCommit={setSize}
            step={0.25}
            precision={2}
          />
        </div>
      )}
      {body && (
        <NumberField
          label="Overall height"
          unit="mm"
          value={size}
          onCommit={setSize}
          min={3}
          max={200}
        />
      )}
      <Field label="Stone plan">
        {(id) => (
          <select
            id={id}
            className={controlClass}
            value={stones}
            onChange={(e) => setStones(e.target.value === 'none' ? 'none' : 'open')}
          >
            <option value="open">Stones and settings undecided</option>
            <option value="none">No stones</option>
          </select>
        )}
      </Field>
      <Field label="Other constraints">
        {(id) => (
          <Textarea
            minRows={2}
            id={id}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>
      {save.error && <InlineError message={save.error.message} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!canSave}>
          {save.isPending ? 'Saving…' : 'Save specification'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
