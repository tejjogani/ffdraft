/** "Add feature": the kinds this kernel can build, grouped, each disabled with a reason when its references cannot be met. */
import type { Design, NodeKind } from '@pave/schema'
import { Button, Menu, MenuGroup, MenuItem } from '@pave/ui'
import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import type { SectionTool } from '../curves/section-model'
import { KIND_ICON } from '../kindIcon'
import { addMenu } from './suggestions'

export interface AddMenuProps {
  design: Design
  kinds: readonly string[]
  target?: string
  onAdd(kind: NodeKind, sectionTool?: SectionTool): void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AddMenu({ design, kinds, target, onAdd, open, onOpenChange }: AddMenuProps) {
  const groups = addMenu(design, kinds, target)
  const trigger: ReactElement = (
    <Button
      icon={Plus}
      size="sm"
      aria-keyshortcuts="A"
      title="Add feature (A)"
      disabled={!groups.length}
    >
      Add feature
    </Button>
  )
  return (
    <Menu trigger={trigger} align="start" open={open} onOpenChange={onOpenChange} className="w-72">
      {groups.map((g) => (
        <MenuGroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <MenuItem
              key={o.sectionTool?.id ?? o.kind}
              icon={KIND_ICON[o.kind]}
              disabled={!!o.disabled}
              description={o.disabled ?? undefined}
              onClick={() => onAdd(o.kind, o.sectionTool)}
            >
              {o.title}
            </MenuItem>
          ))}
        </MenuGroup>
      ))}
    </Menu>
  )
}
