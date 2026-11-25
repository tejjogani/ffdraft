/**
 * A take's picture, or its video for an animation take: the poster until it plays, muted and
 * looping (a turntable is made to loop), playing while hovered or focused in the filmstrip and
 * with controls when shown large. Video is never auto-played under reduced motion.
 */
import type { RenderJob } from '@pave/schema'
import { cn } from '@pave/ui'
import { useRef } from 'react'
import { assetUrl } from '../../lib/assets'
import { takeMedia } from './shots'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function TakeMedia({
  take,
  width,
  className,
  large = false,
  alt = '',
}: {
  take: Pick<RenderJob, 'scene' | 'assetIds'>
  /** Thumbnail width for a still (videos are served as they are). */
  width?: number
  className?: string
  /** Shown large: a video gets controls and plays on its own (unless motion is reduced). */
  large?: boolean
  alt?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const { still, video: clip } = takeMedia(take)
  if (!clip)
    return still ? (
      <img src={assetUrl(still, width)} alt={alt} className={className} loading="lazy" />
    ) : null
  const play = () => {
    if (!reducedMotion()) void video.current?.play().catch(() => {})
  }
  const stop = () => video.current?.pause()
  return (
    // biome-ignore lint/a11y/useMediaCaption: renders of a piece have no speech or sound
    <video
      ref={video}
      src={assetUrl(clip)}
      poster={still ? assetUrl(still, width) : undefined}
      aria-label={alt || undefined}
      className={cn(className, 'bg-bg-muted')}
      muted
      loop
      playsInline
      preload="metadata"
      controls={large}
      autoPlay={large && !reducedMotion()}
      onMouseEnter={large ? undefined : play}
      onMouseLeave={large ? undefined : stop}
      onFocus={large ? undefined : play}
      onBlur={large ? undefined : stop}
      data-motion="video"
    />
  )
}
