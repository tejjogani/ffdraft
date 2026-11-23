import { Button, Chip, Textarea, toast } from '@pave/ui'
import { ArrowUp, ImagePlus, X } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { uploadAsset } from '../../lib/assets'
import { assistant } from '../../stores/assistant'

const SUGGESTIONS = [
  '1.5 ct oval, hidden halo, 18k yellow',
  'Turn a logo into an iced pendant',
  'Men’s signet with family crest',
  'Stackable eternity bands in three golds',
]

interface Attachment {
  id: string
  name: string
}

/** The home page's large composer. Submitting hands the prompt to the assistant dock. */
export function Composer() {
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const send = (text: string) => {
    if (!text.trim()) return
    assistant.open({ prompt: text.trim(), attachments: attachments.map((a) => a.id) })
    setPrompt('')
    setAttachments([])
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    send(prompt)
  }

  const attach = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const uploaded = await Promise.all([...files].map(uploadAsset))
      setAttachments((a) => [...a, ...uploaded.map((u) => ({ id: u.id, name: u.name }))])
    } catch (e) {
      toast.error('Couldn’t attach that file', e instanceof Error ? e.message : undefined)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <form
        onSubmit={onSubmit}
        className="rounded-xl bg-line-strong p-px shadow-sm transition-[background] duration-180 focus-within:ai-gradient"
      >
        <div className="rounded-[11px] bg-bg">
          <Textarea
            bare
            minRows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(prompt)
              }
            }}
            placeholder="What are we making?"
            aria-label="Describe a piece for the assistant"
            className="px-4 pt-4 text-base leading-6"
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-1">
              {attachments.map((a) => (
                <Chip key={a.id} outline className="pr-0.5">
                  <span className="max-w-40 truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    className="inline-flex size-4 items-center justify-center rounded-xs hover:bg-bg-hover"
                  >
                    <X aria-hidden />
                  </button>
                </Chip>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between p-2 pl-2.5">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void attach(e.target.files)
                e.target.value = ''
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={ImagePlus}
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? 'Attaching…' : 'Add reference'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              square
              icon={ArrowUp}
              aria-label="Send to assistant"
              disabled={!prompt.trim()}
            />
          </div>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="h-7 rounded-sm px-2.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-120 hover:bg-bg-hover hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
