import { z } from 'zod'

const MAX_EDITED_VERTICES = 10_000
const MAX_POSITION_MM = 1_000_000
const MAX_VERTEX_ID = 0xffff_fffe

const VertexId = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((id) => Number(id) <= MAX_VERTEX_ID && String(Number(id)) === id)
const Coordinate = z.number().min(-MAX_POSITION_MM).max(MAX_POSITION_MM)
const Position = z.tuple([Coordinate, Coordinate, Coordinate])
const VertexMap = z.record(VertexId, Position)

export const MeshVertexEdits = z
  .preprocess((value: Record<string, [number, number, number]>, ctx) => {
    if (value && typeof value === 'object') {
      if (Object.hasOwn(value, '__proto__'))
        ctx.addIssue({ code: 'custom', path: ['__proto__'], message: 'Invalid mesh vertex id' })
      if (Object.keys(value).length > MAX_EDITED_VERTICES)
        ctx.addIssue({
          code: 'custom',
          message: `A mesh body supports at most ${MAX_EDITED_VERTICES} edited vertices`,
        })
    }
    return value
  }, VertexMap)
  .meta({
    maxProperties: MAX_EDITED_VERTICES,
    description:
      'Sparse zero-based source vertex ids mapped to absolute [x, y, z] positions in millimetres. IDs follow first occurrence of each unique source position in triangle order.',
  })
export type MeshVertexEdits = z.infer<typeof MeshVertexEdits>

export const MeshEdits = z
  .strictObject({
    assetId: z.string().min(1).describe('The same asset id as source.assetId.'),
    vertices: MeshVertexEdits,
  })
  .describe('Direct vertex edits on a measured mesh asset that keeps its source placement.')
