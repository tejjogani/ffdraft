# 06 — Freeform: "anything can become jewelry"

Research date: 2026-11-23. Scope: the non-parametric path (photo / logo / text / mesh → manufacturable, iced-out piece). Package versions were checked with `npm view` / PyPI on this date.

**How to read the evidence.** Claims with a link were confirmed this session from the linked page or a search summary of it. `[K]` marks trade or algorithm knowledge that could not be re-checked (the session's search budget ran out, and vendor sites, fal.ai and Hugging Face were not directly fetchable). `[D]` marks numbers derived here by arithmetic. API prices come from search snippets and resellers; re-check before budgeting.

## 1. Style landscape and what each needs from CAD

| Style | Typical pieces | What CAD must provide |
|---|---|---|
| Bridal / wedding | bands, solitaires, halos | parametric B-rep, exact sizes, head/prong libraries (covered in the parametric doc) |
| Fine / fashion | pendants, earrings, stacking rings | parametric + light freeform, row pavé on curves |
| Hip-hop / "iced out" | logo, letter, name, character and photo pendants; Cuban, tennis and rope chains; grillz; championship rings; bezels | mesh or relief body from artwork, **area pavé on arbitrary surfaces**, baguette borders, two-tone and enamel regions, bail sized to the chain, hollow back, stone map |
| Signet / heraldic | crest rings, coins, medallions | image → bas-relief or intaglio on a parametric blank |
| Organic / sculptural | one-offs, nature forms | sculpt/SubD, mesh import, wall-thickness checks |
| Religious / charm | crosses, saints, zodiac | relief + extruded outline, large bails |
| Men's | heavy bands, ID bracelets, dog tags | extrusion, engraving, chain generators |

### How custom hip-hop pendants are made today

1. **Artwork to CAD.** The customer sends a logo, sketch or photo; a CAD artist builds the model and returns renders, a stone map (count and sizes) and an estimated metal weight ([IceCartel](https://icecartel.com/blogs/news/how-to-make-a-custom-pendant), [VVS Jewelry](https://www.vvsjewelry.com/blogs/bling-bling/custom-jewelry-design-online), [MicroCAD](https://microcad.net/hip-hop-jewelry/)). Flat logo and letter work is done in Rhino/MatrixGold; characters and faces are sculpted in ZBrush, and jewelers still go back to Rhino for pavé layout ([ZBrushCentral](https://www.zbrushcentral.com/t/zbrush-jewelry/214494), [Maxon](https://www.maxon.net/en/zbrush-jewelry)).
2. **Print and cast.** The file is printed in castable wax or resin and lost-wax cast ([AllHipHop](https://allhiphop.com/?p=6125558)).
3. **Set and finish.** Stones are hand-set after casting, mostly prong or shared-bead pavé in tight "honeycomb" groupings, then polished and plated ([AllHipHop](https://allhiphop.com/?p=6125558), [Digital Jewelry](https://digitaljewelry.com/custom-hip-hop-jewelry)). Lead time is 2–4 weeks.

| Parameter | Typical value | Source |
|---|---|---|
| Pendant height | micro 1–1.5 in; mid ≈2–3 in; standard 3–4 in; XL 4 in+ | [IF & Co.](https://www.ifandco.com/pages/pendant-sizes) |
| Body thickness | 2.5–4 mm (≤2 in), 4–8 mm (3 in+); layered pieces up to ≈15 mm | `[K]`; one [15 mm listing](https://icecartel.com/blogs/news/tkandz-x-icecartel-collab) |
| Back | flat, or hollowed ("scooped", sometimes honeycomb-pierced) to save weight | search-summarised listings |
| Weight examples | 14k initial pendant ≈25 g with 4 ct; a 2¾ in 14k custom at 85 g | [Avianne](https://www.avianneandco.com/collections/pendants-2024?page=20), marketplace listings |
| Melee sizes | 0.8–2.5 mm rounds; ≈1.0–1.7 mm does most of the fill; baguette borders | `[K]`; RhinoArtisan's default is 1.3 mm ([API](https://rhinoartisan.com/docs/scripting/reference/gemsets/pave-on-surface/)) |
| Stone count | ≈51 stones/cm² at 1.3 mm with 0.2 mm gap (≈0.42 ct/cm²); a 2 in piece ≈300–600 stones, a 3 in piece ≈800–1,500. Celebrity pieces exceed 8,000. | `[D]`; [IceCartel](https://icecartel.com/blogs/news/rich-the-kid-150k-fully-custom-icecartel-rich-forever-pendant) |
| Carat per stone | 0.8 mm ≈0.0025 ct; 1.3 ≈0.01; 2.0 ≈0.03; 2.5 ≈0.05–0.06; 3.0 ≈0.10. Fallback ct ≈ 0.0037·d³ (under-reads below 1.3 mm) | [Walts](https://waltsjewelers.com/diamond-chart.html), [Stuller chart](https://blog.stuller.com/wp-content/uploads/2025/05/MM-CT-Chart.pdf), `[D]` |
| Price drivers | metal grams × karat; stone type (natural VVS > lab > moissanite > CZ) × total ct; stone count (setting labour); CAD hours; two-tone, enamel; chain | e.g. 14k + 4 ctw diamond ≈$6.6k vs 14k + CZ ≈$1.6k vs silver + moissanite $100–350 (search-summarised listings) |

## 2. Image/text → 3D models (November 2026)

Public rankings are mostly vendor-affiliated and contradict each other ([six-model test](https://sorceress.games/blog/rank-the-best-image-to-3d-model-ai-six-model-test), [API roundup](https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026)). Run our own bake-off on jewelry-like inputs before fixing the default.

| Model | Access and licence | Input | Geometry notes | Price / latency |
|---|---|---|---|---|
| **Hunyuan3D 3.x** (3.0 Sep 2025; 3.1 Pro/Rapid on fal; 3.5 seen at resellers) | API only ([Notebookcheck](https://www.notebookcheck.net/Tencent-s-new-Hunyuan-3D-3-0-brings-realistic-AI-model-generation-to-developers-and-creators.1116964.0.html)) | image, text, multi-view (v3.1 adds top/bottom/diagonal views, [fal](https://fal.ai/hunyuan-3d)) | custom face count; PBR optional | v3.1 Rapid $0.225, +$0.15 PBR; v3 multi-view +$0.15 ([fal](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d)) |
| **Hunyuan3D 2.1 / Omni / Part** | open weights, Tencent community licence: commercial use allowed, **not licensed in EU, UK, South Korea**, <1M MAU, outputs may not train other models ([LICENSE](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE)) | image; Omni adds point/voxel/bbox control ([paper](https://arxiv.org/abs/2509.21245v1)) | shape 10 GB VRAM, 29 GB with texture ([repo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)); SDF iso-surface, so closed by construction `[K]` | self-host; v2 on fal $0.16 |
| **TRELLIS.2-4B** (Dec 2025) | open, **MIT** code and weights; nvdiffrast/nvdiffrec dependencies carry NVIDIA licences ([repo](https://github.com/microsoft/TRELLIS.2), [CGWorld](https://cgworld.jp/flashnews/01-202601-TRELLIS2.html)) | single image | 512³/1024³/1536³ in ≈3/17/60 s on H100, ≥24 GB; O-Voxel allows open and non-manifold output, small holes possible — **always repair** | self-host; ≈$0.08–0.15 at resellers |
| **Tripo H3.1 / P1.0 / P2.0** | API. H3.1 (spring 2026) is the fidelity model; P2.0 (Sep 2026) gives native quads, ≤50k tris or 25k quads ([H3.1](https://news.marketersmedia.com/tripo-ai-introduces-h31-to-advance-high-fidelity-ai-3d-generation-for-production/89189311), [P2.0](https://www.webull.com/news/15619871280677888)) | image, multi-view, text | H3.1 exposes geometry quality, face limit, quad flag | H3.1 ≈$0.20; P2 ≈$1.00 ([WaveSpeed](https://wavespeed.ai/collections/tripo3d)) |
| TripoSG (open) | **MIT**, 1.5B, ≥8 GB ([repo](https://github.com/VAST-AI-Research/TripoSG)) | single image | geometry only; base of PartCrafter | self-host |
| **Meshy 6 / 7 / 7.1** | API. Meshy 7 Aug 2026; 7.1 adds Ultra 4K (4096³, single view only) ([VoxelMatters](https://www.voxelmatters.com/meshy-7-1-raises-geometric-detail-with-a-new-ultra-4k-mode/)) | image, multi-image, text | print tools in the API: printability check (free), repair, auto-split, **relief** ([pricing](https://docs.meshy.ai/api/pricing)). 4K adds little for printing ([All3DP](https://all3dp.com/1/we-tested-meshy-7-1-does-the-new-ultra-4k-really-improve-3d-prints/)) | 20 credits mesh-only. Model ids retire fast ([changelog](https://docs.meshy.ai/api/changelog)) — pin and monitor |
| **Rodin Gen-2 / 2.5** (Hyper3D) | API | up to 5 images, text ([Runware](https://runware.ai/docs/models/hyper3d-rodin-gen-2/schema.json)) | quad or raw mesh; premium tier | $0.40; Extreme-High $0.80; HighPack +$0.80 ([fal](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt)) |
| Stability SF3D / SPAR3D | open; free under $1M revenue ([licence](https://stability.ai/license)) | single image | fast, low-poly, 7–10.5 GB ([repo](https://github.com/Stability-AI/stable-point-aware-3d)); draft preview only | self-host |
| Direct3D-S2, Hi3DGen | open, **MIT** ([D3D-S2](https://github.com/DreamTechAI/Direct3D-S2), [Hi3DGen](https://github.com/Stable-X/Hi3DGen)) | single image | geometry-only, 1024³ SDF, ≈24 GB; sharp detail | self-host |
| Sparc3D | paper; watertight 1024³ ([arXiv](https://arxiv.org/html/2505.14521v3)); weights unconfirmed | — | — | — |
| SAM 3D Objects (Meta) | open, SAM licence ([repo](https://github.com/facebookresearch/sam-3d-objects)) | image + mask | lifts one masked object out of a cluttered photo | on fal |

CSM and Luma were not re-verified this session and are not in the shortlist.

**Part-aware options** (to assign metal, enamel and stone regions):

- [P3-SAM + X-Part](https://github.com/Tencent-Hunyuan/Hunyuan3D-Part): mesh → part masks and boxes → completed parts. Tencent licence; only a "light" X-Part is public.
- [PartCrafter](https://github.com/wgsxm/PartCrafter): MIT, image → up to 16 part meshes, ≥8 GB.
- [HoloPart](https://github.com/VAST-AI-Research/HoloPart): MIT, completes parts of an already-segmented mesh.
- [OmniPart](https://github.com/HKU-MMLab/OmniPart): MIT, image + 2D part mask → parts.

Jewelry regions are surface patches, not volumetric parts. The robust default is therefore 2D: cluster the generated albedo, back-project SAM masks from rendered views to face labels, then let the user fix it with a brush. 3D part models are an optional server-side enhancement.

**Recommendation.** One fal adapter (`FAL_KEY`) reaches Hunyuan 3.1, Tripo H3.1 and Rodin 2.5.

- Default: Hunyuan3D v3.1 (multi-view, cheap). Request albedo too — it drives region proposals.
- Fallback: Tripo H3.1.
- Premium retry: Rodin 2.5.
- Open-source / offline: TRELLIS.2-4B (MIT). Gate Hunyuan open weights by territory.

Never trust provider watertightness; every result goes through §4.

## 3. Other on-ramps

| On-ramp | Algorithm | Libraries (checked version, licence) |
|---|---|---|
| **(a) Vector / logo / text → 2.5D** | Outline → offset to enforce minimum stroke → extrude. Bevel and "puffy" via an inside distance transform with a height profile (circular arc, or a membrane/Poisson solve), meshed as heightfield + walls + flat back. Cursive name pendants: shape the text, union the glyphs, add the bail. | `opentype.js` 2.0.0, `fontkit` 3.0.0, `harfbuzzjs` 1.6.4 (MIT); three `SVGLoader`; `svg-path-commander` 2.3.5; `manifold-3d` 3.5.5 `CrossSection.offset/extrude` (Clipper2 inside, Apache-2.0); `clipper2-wasm` 0.4.0. Tracing: **[`@visioncortex/vtracer`](https://github.com/visioncortex/vtracer)** 1.0.0-alpha.4 (MIT/Apache, WASM, colour-aware — colour layers become enamel/metal regions). Avoid `potrace` and `esm-potrace-wasm` (GPL-2.0). `straight-skeleton` 3.0.0 is labelled MIT but wraps CGAL — check before use. three `ExtrudeGeometry` bevels are not guaranteed manifold; use for preview only. |
| **(b) Image → relief** | Depth estimate → subject mask → gradient-domain compression and Poisson integration ([Ji et al.](https://arxiv.org/abs/1804.06092)) → heightfield on a blank. Alternative that hides back-side hallucination: generate full 3D, render orthographic depth from the chosen view, compress to relief — the same idea as MakerLab's "3D to Relief Sculpture" ([Bambu](https://blog.bambulab.com/new-launch-of-makerlab-experiments)). | [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3): DA3-SMALL/BASE and DA3MONO-LARGE are Apache-2.0; LARGE/GIANT are CC BY-NC. In browser: `@huggingface/transformers` 4.3.2 / `onnxruntime-web` 1.31.1 with a small depth model `[K]`; `@imgly/background-removal` 1.7.0. Meshy sells relief as an API call. |
| **(c) Mesh import / scan** | Load → weld → repair → §4. | three STL/OBJ/GLTF/3MF/PLY loaders (three 0.187.0); `@gltf-transform/functions` 4.5.1; `meshoptimizer` 1.3.0 |
| **(d) SubD / sculpt-lite** | Six brushes (move, inflate, smooth, flatten, crease, pinch) on a BVH; Catmull-Clark preview of quad cages. | `three-mesh-bvh` 0.9.18; Manifold `smoothOut/refine`; `@nasedkinpv/opensubdiv-wasm` 0.3.0; `three-subdivide` 1.1.5 |

## 4. Mesh → manufacturable body

| Stage | Method and rule | Tooling | Runs |
|---|---|---|---|
| Repair to closed manifold | Weld; if still open or self-intersecting, re-surface via signed distance (winding-number sign) + iso-extraction at 0.05–0.1 mm | [Manifold](https://github.com/elalish/manifold) rejects non-manifold input, so repair first. Server: `trimesh` 5.2.2 (MIT), `libigl` 2.6.3 (MPL-2), `open3d` 0.20.0 (MIT), OpenVDB via conda `[K]`. Licence traps: `pymeshlab` GPL-3, `pymeshfix` now **AGPL**, [MeshLib](https://github.com/MeshInspector/MeshLib) needs a commercial licence, CGAL is GPL/commercial. `meshfix-wasm` 0.6.1 (MIT) is worth a client-side trial. | server; light weld in browser |
| Remesh / decimate / smooth | Isotropic remesh to 0.15–0.3 mm edges; Taubin smoothing; cap ≈300–500k tris | `meshoptimizer`, `fast-simplification` 0.2.0, `gpytoolbox` 0.3.8, libigl | server; decimate in browser |
| Orient and **scale** | PCA + front-view guess (VLM confirms); scale so bounding height equals the target (1–4 in) | TS | browser |
| Flat back / relief depth | Plane trim, or Z-compress behind the silhouette | Manifold `trimByPlane` | browser |
| Shell / scoop the back | Inward SDF offset by wall *t*, subtract from the back only, keep a rim; add drain openings | SDF offset on server (OpenVDB/libigl). In browser, Manifold `levelSet` with a BVH SDF is too slow at 0.15 mm `[D]`; use WebGPU SDF ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)) later | server |
| Bail / jump ring | Parametric bail unioned at the top, directly above the centre of mass so the piece hangs straight | replicad 1.2.1 → Manifold union | browser |
| Analysis | Wall thickness (inward ray / SDF), minimum feature, trapped volume, weight = volume × density | BVH rays in a worker | browser |
| Hand-off to Rhino / MatrixGold | Quad remesh → SubD-ready OBJ; user runs `ToSubD` → `ToNURBS` `[K]`. Also write `.3dm` with gems, cutters and bail as separate named objects | [QuadriFlow](https://github.com/hjwdzh/QuadriFlow) (MIT), Instant Meshes (`pynanoinstantmeshes`, BSD), [QuadWild](https://github.com/nicopietroni/quadwild) / [Bi-MDF](https://github.com/cgg-bern/quadwild-bimdf) (GPL-3, best feature lines; run as a separate CLI); `rhino3dm` 8.35.0 (MIT) | server |

No open-source tool turns a sculpted mesh into clean trimmed NURBS automatically. We promise SubD-ready quads plus parametric side objects, not NURBS.

**Manufacturing rules**

| Rule | Value | Source |
|---|---|---|
| Structural / hollowed wall | ≥0.8 mm gold; ≥0.6 mm silver | [Stuller](https://cdn.hackaday.io/files/1657037089437152/CADCAMProductionStandards.pdf), [Materialise gold](https://i.materialise.com/materials/gold/design-guide), [silver](https://i.materialise.com/materials/silver/design-guide) |
| Minimum detail | 0.35 mm wide, 0.4 mm high; gaps ≥0.3 mm | Materialise |
| Raised or recessed lettering | ≥0.3 mm, with filleted edges | Stuller |
| Hollow prints | shell anything thicker than 3 mm; 0.7 mm pattern wall; drain holes ≥1.5 mm | [Formlabs](https://formlabs.com/white-papers/introduction-to-casting-for-3d-printed-jewelry-patterns/), Materialise |
| File hand-off | casters accept STL; Stuller prefers un-joined `.3dm` | Stuller |

## 5. Automatic pavé on an arbitrary surface

**How others do it**

- **RhinoArtisan Automatic Pavé** accepts surface, polysurface, **mesh** or SubD. The user picks a start point; it places the border first, then fills inward at the preset spacing. Parameters: gem diameter, prong diameter, distance to border, variable size, fill mode, prongs, cutters ([docs](https://docs.rhinoartisan.com/commands/diamonds/pave/automatic-pave), [API](https://rhinoartisan.com/docs/scripting/reference/gemsets/pave-on-surface/)). Its guidance is **≥0.25 mm between stones so prongs stay ≥0.45 mm** ([blog](https://rhinoartisan.com/blog/master-secrets-for-a-perfect-pave/)).
- **Matrix / MatrixGold** has Gem on Surface and an Auto Pavé builder ([course](https://www.cadjewelleryskills.com/lesson/matrix-9-essentials-20-pave-tools-gem-on-surface/)); parameters were not verified. Carveco/ArtCAM's Pavé Wizard has a Honeycomb mode with a gap or bead-size input ([Carveco](https://knowledge.carveco.com/portal/en/kb/articles/creating-pav%C3%A9-gem-settings)).
- **UV-based tools** fail on meshes, which have no untrimmed UV domain ([McNeel](https://discourse.mcneel.com/t/gem-on-mesh-help/113301)).
- **ZBrush** has no pavé tool: IMM stone brushes, or NanoMesh instancing that follows quad topology. **JewelCraft** 3.0.0 (GPL-3, Blender ≥4.5) offers gems, prongs, cutters, a spacing overlay and a gem map, but no surface auto-fill ([repo](https://github.com/mrachinskiy/jewelcraft)). Nomad Sculpt users are asking for auto-pavé ([forum](https://forum.nomadsculpt.com/t/auto-pave-for-jewelry-cad-design/16304)). 3Design, Panther and CounterSketch were not verified.
- **Research.** Circle packing on meshes ([Pottmann et al. 2009](https://www.geometrie.tuwien.ac.at/ig/pottmann/oldpub/2009/packing09/paper_docs/packing.pdf)) derives radii from the mesh; controlling a prescribed radius set is the hard part ([McNeel thread](https://discourse.mcneel.com/t/compact-circle-packing-on-complex-surface/123707)). Building blocks `[K]`: [sample-elimination Poisson disks](http://www.cemyuksel.com/research/sampleelimination/), Lloyd/CVT relaxation, [heat-method geodesics](https://github.com/nmwsharp/potpourri3d).
- **Setting facts.** Honeycomb pavé puts each stone at a hexagon centre with six equidistant neighbours ([Skyjems](https://skyjems.ca/pages/encyclopedia-honeycomb-pave)). Beads are 0.4–0.5 mm and must not touch; pin-point prongs ≥0.45 mm; ≥0.4 mm wall beside melee ([Stuller](https://cdn.hackaday.io/files/1657037089437152/CADCAMProductionStandards.pdf)). Allow ≈0.5 mm beyond the stone for a bright cut ([Ganoksin](https://ganoksin.com/article/step-step-guide-single-row-pave-settings)).

**Proposed algorithm: `paveSurface`** (TypeScript worker, BVH queries; port hot loops to Rust/WASM if needed)

Inputs: closed mesh in mm; region mask; stock diameters `S` (default 0.8–3.0 mm; ≤0.1 mm steps to 2.0, then 0.25); gap `g` (0.20 default, 0.15–0.30); edge margin `e` (0.35); bead diameter (0.45); style (`honeycomb` | `random` | `rows`); grading (`uniform` | `fit` | `gradient`).

1. **Fields**, O(V log V). Compute smoothed normals, maximum curvature κ, distance to region boundary `Db` (multi-source Dijkstra or heat method), and local thickness `T` (inward ray). The allowed diameter is `dmax(x) = min(2·(Db − e), (T − 0.4)/0.65, 1/(3κ) convex, 1/(5κ) concave)`. Creases sharper than 30° become region boundaries.
2. **Seed.** Place a border row on the iso-line `Db = e + d/2` at pitch `d + g`. Fill the interior with an advancing front: each new stone is tangent to two placed stones, which yields a hex lattice aligned to the border or a direction field. `random` style uses variable-radius sample elimination over ≈8× candidates, O(N log N). Neighbour tests use Euclidean distance plus a normal-agreement check (`n_i·n_j > 0.5`). This is a valid geodesic proxy because radii are far smaller than features, and it rejects stones on the opposite side of thin parts.
3. **Relax**, 20–50 iterations, O(N·k) each with a hash grid. Treat each stone as a disk of radius `r + g/2`. Push overlapping pairs apart, apply a Lloyd-style pull toward the local void centroid, project back with BVH closest-point, clamp to `Db ≥ e + r`.
4. **Size.** Grow each stone to the largest stock size that satisfies the gap and `dmax`; shrink or delete violators; fill voids with the smallest sizes; relax five more iterations. `gradient` biases sizes larger at the centre and smaller at the edges.
5. **Orient and seat.** Axis = normal averaged over the stone footprint; table flush to +0.1·d proud; girdle sunk accordingly.
6. **Beads.** Build a local Delaunay graph of centres. Every triangle of mutually adjacent stones receives one shared bead at the point equidistant from the three girdles (six per interior stone in honeycomb). Border stones get extra beads.
7. **Display.** One `InstancedMesh` per cut (unit gem scaled per instance) plus instanced seat decals. No booleans during interaction.
8. **Export.** Build cutters as revolved profiles (girdle cylinder, pavilion cone, through-hole ≈0.55·d, optional azure taper). Then `body − Manifold.union(cutters)` and `∪ beads`, in two batch calls. With 5,000 cutters at ≈100 triangles each `[D]`, expect seconds in WASM — benchmark it.
9. **Report.** Count and carat per size, total carat weight, metal removed, setting-labour count, stone-map SVG/CSV.

Edits re-run steps 3–4 only inside the brush radius, with the remaining stones locked.

**Failure modes**

| Case | Handling |
|---|---|
| High convex curvature (stones fan apart) or concave (tables collide) | κ caps on size; drop stones; warn |
| Thin strokes narrower than `dmin + 2e` | switch to a single row along the medial axis |
| Thin plate | cap size, or blind seats without through-holes |
| Noisy AI surface | pack on the remeshed, smoothed body; average normals over the footprint |
| Islands smaller than one stone | leave polished |
| Seats breaking into the hollow back | run the thickness test after shelling |

## 6. Chains and hip-hop staples as generators

| Item | Parameters | Count rule `[D]` |
|---|---|---|
| Cuban / Miami (curb) | face width W (full-size 5–8.5 mm and up, [GLD](https://gld.com/blogs/news/micro-cuban-link-chain-or-full-size)); wire ≈0.28–0.32·W; link length ≈1.35·W; per-link twist; flat-cut depth; optional pavé on faces | pitch ≈ L − 2·wire; links = length / pitch (10 mm × 20 in ≈ 65–70) |
| Tennis | stone 2–7 mm ([1stDibs](https://www.1stdibs.com/answers/what-is-a-good-size-for-a-tennis-necklace)); 3- or 4-prong, buttercup or bezel cup | pitch ≈ stone + 0.3–0.6 mm; 4 mm × 20 in ≈ 115 stones |
| Rope | wire, link diameter, strands, links per turn | helix-instanced |
| Figaro | curb with a [1 long, 3 short] pattern | pattern pitch |
| Franco | V-shaped links, 2 or 4 strands, width | — |
| Box | side, wall | pitch ≈ side |
| Bail | fixed loop, tube / rabbit-ear, hinged; opening ≥ chain width + 1.5 mm and clears the clasp; wall ≥1.0 mm; optional pavé | — |
| Championship ring | top plate with logo, lettered bezel ring, two relief shoulders, shank size | parametric shank + relief panels + pavé layers |
| Grillz | require a dental scan or impression; shell offset over teeth | later |

CAD tools model chains as one link arrayed along a curve with alternating roll (Rhino `ArrayCrv`/`Flow`, builder commands in jewelry plug-ins `[K]`). We do the same: one parametric link, instanced along a catenary. Most chains are bought, not cast, so they are a visual and quote item (type, width, length, grams per inch). Tennis chains and custom links get real geometry.

## 7. Accessible UX: trophy photo → iced-out pendant

**Reference points.** MakerWorld MakerLab offers image-to-keychain, a relief maker, 3D-to-relief and a Meshy image-to-3D tile, and in October 2026 bundled several generators as "Aimia" ([Bambu](https://blog.bambulab.com/new-launch-of-makerlab-experiments), [All3DP relief](https://all3dp.com/4/bambu-lab-reliefs-are-better-now-no-longer-experimental-feature/), [All3DP Aimia](https://all3dp.com/de/4/bambu-lab-kuendigt-aimia-an-fuenf-ki-3d-generatoren-auf-makerworld-vereint/)). Meshy ships printability, repair and slicer export ([3Dnatives](https://www.3dnatives.com/en/3dnatives-lab-meshy-ai-3d-model-generator-23092026/)). Custom jewelers run "send artwork → CAD render → approve → deposit". None produces a stone-set, castable piece. Womp, Trove and Gemist were not re-verified.

| Step | AI proposes | User confirms | Guardrail |
|---|---|---|---|
| 1. Photo or prompt | subject mask; IP and likeness flags | subject; rights attestation | flag logos, characters, league trophies, faces |
| 2. Concept | four "jewelry-ised" front views with simplified forms | pick one | no features under 0.4 mm at target size |
| 3. Build mode | flat / relief / **high relief (default)** / full 3D | override | — |
| 4. Image → 3D | provider job (30–90 s), turntable | accept or retry | cost cap |
| 5. Repair, orient, scale | front and up axes | height preset (1, 1.5, 2, 3 in) on a body silhouette | minimum-feature heatmap |
| 6. Regions and ice level | metal / pavé / enamel regions; None, Accents, Iced, Flooded | brush fixes; stone type | pavé lints |
| 7. Bail and chain | bail over centre of mass; chain match | style, length | bail fits chain |
| 8. Metal and finish | karat, colour, two-tone | choose | — |
| 9. Checks | weight, walls, stone report, price range | — | export blocked on errors |
| 10. Render and export | path-traced hero shots | share / order | provenance log |

**IP and likeness.** Team marks, characters and league trophies are protected; some retailers advertise official licences ([GLD](https://gld.com/blogs/news/micro-cuban-link-chain-or-full-size)). Require an attestation, run a VLM flag, keep provenance, and keep flagged designs out of public galleries. Photo pendants of third parties need consent. This is product policy, not legal advice.

## Decisions for Pavé

**(i) Body sources.** One document model; every body resolves to a closed manifold in millimetres.

```ts
type BodySource =
  | { kind: 'parametric'; featureId: string }                        // OCCT/replicad
  | { kind: 'vector'; outline: PathRef | TextRun;
      profile: { depth: number; edge: 'flat' | 'bevel' | 'round' | 'inflate' } }
  | { kind: 'relief'; height: AssetRef; outline: PathRef;
      reliefMm: number; baseMm: number }
  | { kind: 'mesh'; asset: AssetRef;
      origin: 'import' | 'scan' | 'generated'; provenance?: Provenance };
// Non-destructive ops on any body: orient, scaleToHeight, flatBack, shell,
// smooth, bail, regions (face labels → metal | enamel | pave), paveLayers.
```

**(ii) Mesh pipeline.**

- Browser (WASM workers): import, weld, decimate, BVH, orient/scale, plane cuts, vector extrude/inflate, bail and cutter booleans (Manifold), analysis, pavé layout.
- Python geometry service: watertight re-surfacing, remesh, SDF shell, quad remesh, `.3dm` export, depth models.
- Permissive stack only: manifold3d, trimesh, libigl, Open3D, OpenVDB, QuadriFlow. GPL tools run as optional CLI plug-ins.

**(iii) Pavé.** `paveSurface` as in §5. Defaults: stock 0.8–3.0 mm; gap 0.20 mm (0.25 mm when prongs are modelled); edge margin 0.35 mm; bead 0.45 mm; honeycomb style; curvature and thickness caps; instanced display; booleans only at export; stone report always live.

**(iv) Provider adapter.**

```ts
type View = 'front'|'back'|'left'|'right'|'top'|'bottom';
interface Mesh3DRequest {
  input: { kind: 'image'; images: { data: Blob; view?: View; mask?: Blob }[] }
       | { kind: 'text'; prompt: string };
  quality: 'draft' | 'standard' | 'ultra';
  texture: 'none' | 'albedo' | 'pbr';     // albedo feeds region proposals
  topology?: 'tri' | 'quad'; targetFaces?: number; parts?: boolean; seed?: number;
}
interface Mesh3DCapabilities {
  maxViews: number; text: boolean; quad: boolean; parts: boolean;
  licence: { commercial: boolean; excludedTerritories?: string[] };
}
interface Mesh3DJob { id: string; status: 'queued'|'running'|'succeeded'|'failed';
  progress?: number; error?: string }
interface Mesh3DResult {
  meshUrl: string; format: 'glb'|'obj'|'stl'; faces: number; albedoUrl?: string;
  parts?: { name: string; meshUrl: string }[]; costUsd?: number;
  provenance: { provider: string; model: string; seed?: number;
                inputHashes: string[]; createdAt: string };
}
interface Mesh3DProvider {
  id: string;
  capabilities(model?: string): Mesh3DCapabilities;
  estimate(req: Mesh3DRequest): { usd: number; seconds: number };
  submit(req: Mesh3DRequest, signal?: AbortSignal): Promise<Mesh3DJob>;
  poll(jobId: string): Promise<Mesh3DJob>;
  result(jobId: string): Promise<Mesh3DResult>;
  cancel(jobId: string): Promise<void>;
}
```

Environment variables: `PAVE_MESH3D_PROVIDER` (`fal` | `tripo` | `meshy` | `rodin` | `local`), `PAVE_MESH3D_MODEL`, `PAVE_MESH3D_FALLBACKS`, `PAVE_MESH3D_MAX_USD_PER_JOB`, `PAVE_MESH3D_LOCAL_URL` (self-hosted TRELLIS.2 or Hunyuan worker), `PAVE_DEPLOY_REGION` (licence gating), `PAVE_GEOM_SERVICE_URL`, plus `FAL_KEY`, `TRIPO_API_KEY`, `MESHY_API_KEY`, `HYPER3D_API_KEY`.

**Open items before commitment**

- Bake-off of Hunyuan 3.1, Tripo H3.1, Rodin 2.5 and TRELLIS.2 on about 20 jewelry-like inputs.
- Confirm fal prices and endpoint ids.
- Confirm stone-spacing and wall rules with a casting house and a setter.
- Benchmark the batch seat boolean at 5,000 stones.
- Verify MatrixGold, 3Design and Panther pavé parameters.
