import { Button, Field, Input } from '@pave/ui'
import { type FormEvent, useState } from 'react'
import { PaveMark } from '../../components/PaveMark'
import { RpcError } from '../../lib/rpc'
import { auth, invitationFromPath } from '../../lib/session'

type Mode = 'sign-in' | 'sign-up'

/** Shown only when the server says we're signed out (accounts mode). */
export function AuthScreen() {
  const invitation = invitationFromPath()
  const [mode, setMode] = useState<Mode>(invitation ? 'sign-up' : 'sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'sign-in') await auth.signIn(email, password)
      else await auth.signUp(name, email, password)
      if (invitation) {
        await auth.acceptInvitation(invitation)
        window.history.replaceState(null, '', '/')
      }
      await auth.refresh()
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-drag flex min-h-dvh flex-col items-center justify-center bg-bg-subtle px-4">
      <div className="app-no-drag w-full max-w-[360px]">
        <PaveMark className="mb-8 size-8 text-fg" />
        <h1 className="studio-title text-fg">
          {invitation
            ? 'You’re invited'
            : mode === 'sign-in'
              ? 'Welcome back'
              : 'Create your studio'}
        </h1>
        <p className="mt-1 mb-7 text-sm text-fg-muted">
          {invitation
            ? 'Sign in or create an account to join the workspace.'
            : mode === 'sign-in'
              ? 'Sign in to continue to Pavé.'
              : 'One calm place from idea to production.'}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === 'sign-up' && (
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              )}
            </Field>
          )}
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
            {mode === 'sign-in'
              ? 'Sign in'
              : invitation
                ? 'Create account and join'
                : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-sm text-fg-muted">
          {mode === 'sign-in' ? 'New to Pavé?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className="font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg"
          >
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
