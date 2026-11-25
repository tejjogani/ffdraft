/**
 * The Claude API key, entered in the app: paste, Test (the server asks Claude's free Models API
 * and says in plain words what is wrong), Save and Remove. The key is sent to the server once and
 * never comes back: the screen only ever shows its last four characters. A key in
 * apps/server/.env wins and cannot be edited here; members who are not owners or admins see who
 * to ask. Used by Settings, AI and by the dock when there is no key.
 */
import type { CommandOutput } from '@pave/schema'
import { Button, cn, Dialog, Input, Skeleton, toast } from '@pave/ui'
import { CircleAlert, CircleCheck, KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { type RpcError, rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { keyProblem, saveAfterCheck } from './key-input'

type Check = CommandOutput<'assistant.key.test'>

export function useIsAdmin(): boolean {
  const role = activeOrg(useSession())?.role
  return role === 'owner' || role === 'admin'
}

/** Refresh everything the key decides: the setup, and `session.get` (whose capabilities follow it). */
const refreshSetup = () => invalidateFor(queryClient, 'assistant')

export function KeyForm({ compact = false }: { compact?: boolean }) {
  const admin = useIsAdmin()
  const setup = useRpc('assistant.setup.get', {})
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'test' | 'save' | 'remove' | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [replacing, setReplacing] = useState(false)

  if (!setup.data)
    return setup.isError ? (
      <p className="text-sm text-danger">{setup.error.message}</p>
    ) : (
      <Skeleton className="h-8 w-full max-w-md" />
    )
  const s = setup.data

  if (s.key.source === 'env')
    return (
      <Notice tone="ok">
        The key comes from <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> in{' '}
        <code className="font-mono text-xs">apps/server/.env</code>
        {s.key.last4 ? ` (ending ${s.key.last4})` : ''}. It takes precedence over a key saved here;
        edit that file and restart the server to change it.
      </Notice>
    )

  if (!admin)
    return (
      <p className="text-sm text-fg-muted">
        {s.configured
          ? 'The organisation’s Claude API key is set.'
          : 'An owner or admin of the organisation can add a Claude API key in Settings, AI.'}
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
  const test = () => {
    const problem = keyProblem(key)
    if (problem) return setError(problem)
    return run('test', async () => {
      setCheck(await rpc.call('assistant.key.test', key.trim() ? { apiKey: key.trim() } : {}))
    })
  }
  const save = (e?: FormEvent) => {
    e?.preventDefault()
    if (!key.trim()) return
    const problem = keyProblem(key)
    if (problem) return setError(problem)
    void run('save', async () => {
      // The same check as Test first: a key Claude refused is not saved as if it worked.
      const checked = await rpc.call('assistant.key.test', { apiKey: key.trim() })
      const go = saveAfterCheck(checked)
      if (go === 'refuse') {
        setCheck(checked)
        return
      }
      await rpc.call('assistant.key.set', { apiKey: key.trim() })
      setKey('')
      setCheck(null)
      setReplacing(false)
      refreshSetup()
      if (go === 'save') toast.success('Claude API key saved', 'The assistant is on.')
      else
        toast({
          title: 'Claude API key saved',
          description: `It could not be checked just now: ${checked.message}`,
        })
    })
  }
  const remove = () =>
    run('remove', async () => {
      await rpc.call('assistant.key.remove', {})
      setConfirmRemove(false)
      setCheck(null)
      refreshSetup()
      toast({ title: 'Claude API key removed' })
    })

  const saved = s.key.source === 'settings'
  const showField = !saved || replacing
  return (
    <div className="flex flex-col gap-3">
      {saved && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <KeyRound className="size-4 text-fg-subtle" aria-hidden />
          <span>
            Saved key ending <span className="font-mono">{s.key.last4}</span>
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
      {s.scripted && (
        <Notice tone="warn">
          Test mode: a scripted assistant stands in for Claude (PAVE_ASSISTANT is set on the
          server). Every answer is canned.
        </Notice>
      )}
      {showField && (
        <form
          onSubmit={save}
          className={cn('flex gap-2', compact ? 'flex-col' : 'flex-wrap items-center')}
        >
          <Input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setCheck(null)
              setError(null)
            }}
            placeholder="sk-ant-…"
            aria-label="Claude API key"
            autoComplete="off"
            spellCheck={false}
            className={cn('font-mono', compact ? 'w-full' : 'min-w-64 flex-1')}
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
        title="Remove the Claude API key?"
        description="The assistant turns off for everyone in the organisation until a key is added again. Conversations and edits stay."
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

function Notice({
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
        // Errors are said quietly, in one line, with no box (the design note's rule).
        tone === 'danger' && 'px-0 py-0 text-fg',
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
