/** Skill: replacing a stone and keeping the mount (plans/targeted-edits.md §2). */
import { GEM_CUT_IDS, type GemCutId } from '@pave/schema'

/** Claws a cut takes (typical), from the canon's table; asserted equal to it in a test. */
export const CLAWS_BY_CUT: Record<GemCutId, number> = {
  round: 4,
  oval: 4,
  princess: 4,
  emerald: 4,
  asscher: 4,
  cushion: 4,
  radiant: 4,
  marquise: 6,
  pear: 5,
  heart: 5,
  baguette: 4,
  trillion: 3,
  cabochon: 4,
}

const claws = GEM_CUT_IDS.map((c) => `${c} ${CLAWS_BY_CUT[c]}`).join(', ')

export const STONE_SKILL = `## Skill: replacing or resizing a stone
Use for any change of a stone's cut, size, carat, colour (its material) or quality: "make the centre a 2 ct oval", "all the melee in sapphire", "a lab diamond instead". A message sent from a stone's "Ask AI" menu arrives with that stone as the selection.

Make these changes with design_replaceStone, never with hand-written ops: it changes the stone and the mount follows (claws, wire, side stones, shoulders and the shoulder row), while the ring size, metal, setting style and anything the designer set by hand stay. Target the stone by its node id; for one stone of a row, halo or pavé give its \`instance\` too; scope \`all\` changes every stone of the field, \`alike\` both side stones or both studs. Give the size as widthMm or carat, not both.
When the designer asks what a change would cost or weigh, or the change is large (another cut, more than half a carat), call it with dryRun first and report its delta (metal weight, carats, stone count) and warnings; apply once they agree, or at once when they asked plainly for the change.
After it applies, say in one line what changed and what was kept, from the reply's notes: "Kept 1.50 ct: the 7.4 mm round is now a 9.2 × 6.6 mm oval". Pass on every warning: a stone linked to a real stone (sourcing) loses the link when its cut, size or colour changes, and the reply names it.
What is kept when nothing is said: a single stone keeps its carat when the cut changes (that is how it is bought), so the width follows from the carat; melee in a row, halo or pavé keeps its millimetres, snapped to a stock size; a colour change keeps the size, so the mount does not move.
One stone inside a row, halo or pavé cannot change size or cut on its own (they share seats and spacing): design_replaceStone refuses it. Offer to change the whole field (scope \`all\`), or to add a separate stone there.
Never change the band, the metal, the setting style or the other stones as part of a stone change.

Adding a new stone (not changing one) is a design_apply edit; give it a setting that fits: prongCount for the cut (typical claws: ${claws}; a round or oval of 7.4 mm or more takes 6) and prongDiameter 0.15 × the stone's width, kept between 0.8 and 1.4 mm.`
