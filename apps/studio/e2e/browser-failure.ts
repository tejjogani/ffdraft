import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import type { Page } from 'playwright'

export async function watchBrowserFailure(page: Page, check: string) {
  const folder = process.env.PAVE_BROWSER_ARTIFACTS
  if (!folder) return

  const events: { time: string; message: string }[] = []
  const record = (message: string) => {
    events.push({ time: new Date().toISOString(), message })
    if (events.length > 40) events.shift()
  }
  const prefix = 'CAD WebGL:'
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' || text.startsWith(prefix) || /WebGL/i.test(text)) record(text)
  })
  page.on('pageerror', (error) => record(error.message))
  page.on('crash', () => record('Browser page crashed'))
  await page.addInitScript((prefix) => {
    for (const type of ['webglcontextcreationerror', 'webglcontextlost', 'webglcontextrestored']) {
      window.addEventListener(
        type,
        (event) => {
          if (event.target instanceof HTMLCanvasElement) {
            const canvas = event.target.getAttribute('aria-label') ?? '(unlabelled canvas)'
            console.info(prefix, event.type, canvas, (event as WebGLContextEvent).statusMessage)
          }
        },
        true,
      )
    }
  }, prefix)

  return async (error: unknown) => {
    try {
      await mkdir(folder, { recursive: true })
      // A stalled renderer may not answer either request. Preserve the original failure and events.
      const [dialogs, screenshot] = await Promise.allSettled([
        Promise.race([
          page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]'))
              .filter((dialog) => dialog.checkVisibility())
              .map((dialog) => ({
                text: dialog.textContent?.slice(0, 3000),
                notices: Array.from(
                  dialog.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
                )
                  .filter((notice) => notice.checkVisibility())
                  .map((notice) => notice.textContent),
              })),
          ),
          setTimeout(2500, 'The renderer did not return dialog contents.', { ref: false }),
        ]),
        page.screenshot({ path: join(folder, `${check}.png`), timeout: 2500 }),
      ])
      const snapshot = {
        failure: error instanceof Error ? error.stack || error.message : String(error),
        events,
        dialogs: dialogs.status === 'fulfilled' ? dialogs.value : String(dialogs.reason),
        screenshot: screenshot.status === 'fulfilled' ? `${check}.png` : String(screenshot.reason),
      }
      await writeFile(join(folder, `${check}.json`), JSON.stringify(snapshot, null, 2))
    } catch (captureError) {
      console.warn('Could not save browser failure evidence:', captureError)
    }
  }
}
