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
const platformHint =
  (nav as (Navigator & { userAgentData?: { platform?: string } }) | undefined)?.userAgentData
    ?.platform ??
  nav?.platform ??
  ua

export const platform: Platform = /mac|iphone|ipad/i.test(platformHint)
  ? 'mac'
  : /win/i.test(platformHint)
    ? 'windows'
    : /linux|x11|cros/i.test(platformHint)
      ? 'linux'
      : 'other'

/** The Electron shell identifies itself in the user agent ("Electron/…"). */
export const shell: Shell = /\bElectron\//.test(ua) ? 'desktop' : 'web'

export const isMac = platform === 'mac'

if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = platform
  document.documentElement.dataset.shell = shell
}
