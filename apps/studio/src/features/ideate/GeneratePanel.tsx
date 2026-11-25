/**
 * Concept images on the design board. The designer writes what they want and picks board pictures
 * to work from; Claude reads it, checks it against Pavé's rules and writes the enhanced jewelry
 * prompt, shown here before anything is paid for; the provider then makes four images, each
 * checked by Claude before it is kept. A refusal says why in plain words; another company's brand
 * needs the designer's attestation. Each result can go to CAD, be varied or refined.
 *
 * Everything is a server command (references.brief, .attestBrief, .generate); this panel keeps
 * only the draft request, the picks and the latest brief and result.
 */
import type { Board, CommandOutput, GenerationRole, ImageBrief, Reference } from '@pave/schema'
import { Button, Chip, cn, Segmented, Select, Textarea, Tooltip, toast } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Hammer, Lock, RefreshCw, ShieldAlert, Sparkles, Wand2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { modelName } from '../../lib/format'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { type RpcError, rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { perImage } from '../images/ImageSettings'

type Result = CommandOutput<'references.generate'>
type Mode = ImageBrief['mode']

const ROLE_WORDS: Partial<Record<GenerationRole, string>> = { subject: 'Subject', style: 'Style' }
const usd = (v: number) => (v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)

/** Board pictures that may be sent to an image model (never a view-only one). */
export const sendable = (r: Reference) =>
  !!r.assetId && (r.type === 'image' || r.type === 'generated') && r.rights !== 'viewOnly'

export function GeneratePanel({
  board,
  references,
  onClose,
  onTakeToCad,
}: {
  board: Board
  references: Reference[]
  onClose: () => void
  onTakeToCad: (r: Reference) => void
}) {
  const { capabilities } = useSession()
  const setup = useRpc('images.setup.get', {})
  const [request, setRequest] = useState('')
  const [picked, setPicked] = useState<{ id: string; role: GenerationRole }[]>([])
  const [mode, setMode] = useState<{ mode: Mode; parent: Reference } | null>(null)
  const [brief, setBrief] = useState<ImageBrief | null>(null)
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState<'2' | '4'>('4')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState<'brief' | 'generate' | 'attest' | null>(null)
  const [rights, setRights] = useState<'own' | 'licensed' | 'permission'>('own')
  const input = useRef<HTMLTextAreaElement>(null)

  const pictures = references.filter(
    (r) => r.assetId && (r.type === 'image' || r.type === 'generated'),
  )
  const available = capabilities.imageGeneration
  const providers = (setup.data?.providers ?? []).filter((p) => available.includes(p.id))
  const provider =
    board.imageProvider && available.includes(board.imageProvider)
      ? board.imageProvider
      : (setup.data?.defaultProvider ?? available[0] ?? null)

  const fail = (what: string) => (e: unknown) =>
    toast.error(`Couldn’t ${what}`, (e as RpcError).message)

  const writeBrief = async (override?: { mode: Mode; parent: Reference; request: string }) => {
    const m = override ?? (mode ? { ...mode, request } : null)
    const text = (override?.request ?? request).trim()
    if (text.length < 2) return
    setBusy('brief')
    setResult(null)
    try {
      const b = await rpc.call('references.brief', {
        boardId: board.id,
        request: text,
        referenceIds: picked.map((p) => p.id),
        roles: picked,
        mode: m?.mode ?? 'new',
        ...(m ? { parentId: m.parent.id } : {}),
      })
      setBrief(b)
      setPrompt(b.prompt)
      invalidateFor(queryClient, 'usage')
    } catch (e) {
      fail('read the request')(e)
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    if (!brief) return
    setBusy('generate')
    try {
      const out = await rpc.call('references.generate', {
        briefId: brief.id,
        count: Number(count),
        ...(prompt.trim() && prompt.trim() !== brief.prompt ? { prompt: prompt.trim() } : {}),
      })
      setResult(out)
      setBrief(out.brief)
      setPrompt(out.brief.prompt)
      invalidateFor(queryClient, 'references')
    } catch (e) {
      fail('generate the images')(e)
      // A refused edit is recorded on the brief: show its latest state.
      const briefs = await rpc
        .call('references.briefs', { boardId: board.id, limit: 1 })
        .catch(() => [])
      if (briefs[0]?.id === brief.id) setBrief(briefs[0])
    } finally {
      setBusy(null)
    }
  }

  const attest = async () => {
    if (!brief) return
    setBusy('attest')
    try {
      const b = await rpc.call('references.attestBrief', { id: brief.id, rights })
      setBrief(b)
      setPrompt(b.prompt)
    } catch (e) {
      fail('record that')(e)
    } finally {
      setBusy(null)
    }
  }

  const toggle = (r: Reference) =>
    setPicked((p) =>
      p.some((x) => x.id === r.id)
        ? p.filter((x) => x.id !== r.id)
        : [
            ...p,
            { id: r.id, role: (p.length === 0 ? 'subject' : 'style') as GenerationRole },
          ].slice(0, 8),
    )

  const vary = (r: Reference) => {
    setMode({ mode: 'vary', parent: r })
    void writeBrief({ mode: 'vary', parent: r, request: 'A variation of this image' })
  }
  const refine = (r: Reference) => {
    setMode({ mode: 'refine', parent: r })
    setBrief(null)
    setRequest('')
    input.current?.focus()
  }

  const ready =
    brief && (brief.verdict === 'allow' || (brief.verdict === 'needs_rights' && brief.attestation))
  const kept = result ? result.references : []

  return (
    <section
      aria-label="Generate concepts"
      data-generate-panel
      className="reveal flex flex-col gap-3 rounded-lg bg-bg p-4 shadow-[0_0_0_1px_var(--line)]"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-ai" aria-hidden />
        <h2 className="text-sm font-medium">Generate concepts</h2>
        {providers.length > 1 && provider && (
          <Select<string>
            aria-label="Image provider for this board"
            className="w-44"
            value={provider}
            options={providers.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(v) =>
              void rpc
                .call('boards.update', { id: board.id, imageProvider: v as Board['imageProvider'] })
                .then(() => invalidateFor(queryClient, 'boards'))
                .catch(fail('change the provider'))
            }
          />
        )}
        {providers.length === 1 && <Chip>{providers[0]!.label}</Chip>}
        <Button size="sm" variant="ghost" icon={X} className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </header>

      {available.length === 0 ? (
        <p className="text-sm text-fg-muted" data-no-image-key>
          Concept images need an image provider’s key (Google Gemini, OpenAI or Higgsfield). An
          owner or admin can add one in{' '}
          <Link to="/settings/ai" className="underline underline-offset-2">
            Settings › AI
          </Link>
          ; everything else on the board works without it.
        </p>
      ) : !capabilities.assistant ? (
        <p className="text-sm text-fg-muted" data-no-claude-key>
          Concept images also need the Claude API key: Claude writes the prompt and checks every
          image. Add it in{' '}
          <Link to="/settings/ai" className="underline underline-offset-2">
            Settings › AI
          </Link>
          .
        </p>
      ) : (
        <>
          {pictures.length > 0 && !mode && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs text-fg-subtle">
                Work from these pictures (optional)
              </legend>
              <ul className="flex flex-wrap gap-2" aria-label="Pictures to work from">
                {pictures.map((r) => {
                  const on = picked.find((p) => p.id === r.id)
                  const locked = !sendable(r)
                  const thumb = (
                    <button
                      type="button"
                      aria-pressed={!!on}
                      disabled={locked}
                      aria-label={`${locked ? 'View only: ' : 'Use '}${r.title || 'picture'}`}
                      onClick={() => toggle(r)}
                      className={cn(
                        'relative block size-16 overflow-hidden rounded-md bg-bg-muted shadow-[0_0_0_1px_var(--line)]',
                        on && 'shadow-[0_0_0_2px_var(--select)]',
                        locked && 'opacity-50',
                      )}
                    >
                      <img
                        src={assetUrl(r.assetId!, 160)}
                        alt=""
                        className="size-full object-cover"
                      />
                      {locked && (
                        <Lock className="absolute right-1 top-1 size-3.5 text-fg" aria-hidden />
                      )}
                      {on && (
                        <span className="absolute inset-x-0 bottom-0 bg-bg/80 text-center text-3xs">
                          {picked.indexOf(on) + 1}
                        </span>
                      )}
                    </button>
                  )
                  return (
                    <li key={r.id} className="flex flex-col items-center gap-1">
                      {locked ? (
                        <Tooltip content="View only: it can’t be sent to AI">{thumb}</Tooltip>
                      ) : (
                        thumb
                      )}
                      {on && (
                        <Segmented<GenerationRole>
                          size="sm"
                          aria-label={`Role of ${r.title || 'picture'}`}
                          value={on.role}
                          onChange={(role) =>
                            setPicked((p) => p.map((x) => (x.id === r.id ? { ...x, role } : x)))
                          }
                          options={(['subject', 'style'] as const).map((v) => ({
                            value: v,
                            label: ROLE_WORDS[v]!,
                          }))}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )}

          {mode && (
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <img
                src={assetUrl(mode.parent.assetId!, 120)}
                alt=""
                className="size-10 rounded object-cover"
              />
              <span>
                {mode.mode === 'vary' ? 'Varying' : 'Refining'} “{mode.parent.title}”
              </span>
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                Start over
              </Button>
            </div>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void writeBrief()
            }}
          >
            <Textarea
              ref={input}
              minRows={2}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              aria-label="What do you want?"
              placeholder={
                mode?.mode === 'refine'
                  ? 'What should change? (a smaller bail, rose gold, a pear stone)'
                  : 'This trophy as a pendant, in the style of this pendant'
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                variant={brief ? 'secondary' : 'primary'}
                icon={Wand2}
                disabled={!!busy || request.trim().length < 2}
              >
                {busy === 'brief'
                  ? 'Reading your request…'
                  : brief
                    ? 'Write it again'
                    : 'Write the prompt'}
              </Button>
              <span className="text-xs text-fg-subtle">
                Claude reads it, checks it and writes the prompt; nothing is generated yet.
              </span>
            </div>
          </form>

          {busy === 'brief' && !brief && <div className="skeleton h-24 rounded-md" aria-hidden />}

          {brief && <BriefCard brief={brief} prompt={prompt} onPrompt={setPrompt} />}

          {brief?.verdict === 'needs_rights' && !brief.attestation && (
            <fieldset
              data-attest
              className="flex flex-col gap-2 rounded-md bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] p-3"
            >
              <legend className="sr-only">Your right to use it</legend>
              <p className="text-sm">
                Do you own <strong>{brief.rightsSubject ?? 'this design'}</strong>, or may you use
                it?
              </p>
              <Segmented<'own' | 'licensed' | 'permission'>
                aria-label="Your right to use it"
                value={rights}
                onChange={setRights}
                options={[
                  { value: 'own', label: 'I own it' },
                  { value: 'licensed', label: 'I have a licence' },
                  { value: 'permission', label: 'I have permission' },
                ]}
              />
              <div>
                <Button size="sm" onClick={() => void attest()} disabled={busy === 'attest'}>
                  {busy === 'attest' ? 'Saving…' : 'I confirm, go on'}
                </Button>
              </div>
            </fieldset>
          )}

          {ready && (
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<'2' | '4'>
                size="sm"
                aria-label="How many images"
                value={count}
                onChange={setCount}
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                ]}
              />
              <Button
                size="sm"
                variant="primary"
                icon={result ? RefreshCw : Sparkles}
                disabled={!!busy || prompt.trim().length < 3}
                onClick={() => void generate()}
              >
                {busy === 'generate'
                  ? 'Generating and checking…'
                  : `${result ? 'Generate again' : 'Generate'} ${count} · ${usd(brief.estimate.perImageUsd * Number(count))}`}
              </Button>
              <span className="text-xs text-fg-subtle">
                about {Math.round(brief.estimate.seconds)} s · each image is checked before it is
                kept
              </span>
            </div>
          )}

          {busy === 'generate' && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden>
              {Array.from({ length: Number(count) }, (_, i) => (
                <li key={i} className="skeleton aspect-square rounded-md" />
              ))}
            </ul>
          )}

          {result && busy !== 'generate' && (
            <section aria-label="Generated images" className="flex flex-col gap-2">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {kept.map((r) => (
                  <li
                    key={r.id}
                    className="reveal overflow-hidden rounded-md bg-bg shadow-[0_0_0_1px_var(--line)]"
                    data-generated={r.id}
                  >
                    <img
                      src={assetUrl(r.assetId!, 480)}
                      alt={r.title}
                      className="aspect-square w-full bg-bg-muted object-cover"
                    />
                    <div className="flex flex-wrap items-center gap-1 p-1.5">
                      <span className="mr-auto font-mono text-3xs text-fg-subtle tabular">
                        {r.generation?.costUsd != null ? usd(r.generation.costUsd) : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Hammer}
                        onClick={() => onTakeToCad(r)}
                      >
                        Take to CAD
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => vary(r)} disabled={!!busy}>
                        Vary
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => refine(r)} disabled={!!busy}>
                        Refine
                      </Button>
                    </div>
                  </li>
                ))}
                {result.refused.map((x) => (
                  <li
                    key={`refused-${x.index}`}
                    data-refused-image={x.index}
                    className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg))] p-3 text-center shadow-[0_0_0_1px_var(--line)]"
                  >
                    <ShieldAlert className="size-4 text-danger" aria-hidden />
                    <span className="text-xs font-medium">Image {x.index} was not kept</span>
                    <span className="text-3xs leading-4 text-fg-muted">{x.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-subtle" data-generation-cost>
                {kept.length} kept · images {usd(result.cost.imageUsd)}
                {result.cost.estimated ? ' (estimated)' : ''} · Claude {usd(result.cost.claudeUsd)}{' '}
                · {providers.find((p) => p.id === result.provider)?.label ?? result.provider} (
                {result.model})
              </p>
              {result.notes.map((n) => (
                <p key={n} className="text-xs text-fg-muted">
                  {n}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </section>
  )
}

/** Claude's brief: what it understood, the verdict, and the prompt it will send (editable). */
function BriefCard({
  brief,
  prompt,
  onPrompt,
}: {
  brief: ImageBrief
  prompt: string
  onPrompt: (p: string) => void
}) {
  if (brief.verdict === 'refuse')
    return (
      <div
        role="status"
        data-brief-refused
        className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] p-3"
      >
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Not generated</p>
          <p className="text-sm text-fg-muted">{brief.reason}</p>
          <p className="text-xs text-fg-subtle">
            Nothing was made or charged beyond reading the request.
          </p>
        </div>
      </div>
    )
  const facts = [brief.piece.kind, brief.piece.metal, brief.piece.stones, brief.piece.view].filter(
    (x): x is string => !!x,
  )
  return (
    <div className="flex flex-col gap-2 rounded-md bg-bg-muted/60 p-3" data-brief={brief.verdict}>
      <p className="text-sm">{brief.understanding}</p>
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {facts.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </div>
      )}
      {brief.verdict === 'needs_rights' && <p className="text-sm text-fg-muted">{brief.reason}</p>}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">
          Enhanced prompt (what the image model receives; edit it if you like, and it is checked
          again)
        </span>
        <Textarea
          minRows={3}
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          aria-label="Enhanced prompt"
          className="font-mono text-xs leading-5"
        />
      </div>
      <p className="text-3xs text-fg-subtle">
        {perImage(brief.estimate.perImageUsd)} an image · prompt by {modelName(brief.claudeModel)},
        prompt alone ({usd(brief.claudeUsd)})
      </p>
    </div>
  )
}
