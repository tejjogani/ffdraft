# Photoreal jewelry renders in Blender Cycles: exact settings and the photography practice behind them

Research date: 25 Nov 2026. Builds on `docs/research/14-jewelry-rendering.md`, `15-own-renderer.md` §6 and `03-rendering.md`; does not repeat their engine survey or ray-depth spike. Target workflow: `skillpush/.claude/skills/jewelry-render/SKILL.md` §5–6 ("the skill" below).

**Blender version.** Current release is Blender 5.3 (CG Channel's release story is dated 11 Nov 2026 [V, [CG Channel](https://www.cgchannel.com/?p=180007)]; the `bpy` 5.3.0 build on this machine is dated 10 Nov 2026 [V local]). 5.2 is the LTS (manual title "Blender 5.2 LTS Manual" [V, [manual 5.2](https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/metallic.html)]); the "dev" manual is already titled 5.4 [V, [manual dev](https://docs.blender.org/manual/en/dev/render/shader_nodes/shader/principled.html)]. Every setting below was checked against 5.3 unless a version is named.

**Evidence labels.**
- `[V]` I opened the page this session and the claim is on it (link beside it).
- `[V local]` I read it from, or measured it in, the Blender 5.3.0 Python module installed on this machine (`/home/claude/scratch/15/venv-bpy`). Scripts and outputs are in `/home/claude/scratch/23/` (not in the repository): `introspect.py`, `introspect2.py`, `dn.py`, `clamp.py` (socket names, defaults, tooltips), `cm_test.py` (view transforms), `chunks.py` (file metadata), `tiny_tests.py`, `tiny2.py` (depth of field and absorption; 16–256 px renders taking about a second).
- `[V calc]` computed here from data I downloaded and read: the refractiveindex.info database (CC0), commit `e6d15e364f70…` of 6 Nov 2026, with `reduce.py` and `alloys.py` in the same scratch folder.
- `[V repo]` taken from the earlier research files named above, where it was verified.
- `[S]` seen only in a search-result title or summary. `[E]` my estimate, derivation or working knowledge.

**How pages were reached.** The fetch tool only opens addresses returned by a search, so about 20 searches were spent mostly on surfacing primary pages. Blocked or unreadable: the Blender manual pages for Sampling, Object settings (shadow caustics, shadow catcher) and Displays and Views (robots rule), the Debian mirror of the 4.3 manual source (script wall), and iJewel3D's screen-space-bevel page (redirect needed approval). For those topics the evidence is the tooltip text compiled into Blender 5.3 `[V local]`, which is the same text the interface shows.

---

## 1. Metals in current Blender: Metallic BSDF, n and k values, alloys, finishes, edges

### Takeaway
Use the Metallic BSDF (Blender 4.3 and later): "Physical Conductor" with the fitted RGB n,k below for the pure metals that matter (rhodium, platinum, palladium, silver), and "F82 Tint" with a base colour for gold and every karat alloy, because gold's red reflectance is outside sRGB and no measured n,k exists for Au–Ag–Cu alloys. The skill's current colours are measurably off: its white metal is a neutral 86 % grey (brighter and colder than rhodium), its "18K" yellow is as saturated as 22–24K, and its rose is too pink and not yellow enough.

### Cited Findings

**The node**
- The Metallic BSDF arrived in Blender 4.3 (released 19 Nov 2024). It packages two ways to describe a metal: the F82 tint approximation already used inside the Principled BSDF, and a true conductor Fresnel that earlier needed a custom script; the conductor mode is Cycles-only — [V, [CG Channel on 4.3](https://www.cgchannel.com/2024/11/5-key-features-in-blender-4-3/)].
- Inputs and defaults in 5.3 `[V local]`: `Base Color` (0.617, 0.577, 0.540) and `Edge Tint` (0.695, 0.726, 0.770) in F82 mode; `IOR` (2.757, 2.513, 2.231) and `Extinction` (3.867, 3.404, 3.009) in conductor mode (three numbers each, one per colour channel); `Roughness` 0.5; `Anisotropy` 0; `Rotation` 0; `Normal`; `Tangent`; `Thin Film Thickness` 0 and `Thin Film IOR` 1.33. Properties: `fresnel_type` = `F82` (default) or `PHYSICAL_CONDUCTOR`; `distribution` = `MULTI_GGX` (default), `GGX`, `BECKMANN`. Switching `fresnel_type` enables one pair of sockets and disables the other.
- Manual wording: Base Color is the colour seen face-on and Edge Tint the colour near 82°; IOR is the real part n and Extinction the imaginary part k of the complex index per channel; the page does not say which wavelengths the three channels stand for; it points to physicallybased.info and refractiveindex.info for values — [V, [manual 5.2](https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/metallic.html)].
- The manual's own example values (same page) [V]:

| Metal | Base Color | Edge Tint | IOR (n) | Extinction (k) |
|---|---|---|---|---|
| Titanium (default) | 0.617, 0.576, 0.540 | 0.695, 0.726, 0.770 | 2.757, 2.512, 2.231 | 3.867, 3.404, 3.009 |
| Aluminium | 0.911, 0.912, 0.917 | 0.848, 0.877, 0.916 | 1.333, 0.945, 0.582 | 7.434, 6.340, 5.181 |
| Copper | 0.972, 0.694, 0.486 | 0.961, 0.969, 0.942 | 0.235, 0.729, 1.369 | 5.666, 2.562, 2.227 |
| Gold | 1.000, 0.735, 0.353 | 0.993, 1.000, 1.000 | 0.000, 0.470, 1.439 | 182.6, 2.189, 1.660 |

- Gold's odd red channel (n = 0, k = 182.6) is deliberate: plugged into the conductor Fresnel formula the manual's n,k give normal-incidence reflectance (1.000, 0.730, 0.339), i.e. they are fitted to a base colour whose red is pinned at 1 — [V calc].
- Anisotropy stretches the highlight along the tangent; Rotation is a fraction of a full turn (1.0 = 360°), and is offset by 90° relative to the old Glossy BSDF (add 0.25 to match it) — [V, [manual 5.2](https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/metallic.html)]. The Principled BSDF's Specular Tint plays the edge-tint role for metals (on a metallic surface it colours the edges, not the face-on reflection) — [V, [manual dev](https://docs.blender.org/manual/en/dev/render/shader_nodes/shader/principled.html)].
- Thin-film iridescence works on the Metallic and Principled BSDF since 5.0 (it was dielectric-only in 4.2) — [V, [5.0 notes](https://developer.blender.org/docs/release_notes/5.0/cycles/); [4.2 notes](https://developer.blender.org/docs/release_notes/4.2/cycles/)].
- Multiscatter GGX has been a safe default since 4.0 (the noise and speed penalty was removed) — [V, [4.0 notes](https://wiki.blender.org/release_notes/4.0/cycles/)].

**Pure metals: RGB n,k reduced from measured spectra `[V calc]`**

Source data: refractiveindex.info database, CC0, which asks for a citation of the database paper and of each original paper [V repo 14]. Reduction method:
1. Interpolate n(λ), k(λ) to 1 nm from 380 to 780 nm.
2. Compute the exact unpolarised conductor reflectance R(λ, θ) from air for 45 angles between 0° and 88°.
3. Integrate each R(λ, θ) against the CIE 1931 2° observer under D65 and convert to linear Rec.709/sRGB, normalised so a perfect mirror is (1, 1, 1). θ = 0 gives the base colour F0.
4. Edge tint = colour-integrated reflectance at cos θ = 1/7 (81.8°) divided by Schlick's value there, the definition used by the F82-tint model.
5. RGB n,k = per-channel least-squares fit of the conductor formula to the colour-integrated curve of step 3 (root-mean-square error ≤ 0.0006 except where noted).

Check of the method: for titanium (Johnson and Christy 1974) it returns n = (2.747, 2.508, 2.240), k = (3.842, 3.397, 3.014), within 1 % of Blender's built-in default — so Blender's defaults were made the same way.

| Metal, data set | Base colour F0 (linear) | Edge tint | n (R, G, B) | k (R, G, B) | CIELAB of F0 |
|---|---|---|---|---|---|
| **Rhodium**, Weaver 1977 | 0.797, 0.765, 0.742 | 0.808, 0.818, 0.837 | 2.172, 1.961, 1.725 | 5.720, 4.955, 4.401 | 90.3, 0.9, 1.9 |
| **Platinum**, Rakić 1998 (fit to older measurements) | 0.678, 0.638, 0.584 | 0.792, 0.819, 0.853 | 2.351, 2.075, 1.832 | 4.237, 3.668, 3.095 | 84.1, 0.6, 4.7 |
| **Platinum**, Tselin 2024 (80 nm film, ellipsometry) | 0.761, 0.730, 0.683 | 0.801, 0.823, 0.853 | 2.217, 1.910, 1.638 | 5.176, 4.456, 3.705 | 88.6, 0.3, 3.6 |
| **Palladium**, Johnson and Christy 1974 | 0.733, 0.697, 0.652 | 0.832, 0.852, 0.887 | 1.796, 1.622, 1.396 | 4.364, 3.811, 3.212 | 87.1, 0.6, 3.7 |
| Palladium, Palm 2018 | 0.734, 0.704, 0.662 | 0.811, 0.836, 0.872 | 2.056, 1.780, 1.500 | 4.644, 4.036, 3.393 | 87.3, 0.4, 3.3 |
| **Silver**, Johnson and Christy 1972 | 0.989, 0.984, 0.978 | 0.993, 0.995, 0.999 | 0.057, 0.055, 0.043 | 4.483, 3.546, 2.590 | 99.4, 0.1, 0.4 |
| **Copper**, Johnson and Christy 1972 | 0.932, 0.623, 0.522 | 0.982, 0.947, 0.945 | 0.221, 1.044, 1.295 | 3.352, 2.624, 2.361 | 86.1, 11.9, 13.0 |
| Copper, McPeak 2015 | 1.046, 0.687, 0.562 | 0.999, 0.963, 0.960 | (red out of gamut) 0.797, 1.113 | (—) 2.640, 2.385 | 89.6, 12.6, 14.9 |
| **Gold**, Johnson and Christy 1972 | 1.038, 0.728, 0.365 | 0.971, 1.004, 0.981 | 0.100, 0.499, 1.470 | 17.14, 2.261, 1.774 | 90.2, 5.0, 33.8 |
| Gold, Babar and Weaver 2015 | 1.059, 0.773, 0.307 | 0.971, 1.018, 0.994 | 0.010, 0.344, 1.533 | 10.46, 2.066, 1.560 | 91.7, 1.6, 41.9 |
| Gold, McPeak 2015 | 1.053, 0.784, 0.343 | 0.972, 1.004, 0.966 | 0.022, 0.382, 1.611 | 15.16, 2.272, 1.727 | 92.1, 1.5, 38.5 |
| Gold, Olmon 2012 (single crystal) | 1.037, 0.759, 0.328 | 0.969, 1.012, 0.991 | 0.143, 0.398, 1.502 | 17.36, 2.157, 1.635 | 91.1, 2.1, 38.8 |

Notes on the table `[V calc]`:
- **Gold's red is out of gamut** (1.04–1.06) in every credible data set. The fit therefore pins red reflectance at 0.9995, which makes n → 0 and k large; any pair with n ≤ 0.15 and k ≥ 10 renders the same. The four-set mean for green and blue is n = (0.41, 1.53), k = (2.19, 1.67), which matches the manual's gold row; the manual's values can be used as they are.
- **Do not sample n,k at three wavelengths.** Johnson and Christy gold sampled at 650/550/450 nm gives n = (0.156, 0.424, 1.383), k = (3.602, 2.472, 1.915) (the triple quoted in 03), which renders as F0 = (0.956, 0.792, 0.408): paler and greener than the true (1.04, 0.73, 0.37).
- **Reject the Werner 2009 sets for colour** (derived from electron energy-loss spectra): they make platinum (0.955, 0.935, 0.834) and gold (0.929, 0.860, 0.605), far from every optical measurement.
- **Platinum is uncertain by about 0.08 in reflectance** between the two usable sets (L* 84 against 89); 03's compromise (0.72, 0.68, 0.63) sits between them.
- Data-set references as printed in the database files: Johnson and Christy, Phys. Rev. B 6, 4370 (1972) and 9, 5056 (1974); Babar and Weaver, Appl. Opt. 54, 477 (2015); McPeak et al., ACS Photonics 2, 326 (2015); Rakić et al., Appl. Opt. 37, 5271 (1998); Tselin et al., Phys. Rev. B 110, 195130 (2024); Palm et al., ACS Photonics 5, 4677 (2018); Weaver, Olson and Lynch, Phys. Rev. B 15, 4115 (1977), numbers via Palik's handbook — [V calc, file headers; repository: [refractiveindex.info database](https://github.com/polyanskiy/refractiveindex.info-database)].

**Alloys**
- The database does hold alloy data that file 14 could not open: an **Au–Ag series** (Rioux et al. 2014, an analytic model fitted to ellipsometry of five thin-film compositions, tabulated every 10 %) and three brasses (Cu–Zn). There is **no Au–Cu and no Au–Ag–Cu entry**, so 18K and 14K yellow and rose remain unmeasured there — [V calc, directory listing of `database/data/other/alloys`].
- Au–Ag colours from that series `[V calc]`: Au 100 % (1.056, 0.779, 0.335); Au 80 (0.965, 0.849, 0.424); Au 70 (0.943, 0.869, 0.482); Au 60 (0.932, 0.884, 0.548), CIELAB (94.7, −5.4, 23.0), which is the pale greenish yellow of "green gold"; Au 50 (0.930, 0.897, 0.623). Fitted n,k for Au 60: n = (0.313, 0.327, 0.763), k = (4.084, 3.078, 1.910).
- **How good is the usual shortcut?** Mixing the dielectric functions of the pure metals by atomic fraction (ε = Σ xᵢ εᵢ) and comparing with the Rioux alloy data at 30, 50 and 70 % gold gives colour errors of ΔE*ab = 4.9–5.9; the shortcut is always too saturated and too red — [V calc]. File 14 already records that such models miss white alloys by a factor of two [V repo 14].
- A published measurement on hot-pressed high-gold alloys gives a* 4.4–5.5, b* 17–19 for a yellow alloy with 10 wt% Cu, a* 6.5–7.2 for a red alloy with 20 wt% Cu, a* 0.5–2.4, b* 21–23 for a copper-free green gold, and a* 2.3–2.7, b* 10–12 for a nickel white gold; its L* values (55–59) are depressed by a 7 mm² aperture, as the authors note — [V, [Henriques et al., Gold Bulletin 2013](https://link.springer.com/article/10.1007/s13404-013-0089-6)].
- Coloured-gold metallurgy: palladium turns gold white once it reaches about 15 wt%; the common white systems are Au–Cu–Ni–Zn and Au–Pd–Ag; zinc up to 15 wt% pulls copper-rich alloys back toward yellow — [V, [Cretu and van der Lingen via Ganoksin](https://www.ganoksin.com/article/different-coloured-gold-alloys/)] (its composition tables and CIELAB figure are images and could not be read).

**Karat alloy estimates `[V calc]`, low-to-medium confidence.** Two estimates per alloy: (a) atomic-fraction mixing of Johnson and Christy Au, Ag, Cu; (b) the Rioux Au–Ag pair at the alloy's Au:Ag ratio, then mixed with copper. The table gives the range and a value to enter (F82 Tint mode). Expect ΔE of about 5 against a real swatch.

| Alloy (wt ‰ Au/Ag/Cu) | F0 range (a)–(b) | Enter as Base Color | Edge Tint | CIELAB, (a) / (b) |
|---|---|---|---|---|
| 24K fine gold | — | 1.00, 0.76, 0.34 | 0.97, 1.00, 0.98 | 90–92, 2–5, 34–42 (data sets) |
| 22K yellow (917/50/33) | 1.02–1.00, 0.75–0.79, 0.41–0.39 | 1.00, 0.77, 0.40 | 0.97, 0.99, 0.99 | 91.1, 3.7, 30.4 / 92.0, 0.0, 33.8 |
| 18K pale yellow "2N" (750/160/90) | 1.01–0.96, 0.79–0.81, 0.50–0.48 | 0.98, 0.80, 0.49 | 0.97, 0.98, 1.00 | 92.4, 2.3, 24.4 / 92.3, −1.1, 25.8 |
| **18K yellow "3N" (750/125/125)** | 1.00–0.97, 0.76–0.78, 0.48–0.46 | **0.98, 0.77, 0.47** | 0.97, 0.98, 0.99 | 91.3, 4.0, 24.2 / 91.5, 0.9, 25.8 |
| 18K rose "4N" (750/90/160) | 1.00–0.97, 0.73–0.75, 0.47–0.46 | 0.98, 0.74, 0.46 | 0.97, 0.98, 0.98 | 90.3, 5.7, 23.7 / 90.6, 2.8, 25.5 |
| **18K red "5N" (750/45/205)** | 0.99, 0.69–0.72, 0.46–0.45 | **0.99, 0.70, 0.45** | 0.97, 0.98, 0.97 | 89.0, 7.7, 22.8 / 89.6, 5.6, 24.8 |
| **14K yellow (585/205/210)** | 1.00–0.95, 0.77, 0.53–0.52 | **0.97, 0.77, 0.52** | 0.97, 0.97, 0.99 | 91.7, 4.3, 20.2 / 91.3, 2.0, 20.9 |
| 14K yellow, silver-rich (585/265/150) | 1.00–0.95, 0.81, 0.56–0.54 | 0.97, 0.81, 0.55 | 0.97, 0.97, 1.00 | 93.2, 2.2, 19.8 / 92.5, 0.1, 20.3 |
| **14K rose (585/90/325)** | 0.98–0.96, 0.69–0.71, 0.50–0.49 | **0.97, 0.70, 0.49** | 0.98, 0.97, 0.97 | 89.0, 8.0, 19.5 / 89.2, 6.1, 20.6 |
| Sterling silver (925 Ag/75 Cu) | 0.99, 0.955, 0.907 (a only) | 0.97, 0.95, 0.91 | 0.99, 0.99, 1.00 | 98.4, 0.3, 3.2 |
| 18K palladium white, unplated (750 Au/150 Pd/100 Ag) | 0.893, 0.738, 0.522 (a only) | not trustworthy | — | 89.6, 1.8, 18.1 (too yellow) |
| 18K nickel white, unplated | 0.844, 0.634, 0.476 (a only) | not trustworthy | — | 85.4, 6.0, 16.0 (too yellow) |

The alloy names "2N…5N" and the compositions in the left column are the usual trade recipes as I know them `[E]`; I could not open a page that states them.

**The skill's current Principled values, measured against the above `[V calc]`**

| Skill material | Skill base (linear) | Its CIELAB | Compare | Finding |
|---|---|---|---|---|
| White gold / platinum (rhodium) | 0.86, 0.86, 0.86 | 94.3, 0, 0 | rhodium 90.3, 0.9, 1.9; platinum 84–89, 0.3–0.6, 3.6–4.7 | 4 L* units brighter than rhodium, 5–10 brighter than platinum, and perfectly neutral where real white metals are faintly warm. Reads as chrome. |
| Yellow gold 14K | 1.0, 0.78, 0.45 | 91.8, 1.9, 27.6 | 14K estimate b* ≈ 20–21; 18K ≈ 24–26 | Saturation of an 18K alloy. |
| Yellow gold 18K | 1.0, 0.76, 0.38 | 90.9, 1.6, 33.1 | 18K estimate b* ≈ 24–26; 22K ≈ 30–34; fine gold 34–42 | Saturation of 22–24K. |
| Rose gold | 0.98, 0.68, 0.58 | 88.8, 10.9, 12.1 | estimates a* 6–8, b* 20–25; measured red gold a* 6.5–7.2 [V Henriques] | Too pink (a* 11) and far too little yellow (b* 12): reads salmon-copper, not rose gold. |

Also: with Principled `metallic = 1` and Specular Tint left white, reflectance near 82° is the Schlick value; rhodium, platinum and palladium have edge tints of 0.79–0.85, so the Principled version is about 20 % too bright at that angle `[V calc]`.

**Edges**
- A jewelry render studio's CAD-preparation guide: round the major edges by about 0.2 mm unless the design says otherwise, and round the other visible edges too, especially around micro-set and claw-set stones — [V, [Lionsorbet](https://lionsorbet.squarespace.com/education/9-ways-to-prepare-3d-cad-models-for-jewellery-rendering)].
- Rhino jewelry rendering advice says the same without a number: a very small fillet on band edges, bezel transitions, prong bases and engraved borders so they catch light — [V, [Novedge](https://novedge.com/blogs/design-news/rhino-3d-tip-rhino-jewelry-rendering-tips-for-polished-presentations)].
- Blender tools `[V local]`: Bevel modifier (`width` 0.1 default, `segments` 1 default, `limit_method` `ANGLE` with 30° default, `harden_normals`, `profile` 0.5 = round); Bevel shader node (`Radius` default 0.05, in scene units, feeds a Normal input and changes shading only).

**Finish and imperfection**
- A widely used product-rendering checklist: no real material is perfectly smooth; vary roughness to carry scratches, smudges and residue; use dust and fibres sparingly; fillets and bevels must be correctly sized because they catch the light and define the form — [V, [Will Gibbons](https://www.willgibbons.com/realistic-rendering/)].
- Retouching guides warn from the other side: smoothing that removes surface texture makes a piece look like a computer image — [V, [Retouch4me guide](https://retouch4.me/blog/how-to-photograph-jewelry-complete-jewelry-photography-guide-2026)]; scratches should be softened, not erased completely — [V, [Color Clipping](https://www.colorclipping.com/blog/11-jewelry-retouching-techniques-create-visual-perfection)].

### Inferences
- **Recipe, white metals** `[E from the table]`: Metallic BSDF, Physical Conductor. Rhodium-plated white gold: n = (2.172, 1.961, 1.725), k = (5.720, 4.955, 4.401). Platinum 950: n = (2.28, 1.99, 1.74), k = (4.71, 4.06, 3.40) (mean of the two sets; F0 ≈ 0.72, 0.68, 0.63). Palladium 950: n = (1.796, 1.622, 1.396), k = (4.364, 3.811, 3.212). Fine silver: n = (0.057, 0.055, 0.043), k = (4.483, 3.546, 2.590).
- **Recipe, gold and alloys** `[E]`: Metallic BSDF, F82 Tint, base colour and edge tint from the alloy table. Reason: red above 1 cannot be expressed with honest n,k, and alloy n,k would be a fit to an estimate. If a Principled BSDF must be kept, copy the same base colour and put the edge tint in Specular Tint.
- **Rhodium plating** `[E]`: light penetrates a metal only tens of nanometres (1/e intensity depth λ/4πk ≈ 9 nm for k ≈ 5 at 550 nm), and decorative rhodium plate is a few tenths of a micron, so plated white gold is optically pure rhodium: use the rhodium row whatever the karat underneath. Unplated white gold is visibly greyer and yellower than rhodium; there is no dependable number for it (see Gaps). Platinum is not rhodium: it is darker and slightly warmer, so the skill should stop sharing one material between them.
- **Roughness** `[E]`: Cycles squares the roughness value to get the microfacet width, so 0.07–0.08 (the skill) gives a width of about 0.005–0.006, a reflection blur of roughly half a degree. That is acceptable for hand-polished metal but uniform. Suggested: polished 0.03–0.05 with a low-contrast noise map adding ±0.01–0.02; satin 0.25–0.30; brushed 0.30–0.35 with Anisotropy 0.7–0.8; sandblasted 0.5–0.6 plus fine bump (grain 0.02–0.05 mm) — the 03 values, unchanged, which have no measured source.
- **Brushed direction** `[E]`: the highlight stretches along the Tangent, which defaults to a direction derived from the mesh. For a ring brushed around the finger, feed a Tangent node (Radial, axis = the ring axis) so the scratches run around the band; for a flat brushed plate use a UV tangent. Remember the 0.25 rotation offset noted in the manual.
- **Micro-scratches** `[E]`: polished jewelry shows faint, randomly oriented hairlines that appear only inside highlights. A scratch normal map at very low strength (0.02–0.05) tiled at 2–4 mm, or a roughness map with thin brighter lines (+0.03–0.05), gives that without visible pattern. Keep it below the threshold where it reads as "worn" at catalogue size; it matters for 4K hero crops, not for 1600 px catalogue shots.
- **Edge radius** `[E, anchored on the 0.2 mm figure]`: cast and polished jewelry has edges of roughly 0.05–0.3 mm radius: about 0.2 mm on shank and bezel edges, 0.05–0.1 mm on prong tips, gallery rails and engraved borders, nothing below about 0.03 mm. In Blender at 1 unit = 1 mm: Bevel modifier, width 0.05–0.2, 2–3 segments, angle limit 30°, harden normals on. Never bevel a gem mesh. The skill says "add a bevel modifier" for built CAD but imported `.3dm` meshes get none; the Bevel shader node (radius 0.05–0.1) is the fallback when the imported mesh is too dense or broken to bevel.
- **Why white gold must not be neutral grey** `[E]`: retouchers are told to keep silver "neutral" [V Retouch4me], but neutral in a photograph means no colour cast from the light; the metal itself still has b* of 2–5. A base colour with equal channels plus a perfectly neutral environment gives the tell-tale CGI chrome.

### Gaps
- No measured n,k or spectrophotometer colour for 18K/14K yellow, rose, or unplated white gold was opened. The Cretu and van der Lingen paper has the CIELAB figure but as an image. The estimates above carry ΔE ≈ 5 of model error and unknown error from copper.
- The manual does not document how its Edge Tint examples were derived; they are lower than the single-angle ratio computed here (titanium 0.70 against 0.77). The difference only affects reflectance beyond about 75° incidence.
- The Rioux alloy files say "70 % Au, 30 % Ag" without stating atomic or weight fraction; I treated it as atomic `[E]`.
- Typical rhodium plate thickness and typical edge radii after casting and polishing are trade knowledge here, not sourced.
- No source gives measured roughness (GGX) for polished, satin or brushed precious metal.

---

## 2. Gems in current Blender: dispersion, absorption, geometry, ray depth, caustics, clamping

### Takeaway
Dispersion is native since 5.3 on the Principled BSDF only: enter the stone's real Abbe number and leave Scale at 1. Set Base Color to pure white and colour stones with Volume Absorption (the law is exp(−density × (1 − colour) × distance), per scene unit). Keep glossy = transmission = total bounces, turn the indirect clamp off (or far above the brightest light) and filter glossy to 0 for stone close-ups; each internal reflection is a glossy bounce and everything seen inside a stone is "indirect light" to the clamp.

### Cited Findings

**Dispersion**
- Blender 5.3 added dispersion to the Transmission part of the Principled BSDF, and roughness anisotropy to transmission in both Principled and Glass — [V, [CG Channel](https://www.cgchannel.com/?p=180007)].
- Sockets in 5.3 `[V local]`: `Transmission Dispersion Scale` (default 0, interface range 0–1) and `Transmission Dispersion Abbe Number` (default 20). The **Glass BSDF has no dispersion socket** (inputs: Color, Roughness, Anisotropy, Rotation, IOR, Normal, Tangent, Thin Film Thickness, Thin Film IOR); neither has the Refraction BSDF. The Python API does not clamp either dispersion value (1.5 and 3.0 are stored as typed).
- Manual: Scale linearly scales the effect; the amount is roughly proportional to Scale divided by Abbe Number; both are Cycles-only; it "works via randomly sampling from visible wavelengths", so colour noise needs more samples and a higher Indirect Light clamp — [V, [manual dev](https://docs.blender.org/manual/en/dev/render/shader_nodes/shader/principled.html)].
- Users found the sliders limited to Scale ≤ 1 and Abbe 9–91, with typed values allowed beyond; the built-in effect was faster and less noisy than node-group fakes — [V, [Blender Artists](https://blenderartists.org/t/the-new-5-3-dispersion-settings-experimenting/1652059.md)].
- The implementation is described as following the OpenPBR standard — [V, [80.lv](https://80.lv/articles/understanding-native-dispersion-in-blender-5-3)]; OpenPBR and glTF both encode dispersion as 20 / Abbe [V repo 14].

**Gem constants**
- Trade dispersion is the index difference between the G line (430.8 nm) and the B line (686.7 nm) — [V, [24carat](https://24carat.co.uk/dispersion.html)].

| Stone | Refractive index | Trade dispersion (B–G) | Source |
|---|---|---|---|
| Diamond | 2.417 | 0.044 | [V, [International Gem Society](https://gemsociety.org/article/diamond-and-simulant-comparison-chart)] |
| Moissanite | 2.648–2.691 (birefringence 0.043) | 0.104 | [V, same] |
| Cubic zirconia | 2.15–2.18 | 0.058–0.066 | [V, same] |
| White sapphire (corundum) | 1.757–1.779 | 0.018 | [V, same] |
| White topaz | 1.609–1.637 | 0.014 | [V, same] |
| Synthetic spinel | 1.720–1.740 | 0.020 | [V, same] |
| Emerald (beryl) | 1.577–1.590 [V repo 03] | 0.014 | [V, [24carat](https://24carat.co.uk/dispersion.html)] |
| Tourmaline / peridot / zircon | — | 0.017 / 0.020 / 0.038 | [V, same] |
| Demantoid / almandine / pyrope garnet | — | 0.057 / 0.027 / 0.022 | [V, same] |

**Absorption `[V local]`**
- Volume Absorption node: `Color` default (0.8, 0.8, 0.8), `Density` default 1.0.
- Measured on a 10-unit slab with index 1.0, colour (0.5, 0.8, 0.2), density 0.1: the channel ratios of transmitted light match exp(−density × (1 − colour) × thickness) to three decimals. Distance is in Blender units, so with 1 unit = 1 mm the density is "per millimetre".
- Same test: the Principled **Base Color multiplies light once per pass through the stone** (in and out), independent of thickness: base 0.8 (the node default) passed 80 %, base 0.25 passed 25 %. A colourless stone left at the default base colour loses 20 % of everything it returns.
- Mean path length inside a brilliant is about 2.2 girdle diameters at diamond's index and 1.3 at sapphire's — [V repo 14, spike].

**Ray depth**
- Cycles source (older file, same logic as current): after a surface bounce, a reflection labelled diffuse increments the diffuse counter, any other reflection (glossy or perfectly sharp) increments the glossy counter, and only transmissions increment the transmission counter; a path ends when any counter reaches its maximum (comparison is "≥") or the total reaches Max Bounces — [V, [archived `kernel_path_state.h`](https://projects.blender.org/archive/blender-archive/raw/commit/351f10cd79f7651ea02c1663bb32c048ecb87a77/intern/cycles/kernel/kernel_path_state.h)]; file 14 read the same in the current `path_state.h` [V repo 14].
- Defaults in 5.3 `[V local]`: total 12, diffuse 4, glossy 4, transmission 12, transparent 8, volume 0. Per the tooltips, each of the typed limits is also capped by the total.
- What the default costs: 25 % of the light entering a diamond is still inside after 4 internal hits, 10 % after 8, 4 % after 16, 2 % after 32 — [V repo 14, spike].

**Caustics, filter glossy, clamping `[V local]` unless linked**
- `caustics_reflective`, `caustics_refractive`: default on; tooltips: a brighter image with more noise and more realism.
- `blur_glossy` (Filter Glossy): default 1.0, range 0–10; tooltip: adaptively blurs glossy shaders, but only after a blurry bounce has already happened, to cut noise at the cost of accuracy, and tells the user to lower it when rendering caustics. The manual adds that it can lose lighting detail — [V, [manual, Light Paths](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/light_paths.html)].
- `sample_clamp_indirect`: default 10; `sample_clamp_direct`: default 0 (off). Tooltip: any sample above the value is scaled down, trading accuracy for less noise. Manual: clamping lowers accuracy and can dim intentionally bright things such as lights and reflections; lower values dim more; indirect is separated because bounced light causes more fireflies — [V, [manual, Light Paths](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/light_paths.html)].
- Shadow caustics: three switches must all be set: on the light (`light.cycles.is_caustics_light`; the world has one too), on the caster (`object.cycles.is_caustics_caster`, tooltip: up to 10 bounces inside the object are taken into account) and on the receiver (`is_caustics_receiver`). The tooltips describe the result as an approximation of caustics inside the shadows of refractive objects. It needs smooth-shaded casters and is not a general caustics solver, so flat-faceted gems are outside its design — [V repo 03, from Blender issues #97784 and #96991, not reopened]. Unsupported on AMD GPUs under Metal — [V, [4.0 notes](https://wiki.blender.org/release_notes/4.0/cycles/)].
- Path guiding: `use_guiding` default off; training samples 128; `guiding_roughness_threshold` 0.05 (surfaces smoother than this are not guided). Since 4.0 it guides glossy as well as diffuse bounces — [V, [4.0 notes](https://wiki.blender.org/release_notes/4.0/cycles/)]. CPU-only per the manual [V repo 14]; it doubled render time for no visible gain on a ring [V repo 03].
- `film_transparent_glass` (default off): renders transmissive surfaces as transparent for compositing; `film_transparent_roughness` 0.1.

**Geometry**
- Render-studio preparation rules: lift centre stones slightly off the collet so a small gap lets light in; let claws touch but let nothing pass through the stone below the girdle (it renders as black spots); shorten claws a little and round their tops, the part most on view — [V, [Lionsorbet](https://lionsorbet.squarespace.com/education/9-ways-to-prepare-3d-cad-models-for-jewellery-rendering)].
- KeyShot solves the same overlap with an "ignore intersecting geometry" switch on its gem material [V repo 14]; Blender has no such switch `[V local: none on the Principled or Glass node]`.

### Inferences
- **Dispersion values to enter** `[E, from the cited B–G figures]`. For a two-term Cauchy curve the Abbe number is V = (n − 1) / (0.584 × B–G) (0.584 is the ratio of the F–C to the G–B interval in 1/λ²). Enter V in the Abbe socket with Scale = 1:

| Stone | IOR | Abbe number | Same thing as Scale at Abbe 20 |
|---|---|---|---|
| Diamond | 2.417 | 55 | 0.36 |
| Moissanite | 2.67 (mean) | 25–27 | 0.75–0.80 |
| Cubic zirconia | 2.16 | 30–34 | 0.60–0.66 |
| Sapphire, ruby | 1.765 | 72–73 | 0.27–0.28 |
| Emerald, aquamarine | 1.58 | 71 | 0.28 |
| Spinel | 1.72 | 62 | 0.32 |
| Topaz | 1.62 | 76 | 0.26 |
| Demantoid garnet | 1.88 | 26 | 0.76 |

- **The skill's dispersion numbers** `[E]`: its "Dispersion 0.36" for diamond is correct only if it is written to the Scale socket with Abbe left at 20. On the same reading its emerald (0.03) and sapphire (0.05) are six to nine times too weak (they should be about 0.28); the visual loss is small because those stones barely disperse, but the numbers are wrong. Writing the real Abbe number with Scale 1 removes the ambiguity. Raising Scale above 1 or lowering Abbe below the real value is the "more fire" knob and is a stylistic lie; for moissanite and CZ the true values already give visibly more fire than diamond.
- **Colourless stones** `[E from the local test]`: Base Color (1, 1, 1), Transmission Weight 1, Roughness 0, IOR as above, no volume node. The skill's table does not state a base colour for diamond; if the scripts leave the Principled default (0.8), every diamond is 20 % too dark, which reads as grey.
- **Coloured stones** `[E from the local test and the spike]`: keep Base Color white and attach Volume Absorption. For a target face-up body colour T (linear RGB, each channel 0–1) on a stone of girdle diameter D mm: σ = −ln(T) / (k × D) per channel with k = 2.2 for diamond-index and 1.3 for corundum- or beryl-index brilliants; then Density = max(σ) and Color = 1 − σ / Density. In a scene at 1 unit = 1 mm these are the numbers to type; at 1 unit = 1 m multiply Density by 1000. Example: the skill's green diamond (colour 0.03, 0.80, 0.30, density 0.45) on a 6.35 mm stone gives σ × path = (6.1, 1.3, 4.4), i.e. transmitted colour (0.002, 0.28, 0.012): a very dark, fully saturated green. If that looked right in approved renders, keep it; otherwise it is about three times too dense for a "fancy green". A fixed density makes melee paler and big stones darker (physically true); for catalogue consistency scale Density by 1/D.
- **Transmission colour versus volume** `[E]`: tinting Base Color ignores path length, so thick and thin parts of the stone get the same tint and the dark "extinction" zones of a real coloured stone never deepen. Use it only for melee under about 1.5 mm, where the difference is invisible and the volume costs nothing anyway.
- **Flat shading and exact geometry** `[E]`: a facet is a plane mirror and window. Smooth shading interpolates normals across the facet, bends refraction continuously and replaces crisp reflections with a lens-like smear, so gems need flat shading, no auto-smooth, no bevel and no subdivision; faces of one facet must be coplanar (n-gons or coplanar triangles). Facet junctions on a well-cut stone are sharp at the micron level, so the "every edge has a radius" rule applies to metal only.
- **Girdle and culet** `[E]`: model a real girdle (about 2.5–4.5 % of diameter, faceted or polished on modern stones; a bruted girdle is a frosted band: a second material slot with roughness 0.4–0.6) and a pointed or very small culet. A knife-edge girdle and a missing girdle band both change where light leaks.
- **Inclusions** `[E]`: none for diamonds and for sapphire or ruby at catalogue quality; eye-clean is what product photography shows. Emerald is the exception: a perfectly clean emerald reads as glass, so a hero close-up can take a sparse, low-density "jardin"; leave it out of catalogue shots.
- **Stone against metal** `[E]`: coincident or overlapping stone and metal faces produce black or missing facets because the ray's inside/outside bookkeeping breaks. Without a KeyShot-style switch the fix is geometric: an air gap of 0.01–0.03 mm between stone and seat, prongs that touch but do not enter the stone, nothing through the pavilion.
- **Bounces** `[E from the cited facts]`: draft: total 16, glossy 16, transmission 16, diffuse 2. Final: total 32, glossy 32, transmission 32, diffuse 4, transparent 8. The skill's "max 32, transmission 32, glossy 16" cuts every stone chain at 16 internal reflections; the cost of raising glossy to 32 is small because few paths live that long. Moissanite and CZ need the same; sapphire and emerald would be fine at 8.
- **Caustic switches** `[E, standard Cycles behaviour]`: a path counts as a caustic only when a sharp bounce follows a diffuse or blurry one. The stone seen directly by the camera is not a caustic and is unaffected by the switches. What "caustics off" (the skill's setting) removes is light that left a stone or a polished surface and landed on something matte: the bright spots inside a diamond's shadow on the ground, and stone light on satin or sandblasted metal. Result: a solid dark blob under each stone, one of the fake tells in §7. Turn both switches on for finals; keep them off only for drafts and animation.
- **Filter glossy** `[E from the tooltip]`: it only acts after a blurry bounce, so it does not touch a camera ray that goes straight into a stone, but it softens everything a matte or satin surface "sees": ground caustics and the reflection of stones in satin metal. 0.2 (the skill) is mild; 0 for finals with caustics on, 0.5–1.0 for drafts. No source quantifies the loss.
- **Indirect clamp** `[E from the tooltip and manual]`: every flash inside a stone is the image of a light reached after at least one bounce, so it is "indirect" and is scaled down to the clamp value. With sparkle lights of emission strength 200–2000 and a clamp of 20 (the skill) or 10 (default), the brightest flashes are cut by one to two orders of magnitude before tone mapping; they still reach white on screen, but glare, bloom and star filters in post then have nothing to work with, and coloured single-wavelength samples are dimmed relative to white ones, which pales fire. Set `sample_clamp_indirect = 0` for stills and pay with samples; if fireflies on metal are unacceptable, set it to at least the radiance of the brightest light, not below. No documented figure says how much fire a given clamp removes.
- **Shadow caustics and path guiding** `[E from the cited facts]`: neither helps a faceted stone today. Use plain path-traced caustics with a large enough sample count, and accept that the spots under a stone lit by a 2–5 mm source will be noisy; a slightly larger sparkle source (10–20 mm) converges far faster for the ground pattern.

### Gaps
- The manual pages for shadow caustics and path guiding could not be opened this session; the smooth-caster limitation and "CPU only" rest on the earlier files.
- No documentation states whether the kernel clamps Dispersion Scale above 1, or the numeric relation between Scale, Abbe and the wavelength-dependent index beyond saying the amount follows their ratio approximately.
- How much filter glossy and clamping dull fire is not documented anywhere I could open; the companion measured tests should supply the numbers.
- Moissanite's double refraction cannot be rendered in Cycles (use the mean index) [V repo 03].
- An unexplained uniform factor of 15/16 appeared in the 16-sample absorption test; it does not affect the channel ratios and I did not chase it.

---

## 3. Light and environment the way jewelry photographers do it, translated to Blender

### Takeaway
Professionals light metal and stones as two different subjects in one frame: large diffused sources and gradients for metal, small hard sources for stones, and black cards to put contrast back; an all-white tent is the standard beginner's mistake because it leaves the stone nothing dark to reflect and nothing small to disperse. In Blender build the same rig from emissive meshes at real millimetre sizes and separate the two families with ray-visibility flags or light linking (Cycles, since 4.0).

### Cited Findings

**What photographers and gemologists say**
- GIA's photography manager: diffused light shows a gem's body colour and gives polished metal soft tonal gradients; direct light provokes dispersion in transparent gems; combining both adds sparkle while keeping colour; use one colour temperature only — [V, [GIA, Weldon and Conrad 2015](https://gia.edu/gem-photography)]. A light box or cloth tent softens shadows and evens the light — [V, [GIA 2014](https://gia.edu/gia-news-research-six-tips-best-gem-photos)].
- Diamond trade press: light from at least two sides through diffusion, add a direct pinpoint source for sparkle and fire, and do not tent the diamond in white reflective material because that makes it flat — [V, [Rapaport](https://rapaport.com/?p=40092)].
- A diamond photographer's vocabulary: softboxes are "clouds" (dull, white, little fire), bare strobes are "suns" (fire). Start with two softboxes either side of the camera, add bare lights and move them per stone; "Too much 'fire' obscures the shape" and too much diffusion kills the stone; black acrylic as base — [V, [Vadim Chiline](https://vadim-chiline.squarespace.com/blog/2011/01/photographing-a-diamond-on-black)].
- Bench jewelers' forum: tents and domes control glare on metal but "kill the life in stones"; add focusable pin lights, fibre optics or an LED penlight alongside the diffuse light, not instead of it; black paper flags on thin rods absorb stray light and their placement is critical; mismatched colour temperature between main and accent lights gives local colour shifts; one worker shoots a diffuse frame and a spotlit-stones frame and blends them — [V, [Ganoksin Orchid](https://orchid.ganoksin.com/t/photographing-faceted-gems/45256)].
- Why white-only fails, from a photo retailer's Q&A (human answer): white cards alone make silver look flat like tin; put black cards off-frame at the sides or hung above so dark reflections appear in metal and facets — [V, [Unique Photo Q&A](https://www.uniquephoto.com/community/qa/how-do-i-get-a-pure-white-background-for-jewelry-photos-without-losing-shine-and-sparkle)].
- A studio educator's ring setup used four lights: a key, a sparkle light on the diamond's face, one for the metalwork of the bands and one for the band's small diamonds. His necklace setups: a bare bulb through a white acrylic sheet (further from the sheet gives a smoother gradient), white panels in front and above for wraparound, and a small projection spot for sparkle; rings were shot inside a light cone — [V, [Karl Taylor](https://visualeducation.com/jewellery-photography-top-tips-for-how-to-photograph-jewellery/)].
- A product-photography textbook: very small sources (snoots with honeycomb grids, small directional LEDs); a narrow hard source at right angles to each stone, several of them arranged like a corolla for stones at different angles; a large diffuse source about half the ring's diameter for the inside of the band; a dark studio so nothing stray reflects in the metal; a white card overhead fixes a dark reflection on top of a ring; an over-strong backlight leaves small diamonds dark; for catalogue, white background, square crop, very even light with diffusers close, the ring balanced on a small acrylic wedge placed far back — [V, [Nath-Sakura, Rocky Nook](https://rockynook.com/article/product-photography-lighting-for-fashion-accessories/)].
- A catalogue jewelry photographer: no tents, a custom set per kind of piece; swap one white bounce card for a silver one for punch; a gridded front light adds sparkle; keep the piece far from a lit white background (he suggests about 10 feet) or the background wraps around the edges — [V, [Fstoppers, article and replies](https://fstoppers.com/commercial/how-photograph-jewelry-catalogs-35913)].
- A strip-light example: one narrow softbox directly above so no light hits the backdrop, a separately lit backdrop, a mirror base; dust on the mirror glows like a star — [V, [Photigy](https://www.photigy.com/school/?p=60945)].
- Tent practice from a camera maker: an 18 × 18 × 27.5 inch tent, one or two small flashes, top light plus side light for shape; opening a side and firing the flash directly gives hard shadows and sharper highlights for sparkle; a flash at the back gives glow and a reflection on a white acrylic base — [V, [Nikon](https://nikonusa.com/learn-and-explore/c/tips-and-techniques/bright-ideas-tips-and-techniques-for-photographing-jewelry)].
- GIA's light-performance map (ASET) codes the directions a diamond draws light from: red for the brightest light from above, green for less bright indirect light, blue for "a contrast pattern of dark reflections" — [V, [GIA](https://www.gia.edu/gia-faq-other-services-what-is-the-aset-map)].
- The spike in file 15 showed the consequence in Cycles: a studio that is bright all round gave believable facets but no arrow pattern, because nothing dark sat above the table — [V repo 15 §6.4].

**Blender facts**
- Light and shadow linking: added to Cycles in 4.0 (a light affects only chosen objects; shadow linking chooses which objects block it); the release examples include per-part control of car reflections — [V, [4.0 notes](https://wiki.blender.org/release_notes/4.0/cycles/)]. EEVEE got it in 4.3 — [V, [CG Channel](https://www.cgchannel.com/2024/11/5-key-features-in-blender-4-3/)].
- How to set it up: select the light or the emissive mesh, create a light-linking (receiver) or shadow-linking (blocker) collection in its Shading panel and drag objects in; include-only, exclude-only and both are supported; emissive-mesh linking is Cycles-only; it samples best with the light tree on; shadow linking costs extra rays — [V, [manual 4.3](https://docs.blender.org/manual/en/4.3/render/lights/light_linking.html)]. Properties in 5.3: `object.light_linking.receiver_collection`, `.blocker_collection` `[V local]`.
- Ray-visibility flags on every object `[V local]`: `visible_camera`, `visible_diffuse`, `visible_glossy`, `visible_transmission`, `visible_volume_scatter`, `visible_shadow`. The world has the same set (`world.cycles_visibility`).
- Lights `[V local]`: area light shapes square, rectangle, disk, ellipse; `size` default 0.25 (scene units); `spread` (π = full hemisphere; lower values act like a grid on a softbox); power in watts; `normalize` (default on: total output stays the same whatever the size); per-light `specular_factor`, `diffuse_factor`, `transmission_factor`; `use_temperature` with Kelvin; point light radius `shadow_soft_size`. Material setting `emission_sampling` (Auto/Front/Back/None) controls whether an emissive mesh is sampled as a light. `use_light_tree` default on.
- HDRIs: Poly Haven's are CC0 and may be bundled in a sold product; download by hand or through its API, not by scraping — [V repo 14].

### Inferences
- **The physical reason, in one paragraph** `[E]`: a brilliant returns light from above the crown. Light from a high ring of directions (roughly 45–75° above the horizon) makes it bright; the zone right around the viewing axis is normally blocked by the camera or the observer's head, and the facets that look there go dark, which is the contrast pattern (arrows in a round); light from near the horizon mostly leaks. A white tent fills all three zones evenly: no dark facets, so no contrast, and no small source, so each colour of the spectrum from one direction is overlaid by the other colours from neighbouring directions and the stone goes milky white. The angle bands are AGS's ASET convention as I know it; the GIA page opened gives the meaning of the colours but not the angles.
- **Fire needs small sources** `[E]`: a flash is coloured only when the source is small compared with the angular spread of the spectrum on exit (a few degrees for diamond). Sources under about 1–2° (a 5 mm emitter at 300–600 mm is 0.5–1°) give distinct coloured flashes; a 300 mm softbox at the same distance subtends 30–50° and gives white brilliance only. Scintillation (on/off sparkle as things move) needs several such small sources spread around the upper hemisphere.
- **Shot recipes, real practice restated** `[E synthesis of the sources above]`:

| Piece | Camera | Metal light | Stone light | Cards |
|---|---|---|---|---|
| Solitaire or halo ring, standing | three-quarter, 20–35° above horizontal; also top-down and side profile | large top-back softbox for a gradient over the shank, one or two side strips | 2–4 small hard sources high and to the sides; one near the camera axis for table reflections | black card above-front near the lens axis for facet contrast; black strips left and right just out of frame to edge the shank; white card low front as fill |
| Stud earrings (pair) | one straight-on to the table, one turned to show profile and post | small top softbox | 3 hard sources; a dark disc around the lens | black card ring around the lens |
| Pendant on chain | straight-on, laid flat or hung | strip from each side, top softbox | hard sources 30–45° off axis | black flags to edge the bail and chain |
| Bracelet, bangle | flat oval or three-quarter loop | long strip boxes parallel to the piece for one unbroken highlight | hard sources along the length | long black cards parallel to the strips |
| Tennis line, eternity band | lying flat, camera high (60–80°) so the tables face the lens | top softbox | a row or "corolla" of 5–8 small sources so each stone gets a flash; move them until no stone is dead | black card over the lens zone, without it the row reads as white dots |

- **Blender rig at 1 unit = 1 mm** `[E]` (all emissive meshes, as the skill already does, because mesh emission is scale-independent while lamp watts assume metres):

| Element | Size and place (mm) | Emission strength (start) | Visibility |
|---|---|---|---|
| Top softbox | 300 × 300 plane, 250–350 above, tilted 10–20° toward the back | 5–10 | camera off; glossy, transmission, diffuse on |
| Side strips (2–4) | 60–100 × 500–700, 250–350 from the piece, vertical or leaning in | 5–15 | camera off |
| Gradient card | a strip with a ramp texture on emission (bright centre, dark ends) | peak 10–20 | camera off; link to metal only |
| Sparkle sources (3–8) | discs 3–10 across, 300–600 away, elevation 40–75°, irregular azimuth | 300–3000 (scales with 1/area) | camera off; glossy off or linked to stones only |
| Table light | disc 20–40 across, 200–300 away, 10–20° off the camera axis | 30–100 | linked to stones only |
| Black cards (flags) | 50–200 planes, diffuse black (albedo 0.02), 60–200 from the piece | — | camera off; shadow off if they must not darken the ground |
| Lens-zone card | black disc 60–120 across on the camera axis, 150–250 from the piece, with the camera looking through a hole or the card set camera-invisible | — | camera off, shadow off, diffuse off |
| World | dim uniform or the skill's banded dome at 0.2–0.5 | — | optional: camera off |

- **Separating metal and stone light without light linking** `[E from the bounce classification]`: a ray leaving a stone after refraction is a transmission ray; a ray leaving polished metal (or bouncing off the outside of a facet) is a glossy ray. So an emitter with `visible_glossy = False` and `visible_transmission = True` is seen through stones but not mirrored in metal, and a card with `visible_transmission = False` shapes metal without appearing inside stones. This costs nothing at render time. Light linking does the same per object and also works for the direct light on matte surfaces; use it when the split must follow objects (centre stone against melee) and not ray types.
- **Why not HDRI only** `[E]`: a photographed studio HDRI fixes the softbox sizes and positions, usually has no sources small and bright enough for fire (and 8–16 stops of range are needed to hold them), and cannot be light-linked. Use an HDRI as dim fill (strength 0.1–0.3) under a built rig, or not at all; the skill's procedural banded dome is a reasonable substitute for fill. A built rig is also what makes a series of product pages consistent.
- **Mixing colour temperatures** `[E]`: the photographers' rule of one colour temperature translates to keeping every emitter the same white, with at most a slight warm/cool split (for example 5600 K key, 6500 K rim) for hero shots on white metal.
- **Black backgrounds** `[E]`: the same rig works; stones need the bright ring even more because the ground no longer bounces light into the pavilion.

### Gaps
- No source opened gives measured light sizes, distances or ratios for a professional jewelry set; the table is a translation of qualitative practice.
- The ASET angular bands were not confirmed on an opened page.
- Licences of HDRI sources other than Poly Haven were not checked this session.
- How Cycles applies light linking along long specular chains (stone → metal → stone) is not documented on the pages opened; test before relying on it for melee set in polished metal.

---

## 4. Camera the way macro product photographers do it

### Takeaway
Real jewelry is shot with 60–105 mm macro lenses from 15–40 cm at f/8–f/16 and focus-stacked, because one frame holds only 1.5–4 mm in focus at ring scale and smaller apertures soften from diffraction. A render gets the stacked look by switching depth of field off. If depth of field is wanted, note that Cycles reads the f-stop as if one scene unit were one metre: in a millimetre-scale scene "f/4" is a thousand times too weak.

### Cited Findings
- Lenses: a 60–80 mm macro with 1:1 magnification focuses from about 5 inches; GIA's photographer traditionally uses 105 mm — [V, [GIA 2014](https://gia.edu/gia-news-research-six-tips-best-gem-photos)]. 60 mm and 105 mm macro lenses, both 1:1, on a 36 MP full-frame body — [V, [Nikon](https://nikonusa.com/learn-and-explore/c/tips-and-techniques/bright-ideas-tips-and-techniques-for-photographing-jewelry)]. 50 or 85 mm, or a macro near 100 mm; avoid wide angles (distortion close up), and a longer lens keeps the photographer's reflection out of the metal — [V, [SLR Lounge](https://www.slrlounge.com/jewelry-photography/)]. Product renders: 80–120 mm — [V, [Will Gibbons](https://www.willgibbons.com/realistic-rendering/)].
- Apertures used in one shot: f/22–f/32 in a tent without stacking — [V, Nikon, same page]; f/11 on medium format "still wasn't enough" for rings, so focus-stacked — [V, [Karl Taylor](https://visualeducation.com/jewellery-photography-top-tips-for-how-to-photograph-jewellery/)]; f/8–f/16 at ISO 100–200 — [V, [Retouch4me guide](https://retouch4.me/blog/how-to-photograph-jewelry-complete-jewelry-photography-guide-2026)].
- Diffraction: a 180 mm macro at f/25 was at the limit and not sharp enough; a tilt-shift 80 mm at f/16 was sharp across a bracelet — [V, [Photigy](https://www.photigy.com/school/?p=60945)]. A catalogue photographer's lens sweet spot is about f/12, and a reader's f/8 stack beats a single f/22 frame — [V, [Fstoppers replies](https://fstoppers.com/commercial/how-photograph-jewelry-catalogs-35913)].
- Stacking method: camera locked, focus stepped front to back, frames aligned and blended (Photoshop auto-align and auto-blend, or Helicon Focus, which also corrects the size change between frames) — [V, Karl Taylor and Fstoppers, same pages]. None of the pages gives a frame count.
- Angles: shoot straight down on the table for a gem's best colour; turn or tilt for drama; an elevated angled view shows more of the centre stone — [V, [GIA 2015](https://gia.edu/gem-photography)]. Opaque pieces sharp front to back; lower the camera on transparent pieces to show colour — [V, Nikon]. Rings: straight-on hero, about 45° to show thickness and setting depth, macro crop; earrings as a pair plus one close-up; bracelets flat, angled and on wrist — [V, Retouch4me guide]. A retailer's rule for earrings: left earring straight-on, right one turned to show detail; rings in straight, angled and three-quarter views — [V, [Kohl's vendor style guide](https://link.kohls.com/content/dam/klink/pdfs/Vendor-Style-Guide-Jewelry.pdf)].
- Blender camera `[V local]`: `lens` 50 mm default, `sensor_width` 36, `sensor_height` 24, `sensor_fit` Auto, `type` PERSP/ORTHO/PANO/CUSTOM, `ortho_scale`, `shift_x/y`, `clip_start` 0.1, `clip_end` 1000; depth of field `dof.use_dof` (off by default), `focus_distance`, `focus_object`, `aperture_fstop` 2.8, `aperture_blades`, `aperture_ratio`.
- **Depth of field ignores the unit scale** `[V local, tiny_tests.py]`: with a 100 mm lens focused at 250 units and an edge 150 units behind focus, f/16 produced no measurable blur (2 px edge, the pixel filter) and f/0.016 produced the blur expected of a real f/16 lens at millimetre scale (4 px on a 256 px frame); the result was identical with `scale_length` 0.001 and 1.0. So the aperture radius is lens(mm) × 0.001 / (2 × f-stop) scene units, whatever the unit setting.

### Inferences
- **Depth of field at jewelry scale** `[E, thin-lens formula DoF ≈ 2·N·c·(m+1)/m², circle of confusion c = 0.03 mm, full frame]`:

| Subject, magnification m | f/8 | f/11 | f/16 | f/22 |
|---|---|---|---|---|
| Ring filling 70 % of frame height, m ≈ 0.76 | 1.5 mm | 2.0 mm | 2.9 mm | 4.0 mm |
| Pair of studs, m ≈ 1.2 | 0.7 mm | 1.0 mm | 1.5 mm | 2.0 mm |
| Pendant 25 mm, m ≈ 0.67 | 1.8 mm | 2.5 mm | 3.6 mm | 4.9 mm |
| Bracelet 180 mm across, m ≈ 0.14 | 28 mm | 38 mm | 56 mm | 77 mm |

  A ring in three-quarter view is about 20 mm deep, so a sharp catalogue frame is a stack of roughly 10–20 frames at f/8–f/11. Halve the figures for inspection at 45–60 megapixels.
- **Why not just stop down** `[E]`: the working aperture is N × (1 + m); f/16 at m = 0.76 is effectively f/28, whose diffraction disc (2.44 × 0.55 µm × 28 ≈ 38 µm) covers about eight 4.4 µm pixels. Hence f/8–f/11 and stacking.
- **Render equivalent** `[E]`: for catalogue shots leave `dof.use_dof` off; that is a perfect stack with no diffraction and no noise penalty. For a hero with real fall-off in a millimetre scene type the photographic f-number divided by 1000 (f/8 → 0.008; f/2.8 → 0.0028), focus on the table or the nearest prong, and expect 2–4 times the samples in blurred sparkle [V repo 14 §4.12]. The skill's "f/11" and "100 mm at f/4" produce no visible blur in its millimetre scenes; either that is the intended stacked look (then say so and drop the f-numbers) or the macro shot is missing its fall-off.
- **Perspective and apparent size** `[E]`: perspective depends only on distance. A real 100 mm macro at m = 0.76 sits about 230 mm from the ring (thin-lens figure; internal-focus lenses differ); parts 20 mm further away draw about 8 % smaller, at 130 mm about 13 %, at 460 mm about 4 %. Blender's camera is a pinhole whose `lens` is the image distance, so the same view needs `lens` ≈ 175 mm at 230 mm, or the skill's 135 mm at about 180 mm. Rule: put the camera 200–400 mm from the piece and choose the focal length that frames it (roughly 130–250 mm for a ring on a 36 mm sensor); do not go closer than about 150 mm or the head of a ring balloons relative to the shank.
- **Orthographic or perspective** `[E]`: orthographic removes size change with depth, so a 6 mm and a 7 mm stone keep their true ratio across a catalogue and top-down or side "technical" views align with CAD; it also looks slightly unreal in three-quarter views because parallel shank edges never converge. Use perspective at 200–400 mm for hero and three-quarter product shots and orthographic (or a 300 mm+ lens from 600 mm+) for top-down, side-profile, scale-comparison and size-chart images. In orthographic mode depth of field uses a different aperture formula, so keep it off.
- **Angle conventions to encode** `[E synthesis]`: three-quarter hero 30–45° azimuth and 20–35° elevation; top-down 90°; side profile 0–5° elevation at 90° azimuth; straight-on through-finger view for bands; earrings straight-on to the face of the stud or drop, one optionally turned 30–45°; pendants straight-on, bail at top centre; tennis lines from 60–80° elevation so tables face the lens. Keep one fixed set per category so a collection reads as one shoot.
- **Fill** `[E]`: retailers ask for the product to fill at least 85 % of the frame (next section); the skill's "about 70 %" is fine for hero images but under the marketplace figure for main images.

### Gaps
- No opened page states a typical number of stack frames or step size for rings.
- Working distances of specific macro lenses at ring magnification were derived, not sourced.
- I did not test depth of field for orthographic cameras.

---

## 5. Background and compositing for product pages

### Takeaway
Pure white means exactly 255 in every channel after export, and the only reliable way to get it is to render with a transparent film over a shadow-catcher ground and composite onto white after the view transform; a lit white backdrop cannot reach 255 under AgX or Neutral without ruining the lighting. Keep a soft contact shadow unless the retailer forbids it, and keep the reflections on the metal: retouchers clean dust and fix colour casts, they do not flatten the piece.

### Cited Findings
- Retail specifications: pure white RGB 255, square, at least 2000 × 2000 px, product filling at least 85 % of the frame, sRGB or Adobe RGB, JPEG or flattened TIFF, with an accurate clipping path; for most jewelry categories **no grounding shadow and no surface reflection**, with a natural grounding shadow kept only for boxes and trays — [V, [Kohl's vendor style guide](https://link.kohls.com/content/dam/klink/pdfs/Vendor-Style-Guide-Jewelry.pdf)]. Amazon main images: pure white (255, 255, 255), product at least 85 % of the frame, zoom from 1000 px on the long side; no borders, text, logos, watermarks or mannequins — [V, [Pixelz, 2015](https://www.pixelz.com/blog/heres-everything-you-need-to-know-about-amazons-product-image-requirements/)] (old; current Amazon page not opened). Some eyewear brands ask for a front view on white at level 255 in a square — [V, [Nath-Sakura](https://rockynook.com/article/product-photography-lighting-for-fashion-accessories/)].
- How photographers reach white: the tent's back wall made white by deliberate overexposure with a second flash, by trial and error — [V, [Nikon](https://nikonusa.com/learn-and-explore/c/tips-and-techniques/bright-ideas-tips-and-techniques-for-photographing-jewelry)]; if light wraps around the piece the background is too bright or too close — [V, [Fstoppers replies](https://fstoppers.com/commercial/how-photograph-jewelry-catalogs-35913)]; changing a grey background to white in post can make the subject look poor, so shoot two exposures (white background lit; dark background with top light) and combine — [V, [Adobe community thread](https://community.adobe.com/questions-712/retouching-small-jewellery-1142433)].
- A retouching service's sequence: review each piece stone by stone, cut out to pure white, sharpen stones, clean the metal (scratches, dust, stray reflections), add a natural shadow, final check — [V, [Picup Media](https://picupmedia.com/?p=21936)].
- Retouching guidance: correct gold that has gone orange and silver that has gone blue or orange by fixing white balance; warm gold without orange, neutral silver, rose gold balanced between pink and copper; shadows may be natural, drop or mirrored reflection (mirror is called the most popular for jewelry) and must line up with the subject; over-sharpening, plastic-looking shine and loss of texture are the marks of over-retouching — [V, [Retouch4me guide](https://retouch4.me/blog/how-to-photograph-jewelry-complete-jewelry-photography-guide-2026); [Color Clipping](https://www.colorclipping.com/blog/11-jewelry-retouching-techniques-create-visual-perfection)].
- Ethics line from GIA: clean dust and wax, correct colour only to match the real stone, never remove inclusions or change a stone's colour — [V, [GIA 2014](https://gia.edu/gia-news-research-six-tips-best-gem-photos)]. Colour reference: shoot a grey or colour card first in each setup — [V, [Ganoksin Orchid](https://orchid.ganoksin.com/t/photographing-faceted-gems/45256); [SLR Lounge](https://www.slrlounge.com/jewelry-photography/)].
- Blender switches `[V local]`: `render.film_transparent` (world background becomes transparent); `object.is_shadow_catcher` (tooltip: renders only shadows and reflections on the object; objects with it count as already in the footage); view-layer pass `use_pass_shadow_catcher` (per its tooltip, the shadows and light meant to be multiplied into a backdrop); `cycles.film_transparent_glass` (off by default); compositor Alpha Over node with a `Straight Alpha` input, Convert Colorspace, Cryptomatte and Glare nodes.
- What a white value becomes `[V local, cm_test.py]`: a scene-linear 1.0 is written as 255 only by the Standard view; Khronos PBR Neutral writes 239, Filmic 206, AgX 197 (208 with Medium High Contrast). AgX needs a scene value of about 16 to reach 255, Neutral about 16 (254 at 8).
- Saved files `[V local, chunks.py]`: Blender 5.3 writes an ICC profile into PNG (`iCCP`, plus `cICP`, `sRGB`, `gAMA`, `cHRM` chunks) and JPEG (`ICC_PROFILE` segment) on its own. There is no profile option in the image settings.

### Inferences
- **Recommended pipeline** `[E]`:
  1. Ground: a large plane with `is_shadow_catcher = True`; world lit as usual; `film_transparent = True`; `film_transparent_glass` left **off** so stones stay opaque in alpha (otherwise the white page shows through every stone).
  2. Render to RGBA. The catcher delivers the soft shadow (and, if its material is glossy, a ground reflection) in the alpha channel.
  3. Composite over pure white **after** the view transform: either in Pillow/NumPy on the saved 16-bit PNG, or in Blender's compositor with the output set to Standard. Then check programmatically that the corner pixels and the bounding border are exactly 255 and that no pixel within N px of the frame edge is below 255.
  4. Save JPEG quality 92–95 or PNG; pass the ICC profile through (in Pillow: `icc_profile=img.info.get("icc_profile")`, since saving without it silently drops the profile).
- **Grey fringes** `[E]`: they come from three places. (a) Alpha mismatch: Blender's render buffer is premultiplied, PNG stores straight alpha; treating one as the other leaves dark halos, so use the Alpha Over node's defaults or a library that knows which it has. (b) Thresholding the alpha or resizing before compositing: composite at full resolution, then downscale. (c) Shadow catcher bounce: the catcher also records light bounced from the piece, which can lift or tint pixels next to the metal; that is real and should stay.
- **Linear or display-space composite** `[E]`: compositing the straight-alpha PNG in display space (what the skill's Pillow step does) makes the shadow darker and tighter than a scene-linear composite would. Either is acceptable; what matters is doing it the same way for every image.
- **Shadow consistency** `[E]`: fix the things that set shadow density across a catalogue: same rig and ground height, piece resting on the ground (lowest vertex at z = 0, checked numerically, which also cures the floating look), same exposure, and a fixed post gain on the alpha if needed (for example clamp shadow alpha to a maximum of 0.25–0.35 so the darkest contact shadow is a light-to-mid grey of about 165–190 on the 0–255 scale). Small hard sources also throw faint hard-edged shadows on the catcher, as real ones do; if those are unwanted, give the sparkle emitters a light-linking receiver collection that leaves the ground out.
- **When the retailer forbids shadows**: deliver two files from one render: with shadow (own site) and alpha-cut without (marketplaces), by zeroing alpha outside the object's Cryptomatte or by disabling the catcher. One render, two exports.
- **Reflection under the piece** `[E]`: a mirror-acrylic look needs the catcher's material to be glossy (roughness 0.05–0.15); keep it for black-acrylic scenes, skip it for marketplace white.
- **White balance the retoucher's way** `[E]`: in a render the lights are exactly white, so the retoucher's corrections (neutralising casts on white metal, taking orange out of yellow gold) are unnecessary; the equivalent duty is not to introduce a cast: neutral emitters, no coloured world, and material colours from §1. Do not "correct" rhodium to equal channels; its faint warmth is real.
- **"Too clean" versus "believable"** `[E synthesis]`: remove what a retoucher removes (dust, lint, fingerprints, wax, tool marks, a distracting reflection of the camera) and keep what a retoucher keeps (gradient reflections, dark card lines, slight variation in highlight sharpness, tiny asymmetries between prongs, the soft contact shadow, a little light spill and caustic sparkle on the ground). A render starts with nothing to remove, so "believable" means adding only the second list; do not add dust or fingerprints to catalogue images.

### Gaps
- Amazon's current image requirements page was not opened here; the figures come from a 2015 summary and a retailer's guide. The sibling notes file `product_page_requirements.md` in this folder covers marketplace rules from Amazon's own posts and should be preferred for those numbers.
- No opened source gives shadow opacity or blur values used by retouchers.
- I did not measure the composite difference between display-space and linear-space alpha blending.
- The manual's shadow catcher page could not be opened; behaviour is from the tooltips.

---

## 6. Colour management for product images

### Takeaway
Blender ships Khronos PBR Neutral as a view transform (since 4.2), built for exactly this job: base colours pass through unchanged below about 80 % and highlights roll to white without hue shift. Use it (or Standard, if nothing important exceeds 1.0) for catalogue images where yellow, rose and white gold must be told apart; keep AgX for moody hero shots. None of them except Standard writes a scene white as 255, which is one more reason to composite the white background afterwards.

### Cited Findings
- View transforms in 5.3 `[V local]`: Standard, ACES 1.3, ACES 2.0, Khronos PBR Neutral, AgX (default), Filmic, Filmic Log, False Color, Raw. Working space options: Linear Rec.709 (default), Linear Rec.2020, ACEScg. Exposure in stops (render × 2^exposure), gamma, curves and a white-balance control (temperature 6500, tint 10 by default) sit in the same panel.
- Manual descriptions: Standard does only the display conversion and suits non-photoreal work; Khronos PBR Neutral is a tone mapper for colour accuracy under grey-scale lighting, "aimed toward product photography use cases" where the scene is well exposed and high values are mostly small highlights; AgX has 16.5 stops of range and desaturates strongly exposed colours like film; Filmic is deprecated in favour of AgX; Raw is for inspection only; PNG and JPEG hold display-ready colour and OpenEXR holds scene-linear data; "Save as Render" applies the view transform — [V, [manual 4.3, Color Management](https://docs.blender.org/manual/en/4.3/render/color_management.html)].
- Origin: added by a pull request merged on 18 Mar 2024, on behalf of Khronos, for users who would otherwise pick Standard and want to match three.js and Filament; not meant to compete with AgX; produces no HDR output; reviewers found darkening in dark saturated gradients — [V, [Blender pull request 118936](https://projects.blender.org/blender/blender/pulls/118936)]. A manual page for 4.2 already lists it [S, search result for the 4.2 Color Management page].
- Design, from its author's page: aimed at e-commerce, where catalogue photographs are the reference; colours up to 0.8 − 0.04 pass 1:1, so anything that would display below sRGB 231 is reproduced exactly; above that, a 1/x-style curve approaches 1 and colours fade toward white (desaturation constant 0.15); the 0.04 offset compensates the 4 % surface reflection of dielectrics; clamping instead gives a saturated yellow highlight on gold that "does not look perceptually right"; ACES and AgX lose saturation; lowering exposure until nothing exceeds 1 is discouraged because shiny objects then lose brightness and contrast — [V, [model-viewer tone-mapping page](https://modelviewer.dev/examples/tone-mapping)].
- Measured in Blender 5.3 `[V local, cm_test.py]` (8-bit sRGB output for linear inputs):

| Scene-linear input | Standard | Khronos PBR Neutral | AgX | AgX Medium High Contrast | Filmic |
|---|---|---|---|---|---|
| grey 0.18 | 118 | 105 | 118 | 118 | 128 |
| grey 0.50 | 188 | 181 | 170 | 178 | 177 |
| grey 0.80 | 231 | 225 | 189 | 199 | 197 |
| grey 1.00 | **255** | 239 | 197 | 208 | 206 |
| grey 2.0 | 255 | 250 | 217 | 229 | 228 |
| grey 4.0 | 255 | 253 | 233 | 244 | 242 |
| grey 16 | 255 | 255 | 255 | 255 | 255 |
| fine gold (1.0, 0.766, 0.336) × 1 | 255, 227, 157 | 239, 212, 143 | 198, 185, 157 | 209, 194, 165 | 206, 196, 158 |
| fine gold × 2 (a highlight) | 255, 255, 214 | 250, 226, 169 | 218, 208, 187 | 230, 219, 198 | 228, 220, 190 |
| fine gold × 4 | 255, 255, 255 | 253, 234, 192 | 234, 226, 210 | 245, 237, 222 | 242, 237, 216 |
| rhodium (0.797, 0.765, 0.742) × 1 | 231, 227, 224 | 225, 220, 217 | 188, 187, 186 | 199, 197, 196 | 197, 196, 194 |
| 18K rose (0.97, 0.68, 0.48) × 1 | 252, 215, 184 | 238, 202, 171 | 196, 181, 170 | 207, 191, 178 | 205, 191, 175 |

  Readings: Standard clips gold highlights to pale lemon and then white (the hue skew the Khronos page describes); Neutral keeps gold's hue through × 4; AgX pulls gold, rose and rhodium toward the same beige-grey (at × 1 the red-to-blue spread of fine gold is 41 levels under AgX against 96 under Neutral and 98 under Standard).
- Blender embeds an ICC profile in PNG and JPEG output on its own `[V local]` (see §5).

### Inferences
- **Catalogue default: Khronos PBR Neutral, look None, exposure 0, display sRGB** `[E from the measurements]`. It is the only shipped transform that both keeps metal colours separable and handles highlights above 1 gracefully. Note it darkens midtones slightly relative to Standard (0.18 → 105, not 118), which is its built-in contrast; do not compensate with a look.
- **Standard is acceptable** when the scene is exposed so metal bodies sit below 1.0 and only light-source reflections clip; its advantage is that 1.0 is exactly 255 and colours are literal. Its cost is the lemon-then-white skew on bright gold.
- **AgX (the skill's current choice, with Base Contrast) is wrong for catalogue white-background work** `[E]`: it needs a scene value of 16 for white, greys out metal colours, and makes yellow, rose and white gold harder to tell apart, the opposite of what a product page needs. Keep it, with Medium High Contrast or Punchy, for dark-background hero and lifestyle images where highlight roll-off matters more than literal colour.
- **Exposure practice** `[E from the Khronos page]`: set light strengths so a matte white card in the scene would land at 0.7–0.8 scene-linear; polished metal bodies then sit at 0.5–0.8 and only reflections of sources exceed 1. Adjust the lights, not the materials, when the picture looks wrong.
- **Glare and sparkle** `[E]`: do bloom and star filters on the scene-linear image before the view transform (compositor Glare node), which again requires the unclamped render of §2.
- **Export** `[E]`: 16-bit PNG from Blender as the master, composite on white, convert to 8-bit sRGB JPEG or WebP for the page, keep the ICC profile, and do not convert to Display P3 unless the whole site is colour-managed: pure gold's red is out of sRGB by about 4–6 % [V calc], which Neutral clips invisibly.
- **Working space** `[E]`: leave Linear Rec.709. Rec.2020 or ACEScg would hold gold's out-of-gamut red, but the base colours and n,k in §1 were reduced for Rec.709 and would have to be recomputed.

### Gaps
- The Blender version that first shipped Khronos PBR Neutral is inferred as 4.2 (first release after the March 2024 merge, and listed in the 4.2 manual per a search result); the 4.2 colour-management release notes were not opened.
- The Displays and Views manual page for 5.x was blocked; descriptions come from the 4.3 page.
- I did not evaluate ACES 2.0 beyond the table run (grey 1.0 → 180; fine gold × 1 → 181, 168, 135), nor the Khronos page's claim about gradients on real renders.

---

## 7. The tells that make a jewelry render look fake, and the fix for each

### Takeaway
Most tells are either "too perfect" (razor edges, uniform roughness, mirror symmetry, pristine prongs) or "physically cut short" (clamped flashes, truncated bounces, missing caustics, floating piece). Each has a specific, cheap fix in geometry, material or render settings.

### Cited Findings
- Sharp edges read as unrealistic on precious metal; small fillets catch the light — [V, [Novedge](https://novedge.com/blogs/design-news/rhino-3d-tip-rhino-jewelry-rendering-tips-for-polished-presentations); [Lionsorbet](https://lionsorbet.squarespace.com/education/9-ways-to-prepare-3d-cad-models-for-jewellery-rendering) (about 0.2 mm)].
- Geometry passing through a stone renders as black spots; stones touching their seats lose light; un-rounded claw tops and split-shank seams give CAD away (the studio reports about 99 % of received models built in halves and 20–30 % of those with a visible seam) — [V, Lionsorbet, same page].
- Product-rendering checklist: real-world scale, a ground plane with shadow so nothing floats, one clear main light direction with some areas left dark, varied roughness, sparing dust, a hint of depth of field, enough ray bounces for every transparent surface or black areas appear, 16- or 32-bit output — [V, [Will Gibbons](https://www.willgibbons.com/realistic-rendering/)].
- Signs of an over-processed jewelry image: over-sharpening, plastic or glowing highlights, loss of surface texture (the piece starts to look synthetic), scratches erased completely, shadows that do not line up, colours that do not match the piece — [V, [Retouch4me guide](https://retouch4.me/blog/how-to-photograph-jewelry-complete-jewelry-photography-guide-2026); [Color Clipping](https://www.colorclipping.com/blog/11-jewelry-retouching-techniques-create-visual-perfection)].
- Flat, lifeless stones under all-white diffuse light; polarising away all surface reflection leaves a stone with no shine that looks wrong — [V, [Rapaport](https://rapaport.com/?p=40092); [Ganoksin Orchid](https://orchid.ganoksin.com/t/photographing-faceted-gems/45256)].
- Close-up framing reveals modelling tolerances: render close, but not closer than the model's detail supports — [V, Novedge, same page].
- In the earlier spike, 64 samples plus Open Image Denoise looked finished at ring size but with the stone slightly smoothed, and unresolved caustics from small lights showed as bright speckles on the ground — [V repo 15 §6.4].

### Inferences
Table of tells, causes and fixes `[E synthesis; setting names V local]`:

| Tell | Cause | Fix in Blender |
|---|---|---|
| Razor-sharp metal edges; highlight lines one pixel wide or absent | CAD edges with zero radius | Bevel modifier 0.05–0.2 mm, 2–3 segments, or Bevel shader node radius 0.05–0.1; never on gems |
| Metal looks like liquid chrome or plastic | Uniform roughness, neutral grey base colour, all-white environment | Base colours and n,k from §1; roughness 0.03–0.05 with slight variation; black cards and gradient emitters in the rig |
| Yellow, rose and white gold look alike | AgX desaturation; guessed colours | Khronos PBR Neutral for catalogue; alloy table in §1 |
| No contact shadow, piece floats | Ground missing or piece not resting on it; shadow washed out by overlit background | Drop lowest vertex to z = 0; shadow-catcher ground; composite white afterwards instead of lighting the backdrop to white |
| Scale feels wrong (ring looks like a hula hoop or a toy) | Wide lens too close; depth of field of a large object; bevels and textures at the wrong scale | Camera 200–400 mm away with a long lens; no depth of field or the mm-corrected f-stop (§4); edge radii and scratch maps in real mm |
| Black diamonds or black facets | Glossy bounces too low (default 4); metal intersecting the stone; total bounces lower than glossy | Glossy = transmission = total = 32 (16 draft); air gap of 0.01–0.03 mm; nothing through the pavilion |
| Grey, dull diamonds | Principled Base Color left at 0.8; indirect clamp at 10–20; no small bright sources | Base Color (1,1,1); `sample_clamp_indirect = 0`; 3–8 sparkle emitters |
| Milky, flat white diamonds | Tent-like all-round white light; nothing dark over the table | Dark zone around the camera axis; cut the world to 0.2–0.5; black cards |
| No fire, or fire as colour noise | Dispersion off, or too few samples for single-wavelength sampling | Abbe 55 with Scale 1 on stones larger than a few hundred pixels; 512–2048 samples; no clamp |
| Stone looks like moulded glass | Smooth shading or bevel on the gem; rounded facet junctions | Flat shading, exact planar facets, real girdle |
| Solid dark blob under each stone | Refractive caustics off | Caustic switches on for finals, filter glossy 0, enough samples; slightly larger sparkle sources if the ground stays noisy |
| Waxy, smeared facets | Denoiser averaging facet-scale detail at low sample counts | More samples in stone pixels; denoise with albedo and normal guides; or leave stones un-denoised via a Cryptomatte mask (§8) |
| Speckle or fireflies on white ground | Unresolved caustics from tiny sources | Larger sources for ground light, more samples, or a despeckle limited to the ground mask; do not clamp globally |
| Mirror-perfect symmetry: identical prongs, identical highlights on both sides, stones all at the same rotation | Instanced CAD and a symmetric rig | Rotate each round stone a random amount about its axis; add 0.5–2° and 0.01–0.03 mm jitter to prongs and stone seating on hero shots; make the rig asymmetric (key from one side, strips of unequal strength) |
| Prong tips as flat-cut cylinders or perfect hemispheres floating above the stone | Pre-finishing CAD | Shorten and round the tips, bring them down onto the crown, slight flattening; if the CAD must be shown as modelled (the skill's verification rule), say so and do not present it as a finished-piece photo |
| Visible seams, coincident faces, faceting on curved metal | Meshing | Weld, increase render-mesh density at import, shade-smooth by angle (30–35°) on metal only |
| Fingerprints, dust, lint | Added for "realism" | Leave them out of product images: photographers clean them off and retouch the rest; at most a few dust motes on a black-acrylic hero |
| Too sharp, "crunchy" image | Post sharpening on already alias-free render | No sharpening; default Blackman-Harris pixel filter at 1.5 px; downscale from a larger render if softness is wanted |
| Pure digital black inside dark facets and card reflections | Zero-albedo cards and a zero world | Cards at albedo 0.02–0.04; world never below about 0.02 |

### Gaps
- No controlled study was found that ranks these tells by how often viewers notice them; the ordering is judgement.
- Typical prong-tip shapes after setting (ball, claw, flat tab) and their dimensions were not sourced.

---

## 8. Render cost: samples, adaptive sampling, denoising and protecting facets

### Takeaway
For a 2K–4K still with dispersion, plan on 512–1024 samples with denoising or 2048–4096 without, an adaptive threshold of 0.01 (0.005 for hero close-ups) and a minimum-sample floor so dark facets are not abandoned before their flashes are found. Denoise with albedo and normal guide passes, and for hero crops keep the denoiser off the stones altogether with a Cryptomatte mask.

### Cited Findings
- Defaults in 5.3 `[V local]`: `samples` 4096; `use_adaptive_sampling` on; `adaptive_threshold` 0.01 (0 = automatic); `adaptive_min_samples` 0 (automatic; tooltip: the minimum exists so noisy features are found before a pixel stops sampling); `use_denoising` on; `denoiser` OpenImageDenoise; `denoising_input_passes` `RGB_ALBEDO_NORMAL`; `denoising_prefilter` `ACCURATE` (tooltips: None = guide passes assumed noise-free; Fast = colour and guides denoised together; Accurate = guides prefiltered first); `denoising_quality` High; `denoising_use_gpu` off for final renders; pixel filter Blackman-Harris 1.5 px; `light_sampling_threshold` 0.01; `tile_size` 2048 (tiling always on); `time_limit` 0; `seed` 0.
- View-layer options `[V local]`: `denoising_store_passes` (saves the noisy image and the guide passes), `denoising_pass_follow_reflections` (default on: the guide passes follow reflections), `denoising_pass_use_albedo_roughness_weighting` (default on). Compositor Denoise node inputs: Image, Albedo, Normal, HDR, Prefilter, Quality.
- Open Image Denoise 2.3 with GPU support arrived in 4.2, including GPU denoising of CPU renders; blue-noise sampling (better at low sample counts) became the default for new files — [V, [4.2 notes](https://developer.blender.org/docs/release_notes/4.2/cycles/)]. DLSS Ray Reconstruction in 5.3 is a viewport denoiser only — [V, [CG Channel](https://www.cgchannel.com/?p=180007)].
- Dispersion adds colour noise and the manual's remedy is more samples and a higher indirect clamp — [V, [manual dev](https://docs.blender.org/manual/en/dev/render/shader_nodes/shader/principled.html)].
- Measured earlier on this machine (2 CPU cores, Cycles 5.3, 512 × 512, dispersion on, depth 32, no clamp): 256 samples took 91 s (whole ring) and 133 s (stone close-up) and sat 0.0054 and 0.0079 mean absolute difference from a 2057-sample reference on a 0–1 display scale (for scale, switching dispersion off changes the close-up by 0.011); 64 samples plus denoising matched the 256-sample error on the whole ring (0.0055) in 25 s, with the stone slightly smoothed — [V repo 15 §6.3–6.4].
- A Blender artist's gold ring with diamonds at 2168 × 1680 used 6,180 samples — [V repo 14 §6.1].
- Path guiding doubled time with no visible gain on a ring [V repo 03]; it is CPU-only [V repo 14].

### Inferences
- **Sample budgets** `[E, from the measurements above and file 14's estimates]`:

| Use | Resolution | Max samples | Noise threshold | Min samples | Denoise | Dispersion, caustics |
|---|---|---|---|---|---|---|
| Look-dev draft | 640–1024 px | 64 | 0.05 | auto | on, Fast prefilter | off |
| Catalogue still | 2048 px | 512 | 0.01 | 64 | on, albedo + normal, Accurate | dispersion on for centre stones, caustics on |
| Hero still | 3000–4096 px | 1024–2048 | 0.005 | 128 | metal and ground only; stones un-denoised | on |
| No-denoise master | any | 2048–4096 | 0.002–0.005 | 256 | off | on |
| Animation frame | 1080 px | 192–256 | 0.02 | 32 | on, animated seed | dispersion optional, caustics off |

  The skill's finals (1600 px, 160 samples, threshold 0.01, denoised) are a draft-plus tier by this table: fine for metal, thin for stones with dispersion.
- **Why a minimum-sample floor** `[E]`: adaptive sampling stops a pixel when its estimated noise is low. A dark facet whose rare paths hit a small bright light looks converged after a few dozen samples and is abandoned, so its sparkle never appears, or appears as a single un-averaged firefly. `adaptive_min_samples` of 64–128 for stills keeps those pixels alive; in stone close-ups consider switching adaptive sampling off.
- **What denoising does to facets** `[E]`: Open Image Denoise is trained to keep edges that the albedo and normal passes explain. Inside a stone the meaningful detail is reflections of reflections, which no guide pass describes beyond the first hit (the "follow reflections" option carries the guides through mirror-like bounces, which helps the first-order facet pattern), so at low sample counts the denoiser averages small flashes into smooth gradients: waxy facets, lost pin-fire, and coloured dispersion noise merged into pastel blotches. The damage shrinks as the input gets cleaner; above roughly 500–1000 samples it is hard to see at catalogue size.
- **Protecting the stones** `[E]`: (1) enable `denoising_store_passes` and Cryptomatte (object or material); (2) in the compositor, denoise the image with the stored albedo and normal; (3) mix the noisy image back over the denoised one through the Cryptomatte matte of the gem material, slightly eroded so prong edges stay clean. Stones then carry honest fine noise, which reads as scintillation in a still, while metal and ground are clean. A cheaper variant is two view layers (stones at 4× the samples of the rest via per-layer sample overrides, `use_layer_samples`). For animation do not do this: un-denoised stones flicker.
- **Where the time goes** `[E]`: samples × pixels dominate; depth 32 against 16 costs little because few paths survive; dispersion costs no rays, only convergence (2–4× samples in stone pixels) [V repo 14]; caustics on with tiny sources is the open-ended cost, controlled by source size, not by clamping.
- **Seeds** `[E]`: for stills a fixed seed is fine; for A/B tests of settings use the same seed so differences are not noise; for animation turn on `use_animated_seed` when denoising.
- **GPU note** `[E from file 14]`: an Apple M2-class GPU needs minutes for the catalogue tier and tens of minutes for the hero tier; a mid-range RTX card about a fifth to a tenth of that. Set `denoising_use_gpu` on when a GPU is present.

### Gaps
- The Sampling manual page was blocked, so "typical" noise-threshold ranges quoted by the manual are not included; the tier table is my recommendation, not documentation.
- No measurement exists yet at 2K–4K with dispersion on this pipeline; the companion measured tests (ray depth, clamping, seeds) should confirm or correct the sample tiers, the cost of removing the indirect clamp, and how visible denoiser smoothing is at each tier.
- I found no published study of Open Image Denoise on faceted gems.
