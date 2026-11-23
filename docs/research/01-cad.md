# 01 — Jewelry CAD: domain model and geometry kernel

Research date: 2026-11-23. Scope: what Pavé must model, the numbers it must get right, and which kernel builds it.

**Evidence legend.** **[V]** verified today from a primary source (npm/PyPI registry, package contents, cloned repo, or a benchmark run for this doc). **[S]** secondary source read via web search. **[K]** domain knowledge, *not* re-verified today — treat as a default to confirm. Gaps are listed in the last section.

---

## 1. What professional jewelry CAD offers

| Product | Kernel / nature | What it is known for |
|---|---|---|
| MatrixGold 3.x (Gemvision/Stuller) | Rhino NURBS + parametric history | "Dynamic" builders; edit at any stage without losing history; Gems Placer on any surface/mesh; auto-scaling bezels, azure ("honeycomb") cutters, prong guides (3.10); smart prong, matching-band rail, iJewel3D render (3.11); gem map, material list, tech report. [S] [product page](https://www.multistation.com/en/product/gemvision-3d-software-matrixgold/), [3.10](https://blog.stuller.com/introducing-matrixgold-3-10-the-efficiency-update/), [3.11](https://discourse.mcneel.com/t/matrixgold-3-11-the-agility-update/213117) |
| Rhino 8 + 2Shapes/RhinoArtisan, Panther | NURBS + SubD, plugins | Parametric gems/prongs, STL analysis/repair, direct printer hand-off. RhinoGold is discontinued (folded into MatrixGold). [S] [2Shapes](https://blog.rhino3d.com/2021/06/2shapes-for-rhino-new-jewelry-plug-in.html), [forum](https://discourse.mcneel.com/t/rhino7-and-rhinogold/116406) |
| 3Design | Fully associative history tree; 3Shaper (SubD), DeepImage (render) | Component-oriented workflow familiar to bench jewelers. [K], [Formlabs overview](https://formlabs.com/blog/jewelry-design-cad-software) |
| JewelCAD Pro | Free-form curve/surface, `.jcd` | Fast organic/filigree work, dominant in Asian factories. [K] |
| Firestorm CAD | Direct (history-free) hybrid modeling | Speed on pavé-heavy pieces. [K] |
| CounterSketch (Stuller) | In-store configurator over a parametric library | Sales-counter customisation of pre-validated models, manufactured by Stuller. [K] |
| Blender + JewelCraft 3.0.1 (GPL-3, Blender ≥ 4.5) | Mesh | Gems, prongs, auto-prongs, micro-prongs, cutters, distribute-on-curve, ring-size curve, spacing overlay, alloy weighting, gem map, design report. [V] [repo](https://github.com/mrachinskiy/jewelcraft) |
| ZBrush | Sculpt mesh | Organic/figurative, live booleans, decimate-to-STL; no gem or analysis tools. [K] |

### De-duplicated feature checklist

**T** = table stakes for v1, **L** = later.

| Group | Features | Tier |
|---|---|---|
| Gems | Cut library: round, princess, emerald, asscher, oval, cushion, pear, marquise, radiant, heart, baguette, trillion; mm↔ct per material; per-stone metadata | T |
| | Tapered baguette, cabochon, rose/old-mine cuts, custom cut import | L |
| Settings / heads | Prong (4/6, round/claw/double), bezel (full/half), basket, halo, cathedral head | T |
| | Channel, bar, flush/gypsy, shared-prong, cluster | T (channel, shared-prong) / L |
| | Tension, invisible, illusion | L |
| Shanks / bands | Profiles D, court, flat, comfort-fit, knife-edge, euro; taper; cathedral; signet | T |
| | Split, bypass, twist, interlocking | L |
| Gem arrays | Along curve, eternity (½, ¾, full), graduated, halo ring | T |
| | Pavé on arbitrary surface (UV/geodesic packing), honeycomb | L (flat/cylindrical pavé is T) |
| Cutters | Seat + through-hole cutters per cut; azures; channel cutter | T (seat/hole) / L (azure) |
| Prong / bead tools | Prong placer with overlap, bead/micro-prong between stones, milgrain | T (prongs, beads) / L (milgrain) |
| Pendants | Bail library (fixed, tube, hidden, split), jump-ring | T |
| Earrings | Posts, mirrored pairs, hoops/huggies, findings library | T (stud, hoop) / L |
| Chains | Link along curve, tennis line | L |
| Engraving / text | Text on curve/inside band, hallmark stamp | T |
| Patterns / textures | Relief from height map, filigree, hammered | L |
| SubD / organic | SubD → NURBS/mesh | L |
| Analysis | Metal weight by alloy; stone count/ct report; ring resize; min-wall check; printability (watertight, min feature) | T |
| | Gem map drawing, cost estimate, casting-tree/sprue | L |
| Export | STL, 3MF, STEP, GLB, 3DM | T |

---

## 2. The spec an AI must pin down before CAD is built

### Parameters per piece type

| Piece | Must be resolved |
|---|---|
| All | Units (mm); alloy (→ density, min-feature profile); manufacturer profile (min wall, min prong, shrink allowance, process); stones[] = {material, cut, L×W×D mm *or* ct, role}; finish; engraving |
| Ring | Size system + value → inner Ø; fit (flat/comfort); shank profile; width and thickness at base/shoulder/top; style (straight, cathedral, tapered, signet, split, bypass); head type; prong count/shape/Ø/overlap; head height above finger; accent layout (stone Ø, coverage, rows, graduation); gallery/azures |
| Band | Size, width, thickness, profile, fit, edge treatment; stone coverage → count |
| Pendant | H×W×T; bail type and opening (chain Ø + clearance); hang point; setting; open/closed back; chain length |
| Earrings | Type (stud/drop/hoop/huggie); mirrored pair; post Ø/length and back; hoop inner Ø and tube Ø; weight per ear |
| Bracelet / bangle | Inner circumference (or oval axes); rigid/hinged/cuff/link; width × thickness; clasp; tennis: stone Ø → count |

### Rules of thumb (defaults; every one must be overridable per manufacturer profile)

| Rule | Value | Source |
|---|---|---|
| Structural/external wall, cast | ≥ 0.8 mm | [S] [Stuller CAD/CAM Production Standards](https://assets.stullercloud.com/web/apps/images/kbpdfs/CADCAMProductionStandards.pdf) |
| Wall by metal | silver 0.8–1.0 mm; gold 1.0–1.2 mm; Pt similar to gold [K] | [S] [silversculptor](https://www.thesilversculptor.com/blogs/news/design-your-own-ring) |
| Ring band wall (3D-print service) | ≥ 1.0 mm; general walls 0.6–0.8 mm | [S] [i.materialise silver](https://i.materialise.com/materials/silver/design-guide) |
| Openings / gaps | ≥ 0.4 mm (else they fill in casting) | [S] Stuller, as above |
| Shank thickness (daily wear) | ≥ 1.5 mm (1.3 mm absolute floor); solitaire shank width ≥ 1.8–2.0 mm | [S] [Aide-mémoire](https://aide-memoire-jewelry.helpscoutdocs.com/article/39-how-wide-should-my-ring-be), [Brian Gavin](https://www.briangavindiamonds.com/news/buyers-guide-thin-band-engagement-ring/) |
| Prong Ø, pinpoint/melee | ≥ 0.45 mm | [S] Stuller |
| Prong Ø, accent stones (by stone Ø) | ≥2.5 mm → 0.8; ≥1.7 → 0.7; ≥1.5 → 0.6; ≥1.2 → 0.5; ≥1.0 → 0.4 mm | [V] [JewelCraft `prongs_presets.py`](https://github.com/mrachinskiy/jewelcraft) |
| Prong Ø, center stone | min ≈ 0.08·d + 0.3 mm (5 mm → 0.70; 6.5 mm → 0.82); cast ≥ 0.8 mm; typical 1 ct four-prong 1.0–1.2 mm [K] | [S] [calculator](https://superglobalcalculator.com/calculators/jewelry-making/prong-setting/), [misterjewel](https://misterjewel.com/3d-jewelry-design-technical-tips-for-superior-quality-in-manufacturing-and-casting/) |
| Prong count | 4 or 6 round; 5–6 pear/heart (V-prong on points); 3 trillion | [S] same; [V] JewelCraft |
| Prong overlap onto stone | 0.15 mm or 15 % | [S] [Stuller spec sheet](http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf) |
| Bezel wall | ≥ 0.45 mm (Stuller); ≥ 0.6, ideally 0.8–1.0 mm for hand setting | [S] Stuller; misterjewel |
| Channel wall (melee, pinpoint) | ≥ 0.4 mm to prong-base edge | [S] Stuller |
| Seat cutter girdle scale | 98 % of stone (setter opens the seat) | [S] Stuller |
| Through-hole under stone | ≈ 0.66 × stone Ø | [V] JewelCraft `cutter_presets.py` |
| Culet clearance | Pavilion ≈ 43 % of Ø (round); keep ≥ 0.2–0.3 mm metal-free below culet and culet above the finger line [K] | geometry §3 |
| Pavé girdle-to-girdle gap | 0.10–0.25 mm (default 0.15) | [S] misterjewel; [Virtual Foundry](https://thevirtualfoundry.com/3d-printing-jewelry-design/) |
| Pavé bead Ø | ≈ 25–35 % of stone Ø, ≥ 0.3 mm [K] | — |
| Eternity count | n = ⌊π·D_girdle / (Ø + gap)⌋, then re-solve Ø or gap so it closes exactly | derived |
| Graduated rows | Step 0.1–0.2 mm per stone (melee is sieved in ~0.05–0.1 mm steps) [K] | — |
| Engraving | Recess ≥ 0.4 mm wide; depth:width ≤ 1:1 | [S] i.materialise |
| Earring post [K] | Ø 0.8–0.9 mm, length 10–11 mm | — |
| Bangle [K] | Inner Ø ≈ 60–68 mm; bracelet length 165–190 mm | — |

---

## 3. Reference data

### Ring sizes

ISO 8653 size = inner circumference in mm ([ISO 8653:2016](https://www.iso.org/standard/65408.html), [Wikipedia](https://en.wikipedia.org/wiki/Ring_size)). **Store circumference; convert at the edges.** Formulas as implemented in JewelCraft [V] (`lib/ringsizelib.py`):

- US/Canada: `C = 36.5367 + 2.5535·s` ⇔ `d = 11.63 + 0.8128·s` mm
- UK/AU: `C = 37.5 + 1.25·n`, A = 0, half sizes = 0.5 (so C = 40 mm)
- EU/ISO: `C` rounded; Swiss/IT/ES: `C − 40`
- Japan/HK: **lookup table only** — not linear.

| US | d (mm) | C (mm) | EU | CH | UK | JP |
|---|---|---|---|---|---|---|
| 3 | 14.07 | 44.2 | 44 | 4.2 | F½ | 4 |
| 4 | 14.88 | 46.8 | 47 | 6.8 | H½ | 7 |
| 5 | 15.69 | 49.3 | 49 | 9.3 | J½ | 9 |
| 6 | 16.51 | 51.9 | 52 | 11.9 | L½ | 12 |
| 7 | 17.32 | 54.4 | 54 | 14.4 | N½ | 14 |
| 8 | 18.13 | 57.0 | 57 | 17.0 | P½ | 16 |
| 9 | 18.95 | 59.5 | 60 | 19.5 | R½ | 18 |
| 10 | 19.76 | 62.1 | 62 | 22.1 | T½ | 20 |
| 11 | 20.57 | 64.6 | 65 | 24.6 | V½ | 23 |
| 12 | 21.38 | 67.2 | 67 | 27.2 | X½ | 25 |
| 13 | 22.20 | 69.7 | 70 | 29.7 | Z+1 | 27 |

Published charts disagree by ±½ UK size and ±1 JP size at several rows [S]; never round-trip through letters.

### Round brilliant (57/58 facets)

| Parameter | GIA Excellent range | Tolkowsky | Pavé modeling default |
|---|---|---|---|
| Table | 52–62 % | 53 % | 57 % |
| Crown angle | 31.5–36.5° | 34.5° | 34.5° |
| Pavilion angle | 40.6–41.8° | 40.75° | 40.8° |
| Girdle | thin – slightly thick | (knife) | 3.5 % |
| Total depth | ≈ 57.5–63 % [K] | 59.3 % | 61.5 % |
| Star / lower half | 45–65 % / 70–85 % [K] | — | 50 % / 77 % |

Sources: [GIA anatomy](https://www.gia.edu/gia-website/diamond-cut/diamond-cut-anatomy-round-brilliant), [GIA 4Cs](https://4cs.gia.edu/blog/diamond-anatomy-explained/), [Rare Carat](https://rarecarat.com/blog/what-are-the-ideal-gia-diamond-proportions), [Skyjems](https://skyjems.ca/pages/encyclopedia-cut-grade-excellent) [S]. Check: crown 0.215·tan 34.5° = 14.8 %, pavilion 0.5·tan 40.8° = 43.2 %, + 3.5 % girdle = 61.5 %.

### Fancy cuts (retailer consensus, not grading standards)

| Cut | L:W | Depth % | Table % |
|---|---|---|---|
| Princess | 1.00–1.05 | 64–75 | 62–73 |
| Emerald | 1.30–1.50 (classic 1.40) | 61–68 | 61–69 |
| Asscher | 1.00–1.05 | 61–67 | 60–68 |
| Oval | 1.30–1.50 | 58–63 | 53–63 |
| Cushion | 1.00–1.20 | 61–69 | 58–65 |
| Pear | 1.50–1.75 | 58–64 | 53–63 |
| Marquise | 1.75–2.25 | 58–62 | 53–63 |
| Radiant | 1.00–1.05 or 1.20–1.50 | 61–67 | 61–69 |
| Heart | 0.90–1.10 | 56–62 | 53–63 |
| Baguette | 1.5–3.0 | 55–65 | step cut |
| Trillion | 1.00–1.10 | 32–48 | — |

[S] [Blue Nile](https://www.bluenile.com/blog/diamonds-jewelry/ideal-diamond-proportions), [Brilliant Earth](https://www.brilliantearth.com/guides/diamond-ratio/), [IGI fancy-shape guidelines](https://www.igi.org/assets/pdf/cut-grading/igi-fancy-shape-cut-guidelines.pdf); heart, baguette, trillion rows are [K].

### mm ↔ carat (diamond, SG 3.52)

`ct = L × W × depth × factor` (mm). For any other gem: `ct_gem = ct_diamond × SG_gem / 3.52`.

| Cut | Factor |
|---|---|
| Round | d² × depth × **0.0061** |
| Oval | 0.0062 |
| Princess / square | 0.0083 |
| Cushion | 0.00815 |
| Emerald (by L:W) | 1.0 → 0.0080; 1.5 → 0.0092; 2.0 → 0.0100; 2.5 → 0.0106 |
| Marquise (by L:W) | 1.5 → 0.00565; 2.0 → 0.00580; 2.5 → 0.00585; 3.0 → 0.00595 |
| Pear (by L:W) | 1.25 → 0.00615; 1.5 → 0.00600; 1.66 → 0.00590; 2.0 → 0.00575 |
| Heart / trillion | 0.0059 / 0.0057 |
| Radiant / baguette [K] | 0.0081 / 0.00915 |

Thick girdle or bulged pavilion adds up to ~10 %. [S] [Octonus](http://3dbook.octonus.com/dataeng/crypted/6_01.htm), [PriceScope GIA table](https://www.pricescope.com/community/threads/carat-weight-calc-from-measurements-various-shapes.54387/), [The Diamond Site](https://www.thediamondsite.com/diamond-weight-estimation-calculator/), [GoodCalculators](https://goodcalculators.com/diamond-weight-calculator/). JewelCraft's independent model (cone volume × 1.3056 × 3.53 g/cm³) gives 0.00603 for round [V] — within 1 %.

Round shortcut at 61 % depth: `ct ≈ 0.00372·d³` → 1.3 mm 0.008; 2.0 mm 0.03; 3.0 mm 0.10; 4.0 mm 0.24; 5.2 mm 0.52; 6.5 mm 1.02; 7.4 mm 1.51; 8.2 mm 2.05; 9.3 mm 2.99.

### Gem optical / density data

| Gem | SG | RI | Dispersion |
|---|---|---|---|
| Diamond (natural and lab) | 3.52 | 2.417 | 0.044 |
| Moissanite | 3.22 | 2.648–2.691 | 0.104 |
| Cubic zirconia | 5.6–6.0 | 2.15–2.18 | 0.058–0.066 |
| Sapphire / ruby | 4.00 | 1.762–1.770 | 0.018 |
| Emerald | 2.72 | 1.577–1.583 | 0.014 |
| Aquamarine / morganite | 2.72 / 2.80 | 1.57–1.59 | 0.014 |
| Spinel | 3.60 | 1.718 | 0.020 |
| Tanzanite | 3.35 | 1.691–1.700 | 0.021–0.030 |
| Topaz | 3.53 | 1.61–1.62 | 0.014 |
| Garnet (pyrope–almandine) | 3.8–4.2 | 1.74–1.79 | 0.022–0.027 |
| Peridot | 3.34 | 1.654–1.690 | 0.020 |
| Amethyst / citrine | 2.65 | 1.544–1.553 | 0.013 |
| Tourmaline | 3.06 | 1.624–1.644 | 0.017 |

[S] [Skyjems reference](https://skyjems.ca/blogs/the-curators-journal/gemstone-properties-the-collectors-interactive-reference) for diamond, moissanite, CZ, emerald, spinel; other rows [K]. JewelCraft ships slightly different working densities (corundum 4.1, beryl 2.76) [V].

### Metal densities (g/cm³)

| Alloy | Density | Alloy | Density |
|---|---|---|---|
| 24K gold | 19.32 | 10K yellow | 11.47–11.57 |
| 22K yellow | 17.86 | 10K white / rose | 10.99–11.07 / 11.52–11.59 |
| 18K yellow | 15.53–15.58 | 9K yellow | ≈ 11.1 (10.9–12.7) |
| 18K white (Ni / Pd) | 14.64–14.69 / 15.66 | Platinum 950 (Ru / Co) | 20.7 / 20.8 |
| 18K rose | 15.02–15.18 | Platinum 900 (Ir) | 21.54 |
| 14K yellow | 13.05–13.07 | Palladium 950 | 12.16 |
| 14K white (Ni / Pd) | 12.61 / 14.6 | Sterling 925 / fine silver | 10.36 / 10.49 |
| 14K rose | 13.03–13.26 | Titanium (Ti-6Al-4V / CP) | 4.43 / 4.51 |
| | | Brass / bronze | 8.4–8.75 / 8.8 |

[V] [JewelCraft `assets/weighting/Precious.json`](https://github.com/mrachinskiy/jewelcraft) (with compositions); [S] [Stuller specific-gravity chart](https://www.stuller.com/benchjeweler/resources/bencharticles/view/specific-gravity-melting-point-or-various-metals-and-alloys/), [LBMA](https://www.lbma.org.uk/wonders-of-gold/items/density-of-gold), [24carat](https://24carat.co.uk/densityofgoldandothermetals.html). White gold varies by 1 g/cm³ with recipe: **alloy records need composition, not just karat + colour.** Weight = volume × density; converting a casting between alloys = weight × ρ₂/ρ₁.

---

## 4. Geometry kernel (Nov 2026)

| Option | Version [V] | Kind | Licence | Assessment |
|---|---|---|---|---|
| **replicad** + replicad-opencascadejs | 1.2.1 (2026-11-06) | OCCT **8.0.1** B-rep, TS API | MIT + LGPL-2.1 wasm | 11 releases in 2026; 1.0.0 (Aug) moved to OCCT 8, native wasm exceptions, single + pthread builds ([PR #263](https://github.com/sgenoud/replicad/pull/263)). Essentially one maintainer. |
| opencascade.js (original) | 1.1.1 / 2.0.0-beta, **Mar 2023** | OCCT 7.x | LGPL | Stale. Successor is the `@taucad/opencascade.js` fork (3.0.0-beta.1) that replicad now builds from. |
| brepjs + occt-wasm | 20.28.3 / 5.18.2 | OCCT 8.0.1, arena handles, `fuseAll`/`cutAll`, worker, `brepjs-verify` for agents | Apache-2.0 + LGPL wasm | Promising but very young: 2,700 commits, major version 20, single author, largely AI-written by its own disclosure, Node ≥ 24. Watch; do not bet on it yet. [repo](https://github.com/andymai/brepjs) |
| Manifold (`manifold-3d`) | 3.5.5 | Mesh booleans, guaranteed manifold | Apache-2.0 | 0.18 MB brotli. No B-rep, STEP or fillets. Ideal second kernel. [repo](https://github.com/elalish/manifold) |
| CadQuery / build123d | 2.8.0 / 0.13.0 (OCP 8.0.1.1.0) | Same OCCT, native, Python | Apache-2.0 | Native speed and threads, but a Python runtime in a Tauri app and a second language. Server-only fallback. |
| Zoo / KCL | `@kittycad/lib` 4.5.39 | Proprietary GPU engine | App MIT; engine closed | 3D view is "a video stream from our hosted geometry engine" ([README](https://github.com/KittyCAD/modeling-app)). Hosted and metered ([pricing](https://zoo.dev/pricing)); unusable as the kernel of an offline open-source app. |
| truck / Fornjot / brepkit | — / — / 4.11.43 | Rust B-rep | Apache / — / **AGPL** | truck: booleans, thin fillet and STEP coverage ([repo](https://github.com/ricosjp/truck)). brepkit is fast (1.3–30× OCCT on simple booleans in brepjs's benchmarks) but beta and AGPL since 3.0. |
| JSCAD | 2.13.0 | Mesh CSG | MIT | No B-rep; superseded by Manifold for our use. |
| Chili3D | app | OCCT 8.0.1 wasm CAD app | **AGPL-3.0** | A reference UI with an AI assistant, not a library. [repo](https://github.com/xiangechen/chili3d) |

**Verdict: keep OCCT via replicad, add Manifold as a second kernel, and put both behind our own `GeometryKernel` interface** so the OCCT binding can be swapped (occt-wasm/brepjs) without touching features. Only OCCT gives fillets, lofts, sweeps and STEP in a TS-only stack. OCCT 8.0.1 itself reports 17–20 % faster booleans, native and wasm ([release notes](https://github.com/Open-Cascade-SAS/OCCT/discussions/1415)).

### Measured for this doc [V]

Node 22, single thread, replicad 1.2.1; ring band with two-cylinder gem-seat cutters.

| Case | Result |
|---|---|
| Kernel init (wasm from disk) | 0.27 s OCCT; 0.02 s Manifold |
| Wasm download (raw / gzip / brotli) | replicad 22.9 / 7.3 / 5.7 MB; occt-wasm 21.4 / 6.9 / 5.4; Manifold 0.54 / 0.21 / 0.18; rhino3dm 2.7 / 1.0 / 0.9 |
| 108 cutters, cut one by one | 15.7 s |
| 108 cutters, one cut with a compound tool | **2.4 s** (6.5× faster); mesh 1.6 s (81k tris); STEP 0.2 s, 2.4 MB |
| 320 cutters, compound cut | 7.0 s; mesh 6.0 s; STEP 7.1 MB; RSS 678 MB |
| Same 108 / 320 in Manifold (build + cut) | 1.0 s / 2.8 s |
| 100 **overlapping** cutters in one compound | **returned an empty solid (volume 0), no error**; sequential took 46.9 s; a later fillet threw a raw `WebAssembly.Exception` |

### Pitfalls and mitigations

- **Many cutters.** Never loop `cut`. Build one compound of tools and cut once. OCCT requires arguments not to self-interfere ([boolean spec](https://github.com/Open-Cascade-SAS/OCCT/blob/master/dox/specification/boolean_operations/boolean_operations.md)), so overlapping cutters must be fused or separated first; assert volume decreased after every boolean. replicad does not expose `SetRunParallel`/`SetFuzzyValue`/`SetUseOBB`; call them on raw `oc.BRepAlgoAPI_Cut` if needed. Same advice on the [OCCT forum](https://dev.opencascade.org/content/what-best-approach-cutting-out-many-objects-one).
- **Interactivity.** Do not run B-rep booleans per edit. Preview = uncut metal mesh + instanced gems (or Manifold subtraction); bake B-rep cutters on commit/export, in a worker, cached by feature hash.
- **Memory.** The JS GC cannot see the wasm heap. Wrap every feature build in replicad's `localGC`/`GCWithScope`, delete builders, and recycle the worker after N builds or on OOM (the heap never shrinks).
- **Errors.** OCCT failures surface as opaque `WebAssembly.Exception`; wrap each feature, return a typed error naming the feature, and validate (`BRepCheck`, volume, solid count).
- **Fillets** are the least robust operation. Apply them to profiles before sweep/revolve where possible; make late fillets optional with a fallback.
- **Node/Tauri.** In Node pass `wasmBinary` (or `locateFile`) explicitly; STEP writing prints statistics to stdout. The pthread build needs `SharedArrayBuffer` (COOP/COEP headers) and all builds need wasm exceptions + SIMD, which older WebKitGTK may lack — keep a Node-sidecar path for the same kernel code.
- **Licence.** LGPL is satisfied by shipping the `.wasm` as a separate replaceable file.

**Gems.** One analytic generator per cut emits (a) the render mesh and (b) on demand a planar-face B-rep solid for STEP. Seat cutters are *not* gem meshes: they are simple revolved/extruded B-rep solids parameterised from the gem.

---

## 5. Interop

`rhino3dm` 8.35.0 (MIT, published today) — checked against its `.d.ts` and a write/read round-trip [V]:

| Can write | Cannot |
|---|---|
| Meshes; points, lines, arcs, NURBS curves; NURBS surfaces (control-point API); extrusions; layers (nested), materials incl. PBR, groups, instance definitions (blocks); per-object and document user strings; units and tolerances | Assemble a general trimmed multi-face Brep (only `createFromBox/Cylinder/Sphere/Cone/RevSurface/Surface/TrimmedPlane/Mesh`); join, trim, boolean; mesh a Brep; construct SubD geometry (no add-vertex/face API — see [forum](https://discourse.mcneel.com/t/is-it-possible-to-add-a-subd-object-to-a-file3dmobjecttable/111156)); read STEP |

So `.3dm` from JS is a **mesh + curves + metadata container**, not a B-rep hand-off. True B-rep into Rhino/MatrixGold/3Design goes via **STEP AP214** (colours, names, layers); AP242 only if a recipient asks [K]. Stuller's CAD/CAM service lists 3DM NURBS as its preferred file type and also takes STL [S] ([standards](http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf), [FAQ](https://www.stuller.com/cadcam-services)). `.jcd` is proprietary; skip.

| Format | Content | Audience | Tier |
|---|---|---|---|
| STL (binary, mm) | Watertight metal only, one file per metal part; gems excluded | Casters, resin/wax printers | T |
| 3MF | Same + units, colours, parts | Modern slicers | T |
| STEP AP214 | Metal B-rep + gems as named solids | Rhino, MatrixGold, 3Design, factories | T |
| GLB | Metal + gems, PBR, instanced | Web render, AR, sharing | T |
| 3DM | Meshes, construction curves, layers (Metal/Gems/Cutters), user strings (cut, ct, alloy) | Rhino users as reference | T (cheap) |
| OBJ | Mesh | ZBrush / Blender | L |
| USDZ | Render scene | Apple AR | L |

Mesh for manufacture: chord tolerance ≤ 0.005–0.01 mm; validate watertightness with Manifold before export.

---

## 6. AI → CAD, state of the art

- **Research.** Emitting CAD *code* beats bespoke command-sequence tokens: [Text-to-CadQuery](https://arxiv.org/abs/2505.06507) (~170k pairs; larger models give more executable, more accurate code; reported 69.3 % top-1 exact match, −48.6 % Chamfer distance [K]) and [CAD-Recode](https://arxiv.org/abs/2412.14042) (point cloud → CadQuery, ICCV 2025). But one-shot output is unreliable; **closed-loop verification is what works**: [CADSmith](https://arxiv.org/pdf/2603.26512) cuts Chamfer distance 28.37 → 0.74 using programmatic checks (bbox, face count, volume); [CADTestBench](https://arxiv.org/html/2605.07807v1) uses executable geometric tests as feedback; VLM-only critique ([CADCodeVerify](https://openreview.net/pdf?id=BLWaTeucYX), ICLR 2025) gives single-digit-percent gains. [Text2CAD-Bench](https://arxiv.org/html/2605.18430v1) and [P3D-Bench](https://arxiv.org/pdf/2606.11152) show spatial reasoning remains the weak point.
- **Products.** Zoo Text-to-CAD / Zookeeper agent emits editable KCL but is hosted ([API](https://zoo.dev/docs/developer-tools/api/ml), [Zookeeper](https://www.digitalengineering247.com/article/zoo-introduces-zookeeper-agent-for-cad-design/products)). brepjs and Chili3D ship agent-facing tooling.
- **Jewelry-specific.** Most AI tools output an uneditable STL mesh; the differentiator vendors advertise is per-part, named, mm-scaled 3DM ([comparison](https://www.rubykinglet.ai/insights/ai-jewelry-cad-2026-manufacturable) — vendor-authored, [FormaNova](https://formanova.ai/), [The Goldsmith AI](https://thegoldsmith.ai/)). None is independently verified as casting-ready. The incumbent pattern (CounterSketch, MatrixGold builders) is parametric templates.

### Recommendation: (c) hybrid, schema-first

1. **Default: the LLM emits a typed feature tree** (JSON, schema-validated, mm, stable IDs) over Pavé's own feature library (`shank`, `head.prong`, `array.pave`, `bail`…). Deterministic TS builds the geometry. Reasons: jewelry is highly templated; every rule in §2 is checkable in code; edits become small JSON patches; the same spec drives preview, weight and export; no code execution to sandbox.
2. **Escape hatch: a `custom` feature node** holding a sandboxed replicad snippet with declared parameters, for motifs the library cannot express. Never a free-form script for the whole piece.
3. **Images → parameters.** A VLM extracts *categorical* attributes (piece type, setting style, cut, stone count, shank style, metal colour) and *ratios* (stone Ø : band width), each with confidence. Absolute scale comes only from user-confirmed anchors (ring size, center-stone mm or ct). Show the result as editable fields before building.
4. **Verify in layers.** Schema → kernel validity (closed solid, volume > 0) → DFM rules (wall, prong Ø, spacing, culet clearance) → report (weight, stone count) → multi-view render critiqued by a VLM against the brief/reference, producing a bounded (≤ 3) param-patch loop → human approval. Deterministic checks gate; the VLM only advises.

---

## Decisions for Pavé

- **Kernel:** OCCT 8.0.1 through replicad 1.2.x in a WebWorker (and the same module in Node), wrapped by our own `GeometryKernel` interface. Re-evaluate occt-wasm/brepjs in six months.
- **Second kernel:** Manifold for preview booleans, watertightness and min-wall checks, and STL/3MF output.
- **Booleans:** one compound cut per body, no overlapping tools, assert volume after each; never boolean during drag.
- **Gems:** analytic polyhedra; mesh for render, planar B-rep only for STEP; cutters are separate parametric solids.
- **Canonical units and sizes:** mm everywhere; ring size stored as inner circumference; carat derived from mm via the factor table and SG.
- **Rules live in data:** a `ManufacturerProfile` (defaults from §2, Stuller-like) and an `Alloy` table with composition and density; nothing hard-coded in features.
- **Export matrix:** STL + 3MF (make), STEP AP214 (CAD hand-off), GLB (view), 3DM (meshes + metadata). Do not promise NURBS/SubD 3DM.
- **AI contract:** schema-validated feature tree first, sandboxed code node as an escape hatch, deterministic DFM gate, VLM critique as advice, user confirms scale anchors.
- **v1 scope:** solitaire/halo/three-stone rings, bands and eternity, studs, simple pendants; pavé on flat and cylindrical surfaces only.

## Verification gaps

Web search quota ran out and most non-GitHub hosts were unreachable from this session, so: Stuller's standards PDF, the Formlabs jewelry design guide, GIA Facetware tables and Wikipedia were read only through search summaries; **[K]** items (3Design/JewelCAD/Firestorm/CounterSketch/ZBrush feature notes, platinum-specific minimums, STEP AP support in Rhino, several fancy-cut and gem-optics rows, two paper metrics) were not re-verified. Hosts to allow for a follow-up pass: `assets.stullercloud.com`, `media.formlabs.com`, `www.gia.edu`, `en.wikipedia.org`, `mcneel.github.io`, `arxiv.org`.
