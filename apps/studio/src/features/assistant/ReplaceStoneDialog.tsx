/**
 * Replace stone…: cut, size (ct or mm), ratio for fancy cuts, material. Every change re-plans
 * with the pure intent at once (the numbers in the form are the stone Apply will make), and a
 * dry run of `design.replaceStone` weighs the result on the server: metal, carats, stone count
 * and any check the new stone raises. Apply recomputes the intent on the design as it is then
 * and commits it, with any fix the designer added, as one undoable change.
 *
 * Docked beside the model and not modal, so the stone stays in view and the designer can orbit
 * to judge it: on a piece's Design tab it sits over the inspector column, or on a narrow window
 * over the right of the view, which then frames the piece in the part left free.
 */
import {
  type CommandOutput,
  type Design,
  GEM_CUT_IDS,
  GEM_CUTS,
  GEM_MATERIAL_IDS,
  GEM_MATERIALS,
  type GemCutId,
  type GemMaterialId,
  nodeTitle,
} from '@pave/schema'
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  NumberField,
  Segmented,
  Select,
  Spinner,
  Swatch,
  toast,
} from '@pave/ui'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CutIcon } from '../../components/CutIcon'
import type { DesignSession } from '../../lib/design-session/store'
import { rpc } from '../../lib/rpc'
import {
  applyEdit,
  commitWithUndo,
  type StoneSubject,
  toastServerChange,
  useQuickIntent,
} from './quick-intent-store'
import { fmtCarat, isFancy, isStoneNode, stoneScope } from './quick-intents'
import {
  CENTRE_MIN_CT,
  type Fix,
  factRows,
  initialForm,
  opsToApply,
  type Plan,
  planReplace,
  ratioRange,
  type StoneForm,
  shownSize,
  sizeRange,
  switchUnit,
} from './replace-stone'

type Preview = CommandOutput<'design.replaceStone'>

/** Typing pauses this long before the server weighs the stone. */
const PREVIEW_DEBOUNCE_MS = 350
/** How long a dry run waits for this window's unsent edits before weighing anyway. */
const IDLE_WAIT_MS = 3000

const fmt = (v: number, digits = 2) => Number(v.toFixed(digits)).toString()

export interface ReplaceStoneDialogProps {
  subject: StoneSubject
  design: Design
  /** The piece's live session, when the design is open; otherwise the server applies. */
  session: DesignSession | null
  onClose(): void
}

