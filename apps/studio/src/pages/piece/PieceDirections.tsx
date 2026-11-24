/**
 * The Design stage: where a piece's direction is settled before any CAD. Directions are built
 * parametric variants compared side by side; they come from the stage's AI job ("Propose
 * directions with AI", in the header), from the assistant in chat, or by hand from templates.
 * Choosing one makes it the piece's design and opens CAD. The brief, references and spec the
 * job and the CAD stage read are below.
 */
import { TEMPLATES } from '@pave/schema'
import { Button, Menu, MenuItem, Skeleton } from '@pave/ui'
import { ImageOff, LayoutTemplate } from 'lucide-react'
import { SectionTitle } from '../../components/Page'
import { SpecCard } from '../../components/SpecCard'
import { DirectionCards } from '../../features/directions/DirectionCards'
import { useRpc, useRpcMutation } from '../../lib/query'
import { Brief, Moodboards } from './PieceOverview'

export function PieceDirections({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const add = useRpcMutation('pieces.proposeDirections')
  if (!piece.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  const p = piece.data
  const ofKind = TEMPLATES.filter((t) => t.spec.kind === p.kind)
  const templates = ofKind.length ? ofKind : TEMPLATES
  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Directions">
        <SectionTitle
          actions={
            <Menu
              trigger={
                <Button variant="ghost" size="sm" icon={LayoutTemplate} disabled={add.isPending}>
                  {add.isPending ? 'Building…' : 'Add from a template'}
                </Button>
              }
              align="end"
            >
              {templates.map((t) => (
                <MenuItem
                  key={t.id}
                  onClick={() => add.mutate({ pieceId: p.id, directions: [{ templateId: t.id }] })}
                >
                  {t.spec.title}
                </MenuItem>
              ))}
            </Menu>
          }
        >
          Directions
        </SectionTitle>
        {p.directions.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            No directions yet. Propose two to four with AI from the brief (the button at the top),
            or add one from a template. Each is a built design you can compare, mix and choose.
          </p>
        ) : (
          <DirectionCards piece={p} />
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs text-fg-subtle">
          <ImageOff className="mt-px size-3.5 shrink-0" aria-hidden />
          Image concepts (sketches or photoreal ideas) need an image model, which is not part of
          this setup. Directions here are built CAD variants with real weights and carats.
        </p>
      </section>
      <section>
        <SectionTitle>Brief</SectionTitle>
        <Brief piece={p} />
      </section>
      <Moodboards pieceId={pieceId} />
      <section>
        <SectionTitle>Spec</SectionTitle>
        <SpecCard piece={p} />
      </section>
    </div>
  )
}
