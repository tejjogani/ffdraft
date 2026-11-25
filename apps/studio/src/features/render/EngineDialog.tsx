/**
 * Whether Blender is set up, and how to set it up. Photoreal takes need Blender 5.3 on this
 * computer; without it, takes are drawn in the browser and labelled "Preview quality". The
 * owner of a local install can point Pavé at a Blender by path, or search again.
 */
import type { RenderEngineStatus } from '@pave/schema'
import { Button, Dialog, Input, Spinner, toast } from '@pave/ui'
import { CircleCheck, CircleDashed } from 'lucide-react'
import { useState } from 'react'
import { useRpc, useRpcMutation } from '../../lib/query'
import { useSession } from '../../lib/session'

export const INSTALL_COMMAND = 'node scripts/install.mjs --render'

export function engineLabel(e: RenderEngineStatus | undefined): string {
  if (!e) return 'Checking Blender…'
  if (!e.available) return 'Preview quality · set up Blender'
  return `Blender ${e.version ?? ''}${e.device ? ` · ${e.device}` : ''}`.trim()
}

export function EngineDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const engine = useRpc('renders.engine', {}, { enabled: open })
  const session = useSession()
  const owner = session.orgs.find((o) => o.id === session.activeOrgId)?.role === 'owner'
  const [path, setPath] = useState('')
  const configure = useRpcMutation('renders.configureEngine', {
    meta: { silent: true },
    onSuccess: (status) =>
      status.available
        ? toast.success(`Blender ${status.version ?? ''} found`)
        : toast.error('That did not work', status.reason ?? undefined),
    onError: (e) => toast.error('Couldn’t check Blender', e.message),
  })
  const e = configure.data ?? engine.data
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Render engine"
      description="Photoreal takes are rendered by Blender on this computer. Without it, takes are drawn in the browser and labelled Preview quality."
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-lg bg-bg-muted p-3">
          {!e ? (
            <Spinner className="mt-0.5 size-4" />
          ) : e.available ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          ) : (
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              {!e
                ? 'Looking for Blender…'
                : e.available
                  ? 'Blender is ready'
                  : 'Blender is not set up'}
            </p>
            {e?.available && (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                <dt>Version</dt>
                <dd className="font-mono">{e.version}</dd>
                <dt>Device</dt>
                <dd>{e.device ?? 'Found on the first take'}</dd>
                <dt>Path</dt>
                <dd className="truncate font-mono" title={e.path ?? ''}>
                  {e.path}
                </dd>
              </dl>
            )}
            {e && !e.available && e.reason && (
              <p className="mt-1 text-xs text-fg-muted">{e.reason}</p>
            )}
          </div>
        </div>

        {e && !e.available && (
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="font-medium">Set it up</p>
            <p className="text-fg-muted">
              In a terminal, in the folder you installed Pavé in, run this. It needs Python 3.13 and
              downloads Blender’s renderer (about 1 GB) into Pavé’s own folder; nothing else on the
              computer changes.
            </p>
            <code className="rounded-md bg-bg-muted px-2.5 py-1.5 font-mono text-xs select-all">
              {INSTALL_COMMAND}
            </code>
            <p className="text-xs text-fg-subtle">
              Then restart Pavé, or press Search again. A Blender 5.3 you installed yourself works
              too: give its path below.
            </p>
          </div>
        )}

        {owner ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(ev) => {
              ev.preventDefault()
              if (path.trim()) configure.mutate({ blenderPath: path.trim() })
            }}
          >
            <label htmlFor="blender-path" className="text-xs font-medium text-fg-subtle">
              Blender executable
            </label>
            <div className="flex gap-1.5">
              <Input
                id="blender-path"
                value={path}
                onChange={(ev) => setPath(ev.target.value)}
                placeholder="/Applications/Blender.app/Contents/MacOS/Blender"
                className="font-mono text-xs"
              />
              <Button type="submit" disabled={!path.trim() || configure.isPending}>
                Use this
              </Button>
            </div>
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={configure.isPending}
                onClick={() => configure.mutate({ blenderPath: null })}
              >
                {configure.isPending ? (
                  <Spinner className="size-3.5" label="Searching" />
                ) : (
                  'Search again'
                )}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-fg-subtle">
            Only the owner of this Pavé can change the render engine.
          </p>
        )}
      </div>
    </Dialog>
  )
}
