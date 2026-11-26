/**
 * The home page's composer: the dock's own composer, large. Sending starts a conversation and
 * opens the dock on it. Without a Claude API key it still makes a piece: the words become the
 * piece's brief (templates are below).
 */
import type { AssistantTier } from '@pave/schema'
import { toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useSend } from '../../features/assistant/actions'
import { Composer as SharedComposer } from '../../features/assistant/Composer'
import { TierPicker } from '../../features/assistant/TierPicker'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { type Attachment, useAssistant } from '../../stores/assistant'

const SUGGESTIONS = [
  '1.5 ct oval, hidden halo, 18k yellow',
  'Turn a logo into an iced pendant',
  'Men’s signet with family crest',
]

export function Composer() {
  const { capabilities } = useSession()
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [tier, setTier] = useState<AssistantTier | null>(null)
  const [busy, setBusy] = useState(false)
  const { send } = useSend({})

  const submit = async (text: string) => {
    if (!text.trim()) return
    setBusy(true)
    try {
      if (capabilities.assistant) {
        // The dock's state carries the photos and tier of a new conversation.
        useAssistant.setState({
          attachments,
          draftTier: tier,
          selection: null,
          dropPageContext: true,
        })
        const out = await send(text.trim(), { threadId: null })
        if (!isCurrent()) return
        useAssistant.setState({
          follow: { threadId: out.thread.id, path: window.location.pathname },
        })
        useAssistant.getState().open()
      } else {
        const piece = await rpc.call('pieces.create', {
          title: text.trim().slice(0, 80),
          brief: text.trim(),
        })
        if (isCurrent()) await navigate({ to: '/pieces/$id', params: { id: piece.id } })
      }
      setPrompt('')
      setAttachments([])
    } catch (e) {
      toast.error('Couldn’t send that', e instanceof Error ? e.message : undefined)
    } finally {
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
        placeholder="What are we making? Describe it, or drop a photo of a piece."
        label="Describe a piece for the assistant"
        submitLabel={
          capabilities.assistant ? 'Send to assistant' : 'Create a piece from this brief'
        }
        tools={capabilities.assistant ? <TierPicker value={tier} onChange={setTier} /> : undefined}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void submit(s)}
            className="h-7 rounded-sm px-2.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-120 hover:bg-bg-hover hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
      {!capabilities.assistant && (
        <p className="mt-3 text-xs text-fg-subtle">
          The assistant is off until a Claude API key is added in Settings, AI; meanwhile this makes
          a piece with your words as its brief.
        </p>
      )}
    </div>
  )
}
