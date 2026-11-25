/**
 * The 3D view's context menu, for a stone, a part or empty space. The view opens it itself
 * (through `handle.openAt`), never on the browser's `contextmenu`: right-drag pans there, so
 * only a right-click without movement, a long press or Shift+F10 / the Menu key opens it.
 * Items run the same commands as the palette, on the selection: the click selects what it is
 * on, unless that is already part of the selection, which then stays whole.
 */
import { type Design, nodeTitle } from '@pave/schema'
import { ContextMenu, type ContextMenuHandle, MenuGroup, MenuItem, MenuSeparator } from '@pave/ui'
import { Eye, EyeOff, Focus, Plus, Trash2 } from 'lucide-react'
import type { Ref } from 'react'
import { runCommand } from '../../../lib/commands'
import { AskAiSection } from '../../assistant/AskAiSection'
import type { Subject } from '../../assistant/quick-intents'
import { useWorkspace } from '../state/workspace'

export interface ViewportMenuProps {
  handle: Ref<ContextMenuHandle>
  subject: Subject
  design: Design
  readOnly: boolean
  onDelete(ids: string[]): void
}

export function ViewportMenu({ handle, subject, design, readOnly, onDelete }: ViewportMenuProps) {
  const hidden = useWorkspace((s) => s.hidden)
  const selection = useWorkspace((s) => s.selection)
  const node = subject.type === 'piece' ? undefined : design.nodes[subject.nodeId]
  const isHidden = !!node && hidden.includes(node.id)
  // A right-click on part of a selection leaves it whole: Hide and Delete act on all of it.
  const ids = node && selection.includes(node.id) ? selection : node ? [node.id] : []
  return (
    <ContextMenu
      handle={handle}
      content={
        <>
          {node ? (
            <MenuGroup label={ids.length > 1 ? `${ids.length} features` : nodeTitle(node)}>
              <MenuItem icon={Focus} onClick={() => runCommand('view.fit')} shortcut="f">
                Fit to view
              </MenuItem>
              <MenuItem
                icon={isHidden ? Eye : EyeOff}
                onClick={() => runCommand('design.hideSelected')}
                shortcut="h"
              >
                {isHidden ? 'Show in view' : 'Hide in view'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={Trash2}
                danger
                disabled={readOnly}
                onClick={() => onDelete(ids)}
                shortcut="delete"
              >
                Delete
              </MenuItem>
            </MenuGroup>
          ) : (
            <>
              <MenuItem icon={Focus} onClick={() => runCommand('view.fit')} shortcut="f">
                Fit to view
              </MenuItem>
              {hidden.length > 0 && (
                <MenuItem icon={Eye} onClick={() => runCommand('view.showAll')}>
                  Show all hidden features
                </MenuItem>
              )}
              <MenuItem
                icon={Plus}
                disabled={readOnly}
                onClick={() => runCommand('design.add')}
                shortcut="a"
              >
                Add a feature…
              </MenuItem>
            </>
          )}
          <AskAiSection subject={subject} />
        </>
      }
    >
      {/* The anchor the view opens the menu on; it never takes pointer input itself. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" />
    </ContextMenu>
  )
}
