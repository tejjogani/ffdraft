import type { Design } from '@pave/schema'
import { Button, Checkbox, Dialog, IconButton, Select } from '@pave/ui'
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  MAX_SECTIONS,
  type SectionDraft,
  type SectionTool,
  sectionCurveOptions,
  sectionDraftProblem,
} from './section-model'

export function SectionFeatureDialog({
  design,
  tool,
  initial,
  editing,
  onClose,
  onSave,
}: {
  design: Design
  tool: SectionTool
  initial: SectionDraft
  editing: boolean
  onClose(): void
  onSave(draft: SectionDraft, signal: AbortSignal): Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const ruledId = useId()
  const options = sectionCurveOptions(design)
  const problem = sectionDraftProblem(design, tool, draft)
  const used = new Set([...draft.rails, ...draft.sections])
  const available = (value: string) =>
    options.filter((option) => option.value === value || !used.has(option.value))
  const change = (patch: Partial<SectionDraft>) => {
    setDraft({ ...draft, ...patch })
    setError('')
  }
  const choose = (role: 'sections' | 'rails', index: number, id: string) =>
    change({ [role]: draft[role].map((value, i) => (i === index ? id : value)) })
  const move = (index: number, offset: number) => {
    const sections = [...draft.sections]
    const moved = sections[index]!
    sections[index] = sections[index + offset]!
    sections[index + offset] = moved
    change({ sections })
  }
  const close = () => {
    pending.current?.abort()
    onClose()
  }
  const save = async () => {
    if (problem || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setError('')
    setSaving(true)
    try {
      await onSave(draft, controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The feature could not be built.')
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  const description =
    tool.id === 'loft'
      ? 'Choose sections in the order the loft should pass through them.'
      : tool.id === 'sweep1'
        ? 'Choose the guide curve, then the sections in order along it.'
        : 'Choose two open guides or two closed guides for a band. Pick sections in order, each touching both guides.'
  return (
    <Dialog
      open
      title={editing ? `Edit ${tool.title.toLowerCase()}` : tool.title}
      description={description}
      onOpenChange={(open) => !open && close()}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!!problem || saving} onClick={() => void save()}>
            {saving ? 'Checking geometry…' : editing ? 'Save changes' : 'Create feature'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {draft.rails.length > 0 && (
          <fieldset className="m-0 min-w-0 space-y-1.5" disabled={saving}>
            <legend className="mb-1 p-0 font-medium">Rails</legend>
            {draft.rails.map((value, i) => (
              <div
                key={`rail-${i + 1}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2"
              >
                <span className="text-xs text-fg-muted">Rail {i + 1}</span>
                <Select
                  aria-label={`Rail ${i + 1}`}
                  value={value || null}
                  options={available(value)}
                  onChange={(id) => choose('rails', i, id)}
                  placeholder={value ? 'Missing curve' : 'Choose a curve'}
                  disabled={saving}
                />
              </div>
            ))}
            {draft.rails.length === 2 && draft.rails.every(Boolean) && (
              <Button
                size="sm"
                variant="ghost"
                icon={ArrowUpDown}
                className="-ml-2"
                onClick={() => change({ rails: draft.rails.toReversed() })}
              >
                Swap rails
              </Button>
            )}
          </fieldset>
        )}
        <fieldset className="m-0 min-w-0 space-y-1.5" disabled={saving}>
          <legend className="mb-1 p-0 font-medium">Sections</legend>
          {draft.sections.map((value, i) => (
            // The control stays at this numbered position when the curves change order.
            <div key={`section-${i + 1}`} className="flex items-center gap-2">
              <span className="w-[4.5rem] shrink-0 text-xs text-fg-muted">Section {i + 1}</span>
              <Select
                aria-label={`Section ${i + 1}`}
                value={value || null}
                options={available(value)}
                onChange={(id) => choose('sections', i, id)}
                placeholder={value ? 'Missing curve' : 'Choose a curve'}
                className="flex-1"
                disabled={saving}
              />
              {draft.sections.length > 1 && (
                <div className="flex shrink-0">
                  <IconButton
                    icon={ArrowUp}
                    label={`Move section ${i + 1} up`}
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    label={`Move section ${i + 1} down`}
                    size="sm"
                    disabled={i === draft.sections.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  {draft.sections.length > tool.minSections && (
                    <IconButton
                      icon={X}
                      label={`Remove section ${i + 1}`}
                      size="sm"
                      onClick={() => change({ sections: draft.sections.filter((_, k) => i !== k) })}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            className="-ml-2"
            disabled={
              draft.sections.length >= Math.min(MAX_SECTIONS, options.length - tool.rails) ||
              draft.sections.includes('')
            }
            onClick={() => change({ sections: [...draft.sections, ''] })}
          >
            Add section
          </Button>
        </fieldset>
        <div className="space-y-2 border-t border-line pt-3">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-fg-muted">Output</span>
            <Select
              aria-label="Output"
              value={draft.capped ? 'solid' : 'surface'}
              options={[
                { value: 'solid', label: 'Solid (capped ends)' },
                { value: 'surface', label: 'Surface (uncapped)' },
              ]}
              onChange={(value) => change({ capped: value === 'solid' })}
              disabled={saving}
            />
          </div>
          {tool.id === 'loft' && (
            <label htmlFor={ruledId} className="inline-flex items-center gap-2">
              <Checkbox
                id={ruledId}
                checked={draft.ruled}
                onChange={(ruled) => change({ ruled })}
                disabled={saving}
              />
              Ruled loft
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {problem && (
          <p role="status" className="text-xs text-fg-muted">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  )
}
