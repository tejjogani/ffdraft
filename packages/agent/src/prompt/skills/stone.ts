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
Use for any change of a stone's cut, size, carat, colour (its material) or quality: "make the centre a 2 ct oval", "all the melee in sapphire", "a lab diamond instead".

If your tools include design_replaceStone, use it for these changes instead of writing ops: it moves the mount with the stone and reports what changed. Otherwise make the change with design.apply on the stone's node and, in the same call, its mount, so the setting still fits:
- the setting's prongCount for the new cut (typical claws: ${claws}; a round or oval of 7.4 mm or more takes 6), unless the designer chose a count;
- the setting's prongDiameter: 0.15 × the stone's width, kept between 0.8 and 1.4 mm;
- a cathedral band's shoulderHeight: just under the new girdle height above the band;
- side stones (three-stone): they keep their size and move so each girdle sits 0.5 mm from the new centre; change their size only when asked, or say when they fall outside 0.45 to 0.75 of the centre's width;
- a shoulder row's skipCenter: wide enough to clear the new head and halo.

What to keep when nothing is said: a single stone keeps its carat when the cut changes (that is how it is bought), and the new width follows from the carat; melee in a row, halo or pavé keeps its millimetres, snapped to a stock size. A colour change keeps the size, so the mount does not move. Say what you kept: "Kept 1.50 ct: the 7.4 mm round is now a 9.2 × 6.6 mm oval".
Never change the band, the metal, the setting style or the other stones as part of a stone change.
A stone linked to a real stone (it has sourcing) loses the link when its cut, size or colour changes: set sourcing to null in the same change and tell the designer which stone was unlinked.
One stone inside a row, halo or pavé field cannot change size or cut on its own (they share seats and spacing). Offer to change the whole field, or to add a separate stone there.`
