# Making the six looks read as photographs

26 November 2026. The founder rendered on his laptop and wrote: "The renders also don't scream
realism … The black acrylic for one looks really bad." This note records what was wrong, what
each change did to the picture, and what did nothing. Everything marked **measured** was
rendered with and without the setting through the product's own pipeline (canon recipe, kernel
production evaluation, GLB, `resolveScene`, the Blender worker; Blender 5.3.0, Cycles on two
CPU threads) and both pictures were looked at, whole and cropped on the stone and the ground.

Three pieces, built by `packages/render/scripts/pieces.ts`: a 6.44 mm round diamond solitaire
in 18k yellow gold, a platinum full eternity band with 32 stones of 1.8 mm, and a blue
sapphire pendant in rhodium-plated white gold on a cable chain. Render any of them in any look:

```
PAVE_PYTHON=<python with bpy> PAVE_RENDER_THREADS=2 pnpm --filter @pave/render look-shots <outDir> --piece solitaire --look black-acrylic --size 768 --quality preview
```

`--set output.bounces.glossy=12` (any field of the resolved scene) renders the "without" of a
pair. The rules that came out of this are tests: `packages/render/src/looks.test.ts` and
`workers/render/tests/test_scene.py`.

## What was wrong (the baseline)

1. **The rigs were exposed for a diffuse subject.** Softboxes were 4 to 9 times display white
   and the room 0.85 to 1.1 in every direction. Polished metal shows the rig itself, so gold
   mirrored a blown-out tent: cream highlights, no darks, beige plastic. A diamond in the same
   room found something bright behind every facet and rendered flat white.
2. **The sun cast no shadow.** Panels carried their radiance in a vertex colour. Cycles decides
   how often to sample an emitter from the constants it can read off the shader, read every
   panel as strength 1, and sampled the small sun about a hundredth as often as it needed.
3. **The main light was straight overhead**, so what shadow there was fell under the piece,
   where a thin ring hides it.
4. **Black acrylic was a void**: a black room, a black sheet and a black background, with a dim
   mirror image as the only sign of a surface. From above, the top softbox lay across the sheet
   as a grey rectangle.
5. **Stones were cut off at 12 bounces**, CAD edges were razor sharp, and Editorial warm went
   through AgX with 3400 K lights, which turned yellow gold copper and platinum rose.

## Measured pairs

