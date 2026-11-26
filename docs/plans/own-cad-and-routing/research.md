# Research: starting from the designer's own CAD, photoreal pictures from CAD views, and when the assistant asks

26 November 2026. Read-only research for the founder's request: a person attaches a CAD (with or without renders) on Home or in a project and asks for "more designs"; the assistant works out what the piece is, pitches real-looking jewelry pictures (never a CAD-looking picture unless asked), goes to CAD from a picked picture, asks "straight to CAD or pictures first?" only when the flow is not already clear, and keeps the spec (the description the verifier checks) up to date through a tool every time it suggests a change.

## How to read the evidence

This session's network allowed very few sites. Vendor manuals (McNeel forum and docs, Gemvision, RhinoArtisan, CGTrader, OpenAI and Google developer docs, arXiv, Lovable) all failed to resolve, so most web facts come from search-result summaries of the linked page. Every claim carries one tag:

| Tag | Meaning |
|---|---|
| `[O]` | Opened and read this session (a web page that loaded) |
| `[L]` | Checked this session in a local file: the `rhino3dm` 8.35 type definitions in the repo's `node_modules`, the `openai` 7.65.0 and `@google/genai` 3.6.1 SDK type definitions (downloaded from the npm registry), or the repo's code |
| `[R]` | The project's own recorded experience: `.claude/skills/jewelry-render/SKILL.md` (built on the founder's real Rhino files) and `docs/research/*` |
| `[S]` | A search-result summary of the linked page; the page itself could not be opened. Do not build on a number tagged `[S]` without opening the page |
| `[K]` | My own working knowledge, not re-checked this session |

Hosts that must be allowed to finish the verification: `discourse.mcneel.com`, `developer.rhino3d.com`, `docs.mcneel.com`, `rhinoartisan.com` and `docs.rhinoartisan.com`, `gemvision.com`, `developers.openai.com`, `ai.google.dev`, `docs.cloud.google.com`, `docs.bfl.ai`, `arxiv.org`, `lovable.dev`.

---

## 1. The short answer

1. **A working jeweler's .3dm is readable enough to recognise the piece, but not because of jewelry metadata.** The jewelry plug-ins keep their gem and builder data as plug-in user data that a reader without the plug-in cannot decode (`rhino3dm` exposes the plug-in data table as an empty class) `[L]`. What a reader can rely on is plain geometry plus names: layers (often one per metal or stone colour), object names and user strings, materials, block definitions with one transform per stone, and the render meshes Rhino caches on each face `[L]` `[R]`. Gems are recognisable from their shape: closed, convex, all-planar faceted bodies, often block instances of one gem scaled per stone `[R]`; a competitor recognises other plug-ins' "dumb" gems by exact mesh or brep topology `[S]`. So the reader is **geometry first, names second, plug-in data never**.
2. **Read reliably from geometry: piece type (with help), ring size from the bore, stone positions, counts, outline cut, girdle size, carat from Pavé's own cut table, metal volume and weight per alloy.** **Not reliably:** natural or lab, stone colour (unless a layer or material name says it), stone quality, the alloy (unless named), anything from the plug-in's history, and, from a casting STL, the stones themselves (often absent; only their seats remain) `[K]`. A .3dm saved with "Save small" has no render meshes, and `rhino3dm` has no NURBS mesher `[L]` `[R]`, so such a file cannot be shown or measured without our own tessellation.
3. **Neither OpenAI nor Gemini has an image-to-image "strength" knob.** OpenAI's edit call takes up to 16 images, a mask or a "markup" overlay, and for GPT Image 2 and later `input_fidelity` must be omitted `[L]`. Gemini takes reference images as parts with an aspect and size setting only `[L]`. Structure control exists only in Google's separate Imagen edit API on Vertex (canny and scribble control references) `[L]` and in older FLUX.1 ControlNets `[S]`; FLUX.2 does structure through references, explicitly not pixel-exact `[S]`. **Faithfulness therefore comes from three things we control: which views we send and how they are labelled, a preserve-list in the prompt, and a check in code and by a vision judge after generation, with regenerate-or-reject.**
4. **"Not CAD-looking" can be checked automatically, best as binary questions plus a comparison, not as a 1–10 score.** Vision judges agree with people far better on pairwise comparisons than on absolute scores (79 % vs about 70 % overall for GPT-4V in one benchmark; pairwise beat pointwise in every task in another) `[S]`. The cues are known: default or uniform lighting, razor edges, a viewport-white background, no contact shadow, orthographic views, glassy white or rainbow stones, plastic metal `[S]` `[R]`. A cheap code check also catches the commonest failure, the model handing back the CAD render nearly unchanged.
5. **Ask once, early, only when the choice is outcome-critical and not inferable, with the recommended answer preselected.** Agents both over-ask and under-ask; over-asking scores as badly as not asking (an agent with 80 % recall from 50 questions scored 14.5 % on HiL-Bench), and clarification after mid-run is worse than never asking `[S]`. Text-to-CAD research that asks only when the prompt has missing or conflicting dimensions beats generating straight away `[S]`. Shipping tools show question cards that are skipped when the prompt already answers them `[S]`. Pavé already asks up to three questions with defaults in its board skill `[L]`; the new piece is a **route decision** (images first, CAD first, or both) driven by visible signals, asked as one card only when the signals disagree.

---

## 2. What the code does today (the starting point)

Read in `/home/user/ffdraft-ui` (branch ui/focus) and `/home/user/ffdraft-spec` (branch spec/truth) `[L]`.

