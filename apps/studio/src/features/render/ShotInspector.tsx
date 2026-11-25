/**
 * Adjusting a shot in plain words: the look (Studio white, Black acrylic, Soft gradient and
 * more), the angle, the lens, the light, the backdrop, the metal, the size and the quality,
 * with how long a take of it would keep this computer busy. Sliders show their value while
 * dragged and save once, on release.
 */
import { LOOK_CHOICES, machineTime, QUALITY_LABELS, SIZE_PRESETS } from '@pave/render'
import { METAL_IDS, type RenderScene } from '@pave/schema'
import { cn, Segmented, Select, Slider, Switch } from '@pave/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { metalLabel, metalSwatch } from '../../lib/domain'

type Patch = Record<string, unknown>

const ANGLES = [
  { value: 'hero', label: 'Hero' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'top', label: 'Top' },
  { value: 'three-quarter', label: '¾' },
  { value: 'macro', label: 'Macro' },
] as const

const BACKDROPS = [
  { value: 'look', label: 'As the look' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'transparent', label: 'Transparent' },
] as const

/** A slider that shows its value while dragged and reports once on release. */
function LiveSlider({
  value,
  onCommit,
  label,
  format,
  ...range
}: {
  value: number
  onCommit: (v: number) => void
  label: string
  format: (v: number) => string
  min: number
  max: number
  step: number
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="font-mono text-fg-subtle tabular">{format(v)}</span>
      </div>
      <Slider aria-label={label} value={v} onChange={setV} onCommit={onCommit} {...range} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <h3 className="text-xs font-medium text-fg-subtle">{title}</h3>
      {children}
    </section>
  )
}

