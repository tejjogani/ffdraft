import { Button, EmptyState } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { RpcError } from '../../lib/rpc'
import { auth } from '../../lib/session'

/** A signed-in user following an invitation link. */
export function AcceptInvitePage({ invitationId }: { invitationId: string }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const accept = async () => {
    setBusy(true)
    try {
      await auth.acceptInvitation(invitationId)
      await auth.refresh()
      void navigate({ to: '/' })
    } catch (e) {
      setError(e instanceof RpcError ? e.message : 'This invitation could not be accepted.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <EmptyState
      className="mt-[18vh]"
      title="Join the workspace"
      description={error ?? 'You’ve been invited to collaborate in Pavé.'}
      action={
        <Button variant="primary" onClick={accept} disabled={busy}>
          Accept invitation
        </Button>
      }
    />
  )
}
