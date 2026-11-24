/** Skill: from a description in words to a confirmed spec and a first design. */
import { type GEM_CUT_IDS, gemDimsFromCarat } from '@pave/schema'

const mm = (cut: (typeof GEM_CUT_IDS)[number], ct: number) =>
  gemDimsFromCarat(cut, ct).width.toFixed(1)

/** Carat to millimetres for a round diamond, from Pavé's own cut table. */
const ROUND_SIZES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]
  .map((ct) => `${ct} ct ≈ ${mm('round', ct)} mm`)
  .join(', ')

export const SPEC_SKILL = `## Skill: a piece from a description
Use when the designer describes a piece they want and there is no design for it yet. A specific brief ("a 1 ct oval solitaire in rose gold") is built straight away. An open one ("something for a tenth anniversary") gets built directions to choose from first (the directions skill); work on the one they pick.

1. Read the brief for what decides the build: the kind (ring, pendant, earrings, bracelet, necklace, chain, brooch); the closest archetype; the hero stone (cut, carat or size, stone, natural or lab); the metal; the size (ring size, or the height of a pendant or charm); chain style and length; the style words.
2. Fill the gaps with conventional choices and name each in the spec summary or notes: ring size US 6 when no size is given ("size assumed"); a natural diamond unless they say lab, moissanite or a colour; 18k yellow gold unless the style or stone says otherwise (white metal for a "classic bridal" diamond or a cool palette, rose for "vintage" warmth when asked); the canon's typical proportions for everything else. Pick one variant (delicate, classic or bold) from the words and keep to it.
3. pieces.create with a title the designer would use, the kind and the brief in their words. Then pieces.setSpec: a summary a client could read, style tags that match the canon's style guides, the stones by role (centre, side, accent, halo, pavé) with a carat for the hero and millimetres for melee, and openQuestions for anything that still changes geometry or cost. The spec result carries the canon's numbers for this piece: use them.
4. pieces.buildFromSpec builds the first design once the designer approves it on the spec card. When their answers change the spec, setSpec again before building.
5. After the build, check the evaluation, then capture front, side and top in clay and look at proportion and silhouette. Fix what is clearly off with design.apply before reporting.
6. Archetypes without a recipe ("custom": a cocktail cluster, a bypass, a toi et moi, a charm of an object): create the piece, setSpec with archetype custom, then build the nodes yourself with design.apply, starting from the body (ringShank, vectorBody, relief, pipe, revolve) and adding stones and settings to it.

Sizes: ${ROUND_SIZES}. Melee is bought by diameter (0.8 to 4 mm, stock sizes); give it in millimetres.
Pictures, logos and text as the starting point (a name pendant, a crest, a pet's silhouette): a vectorBody for text or a clean outline; freeform.analyze on an uploaded image gives its outline, a height map for a relief and a recommended mode. Image-to-3D (mesh3d.create) costs money, needs approval and is for a full-round sculpted body only; stones, settings, bail and chain always stay parametric.`
