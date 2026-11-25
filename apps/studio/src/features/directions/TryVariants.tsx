/**
 * Try variants: AI alternatives of the current CAD, compared side by side, off the main path.
 * Each variant is a built design with real weights and carats; choosing one replaces the CAD as
 * one change that can be undone. They come from the assistant (asked in words) or from a
 * template. Variants used to be the Design stage; the Design stage is now the image board.
 */
import { VARIANTS_PROMPT } from '@pave/agent/studio'
import type { Piece } from '@pave/schema'
import { TEMPLATES } from '@pave/schema'
import { AiMark, Button, Menu, MenuItem, Sheet } from '@pave/ui'
import { LayoutTemplate, Shuffle } from 'lucide-react'
import { useState } from 'react'
import { useRpcMutation } from '../../lib/query'
import { useSession } from '../../lib/session'
import { openAssistant } from '../../stores/assistant'
import { useSend } from '../assistant/actions'
import { DirectionCards } from './DirectionCards'

export function TryVariants({ piece }: { piece: Piece }) {
  const [open, setOpen] = useState(false)
  const { capabilities } = useSession()
  const { send, pending } = useSend({ pieceId: piece.id, stage: 'cad' })
  const add = useRpcMutation('pieces.proposeDirections')
  const ofKind = TEMPLATES.filter((t) => t.spec.kind === piece.kind)
  const ask = async () => {
    const out = await send(VARIANTS_PROMPT, { pieceId: piece.id, bare: true, threadId: null })
    openAssistant({ pieceId: piece.id, threadId: out.thread.id })
  }
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Variants"
      className="sm:w-[640px]"
      trigger={
        <Button size="sm" variant="ghost" icon={Shuffle} aria-label="Try variants">
          <span className="max-md:hidden">Try variants</span>
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-6">
        <p className="text-sm text-fg-muted">
          Alternatives of this CAD to compare side by side, each built and checked. Choosing one
          replaces the CAD as one change you can undo; the others stay here.
        </p>
        <div className="flex flex-wrap gap-2">
          {capabilities.assistant && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => void ask()}>
              <AiMark className="size-3" /> Propose variants with AI
            </Button>
          )}
          <Menu
            trigger={
              <Button size="sm" variant="secondary" icon={LayoutTemplate} disabled={add.isPending}>
                {add.isPending ? 'Building…' : 'Add from a template'}
              </Button>
            }
          >
            {(ofKind.length ? ofKind : TEMPLATES).map((t) => (
              <MenuItem
                key={t.id}
                onClick={() =>
                  add.mutate({ pieceId: piece.id, directions: [{ templateId: t.id }] })
                }
              >
                {t.spec.title}
              </MenuItem>
            ))}
          </Menu>
        </div>
        {piece.directions.length ? (
          <DirectionCards piece={piece} />
        ) : (
          <p className="text-sm text-fg-subtle">No variants yet.</p>
        )}
      </div>
    </Sheet>
  )
}
