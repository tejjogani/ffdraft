import { Button, controlClass, Field, InlineError, Input } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { type PointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useRpc } from '../../lib/query'
import { safeFileName, saveFile } from '../../lib/save-file'
import {
  type Cutout,
  drawPhotoLayout,
  initialPlacement,
  loadPhotoCutout,
  type PhotoPiece,
  type Placement,
  photoLayoutPng,
  readLocalPhoto,
  transparentTakeAsset,
  verifyPhotoTake,
} from './local-photo'

export function LocalPhoto({ piece }: { piece: PhotoPiece }) {
  return <PhotoLayout key={`${piece.id}:${piece.version}`} piece={piece} />
}

type Selection = {
  takeId: string
  assetId: string
} & ({ cutout: Cutout; error?: undefined } | { cutout?: undefined; error: string })

const controls = [
  { key: 'x', label: 'Horizontal position', min: 0, max: 100, unit: '%' },
  { key: 'y', label: 'Vertical position', min: 0, max: 100, unit: '%' },
  { key: 'size', label: 'Jewelry size', min: 1, max: 150, unit: '%' },
  { key: 'angle', label: 'Rotation', min: -180, max: 180, unit: '°' },
] as const

function PhotoLayout({ piece }: { piece: PhotoPiece }) {
  const { id: pieceId, version } = piece
  const heading = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const active = useRef(false)
  const exporting = useRef(false)
  const drag = useRef<{ id: number; x: number; y: number; start: Placement } | null>(null)
  const takes = useRpc('renders.list', {
    pieceId: piece.id,
    purpose: 'take',
    status: ['done'],
    limit: 200,
  })
  const [takeId, setTakeId] = useState('')
  const [selection, setSelection] = useState<Selection>()
  const [photo, setPhoto] = useState<ImageBitmap>()
  const [placement, setPlacement] = useState(initialPlacement)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [status, setStatus] = useState('')
  const available = (takes.data ?? []).flatMap((take) => {
    const assetId = transparentTakeAsset(take, piece)
    return assetId ? [{ take, assetId }] : []
  })
  const assetId = available.find(({ take }) => take.id === takeId)?.assetId
  const loaded =
    assetId && selection?.assetId === assetId && selection.takeId === takeId ? selection : undefined
  const cutout = loaded?.cutout
  const scale = photo ? Math.min(1, 760 / photo.width, 480 / photo.height) : 1

  useLayoutEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => () => photo?.close(), [photo])
  useEffect(() => {
    if (!assetId) return
    const controller = new AbortController()
    let current: Cutout | undefined
    void verifyPhotoTake({ id: pieceId, version }, takeId, assetId)
      .then(() => loadPhotoCutout(assetId, controller.signal))
      .then((cutout) => {
        if (controller.signal.aborted) {
          cutout.image.close()
        } else {
          current = cutout
          setSelection({ takeId, assetId, cutout })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setSelection({ takeId, assetId, error: message(error, 'Could not load the take.') })
        }
      })
    return () => {
      controller.abort()
      current?.image.close()
    }
  }, [assetId, pieceId, takeId, version])
  useLayoutEffect(() => {
    if (!preview.current || !photo) return
    try {
      drawPhotoLayout(preview.current, photo, cutout, placement, scale)
    } catch (error) {
      setPhotoError(message(error, 'Could not draw the photo preview.'))
    }
  }, [photo, cutout, placement, scale])

  const openPhoto = async (file: File) => {
    setOpening(true)
    setPhoto(undefined)
    setPhotoError('')
    setSaveError('')
    setStatus('')
    try {
      const bitmap = await readLocalPhoto(file)
      if (active.current) setPhoto(bitmap)
      else bitmap.close()
    } catch (error) {
      if (!active.current) return
      setPhotoError(message(error, 'Could not open the photo.'))
      if (fileInput.current) fileInput.current.value = ''
    } finally {
      if (active.current) setOpening(false)
    }
  }

  const download = async () => {
    if (!photo || !cutout || !assetId || exporting.current) return
    exporting.current = true
    setSaving(true)
    setStatus('')
    setSaveError('')
    try {
      const png = await photoLayoutPng(photo, cutout, placement)
      if (!active.current) return
      // Recheck after encoding, so a CAD edit during a long export cannot deliver a stale take.
      await verifyPhotoTake(piece, takeId, assetId)
      if (!active.current) return
      if (
        await saveFile(
          png,
          safeFileName(`${piece.title || 'Jewelry'} on-model`, 'png'),
          'Photo layout',
        )
      ) {
        if (active.current) setStatus('PNG ready.')
      }
    } catch (error) {
      if (active.current) setSaveError(message(error, 'Could not download the PNG.'))
    } finally {
      exporting.current = false
      if (active.current) setSaving(false)
    }
  }

  const place = (patch: Partial<Placement>) => {
    setPlacement((value) => ({ ...value, ...patch }))
    setStatus('')
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current
    if (!start || start.id !== event.pointerId || !cutout || exporting.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const percent = (value: number) => Math.round(Math.max(0, Math.min(100, value)))
    place({
      x: percent(start.start.x + ((event.clientX - start.x) / rect.width) * 100),
      y: percent(start.start.y + ((event.clientY - start.y) / rect.height) * 100),
    })
  }
  const release = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null
  }
  const takeError =
    loaded?.error ??
    (takeId && !assetId && !takes.isPending && !takes.isError
      ? 'This take is unavailable. Choose a transparent still of the current CAD.'
      : '')

  return (
    <section
      aria-labelledby={heading}
      className="grid gap-4 rounded-xl border border-line bg-bg-subtle p-4 sm:p-5"
    >
      <header>
        <h2 id={heading} className="studio-heading">
          Photo layout
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Place a render of your jewelry on a hand, wrist, neck, or ear photo. Your photo stays on
          this device.
        </p>
      </header>
      <div className="grid min-w-0 gap-5 @min-[42rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid min-w-0 content-start gap-3">
          <Field label="Transparent CAD take">
            {(id) => (
              <select
                id={id}
                className={controlClass}
                value={assetId ? takeId : ''}
                onChange={(event) => {
                  setTakeId(event.target.value)
                  setSelection(undefined)
                  setPlacement(initialPlacement)
                  setSaveError('')
                  setStatus('')
                }}
                disabled={saving || takes.isPending || takes.isError || !available.length}
              >
                <option value="">
                  {takes.isPending ? 'Loading takes…' : 'Choose a finished still'}
                </option>
                {available.map(({ take }) => (
                  <option key={take.id} value={take.id}>
                    {take.title} · {new Date(take.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="text-xs text-fg-muted">
            In{' '}
            <Link
              to="/pieces/$id/render"
              params={{ id: piece.id }}
              className="underline underline-offset-2"
            >
              Renders
            </Link>
            , set Backdrop to Transparent and Ground to None, then render a still of the current
            CAD.
          </p>
          {takes.isError && (
            <InlineError message={takes.error.message} onRetry={() => void takes.refetch()} />
          )}
          {!takes.isPending && !takes.isError && available.length === 0 && (
            <p className="text-sm text-fg-muted">
              No finished transparent stills for the current CAD.
            </p>
          )}
          {assetId && !loaded && (
            <p role="status" className="text-sm text-fg-muted">
              Checking the take…
            </p>
          )}
          {takeError && <InlineError message={takeError} className="py-0" />}
          <Field label="Your photo" hint="JPEG or PNG, up to 25 MB and 16 megapixels.">
            {(id) => (
              <Input
                id={id}
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png"
                disabled={opening || saving}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void openPhoto(file)
                }}
              />
            )}
          </Field>
          {opening && (
            <p role="status" className="text-sm text-fg-muted">
              Opening photo…
            </p>
          )}
          {photoError && <InlineError message={photoError} className="py-0" />}
          {photo && (
            <Button
              className="justify-self-start"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setPhoto(undefined)
                setPhotoError('')
                setSaveError('')
                setStatus('')
                if (fileInput.current) fileInput.current.value = ''
              }}
            >
              Remove photo
            </Button>
          )}
        </div>
        <div className="grid min-w-0 content-start gap-3">
          {photo && (
            <>
              <div className="grid min-w-0 place-items-center overflow-hidden rounded-lg border border-line bg-bg p-2">
                <canvas
                  ref={preview}
                  role="img"
                  aria-label="Photo layout preview"
                  className={`block max-w-full rounded-sm ${cutout && !saving ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0 || !cutout || exporting.current)
                      return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      start: placement,
                    }
                  }}
                  onPointerMove={move}
                  onLostPointerCapture={release}
                />
              </div>
              <p className="text-xs text-fg-muted">
                {photo.width} × {photo.height} px
                {cutout && ' · Drag the jewelry or adjust its placement below.'}
              </p>
            </>
          )}
          {!!photo && cutout && (
            <fieldset disabled={saving} className="grid grid-cols-2 gap-x-4 gap-y-2">
              <legend className="sr-only">Jewelry placement</legend>
              {controls.map(({ key, label, min, max, unit }) => (
                <label className="grid min-w-0 gap-1 text-sm" key={key}>
                  <span className="flex flex-wrap justify-between gap-x-1">
                    <span>{label}</span>
                    <span aria-hidden="true" className="tabular-nums text-fg-muted">
                      {placement[key]}
                      {unit}
                    </span>
                  </span>
                  <input
                    type="range"
                    className="w-full accent-select focus-visible:outline-2 focus-visible:outline-select"
                    min={min}
                    max={max}
                    value={placement[key]}
                    aria-valuetext={`${placement[key]}${unit}`}
                    onChange={(event) => place({ [key]: event.currentTarget.valueAsNumber })}
                  />
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-xs text-fg-muted">
            The render sits on top of the photo. Check the placement and scale before sharing.
          </p>
          <Button
            icon={Download}
            className="justify-self-start"
            disabled={!photo || !cutout || !!photoError || takes.isError || saving}
            onClick={() => void download()}
          >
            {saving ? 'Preparing PNG…' : 'Download PNG'}
          </Button>
          {saveError && <InlineError message={saveError} className="py-0" />}
          {status && (
            <p role="status" className="text-sm text-fg-muted">
              {status}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback
