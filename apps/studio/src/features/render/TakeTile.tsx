/**
 * One take in the filmstrip: its picture (or its progress while it renders, or what went
 * wrong), what it is (preview quality, stale, the assistant's, in the set), and what can be
 * done with it: star, use in the set, set as cover, compare, download, re-render, cancel.
 * Each finished take shows the fingerprint of the scene it rendered, and says so when that is
 * the view the viewfinder shows now (same fingerprint: the same picture, exactly).
 */
import type { RenderJob } from '@pave/schema'
import { AiMark, Button, Chip, cn, IconButton, Menu, MenuItem, MenuSeparator } from '@pave/ui'
import {
  Download,
  Film,
  Image as ImageIcon,
  MoreHorizontal,
  RefreshCw,
  Rows2,
  Star,
} from 'lucide-react'
import { assetUrl } from '../../lib/assets'
import { byAssistant, isLive, motionLabel, takeLabel, takeMedia } from './shots'
import { TakeMedia } from './TakeMedia'
import { TakeProgress } from './TakeProgress'

export interface TakeActions {
  star(take: RenderJob): void
  cover(take: RenderJob): void
  pick(take: RenderJob): void
  compare(take: RenderJob): void
  rerender(take: RenderJob): void
  cancel(take: RenderJob): void
  open(take: RenderJob): void
  /** Ask the assistant to look at this take and improve its shot. */
  improve(take: RenderJob): void
}

export function TakeTile({
  take,
  estimate,
  inSet,
  isCover,
  selected,
  actions,
  liveHash = null,
}: {
  take: RenderJob
  estimate: number | null
  inSet: boolean
  isCover: boolean
  selected: boolean
  actions: TakeActions
  /** The viewfinder's scene fingerprint, to say when this take is exactly that view. */
  liveHash?: string | null
}) {
  const { still, video } = takeMedia(take)
  const image = video ?? still
  const done = take.status === 'done' && !!image
  const motion = motionLabel(take)
  return (
    <article
      aria-label={`Take: ${takeLabel(take)}`}
      className={cn(
        'flex w-44 shrink-0 flex-col overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]',
        selected && 'shadow-[0_0_0_2px_var(--select)]',
      )}
    >
      <button
        type="button"
        disabled={!done}
        onClick={() => actions.open(take)}
        className="relative aspect-square w-full overflow-hidden bg-bg-muted"
        aria-label={done ? `Show ${takeLabel(take)} large` : undefined}
      >
        {done ? (
          <TakeMedia take={take} width={320} className="size-full object-cover" />
        ) : isLive(take) ? (
          <div className="absolute inset-0 flex items-center px-3">
            <TakeProgress take={take} estimate={estimate} compact />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center">
            <ImageIcon className="size-4 text-fg-faint" aria-hidden />
            <p className="line-clamp-4 text-[11px] text-fg-muted">
              {take.status === 'canceled' ? 'Canceled' : (take.error ?? 'Failed')}
            </p>
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {motion && (
            <Chip tone="neutral" className="bg-bg/85 backdrop-blur">
              <Film className="size-3" aria-hidden /> {motion}
            </Chip>
          )}
          {take.engine === 'browser' && done && (
            <Chip tone="neutral" className="bg-bg/85 backdrop-blur">
              Preview quality
            </Chip>
          )}
          {take.stale && done && (
            <Chip tone="warn" className="bg-bg/85 backdrop-blur">
              Design changed
            </Chip>
          )}
        </div>
        {inSet && done && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-ink-fg">
            In the set
          </span>
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {byAssistant(take) && <AiMark className="size-3 shrink-0" />}
        <p className="min-w-0 flex-1 truncate text-xs" title={takeLabel(take)}>
          {takeLabel(take)}
        </p>
        {isLive(take) ? (
          <Button size="sm" variant="ghost" onClick={() => actions.cancel(take)}>
            Cancel
          </Button>
        ) : (
          <>
            <IconButton
              icon={Star}
              label={take.starred ? 'Unstar' : 'Star'}
              size="sm"
              disabled={!done}
              className={cn(take.starred && '[&_svg]:fill-current text-warn')}
              onClick={() => actions.star(take)}
            />
            <Menu
              trigger={<IconButton icon={MoreHorizontal} label="Take options" size="sm" />}
              align="end"
            >
              {done && !inSet && (
                <MenuItem icon={Rows2} onClick={() => actions.pick(take)}>
                  Use in the set
                </MenuItem>
              )}
              {done && still && (
                <MenuItem icon={ImageIcon} disabled={isCover} onClick={() => actions.cover(take)}>
                  {isCover ? 'Is the cover' : 'Set as cover'}
                </MenuItem>
              )}
              {done && !video && (
                <MenuItem onClick={() => actions.compare(take)}>Compare…</MenuItem>
              )}
              {done && (
                <MenuItem
                  icon={Download}
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = assetUrl(image)
                    a.download = `${takeLabel(take)}.${video ? 'mp4' : 'png'}`
                    a.click()
                  }}
                >
                  Download
                </MenuItem>
              )}
              {done && takeMedia(take).gif && (
                <MenuItem
                  icon={Download}
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = assetUrl(takeMedia(take).gif!)
                    a.download = `${takeLabel(take)}.gif`
                    a.click()
                  }}
                >
                  Download GIF
                </MenuItem>
              )}
              {done && (
                <MenuItem
                  leading={<AiMark className="size-3" />}
                  onClick={() => actions.improve(take)}
                >
                  Improve with AI…
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={RefreshCw} onClick={() => actions.rerender(take)}>
                {take.status === 'failed' ? 'Retry' : 'Re-render'}
              </MenuItem>
            </Menu>
          </>
        )}
      </div>
      {done && take.sceneHash && (
        <p
          className="flex items-center gap-1 border-t border-line px-2 py-1 font-mono text-[10px] text-fg-subtle"
          title="Fingerprint of the exact scene this take rendered"
        >
          scene {take.sceneHash.slice(0, 8)}
          {liveHash === take.sceneHash && (
            <span className="ml-auto font-sans text-ok">= this view</span>
          )}
        </p>
      )}
      {take.stale && done && (
        <button
          type="button"
          onClick={() => actions.rerender(take)}
          className="border-t border-line px-2 py-1 text-left text-[11px] text-warn hover:bg-bg-hover"
        >
          Re-render with the current design
        </button>
      )}
    </article>
  )
}
