import { z } from 'zod'
import { METAL_IDS, METALS } from '../domain/metals'

/** A commission can have confirmed constraints before its full engineering spec exists. */
export const IntakeDetailsSchema = z.object({
  metal: z.enum(METAL_IDS).optional(),
  metalDescription: z.string().trim().min(1).max(100).optional(),
  heightMm: z.number().min(3).max(200).optional(),
  thicknessMm: z.number().min(0.6).max(30).optional(),
  stoneMm: z.number().positive().max(40).optional(),
  chain: z.string().trim().min(1).max(100).optional(),
})

export type IntakeDetails = z.infer<typeof IntakeDetailsSchema>

export const IntakeSelectionInputSchema = z.object({
  conceptId: z.string(),
  visualId: z.string().nullable(),
})

export const PieceIntakeSchema = z.object({
  details: IntakeDetailsSchema,
  selection: IntakeSelectionInputSchema.extend({
    boardId: z.string(),
    visualAssetId: z.string().nullable(),
  }).nullable(),
})

export type PieceIntake = z.infer<typeof PieceIntakeSchema>

/** Only convert an exact alloy name or a single value in mm; preserve other answers in the brief/concept. */
export function intakeDetailsFromWords({
  metal = '',
  height = '',
  thickness = '',
  stone = '',
  chain = '',
}: {
  metal?: string
  height?: string
  thickness?: string
  stone?: string
  chain?: string
}): IntakeDetails {
  const terms = metal.trim().toLowerCase().replaceAll(/\s+/g, ' ')
  const alloy = METAL_IDS.find((id) => id === terms || METALS[id].label.toLowerCase() === terms)
  const number = (text: string) => {
    const found = text.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i)
    return found ? Number(found[1]) : undefined
  }
  const melee = stone.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mm)?(?:\s+(?:round\s+)?melee)?$/i)
  const heightMm = number(height)
  const thicknessMm = number(thickness)
  const stoneMm = melee ? Number(melee[1]) : undefined
  return {
    ...(alloy ? { metal: alloy } : {}),
    ...(metal.trim() ? { metalDescription: metal.trim().slice(0, 100) } : {}),
    ...(heightMm !== undefined && heightMm >= 3 && heightMm <= 200 ? { heightMm } : {}),
    ...(thicknessMm !== undefined && thicknessMm >= 0.6 && thicknessMm <= 30
      ? { thicknessMm }
      : {}),
    ...(stoneMm !== undefined && stoneMm > 0 && stoneMm <= 40 ? { stoneMm } : {}),
    ...(chain.trim() ? { chain: chain.trim().slice(0, 100) } : {}),
  }
}

export function chainFromBrief(brief: string): string | null {
  if (/\b(?:no|without(?: a)?)\s+chain\b/i.test(brief)) return 'No chain'
  const match = brief.match(/\b(cuban|cable|curb|figaro|rope|box|tennis)\s+(?:link\s+)?chain\b/i)
  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} chain` : null
}
