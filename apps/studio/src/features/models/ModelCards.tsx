import { ADULT_AGE_RANGES, type BrandModel } from '@pave/schema'
import { Button, Input, Textarea } from '@pave/ui'
import { useId, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { useRpcMutation } from '../../lib/query'

export function NewModel({ onCreated }: { onCreated?: (model: BrandModel) => void }) {
  const nameId = useId()
  const descriptionId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [age, setAge] = useState<BrandModel['card']['ageRange']>('25-34')
  const [attested, setAttested] = useState(false)
  const create = useRpcMutation('models.create')
  if (!open) return <Button onClick={() => setOpen(true)}>Create a model card</Button>
  return (
    <form
      className="grid max-w-xl gap-4 rounded-xl border border-line-strong p-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!attested || !name.trim() || !description.trim()) return
        create.mutate(
          {
            name: name.trim(),
            attestedSynthetic: true,
            card: {
              description: description.trim(),
              ageRange: age,
              skinTone: '',
              hair: '',
              build: '',
              styling: '',
              ringSizeUs: null,
              wristMm: null,
              neckMm: null,
            },
          },
          {
            onSuccess: (model) => {
              setOpen(false)
              setName('')
              setDescription('')
              setAttested(false)
              onCreated?.(model)
            },
          },
        )
      }}
    >
      <h3 className="text-xl font-semibold">New synthetic model</h3>
      <label htmlFor={nameId} className="grid gap-1 text-base font-medium">
        Model name
        <Input
          id={nameId}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label htmlFor={descriptionId} className="grid gap-1 text-base font-medium">
        Appearance and styling
        <Textarea
          id={descriptionId}
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short curls, natural nails, a white linen shirt…"
        />
      </label>
      <label className="grid gap-1 text-base font-medium">
        Age range
        <select
          className="rounded-md border border-line bg-bg p-2"
          value={age}
          onChange={(e) => setAge(e.target.value as typeof age)}
        >
          {ADULT_AGE_RANGES.map((range) => (
            <option key={range}>{range}</option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2 text-base">
        <input
          type="checkbox"
          required
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          className="mt-1"
        />
        I created a fictional adult model. This description does not use a real person’s likeness.
      </label>
      <div className="flex gap-2">
        <Button
          variant="primary"
          type="submit"
          disabled={!attested || !name.trim() || !description.trim() || create.isPending}
        >
          Save model card
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  )
}

export function ModelDetails({ model }: { model: BrandModel }) {
  const update = useRpcMutation('models.update')
  return (
    <article className="grid gap-3 rounded-lg border border-line p-4">
      <div>
        <h3 className="studio-option">{model.name}</h3>
        <p className="text-sm text-fg-muted">
          Ages {model.card.ageRange} ·{' '}
          {model.status === 'approved' ? 'Approved for shoots' : 'Draft model'}
        </p>
      </div>
      <p className="text-base">{model.card.description}</p>
      {model.portraits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {model.portraits.map((p) => (
            <img
              key={p.assetId}
              src={assetUrl(p.assetId, 160)}
              alt={model.name + ' · ' + p.view}
              className="size-20 rounded-md object-cover"
            />
          ))}
        </div>
      )}
      {model.status === 'draft' && (
        <Button
          className="justify-self-start"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: model.id, status: 'approved' })}
        >
          Approve model for shoots
        </Button>
      )}
    </article>
  )
}
