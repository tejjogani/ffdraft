import {
  hasRecoverableRhinoLabels,
  type RhinoLabelRecovery,
  recoverRhinoLabels,
} from '@pave/kernel/rhino-import'
import { type Design, MAX_MODEL_IMPORT_OPS, type Op } from '@pave/schema'
import { Button, Dialog, Spinner } from '@pave/ui'
import { FileUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '../../../lib/assets'
import { plural } from '../../../lib/format'
import type { ModelRequest, ModelResponse } from './model'

export function RecoverRhinoLabels({
  design,
  onRecover,
}: {
  design: Design
  onRecover(ops: Op[]): void | Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{
    design: Design
    file: File
    result: RhinoLabelRecovery
  } | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !file) return
    const controller = new AbortController()
    const worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<ModelResponse>) => {
      worker.terminate()
      if ('error' in data) {
        setError(data.error)
        return
      }
      const { parts, curves } = data.preview
      void recoverRhinoLabels(
        design,
        { objects: parts, curves },
        async (id) => {
          const response = await fetch(assetUrl(id), { signal: controller.signal })
          if (!response.ok) throw Error('Project mesh unavailable')
          return new Uint8Array(await response.arrayBuffer())
        },
        controller.signal,
      ).then(
        (plan) => {
          if (!controller.signal.aborted) setPreview({ design, file, result: plan })
        },
        () => {
          if (!controller.signal.aborted)
            setError('The original file could not be compared with this project. Choose it again.')
        },
      )
    }
    worker.onerror = () => {
      setError('The Rhino reader could not start. Choose the file again.')
      worker.terminate()
    }
    worker.postMessage({ file, stlUnit: 'mm', includeCurves: true } satisfies ModelRequest)
    return () => {
      controller.abort()
      worker.terminate()
    }
  }, [open, file, design])

  if (!hasRecoverableRhinoLabels(design)) return null
  const result = preview?.design === design && preview.file === file ? preview.result : null

  const close = () => {
    setOpen(false)
    setFile(null)
    setPreview(null)
    setError('')
  }
  const tooMany = (result?.ops.length ?? 0) > MAX_MODEL_IMPORT_OPS
  const apply = async () => {
    if (!result?.ops.length || tooMany || saving) return
    setSaving(true)
    setError('')
    try {
      await onRecover(result.ops)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The source labels could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const counts = result?.counts
  const excluded = counts
    ? [
        [counts.alreadyLabeled, 'Already labeled'],
        [counts.ambiguous, 'Duplicate source identities'],
        [counts.unmatched, 'No exact match'],
        [counts.unavailable, 'Project meshes unavailable'],
        [counts.unlabeled, 'No source labels in the archive'],
      ].filter(([count]) => count)
    : []
  const matches = counts
    ? [
        counts.parts && plural(counts.parts, 'part'),
        counts.curves && plural(counts.curves, 'curve'),
      ]
        .filter(Boolean)
        .join(' and ')
    : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else if (!saving) close()
      }}
      trigger={
        <Button size="sm" variant="ghost" icon={FileUp}>
          Recover Rhino source labels
        </Button>
      }
      title="Recover Rhino source labels"
      description="Choose the original Rhino file to recover groups, block placements, display materials, and available Stuller supplier labels by exact match."
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || !result?.ops.length || tooMany}
            onClick={() => void apply()}
          >
            {saving ? 'Applying…' : 'Apply labels'}
          </Button>
        </>
      }
    >
      <input
        ref={input}
        type="file"
        accept=".3dm"
        hidden
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!selected) return
          setPreview(null)
          if (!/\.3dm$/i.test(selected.name)) {
            setFile(null)
            setError('Choose an original Rhino .3dm file.')
            return
          }
          setError('')
          setFile(selected)
        }}
      />
      <div className="flex items-center justify-between gap-4">
        {file && <span className="min-w-0 break-all text-sm font-medium">{file.name}</span>}
        <Button size="sm" icon={FileUp} disabled={saving} onClick={() => input.current?.click()}>
          {file ? 'Change file' : 'Choose .3dm file'}
        </Button>
      </div>
      <div aria-live="polite">
        {file && !result && !error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
            <Spinner /> Comparing source geometry…
          </p>
        )}
        {counts && (
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <p className="font-medium">
              {matches ? `Exact matches for ${matches}` : 'No recoverable labels found'}
            </p>
            {excluded.length > 0 && (
              <dl className="mt-2 space-y-1.5 text-fg-muted">
                {excluded.map(([count, label]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
            )}
            {tooMany && (
              <p className="mt-2 text-fg-muted">
                One recovery can update up to {MAX_MODEL_IMPORT_OPS.toLocaleString()} items.
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
