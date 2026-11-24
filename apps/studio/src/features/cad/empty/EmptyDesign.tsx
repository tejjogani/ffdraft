/**
 * An empty design: four ways in, none of which needs a key. Start from a template; describe it
 * to the assistant (or answer three questions when there is none); bring in a mesh, an SVG, a
 * name or a built-in model; or raise a relief from an image.
 */
import {
  type Design,
  GEM_CUTS,
  type GemCutId,
  METALS,
  type MetalId,
  type NodeInput,
  type PieceSpecInput,
  TEMPLATES,
  type Template,
} from '@pave/schema'
import { Button, cn, Input, Segmented, Select, Spinner, Swatch, Textarea, toast } from '@pave/ui'
import { ArrowLeft, FileUp, ImageUp, LayoutTemplate, type LucideIcon, MessageSquareText } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { KindGlyph } from '../../../components/KindGlyph'
import { uploadAsset } from '../../../lib/assets'
import { assistant } from '../../../stores/assistant'
import {
  builtinNode,
  classifyImport,
  IMPORT_ACCEPT,
  meshNode,
  outlineNode,
  reliefNode,
  svgPathData,
  textNode,
} from './importers'

export interface EmptyDesignProps {
  pieceId: string
  design: Design
  assistantAvailable: boolean
  /** Replaces the design from a spec (`pieces.setSpec` + `pieces.buildFromSpec`). */
  onBuild(spec: PieceSpecInput): Promise<void>
  /** Adds an imported node; `kind` is the piece type it implies. */
  onImport(node: NodeInput, kind: Design['kind']): void
}

type Step = 'doors' | 'templates' | 'quick'