| Setting | Pair | What the picture did |
|---|---|---|
| Glossy bounces | 12 against 32 (transmission 24 against 32), solitaire macro, 64 samples | 22.8 % of the stone's pixels changed by more than 8/255; the stone's mean rose 2.2 %; the dark facets at 12 are paths that ran out, not contrast. In the old bright tent that left the stone *flatter*: depth removes false blacks, it does not add structure. No time difference outside the noise of a shared machine. Now 24 / 24 / 24 for drafts and 32 / 32 / 32 for takes. |
| Panel radiance and room | old rigs against new, all three pieces, all looks | The largest change of all. Panels at 1.3 to 3.2 and a room well under 1: gold shows saturated yellow, amber and near-black lines at once; the diamond shows grey and white facets with crisp edges. (18k gold mirrors a panel of 2 at display (0.96, 0.76, 0.51); a panel of 6 at (0.99, 0.85, 0.69), cream.) |
| Emitter strength as a shader constant | vertex colour against constant, Daylight | With the constant the sun casts a crisp shadow and the band shows a hard highlight; before, no shadow formed at any sample count tried. |
| Main light above and behind | overhead (elevation 78 to 82°) against azimuth 180°, elevation 64 to 70° | The contact shadow falls toward the camera and is seen; the top faces of the piece carry a long highlight. |
| A dimmer room for light leaving a stone | `ambient.stones` 1 against 0.3, Studio soft macro | At 1 the diamond is light grey on white with little dark; at 0.3 it has dark and bright facets, a readable table and star facets. The metal is unchanged. Used in Studio soft, Catalogue white and Daylight, whose rooms are bright. |
| Edge rounding on metal (shading only) | none, 0.06 mm, 0.15 mm, eternity band | None: the band's top meets its side in a line that catches no light. 0.06 mm: a hairline highlight, barely there at 512 px. 0.15 mm: a soft, clearly rounded edge. 0.1 mm is used. On the round-wire solitaire not one pixel changed: it only acts where the CAD is sharp. Cost inside the timing noise. Never on stones. |
| View transform | AgX against Khronos PBR Neutral, Editorial warm | AgX greys the gold and the sweep to pale rose-beige; Neutral keeps the gold golden. Every look now uses Neutral. Neutral has a toe: linear values under 0.08 come out as 6.25 x² (0.04 becomes 0.01), so dim reflections and a dim backdrop render far darker than their linear value. The acrylic's horizon glow had to be 0.26 to show as a charcoal gradient. |
| Mirror ground and the rig | panels mirrored in the sheet against flagged off, top-down on black acrylic | Mirrored: the top softbox covers the upper half of the frame as a grey rectangle, with the lens card as a black notch. Flagged off: a clean black sheet. The worker now uses two planes: the one the camera sees is excluded from what each panel lights; a second, seen only by rays leaving the piece, mirrors the whole rig, so the underside of the piece is still lit by the sheet. (Two coincident planes halved the mirror image; the second sits 2 µm lower.) |
| The room as the backdrop | flat black background against the world seen by the camera, black acrylic | A glow along the horizon (0.26 falling to 0.04 overhead) mirrors in the sheet as a gradient from charcoal at the top of a hero frame to black at the bottom, and the sheet reads as a surface. |
| A real ground under Studio contrast | shadow catcher on a charcoal gradient against a charcoal paper sweep | On a dark backdrop a shadow catcher shows nothing and the piece floats; the lit sweep gives a long real shadow and a falloff of light across the ground. |
| Indirect clamp | 30 against off, black acrylic macro and Studio soft macro, 64 samples | 0.2 % of the stone's pixels changed; no pixel in either frame reached display white. Nothing to see. Drafts keep 30, takes stay unclamped. |
| Caustics | off against on: Daylight solitaire, Editorial pendant | 0.5 % and 0.7 % of pixels changed, none of it a visible spot of light. On only where the ground takes light (Daylight, Editorial warm); off elsewhere. |
| Filter glossy | 0.5 against 0.2 | 0.06 % of the stone's pixels. |
| Sparkle lights | on against off | At their old size (0.5° across) they changed 0.2 % of a stone's pixels: nothing lined up. At 2.3° across and 12 lights, 1.6 % at 256 samples, and coloured speckle at 64. Fire in these pictures comes from the edges of the panels, not from the sparkle lights. Kept, larger and dimmer; they are not what makes a stone sparkle here. |
| Denoiser | pinned settings | The worker now names Open Image Denoise, albedo and normal guides, accurate prefilter, CPU. These were already Blender's defaults, so no pixel changed. At 64 samples facet interiors are grainy with colour; at 256 they are clean (Studio soft macro). |
| Exact white | corner pixels of Catalogue white | 255, 255, 255: the worker already composites the background after the render. |
| Stone base colour, roughness, Abbe number | read from the worker | Already white, 0 and the stone's own Abbe number; now held by a test. |
| Metal colours | repository table against the laptop skill's | The pure metals agree to 0.005. The karat alloys differ by at most 0.03 in one channel, less than a render pair shows; both are estimates no swatch has checked. Left as they are. |

## Second session: gold that reads as gold

The first session's renders were looked at again, whole and cropped. Black acrylic and Studio
contrast still showed gold as olive-brown brass over most of the band; Studio soft and Catalogue
white showed it cream. Each change below was rendered with and without on the solitaire (and on
the eternity band for black acrylic) at 512 px, then in the full set at 768 px.

| Setting | Pair | What the picture did |
|---|---|---|
| Thin strips just off the lens axis (black acrylic) | without against two strips at ±16° and +20°, 20° up, 0.45 radii wide, 5 and 4, walls dimmed to 0.9 / 0.7 | A crisp brighter line down each side of the solitaire band and a brighter diagonal on the eternity band's face. The band as a whole stayed olive. |
| Brighter front walls (black acrylic) | walls 0.9 / 0.7 against 2.0 / 1.6 | Almost nothing: a little lighter in a few places. The band does not mirror the walls much from this camera. |
| Low softbox behind the camera (black acrylic) | without against 3° up, 8 × 1 radii, 2.5 | The largest change of the session (`black-acrylic-low-front-pair.jpg`, first session left). From 22° up the front and underside of a round band mirror the floor and the low room behind the camera; on black both are black, and gold there was olive. With the strip the band is amber-gold with one bright gradient along its front and dark edges kept. Diamond unchanged; the camera does not see the strip and the sheet does not mirror it toward the camera. |
| The same strip on Studio contrast | without against 2.2 | The lower half of the band went from olive-brown to gold; the flags still draw dark edges (`studio-contrast-low-front-pair.jpg`). Modest. |
| Walls in the bright looks | Studio soft 1.6 / 1.35 against 1.1 / 0.95; Catalogue white 1.7 / 1.45 against 1.15 / 1.0 | Gold a little more amber and the band shows darker strokes; the diamond unchanged. Gold mirrors these walls over most of a band, and above about 1.2 the view transform's shoulder takes the yellow out. Still pale beside a retouched product photo. |
| 18k yellow gold colour | the table's value against ISO 8654 | Base colour (0.98, 0.75, 0.47) is L* 90.7, a* 3.5, b* 24.2; the standard's 2N (18 ct yellow) is L* 90.2, a* 3.47, b* 25.1: ΔE 1. A test holds it. The paleness in bright looks is the light, not the alloy. Raising green to 0.77 (first session) made it paler. |

