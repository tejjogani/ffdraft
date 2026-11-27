import { inheritedMaterial, type RhinoContext } from '@pave/schema'

/** Shorten V-Ray asset paths only for display. Preserve the original label on the source. */
export function sourceMaterialLabel(context?: RhinoContext) {
  const material = context?.materialFromParent
    ? inheritedMaterial(context.placements)
    : context?.material
  if (!material) return undefined
  const asset = /^\/([^/]+)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.exec(material)
  return asset?.[1] ?? material
}
