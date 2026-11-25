/**
 * One turn's words: the person's message (with the photos it carried) on the right, the
 * assistant's answer as markdown on the left. Markdown never renders raw HTML.
 */
import { Markdown } from '@pave/ui'
import { ImageIcon } from 'lucide-react'
import { assetUrl } from '../../lib/assets'

export function UserMessage({
  text,
  photos,
  photoIds,
}: {
  text: string
  /** How many photos the stored message carries. */
  photos: number
  /** Their asset ids, when this window sent them (the server keeps pixels, not ids). */
  photoIds?: string[]
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {photos > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {Array.from({ length: photos }, (_, i) =>
            photoIds?.[i] ? (
              <img
                key={photoIds[i]}
                src={assetUrl(photoIds[i]!, 160)}
                alt="Attached"
                className="size-16 rounded-md object-cover shadow-[0_0_0_1px_var(--line)]"
              />
            ) : (
              <span
                key={i}
                className="flex size-16 items-center justify-center rounded-md bg-bg-muted text-fg-subtle"
                title="Attached photo"
              >
                <ImageIcon className="size-4" aria-label="Attached photo" />
              </span>
            ),
          )}
        </div>
      )}
      <div className="max-w-[88%] rounded-lg bg-bg-muted px-3 py-2 text-sm leading-6 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

export function AssistantText({ text, live }: { text: string; live?: boolean }) {
  return <Markdown className={live ? 'text-fg' : undefined}>{text}</Markdown>
}
