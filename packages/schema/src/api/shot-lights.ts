import { z } from 'zod'

/** Adjustable emitters in each studio look. The keys match the rig panel IDs. */
export const SHOT_LIGHT_PANELS = {
  'studio-soft': {
    top: 'Overhead softbox',
    key: 'Key strip',
    fill: 'Fill strip',
    front: 'Front strip',
  },
  'studio-contrast': {
    top: 'Overhead softbox',
    key: 'Key strip',
    kicker: 'Side accent strip',
    rim: 'Back rim strip',
    front: 'Front strip',
  },
  'black-acrylic': {
    top: 'Overhead softbox',
    'side-left': 'Left side strip',
    'side-right': 'Right side strip',
    'rim-left': 'Left rim strip',
    'rim-right': 'Right rim strip',
    front: 'Front strip',
    'edge-left': 'Left edge strip',
    'edge-right': 'Right edge strip',
  },
  daylight: { sun: 'Sun', window: 'Window' },
  'editorial-warm': { key: 'Key panel', top: 'Overhead panel', card: 'Warm fill panel' },
  'catalog-white': {
    top: 'Overhead softbox',
    left: 'Left side strip',
    right: 'Right side strip',
    front: 'Front strip',
  },
} as const

export const SHOT_LIGHT_MAX = 2

function panelLevels<T extends Readonly<Record<string, string>>>(panels: T) {
  const multiplier = z.number().min(0).max(SHOT_LIGHT_MAX).optional()
  const fields = Object.fromEntries(
    Object.entries(panels).map(([id, label]) => [id, multiplier.meta({ description: label })]),
  ) as { [Id in keyof T]: typeof multiplier }
  return z.strictObject(fields).optional()
}

export const ShotLightLevelsSchema = z
  .strictObject({
    'studio-soft': panelLevels(SHOT_LIGHT_PANELS['studio-soft']),
    'studio-contrast': panelLevels(SHOT_LIGHT_PANELS['studio-contrast']),
    'black-acrylic': panelLevels(SHOT_LIGHT_PANELS['black-acrylic']),
    daylight: panelLevels(SHOT_LIGHT_PANELS.daylight),
    'editorial-warm': panelLevels(SHOT_LIGHT_PANELS['editorial-warm']),
    'catalog-white': panelLevels(SHOT_LIGHT_PANELS['catalog-white']),
  })
  .optional()
  .meta({
    title: 'Studio lights',
    description:
      'Per-shot multipliers keyed by look and panel ID. Only the shot’s current look applies. Omitted or 1 uses its normal level. 0 switches a panel off and 2 doubles its level.',
  })
