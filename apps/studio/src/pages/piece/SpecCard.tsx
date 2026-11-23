import {
  FINISH_IDS,
  FINISHES,
  GEM_CUT_IDS,
  GEM_CUTS,
  GEM_MATERIAL_IDS,
  GEM_MATERIALS,
  METAL_IDS,
  METALS,
  type Piece,
  type PieceSpec,
  PLATING_IDS,
  PLATINGS,
  RING_SIZE_SYSTEMS,
  type StoneSpec,
} from '@pave/schema'
import {
  AiMark,
  Button,
  Chip,
  Dialog,
  EmptyState,
  Input,
  NumberField,
  Select,
  Swatch,
  Textarea,
} from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { Check, CircleHelp, Hammer } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { queryClient, rpcKey, useRpcMutation } from '../../lib/query'
import { assistant } from '../../stores/assistant'

const ROLE_LABEL: Record<StoneSpec['role'], string> = {
  center: 'Centre',
  side: 'Side',
  accent: 'Accent',
  halo: 'Halo',
  pave: 'Pavé',
}

const SETTING_LABEL: Record<NonNullable<StoneSpec['setting']>, string> = {
  prong: 'Prong',
  basket: 'Basket',
  bezel: 'Bezel',
  halfBezel: 'Half bezel',
  flush: 'Flush',
  pave: 'Pavé',
  channel: 'Channel',
}

const ARCHETYPE_LABEL: Record<PieceSpec['archetype'], string> = {
  solitaire: 'Solitaire',
  halo: 'Halo',
  threeStone: 'Three-stone',
  eternity: 'Eternity',
  band: 'Band',
  signet: 'Signet',
  pendantSolitaire: 'Solitaire pendant',
  namePendant: 'Name pendant',
  icedPendant: 'Iced pendant',
  medallion: 'Medallion',
  studs: 'Studs',
  tennis: 'Tennis',
  cuban: 'Cuban',
  custom: 'Custom',
}

const metalOptions = METAL_IDS.map((id) => ({
  value: id,
  label: METALS[id].label,
  icon: <Swatch color={METALS[id].swatch} kind="metal" size="sm" />,
}))
const finishOptions = FINISH_IDS.map((id) => ({ value: id, label: FINISHES[id].label }))
const platingOptions = PLATING_IDS.map((id) => ({
  value: id,
  label: id === 'none' ? 'No plating' : PLATINGS[id].label,
}))
const cutOptions = GEM_CUT_IDS.map((id) => ({ value: id, label: GEM_CUTS[id].label }))
const stoneOptions = GEM_MATERIAL_IDS.map((id) => ({
  value: id,
  label: GEM_MATERIALS[id].label,
  icon: <Swatch color={GEM_MATERIALS[id].color} kind="gem" size="sm" />,
}))
const sizeSystemOptions = RING_SIZE_SYSTEMS.map((s) => ({
  value: s,
  label: s === 'mm' ? 'mm ⌀' : s.toUpperCase(),
}))

/**
 * The spec as a human-readable, editable plan. Every edit saves the whole spec; open questions
 * are highlighted because the assistant should not guess them.
 */
