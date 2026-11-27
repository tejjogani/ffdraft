import { unionBounds } from '@pave/kernel/mesh-import'
import type { Bounds } from '@pave/kernel/types'
import { MAX_DESIGN_CHANGE_OPS, type NodeInput, newId, PAVE_LIMITS } from '@pave/schema'
import { Button, Checkbox, Dialog, Select, Spinner } from '@pave/ui'
import { FileUp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { uploadAsset } from '../../../lib/assets'
import { num, plural } from '../../../lib/format'
import { safeFileName } from '../../../lib/save-file'
import {
  isStlFile,
  MODEL_ACCEPT,
  type ModelPart,
  type ModelPreview,
  type ModelRequest,
  type ModelResponse,
  STL_UNITS,
  type StlUnit,
} from './model'

const unitOptions = (Object.keys(STL_UNITS) as StlUnit[]).map((value) => ({
  value,
  label: STL_UNITS[value].label,
}))
const UPLOAD_BATCH = 4

function dimensions(bounds: Bounds): string {
  return `${bounds.max
    .map((max, i) => {
      const size = max - bounds.min[i]!
      return size > 0 && size < 0.001 ? size.toExponential(2) : num(size, 3)
    })
    .join(' × ')} mm`
}

export function ModelImport({
  initialFile,
  onClose,
  onImport,
}: {
  initialFile: File | null
  onClose(): void
  onImport(nodes: NodeInput[], label: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useRef<AbortController | null>(null)
  const uploaded = useRef(new Map<ModelPart, string>())
  const [file, setFile] = useState(initialFile)
  const [stlUnit, setStlUnit] = useState<StlUnit>('mm')
  const [preview, setPreview] = useState<ModelPreview | null>(null)
  const [excludedLayers, setExcludedLayers] = useState(new Set<string | null>())
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const layerId = useId()

  useEffect(() => {
    if (!file) return
    const worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<ModelResponse>) => {
      if ('preview' in data) setPreview(data.preview)
      else setError(data.error)
      worker.terminate()
    }
    worker.onerror = () => {
      setError('The model reader didn’t start. Try choosing the file again.')
      worker.terminate()
    }
    worker.postMessage({ file, stlUnit } satisfies ModelRequest)
    return () => worker.terminate()
  }, [file, stlUnit])

  useEffect(() => () => upload.current?.abort(), [])

  const resetPreview = () => {
    uploaded.current.clear()
    setError(null)
    setPreview(null)
    setExcludedLayers(new Set())
  }
  const cancel = () => {
    upload.current?.abort()
    onClose()
  }

  const reading = file && !preview && !error
  const stl = file && isStlFile(file.name)
  const parts = preview?.parts ?? []
  const layers = new Map<string | null, number>()
  if (!stl) for (const { layer } of parts) layers.set(layer, (layers.get(layer) ?? 0) + 1)
  const selected = parts.filter((part) => !excludedLayers.has(part.layer))
  const count = selected.length
  // Each imported part adds one operation. Uploads are assets and need no design metadata ops.
  const limit =
    count > MAX_DESIGN_CHANGE_OPS
      ? `Select layers with up to ${MAX_DESIGN_CHANGE_OPS} parts, or export smaller Rhino files.`
      : selected.some((part) => part.bytes.byteLength > PAVE_LIMITS.entryBytes)
        ? 'A mesh part is too large to save in a Pavé file. Export a coarser mesh.'
        : null

  const commit = async () => {
    if (!file || !count || limit || upload.current) return
    const controller = new AbortController()
    upload.current = controller
    setUploading(true)
    setUploadedCount(0)
    setError(null)
    try {
      for (let i = 0; i < count; i += UPLOAD_BATCH) {
        const batch = await Promise.allSettled(
          selected.slice(i, i + UPLOAD_BATCH).map(async (part) => {
            if (uploaded.current.has(part)) return
            try {
              const asset = await uploadAsset(
                new File([part.bytes], safeFileName(part.name, 'stl'), { type: 'model/stl' }),
                controller.signal,
              )
              uploaded.current.set(part, asset.id)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              throw new Error(`Couldn’t upload “${part.name}”. ${message}`)
            }
          }),
        )
        controller.signal.throwIfAborted()
        const failed = batch.find((result) => result.status === 'rejected')
        if (failed) throw failed.reason
        setUploadedCount(Math.min(i + UPLOAD_BATCH, count))
      }
      const nodes: NodeInput[] = selected.map((part) => ({
        id: newId('meshBody'),
        name: part.name.slice(0, 80).replace(/[\uD800-\uDBFF]$/, ''),
        kind: 'meshBody',
        source: {
          type: 'asset',
          assetId: uploaded.current.get(part)!,
          ...(part.layer && { rhinoLayer: part.layer }),
        },
        keepSourcePlacement: true,
      }))
      onImport(nodes, `Imported ${file.name.slice(0, 150)}`)
      onClose()
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    } finally {
      upload.current = null
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && cancel()}
      title="Import model"
      description="Add mesh parts from Rhino (.3dm) or STL."
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!count || !!limit || uploading}
            onClick={() => void commit()}
          >
            {uploading ? <Spinner className="size-3.5" /> : null}
            {uploading ? 'Importing…' : count ? `Import ${plural(count, 'part')}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          ref={input}
          type="file"
          accept={MODEL_ACCEPT}
          hidden
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!selected) return
            resetPreview()
            setFile(selected)
            setStlUnit('mm')
          }}
        />
        <div className="flex items-center justify-between gap-3">
          {file && <span className="min-w-0 break-all text-sm font-medium">{file.name}</span>}
          <Button
            size="sm"
            icon={FileUp}
            disabled={uploading}
            className="shrink-0"
            onClick={() => input.current?.click()}
          >
            {file ? 'Change file' : 'Choose file'}
          </Button>
        </div>
        {stl && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-fg-muted">STL files have no unit setting.</span>
            <Select
              aria-label="STL source units"
              value={stlUnit}
              options={unitOptions}
              disabled={uploading}
              onChange={(unit) => {
                if (unit === stlUnit) return
                resetPreview()
                setStlUnit(unit)
              }}
            />
          </div>
        )}
        {reading && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner className="size-3.5" />
            Reading model…
          </p>
        )}
        {preview && (
          <>
            {!stl && (
              <p className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-fg-muted">Rhino file units</span>
                <span>{preview.units}</span>
              </p>
            )}
            {layers.size > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Rhino layers</legend>
                <p className="pb-1 text-xs text-fg-muted">
                  Selected meshes import as metal. Exclude gemstone and setup layers for casting.
                </p>
                {[...layers].map(([layer, layerCount], i) => (
                  <div key={layer ?? ''} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${layerId}-${i}`}
                      aria-label={layer ?? 'No layer'}
                      checked={!excludedLayers.has(layer)}
                      disabled={uploading}
                      onChange={(checked) =>
                        setExcludedLayers((previous) => {
                          const next = new Set(previous)
                          if (checked) next.delete(layer)
                          else next.add(layer)
                          return next
                        })
                      }
                    />
                    <label
                      htmlFor={`${layerId}-${i}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 py-1"
                    >
                      <span className="min-w-0 break-words">{layer ?? 'No layer'}</span>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {plural(layerCount, 'part')}
                      </span>
                    </label>
                  </div>
                ))}
              </fieldset>
            )}
            {count > 0 ? (
              <section aria-label="Model dimensions">
                <p className="flex flex-wrap justify-between gap-2 border-y border-line py-2 text-sm">
                  <span className="text-fg-muted">{stl ? 'Overall' : 'Selected'} X × Y × Z</span>
                  <span className="font-medium tabular-nums">
                    {dimensions(unionBounds(selected.map(({ bounds }) => bounds)))}
                  </span>
                </p>
                {!stl && (
                  <details className="pt-2 text-sm" open={count <= 5}>
                    <summary className="cursor-pointer text-fg-muted">
                      {plural(count, 'selected part', 'selected parts')}
                    </summary>
                    <ul className="divide-y divide-line pl-4">
                      {selected.map(({ name, bounds }, i) => (
                        <li
                          key={`${i}-${name}`}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5"
                        >
                          <span className="min-w-0 break-words">{name}</span>
                          <span className="text-xs text-fg-muted tabular-nums">
                            {dimensions(bounds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            ) : (
              <p role="status" className="text-sm text-fg-muted">
                {parts.length > 0
                  ? 'Select a layer to import its parts.'
                  : 'No solid mesh parts found. Export your Rhino objects as STL or save the .3dm with render meshes.'}
              </p>
            )}
            {limit && (
              <p role="status" className="text-sm text-warn">
                {limit}
              </p>
            )}
            {preview.skipped.length > 0 && (
              <section aria-label="Skipped Rhino objects" className="space-y-1">
                <h3 className="text-sm font-medium">
                  Skipped {plural(preview.skipped.length, 'object')}
                </h3>
                <ul className="space-y-1 text-xs text-fg-muted">
                  {preview.skipped.map(({ name, reason }, i) => (
                    <li key={`${i}-${name}`} className="break-words">
                      <span className="font-medium text-fg">{name}</span>
                      {' · '}
                      {reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {uploading && (
          <p className="text-sm text-fg-muted">
            Uploaded {uploadedCount} of {count} parts
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