export function EmptyDesign({ pieceId, design, assistantAvailable, onBuild, onImport }: EmptyDesignProps) {
  const [step, setStep] = useState<Step>('doors')
  const [busy, setBusy] = useState<string | null>(null)
  const build = async (label: string, spec: PieceSpecInput) => {
    setBusy(label)
    try {
      await onBuild(spec)
    } catch (e) {
      toast.error('Couldn’t build the piece', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-y-auto p-6">
      <div className="pointer-events-auto w-full max-w-[680px]">
        {step === 'doors' && (
          <>
            <div className="mb-6 text-center">
              <h2 className="font-serif text-[30px] leading-9 text-fg">Start this piece</h2>
              <p className="mt-1 text-sm text-fg-muted">Pick a way in. Everything stays editable afterwards.</p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Door icon={LayoutTemplate} title="From a template" description="A classic to adjust: solitaires, halos, bands, pendants, chains.">
                <Button size="sm" onClick={() => setStep('templates')}>
                  Browse templates
                </Button>
              </Door>
              <DescribeDoor
                pieceId={pieceId}
                assistantAvailable={assistantAvailable}
                onQuickStart={() => setStep('quick')}
              />
              <ImportDoor design={design} onImport={onImport} />
              <ImageDoor onImport={onImport} />
            </div>
          </>
        )}
        {step === 'templates' && (
          <Panel title="Templates" onBack={() => setStep('doors')}>
            <TemplateGrid busy={busy} onPick={(t) => build(t.id, t.spec)} />
          </Panel>
        )}
        {step === 'quick' && (
          <Panel title="Quick start" onBack={() => setStep('doors')}>
            <QuickStart busy={busy !== null} onBuild={(spec) => build('quick', spec)} />
          </Panel>
        )}
      </div>
    </div>
  )
}

function Door({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="glass flex flex-col gap-3 rounded-lg p-4 shadow-sm">
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <div>
          <h3 className="text-sm font-medium text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted text-pretty">{description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pl-7">{children}</div>
    </section>
  )
}

function Panel({ title, onBack, children }: { title: string; onBack(): void; children: ReactNode }) {
  return (
    <section className="glass flex max-h-[calc(100vh-220px)] flex-col rounded-xl shadow-md">
      <header className="flex items-center gap-2 border-b border-glass-line px-3 py-2.5">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        <h2 className="text-sm font-medium">{title}</h2>
      </header>
      <div className="overflow-y-auto p-4">{children}</div>
    </section>
  )
}

function DescribeDoor({
  pieceId,
  assistantAvailable,
  onQuickStart,
}: {
  pieceId: string
  assistantAvailable: boolean
  onQuickStart(): void
}) {
  const [prompt, setPrompt] = useState('')
  if (!assistantAvailable)
    return (
      <Door icon={MessageSquareText} title="Describe it" description="Answer three questions — kind, stone, metal — and get a first version.">
        <Button size="sm" onClick={onQuickStart}>
          Quick start
        </Button>
      </Door>
    )
  return (
    <Door icon={MessageSquareText} title="Describe it" description="Tell the assistant what you have in mind; it agrees a plan with you, then builds it.">
      <form
        className="flex w-full flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          assistant.open({ prompt: prompt.trim() || undefined, context: { pieceId } })
        }}
      >
        <Textarea
          value={prompt}
          minRows={2}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A 1.5 ct oval on a fine pavé band…"
          aria-label="Describe the piece"
          className="text-sm"
        />
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" variant="primary">
            Ask the assistant
          </Button>
          <Button size="sm" variant="ghost" onClick={onQuickStart}>
            Quick start
          </Button>
        </div>
      </form>
    </Door>
  )
}

function ImportDoor({ design, onImport }: { design: Design; onImport: EmptyDesignProps['onImport'] }) {
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const take = async (file: File) => {
    const kind = classifyImport(file.name)
    if (!kind) return toast.error('That file type isn’t supported', 'Use STL, OBJ, GLB, 3MF, PLY, SVG or an image.')
    setBusy(true)
    try {
      if (kind === 'svg') {
        const d = svgPathData(await file.text())
        if (!d) throw new Error('No outline paths were found in that SVG.')
        onImport(outlineNode(d, file.name), 'pendant')
      } else {
        const asset = await uploadAsset(file)
        onImport(kind === 'mesh' ? meshNode(asset.id, file.name) : reliefNode(asset.id, file.name), 'pendant')
      }
    } catch (e) {
      toast.error('Couldn’t import that file', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files[0]
        if (file) void take(file)
      }}
      className={cn('rounded-lg', over && 'outline-2 outline-select outline-dashed')}
    >
      <Door icon={FileUp} title="Bring something in" description="Drop a mesh or an SVG logo, type a name, or start from a model.">
        <input
          ref={input}
          type="file"
          accept={IMPORT_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void take(file)
          }}
        />
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Spinner className="size-3.5" /> : null}
          Choose file
        </Button>
        {(['trophy', 'crown', 'dice'] as const).map((b) => (
          <Button key={b} size="sm" variant="ghost" onClick={() => onImport(builtinNode(b), 'pendant')}>
            {b[0]!.toUpperCase() + b.slice(1)}
          </Button>
        ))}
        <form
          className="mt-1 flex w-full gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onImport(textNode(name.trim()), design.kind === 'ring' ? 'pendant' : design.kind)
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="A name, e.g. Amara" aria-label="Name for a name pendant" className="h-7" />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Make it
          </Button>
        </form>
      </Door>
    </div>
  )
}

function ImageDoor({ onImport }: { onImport: EmptyDesignProps['onImport'] }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Door icon={ImageUp} title="From an image" description="Raise a coin, medallion or signet face from a photo or drawing.">
      <input
        ref={input}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            const asset = await uploadAsset(file)
            onImport(reliefNode(asset.id, file.name), 'pendant')
          } catch (err) {
            toast.error('Couldn’t upload that image', err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner className="size-3.5" /> : null}
        Choose image
      </Button>
    </Door>
  )
}

const FAMILIES = [...new Set(TEMPLATES.map((t) => t.family))]

