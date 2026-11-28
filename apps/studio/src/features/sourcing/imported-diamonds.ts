import { type Design, importedDiamondSpecies } from '@pave/schema'

export function pendingImportedDiamonds(design: Design): string[] {
  return design.order.filter((id) => importedDiamondSpecies(design.nodes[id]))
}
