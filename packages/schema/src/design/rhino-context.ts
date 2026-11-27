import { z } from 'zod'

const RhinoGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

const RhinoPlacement = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  layer: z.string().optional(),
  material: z.string().optional(),
  materialFromParent: z.literal(true).optional(),
})

export const RhinoContext = z.object({
  /** Source-file groups of the member and its containing placements. */
  groups: z.array(RhinoGroup),
  /** Occurrences from the outermost block towards the member. */
  placements: z.array(RhinoPlacement).max(32),
  /** Source geometry kind and native BRep face, edge and vertex counts. */
  topology: z.string().optional(),
  /** Name of the member's Rhino display material, independent of its Pavé alloy. */
  material: z.string().optional(),
  materialFromParent: z.literal(true).optional(),
})

/** Identities are shared within one import and namespaced across imports. */
export type RhinoContext = z.infer<typeof RhinoContext>
