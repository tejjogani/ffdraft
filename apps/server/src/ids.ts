import { createHash, randomBytes } from 'node:crypto'

/** Prefixed, URL-safe random ids (`pc_V1StGXR8Z5jdHi6B`); 96 bits of entropy. */
export const createId = (prefix: string): string =>
  `${prefix}_${randomBytes(12).toString('base64url')}`

/** A client draft can retry creation without adding another project. Preserve existing intake IDs. */
export function requestedPieceId(
  orgId: string,
  userId: string,
  requestId: string,
  mode: 'intake' | 'create',
): string {
  const key = [orgId, userId, requestId]
  if (mode === 'create') key.unshift('pieces.create')
  return 'pc_' + createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 24)
}
