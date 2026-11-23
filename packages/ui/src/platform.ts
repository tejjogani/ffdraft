/**
 * Platform and shell, detected once. Everything platform-specific reads from here:
 * shortcut glyphs (⌘ vs Ctrl), and window-chrome insets, which are exposed to CSS as
 * `data-platform` / `data-shell` on <html> so no component hardcodes a platform.
 *
 *  - macOS desktop: frameless window with traffic lights top-left.
 *  - Windows/Linux desktop: title-bar overlay with window controls top-right.
 *  - web: no window chrome.
 */
export type Platform = 'mac' | 'windows' | 'linux' | 'other'
export type Shell = 'web' | 'desktop'

const nav = typeof navigator !== 'undefined' ? navigator : undefined
const ua = nav?.userAgent ?? ''
// Every source we have, since each can be empty or frozen depending on browser and shell.
const hints = [
  (nav as (Navigator & { userAgentData?: { platform?: string } }) | undefined)?.userAgentData
    ?.platform,
  nav?.platform,
  ua,
].join(' ')

export const platform: Platform = /mac|iphone|ipad/i.test(hints)
  ? 'mac'
  : /\bwin(dows|32|64)?\b/i.test(hints)
    ? 'windows'
    : /linux|x11|cros/i.test(hints)
      ? 'linux'
      : 'other'

/** The Electron shell identifies itself in the user agent ("Electron/…"). */
export const shell: Shell = /\bElectron\//.test(ua) ? 'desktop' : 'web'

export const isMac = platform === 'mac'

if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = platform
  document.documentElement.dataset.shell = shell
}