| Area | Today | What matters for this request |
|---|---|---|
| Opening a model as CAD | `pieces.openAsCad` (`apps/server/src/ideas.ts`) accepts STL, OBJ, GLB, 3MF, PLY as one `meshBody` node; STEP is refused as "planned"; .3dm is not listed | A meshBody carries no stones, no band, no metal: the spec check and `specFromFacts` see nothing to recognise |
| A spec from a CAD | `specFromFacts` (`packages/schema/src/spec/amend.ts`) writes a first spec from measured facts, every line marked assumed, archetype chosen from band, stone lots and bodies | Exactly the right shape for an imported CAD, once an importer produces facts (stone lots with cut, size, count, positions; band bore; metal parts) |
| Spec changes | `pieces.setSpec` before the build; after it, `pieces.amendSpec` with the person's quoted words, confirmed on a card bound to the spec version (`skills/spec.ts`, recent commits) | The founder's "always passed in as a tool" is half there: the strict path exists; there is no draft path for a description that changes while ideas are still pictures |
| Home attachments | Up to 8 attachments per message (`pages/home/Composer.tsx`) | The entry point the founder names; a CAD attachment needs a route |
| Views of the piece | Camera presets hero (azimuth 35°, elevation 24°), front, top, side, macro (`packages/render/src/camera.ts`, `takes.ts`) | The "hero, top and side viewfinders" exist and can render any piece, including a meshBody |
| Image brief | `BRIEF_SYSTEM` (`packages/agent/src/imagegen.ts`) asks for "even studio light with soft reflections… a plain, seamless, light grey or white background… so the piece can be cut out and modelled in CAD" | This is a catalogue cut-out look, which drifts toward the CAD-render look the founder wants to avoid; the brief is not given the spec |
| Image check | `CHECK_SYSTEM`: safety only; "a picture that is simply poor, off-brief or not jewelry is allowed: the designer judges quality" | No check of faithfulness (stone count, proportions) or of the photographic look |
| Image models | OpenAI list: gpt-image-2.5-flare, -2.5-sunburst, -2, -1-mini; Gemini: 3.1-flash-image, 3-pro-image, 2.5-flash-image | The current SDK also lists `gpt-image-2.6-sunburst` and `-2.6-flare`, and says `gpt-image-1` was shut down on 23 October 2026 `[L]` |

---

## 3. How working jewelers' CAD files are built, and what can be read from them

### 3.1 The tools

