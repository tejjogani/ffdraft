# 11 — Image to CAD: from a photo of a piece to an editable design or a faithful sculpt

Research date: 2026-11-24. Scope: one or a few photos of a piece of jewelry to (a) an editable parametric design and (b) a faithful sculpted body. Build brief: [`docs/plans/reference-match.md`](../plans/reference-match.md). Not repeated here: the image-to-3D model table, licences, prices and the mesh repair stack in [`06-freeform.md`](./06-freeform.md).

**How to read the evidence.** No paper or vendor page could be opened this session (`arxiv.org` and others are outside the allowed network), so every external claim comes from a search summary of the linked page and is tagged `[S]`. `[K]` is background knowledge that was not re-checked. `[D]` is arithmetic done here. `[M]` was measured here on the kernel, without any model. "Unverified" marks a number that should not be built on before the source is opened. No live model call was made (no keys), so **nothing about model quality on jewelry is tested**; every such statement is inferred from other domains.

## 1. The short answer

- **Nobody ships this.** No tool or paper found turns a jewelry photo into an editable, jewelry-aware parametric model. Products output meshes; research CAD synthesis is trained on mechanical parts. (An absence claim from about 40 searches.)
- **For an editable design: the model names, code measures, the kernel renders, a fitter adjusts a handful of numbers.** Vision models are weak exactly where jewelry needs precision: counting many small stones, counts that contradict a familiar pattern, and absolute size.
- **For a sculpted piece: go part by part.** Generate only the sculpted body, keep stones, settings, bail and chain parametric, and default to a relief. Generators lose thin, shiny and transparent detail, and their own vendors say seats and sizing belong in CAD.
- **The core can be proven without keys.** Pavé renders its own designs, so it has exact ground truth for a round-trip test. A prototype here recovered a solitaire's proportions and camera from one synthetic view (section 8). Real photos still need jeweler review.

## 2. What vision models can and cannot read

