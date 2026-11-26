import type { CommandOutput, RenderEngineStatus } from '@pave/schema'
import { Button, Dialog, InlineError, Input, Spinner, toast } from '@pave/ui'
import { CheckCircle2, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { queryClient, rpcKey, useRpc, useRpcMutation } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { useUI } from '../../stores/ui'

type InstallStatus = CommandOutput<'renders.installStatus'>
type Phase = InstallStatus['phase']

const progressLabels: Partial<Record<Phase, string>> = {
  downloading: 'Downloading Blender',
  verifying: 'Verifying the download',
  extracting: 'Installing the render engine',
  checkingEngine: 'Checking Blender',
}

export function engineLabel(engine: RenderEngineStatus | undefined) {
  if (!engine) return 'Checking Blender…'
  if (!engine.available) return 'Preview quality · set up Blender'
  return `Blender ${engine.version ?? ''}${engine.device ? ` · ${engine.device}` : ''}`.trim()
}

function refreshEngine() {
  for (const name of ['renders.engine', 'session.get'] as const)
    void queryClient.invalidateQueries({ queryKey: rpcKey(name) })
}

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000)

/** One installer shared by startup and Render studio. Closing the panel keeps the job running. */
export function RenderEngineSetup() {
  const session = useSession()
  const owner = activeOrg(session)?.role === 'owner'
  const localOwner = owner && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const open = useUI((s) => s.engineSetupOpen)
  const setOpen = useUI((s) => s.setEngineSetupOpen)
  const dismissed = useUI((s) => s.dismissedEngineVersion)
  const dismiss = useUI((s) => s.dismissEngineVersion)
  const status = useRpc(
    'renders.installStatus',
    {},
    {
      enabled: localOwner,
      refetchOnWindowFocus: true,
      refetchInterval: (q) => {
        const phase = q.state.data?.phase
        return phase && (phase === 'checking' || progressLabels[phase]) ? 750 : false
      },
    },
  )
  const engine = useRpc('renders.engine', {}, { enabled: open })
  const state = localOwner ? status.data : undefined
  const phase = state?.phase
  const ready = phase === 'ready' || Boolean(engine.data?.available || session.capabilities.blender)
  const progress = phase && progressLabels[phase]
  const refreshInstallStatus = status.refetch
  useEffect(() => {
    if (open && localOwner) void refreshInstallStatus()
  }, [open, localOwner, refreshInstallStatus])
  const readyFromSetup = phase === 'ready'
  useEffect(() => {
    if (readyFromSetup) refreshEngine()
  }, [readyFromSetup])
  const update = (next: InstallStatus) =>
    queryClient.setQueryData(rpcKey('renders.installStatus', {}), next)
  const start = useRpcMutation('renders.installEngine', {
    onSuccess: update,
    meta: { silent: true },
  })
  const cancel = useRpcMutation('renders.cancelInstall', {
    onSuccess: update,
    meta: { silent: true },
  })
  const [path, setPath] = useState('')
  const configure = useRpcMutation('renders.configureEngine', {
    meta: { silent: true },
    onSuccess: (next) => {
      if (next.available) {
        queryClient.setQueryData(rpcKey('renders.engine', {}), next)
        refreshEngine()
        void status.refetch()
      } else toast.error('Blender could not be used', next.reason ?? undefined)
    },
    onError: (err) => toast.error('Couldn’t check Blender', err.message),
  })
  const showOffer =
    state?.supported && !ready && phase !== 'checking' && (progress || dismissed !== state.version)
  const actionError = start.error ?? cancel.error
  return (
    <>
      {showOffer && !open && (
        <aside
          aria-label="Render engine setup"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-bg-subtle px-4 py-2"
        >
          <Download className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="mr-auto text-sm font-medium">
            {progress ?? 'Enable photoreal rendering'}
          </span>
          <Button size="sm" onClick={() => setOpen(true)}>
            {progress ? 'View progress' : 'Set up Blender'}
          </Button>
          {!progress && (
            <Button size="sm" variant="ghost" onClick={() => dismiss(state.version)}>
              Later
            </Button>
          )}
        </aside>
      )}
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          title="Render engine"
          className="max-w-lg"
          description="Blender renders photoreal shots on this computer. You can keep working in Studio during setup."
        >
          <div className="space-y-4">
            {ready ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-line bg-bg-subtle p-3"
                role="status"
              >
                <CheckCircle2 className="mt-0.5 size-4 text-ok" aria-hidden />
                <div>
                  <p className="text-sm font-semibold">Blender is ready</p>
                  {engine.data?.version && (
                    <p className="mt-1 text-xs text-fg-muted">
                      Version {engine.data.version}
                      {engine.data.device ? ` · ${engine.data.device}` : ''}
                    </p>
                  )}
                </div>
              </div>
            ) : progress && state ? (
              <section
                className="space-y-2 rounded-lg border border-line bg-bg-subtle p-3"
                aria-label="Installation progress"
              >
                <p className="flex items-center gap-2 text-sm font-semibold" role="status">
                  <Spinner className="size-4" />
                  {progress}
                </p>
                {phase === 'downloading' && state.totalBytes > 0 && (
                  <>
                    <progress
                      aria-label="Blender download"
                      max={state.totalBytes}
                      value={state.downloadedBytes}
                      className="h-2 w-full accent-current"
                    />
                    <p className="text-xs text-fg-muted">
                      {megabytes(state.downloadedBytes)} of {megabytes(state.totalBytes)} MB
                    </p>
                  </>
                )}
                <Button size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate({})}>
                  Cancel installation
                </Button>
              </section>
            ) : localOwner && (status.isPending || phase === 'checking') ? (
              <p className="flex items-center gap-2 text-sm" role="status">
                <Spinner className="size-4" />
                Checking for Blender…
              </p>
            ) : state?.supported ? (
              <section className="space-y-3 rounded-lg border border-line bg-bg-subtle p-4">
                <h3 className="text-base font-semibold">Install Blender {state.version}</h3>
                <p className="text-sm text-fg-muted">
                  Allow Pavé to download {megabytes(state.totalBytes)} MB and install Blender in its
                  own data folder on this computer.
                </p>
                {phase === 'failed' && (
                  <InlineError message={state.reason || 'Installation failed. Try again.'} />
                )}
                {phase === 'cancelled' && (
                  <p className="text-sm text-fg-muted">Installation cancelled.</p>
                )}
                <Button
                  variant="primary"
                  icon={Download}
                  disabled={start.isPending}
                  onClick={() => {
                    cancel.reset()
                    start.mutate({})
                  }}
                >
                  {phase === 'failed' || phase === 'cancelled'
                    ? 'Retry installation'
                    : 'Install render engine'}
                </Button>
              </section>
            ) : status.isError && localOwner ? (
              <InlineError message={status.error.message} onRetry={() => void status.refetch()} />
            ) : (
              <p className="text-sm text-fg-muted">
                {state?.reason ||
                  'The owner can set up Blender on the computer running Pavé. Browser previews are available here.'}
              </p>
            )}
            {actionError && <InlineError message={actionError.message} />}
            {localOwner && !progress && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  Use an existing Blender installation
                </summary>
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (path.trim()) configure.mutate({ blenderPath: path.trim() })
                  }}
                >
                  <label htmlFor="blender-path">Blender executable</label>
                  <Input
                    id="blender-path"
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder="Path to Blender"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!path.trim() || configure.isPending}>
                      Use this
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={configure.isPending}
                      onClick={() => configure.mutate({ blenderPath: null })}
                    >
                      Search again
                    </Button>
                  </div>
                </form>
              </details>
            )}
            <Button onClick={() => setOpen(false)}>{ready ? 'Done' : 'Close'}</Button>
          </div>
        </Dialog>
      )}
    </>
  )
}
