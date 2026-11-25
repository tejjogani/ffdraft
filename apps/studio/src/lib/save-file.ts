/**
 * Saving a file the studio made (an export, a capture). Uses the native save dialog where the
 * browser has one (Chromium, Electron), else a download. Names are made safe for every OS:
 * Windows forbids `<>:"/\|?*`, control characters, trailing dots and spaces, and device names
 * such as `CON` or `LPT1` even with an extension.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what Windows forbids
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
const MAX = 120

export function safeFileName(name: string, extension: string): string {
  let base = name
    .normalize('NFC')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  // Windows reads everything before the first dot as the name: "CON.v2.stl" is still CON.
  const stem = base.split('.', 1)[0]!.trimEnd()
  if (DEVICE.test(stem)) base = `${stem}_${base.slice(stem.length)}`
  base = base
    .slice(0, MAX - extension.length - 1)
    // The cut may land inside a character written as two code units (an emoji).
    .replace(/[\ud800-\udbff]$/, '')
    .replace(/[. ]+$/, '')
  return `${base || 'Untitled'}.${extension}`
}

interface SavePicker {
  showSaveFilePicker?: (opts: {
    suggestedName: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
  }>
}

/** Resolves `false` when the person cancelled the dialog. */
export async function saveFile(data: Blob, name: string, description = 'File'): Promise<boolean> {
  const picker = (window as SavePicker).showSaveFilePicker
  if (picker) {
    const ext = name.slice(name.lastIndexOf('.'))
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description, accept: { [data.type || 'application/octet-stream']: [ext] } }],
      })
      const out = await handle.createWritable()
      await out.write(data)
      await out.close()
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false
      // Some embedders expose the API but refuse it; fall back to a download.
    }
  }
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return true
}
