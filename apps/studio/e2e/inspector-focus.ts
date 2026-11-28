import assert from 'node:assert/strict'
import type { Page } from 'playwright'

// Keep the Inspector mounted until the next editor receives keyboard focus.
export async function holdInspectorClose(page: Page) {
  const sheet = page.locator('[role="dialog"]:has([data-region="inspector"])')
  const style = await page.addStyleTag({
    content: `
      @keyframes inspector-exit { from { opacity: 1; } to { opacity: 0; } }
      [role="dialog"]:has([data-region="inspector"])[data-ending-style] {
        animation: inspector-exit 1s paused;
      }
    `,
  })
  return async () => {
    const finishedAnimations = await sheet.evaluate((element) => {
      const animations = element.getAnimations()
      for (const animation of animations) animation.finish()
      return animations.length
    })
    assert.ok(finishedAnimations, 'The Inspector sheet is still closing')
    await sheet.waitFor({ state: 'detached' })
    await style.evaluate((element) => element.remove())
  }
}