export function ShotInspector({
  scene,
  onChange,
  estimate,
  engine,
  disabled,
}: {
  scene: RenderScene
  onChange: (patch: Patch) => void
  /** Seconds a take of this shot would take, and whether that is measured here. */
  estimate: { seconds: number; basis: string } | null
  engine: 'blender' | 'browser' | null
  disabled?: boolean
}) {
  const lead = LOOK_CHOICES.slice(0, 3)
  const more = LOOK_CHOICES.slice(3)
  const metal = scene.overrides['*']?.material ?? null
  const locked = scene.camera.locked === true
  const size =
    SIZE_PRESETS.find((p) => p.width === scene.output.width && p.height === scene.output.height)
      ?.key ?? 'custom'
  return (
    <div className={cn('flex flex-col', disabled && 'pointer-events-none opacity-60')}>
      <Section title="Look">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Look">
          {lead.map((l) => (
            // biome-ignore lint/a11y/useSemanticElements: a card-style radio, with its own picture
            <button
              key={l.look}
              type="button"
              role="radio"
              aria-checked={scene.look === l.look}
              onClick={() => onChange({ look: l.look })}
              className={cn(
                'flex flex-col gap-1 rounded-md p-1.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:bg-bg-hover',
                scene.look === l.look && 'shadow-[inset_0_0_0_2px_var(--fg)]',
              )}
            >
              <span className={cn('h-8 w-full rounded-sm', LOOK_SWATCH[l.look])} aria-hidden />
              <span className="text-[11px] leading-tight font-medium">{l.label}</span>
            </button>
          ))}
        </div>
        <Select
          value={more.some((l) => l.look === scene.look) ? scene.look : null}
          onChange={(look) => onChange({ look })}
          placeholder="More looks…"
          options={more.map((l) => ({ value: l.look, label: l.label, hint: l.hint }))}
        />
      </Section>

      <Section title="Angle">
        <div className={cn('flex flex-col gap-2', locked && 'pointer-events-none opacity-50')}>
          <Segmented
            size="sm"
            aria-label="Angle"
            value={scene.camera.preset}
            disabled={locked}
            onChange={(preset) =>
              preset !== 'custom' &&
              onChange({
                camera: {
                  preset,
                  position: null,
                  target: null,
                  framedOn: null,
                  basePreset: null,
                },
              })
            }
            // A custom camera presses no preset; the line below names it. Seven segments do
            // not fit the inspector's width.
            options={ANGLES.map((a) => ({ value: a.value, label: a.label }))}
          />
          {scene.camera.preset === 'custom' && (
            <p className="text-[11px] text-fg-muted">
              Custom view, framed in the viewfinder
              {scene.camera.basePreset
                ? ` (from ${ANGLES.find((a) => a.value === scene.camera.basePreset)?.label})`
                : ''}
              . Pick an angle to go back to a preset.
            </p>
          )}
          <LiveSlider
            label="Lens"
            value={scene.camera.focalLength}
            min={35}
            max={150}
            step={1}
            format={(v) => `${Math.round(v)} mm`}
            onCommit={(focalLength) => onChange({ camera: { focalLength } })}
          />
          <LiveSlider
            label="Roll"
            value={scene.camera.roll ?? 0}
            min={-45}
            max={45}
            step={0.5}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
            onCommit={(roll) => onChange({ camera: { roll: roll === 0 ? null : roll } })}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-fg-muted">
            Lock camera
            <span className="block text-[11px] text-fg-subtle">
              Keeps this framing: no orbiting, and the assistant cannot move it.
            </span>
          </span>
          <Switch
            checked={locked}
            onChange={(on) => onChange({ camera: { locked: on ? true : null } })}
            aria-label="Lock camera"
          />
        </div>
        <p className="text-[11px] text-fg-subtle">
          Frame the shot in the viewfinder: drag to orbit, shift-drag to pan, scroll to come closer,
          alt-drag to roll.
        </p>
      </Section>

      <Section title="Light">
        <LiveSlider
          label="Brightness"
          value={scene.environment.intensity}
          min={0.4}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={(intensity) => onChange({ environment: { intensity } })}
        />
        <LiveSlider
          label="Light direction"
          value={scene.environment.rotation}
          min={-180}
          max={180}
          step={5}
          format={(v) => `${Math.round(v)}°`}
          onCommit={(rotation) => onChange({ environment: { rotation } })}
        />
        <Select
          value={scene.environment.background === 'color' ? 'look' : scene.environment.background}
          onChange={(background) => onChange({ environment: { background } })}
          options={BACKDROPS.map((b) => ({ value: b.value, label: `Backdrop: ${b.label}` }))}
        />
      </Section>

      <Section title="Metal">
        <Select
          value={metal ?? 'design'}
          onChange={(m) =>
            onChange({ overrides: { '*': m === 'design' ? null : { material: m } } })
          }
          options={[
            { value: 'design', label: 'As designed' },
            ...METAL_IDS.map((id) => ({
              value: id,
              label: metalLabel(id),
              icon: (
                <span
                  className="size-3 rounded-full shadow-[inset_0_0_0_1px_var(--line)]"
                  style={{ background: metalSwatch(id) }}
                />
              ),
            })),
          ]}
        />
      </Section>

      <Section title="Size">
        <Select
          value={size}
          onChange={(key) => {
            const p = SIZE_PRESETS.find((x) => x.key === key)
            if (p) onChange({ output: { width: p.width, height: p.height } })
          }}
          options={[
            ...SIZE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
            ...(size === 'custom'
              ? [{ value: 'custom', label: `${scene.output.width}×${scene.output.height}` }]
              : []),
          ]}
        />
        <Segmented
          size="sm"
          value={scene.output.quality}
          onChange={(quality) => onChange({ output: { quality } })}
          options={(['preview', 'standard', 'final'] as const).map((q) => ({
            value: q,
            label: QUALITY_LABELS[q],
          }))}
        />
        <p className="text-xs text-fg-muted">
          {engine === 'browser'
            ? 'Without Blender, takes are drawn in the browser at preview quality, in seconds.'
            : estimate
              ? `A take: ${machineTime(estimate.seconds)} of this computer’s time${
                  estimate.basis === 'typical' ? ' (a first guess until it has rendered here)' : ''
                }. Nothing is paid.`
              : 'Working out the time…'}
        </p>
      </Section>
    </div>
  )
}

/** What each look's card shows: its backdrop, roughly. */
const LOOK_SWATCH: Record<RenderScene['look'], string> = {
  'catalog-white': 'bg-white shadow-[inset_0_0_0_1px_var(--line)]',
  'black-acrylic': 'bg-gradient-to-b from-neutral-800 to-black',
  'studio-soft': 'bg-gradient-to-b from-neutral-200 to-neutral-400',
  'studio-contrast': 'bg-gradient-to-b from-neutral-500 to-neutral-900',
  'editorial-warm': 'bg-gradient-to-b from-amber-100 to-amber-300',
  daylight: 'bg-gradient-to-b from-sky-100 to-stone-200',
}
