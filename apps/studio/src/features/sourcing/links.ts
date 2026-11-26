/** Sourcing links may also come from an imported design. Only open Diaex browse pages. */
export function diaexBrowseLink(value: unknown): URL | undefined {
  if (typeof value !== 'string') return
  try {
    const url = new URL(value)
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'thediaex.com' || url.hostname.endsWith('.thediaex.com')) &&
      url.pathname === '/browse'
    )
      return url
  } catch {
    // A malformed link is never rendered as navigation.
  }
}