What did not help, or was not tried: brighter walls on black acrylic (above); a saturation lift
on the yellows, which is what retouchers do to product photos of gold, was not tried because the
looks promise true colour. Tilting the eternity band, or a card in the sheet's reflection, would
light its flat outer face, which stays gunmetal on black acrylic.

Cost here, two CPU threads, the full 18-picture set at 768 px Preview: 92 to 198 s per megapixel,
median about 150. Standard (384 samples, noise threshold 0.02) at 1600 px: black acrylic 401 s
(157 s per megapixel; adaptive sampling stops early on a mostly black frame), Daylight 943 s
(368 s per megapixel; caustics on and a bright frame). At that tier the diamond's facets are
clean, with crisp edges and spectral colour; the coloured grain of the Preview tier is gone.

## How each look is lit now

Panels are named by where they stand as seen from the camera: 0° is behind the camera, 180°
behind the piece.

- **All looks**: a softbox above and behind (the main light), white walls or strips filling
  the half of the room behind the camera (most of what a convex polished piece mirrors), thin
  black cards between them, a black card on the lens axis, and for the soft looks a black belt
  along the horizon in front that draws the dark line round a band.
- **Black acrylic**: sheet of IOR 1.49, roughness 0.06. At a hero angle it mirrors about 15 %,
  so the mirror image is dim and fades; rim strips behind at ±145°, side strips, two walls, two
  thin bright strips just off the lens axis, and a long low softbox behind the camera.
- **Studio contrast** also has the low softbox behind the camera.
- **Studio contrast**: four wide strips with gaps, a rim strip, on a charcoal paper sweep.
- **Catalogue white / Studio soft**: bright walls, bright floor bounce (a white table mirrors
  as white), the room dimmed to 0.3 for stones.
- **Daylight**: sun behind and to the left at 48°, a window to the right, a bounce card, a dark
  card low on the left for contrast.
- **Editorial warm**: key from behind-left at 40° on a cream sweep; lights at 5000 to 5600 K
  so white metal stays white and the warmth comes from the sweep.

## Sources

The session's network let search results through but refused every page fetch, so these were
read as search summaries, not opened. They agree with each other and with the earlier research
(`../../14-jewelry-rendering.md` §4.10, `../../reports/Jewelry product page renders.md`).

