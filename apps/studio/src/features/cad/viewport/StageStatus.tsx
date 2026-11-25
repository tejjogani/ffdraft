/**
 * What the viewport says while there is nothing (or nothing new) to show: the engine is not
 * available here, the piece is still being prepared, or the last evaluation failed.
 */
import { cn, InlineError, Spinner } from '@pave/ui'
import { assetUrl } from '../../../lib/assets'
import type { EvaluationStatus } from '../../../lib/kernel/usePieceEvaluation'

export function StageStatus({
  status,
  coverAssetId,
  error,
  failure,
  hasEvaluation,
  onRetry,
}: {
  status: EvaluationStatus
  coverAssetId: string | null
  /** Why the engine is unavailable. */
  error?: string
  /** Why the latest evaluation failed. */
  failure?: string | null
  hasEvaluation: boolean
  onRetry(): void
}) {
  if (status === 'unavailable')
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="font-serif text-[24px] leading-8 text-fg">The 3D view isn’t available here</p>
        <p className="max-w-sm text-sm text-fg-muted">
          You can keep editing by numbers in the list and the inspector; every change is saved.
          {error ? ` (${error})` : ''}
        </p>
      </div>
    )
  if (hasEvaluation) return null
  // A failed first evaluation is said, with a way to ask again: the engine may have been
  // replaced since, and nothing else would evaluate this same design a second time.
  if (status === 'error')
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="font-serif text-[24px] leading-8 text-fg">The piece couldn’t be drawn</p>
        <p className="max-w-sm text-sm text-fg-muted">
          You can keep editing by numbers in the list and the inspector; every change is saved.
        </p>
        <InlineError
          message={failure || 'The geometry engine did not answer.'}
          onRetry={onRetry}
          className="max-w-full"
        />
      </div>
    )
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      {coverAssetId && (
        <img
          src={assetUrl(coverAssetId, 480)}
          alt=""
          className="max-h-[40%] max-w-[40%] object-contain opacity-60"
        />
      )}
      <p className={cn('flex items-center gap-2 text-sm text-fg-muted')}>
        <Spinner className="size-3.5" /> Preparing the workbench…
      </p>
    </div>
  )
}
