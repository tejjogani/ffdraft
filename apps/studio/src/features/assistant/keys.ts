/** The composer's keys, apart from the component so they are tested without a DOM. */

/** Whether a key press should send: Enter alone, and not while composing with an input method. */
export function isSendKey(e: {
  key: string
  shiftKey: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
}): boolean {
  // Safari reports the confirming Enter of a composition as keyCode 229 after `isComposing` ends.
  return e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229
}
