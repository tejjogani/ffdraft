/**
 * The one composer, on Home and in the dock: text that grows, photos by button, drag and drop or
 * paste (shown as thumbnails, removable), context chips above, the tier picker below, and Enter
 * to send (Shift+Enter for a new line; never while an input method is composing, so Japanese or
 * Chinese input can confirm a word with Enter).
 */
import { Button, cn, IconButton, Spinner, Textarea, toast } from '@pave/ui'
import { ArrowUp, CircleStop, FileBox, ImagePlus, X } from 'lucide-react'
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { assetUrl, uploadAsset } from '../../lib/assets'
import type { Attachment } from '../../stores/assistant'
import { isSendKey } from './keys'

const MAX_PHOTOS = 8

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  attachments: Attachment[]
  onAttach: (a: Attachment[]) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: () => void
  /** A run is going: the send button becomes Stop. */
  running?: boolean
  onStop?: () => void
  disabled?: boolean
  sending?: boolean
  placeholder?: string
  /** Above the text: context chips. */
  chips?: ReactNode
  /** Beside the attach button: the tier picker. */
  tools?: ReactNode
  /** Bumped from outside to move focus here (Ask AI, mod+j). */
  focusNonce?: number
  variant?: 'dock' | 'home'
  label?: string
  submitLabel?: string
  files?: { accept: string; model: (name: string) => boolean }
  allowAttachmentOnly?: boolean
}

export function Composer({
  value,
  onChange,
  attachments,
  onAttach,
  onRemoveAttachment,
  onSubmit,
  running,
  onStop,
  disabled,
  sending,
  placeholder = 'Ask anything…',
  chips,
  tools,
  focusNonce,
  variant = 'dock',
  label = 'Message the assistant',
  submitLabel = 'Send',
  files,
  allowAttachmentOnly = false,
}: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (focusNonce) input.current?.focus()
  }, [focusNonce])

  const attach = async (incoming: File[]) => {
    const supported = incoming.filter((f) => f.type.startsWith('image/') || files?.model(f.name))
    if (!supported.length) return
    const room = MAX_PHOTOS - attachments.length
    if (room <= 0) return toast.error('Up to 8 photos per message')
    setUploading((n) => n + 1)
    try {
      const uploaded = await Promise.allSettled(
        supported.slice(0, room).map((file) => uploadAsset(file)),
      )
      onAttach(
        uploaded.flatMap((r) =>
          r.status === 'fulfilled' ? [{ id: r.value.id, name: r.value.name }] : [],
        ),
      )
      const refused = uploaded.filter((r) => r.status === 'rejected').length
      if (refused)
        toast.error(
          refused === 1
            ? 'One attachment could not be uploaded'
            : `${refused} attachments could not be uploaded`,
        )
    } catch (e) {
      toast.error('Couldn’t attach that photo', e instanceof Error ? e.message : undefined)
    } finally {
      setUploading((n) => n - 1)
    }
  }

  const canSend =
    (!!value.trim() || (allowAttachmentOnly && attachments.length > 0)) &&
    !disabled &&
    !sending &&
    uploading === 0
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSendKey({ ...e, isComposing: e.nativeEvent.isComposing })) return
    e.preventDefault()
    if (canSend) onSubmit()
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files]
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      void attach(files)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void attach([...e.dataTransfer.files])
  }

  const home = variant === 'home'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (canSend) onSubmit()
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
      className={cn(
        'p-px transition-[background] duration-180 focus-within:ai-gradient',
        home ? 'rounded-[13px] bg-line-strong shadow-sm' : 'rounded-[9px] bg-line-strong',
        dragging && 'ai-gradient',
      )}
    >
      <div className={cn('relative bg-bg', home ? 'rounded-lg' : 'rounded-lg')}>
        {chips && <div className="flex flex-wrap gap-1 px-2.5 pt-2.5 empty:hidden">{chips}</div>}
        <Textarea
          ref={input}
          bare
          minRows={home ? 3 : 2}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label={label}
          className={cn(
            'max-h-[40vh] overflow-y-auto!',
            home ? 'px-4 pt-4 text-base leading-6' : 'px-3 pt-2.5',
          )}
        />
        {(attachments.length > 0 || uploading > 0) && (
          <ul aria-label="Attached photos" className="flex flex-wrap gap-1.5 px-3 pt-1 pb-1">
            {attachments.map((a) => (
              <li key={a.id} className="group relative">
                {files?.model(a.name) ? (
                  <span
                    className="flex size-12 items-center justify-center rounded-md bg-bg-muted"
                    role="img"
                    aria-label={a.name}
                    title={a.name}
                  >
                    <FileBox className="size-5" aria-hidden />
                  </span>
                ) : (
                  <img
                    src={assetUrl(a.id, 160)}
                    alt={a.name}
                    className="size-12 rounded-md object-cover shadow-[0_0_0_1px_var(--line)]"
                  />
                )}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                  className="absolute -top-1.5 -right-1.5 inline-flex size-4.5 items-center justify-center rounded-full bg-ink text-ink-fg shadow-sm [&_svg]:size-3"
                >
                  <X aria-hidden />
                </button>
              </li>
            ))}
            {uploading > 0 && (
              <li className="flex size-12 items-center justify-center rounded-md bg-bg-muted">
                <Spinner className="size-3.5" label="Uploading" />
              </li>
            )}
          </ul>
        )}
        <div className={cn('flex items-center gap-1', home ? 'p-2 pl-2.5' : 'px-1.5 pb-1.5')}>
          <input
            ref={file}
            type="file"
            accept={files?.accept ?? 'image/*'}
            multiple
            hidden
            onChange={(e) => {
              void attach([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          {home ? (
            <Button
              variant="ghost"
              size="sm"
              icon={ImagePlus}
              disabled={disabled || attachments.length >= MAX_PHOTOS}
              onClick={() => file.current?.click()}
            >
              {files ? 'Attach file' : 'Add photo'}
            </Button>
          ) : (
            <IconButton
              icon={ImagePlus}
              label="Attach photos"
              disabled={disabled || attachments.length >= MAX_PHOTOS}
              onClick={() => file.current?.click()}
            />
          )}
          {tools}
          <div className="ml-auto">
            {running && onStop && !value.trim() ? (
              <Button
                variant="secondary"
                size={home ? 'md' : 'sm'}
                square
                icon={CircleStop}
                aria-label="Stop"
                title="Stop (Esc)"
                onClick={onStop}
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                size={home ? 'md' : 'sm'}
                square
                icon={sending ? undefined : ArrowUp}
                aria-label={submitLabel}
                disabled={!canSend}
              >
                {sending && <Spinner className="size-3.5" label="Sending" />}
              </Button>
            )}
          </div>
        </div>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-bg/80 text-sm text-fg-muted">
            Drop photos to attach
          </div>
        )}
      </div>
    </form>
  )
}
