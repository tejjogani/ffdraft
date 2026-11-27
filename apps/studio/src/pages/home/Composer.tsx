/** Home saves the project and all attached files before starting a conversation. */
import type { AssistantTier } from '@pave/schema'
import { toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Composer as SharedComposer } from '../../features/assistant/Composer'
import { TierPicker } from '../../features/assistant/TierPicker'
import type { ProjectIntakeDraft } from '../../features/projects/new-project'
import { invalidateFor, queryClient } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import type { Attachment } from '../../stores/assistant'
import { firstMessageId, intakeFiles, sendIntake } from './intake'

const SUGGESTIONS = [
  '1.5 ct oval, hidden halo, 18k yellow',
  'Turn my logo into an iced pendant with a Cuban chain',
  'Men’s signet with family crest',
]

export function Composer({ draft }: { draft?: ProjectIntakeDraft }) {
  const { capabilities } = useSession()
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [tier, setTier] = useState<AssistantTier | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const retry = useRef<{ key: string; requestId: string } | null>(null)

  const submit = async (text: string) => {
    if (submitting.current) return
    const models = attachments.filter((a) => intakeFiles.model(a.name))
    const brief = text.trim() || (models.length ? `Open ${models[0]!.name} as CAD` : '')
    if (!brief) return
    const assetIds = attachments.map((a) => a.id)
    const key = JSON.stringify([brief, assetIds])
    if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() }
    submitting.current = true
    setBusy(true)
    try {
      const project = await rpc.call('pieces.startIntake', {
        requestId: retry.current.requestId,
        brief,
        assetIds,
        ...draft,
      })
      invalidateFor(queryClient, 'pieces')
      invalidateFor(queryClient, 'boards')
      let thread: string | undefined
      if (capabilities.assistant && !models.length && isCurrent()) {
        try {
          const out = await sendIntake({
            ...project,
            text: brief,
            attachments: assetIds,
            tier,
            messageId: firstMessageId(project.pieceId),
          })
          thread = out.thread.id
        } catch (e) {
          toast.error(
            'Project saved. The assistant could not reply.',
            e instanceof Error ? e.message : undefined,
          )
        }
      }
      setPrompt('')
      setAttachments([])
      retry.current = null
      if (isCurrent())
        await navigate({ to: '/', search: { intake: project.pieceId, thread }, replace: !!draft })
    } catch (e) {
      toast.error('Couldn’t save the project', e instanceof Error ? e.message : undefined)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <SharedComposer
        variant="home"
        value={prompt}
        onChange={setPrompt}
        attachments={attachments}
        onAttach={(a) => setAttachments((list) => [...list, ...a].slice(0, 8))}
        onRemoveAttachment={(id) => setAttachments((list) => list.filter((x) => x.id !== id))}
        onSubmit={() => void submit(prompt)}
        sending={busy}
        disabled={busy}
        files={intakeFiles}
        allowAttachmentOnly={attachments.some((a) => intakeFiles.model(a.name))}
        placeholder="Describe a piece, attach a reference, or bring finished CAD."
        label={draft ? 'Design brief' : 'Describe a piece for the assistant'}
        focusNonce={draft ? 1 : undefined}
        submitLabel="Start design intake"
        tools={capabilities.assistant ? <TierPicker value={tier} onChange={setTier} /> : undefined}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => setPrompt(s)}
            className="min-h-7 rounded-sm px-2.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-120 hover:bg-bg-hover hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
      {!capabilities.assistant && (
        <p className="mt-3 text-xs text-fg-subtle">
          Manual intake is available. Add a Claude API key in Settings → AI for a conversation.
        </p>
      )}
    </div>
  )
}