- Black backgrounds are made by the light, not the backdrop; negative fill with black cards;
  acrylic gives a reflection under a ring: [Picup Media](https://blog.picupmedia.com/how-to-photograph-jewelry-on-a-black-background).
- A mirror surface with a spot on the backdrop for a gradient; angle the light so only the
  backdrop mirrors: [Photigy](https://www.photigy.com/photographing-jewelry-the-lighting-setup-tips-and-tricks-plus-bonus-video/).
- Key light at about 45° for a clean reflection on black acrylic; a black flag in a backlight
  for rim light; strip softboxes for edge lines: [Path](https://pathedits.com/blogs/tips/how-to-photograph-reflective-products-tips-and-examples), [Venus](https://www.venuslens.net/black-product-photography/).
- Do not tent a diamond in white: it goes flat: [Rapaport](https://rapaport.com/magazine-article/photographing-a-diamond-how-to-bring-out-the-bling/).
- A black strip mirrored in the band draws the dark edge that defines its curve: [Tryhylo](https://tryhylo.com/learn/guides/how-to-photograph-rings-without-reflections).
- Light the white background apart from the piece: [Visual Education](https://visualeducation.com/jewellery-photography-top-tips-for-how-to-photograph-jewellery/).
- White balance decides whether gold reads as gold; a wrong one makes it brassy: [Adorama](https://www.adorama.com/alc/how-to-photograph-jewelry).
- Render artists light stones and mount apart and round edges slightly: [Blender Artists](https://blenderartists.org/t/how-to-achieve-realistic-diamond-caustics-and-light-play-in-cycles/1605044), [Novedge](https://novedge.com/blogs/design-news/rhino-3d-tip-rhino-jewelry-rendering-tips-for-polished-presentations).
- Second session (page fetches still refused; search summaries only): two strip lights at
  opposing angles give defined highlight bands on a ring; black cards add the dark edges that
  give gold its shape: [Shopify](https://www.shopify.com/blog/jewelry-photography),
  [ExpertPhotography](https://expertphotography.com/jewelry-photography-mistakes/). Soft
  gradients and bright strip highlights define the curve of a ring in a render; dark grey
  backdrops strengthen metal reflections: [Novedge](https://novedge.com/blogs/design-news/rhino-3d-tip-rhino-jewelry-rendering-tips-for-polished-presentations),
  [Will Gibbons](https://www.willgibbons.com/blog/jewelry). Expose for the piece, light the
  white background apart, and correct the yellows of gold selectively afterwards:
  [UniquePhoto](https://www.uniquephoto.com/community/qa/how-do-i-get-a-pure-white-background-for-jewelry-photos-without-losing-shine-and-sparkle),
  [Path](https://pathedits.com/blogs/tips/how-to-edit-jewelry-product-photos-like-a-pro).
  ISO 8654 nominal colours 2N and 3N: [ISO 8654 sample](https://cdn.standards.iteh.ai/samples/76036/b7e7b6570a9243c8ba787db22543cef8/ISO-8654-2018-Amd-1-2019.pdf)
  (read through a search summary; verify against the standard).

## Fix-1: the critique's findings, each judged on a pair

A reviewer rendered pieces the looks were not tuned on (face-up studs, a rose-gold three-stone
with pavé shoulders, the solitaire) and found twelve faults. Each fix below was rendered before
and after through the same chain at 768 px, 64 samples, two threads, and looked at whole and
cropped on the stone and the ground. Stone figures are luminance percentiles (0–255) inside the
stone; metal figures are CIE L* percentiles under the piece's mask.

- **Black acrylic from a low camera (measured).** An earring's front shot is 6° up; from there
  the camera saw the horizon glow itself, a grey wall at 126–129 with a hard line where the
  sheet starts. Raising any shot under 16° to 16° (aim and distance kept) gives a black sheet,
  a charcoal glow and a fading mirror image (`fix1-black-acrylic-studs.jpg`). A test holds it:
  no shot of any kind of piece resolves under 12° on black acrylic.
- **Mirror image cut at the bottom edge (measured).** On a mirror ground the aim drops by 15 %
  of the frame's half height, times cos(elevation): the ring rises in the frame and the top of
  its reflection is in the picture. It is still cut lower down on a standing ring.
- **Face-up stones slate grey on white sets (measured).** Studs on Catalogue white: p5/p50/p95
  85/142/206 before, crisp white facets with dark structure after (p95 251; `fix1-face-up-stud.jpg`).
  Two cards only stones see (±25°, 16° up, 1.5 × 5 radii, strength 5) and a belt card the stones
  do not see. The metal is unchanged by either.
- **Draft stones as RGB confetti (measured).** Not the sparkle discs and not noise that more
  samples clear: 128 samples at threshold 0.03 left it, and so did an Abbe number of 5000. With
  `Transmission Dispersion Scale` 0 the same 64-sample draft shows clean facets
  (`fix1-dispersion-draft.jpg`, 5× crop: with, Abbe 5000, Scale 0). Cycles samples one colour
  channel per path for dispersion. Drafts now trace no dispersion; fire comes from the standard
  tier up. Sparkle is four discs 1.3° across instead of twelve of 2°.
- **Animation stones boil (measured).** Rack focus, 512 px, 32 samples: held frames changed
  1,600–1,850 stone pixels by more than 30 levels per step with an animated seed, none with a
  fixed one. Every frame now uses the same seed.
- **Flat satin gold on white sets (measured).** Solitaire on Catalogue white, band L*
  p10/p50/p99: 70/80/92 before, 16/80/92 after a black card 16° below the horizon in front, for
  the metal only (`fix1-gold-on-white.jpg`). Widening the side cards to 1 radius at ±48° alone
  moved p10 to 59.
- **Editorial warm (measured).** Stones see 0.3 of the warm room and two neutral stone cards;
  a background light behind the piece, facing away, lights the sweep: top corner 132, 108, 83
  before, 196, 165, 136 after, a smooth gradient to cream at the horizon
  (`fix1-editorial-warm.jpg`). Aimed 8° up it drew a bright band on the cove, 20° up a dark one;
  lit from behind the camera, the floor went pale first.
- **Daylight beige (measured).** Card [0.45, 0.5, 0.56] and the window at 7000 K: the corner
  went from 229, 217, 206 to 218, 216, 216, an airy grey-white with a blue sky shadow. Stones
  see 0.2 of the sky; they are a little less hazy (p5 124 to 117 on the three-stone, structure
  clearer) but still milky against Catalogue white.
- **Studio contrast (partly).** Front-left 2.8 and kicker 3.0 lifted the rose-gold band's
  middle from L* 31.9 to 35.7. A background light on the charcoal sweep lifted the top of the
  frame from 19 to 33–60 but in every version left a visible line where the floor meets the
  cove; it is not in the look.
- **Pavé (no effect from the fix asked for).** The confetti on 0.9 mm shoulder stones went with
  dispersion; they now read as small white-pink flecks. A second sparkle set for small stones
  (four discs 0.3° across near the lens axis, strength 60) made no visible difference with and
  without at 768 px, where such a stone is five pixels, and was not kept.
- **Red seats inside the rose-gold shank (not changed).** The culets do not pierce the inner
  surface: the shoulder stones' centres sit 9.99 mm from the ring axis, their culets about
  9.6 mm, against an inner radius of 8.25 mm. The orange is light bouncing inside the drilled
  seat holes in a copper alloy; capping metal bounces was not tried.
- **Rejected: the sweep hidden from light leaving a stone.** Tried to whiten Editorial warm's
  champagne-looking studs: the stones went darker (p50 176 to 111) and stayed warm. Stones on a
  warm sweep still lean warm (mean 191, 167, 145 against 167, 142, 116 before).
- **Draft time.** 768 px previews took 48–128 s on two threads (median 85 s; about 2 s per
  million pixel-samples after the fixed cost) and 512 px drafts 54 and 65 s; the typical rate
  had said 0.6 for four threads and 10 s a pass. It is now 1.1 and 15 s, for four threads.
- **Not done.** Studs are framed as a pair with each stud under a fifth of the frame: the pair's
  spacing comes from the kernel's earring layout, outside this package.

## Fix-2: the second critique, each judged on a pair

A reviewer re-rendered the fix-1 looks and found fix-1 had hidden, not fixed, the grain in
takes, and left three bright looks that read alike. Each change below was rendered with and
without it through the same chain (768 px previews, 64 samples, two threads, unless named) and
looked at whole and cropped. Stone figures are luminance percentiles (0–255) and mean RGB over
the stone pixels alone (a stone matte the worker now renders, metal held out); band figures are
L* percentiles under the piece's mask below row 320. Scratch renders and crops are outside the
repository; the pairs kept are the `fix2-*.jpg` files here.

- **Grain in takes is dispersion, and more samples do not clear it (measured, V1).** Solitaire on
  black acrylic, share of stone pixels with chroma above 30: 22 % at 384 samples (threshold
  0.02 and 0.005 the same), 14.6 % at 1024 samples, 14.8 % at 1024 with the denoiser off, 8.8 %
  at 1024 with the Abbe number quadrupled, 3.9 % with dispersion off (`fix2-dispersion-takes.jpg`:
  384 with, 1024 with, 1024 without). Denoiser off changed nothing, so it is not keeping noise:
  the converged picture is a mosaic. Cycles' dispersion is RGB, not spectral; each channel
  takes its own path through thirty bounces. No tier traces it now; a standard take of the same
  ring scores 0.1 % and is clean, the same take with dispersion forced on 11.8 %. look-shots now
  fails a standard or final take over 5 %. At 1600 px and 1024 samples (857 s on two threads)
  the facets read again, each edge fringed with rainbow, but 20 % of stone pixels are coloured
  (14.8 % downsized to 800 px): busier than any photograph's fire, which is a few flashes.
- **Face-up stones white (measured, V3).** Stone cards at ±18°, 10° up, strength 8 (were ±25°,
  16°, 5); Daylight gets them at 6; the black card behind the piece is metal only. Stud stone
  p5/p50/p95: Catalogue white 99/164/253 to 107/234/254, Studio soft 81/148/253 to 90/230/254,
  Daylight 113/189/235 to 132/220/253 (`fix2-face-up-studs.jpg`). The grey bar across the table
  is gone. They are now bright rather than contrasty: the arrows show but faintly.
- **A flat band side that mirrors one direction (measured, V2).** The fix asked for (a 9 × 4
  floor card 22° down, black flags at ±70°, 5° up) only blackened the inside of the shank: a
  one-bounce reflection map showed the flags mirrored by nothing, and the side of the
  three-stone's band mirroring 78° round and 33° down on every pixel. Gradient cards there (±78°,
  38° down, 3 × 3 radii, bright below, black above, metal only) give the side a polished run from
  dark under the head to bright at the bottom (`fix2-three-stone-white-sets.jpg`). Band L*
  p10/p50/p90: Studio soft 61/65/73 to 39/68/86, Catalogue white 68/77/82 to 42/77/86; solitaire
  Studio soft p90 77 to 87. The floor card is back at its fix-1 size.
- **Colourless stones in rose gold (measured, V5).** The centre stone's R − B was 33–35 in the
  bright looks, and whiter stone cards did not move it: the pavilion shows the rose claws and
  gallery. The metal now keeps 30 % of its colour on any path that has passed through a stone
  (`Transmission Depth` above 0; testing "is transmission ray" only reached 22, as light bounced
  on between claws). R − B 14 in Studio soft, Catalogue white and Daylight; at 0 % the stone looked
  set in white gold. Pavé went from beige-pink flecks (R − B 53–55, 14–17 % coloured pixels) to
  white (19–20, 0.2 %). (An earlier version said the orange seats inside the shank were gone too; the review at `810d46e` found them unchanged, 94 orange pixels against 102: see `../../24-render-realism-measured.md`.)
  This is a deliberate departure from physics, the one in the takes.
- **Daylight its own look (measured, V5).** Sun lowered from 48° to 30° (strength 1500 to 2200,
  2.4° across): the shadow is about twice as long and crisp, running out of frame on the
  three-stone and behind each stud (`fix2-daylight-black-acrylic.jpg`). Its blue card stays.
- **Editorial warm's backdrop (measured, V4).** The light behind the piece facing the cove is
  replaced by a long low panel 14 radii in front (2° down, 18 × 3, strength 50), linked to the
  sweep and casting no shadow from the piece; sweep albedo 0.86/0.80/0.72; room 5600 K.
  Brightest backdrop row above the top of the frame: three-stone 66 to 19, studs 94 to 26; the
  hot stripe at the horizon is gone, the top went from brown (159, 133, 107 on studs) to 206,
  180, 155 (`fix2-editorial-warm.jpg`). Variants that failed: the old light at 1.5 and 25° up
  (top darker, a line at the cove); high in front (top still brown, 72 below the floor); 5° up
  and eight radii tall (the floor so lit the piece floated). The target of 15 levels is not met.
- **Black acrylic studs (measured, V6).** A shot raised to 16° that was within 15° of face-on is
  also turned to 15°: the post now reads as a post, with its notch and mirror image. The dark
  bottom corners are not the world's nadir: raising it to 0.02 changed no pixel, and a
  reflection map of the sheet shows the black side card blocking the horizon glow there.
  Raising that card's foot to the horizon did not change them either; they stay (0–1 against 8).

## Still weak

Takes show no fire: dispersion is off at every tier (Fix-2), so stones flash white and never
colour; Cycles' RGB dispersion would need a spectral or many-wavelength renderer, or a cheaper
fire pass, to come back. Face-up stones on white sets are now bright more than contrasty.
Editorial warm's stones stay champagne on the three-stone (R − B 51), lit by 5200 K panels on a
warm sweep, and its backdrop is still 18–26 levels brighter at the floor than at the top. The
three bright looks differ by backdrop and by Daylight's long sun shadow, not by much else.
Black acrylic's bottom corners are a little darker than the sheet. Small stones are dull; a
pendant "hangs" with the ground touching its lowest point; no render has been compared with a
photograph of a real piece.

The review of `810d46e` and what it leaves open (stones' room 0.05, Editorial warm's contact
shadow, flat band medians, the seat holes) are summarised in `../../24-render-realism-measured.md`.
