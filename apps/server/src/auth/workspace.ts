import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as t from '../db/schema'
import { createId } from '../ids'

const LOCAL_EMAIL = 'local@pave.invalid'

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'studio'

/** Creates an organisation owned by `userId`. */
export async function createPersonalOrganization(
  db: Db,
  input: { userId: string; userName: string; name?: string },
): Promise<string> {
  const first = input.userName.trim().split(/\s+/)[0]
  const name = input.name ?? (first ? `${first}’s studio` : 'My studio')
  const orgId = createId('org')
  await db.transaction(async (tx) => {
    await tx.insert(t.organization).values({
      id: orgId,
      name,
      slug: `${slugify(name)}-${randomBytes(3).toString('hex')}`,
    })
    await tx
      .insert(t.member)
      .values({ id: createId('mem'), organizationId: orgId, userId: input.userId, role: 'owner' })
  })
  return orgId
}

/**
 * Local mode's single identity: one user and one organisation, created on first boot and reused
 * afterwards, so the same tenancy code runs with no sign-in.
 */
export async function ensureLocalWorkspace(db: Db): Promise<{ userId: string; orgId: string }> {
  const [existing] = await db
    .select({ userId: t.user.id, orgId: t.member.organizationId })
    .from(t.user)
    .innerJoin(t.member, eq(t.member.userId, t.user.id))
    .where(eq(t.user.email, LOCAL_EMAIL))
    .limit(1)
  if (existing) return existing

  const userId = createId('usr')
  await db
    .insert(t.user)
    .values({ id: userId, name: 'Designer', email: LOCAL_EMAIL, emailVerified: true })
  const orgId = await createPersonalOrganization(db, {
    userId,
    userName: 'Designer',
    name: 'Studio',
  })
  return { userId, orgId }
}

/**
 * The secret Better Auth signs with. Configured explicitly for accounts mode; in local mode one is
 * generated once per data directory so sessions survive restarts without setup.
 */
export async function loadOrCreateSecret(dataDir: string | null): Promise<string> {
  if (dataDir === null) return randomBytes(32).toString('base64url')
  const file = join(dataDir, 'auth-secret')
  try {
    return (await readFile(file, 'utf8')).trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const secret = randomBytes(32).toString('base64url')
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, secret, { mode: 0o600 })
  return secret
}