export function ReplaceStoneDialog({ subject, design, session, onClose }: ReplaceStoneDialogProps) {
  const node = design.nodes[subject.nodeId]
  const [form, setForm] = useState<StoneForm | null>(() =>
    isStoneNode(node) ? initialForm(node) : null,
  )
  const plan = useMemo(
    () => (form ? planReplace(design, subject, form) : null),
    [design, subject, form],
  )
  const preview = useDryRun(subject, plan?.result?.ops.length ? plan : null, session)
  const [applying, setApplying] = useState(false)
  const sidesId = useId()
  const dock = useQuickIntent((s) => (s.dock?.pieceId === subject.pieceId ? s.dock : null))

  if (!isStoneNode(node) || !form || !plan) return null
  const single = node.kind === 'gem'
  const outcome = plan.outcome
  const range = ratioRange(form.cut)
  const size = sizeRange(node, form, subject.role)
  const ops = plan.result?.ops ?? []
  const warnings = plan.result?.warnings ?? []
  const proportion = warnings.find((w) => w.code === 'side.proportion' && w.suggestion)
  const chosenFixes = plan.fixes.filter((f) => form.fixes.includes(f.key))
  const centreMin = single && subject.role === 'center'
  const atMin = form.size !== null && form.size <= size.min + 1e-9

  const apply = async () => {
    setApplying(true)
    try {
      // Recomputed on the design as it is now; deterministic, so no stale plan is replayed.
      const now = planReplace(session ? session.get().view : design, subject, form)
      const all = opsToApply(now, form)
      if (!now.result || !all.length) return onClose()
      if (session) commitWithUndo(session, all, now.result.label)
      else if (all.length > now.result.ops.length)
        // Fixes ride along as plain ops, so the stone change and its fixes stay one change.
        await applyEdit(subject.pieceId, all, now.result.label)
      else {
        const r = await rpc.call('design.replaceStone', {
          pieceId: subject.pieceId,
          target: now.target,
          change: now.change,
          dryRun: false,
        })
        toastServerChange(subject.pieceId, r.label, r.change?.seq)
      }
      onClose()
    } catch (err) {
      toast.error('Couldn’t replace the stone', (err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  /** A typed size equal to what the form shows untouched is no size: the intent's rule decides. */
  const setSize = (v: number | null) => {
    if (v === null) return
    const untouched = { ...form, size: null }
    const shown = shownSize(untouched, planReplace(design, subject, untouched).outcome)
    setForm({ ...form, size: v === shown ? null : v })
  }

  const both = !!plan.partner && form.pair === 'both'
  const title = single ? (both ? 'Replace side stones' : 'Replace stone') : 'Replace stones'
  const current = single ? nodeTitle(node) : stoneScope(design, subject)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      placement="end"
      {...(dock ? { dock } : {})}
      title={title}
      description={both && plan.partner ? `${current} and ${nodeTitle(plan.partner)}` : current}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ops.length || applying} onClick={() => void apply()}>
            {applying && <Spinner className="size-3" />}
            {single && !both ? 'Replace' : 'Replace all'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {plan.partner && (
          <Segmented
            value={form.pair}
            aria-label="Which side stones"
            options={[
              { value: 'both', label: 'Both side stones' },
              { value: 'one', label: 'Only this one' },
            ]}
            onChange={(pair) => setForm({ ...form, pair })}
            className="self-start"
          />
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-fg-muted">Cut</h3>
          <CutPicker value={form.cut} onChange={(cut) => setForm({ ...form, cut, lw: null })} />
          <p className="text-xs text-fg-subtle">
            {GEM_CUTS[form.cut].label}
            {outcome &&
              ` · ${
                Math.abs(outcome.lengthMm - outcome.widthMm) < 0.005
                  ? `${fmt(outcome.widthMm)} mm`
                  : `${fmt(outcome.lengthMm)} × ${fmt(outcome.widthMm)} mm`
              } · ${fmtCarat(outcome.carat)} ct${single && !both ? '' : ' each'}`}
          </p>
        </section>

        <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2.5">
          <span className="text-sm text-fg-muted">Size</span>
          <div className="flex items-center gap-2">
            <NumberField
              size="sm"
              value={shownSize(form, outcome)}
              unit={form.unit}
              min={size.min}
              max={size.max}
              step={size.step}
              precision={2}
              aria-label={form.unit === 'ct' ? 'Size in carats' : 'Size in millimetres'}
              onChange={setSize}
              className="min-w-0 flex-1"
            />
            {single && (
              <Segmented
                value={form.unit}
                aria-label="Size unit"
                options={[
                  { value: 'ct', label: 'ct' },
                  { value: 'mm', label: 'mm' },
                ]}
                onChange={(unit) => setForm(switchUnit(form, unit, outcome))}
              />
            )}
          </div>
          {centreMin && atMin && (
            <p className="col-start-2 text-xs text-fg-subtle">
              A centre stone goes down to {fmtCarat(CENTRE_MIN_CT)} ct here, the smallest stock
              weight.
            </p>
          )}

          {single && isFancy(form.cut) && (
            <>
              <span className="text-sm text-fg-muted">Ratio</span>
              <div className="flex items-center gap-2">
                <NumberField
                  size="sm"
                  value={form.lw ?? (outcome ? Number(outcome.lw.toFixed(2)) : range.default)}
                  min={range.min}
                  max={range.max}
                  step={0.01}
                  aria-label="Length to width ratio"
                  onChange={(v) => v !== null && setForm({ ...form, lw: v })}
                  className="min-w-0 flex-1"
                />
                {form.lw === null ? (
                  <span className="w-[68px] text-center text-2xs text-fg-subtle">Auto</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-[68px]"
                    onClick={() => setForm({ ...form, lw: null })}
                  >
                    Auto
                  </Button>
                )}
              </div>
            </>
          )}

          <span className="text-sm text-fg-muted">Stone</span>
          <Select<GemMaterialId>
            value={form.stone}
            aria-label="Stone material"
            options={GEM_MATERIAL_IDS.map((id) => ({
              value: id,
              label: GEM_MATERIALS[id].label,
              icon: <Swatch color={GEM_MATERIALS[id].color} kind="gem" size="sm" />,
            }))}
            onChange={(stone) => setForm({ ...form, stone })}
            className="h-7 w-full"
          />
        </div>

        {(proportion || form.sides === 'proportion') && (
          <div className="flex items-start gap-2 text-sm text-fg">
            <Checkbox
              id={sidesId}
              checked={form.sides === 'proportion'}
              onChange={(on) => setForm({ ...form, sides: on ? 'proportion' : 'keep' })}
              className="mt-0.5"
            />
            <label htmlFor={sidesId}>
              Also resize the side stones
              <span className="block text-xs text-fg-subtle">
                They keep their size by default: they are bought as a pair.
              </span>
            </label>
          </div>
        )}

        <Outcome
          error={plan.error}
          notes={plan.result?.notes ?? []}
          warnings={warnings.filter((w) => w !== proportion || form.sides === 'keep')}
          preview={preview}
          unchanged={!ops.length}
          fixes={plan.fixes}
          chosen={form.fixes}
          onFix={(key, on) =>
            setForm({
              ...form,
              fixes: on ? [...form.fixes, key] : form.fixes.filter((k) => k !== key),
            })
          }
          unweighed={chosenFixes}
        />
      </div>
    </Dialog>
  )
}

/** Weighs the change on the server (a dry run writes nothing), latest request wins. */
function useDryRun(
  subject: StoneSubject,
  plan: Pick<Plan, 'target' | 'change'> | null,
  session: DesignSession | null,
): { state: 'idle' | 'loading' | 'done' | 'error'; data?: Preview; error?: string } {
  const [state, setState] = useState<ReturnType<typeof useDryRun>>({ state: 'idle' })
  const target = plan?.target
  const change = plan?.change
  const key = plan ? JSON.stringify([target, change]) : null
  const latest = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `target` and `change`
  useEffect(() => {
    if (!key || !change || !target) {
      setState({ state: 'idle' })
      return
    }
    const id = ++latest.current
    setState((s) => ({ ...s, state: 'loading' }))
    const timer = setTimeout(async () => {
      try {
        // The server weighs its own copy: let this window's edits reach it first, but do not
        // wait on an outbox that is offline.
        if (session)
          await Promise.race([session.idle(), new Promise((r) => setTimeout(r, IDLE_WAIT_MS))])
        const data = await rpc.call('design.replaceStone', {
          pieceId: subject.pieceId,
          target,
          change,
          dryRun: true,
        })
        if (id === latest.current) setState({ state: 'done', data })
      } catch (err) {
        if (id === latest.current) setState({ state: 'error', error: (err as Error).message })
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, subject.pieceId, subject.nodeId, session])
  return state
}

function Outcome({
  error,
  notes,
  warnings,
  preview,
  unchanged,
  fixes,
  chosen,
  onFix,
  unweighed,
}: {
  error: string | null
  notes: string[]
  warnings: { code: string; message: string }[]
  preview: ReturnType<typeof useDryRun>
  unchanged: boolean
  /** Ready fixes the warnings offer, each a box to add it to this change. */
  fixes: Fix[]
  chosen: string[]
  onFix(key: string, on: boolean): void
  /** Chosen fixes: the dry run weighs the stone change alone. */
  unweighed: Fix[]
}) {
  if (error) return <p className="text-sm text-danger">{error}</p>
  if (unchanged)
    return <p className="text-sm text-fg-subtle">Choose a cut, size or stone to compare.</p>
  const data = preview.state === 'done' ? preview.data : undefined
  const added = (data?.diagnostics.added ?? []).filter((d) => d.level !== 'info')
  const resolved = (data?.diagnostics.resolved ?? []).filter((d) => d.level !== 'info')
  const weighing = preview.state === 'loading' || preview.state === 'idle'
  return (
    <section
      aria-live="polite"
      aria-busy={weighing}
      className="flex flex-col gap-2.5 rounded-lg bg-bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-fg-muted">
          {notes.slice(0, 4).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {preview.state === 'error' && (
        <p className="text-xs text-danger">Couldn’t weigh it: {preview.error}</p>
      )}
      {data && !data.before && (
        <p className="text-xs text-fg-subtle">Weights need the geometry engine on the server.</p>
      )}
      {data?.before && data.after ? (
        <table className={cn('w-full text-xs', weighing && 'opacity-50')}>
          <thead className="sr-only">
            <tr>
              <th>Fact</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {factRows(data.before, data.after).map((r) => (
              <tr key={r.label}>
                <td className="py-0.5 text-fg-muted">{r.label}</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-fg-subtle">
                  {r.before}
                </td>
                <td className="px-1.5 text-fg-faint" aria-hidden>
                  →
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums text-fg">{r.after}</td>
                <td className="w-16 py-0.5 text-right font-mono tabular-nums text-fg-subtle">
                  {r.delta ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        weighing && <FactsSkeleton />
      )}
      {unweighed.length > 0 && data?.before && (
        <p className="text-xs text-fg-subtle">
          Weighed without {unweighed.map((f) => f.label.toLowerCase()).join('; ')}.
        </p>
      )}
      {(added.length > 0 || warnings.length > 0) && (
        <ul className="flex flex-col gap-1 text-xs">
          {added.map((d) => (
            <li key={`${d.code}:${d.nodeId}`} className="flex gap-2 text-fg">
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  d.level === 'error' ? 'bg-danger' : 'bg-warn',
                )}
              />
              <span>
                <span className="sr-only">
                  {d.level === 'error' ? 'New problem: ' : 'New check: '}
                </span>
                {d.message}
              </span>
            </li>
          ))}
          {warnings.map((w) => (
            <li key={w.code + w.message} className="flex gap-2 text-fg-muted">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
      {fixes.map((f) => (
        <FixBox key={f.key} fix={f} checked={chosen.includes(f.key)} onChange={onFix} />
      ))}
      {data?.before && added.length === 0 && warnings.length === 0 && (
        <p className="text-xs text-fg-subtle">
          No new checks.{resolved.length ? ` ${resolved.length} resolved.` : ''}
        </p>
      )}
    </section>
  )
}

/** A warning's ready fix as a box: ticked, it is part of the same Replace. */
function FixBox({
  fix,
  checked,
  onChange,
}: {
  fix: Fix
  checked: boolean
  onChange(key: string, on: boolean): void
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2 text-xs text-fg">
      <Checkbox id={id} checked={checked} onChange={(on) => onChange(fix.key, on)} />
      <label htmlFor={id}>Also: {fix.label}</label>
    </div>
  )
}

/**
 * The three fact rows' place while the server weighs the stone, so the table does not push
 * the rest down when it lands.
 */
function FactsSkeleton() {
  return (
    <div className="flex flex-col">
      {['Metal', 'Carats', 'Stones'].map((label) => (
        <div key={label} aria-hidden className="flex h-5 items-center justify-between text-xs">
          <span className="text-fg-muted">{label}</span>
          <span className="h-2 w-28 animate-pulse rounded-xs bg-bg-muted" />
        </div>
      ))}
      <p className="sr-only">Weighing the new stone…</p>
    </div>
  )
}

/** The cuts as outline tiles: one radio group, arrow keys move and choose, as native radios do. */
function CutPicker({ value, onChange }: { value: GemCutId; onChange(cut: GemCutId): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + GEM_CUT_IDS.length) % GEM_CUT_IDS.length
    onChange(GEM_CUT_IDS[next]!)
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Cut" className="grid grid-cols-7 gap-1">
      {GEM_CUT_IDS.map((cut, i) => {
        const checked = cut === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: a tile with an icon, not a native radio input
          <button
            key={cut}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={GEM_CUTS[cut].label}
            title={GEM_CUTS[cut].label}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(cut)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md text-fg-muted outline-none',
              'transition-[background-color,color,box-shadow] duration-120 hover:bg-bg-hover hover:text-fg',
              'focus-visible:shadow-[inset_0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)]',
              checked && 'bg-bg text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]',
            )}
          >
            <CutIcon cut={cut} className="size-6" />
          </button>
        )
      })}
    </div>
  )
}