function TemplateGrid({ busy, onPick }: { busy: string | null; onPick(t: Template): void }) {
  return (
    <div className="flex flex-col gap-5">
      {FAMILIES.map((family) => (
        <section key={family}>
          <h3 className="mb-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase">{family}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEMPLATES.filter((t) => t.family === family).map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy !== null}
                onClick={() => onPick(t)}
                className="group flex flex-col items-start gap-2 rounded-md bg-bg p-3 text-left shadow-[0_0_0_1px_var(--line)] transition-shadow duration-120 hover:shadow-[0_0_0_1px_var(--line-strong),var(--shadow-sm)] disabled:opacity-50"
              >
                <span className="stage flex h-16 w-full items-center justify-center rounded-sm">
                  {busy === t.id ? <Spinner /> : <KindGlyph kind={t.spec.kind} className="w-12 text-fg-subtle" />}
                </span>
                <span className="text-sm font-medium text-fg">{t.spec.title}</span>
                <span className="line-clamp-2 text-xs text-fg-muted">{t.spec.summary}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

type QuickKind = 'ring' | 'pendant' | 'earrings'
const STONE_CUTS: GemCutId[] = ['round', 'oval', 'cushion', 'emerald', 'pear', 'princess']

function QuickStart({ busy, onBuild }: { busy: boolean; onBuild(spec: PieceSpecInput): void }) {
  const [kind, setKind] = useState<QuickKind>('ring')
  const [cut, setCut] = useState<GemCutId | 'none'>('round')
  const [metal, setMetal] = useState<MetalId>('au18k-yellow')
  const spec = (): PieceSpecInput => {
    const stones = cut === 'none' ? [] : [{ role: 'center' as const, cut, carat: kind === 'earrings' ? 0.5 : 1 }]
    const title = `${METALS[metal].label} ${kind === 'earrings' ? 'studs' : kind}`
    if (kind === 'ring')
      return {
        kind,
        archetype: stones.length ? 'solitaire' : 'band',
        title,
        summary: 'Started from the quick start.',
        metal: { alloy: metal },
        ring: { size: { system: 'us', value: 6 } },
        stones,
      }
    return {
      kind,
      archetype: kind === 'earrings' ? 'studs' : 'pendantSolitaire',
      title,
      summary: 'Started from the quick start.',
      metal: { alloy: metal },
      stones: stones.length ? stones : [{ role: 'center', cut: 'round', carat: 0.5 }],
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Question label="What are we making?">
        <Segmented<QuickKind>
          value={kind}
          onChange={setKind}
          size="md"
          options={[
            { value: 'ring', label: 'Ring' },
            { value: 'pendant', label: 'Pendant' },
            { value: 'earrings', label: 'Earrings' },
          ]}
        />
      </Question>
      <Question label="Centre stone">
        <Select<GemCutId | 'none'>
          value={cut}
          onChange={setCut}
          options={[
            ...(kind === 'ring' ? [{ value: 'none' as const, label: 'No stone (a band)' }] : []),
            ...STONE_CUTS.map((c) => ({ value: c, label: GEM_CUTS[c].label })),
          ]}
          className="w-60"
        />
      </Question>
      <Question label="Metal">
        <Select<MetalId>
          value={metal}
          onChange={setMetal}
          options={(['au18k-yellow', 'au18k-white', 'au18k-rose', 'pt950', 'ag925-sterling'] as MetalId[]).map((m) => ({
            value: m,
            label: METALS[m].label,
            icon: <Swatch color={METALS[m].swatch} kind="metal" size="sm" />,
          }))}
          className="w-60"
        />
      </Question>
      <div>
        <Button variant="primary" disabled={busy} onClick={() => onBuild(spec())}>
          {busy ? <Spinner className="size-3.5 text-ink-fg" /> : null}
          Build it
        </Button>
      </div>
    </div>
  )
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </div>
  )
}
