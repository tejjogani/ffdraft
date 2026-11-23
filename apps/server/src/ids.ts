import { randomBytes } from 'node:crypto'

/** Prefixed, URL-safe random ids (`pc_V1StGXR8Z5jdHi6B`); 96 bits of entropy. */
export const createId = (prefix: string): string => `${prefix}_${randomBytes(12).toString('base64url')}`
