/**
 * Feature folder owned by the assistant workstream. Contract: `AssistantPanel`, the
 * conversation UI inside the dock (the dock, its header, resize and ⌘J live in app/).
 *
 * Read `useAssistant((s) => s.request)` for prompts handed over by `assistant.open(...)`, and
 * call `clearRequest()` once taken.
 */
import { AiMark, Button, IconButton, Textarea } from '@pave/ui'
import { ArrowUp, Paperclip } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type AssistantContext, useAssistant } from '../../stores/assistant'

export function AssistantPanel({ context: _context }: { context: AssistantContext }) {
  const request = useAssistant((s) => s.request)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (request?.prompt) setDraft(request.prompt)
  }, [request])
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <AiMark className="size-5" />
        <p className="font-serif text-[22px] leading-7">How can I help?</p>
        <p className="text-sm text-fg-muted">Plan a piece, edit the CAD, render, source stones.</p>
      </div>
      <div className="p-3">
        <div className="rounded-lg bg-bg shadow-[0_0_0_1px_var(--line-strong)] focus-within:shadow-[0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)]">
          <Textarea
            bare
            minRows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask anything…"
            className="px-3 pt-2.5"
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <IconButton icon={Paperclip} label="Attach reference" />
            <Button
              variant="primary"
              size="sm"
              square
              icon={ArrowUp}
              aria-label="Send"
              disabled={!draft.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
