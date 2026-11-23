import type { CommandOutput } from '@pave/schema'
import { createContext, use } from 'react'
import { queryClient, rpcKey } from './query'
import { postJson } from './rpc'

export type Session = CommandOutput<'session.get'>

export const SessionContext = createContext<Session | null>(null)

/** The signed-in session. Only usable inside the authenticated shell. */
export function useSession(): Session {
  const s = use(SessionContext)
  if (!s) throw new Error('useSession must be used inside the authenticated shell')
  return s
}

export const activeOrg = (s: Session) => s.orgs.find((o) => o.id === s.activeOrgId) ?? s.orgs[0]

/** Better Auth's email endpoints (accounts mode). Local mode signs in automatically. */
export const auth = {
  signIn: (email: string, password: string) =>
    postJson('/api/auth/sign-in/email', { email, password }),
  signUp: (name: string, email: string, password: string) =>
    postJson('/api/auth/sign-up/email', { name, email, password }),
  signOut: () => postJson('/api/auth/sign-out', {}),
  acceptInvitation: (invitationId: string) =>
    postJson('/api/auth/organization/accept-invitation', { invitationId }),
  /** Re-reads the session after any of the above. */
  refresh: () => queryClient.resetQueries({ queryKey: rpcKey('session.get') }),
}

/** `/invite/<id>` links carry an invitation; read it before the router is involved. */
export const invitationFromPath = (path = window.location.pathname): string | null =>
  path.match(/^\/invite\/([^/]+)/)?.[1] ?? null
