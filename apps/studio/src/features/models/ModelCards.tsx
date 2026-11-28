import { ADULT_AGE_RANGES, type BrandModel } from '@pave/schema'
import { Button, controlClass, Field, InlineError, Input, Textarea } from '@pave/ui'
import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { useRpcMutation } from '../../lib/query'

export function NewModel({
  onCreated,
  primary,
}: {
  onCreated?: (model: BrandModel) => void
  primary?: boolean
}) {
  const headingId = useId()
  const nameInput = useRef<HTMLInputElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [age, setAge] = useState<BrandModel['card']['ageRange']>('25-34')
  const [attested, setAttested] = useState(false)
  const create = useRpcMutation('models.create', { meta: { silent: true } })
  useEffect(() => {
    if (open) nameInput.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      createButton.current?.focus()
    }
  }, [open])
  if (!open)
    return (
      <Button
        ref={createButton}
        variant={primary ? 'primary' : 'secondary'}
        icon={Plus}
        onClick={() => {
          create.reset()
          restoreFocus.current = true
          setOpen(true)
        }}
      >
        Create model
      </Button>
    )
  return (
    <form
      aria-labelledby={headingId}
      className="grid w-full max-w-xl gap-4 rounded-xl border border-line bg-bg-subtle p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!attested || !name.trim() || !description.trim() || create.isPending) return
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
              setAge('25-34')
              setAttested(false)
              onCreated?.(model)
            },
          },
        )
      }}
    >
      <h3 id={headingId} className="studio-option">
        New model card
      </h3>
      <Field label="Model name">
        {(id) => (
          <Input
            id={id}
            ref={nameInput}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Appearance and styling">
        {(id) => (
          <Textarea
            id={id}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short curls, natural nails, a white linen shirt…"
          />
        )}
      </Field>
      <Field label="Age range">
        {(id) => (
          <select
            id={id}
            className={controlClass}
            value={age}
            onChange={(e) => setAge(e.target.value as typeof age)}
          >
            {ADULT_AGE_RANGES.map((range) => (
              <option key={range}>{range}</option>
            ))}
          </select>
        )}
      </Field>
      <label className="flex items-start gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          required
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          className="mt-1"
        />
        I created a fictional adult model. This description does not use a real person’s likeness.
      </label>
      {create.isError && <InlineError message={create.error.message} className="py-0" />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="submit"
          disabled={!attested || !name.trim() || !description.trim() || create.isPending}
        >
          {create.isPending ? 'Saving model card…' : 'Save model card'}
        </Button>
        <Button variant="ghost" disabled={create.isPending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ModelDetails({ model, onUse }: { model: BrandModel; onUse?: () => void }) {
  const update = useRpcMutation('models.update', { meta: { silent: true } })
  const approved = model.status === 'approved'
  return (
    <article className="grid min-w-0 gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="studio-option min-w-0 wrap-anywhere">{model.name}</h3>
        <p role="status" className="text-xs font-medium text-fg-muted">
          {approved ? 'Approved for shoots' : 'Draft model'}
        </p>
      </div>
      <p className="text-xs text-fg-muted">Ages {model.card.ageRange}</p>
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{model.card.description}</p>
      {model.portraits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {model.portraits.map((p) => (
            <img
              key={p.assetId}
              src={assetUrl(p.assetId, 160)}
              alt={`${model.name} · ${p.view}`}
              className="size-20 rounded-md object-cover"
            />
          ))}
        </div>
      )}
      {approved ? (
        onUse && (
          <Button variant="primary" className="justify-self-start" onClick={onUse}>
            Use model
          </Button>
        )
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-fg-muted">Approve this card to use the model in a shot.</p>
          <Button
            variant="primary"
            className="justify-self-start"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: model.id, status: 'approved' })}
          >
            {update.isPending ? 'Approving…' : 'Approve for shoots'}
          </Button>
          {update.isError && <InlineError message={update.error.message} className="py-0" />}
        </div>
      )}
    </article>
  )
}
