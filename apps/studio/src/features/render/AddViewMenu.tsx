import type { RenderScene } from '@pave/schema'
import { Button, Dialog, Input, Menu, MenuGroup, MenuItem, MenuSeparator, toast } from '@pave/ui'
import { Copy, House, Plus } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { addShot, saveHouseShot } from './shot-actions'
import type { Shot } from './shots'

const views = [
  { title: 'Hero', preset: 'hero', focalLength: 90 },
  { title: 'Front', preset: 'front', focalLength: 90 },
  { title: 'Top', preset: 'top', focalLength: 90 },
  { title: 'Detail', preset: 'macro', focalLength: 105 },
] as const

export function AddViewMenu({
  pieceId,
  shot,
  houses,
  beforeOpen,
  onAdded,
  disabled,
}: {
  pieceId: string
  shot: Shot
  houses: { id: string; title: string; scene: RenderScene }[]
  beforeOpen: () => void
  onAdded: (id: string) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState<RenderScene | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const submission = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const formId = useId()
  const nameId = useId()

  const choose = (title: string, scene: RenderScene) => {
    setName(title.slice(0, 80))
    setDraft(scene)
  }
  const add = async (title: string, scene: RenderScene) => {
    if (submission.current) return
    submission.current = true
    setSaving(true)
    try {
      const row = await addShot(pieceId, title, scene)
      setDraft(null)
      onAdded(row.id)
    } catch (e) {
      toast.error('Couldn’t add the view', e instanceof Error ? e.message : undefined)
    } finally {
      submission.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Menu
        trigger={
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={beforeOpen}
            disabled={disabled || saving}
          >
            Add view
          </Button>
        }
        align="start"
        className="min-w-48"
      >
        {views.map(({ title, preset, focalLength }) => (
          <MenuItem
            key={preset}
            onClick={() =>
              choose(title, { ...shot.scene, camera: { preset, focalLength, roll: 0 } })
            }
          >
            {title}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Copy} onClick={() => choose(`${shot.title} copy`, shot.scene)}>
          Copy current
        </MenuItem>
        <MenuItem
          icon={House}
          onClick={() =>
            void saveHouseShot(shot.title, shot.scene)
              .then((h) => toast.success(`Saved “${h.title}” as a house shot`))
              .catch((e: Error) => toast.error('Couldn’t save the house shot', e.message))
          }
        >
          Save {shot.title} as a house shot
        </MenuItem>
        {!!houses.length && (
          <>
            <MenuSeparator />
            <MenuGroup label="House shots">
              {houses.map((house) => (
                <MenuItem key={house.id} onClick={() => void add(house.title, house.scene)}>
                  {house.title}
                </MenuItem>
              ))}
            </MenuGroup>
          </>
        )}
      </Menu>
      <Dialog
        open={!!draft}
        title="Add view"
        initialFocus={input}
        onOpenChange={(open) => !open && !submission.current && setDraft(null)}
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={saving || !name.trim()}>
              {saving ? 'Adding…' : 'Add view'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            if (draft && name.trim()) void add(name.trim(), draft)
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium" htmlFor={nameId}>
            View name
            <Input
              id={nameId}
              ref={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
          </label>
        </form>
      </Dialog>
    </>
  )
}