| Tool | What a file from it looks like | Tag |
|---|---|---|
| **Rhino + MatrixGold** (Gemvision/Stuller) | A normal .3dm. MatrixGold adds a parametric engine ("builders" with history) and gem objects; a file with MatrixGold gems shows a gem report and weight report when opened in MatrixGold, and a user on the McNeel forum wanted that report without opening the file, with no answer given | `[S]` [forum](https://discourse.mcneel.com/t/need-to-get-the-gem-data-and-weight-without-opening-the-3dm-file/77098) |
| | MatrixGold 4.0 released in May 2026 and supports Rhino 8; 3.11 added a global parametric on/off | `[S]` [Rhino blog](https://blog.rhino3d.com/2026/05/matrixgold-40-released.html), [forum](https://discourse.mcneel.com/t/matrixgold-3-11-the-agility-update/213117) |
| **RhinoGold** (Gemvision, now retired) | .3dm files. The 2018 service release added "gem recognition": it imports stones from existing models, recognises and analyses them, and converts them to parametric RhinoGold gems. A later forum reply says Gemvision retired RhinoGold | `[S]` [Rhino blog 2018](https://blog.rhino3d.com/2018/05/new-rhinogold-service-release-with-gem.html), [forum](https://discourse.mcneel.com/t/new-rhinogold-service-release-with-gem-recognition/62902) |
| **RhinoArtisan** (2Shapes; the RhinoGold successor) | Layers grouped as Metal, Gem, Object and User, with gems, elements and curves filed to their layers automatically and gems coloured; can be switched off | `[S]` [docs](https://docs.rhinoartisan.com/user-interface/panels/layers) |
| | Its "Recover" converts gems made in RhinoGold, Matrix or MatrixGold into its own gems; its scripting reference says such "dumb" gem geometry is recognised by its exact mesh or brep topology; its gem handle exposes cut shape, material, carat and X/Y/Z size in mm | `[S]` [Recover](https://rhinoartisan.com/docs/7/diamonds/gem-tools/recover/), [gem handle](https://rhinoartisan.com/docs/scripting/reference/gems/the-gem-handle/), [RhinoGold in 2026](https://www.rhinoartisan.com/blog/rhinogold-in-2026/) |
| **Clayoo** | A SubD/mesh sculpting plug-in in the same family, for organic forms | `[S]` [food4rhino](https://www2.food4rhino.com/en/node/2844) |
| **JewelCAD** | Its own `.jcd` format; no converter to .3dm is known to Rhino users. Files leave as STL (often via "Cut in Slices… also output STL"), IGES (surfaces arrive open, cutters included, need closing and booleans) or SLC | `[S]` [forum](https://discourse.mcneel.com/t/how-to-open-a-jewelcad-file-in-rhino/40871) |
| **3Design** (Gravotech) | A reseller table lists import of vectors, 3DM, OBJ, STL, STEP and export of STL, EPS, IGS only; a gem library of standard cuts and a "Gem Reporter" | `[S]` [Novedge](https://novedge.com/products/buy-3design-pro), [Skyjems](https://skyjems.ca/pages/encyclopedia-3design) |
| **Diatech Make** (browser, with an AI assistant) | Imports STEP, STL, .3dm and JewelCAD .jcd | `[R]` research 13, from [cad.diatech.ai](https://cad.diatech.ai/) |

**What this means:** the file a Pavé user brings is most often a .3dm from Rhino with MatrixGold or RhinoArtisan, or an STL from any tool (JewelCAD and 3Design export little else) `[K]`. Plug-in gem data does not travel even between plug-ins without a conversion step `[S]`, so Pavé must recognise gems from geometry exactly as the plug-ins do for each other.

### 3.2 The anatomy of a typical working file

From the founder's own files, as recorded in the render skill `[R]`:

- **Cached render meshes** on each Brep face: no NURBS meshing is needed to see or measure the piece.
- **Stones are usually block instances:** one gem definition plus a per-stone transform, often with scale ("an 11 mm definition scaled to 6.35 mm"). Size is in the transform, not in the definition.
- **Layers per stone colour**, and the mapping is not stable between files ("never assume layer 11 = white from an earlier piece").
- Brep bounding boxes can be loose; measure from mesh vertices.
- Metal parts are separate objects (links of a bracelet each their own object).

From working knowledge of jewelry files `[K]` (verify on real files before relying on any of it):

- **Gems** are closed polysurfaces or meshes with only planar faces (a round brilliant has 57 or 58 facets plus girdle faces), symmetric about the table normal, often on a layer named for the stone or its colour.
- **Cutters** (the seat cutters that pierce the metal under each stone) are frequently left in the file, on a hidden or separate layer. They look like stones with a cylinder or cone below them. A reader that counts "closed bodies near the head" will double-count stones unless it rejects cutters (non-convex, extend well below the girdle, often unnamed or named "cutter").
- **Prongs and heads** are either separate solids or booleaned into the head; shanks are one polysurface swept along a rail; curves (rails, profiles, gem curves) sit on construction layers; there may be a finger-size reference circle, text, dimensions, and duplicate overlapping objects from booleans.
- **Casting STLs** for printing usually contain the metal only, stones removed, sometimes with sprues or supports; the stone positions survive as seats and holes.

### 3.3 What `rhino3dm` (8.35, the version in the repo) can read

Checked against `node_modules/.pnpm/rhino3dm@8.35.0/node_modules/rhino3dm/rhino3dm.d.ts` `[L]`:

| Readable | API | Use for recognition |
|---|---|---|
| Units and tolerances | `File3dm.settings().modelUnitSystem`, `modelAbsoluteTolerance` | Scale to mm (a file in inches or cm must be scaled) |
| Every object with its attributes | `objects().get(i).geometry()`, `.attributes()` with `name`, `layerIndex`, `materialIndex`, `visible`, `mode`, `objectColor`, group list | Names ("Center", "Prong", "Shank"), hidden objects (likely cutters) |
| User strings on objects and the document | `CommonObject.getUserStrings()`, `getUserString(key)`; `File3dm.strings()` | Any plug-in or person that wrote plain key/values (e.g. a gem's cut and size) |
| Layers | `layers()` with `name`, `fullPath`, `color`, `visible`, `locked`, `parentLayerId` | Metal and stone layer names, colours |
| Materials | `materials()` with `name`, `indexOfRefraction`, `transparency`, reflection settings; `renderContent()` | "18K Yellow", "Diamond", "Ruby": a metal or stone guess by name |
| Blocks | `instanceDefinitions()` (`name`, `getObjectIds()`), `InstanceReference.parentIdefId` and `.xform` | One gem definition, N placements: positions, orientations and scales directly |
| Cached meshes | `BrepFace.getMesh(MeshType)`, `Extrusion.getMesh(MeshType)`, `Mesh` vertices and faces, `Mesh.isClosed`, `isManifold()` | Everything geometric: volume, convexity, facets, bore |
| Exact geometry | `Brep` faces, edges, `NurbsSurface`, `Extrusion` path and profiles, `isSolid` | Planar-face test for gems, profile of a shank |
| File info | `applicationName`, `createdBy`, `lastEditedBy`, `archiveVersion` | Which program wrote it (a hint for its layer conventions) |

| Not readable | Why |
|---|---|
| Plug-in data (MatrixGold builders and gems, RhinoArtisan gems) | `File3dmPlugInData` is an empty class; there is no accessor for an object's plug-in user data `[L]`. openNURBS keeps unknown plug-in data as opaque bytes `[R]` research 17 |
| A mesh of NURBS geometry that has no cached mesh | No mesher: the only mesh constructors are `createFromSubDControlNet` and three.js JSON `[L]`; "Save small" drops render meshes `[R]` research 17 |
| Volume or mass properties | No volume or mass-properties call exists `[L]`: compute from the mesh ourselves (the kernel has Manifold) |
| SubD limit surface as a mesh | Only the control net `[L]` |
| Booleans, joins, intersections | Not in openNURBS `[R]` research 12 and 17 |

### 3.4 What the other formats carry `[K]`

| Format | Carries | Missing |
|---|---|---|
| **STEP** (AP214/AP242) | Exact solids, a product tree with part names, colours; units | No gem semantics; a stone is just a named or unnamed solid. Pavé cannot open STEP as CAD yet `[L]` |
| **STL** | Triangles only; ASCII STL may name each solid | No units (a ring 0.7 units wide is in inches or cm), no colours, no layers; all bodies may be merged into one shell; stones often absent |
| **3MF** | Objects, units, materials and colours, components with transforms | Rarely what jewelers export `[K]` |
| **OBJ / GLB** | Groups or nodes with names, materials | GLB from a renderer may have stones as separate nodes, which helps |

### 3.5 Recognising the piece: a reader that holds the numbers in code

This follows the rule already set in research 11 `[R]`: **the model names, code measures**. Vision models are weak at counting beyond about ten and at absolute size, and their counts drift toward the familiar pattern `[R]` (research 11 §2, `[S]` sources there).

1. **Units and bodies.** Scale to mm from the file (for STL, infer from size: a ring bore of 15–23 mm means mm; 0.6–0.9 means inches) and split into connected bodies (block instances already are) `[K]`.
2. **Classify each body** in code, each with a confidence:
   - *gem*: closed, convex within a tolerance, every face planar, a symmetry axis, a facet count in a known band; or an instance of a definition that passes those tests;
   - *cutter*: hidden, or extends far below its girdle, or non-convex, or named so; never counted as a stone, but its axis confirms a seat;
   - *metal*: everything else that is closed.
3. **Gem facts.** Outline of the girdle fitted to round, oval, cushion, emerald, pear, marquise, princess and so on; width and length from the girdle; depth from the table to the culet; carat from Pavé's own `gemDimsFromCarat` table inverted `[L]`; table normal gives orientation; group stones of one size into lots (centre, side, halo, row, pavé) the way `lotsOf` does `[L]`. For a casting STL with no stones, read seats: circular holes with a conical bearing give positions and approximate sizes; mark every such line "from seats".
4. **Ring or not.** A closed metal body with a through hole whose fitted circle is 14–23 mm is a band; the bore gives the size (US size from inner diameter: ID = 11.63 + 0.8128 × size, `[R]` render skill); the head is the region above the band where the stones sit.
5. **Metal.** Volume from the closed meshes (subtract stones that sit inside metal only if they overlap), weight per alloy density; the alloy from layer or material names through a small dictionary ("18K", "750", "W/Y/R", "PT950", "925") or else assumed and asked.
6. **Views for the model.** Render hero, top and side clay views of the imported piece with the existing camera presets, and send them with the measured facts (counts, sizes, the band) to Claude, which names only what is classification: archetype (solitaire, halo, three-stone, cluster, bypass, toi et moi), setting style (claw, bezel, pavé, channel), prong tips, shoulders, style words. Claude never overrides a count or a size that code measured.
7. **Draft spec.** Hand the facts to the existing `specFromFacts` so every line arrives marked assumed, then show the spec card: the person confirms or corrects the lines (alloy, natural or lab, stone colour) that no file can say.

What the person should be told, plainly, when a line cannot be read: "This file doesn't say whether the stones are natural or lab, or which gold: I assumed natural and 18k yellow." The cases that need a different file: no cached meshes ("re-save without Save small, or export STEP"), a JewelCAD .jcd ("export STL or IGES"), an STL with no stones and no clear seats ("tell me the stones, or attach a render").

---

## 4. Photoreal jewelry pictures from CAD views, faithful to the design

### 4.1 What the image APIs actually offer

| Provider | Inputs that steer structure | What is not there | Tag |
|---|---|---|---|
| **OpenAI** Images edits | Up to 16 images; a `mask` (transparent where to edit, first image only); a `markup` PNG overlaid on the first image to guide the edit (GPT Image 2.5, not with mask); `quality` low to max; arbitrary sizes up to 3840×2160 | No strength. `input_fidelity` applies to `gpt-image-1.5` and `-1-mini`; "for `gpt-image-2`, omit this parameter" | `[L]` `openai` 7.65.0 `resources/images.d.ts` |
| | OpenAI's guides: on gpt-image-2 and later output is high fidelity by default; for edits say "change only X" and list what to keep (geometry, layout, lighting), repeat the preserve list each iteration because repeated edits drift; where a region must stay pixel-identical, composite the approved edit into the original; prompt "as if a real photo is being captured" | | `[S]` [GPT Image 2.6 guide](https://developers.openai.com/api/docs/guides/image-prompting?model=gpt-image-2.6), [prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide), [1.5 guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-1.5-prompting_guide) |
| **Gemini** image models (`generateContent`) | Reference images as inline parts before the prompt (labelled with their role in Pavé's provider); `imageConfig` aspect ratio (1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9), size 1K/2K/4K, person setting | No strength, no mask parameter (masking is by words) | `[L]` `@google/genai` 3.6.1 `ImageConfig`; repo `gemini.ts` |
| | Google's own guide: formula "[Reference images] + [Relationship instruction] + [New scenario]", for example "using the attached napkin sketch as the structure and the attached fabric sample as the texture, transform this into a high-fidelity 3D armchair render"; up to 14 reference images; "be explicit about what to keep exactly the same"; describe what you want, not what you don't; ask for a "three-point softbox setup" for products and a "macro lens" for intricate detail; name the material precisely | No warning about counting or fidelity | `[O]` [Google Cloud: ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) |
| **Imagen** edit API (Vertex AI only) | Control reference images of type `CONTROL_TYPE_CANNY` or `CONTROL_TYPE_SCRIBBLE` (the backend can compute the control image), edit modes including `EDIT_MODE_CONTROLLED_EDITING` and `EDIT_MODE_PRODUCT_IMAGE` | Vertex project needed, a different model family from Gemini image | `[L]` `@google/genai` `ControlReferenceType`, `EditMode` |
| **FLUX.2** (BFL) | Structure through multi-reference editing (up to 8 references on [pro]); depth maps and edge outlines can be references; "be specific about which structural elements to preserve" | No strength parameter; "don't expect pixel-perfect structural matching". Strength values (canny 0.5, depth 0.5–0.75) belong to FLUX.1 ControlNets | `[S]` [BFL guide](https://docs.bfl.ai/guides/usecases_editing_controlnets) |

**So:** with the two providers Pavé already integrates, the only levers are the references we send, how we label them, the prompt, and what we check afterwards. A canny-controlled path (Imagen on Vertex, or a FLUX.1-class ControlNet) is the one way to pin edges harder, at the cost of another provider `[L]` `[S]`.

### 4.2 Which views to send, and how

- **Send our own renders of the CAD, not screenshots of the editor.** The camera presets already render hero, front, top and side `[L]`. For a structure reference use a neutral studio render with the right metal colour and dark-contrast stones, not grey clay: a clay image invites a clay-looking output, and a white-glass stone invites white-glass stones `[K]`. Pavé's own Blender looks are already tuned against the CAD look (rounded 0.1 mm edges in shading, dark tent on stones, shaped softboxes) `[R]` render skill and research 24.
- **Label each reference with its role**, as the board skill already does for pins: "Image 1: the design, three-quarter view: structure, proportions, stone layout. Image 2: the same design from above: stone count and arrangement. Image 3: a real photograph from the board: light and mood only." Models follow labelled roles better than a pile `[R]` research 04 `[O]` Google formula.
- **Use top and side views as evidence, not as the shot.** Orthographic views are themselves a CAD tell `[K]`; ask for one perspective photograph and keep the orthographic views as references for counts and proportions.
- **A real-photo style reference helps the look** (light, background, depth of field) without touching the design; it is the "fabric sample" half of Google's example `[O]`.

### 4.3 A prompt pattern for real metal and stones

Assembled from the sources above; the wording is mine `[K]` and must be tested.

> Photograph the real piece shown in image 1, as a professional jewelry product photograph. [Piece in a jeweler's words: an 18k yellow gold solitaire ring, a 1.0 ct round brilliant diamond (about 6.4 mm) in a six-claw head, a 2.0 mm knife-edge band.] Keep exactly: one centre stone, six claws, the band width and profile, the head height and the proportions of image 1; image 2 shows the same ring from above for the stone and claw count. Shot on a 100 mm macro lens at f/8, three-quarter view, the whole ring in frame; a soft three-point softbox setup with a large diffused key light and narrow strip lights that draw long highlights along the metal; polished gold with warm, crisp reflections of the studio and soft dark edges; a brilliant diamond with bold dark and bright facets and small flashes of colour; the ring resting on a warm pale stone surface with a soft contact shadow; shallow falloff behind. Natural photograph, real materials.

Rules behind it:

- **State counts as numerals and repeat them** in the keep list `[R]` research 04; the preserve-list pattern for jewelry ("preserve stone count, cut, setting geometry, prong count, band profile, metal colour, finish and realistic scale") is recommended by a jewelry imaging vendor `[S]` [Astria](https://www.astria.ai/articles/ai-jewelry-photography/).
- **Photographic language, not rendering language:** lens, aperture, light setup, surface, contact shadow `[O]` Google. Leave out words that pull toward CG ("render", "3D", "CGI", "octane", "unreal", "wireframe") `[K]`.
- **Positive framing** ("a soft contact shadow" rather than "not floating") `[O]` Google.
- **Diamonds:** bold dark facets read as real; white tents and many large sources make stones flat and glassy `[R]` render skill, citing GIA and Rapaport `[S]`.
- **Gold** is the hardest metal for image models: it tends to look flat or over-reflective `[S]` [Rewarx](https://www.rewarx.com/blogs/why-does-gold-jewelry-look-unrealistic-in-ai-images); name the karat colour and ask for reflections of the studio.
- **Iterate from the last approved picture, not from a drifted one,** and restate the keep list every time `[S]` OpenAI guide.
- **The current `BRIEF_SYSTEM` look** (plain light-grey or white background, even light, for cut-out) is right for a picture that is going to be traced in CAD and wrong for a pitch picture; it should become one of two looks chosen per request ("pitch photograph" by default, "clean for CAD" when the next step is Take to CAD and the person wants it) `[L]` `[K]`.

How well current models keep geometry is not settled: a single vendor test found Nano Banana 2.1 kept proportions better than GPT Image 2.6 in a clay-style transfer; other reviews say the opposite on structure; the honest conclusion is to test on our own CAD views `[S]` [Atlas Cloud](https://www.atlascloud.ai/fr/blog/tips/ai-clay-filter-styles-guide), [Decrypt](https://decrypt.co/377998/chatgpt-images-2-5-vs-nano-banana-2-review), [WaveSpeed](https://wavespeed.ai/blog/competitor-comparison/gpt-image-2-5-vs-nano-banana-pro/).

### 4.4 Checking that the picture is still the design

Image models are trained to be plausible, not faithful `[S]` [Rapaport](https://rapaport.com/trade/blog/cad-ar-ai-tech-jewelry-content-marketing/); their typical jewelry failures are wrong stone physics, melted or uneven metal and wrong scale `[S]` [Dreamina](https://dreamina.capcut.com/ai-image/photorealistic-ai-generator-for-jewelry-ads). Vision models miscount small stones and fall back to the familiar count `[R]` research 11. So the check splits like the reader:

| Check | How | Pass rule (to calibrate) |
|---|---|---|
| Silhouette and proportions | Cut the piece out of the output (plain or soft background makes this easy), align it to our render of the same camera by scale and translation, compare masks; compare a few ratios (head width to band width, total height to width) | Mask overlap and ratios within a tolerance set from tests `[K]` |
| Countable features | Crop the head (and each row region) and ask the vision model to point at each centre stone and each claw, without naming the archetype; compare to the spec; three runs, disagreement means fail and regenerate `[R]` research 11 rules 1–4 | Exact match on centre and side stones and claws; pavé is never counted from pixels |
| Spec words | Metal colour, cut outline, setting type as classification questions | Each matches the spec line |
| Nothing added | Extra stones, a second band, text, a hand | None |

When a picture fails, regenerate with the failure named in the keep list, at most twice, then show the best one marked "differs from your design: 5 claws instead of 6" rather than hiding it `[K]`.

### 4.5 Checking that the picture does not look like CAD

Evidence on judges: GPT-4V-class judges matched people best on pairwise comparisons (79.3 % agreement) and worst on absolute scores `[S]` [MLLM-as-a-Judge](https://arxiv.org/pdf/2402.04788); pairwise beat pointwise across generation, editing and video tasks (for example 0.86 vs 0.73 on GenAI-Bench) `[S]` [GenArena](https://arxiv.org/pdf/2602.06013); VIEScore with GPT-4o reached a Spearman 0.4 against a human-to-human 0.45 on generation but struggled on editing `[S]` [VIEScore](https://arxiv.org/html/2312.14867v2). Classical CG-versus-photo detectors used wavelet statistics or physical cues such as gamma and sharp structures `[S]` [Lyu and Farid](https://farid.berkeley.edu/downloads/publications/sp05b.pdf), [Ng and Chang](https://www.ee.columbia.edu/ln/dvmm/publications/05/ng_acmmm05.pdf); they predate modern path tracers and image models and are not a usable gate today `[K]`.

**A rubric of yes/no questions**, each answered with a short reason first and the answer after (reason-then-format, `[R]` research 11):

1. Is the lighting flat, uniform or default-looking, with no shaped highlights? (CAD tell) `[S]` [Lightmap](https://lightmap.co.uk/blog/lighting-software-for-jewelery)
2. Are edges razor-sharp with no highlight line along them? `[R]` render skill ("a razor edge is one of the things that makes a render read as fake")
3. Is the background a flat viewport white or grey gradient with no surface, and does the piece float with no contact shadow?
4. Is the view orthographic (no perspective), or do grid lines, axes, wireframes, gizmos, dimension lines or UI appear?
5. Are stones glassy white, uniformly bright, grey, or rainbow confetti, instead of crisp dark and bright facets?
6. Does the metal look like plastic, clay, or a uniform mirror with no environment in it? (Most of what a jewelry photo shows is reflected surroundings) `[S]` [Photigy](https://www.photigy.com/school/jewelry-photography-vs-3d/)
7. Is everything perfectly symmetric and spotless in a way a photograph would not be? `[S]` [7CGI](https://7cgi.com/blog/project-highlight-lifestyle-3d-jewelry/)

**Then one pairwise question** with anchors: the output beside our CAD render of the same view (and, when the board has one, a real photograph): "Which looks more like a photograph of a real piece: A or B?" Run with A and B swapped; the output must win both ways. Plus **one code check**: if the output is nearly identical to the CAD reference (a structural similarity above a threshold), the model handed the render back; reject `[K]`.

A picture that fails two or more rubric questions, or loses the pairwise, is regenerated once with the failed cues named in positive form ("soft contact shadow on a stone surface", "strip-light highlights along the band"), then shown with a note. The rule applies only when the request's look is "photograph"; "technical", "line drawing" and "clean for CAD" looks skip it (the founder's "unless they ask").

---

## 5. Straight to CAD, or pictures first, and when to ask

### 5.1 What the evidence says about asking

| Finding | Tag |
|---|---|
| Agents fail both ways: over-asking (52 % of sessions in one study) or never asking; deferring a clarification past mid-trajectory is worse than never asking; no frontier model asked in the best window | `[S]` [Ask Early, Ask Late, Ask Right](https://neurips.cc/virtual/2026/poster/154769) |
| Over-asking costs as much as under-asking: 80 % blocker recall from 50 questions (8 % precision) scored 14.5 %; models reach 75–89 % with complete information but 4–24 % when they must judge when to ask; metric Ask-F1 | `[S]` HiL-Bench, [arXiv 2604.09408](https://arxiv.org/html/2604.09408v2) |
| Clarification costs are interruption, latency and trust; one model family over-clarifies, another under-clarifies | `[S]` LHAW, [arXiv 2602.10525](https://arxiv.org/html/2602.10525v1) |
| Text-to-CAD: a clarifying agent that asks only when the prompt has missing or conflicting dimensions, before a coding agent builds | `[S]` ProCAD, [arXiv 2602.03045](https://arxiv.org/html/2602.03045v1), ICML 2026 |
| A 3D tool-orchestration agent intercepts underspecified instructions and asks targeted questions before invoking expensive 3D tools | `[S]` Clare, [alphaxiv 2607.16352](https://www.alphaxiv.org/abs/2607.16352) |
| Lovable shows a question card before it builds when the prompt leaves the look open, and skips the questions when the prompt already describes the look; v0 added clarifying questions before generating, criteria not published | `[S]` [Lovable docs](https://docs.lovable.dev/features/design-guidance), [Lovable blog](https://lovable.dev/blog/chat-mode-and-questions), [v0](https://www.createwith.com/tool/v0/updates/v0-adds-clarifying-questions-before-generating-web-apps) |
| Figma Make users asked for it to "ask questions instead of jumping in too fast"; Make now has a plan mode | `[S]` [Figma forum](https://forum.figma.com/suggest-a-feature-11/figma-make-should-ask-the-user-questions-instead-of-jumping-in-too-fast-51999), [Figma help](https://help.figma.com/hc/en-us/articles/40830441709719) |
| Agents "can pause for human feedback at checkpoints or when encountering blockers"; routing "classifies an input and directs it to a specialized followup task"; evaluator-optimizer loops; tool definitions deserve as much prompt work as the prompt | `[O]` [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) |
| No source found describes a design tool that offers concept images first and 3D second as an explicit choice | `[S]` absence from searches |

### 5.2 The route as signals the assistant can see

Put the flow state in the context the model already gets (stage, what exists on the board, picked picture, CAD, spec and its version, the person's last route choice), and give the system prompt a short table of signals. The model decides; code only enforces "ask before spending money or replacing work".

| Signal | Leans to |
|---|---|
| A specific, measurable brief (cut, carat, metal, size, an archetype with a recipe): "a 1 ct oval solitaire in rose gold, size 6" | CAD first (already the spec skill's rule `[L]`) |
| "Build", "model", "CAD", "STL", "make it printable", a size or stone change to an existing CAD | CAD |
| Open words: "ideas", "something for", "more designs", "variations", "what would it look like", mood or era words | Pictures first |
| Only inspiration attached (photos, pins, a sketch) | Pictures first, unless the words say "build this" |
| **A CAD attached with "more designs" or "make it better"** (the founder's case) | Pictures first: read the CAD (section 3.5), render hero, top and side, pitch four photographs of variations, then Take to CAD from the pick, or edit the imported CAD if the pick is close |
| A CAD attached with "photos of this" or "renders" | Render stage (Blender), or photographs of exactly this design (section 4), not new designs |
| The person chose a route for this piece before, or always chooses it | That route, said in one line ("Going straight to CAD as last time") |
| "Do it all" mode | Still one question at the job's start if the signals disagree; none afterwards |

**Ask only when the signals disagree or the next step costs money or replaces work.** One card, at most three options, the recommended one preselected with a one-line reason and the cost:

> I can start two ways.
> - **Show me four picture ideas first** (recommended: you asked for "more designs"; about $0.20, half a minute)
> - Go straight to CAD from your file
> - Pictures, then CAD of the one I pick

Rules from the evidence: ask before the first action, not halfway `[S]`; never ask what the brief, the file or the history answers `[S]` Lovable; batch questions into one card with defaults (the board skill's three-question card is the model `[L]`); keep "not now" answers and do not re-ask the same thing for the same piece `[K]`.

---

## 6. The spec as the description the verifier uses

What the founder asks: every time the AI suggests a change to the design (a different piece, other stone sizes), the description the verifier checks must be updated, through a tool the AI can always call.

What exists `[L]`: `pieces.setSpec` writes the draft before a build; after the build only `pieces.amendSpec` changes it, quoting the person's words, confirmed on a card bound to the spec version; the check is strict in code.

Implications of this research (for the plan, not decisions):

1. **Two phases of the same spec.** While the piece is still pictures, the spec is a draft the AI may rewrite with each suggestion (setSpec, shown as a light card listing the lines that moved); after the build it is agreed and changes only through amendSpec. The founder's rule "always passed in as a tool" holds in both phases, and the person still sees each change.
2. **Every generated picture records the spec version it was made against**, and the faithfulness check (4.4) compares the picture with that version. When the person picks a picture that differs from the spec (three stones where the spec has one), the AI proposes the spec change before Take to CAD, so the CAD is built against what was picked.
3. **An imported CAD starts its spec from what the file measured** (`specFromFacts`, all lines assumed), confirmed on the card; a variation pitched from it changes the draft spec, never the imported file.
4. **The image brief should be given the spec** (the counts, sizes, metal and cut as a keep list), so the brief, the picture check and the CAD check all read from one source.

---

## 7. Not established, and what to test first

- **No real vendor file was opened.** MatrixGold's layer names, whether its gems are blocks or individual polysurfaces, what user strings (if any) it writes, and what RhinoArtisan and 3Design files contain are all unverified. First test: run a `rhino3dm` dump (units, layers, object types per layer, names, user strings, instance definitions, cached-mesh presence) on five of the founder's own files from different tools, outside the repo.
- **Gem recognition accuracy** (cut, size, count, cutter rejection) on real files and on casting STLs without stones: unmeasured.
- **Image-model faithfulness on our own CAD views:** which provider keeps six claws and one stone, and at what rate, with and without a top view; whether a canny-controlled path is worth a third provider. Needs keys; nothing here was run.
- **The judge's agreement with the founder** on "looks like CAD": collect 30–50 pairs he labels, then set thresholds.
- **Prices** of the 2.6 OpenAI models and current Gemini image models were not opened.
- Every `[S]` number in sections 4 and 5 needs its page opened once the hosts are allowed.

---

## Sources

**Opened this session `[O]`**
- Google Cloud blog, "Ultimate prompting guide for Nano Banana": https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
- Anthropic, "Building effective agents": https://www.anthropic.com/engineering/building-effective-agents

**Checked locally `[L]`**
- `rhino3dm` 8.35.0 type definitions: `/home/user/ffdraft-ui/node_modules/.pnpm/rhino3dm@8.35.0/node_modules/rhino3dm/rhino3dm.d.ts`
- `openai` 7.65.0, `resources/images.d.ts` (`ImageEditParams`), from https://registry.npmjs.org/openai/-/openai-7.65.0.tgz
- `@google/genai` 3.6.1, `dist/genai.d.ts` (`ImageConfig`, `ControlReferenceType`, `EditMode`), from https://registry.npmjs.org/@google/genai/-/genai-3.6.1.tgz
- Repo: `apps/server/src/ideas.ts`, `packages/agent/src/imagegen.ts`, `packages/ideation/src/openai.ts` and `gemini.ts`, `apps/studio/src/pages/home/Composer.tsx`, `packages/render/src/camera.ts` and `takes.ts` (ffdraft-ui); `packages/schema/src/spec/amend.ts` and `facts.ts`, `packages/agent/src/prompt/skills/spec.ts` and `board.ts` (ffdraft-spec)

**Project records `[R]`**
- `/home/user/ffdraft-render/.claude/skills/jewelry-render/SKILL.md` (sections 2A, 2B, 7, pitfalls)
- `/home/user/ffdraft/docs/research/04-ideation-models.md`, `11-image-to-cad.md`, `12-rhino-parity.md`, `13-jewelry-cad-features.md`, `17-pave-file-format.md`, `24-render-realism-measured.md`

**Search summaries only `[S]`** (pages not opened)
- McNeel forum: https://discourse.mcneel.com/t/need-to-get-the-gem-data-and-weight-without-opening-the-3dm-file/77098 · https://discourse.mcneel.com/t/new-rhinogold-service-release-with-gem-recognition/62902 · https://discourse.mcneel.com/t/how-to-open-a-jewelcad-file-in-rhino/40871 · https://discourse.mcneel.com/t/matrixgold-3-11-the-agility-update/213117
- Rhino blog: https://blog.rhino3d.com/2018/05/new-rhinogold-service-release-with-gem.html · https://blog.rhino3d.com/2026/05/matrixgold-40-released.html
- RhinoArtisan: https://docs.rhinoartisan.com/user-interface/panels/layers · https://rhinoartisan.com/docs/7/diamonds/gem-tools/recover/ · https://rhinoartisan.com/docs/scripting/reference/gems/the-gem-handle/ · https://www.rhinoartisan.com/blog/rhinogold-in-2026/
- Gemvision comparison sheet: https://gemvision.com/Manuals/RG_vs_MG_2026_Tool_Features_JAN.pdf
- 3Design: https://novedge.com/products/buy-3design-pro · https://skyjems.ca/pages/encyclopedia-3design · Clayoo: https://www2.food4rhino.com/en/node/2844
- OpenAI: https://developers.openai.com/api/docs/guides/image-prompting?model=gpt-image-2.6 · https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide · https://developers.openai.com/cookbook/examples/multimodal/image-gen-1.5-prompting_guide · https://developers.openai.com/cookbook/examples/generate_images_with_high_input_fidelity
- Google: https://blog.google/products/gemini/prompting-tips-nano-banana-pro/ · https://ai.google.dev/gemini-api/docs/image-generation · https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
- BFL: https://docs.bfl.ai/guides/usecases_editing_controlnets
- Jewelry imaging: https://www.astria.ai/articles/ai-jewelry-photography/ · https://rapaport.com/trade/blog/cad-ar-ai-tech-jewelry-content-marketing/ · https://dreamina.capcut.com/ai-image/photorealistic-ai-generator-for-jewelry-ads · https://www.rewarx.com/blogs/why-does-gold-jewelry-look-unrealistic-in-ai-images · https://www.photigy.com/school/jewelry-photography-vs-3d/ · https://7cgi.com/blog/project-highlight-lifestyle-3d-jewelry/ · https://lightmap.co.uk/blog/lighting-software-for-jewelery
- Model comparisons: https://www.atlascloud.ai/fr/blog/tips/ai-clay-filter-styles-guide · https://decrypt.co/377998/chatgpt-images-2-5-vs-nano-banana-2-review · https://wavespeed.ai/blog/competitor-comparison/gpt-image-2-5-vs-nano-banana-pro/
- Judges and CG detection: https://arxiv.org/pdf/2402.04788 · https://arxiv.org/pdf/2602.06013 · https://arxiv.org/html/2312.14867v2 · https://farid.berkeley.edu/downloads/publications/sp05b.pdf · https://www.ee.columbia.edu/ln/dvmm/publications/05/ng_acmmm05.pdf
- Asking: https://neurips.cc/virtual/2026/poster/154769 · https://arxiv.org/html/2604.09408v2 · https://arxiv.org/html/2602.10525v1 · https://arxiv.org/html/2602.11199v1 · https://arxiv.org/html/2602.03045v1 · https://www.alphaxiv.org/abs/2607.16352 · https://docs.lovable.dev/features/design-guidance · https://lovable.dev/blog/chat-mode-and-questions · https://www.createwith.com/tool/v0/updates/v0-adds-clarifying-questions-before-generating-web-apps · https://forum.figma.com/suggest-a-feature-11/figma-make-should-ask-the-user-questions-instead-of-jumping-in-too-fast-51999 · https://help.figma.com/hc/en-us/articles/40830441709719
