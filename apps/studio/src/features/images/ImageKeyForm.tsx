/**
 * One image provider's key, entered in the app with the Claude key's rules: paste, Test (the
 * server asks the provider's free model list), Save and Remove. The key goes to the server once
 * and never comes back; only its last four characters are shown. A key in apps/server/.env wins
 * and cannot be edited here. Members who are not owners or admins see whether a key is set.
 */
import type { CommandOutput, ImageSetup, KeyedImageProvider } from '@pave/schema'
import { Button, cn, Dialog, Input, toast } from '@pave/ui'
import { CircleAlert, CircleCheck, KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { invalidateFor, queryClient } from '../../lib/query'
import { type RpcError, rpc } from '../../lib/rpc'
import { useIsAdmin } from '../assistant/KeyForm'

type Provider = ImageSetup['providers'][number]
type Check = CommandOutput<'images.key.test'>

const refresh = () => invalidateFor(queryClient, 'images')

export function ImageKeyForm({ provider: p }: { provider: Provider }) {
  const admin = useIsAdmin()
  const id = p.id as KeyedImageProvider
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'test' | 'save' | 'remove' | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [replacing, setReplacing] = useState(false)

  if (p.key.source === 'env')
    return (
      <Notice tone="ok">
        The key comes from <code className="font-mono text-xs">{p.key.envName}</code> in{' '}
        <code className="font-mono text-xs">apps/server/.env</code>
        {p.key.last4 ? ` (ending ${p.key.last4})` : ''}. It takes precedence; edit that file and
        restart the server to change it.
      </Notice>
    )
  if (!admin)
    return (
      <p className="text-sm text-fg-muted">
        {p.configured
          ? `The organisation’s ${p.label} key is set.`
          : `An owner or admin can add a ${p.label} key here.`}
      </p>
    )

  const run = async (kind: 'test' | 'save' | 'remove', f: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError((e as RpcError).message)
    } finally {
      setBusy(null)
    }
  }
  const test = () =>
    run('test', async () => {
      setCheck(
        await rpc.call(
          'images.key.test',
          key.trim() ? { provider: id, apiKey: key.trim() } : { provider: id },
        ),
      )
    })
  const save = (e?: FormEvent) => {
    e?.preventDefault()
    if (!key.trim()) return
    void run('save', async () => {
      await rpc.call('images.key.set', { provider: id, apiKey: key.trim() })
      setKey('')
      setCheck(null)
      setReplacing(false)
      refresh()
      toast.success(`${p.label} key saved`, 'Concept images are on.')
    })
  }
  const remove = () =>
    run('remove', async () => {
      await rpc.call('images.key.remove', { provider: id })
      setConfirmRemove(false)
      setCheck(null)
      refresh()
      toast({ title: `${p.label} key removed` })
    })

  const saved = p.key.source === 'settings'
  return (
    <div className="flex flex-col gap-2.5">
      {saved && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <KeyRound className="size-4 text-fg-subtle" aria-hidden />
          <span>
            Saved key ending <span className="font-mono">{p.key.last4}</span>
          </span>
          <span className="ml-auto flex gap-1.5">
            {!replacing && (
              <>
                <Button size="sm" onClick={() => void test()} disabled={!!busy}>
                  {busy === 'test' ? 'Testing…' : 'Test'}
                </Button>
                <Button size="sm" onClick={() => setReplacing(true)} disabled={!!busy}>
                  Replace
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setConfirmRemove(true)}
              disabled={!!busy}
            >
              Remove
            </Button>
          </span>
        </div>
      )}
      {(!saved || replacing) && (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setCheck(null)
            }}
            placeholder={`${p.label} API key`}
            aria-label={`${p.label} API key`}
            autoComplete="off"
            spellCheck={false}
            className="min-w-56 flex-1 font-mono"
          />
          <div className="flex gap-1.5">
            <Button onClick={() => void test()} disabled={!key.trim() || !!busy}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </Button>
            <Button type="submit" variant="primary" disabled={!key.trim() || !!busy}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            {replacing && (
              <Button variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {check && (
        <Notice tone={check.ok ? 'ok' : 'danger'} live>
          {check.message}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" live>
          {error}
        </Notice>
      )}
      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove the ${p.label} key?`}
        description="Boards that use this provider can’t generate until a key is added again. Images already made stay."
        footer={
          <>
            <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy === 'remove'} onClick={() => void remove()}>
              Remove key
            </Button>
          </>
        }
      />
    </div>
  )
}

export function Notice({
  tone,
  live,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger'
  live?: boolean
  children: React.ReactNode
}) {
  const Icon = tone === 'ok' ? CircleCheck : CircleAlert
  return (
    <p
      role={live ? 'status' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
        tone === 'ok' && 'bg-[color-mix(in_oklab,var(--ok)_9%,transparent)] text-fg',
        tone === 'warn' && 'bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] text-fg',
        tone === 'danger' && 'bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] text-fg',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-danger',
        )}
      />
      <span>{children}</span>
    </p>
  )
}
