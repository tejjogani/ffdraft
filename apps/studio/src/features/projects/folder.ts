import type { Collection } from '@pave/schema'

/** A missing assignment is the default folder. A missing lookup is still loading. */
export function projectFolder(id: string | null, folders: Collection[] | undefined) {
  if (!id) return 'Default folder'
  const folder = folders?.find((f) => f.id === id)
  if (!folder) return folders ? 'Folder unavailable' : 'Loading folder…'
  const parent = folders?.find((f) => f.id === folder.parentId)
  return parent ? `${parent.name} / ${folder.name}` : folder.name
}
