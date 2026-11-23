import { ROLES, type Role, roleAllows } from '@pave/schema'

/**
 * Better Auth stores a member's roles as a comma-separated string. A member holds the most
 * privileged of the roles we know; anything unrecognised grants nothing beyond `guest`.
 */
export function effectiveRole(stored: string): Role {
  const known = stored
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is Role => (ROLES as readonly string[]).includes(r))
  return known.reduce<Role>((best, r) => (roleAllows(r, best) ? r : best), 'guest')
}
