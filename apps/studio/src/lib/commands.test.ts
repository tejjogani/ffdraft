import { describe, expect, it, vi } from 'vitest'
import { type Command, isAvailable, registerCommands, runCommand } from './commands'

const command = (id: string, over: Partial<Command> = {}): Command => ({
  id,
  title: id,
  group: 'Design',
  run: vi.fn(),
  ...over,
})

describe('the command registry', () => {
  it('runs a registered command by id and forgets it once unregistered', () => {
    const undo = command('test.undo')
    const off = registerCommands([undo])
    runCommand('test.undo')
    expect(undo.run).toHaveBeenCalledTimes(1)
    off()
    runCommand('test.undo')
    expect(undo.run).toHaveBeenCalledTimes(1)
  })

  it('does not run a command whose condition does not hold', () => {
    let selected = false
    const del = command('test.delete', { when: () => selected })
    const off = registerCommands([del])
    expect(isAvailable(del)).toBe(false)
    runCommand('test.delete')
    expect(del.run).not.toHaveBeenCalled()
    selected = true
    runCommand('test.delete')
    expect(del.run).toHaveBeenCalledTimes(1)
    off()
  })

  it('lets a later screen take an id over and gives it back when that screen leaves', () => {
    const page = command('test.export')
    const dialog = command('test.export')
    const offPage = registerCommands([page])
    const offDialog = registerCommands([dialog])
    runCommand('test.export')
    expect(dialog.run).toHaveBeenCalledTimes(1)
    expect(page.run).not.toHaveBeenCalled()
    offDialog()
    runCommand('test.export')
    expect(page.run).toHaveBeenCalledTimes(1)
    offPage()
  })

  it('keeps the newer registration when the older screen leaves first', () => {
    const page = command('test.fit')
    const dialog = command('test.fit')
    const offPage = registerCommands([page])
    const offDialog = registerCommands([dialog])
    offPage()
    runCommand('test.fit')
    expect(dialog.run).toHaveBeenCalledTimes(1)
    // The older screen is gone: its command must not come back when the newer one leaves.
    offDialog()
    runCommand('test.fit')
    expect(page.run).not.toHaveBeenCalled()
  })

  it('ignores an id nobody registered', () => {
    expect(() => runCommand('test.nothing')).not.toThrow()
  })
})
