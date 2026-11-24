/**
 * The Design stage: where a piece's direction is settled before any CAD. Done by hand here
 * (the brief, the references, the spec) or by its AI job ("Propose directions with AI", in the
 * tab bar). The directions themselves, as comparable proposals, arrive with that job's next step;
 * until then this shows what the job and the CAD stage read.
 */
import { Skeleton } from '@pave/ui'
import { SectionTitle } from '../../components/Page'
import { SpecCard } from '../../components/SpecCard'
import { useRpc } from '../../lib/query'
import { Brief, Moodboards } from './PieceOverview'

export function PieceDirections({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  if (!piece.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  return (
    <div className="flex flex-col gap-10">
      <section>
        <SectionTitle>Brief</SectionTitle>
        <Brief piece={piece.data} />
      </section>
      <Moodboards pieceId={pieceId} />
      <section>
        <SectionTitle>Spec</SectionTitle>
        <SpecCard piece={piece.data} />
      </section>
    </div>
  )
}