export function SpecCard({ piece }: { piece: Piece }) {
  const [draft, setDraft] = useState(piece.spec)
  useEffect(() => setDraft(piece.spec), [piece.spec])
  const setSpec = useRpcMutation('pieces.setSpec', {
    onMutate: (v) => {
      queryClient.setQueryData<Piece>(
        rpcKey('pieces.get', { id: piece.id }),
        (p) => p && { ...p, spec: v.spec as PieceSpec },
      )
    },
  })

  if (!draft)
    return (
      <Card>
        <EmptyState
          className="py-10"
          title="No spec yet"
          description="Plan the piece with the assistant — metal, size, stones — before any geometry."
          action={
            <Button
              variant="primary"
              onClick={() =>
                assistant.open({
                  prompt: 'Help me write the spec for this piece.',
                  context: { pieceId: piece.id },
                })
              }
            >
              <AiMark className="size-3" /> Plan with the assistant
            </Button>
          }
        />
      </Card>
    )

  const save = (next: PieceSpec) => {
    setDraft(next)
    setSpec.mutate({ id: piece.id, spec: next })
  }
  const patch = (p: Partial<PieceSpec>) => save({ ...draft, ...p })
  const patchStone = (i: number, p: Partial<StoneSpec>) =>
    patch({ stones: draft.stones.map((s, j) => (j === i ? { ...s, ...p } : s)) })

  return (
    <Card>
      <div className="px-5 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-medium text-fg-subtle">Spec</span>
          <Chip outline>{ARCHETYPE_LABEL[draft.archetype]}</Chip>
          {draft.style.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
        <Input
          bare
          value={draft.title}
          aria-label="Spec title"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onBlur={() => draft.title !== piece.spec?.title && save(draft)}
          className="text-lg font-medium"
        />
        <Textarea
          bare
          minRows={1}
          value={draft.summary}
          aria-label="Summary"
          placeholder="One short paragraph a client could read."
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          onBlur={() => draft.summary !== piece.spec?.summary && save(draft)}
          className="mt-1 text-sm leading-6 text-fg-muted"
        />
      </div>

      <dl className="mt-3 divide-y divide-line border-t border-line">
        <Row label="Metal">
          <Select
            variant="bare"
            aria-label="Alloy"
            value={draft.metal.alloy}
            options={metalOptions}
            onChange={(alloy) => patch({ metal: { ...draft.metal, alloy } })}
          />
          <Select
            variant="bare"
            aria-label="Finish"
            value={draft.metal.finish}
            options={finishOptions}
            onChange={(finish) => patch({ metal: { ...draft.metal, finish } })}
          />
          <Select
            variant="bare"
            aria-label="Plating"
            value={draft.metal.plating}
            options={platingOptions}
            onChange={(plating) => patch({ metal: { ...draft.metal, plating } })}
          />
        </Row>

        {draft.ring && (
          <Row label="Ring">
            <div className="flex items-center gap-1">
              <Select
                variant="bare"
                aria-label="Size system"
                value={draft.ring.size.system}
                options={sizeSystemOptions}
                onChange={(system) =>
                  draft.ring &&
                  patch({ ring: { ...draft.ring, size: { ...draft.ring.size, system } } })
                }
              />
              <NumberField
                size="sm"
                aria-label="Ring size"
                className="w-20"
                value={draft.ring.size.value}
                step={draft.ring.size.system === 'mm' ? 0.1 : 0.25}
                precision={2}
                onCommit={(value) =>
                  value !== null &&
                  draft.ring &&
                  patch({ ring: { ...draft.ring, size: { ...draft.ring.size, value } } })
                }
              />
            </div>
            <NumberField
              size="sm"
              label="W"
              unit="mm"
              className="w-28"
              value={draft.ring.bandWidthMm ?? null}
              min={1}
              max={14}
              step={0.1}
              onCommit={(v) =>
                draft.ring && patch({ ring: { ...draft.ring, bandWidthMm: v ?? undefined } })
              }
            />
            <NumberField
              size="sm"
              label="T"
              unit="mm"
              className="w-28"
              value={draft.ring.bandThicknessMm ?? null}
              min={0.9}
              max={5}
              step={0.1}
              onCommit={(v) =>
                draft.ring && patch({ ring: { ...draft.ring, bandThicknessMm: v ?? undefined } })
              }
            />
          </Row>
        )}

        {draft.body && (
          <Row label="Body">
            {draft.body.text !== undefined && (
              <Input
                className="h-7 w-40"
                aria-label="Text"
                value={draft.body.text}
                onChange={(e) =>
                  draft.body &&
                  setDraft({ ...draft, body: { ...draft.body, text: e.target.value } })
                }
                onBlur={() => save(draft)}
              />
            )}
            <NumberField
              size="sm"
              label="H"
              unit="mm"
              className="w-28"
              value={draft.body.heightMm}
              min={3}
              max={200}
              step={0.5}
              onCommit={(v) =>
                v !== null && draft.body && patch({ body: { ...draft.body, heightMm: v } })
              }
            />
            {draft.body.shape && <span className="text-sm text-fg-muted">{draft.body.shape}</span>}
          </Row>
        )}

        {draft.chain && (
          <Row label="Chain">
            <span className="px-1.5 text-sm capitalize">{draft.chain.style}</span>
            <NumberField
              size="sm"
              label="L"
              unit="mm"
              className="w-28"
              value={draft.chain.lengthMm}
              min={100}
              max={900}
              step={1}
              onCommit={(v) =>
                v !== null && draft.chain && patch({ chain: { ...draft.chain, lengthMm: v } })
              }
            />
            <NumberField
              size="sm"
              label="W"
              unit="mm"
              className="w-28"
              value={draft.chain.widthMm}
              min={0.8}
              max={25}
              step={0.1}
              onCommit={(v) =>
                v !== null && draft.chain && patch({ chain: { ...draft.chain, widthMm: v } })
              }
            />
          </Row>
        )}

        {draft.stones.length > 0 && (
          <Row label="Stones" align="start">
            <div className="flex w-full flex-col gap-1">
              {draft.stones.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1">
                  <span className="w-14 shrink-0 px-1.5 text-xs text-fg-subtle">
                    {ROLE_LABEL[s.role]}
                  </span>
                  <Select
                    variant="bare"
                    aria-label="Cut"
                    value={s.cut}
                    options={cutOptions}
                    onChange={(cut) => patchStone(i, { cut })}
                  />
                  <Select
                    variant="bare"
                    aria-label="Stone"
                    value={s.stone}
                    options={stoneOptions}
                    onChange={(stone) => patchStone(i, { stone })}
                  />
                  {s.carat !== undefined ? (
                    <NumberField
                      size="sm"
                      unit="ct"
                      aria-label="Carat"
                      className="w-24"
                      value={s.carat}
                      min={0.01}
                      max={100}
                      step={0.05}
                      onCommit={(v) => v !== null && patchStone(i, { carat: v })}
                    />
                  ) : (
                    <NumberField
                      size="sm"
                      unit="mm"
                      aria-label="Width"
                      className="w-24"
                      value={s.widthMm ?? null}
                      min={0.5}
                      max={40}
                      step={0.05}
                      onCommit={(v) => patchStone(i, { widthMm: v ?? undefined })}
                    />
                  )}
                  {s.setting && (
                    <span className="px-1.5 text-xs text-fg-muted">
                      {SETTING_LABEL[s.setting]}
                      {s.prongs ? ` · ${s.prongs} prongs` : ''}
                    </span>
                  )}
                  {s.count && s.count > 1 && (
                    <span className="font-mono text-xs text-fg-muted tabular">×{s.count}</span>
                  )}
                </div>
              ))}
            </div>
          </Row>
        )}

        {(draft.budgetUsd || draft.targetWeightG || draft.engraving) && (
          <Row label="Constraints">
            {draft.budgetUsd && (
              <span className="px-1.5 font-mono text-xs tabular">
                ≤ ${draft.budgetUsd.toLocaleString()}
              </span>
            )}
            {draft.targetWeightG && (
              <span className="px-1.5 font-mono text-xs tabular">≈ {draft.targetWeightG} g</span>
            )}
            {draft.engraving && (
              <span className="px-1.5 text-sm italic text-fg-muted">“{draft.engraving}”</span>
            )}
          </Row>
        )}
      </dl>

      {draft.openQuestions.length > 0 && (
        <div className="border-t border-line bg-[color-mix(in_oklab,var(--warn)_7%,transparent)] px-5 py-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warn">
            <CircleHelp className="size-3.5" aria-hidden />
            {draft.openQuestions.length === 1
              ? 'One open question'
              : `${draft.openQuestions.length} open questions`}
          </div>
          <ul className="flex flex-col gap-1">
            {draft.openQuestions.map((q, i) => (
              <li key={i} className="group flex items-start gap-2 text-sm">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-warn" aria-hidden />
                <span className="flex-1 py-0.5">{q}</span>
                <button
                  type="button"
                  onClick={() =>
                    assistant.open({
                      prompt: `About the open question “${q}”: `,
                      context: { pieceId: piece.id },
                    })
                  }
                  className="hover-reveal h-6 shrink-0 rounded-xs px-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  Answer
                </button>
                <button
                  type="button"
                  aria-label="Mark resolved"
                  title="Mark resolved"
                  onClick={() =>
                    patch({ openQuestions: draft.openQuestions.filter((_, j) => j !== i) })
                  }
                  className="hover-reveal inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:bg-bg-hover hover:text-fg"
                >
                  <Check className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BuildFooter piece={piece} openQuestions={draft.openQuestions.length} />
    </Card>
  )
}

function BuildFooter({ piece, openQuestions }: { piece: Piece; openQuestions: number }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const build = useRpcMutation('pieces.buildFromSpec', {
    onSuccess: () => {
      setConfirm(false)
      void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
    },
  })
  const hasDesign = piece.design.order.length > 0
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
      <p className="text-xs text-fg-subtle">
        {openQuestions
          ? 'You can build now; open questions use sensible defaults.'
          : hasDesign
            ? 'Rebuilding replaces the current design. History keeps the old one.'
            : 'Turns this plan into an editable CAD model.'}
      </p>
      <Button
        variant="primary"
        icon={Hammer}
        disabled={build.isPending}
        onClick={() => (hasDesign ? setConfirm(true) : build.mutate({ id: piece.id }))}
      >
        {build.isPending ? 'Building…' : 'Build CAD from spec'}
      </Button>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Rebuild the CAD from this spec?"
        description="The current design will be replaced by a fresh build. You can revert from History."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={build.isPending}
              onClick={() => build.mutate({ id: piece.id })}
            >
              Rebuild
            </Button>
          </>
        }
      />
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Spec"
      className="overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]"
    >
      {children}
    </section>
  )
}

function Row({
  label,
  children,
  align = 'center',
}: {
  label: string
  children: ReactNode
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={`grid grid-cols-[104px_1fr] gap-3 px-5 py-2 ${align === 'start' ? 'items-start' : 'items-center'}`}
    >
      <dt className={`text-sm text-fg-subtle ${align === 'start' ? 'pt-1' : ''}`}>{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">{children}</dd>
    </div>
  )
}
