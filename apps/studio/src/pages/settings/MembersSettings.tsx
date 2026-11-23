import { ROLES, type Role } from '@pave/schema'
import {
  Avatar,
  Button,
  Dialog,
  Field,
  InlineError,
  Input,
  Select,
  Skeleton,
  toast,
} from '@pave/ui'
import { UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { shortDate } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { SettingsTitle } from './SettingsLayout'

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  designer: 'Designer',
  viewer: 'Viewer',
  guest: 'Guest',
}
const roleOptions = ROLES.filter((r) => r !== 'owner').map((r) => ({
  value: r,
  label: ROLE_LABEL[r],
}))

export function MembersSettings() {
  const session = useSession()
  const myRole = activeOrg(session)?.role
  const canManage = myRole === 'owner' || myRole === 'admin'
  const members = useRpc('org.members', {})
  const setRole = useRpcMutation('org.setRole')
  const [inviting, setInviting] = useState(false)
  return (
    <>
      <SettingsTitle
        title="Members"
        description="Who can see and edit this workspace."
        actions={
          canManage && (
            <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setInviting(true)}>
              Invite
            </Button>
          )
        }
      />
      {members.isError ? (
        <InlineError message={members.error.message} onRetry={() => void members.refetch()} />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {members.isPending
            ? Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-3.5 w-40" />
                </li>
              ))
            : members.data.map((m) => (
                <li key={m.user.id} className="flex items-center gap-3 py-3">
                  <Avatar name={m.user.name} src={m.user.image} size="lg" className="size-8!" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {m.user.name}
                      {m.user.id === session.user.id && (
                        <span className="ml-1.5 font-normal text-fg-subtle">you</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-fg-subtle">{m.user.email}</div>
                  </div>
                  <span className="hidden text-xs text-fg-subtle sm:block">
                    Joined {shortDate(m.joinedAt)}
                  </span>
                  {canManage && m.role !== 'owner' && m.user.id !== session.user.id ? (
                    <Select
                      variant="bare"
                      aria-label={`Role for ${m.user.name}`}
                      value={m.role}
                      options={roleOptions}
                      onChange={(role) => setRole.mutate({ userId: m.user.id, role })}
                      className="w-28 justify-end"
                    />
                  ) : (
                    <span className="w-28 px-1.5 text-right text-sm text-fg-muted">
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                </li>
              ))}
        </ul>
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  )
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('designer')
  const invite = useRpcMutation('org.invite', {
    onSuccess: () => {
      toast.success('Invitation sent', email)
      setEmail('')
      onOpenChange(false)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    invite.mutate({ email, role })
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a member"
      description="They’ll get an email with a link to join."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@studio.com"
            />
          )}
        </Field>
        <Field label="Role">
          <Select aria-label="Role" value={role} onChange={setRole} options={roleOptions} />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={invite.isPending}>
            Send invite
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
