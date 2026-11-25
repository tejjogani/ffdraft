/**
 * The plans, in one place so their numbers and words can be changed without touching code.
 *
 * Everything not listed here is free on every plan: the CAD software in full (design, CAD,
 * checks, previews), the AI jobs with your own Claude key, browser previews, and every mesh
 * export (STL, 3MF, OBJ, GLB). Only the allowances below are counted, per calendar month (UTC).
 *
 * Change a number here and restart the server; the Plan settings, the Upgrade screen, the limit
 * cards and the assistant all read it from this file.
 */

/** The plans, in the order the Upgrade screen shows them. */
export const PLAN_NAMES = ['free', 'pro'] as const
export type PlanName = (typeof PLAN_NAMES)[number]

/** What is counted: finished Blender takes, and Rhino (.3dm) or STEP exports. */
export const ALLOWANCES = ['render', 'export'] as const
export type Allowance = (typeof ALLOWANCES)[number]

/**
 * How many renders one finished Blender animation take counts as; a still counts as one.
 *
 * Two, because the allowance counts finished pictures a person takes away (the machine time
 * is their own computer's, so frames are not what is counted), and an animation is one
 * deliverable that does the work of a few stills: the turntable on a product page or a social
 * post. Counting it as two leaves room on Free to try a turntable and a still in the same month
 * without making videos free of charge; per frame (180 for six seconds) would make any video
 * impossible on Free. Change it here; the limit cards, the assistant and the estimates follow.
 */
export const ANIMATION_RENDER_COST = 2

/** The plan an organisation is on until something says otherwise. */
export const DEFAULT_PLAN: PlanName = 'free'

export interface PlanConfig {
  label: string
  /** One line under the plan's name. */
  blurb: string
  /** Per calendar month (UTC). null = unlimited, up to {@link FAIR_USE}. */
  limits: Record<Allowance, number | null>
}

export const PLANS: Record<PlanName, PlanConfig> = {
  free: {
    label: 'Free',
    blurb: 'The whole CAD studio and AI jobs with your own Claude key.',
    limits: { render: 5, export: 5 },
  },
  pro: {
    label: 'Pro',
    blurb: 'Unlimited Blender renders and Rhino and STEP exports.',
    limits: { render: null, export: null },
  },
}

/**
 * The fair-use ceiling on an unlimited allowance, per calendar month. High enough that nobody
 * working by hand reaches it; it stops a runaway script or agent loop.
 */
export const FAIR_USE: Record<Allowance, number> = { render: 1000, export: 2000 }

/** How each allowance is named in sentences ("5 free renders"). */
export const ALLOWANCE_WORDS: Record<Allowance, { one: string; many: string; label: string }> = {
  render: { one: 'render', many: 'renders', label: 'Blender renders' },
  export: {
    one: 'Rhino or STEP export',
    many: 'Rhino or STEP exports',
    label: 'Rhino and STEP exports',
  },
}

/**
 * The rows of the Upgrade screen's comparison that are not counted. The counted rows (renders,
 * Rhino and STEP exports) are written from `limits` above, so their numbers live in one place.
 */
export const PLAN_FEATURES: { label: string; free: string; pro: string }[] = [
  { label: 'Design, CAD, checks and previews', free: 'Included', pro: 'Included' },
  { label: 'AI jobs with your own Claude key', free: 'Included', pro: 'Included' },
  { label: 'Browser previews and AI captures', free: 'Unlimited', pro: 'Unlimited' },
  { label: 'Pavé files (.pave), saved and opened', free: 'Unlimited', pro: 'Unlimited' },
  { label: 'STL, 3MF, OBJ and GLB exports', free: 'Unlimited', pro: 'Unlimited' },
]
