import { Button } from '@pave/ui'

export function SelectionDetails({
  title,
  detail,
  onInspect,
}: {
  title: string
  detail?: string
  onInspect: (trigger: HTMLButtonElement) => void
}) {
  return (
    <section
      aria-label="Selected details"
      className="glass flex max-w-full min-w-0 items-center gap-2 rounded-lg p-1 pl-2.5 shadow-sm"
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium" title={title}>
          {title}
        </p>
        {detail && (
          <p className="truncate text-xs text-fg-muted" title={detail}>
            {detail}
          </p>
        )}
      </div>
      <Button size="sm" onClick={(e) => onInspect(e.currentTarget)}>
        Inspect
      </Button>
    </section>
  )
}
