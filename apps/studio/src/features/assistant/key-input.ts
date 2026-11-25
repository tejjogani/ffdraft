/**
 * The first look at a pasted Claude API key, in the browser, before anything is sent: a key that
 * is plainly not whole gets one plain sentence instead of the server's validation error.
 */
import type { CommandOutput } from '@pave/schema'

/** The server refuses anything shorter (assistant.key.set and .test take at least 20 characters). */
export const MIN_KEY_LENGTH = 20

/** What is plainly wrong with a pasted key, or null when it is worth asking Claude about. */
export function keyProblem(raw: string): string | null {
  const key = raw.trim()
  if (!key) return null
  if (/\s/.test(key))
    return 'That has spaces or line breaks in it. Paste the key alone, in one piece.'
  if (key.length < MIN_KEY_LENGTH)
    return 'That’s too short to be a Claude key. Paste the whole key; it starts with sk-ant-.'
  return null
}

type Check = CommandOutput<'assistant.key.test'>

/**
 * Whether Save goes ahead after its check. A key Claude refused is not saved; when Claude could
 * not be asked (offline, rate-limited, a hiccup) the key is saved and the person is told it was
 * not checked.
 */
export function saveAfterCheck(check: Check): 'save' | 'save-unchecked' | 'refuse' {
  if (check.ok) return 'save'
  return check.code === 'invalid' || check.code === 'forbidden' ? 'refuse' : 'save-unchecked'
}
