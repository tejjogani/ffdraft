/** Skill: from a photo of a piece to a parametric design (research 11, plans/reference-match). */
export const PHOTO_SKILL = `## Skill: a design from a photo
Use when the designer uploads or picks a picture of a piece and wants it (or something like it) in Pavé. The images are in their message; their asset ids are in the context message.

What a photo can and cannot tell you:
- Read categories, not totals: the kind, the archetype, the cut and shape of the hero stone, the setting style and claw tips, the band profile and shoulders, halo or not, the metal colour, the surface. These you can read well.
- Do not count more than about ten things from pixels, and never read millimetres from pixels. A row's or a pavé field's count comes from the geometry (arc length over stone pitch; area times packing), which the kernel computes once the design exists.
- Familiar patterns mislead: a solitaire suggests four claws and a three-stone suggests three stones. Count claws on the head itself, looking at it directly, before you name the archetype. If you cannot see them all, say how many are visible and use the canon's typical count for that cut.
- What the photo hides is assumed, not seen: the back, the under-gallery, the inside of the band, the depth of a relief. Say which parts are assumed.
- Scale is never in the photo. Ask once for one anchor: the ring size, the centre stone in carats or millimetres, or the pendant's height. If the designer does not know, assume (ring size US 6, a 1 ct centre, or the canon's typical height) and say "scale assumed".

How to work:
1. Describe the piece in a few lines, part by part (head, shoulders, band, gallery, bail, chain), each marked seen, partly seen or not visible.
2. Choose the closest archetype and build it through the spec (pieces.create with origin naming the photo's asset, pieces.setSpec, pieces.buildFromSpec). Proportions are ratios: the band width against the stone width, the head height against the stone, the halo stones against the centre.
3. Compare: capture the design in clay from the angle closest to the photo (front, top or three-quarter) and look at the two side by side. Adjust the few numbers that explain the difference, two or three rounds at most, and stop when the remaining gap is only what the photo hides.
4. Report what matches, what is unsure (and the question that would settle it), and what was assumed.

Parts no recipe explains (a figure, a crest, an organic form): only that part becomes a freeform body. freeform.analyze on the image gives the outline (a vectorBody when it is flat), a height map (a relief, the default) and a recommended mode. Image-to-3D (mesh3d.create) needs approval, costs money, wants two or more real views and is only for a full-round body. Stones, settings, bail and chain stay parametric, also on a sculpted body.

Rights: a photo of someone else's piece is a reference. Record it in the piece's origin. Logos, characters and real people need the designer's attestation before export or production; you cannot give it.`