| Finding | Source and date | Tag |
|---|---|---|
| On familiar subjects edited to have an unusual count, models averaged 17.05 % counting accuracy; about 75 % of wrong answers were the memorised count. Asking to double-check added about 2 points. Naming the subject made it 2 to 6 points worse. Removing the background added about 21 points. | [Vo et al., "Vision Language Models are Biased"](https://arxiv.org/abs/2505.23941), May to Nov 2025; figures differ by version | `[S]` |
| Counting error is small below 10 objects and grows fast beyond 30; it worsens with visual complexity. | [Sengupta et al.](https://arxiv.org/html/2511.17722v3), Apr 2026 | `[S]` |
| Counting fails even at small counts when two or more object types are mixed. | [VLMCountBench](https://arxiv.org/abs/2510.04401), Oct 2025 | `[S]` |
| The count is present in the visual features and lost in the language layers, where text priors take over. | [Le Dinh Anh et al.](https://arxiv.org/abs/2604.10039), Apr 2026 | `[S]` |
| Splitting the image into tiles that do not cut objects, counting each and summing, helps with no training. | [LVLM-Count](https://arxiv.org/html/2412.00686v4), 2024–2025 | `[S]` |
| Pointing at each object before counting generalises better, but no model counted reliably in complex scenes. | [Point-then-count](https://arxiv.org/html/2603.21746v1), Mar 2026; [arXiv 2512.15254](https://arxiv.org/pdf/2512.15254v1), Dec 2025 | `[S]` |
| Zooming helps partly by removing background. One model's counts were within 10 % on 85 % of images while only 64 % of its points landed on an object, so mapping points from crops back to the full image is a weak step. | [Shi et al.](https://arxiv.org/pdf/2610.09313), Oct 2026 | `[S]`, numbers unverified |
| Reasoning through a reference object of known size lifts size answers by about 19 points, and by 20 to 56 when prompted. | [Q-Spatial Bench](https://arxiv.org/abs/2409.09788), EMNLP 2024 | `[S]`, old models |
| A product-photo attribute benchmark (9 models, 18 attributes) uses an explicit "not visible" label. | [arXiv 2601.15711](https://arxiv.org/html/2601.15711), Jan 2026 | `[S]` |
| Forcing a format can cost reasoning; the remedy that holds up is to reason first and format in a separate step. Constrained decoding lowered validity on large nested schemas in one study and helped in another. | ["Let Me Speak Freely?"](https://arxiv.org/html/2408.02442v3) 2024; [arXiv 2604.03616](https://arxiv.org/pdf/2604.03616); [ExtractBench](https://arxiv.org/pdf/2602.12247); [arXiv 2610.35328](https://arxiv.org/pdf/2610.35328) | `[S]`, mixed |
| Stated confidence is overconfident; agreement across repeated answers is a better signal. Models abstain less than they should on unclear images. | [arXiv 2508.19111](https://web3.arxiv.org/pdf/2508.19111) 2025; [arXiv 2603.16728](https://arxiv.org/html/2603.16728) Mar 2026 | `[S]` |

No source tested repeated numeric estimates, and none tested jewelry.

**Rules for the read that follow from this:**

1. **Ask for categories and "which is bigger", never totals or millimetres.** Cut, setting style, archetype, prong tip and symmetry are classification. Pavé counts, sizes and anything over about 10 items are not.
2. **Guard against the familiar pattern.** "Solitaire" suggests four or six prongs; "three-stone" suggests three. Count prongs and feature stones on a cropped, background-removed head, without naming the archetype in that prompt, and confirm by building both candidates (section 3).
3. **Several small passes, not one large schema.** One pass per region crop (head, shoulder, gallery, bail), each with a flat schema, free-text reasoning before the structured answer, and a required `visible: yes | partly | no` per field.
4. **Run the read three times; disagreement means "ask the designer"**, not "average". `[K]` as a design choice; the evidence is only that consistency beats stated confidence.
5. **Derive counts from geometry.** A row's count is arc length over pitch; a pavé count is area times packing density (about 51 stones per cm² at 1.3 mm, per `06-freeform.md`). If a count must come from pixels, an instance segmenter on tiles produces masks and code counts them.

## 3. Render and compare (analysis by synthesis)

- **A write, render, compare, revise loop beats one shot.** [VIGA](https://arxiv.org/abs/2601.11109) (Jan 2026) reports about +35 % on BlenderGym; the paper and its site disagree, so the number is unverified. [CADReasoner](https://arxiv.org/abs/2603.29847) (CVPR 2026 Findings) feeds multi-view overlays back to a model that edits its own CadQuery program over five rounds. `[S]`
- **For a handful of parameters, fit without gradients.** One inverse procedural modelling paper offers both paths and notes a genetic algorithm works with any generator ([Garifullin et al.](https://arxiv.org/html/2310.13373v1), 2023). A 2026 pose paper found CMA-ES on a silhouette objective needed fewer iterations than differentiable rendering ([arXiv 2603.11404](https://arxiv.org/pdf/2603.11404v2)); that is pose tracking, not model fitting. `[S]` Pavé's kernel is not differentiable. `[K]`
- **A learned shortcut exists for later.** [DI-PCG](https://arxiv.org/abs/2412.15200) (CVPR 2025) trains a small model per procedural generator on renders of that generator alone, in about 30 GPU hours. `[S]` Pavé's recipes are such generators.
- **Loss.** Silhouette overlap alone has a narrow basin and ignores interior structure; add an edge-distance term and matched keypoints (stone centres, prong tips). `[K]`; section 8 confirms the interior stone mask is what separates four prongs from six `[M]`.
- **Camera.** Single-image calibration that relies on horizon cues ([GeoCalib](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/5636_ECCV_2024_paper.php), ECCV 2024) suits product close-ups poorly; [AnyCalib](https://arxiv.org/pdf/2503.12701v2) (2025) predicts a ray field without them; neither was tested on product photos. `[S]` Render-and-compare pose refinement given a CAD model is established ([MegaPose](https://arxiv.org/pdf/2212.06870), [FoundationPose](https://arxiv.org/html/2312.08344v2)); no result on reflective, textureless objects surfaced. `[S]`
- **Focal length is the wrong camera parameter for a cropped photo.** A product photo is cropped, so its "lens" is unknown and uninformative. What changes the picture is how far the camera stood relative to the piece: perspective across a ring is roughly its depth over that distance, a few per cent at 15 to 30 cm. `[D]` Fit a distance-to-size ratio with a strong prior, and an independent image scale.
- **Scale.** A photo gives ratios only. Anchors, best first: declared ring size (inner diameter = 11.63 + 0.8128 × US size, mm `[K]`), a declared centre stone (round diameter ≈ 6.5 mm × carat^⅓ `[K]`), a declared pendant height, then a coin in frame. A MathWorks example measured a 19.05 mm coin at 19.00 and 18.85 mm with a calibrated camera; a patent recommends a reference 50 to 200 % of the target's size, which favours a coin over a card. `[S]` No accuracy study of ring-sizing apps was found. Phone AR measurement is reported as poor on small objects (anecdote). `[S]`

## 4. Image-to-3D for the sculpted route

- **Thin structure is an architectural limit in some models.** Meta's SAM 3D paper says a 64³ coarse grid loses thin structures ([arXiv 2511.16624](https://arxiv.org/pdf/2511.16624), Nov 2025). `[S]` On a 22 mm ring that is 0.34 mm per cell: a 0.9 mm prong is under three cells and a 0.45 mm bead about one. `[D]`
- **Shiny and transparent inputs fail.** Guides report geometry collapsing on see-through objects and manual clean-up on chrome and glass ([fal guide](https://fal.ai/learn/devs/sam-3d-developer-guide)); the authors of [3DReflecNet](https://arxiv.org/pdf/2605.10204) (CVPR 2026) had to filter out generated shapes that did not match. An FBK study compares SAM 3D, Tripo and TRELLIS.2 on reflective museum objects ([ISPRS Archives 2026](https://isprs-archives.copernicus.org/articles/XLIX-B2-2026/833/2026/)); its numbers were not visible. `[S]`
- **Vendors say the same about jewelry.** Meshy generates "the overall form and detail, not parametric measurements" ([page](https://www.meshy.ai/use-cases/jewelry-design)). Rodin: stone seats, azures and ring sizing "still get their last pass in jewelry CAD" ([page](https://hyper3d.ai/use-cases/jewelry-design)). `[S]`, marketing pages.
- **Real views help; generated views are not guaranteed consistent.** A multi-view TRELLIS variant is described as limited in multi-view fidelity ([Pixal3D](https://arxiv.org/pdf/2605.10922), 2026); hallucinated geometry is tied to gaps between sparse views ([Dehallu3D](https://openaccess.thecvf.com/content/CVPR2026/supplemental/Wang_Dehallu3D_Hallucination-Mitigated_3D_CVPR_2026_supplemental.pdf), CVPR 2026). `[S]`
- **Catalogues churn.** One aggregator already lists several mid-2026 models as deprecated ([Scenario](https://help.scenario.com/en/articles/comparing-generative-3d-models/), Oct 2026). `[S]`
- **Untested idea worth a bake-off:** turn the photo into a matte, single-material front view with stones removed before 3D generation. No source supports or refutes it.

## 5. Segmentation, matting and depth

- **Instance masks:** [SAM 3](https://arxiv.org/abs/2511.16719) (Meta, Nov 2025) returns every instance matching a short noun phrase or an example crop; examples help when instances are missed. No counting benchmark for it surfaced, and its licence terms were not checked. `[S]` Open-vocabulary detectors do poorly with many similar, overlapping objects ([arXiv 2506.15368](https://arxiv.org/pdf/2506.15368), 2025). `[S]`
- **Matting:** BiRefNet is MIT-licensed and handles fine, semi-transparent edges ([model card](https://huggingface.co/ZhengPeng7/BiRefNet-matting)); untested on polished metal or gems. `[S]`
- **Depth:** general monocular models struggle on transparent and reflective surfaces ([TransNormal](https://arxiv.org/abs/2602.00839), Jan 2026; [DKT](https://arxiv.org/pdf/2512.23705), Dec 2025; the [TRICKY](https://cris.unibo.it/retrieve/d4cce1c7-f86a-436a-88a2-3c5e84356a05/tricky2024_camera-ready.pdf) and [NTIRE 2025](https://arxiv.org/html/2506.05815v1) challenges). `[S]` A depth map of a polished piece is a hint for relief, never a measurement.
- **Capture:** photogrammetry and structured light fail on such surfaces; cross-polarised light reduces glare ([ISPRS 2026](https://isprs-archives.copernicus.org/articles/XLIX-B2-2026/869/2026/isprs-archives-XLIX-B2-2026-869-2026.pdf)). `[S]`
- No jewelry segmentation dataset was found beyond a roughly 4,000-image item detector ([Roboflow](https://universe.roboflow.com/evin-bu0tz/jewel-detection)). `[S]`

## 6. CAD synthesis and jewelry-specific tools

**Research is about mechanical parts** (sketch, extrude, revolve): [CAD-Coder](https://arxiv.org/abs/2505.14646) (image to CadQuery, only "initial signs" on real photos), [Zero-to-CAD](https://arxiv.org/abs/2604.24479), [CADReasoner](https://arxiv.org/abs/2603.29847), [CADFather](https://arxiv.org/pdf/2610.09127) and [CADFit](https://arxiv.org/pdf/2605.01171), all self-reported. [CADBench](https://arxiv.org/abs/2605.10873) (May 2026, 11 systems) finds quality falls with complexity and code-writing vision models "remain far from reliable". Commercial mesh-to-CAD ([Backflip](https://www.engineering.com/backflips-back-is-the-mesh-to-cad-ai-real-this-time/), SGS-1 per [coverage](https://news.hada.io/topic?id=23226)) targets milled parts, with thin and organic shapes listed as weak. `[S]` None has prongs, seats, pavé or gems in its vocabulary.

| Jewelry product | What it outputs | Tag |
|---|---|---|
| Meshy, Rodin, Tripo, Neural4D jewelry pages | Mesh (STL, OBJ, GLB); finish in CAD | `[S]` |
| [Jewel AI](https://www.producthunt.com/posts/1249959) | "3D concepts" with weight and cost estimates; geometry type not stated | `[S]`, unverified |
| Diatech Studio | A ring configurator plus sketch-to-3D; OBJ, STL, GLB per [G2](https://www.g2.com/products/diatech-studio/reviews) | `[S]`, unverified |
| RhinoArtisan 6.7 and 7.0 (2026) | A search assistant, then images, video and organic meshes from text ([blog](https://blog.rhino3d.com/2026/03/rhinoartisan-67.html)) | `[S]` |
| MatrixGold 4.0 (May 2026) | No image-to-CAD feature found ([release](https://blog.rhino3d.com/2026/05/matrixgold-40-released.html)) | `[S]` |
| [GeminAI](https://devpost.com/software/geminai) (hackathon) | Segmentation, a base-metal mesh, positioned gems, a parametric scene; its authors call a single mesh "a dead end" | `[S]` |
| A developer on the [McNeel forum](https://discourse.mcneel.com/t/improving-accuracy-of-ai-generated-jewelry-models-in-rhinocommon/221809) | A model writing RhinoCommon scripts from images; geometric accuracy is the stated blocker | `[S]`, date unverified |

## 7. Evaluating fidelity honestly

- **Report failures beside accuracy.** Several CAD papers score only valid outputs, which flatters them (noted in [CADFather](https://arxiv.org/pdf/2610.09127)). `[S]`
- **Automatic judges do not replace people yet.** The best of 12 vision-model judges trailed trained labellers ([3D-DefectBench](https://arxiv.org/abs/2607.10826), Jul 2026). `[S]`
- **Crowd preference rewards looks.** Splats beat meshes by 16.6 Elo over 123,243 votes ([3D Arena](https://arxiv.org/abs/2506.18787), 2025). `[S]` For casting, geometry and manufacturability must gate.
- **A matching view can lie.** A model can match the input view and be wrong in depth ([arXiv 2605.18754](https://arxiv.org/pdf/2605.18754.pdf), May 2026). `[S]` Hold out a second view where one exists.
- **Perceptual similarity:** DreamSim tracks human judgement better than LPIPS on its own data ([paper](https://arxiv.org/abs/2306.09344), 2023); untested for render against photo. `[S]`

## 8. Measured here, without any model `[M]`

All on the `solitaire` template at draft detail, plain Node, one core, on a machine shared with other jobs. The "photo" is a kernel render, so this is the easiest case: perfect masks and the same generator on both sides. It proves the mechanism, not real-photo fidelity.

MEASURED_PLACEHOLDER

## 9. Three proposals, judged

Scores are 1 (weak) to 5 (strong). Cost is scored so that 5 is cheapest.

| Proposal | Fidelity | Reliability | Accessibility | Testable without models | Cost | Total |
|---|---|---|---|---|---|---|
| Parametric-first: read, recipe, fit by render-and-compare | 3 | 4 | 3 | 5 | 5 | 20 |
| Sculpt-first: generate a mesh, lift 2D stone masks onto it | 3 | 2 | 3 | 3 | 2 | 13 |
| Designer in the loop: draft, flag what is shaky, one-tap fixes | 4 | 4 | 5 | 4 | 4 | 21 |

- **Parametric-first** is the only one with a working, measured core, and it fails safely. It is weak on anything no archetype explains, and it says little about what the jeweler sees.
- **Sculpt-first** has the right ideas for sculpted and iced pieces: recognise stones as 2D masks and cast them onto the body; pick the lowest-freedom feature that explains a region; reject a generated mesh that does not overlap the photo. Its spine depends on generators that are known to fail on shiny, thin, transparent subjects, and it is strictly worse on simple pieces.
- **Designer in the loop** uses the same fit and adds what makes it usable by a non-CAD jeweler: seen / unsure / assumed chips, questions ranked by what they change, pin and refit. Its test ideas (a scripted jeweler, a vision fake that is wrong in the familiar direction) are the best of the three.

**Decision.** Spine: parametric-first. Grafted from designer-in-the-loop: the read card, ranked questions, pin-and-refit, the correction-count metric. Grafted from sculpt-first: the per-part ladder, the mask lift for stones on a sculpted body, the mesh overlap gate with a relief fallback, and the degraded-mesh simulation for keyless tests. The build brief has the result.

## 10. Not established

- No paper was read in full; every benchmark number above is second-hand.
- Not found: jewelry-specific academic work on photo-to-CAD, stone counting or gem segmentation; an independent test of any jewelry AI product; whether a late-2026 3D model supersedes the `06-freeform.md` shortlist.
- Untested, and needing keys: matting and instance segmentation on polished metal and gems; the structured read against jeweler labels; image-to-3D on jewelry with and without the matte pre-pass; every price.
- Untested, and needing photos: the fitter on real masks, where camera, scale and shape trade off and edges are ragged.
