# Survey: the founder's loop against the code (26 Nov 2026)

Read-only. Paths are relative to a worktree root. **UI** = `/home/user/ffdraft-ui` (ui/focus, 32fb232). **SPEC** = `/home/user/ffdraft-spec` (spec/truth, db80257). **MAIN** = `/home/user/ffdraft`.

## 0. Branch state that matters for the plan

- ui/focus and spec/truth have diverged from merge-base 3c7dec0: ui is 34 commits ahead and spec is 24 ahead. The spec branch is about 23.6k lines across 155 files; ui is about 4.6k lines across 96 files.
- Both branches touch these files, so expect conflicts: `packages/agent/src/jobs.ts`, `packages/schema/src/api/{commands,entities}.ts`, `apps/studio/src/features/assistant/{Conversation.tsx,minimal.ts,jobs/JobCard.tsx,jobs/JobControls.tsx}`, `apps/studio/src/features/cad/{index.tsx,viewport/Toolbar.tsx}`, `apps/studio/src/features/render/TakeTile.tsx`.
- Everything about the spec is on SPEC only. Home conversation, card menu, starters, Bring in and the focused editor are on UI. Prompt, loop, imports, kernel and imagegen are the same on both, apart from the spec edits.
- MAIN `docs/agents/BOARD.md` row A15 names this plan: `docs/plans/own-cad-and-routing.md`.

## 1. From prompt to first version, refining, and "a different version"

### 1a. Home composer
- `apps/studio/src/pages/home/HomePage.tsx`: greeting, then `<Composer/>`, then recent pieces, then templates. Once a conversation starts, `HomeConversation` keeps it in Home's main column through `AssistantPanel context={{}}`.
- `apps/studio/src/pages/home/Composer.tsx`:
  - `submit` sets `useAssistant.setState({attachments, selection:null, dropPageContext:true})` and calls `send(text,{threadId:null})`.
  - The run has **no piece**.
  - Without a Claude key it calls `pieces.create({title, brief})`.
  - It has three fixed suggestion chips.
- Shared composer `apps/studio/src/features/assistant/Composer.tsx`:
  - It accepts **images only**: the `attach()` filter `f.type.startsWith('image/')` (l.87), the file input `accept="image/*"` (l.193), the paste filter, the "Add photo" button and the "Drop photos to attach" overlay.
  - The limit is 8.
  - A dropped `.stl/.3dm/.step` is silently ignored.
- Server `apps/server/src/assistant/turn.ts` (SPEC; UI is the same apart from the spec):
  - `userContent()` sends pinned pictures first (label, then image), then the attachments as image blocks, then the text.
  - A non-image attachment is not refused. It goes to `media.skipped`. The model gets only its line in the context "Attachments: "x.stl" (asset …, model/stl)" plus the note "Not shown to you (a format you cannot read): …".
  - `threads.send.attachments` accepts any asset id (max 8).
- Home attachments never land on a board or a pin. The loop's `bindPiece` (SPEC loop.ts 1943) only binds run and thread to a piece created mid-run. The model could `references.save` an asset id, but no skill tells it to.

### 1b. The assistant loop, prompt and context
- System prompt (frozen, cached): `packages/agent/src/prompt/index.ts` `SYSTEM_BLOCKS = [CORE_PROMPT, SKILLS, DESIGN_KNOWLEDGE, NODE_REFERENCE]`.
  - Skills, in order: spec, board, directions, editing, stone, photo, production, render, cinema, ask (`prompt/skills/*.ts`).
- Per-turn context: `packages/agent/src/prompt/context.ts` `renderContext()`. It is appended once after each **user** message and never refreshed inside a run.
  - Fields: open piece (id, kind, archetype, stage, version, node list, directions), selection, board, attachments, references, pins with picture status, people's edits since the last turn (labels only), spec block (SPEC), plan allowance line, "Image generation" line, canon slice.
- Loop: `apps/server/src/assistant/loop.ts` (SPEC is 2055 lines; UI is 1482).
  - Key functions: `runTools`, `execute`, `afterCommand`, `evaluationFor`, `overlapFor` (refuses an assistant edit when a person changed the same features), `captureImages`/`shotImages` (only `viewport.capture` and `scenes.capture` results come back to the model as images), `specNudge`, `writeCard`, `rewriteCard`.
- Tools: `packages/agent/src/tools.ts` is generated from `packages/schema/src/api/commands.ts` (every `tool:` command) plus `client-tools.ts`. `confirm` tools pause for a card.
- **How it decides images or CAD today:** prompt text only. There is no classifier in code.
  - SPEC `prompt/skills/spec.ts` l.12: "A specific brief … goes straight to the spec and the build. An open one … starts on the piece's design board … Offer variants … only when they ask."
  - Core (SPEC `core.ts` l.38): "A new piece from words: pieces.create … pieces.setSpec … pieces.buildFromSpec."
  - Board skill: concept images only when the designer asks for images, and "Offer concept images only when the context's 'Image generation' line says they are available".
  - Photo skill: any uploaded photo goes **straight to CAD** (references.read, then the five questions, then estimate, then build).
  - **No rule asks "straight to CAD, or images first?"**, and no rule recognises "help me come up with more designs" as an image request.
- **Questions:** `chat.ask` (`commands.ts`, `tool:{confirm:true}`) shows quick-reply cards. It works in free chat and in jobs.
  - The prompt caps questions at 3 (5 from a picture: `packages/agent/src/spec-questions.ts`).
  - `jobAdmission` (SPEC `jobs.ts` l.238) applies only to confirm tools. "Check with me" means every confirm tool asks. "Do it all" means `chat.ask` asks once and later questions take their defaults. Recipe tools run. Off-recipe confirm tools and `NEVER_ALONE` still ask. Non-confirm tools such as `pieces.setSpec` always run.
- **Jobs and recipes:** `packages/agent/src/jobs.ts` `JOB_RECIPES`.
  - design: brief, then gather, then "pick" (by the person). Its tools include `references.brief/generate/read`, `freeform.analyze` and `pieces.update`. **No `pieces.setSpec`/`amendSpec`.**
  - cad: brief, then spec, then build, check, look; on SPEC it adds `signoff` (by the person, l.147), and the spec step carries `setSpec`, `amendSpec`, `estimate`, `chooseDirection`.
  - render: look, setup, render, review.
  - Constants: `TAKE_TO_CAD_GOAL` (SPEC l.201), `CAD_REFINE_GOAL`, `VARIANTS_PROMPT` (l.197).
  - Starting a job: `threads.send.job`. In the studio: `features/assistant/jobs/{StartJob,JobMode,JobPlan,JobCard}.tsx`. Starters: `features/assistant/starters.ts` (UI; Home gives the same 3 chips, a piece gives a job starter per area).
- **Refining by chat:** the editing skill (`design.apply`, one intent per call) and the stone skill (`design.replaceStone`). SPEC adds amend-before-change.
- **Refining by hand:** the focused CAD editor `apps/studio/src/features/cad/` (inspector widgets, gizmos, "Ask AI" right-click through `features/assistant/quick-intents.ts`, `QuickIntentHost.tsx`).
  - **How the assistant sees hand edits:** `turn.ts designerEdits()` lists `design_change` rows with `runId IS NULL` since the thread's previous run on the piece. That is up to 20 labels and authors ("v12 "Widen band to 2.4 mm" (by the designer)"). It is labels only, with no diff; the model re-reads with `pieces.get`.
  - SPEC also puts hand edits that break a line into the check: the "Differs from the spec" chip, `spec.putBack`, and "Update the spec" through `amendSpec fromCheck`. People are never gated.
- **"A different version":**
  - **Variants:** `pieces.proposeDirections` (tool; each direction needs a `spec`, a `templateId` or a `mix`) and `pieces.chooseDirection` (tool; on SPEC it is refused once the spec is agreed, 409 `spec_agreed`). UI: `features/directions/{TryVariants,DirectionCards}.tsx`. Variants are parametric only, so **an imported mesh cannot be varied**.
  - **Duplicate:** `pieces.duplicate` (tool), SPEC `handlers/pieces.ts` l.442. It copies brief, spec (agreed state too), design and origin. It does **not** copy the design board, pins or history.
  - **Image variants:** `references.brief` with `mode: vary|refine` and `parentId` (generated images only).

## 2. Importing 3D

| Where | Formats offered | What happens | File |
|---|---|---|---|
| Home composer | none (images only) | 3D files dropped are ignored | `features/assistant/Composer.tsx` l.86–88, 193 |
| Design board | png jpg webp gif heic avif + stl obj glb 3mf ply; step/stp kept with a toast "can't be shown or opened as CAD yet" | `references.save` with `assetId`. A mesh asset becomes reference type `model`, shown in `ideate/ModelViewer.tsx` (three.js turntable, view only). Its menu offers "Open as CAD", never "Take to CAD" (`takeToCadRefusal` → "Open a 3D model as CAD instead") | `features/ideate/board.ts` l.13–26, `actions.ts addFiles`, `DesignBoard.tsx` 470, 672; server `handlers/ideate.ts` ~240 |
| CAD "Bring in", A 3D model file | stl obj glb 3mf ply | `pieces.openAsCad` | UI `features/projects/{BringIn.tsx,bring-in.ts}` |
| CAD empty state / inspector import | stl obj glb 3mf ply + svg + png/jpg/webp; step accepted only to say "planned" | Mesh: `meshNode()` meshBody added by hand. SVG: vectorBody. Image: relief | `features/cad/empty/importers.ts`, `EmptyDesign.tsx` l.266 |
| Render "open a 3D file" (nothing to shoot) | stl obj glb 3mf ply | `pieces.openAsCad` into this piece | `features/render/RenderStudio.tsx` l.538–575 |
| `.pave` | native | `pieces.openFile`: full parametric design, history, spec (SPEC: `spec/history.json`, `signoffs.json`, `check.json`), pins, planes, shots | `apps/server/src/pavefile/open.ts`, `packages/schema/src/files/pave.ts` |
| `.3dm` | **not offered anywhere** | The asset table knows it (`apps/server/src/assets/assets.ts` l.33 `'.3dm': kind mesh`). The kernel parsers cannot read it (`sniffMeshFormat` → "not a mesh format") | — |
| STEP | refused | `ideas.ts openAsCad`: "STEP files cannot be opened as CAD yet; that is planned" | `apps/server/src/ideas.ts` l.31–32, 96–107 |

- **`pieces.openAsCad`** (`apps/server/src/ideas.ts` l.96):
  - **Not a tool**: the command has no `tool:` (SPEC `commands.ts` l.577), so the assistant cannot import anything.
  - With no `pieceId` it creates a piece of `kind: 'other'`.
  - It commits one op, `add meshBody {source:{type:'asset',assetId}}`, with **no height and no material**, and sets `piece.stage='design'` (the piece-stage enum `idea|spec|design|render|production|done` in `entities.ts` l.60 uses `design` for the CAD era, while `JOB_STAGES` uses `design` for the image board).
- **What becomes of an import:** `packages/kernel/src/features/meshBody.ts` plus `schema/src/design/nodes.ts` l.424–450.
  - The parse (`kernel/src/mesh/parse/*`, format sniffed from the bytes) gives **one unwelded triangle soup**. Every object, glTF node and material is merged; only geometry survives. GLB converts Y-up to Z-up (`parse/glb.ts` l.142).
  - `repairMesh` makes **one closed manifold**: it welds, closes holes, fixes winding, **fuses overlapping shells**, fills sealed voids, removes fragments, and falls back to an SDF resurface when non-manifold.
  - `scaleToHeight(m, node.height)`: **height defaults to 40 mm**, so an imported 22 mm ring is rescaled to a 40 mm Z extent. The file's real size is lost unless someone sets `height` by hand.
  - Then simplify, smooth, `flatBack`, `flatPlacement` (centred, back on y=0, set up as a pendant), optional hollow with drains.
  - Output is a single metal body with the node's alloy (default au18k-yellow).
  - **Stones in the file become metal**, fused into the body.
  - **No parametric recovery**: no band, gem, setting or claw nodes.
- **What the kernel can measure from an import:** overall bounds (after the rescale), the metal volume and weight as **one** alloy solid, wall-thin warnings, the disconnected piece count, and repair notes.
  - SPEC `MeasuredFacts` (`packages/schema/src/spec/facts.ts`) records it as `bodies[{form:'mesh', heightMm, widthMm, thicknessMm, assetId}]` and one `parts[]`.
  - **No `band`** (the bore comes only from a ringShank), **no `stones`** and no chain.
  - So ring inner diameter, stones as objects and per-metal weight are all unavailable today.
- Pieces that exist but are not wired:
  - Bore fit and mesh ring resize: planned in MAIN `docs/plans/freeform-cad-additions.md` step 19 and `research/13-jewelry-cad-features.md` gap 7 (fit a circle to the bore; Manifold warp).
  - `.3dm` read: rhino3dm is already a dependency, used only for export (`kernel/src/export/rhino3dm.ts`). Planned as step 19 (meshes, curves, layers, saved face meshes) and step 23 (exact B-rep through OpenCascade).
  - STEP read: the OCCT build carries a STEP reader (`research/12-rhino-parity.md` l.189). Planned in `freeform-cad.md` step 8 as a `brepBody` node.
  - Layers and materials in a .3dm or GLB would let stones be split from metal. Nothing does this today.
- **Export of imports:** `kernel/src/export/step.ts` leaves mesh bodies out, so an imported model cannot go out as STEP. STL, GLB and 3dm (as a mesh) work.
- **`freeform.analyze`** (tool, `apps/server/src/handlers/freeform.ts`) accepts a **mesh** asset. It returns an outline, a height map (`depthSource:'mesh'`) and a suggested mode, as asset ids. The images are **not** returned to the model (`loop.ts assetIdsOf` passes only `images`/`shots`). It is the only tool that takes a 3D asset id today.
- **Photo to CAD (`@pave/match`)** (`packages/match/src`, plan MAIN `docs/plans/reference-match.md`):
  - Silhouette fitting of a parametric design to photos. `route.ts` per-part ladder, `choose.ts` (discrete choices settled by building candidates), `loop.ts`, `ask.ts` (questions ranked by consequence), `lift.ts` (2D stone marks onto a 3D body).
  - The only server use is the `match.fit` tool (`apps/server/src/handlers/match.ts`). It needs one photo with a plain background (classical matte) and returns ops plus overlap. SPEC adds `held` ops that would break a line.
  - `references.read` (tool, `packages/agent/src/photo.ts`) reads 1–4 image assets into `PhotoRead` plus a `specDraft` in code plus the five questions. Its input is `assetIds`, `kindHint` and `note` (500 characters). It accepts any image asset, **viewport captures included**.
  - Nothing feeds captures of an imported mesh (camera known exactly) into match or the read. That route is open: clay captures have a plain background and known views, but stones read as metal.

## 3. Viewfinder and capture

- **CAD view presets:** `features/cad/viewport/Toolbar.tsx` l.111: Hero, Front, Side, Top (keys 1–4), Fit, X-ray, "Render this view".
- **Render viewfinder:** `features/render/Viewfinder.tsx` shows the shot drawn live from the resolved scene, with gestures saved as a custom camera, and a framing overlay ("62% · good").
  - Camera presets: `entities.ts` l.424 `hero|front|side|top|three-quarter|macro|custom`. The camera scales about the bounds centre (`packages/render/src/camera.ts` l.109), so house shots frame any piece alike.
  - House shots are org scenes with `pieceId:null` (`features/render/shot-actions.ts` l.90). `scenes.capture` refuses them until copied (`apps/server/src/cinema.ts` l.123).
- **`viewport.capture`** (client tool, `packages/schema/src/api/client-tools.ts` l.42):
  - Input: `pieceId`, views (preset or azimuth/elevation, 1–6), `mode clay|rendered|technical`, size 512/768/1024, `focusNodeIds`, `annotate`.
  - Output: images plus the `EvaluationSummary`.
  - Served by the open CAD window (`features/cad/capture-tool.ts`, `components/stage/capture.ts`). Otherwise the server fallback `apps/server/src/assistant/capture.ts` draws shaded clay through the match rasteriser (`source:'server'`).
  - The images go back to the model (`loop.ts captureImages`).
- **Can the assistant look at a model it did not build?**
  - **Yes, once it is a piece's design.** Capture works on any design, a meshBody included, and reads `pieceId` only. But it sees the rescaled, flat-placed, single-metal body (in rendered mode the stones show as metal).
  - **No** for a 3D model on a board (no capture, `boards.get` gives title only), a 3D file attached on Home (skipped), or a file not yet opened.
  - `scenes.suggest` and `scenes.capture` likewise need a piece. On a meshBody piece there is no `centreStoneNodeId`, so no macro.
- No tool takes "hero, top, side" captures and returns measured facts in one call (capture returns the summary, but the summary of a mesh has no band or stones).

## 4. Image generation

- **Providers:** `packages/ideation/src/{gemini,openai,higgsfield,fake}.ts`, shape in `types.ts`.
  - Gemini and OpenAI take reference pictures: Gemini `inlineData` before the prompt; OpenAI `/images/edits` with up to 16 `image[]`.
  - Higgsfield SOUL takes **none**: the references go into Claude's prompt only.
  - Keys and settings: `apps/server/src/imagegen/{keys,setup}.ts`. The context line is `turn.ts imagesLine()`.
- **Pipeline:** `apps/server/src/imagegen/pipeline.ts`. `references.brief` (tool) stores an `image_brief`. `references.attestBrief` is for people only. `references.generate` (confirm) asks the provider for N images (default 4), Claude checks each, and the images it keeps are saved as board references with their lineage.
  - Billed `llm` plus `image` as Design work.
  - **Needs a `boardId`**, so from Home a piece and its board must exist first (`boards.forPiece`).
- **Prompt enhancement and guardrails:** `packages/agent/src/imagegen.ts`.
  - `RULES`: sexual, minors, likeness, hate, violence, weapons and self-harm are refused; a trademark needs rights.
  - `BRIEF_SYSTEM` (l.50) writes one paragraph of at most 120 words: piece and parts, metal and finish, stones with cut and setting, proportions in jewelers' words, **one clear view** (front, or front three-quarter for rings), whole piece centred, even studio light, true colours, **"a plain, seamless, light grey or white background … so the piece can be cut out and modelled in CAD"** (l.59). Then what each reference contributes; `vary` keeps the idea and changes 1–2 secondary choices; `refine` applies the change.
  - `CHECK_SYSTEM` (l.68) judges **safety only**: "A picture that is simply poor, off-brief or not jewelry is allowed".
- **References:** `briefRequest` (`commands.ts` l.227) takes `referenceIds` (max 8, board items) with `roles` from `GENERATION_ROLES = subject|style|identity|layout|product` (`entities.ts` l.253), plus `mode new|vary|refine`, `parentId` and `aspect`.
  - `pipeline.ts picture()` l.161 refuses an item with no asset, any non-image asset (so a **3D model reference cannot be used**), view-only items and links without a picture. Notes go in as text.
- **Anti-CAD-look: nothing.** No instruction says "photographed real jewelry, not a render, clay, wireframe or CAD screenshot". No check rejects a CAD look. There is no role meaning "take the form only from this reference". The style the brief asks for (product shot on plain grey) sits close to a clay render.
  - Feeding a CAD snapshot or capture as `subject` (Designs, Bring in, "A snapshot of the CAD"; UI `bring-in.ts` `cad-snapshot` saves the cover image as a pin) will tend to reproduce the grey CAD look.
  - The brief's `piece` description and prompt are stored with the image (lineage) but are **not** passed to `references.read` at Take to CAD, nor to the spec.

## 5. The spec (SPEC branch)

- **Contract:** `packages/schema/src/design/spec.ts`.
  - `PieceSpecSchema` has: kind, archetype (14 values), title, summary, style[], metal{alloy, finish, plating}, ring{size, bandWidthMm (base), bandThicknessMm (top), profile, shoulder}, body{heightMm, thicknessMm, text, shape, meshAssetId, iceLevel}, chain, stones[] (id, role, cut, stone, carat|widthMm, lw, count, setting, prongs, quality), engraving, targetWeightG, budgetUsd, notes, openQuestions, `assumed[]`.
  - There is **no line for the chosen design image** and no visual or style line that is checked. `summary`, `style`, `notes`, `body.shape` and grades are "not measured" words.
- **Lines, tolerances, check:** `packages/schema/src/spec/{lines,tolerances,check,facts,amend}.ts`.
  - `checkSpec(spec, facts)` is pure.
  - Facts come from `packages/kernel/src/evaluate/measured.ts`. The plan table is in SPEC `docs/plans/spec-truth.md` §4 (4 ct agreed, 5 ct built = not met, ±5 % weight band).
- **Server:** `apps/server/src/spec.ts`.
  - `writeAmendment`, `findQuote`/`designersWords` (the quote must be the person's own words from this piece's conversation, including the thread runs from before the piece existed, e.g. Home), `assertMayAmend`, `dryRun`/`refuseChange` (the gate), `holdBreaking` (match.fit), `storeCheck`/`currentCheck`, `agreeSpec`, `specFromCad` (l.978), `signOff`, `putBack`.
  - The gate sits in `apps/server/src/design.ts` `gated()` l.139 → `gatedCommit`, for agent actors only.
- **Commands** (SPEC `commands.ts`):

| Command | Line | Tool? | Behaviour |
|---|---|---|---|
| `pieces.setSpec` | 495 | tool | Writes the whole draft and records the lines that changed; refused with `spec_agreed` once agreed |
| `pieces.amendSpec` | 503 | tool | Named lines; `quote` required once agreed (verified, at least 12 characters); confirmed **on a card in both ways of working**; returns the check |
| `pieces.agreeSpec` | 534 | **people only** | Agrees the spec |
| `pieces.specFromCad` | 541 | **people only** | Writes a spec from measured facts; every line assumed |
| `pieces.buildFromSpec` | 548 | confirm | **Replaces the design**; approving it agrees the draft |
| `pieces.estimate` | 561 | tool | Estimate before building |
| `spec.history`, `spec.check` | 691, 699 | tools | History and check |
| `spec.signOff`, `spec.putBack`, `spec.stamp` | — | people only | Sign-off and repair |

- **Where the spec is drafted:** only in the CAD job or free chat (spec skill, photo skill `specDraft`, the cad recipe spec step). **The Design job never writes a spec**: no setSpec in its recipe or the board skill. The PLAN's "created in the Design stage" is not done. Generated images and briefs do not touch the spec.
- **How it reaches the model:** `context.ts specBlock()` (l.122, 224) gives "Spec: version N, agreed/draft", then every line as `- id (label): "value" [assumed] [words only, not measured] [out of date …]`, then the last check counts with not-met labels, then the sign-off state. It is built in `turn.ts contextSpec()` l.283, **once per user message**.
  - Inside a run, changes reach the model only through tool results: amendSpec returns `specVersion` plus the check, and design tools carry `specCheck` (`loop.ts CHECKED` l.1550).
  - `specNudge` re-sends the check at the end of a CAD job, at most twice.
- **Prompt:** SPEC `core.ts` l.25–34 "The spec is the source of truth", rules 1–8 (amend before change, quote, a refusal is information, the spec beats the picture, the designer signs off). SPEC `skills/{spec,photo,directions,editing,stone,production}.ts` were edited to match.
- **A piece that starts from an imported model:**
  1. openAsCad creates the piece with no spec (`kind:'other'`).
  2. A person can press "Write the spec from the CAD" (`apps/studio/src/components/SpecCard.tsx` l.112–140). `specFromFacts` (`spec/amend.ts` l.106) then gives `archetype` custom, default metal au18k-yellow (the node default), `body.heightMm` = the rescaled height (40 by default), `body.meshAssetId` and no stones. Every line is assumed.
  3. **The assistant cannot reach an agreed spec without destroying the import.** It can call `setSpec`, but its only route to agreement is `buildFromSpec`, which replaces the design. `agreeSpec` and `specFromCad` are for people only. Core rule 2 says a CAD job always writes the spec first.
  4. `buildFromSpec` keeps a mesh only for the `icedPendant`/sculpt recipe branch (`packages/schema/src/recipes/index.ts` l.340–358 makes a meshBody with `flatBack 0.5`, hollowed). Medallion uses `assetId` on a relief. Rings have none.
  5. The lines that can be checked on an import: `kind`, `metal.*`, `body.height` ±0.1, `body.thickness`, `body.mesh` (asset id). Stones fused into the mesh are invisible to the check.

## 6. Gaps against the founder's loop (what is missing)

1. **Routing:** no rule or tool to ask "straight to CAD, or pick an image design first, and shall I generate images?". The photo skill always goes to CAD. "Help me come up with more designs" has no route. Starters are fixed strings (UI `starters.ts`).
2. **CAD on Home:** the composer accepts images only. The server would accept a mesh asset id but skips it, and the model has no tool to open it (`openAsCad` is not a tool) or look at it.
3. **Import fidelity:**
   - Real size is lost (height defaults to 40 mm).
   - Objects, layers and materials are merged, so stones become metal.
   - No ring bore, no stone recovery.
   - `.3dm` and STEP are not readable (rhino3dm and OCCT are present for export only).
   - Board 3D models are invisible to the assistant and unusable as image references.
4. **Seeing a model:**
   - Capture works only on a piece's design.
   - Nothing chains capture (hero, top, side), then read (`references.read` on the captures), then a draft spec for a model the AI did not build.
   - Captures of a meshBody show no stones.
5. **Images:**
   - Nothing stops CAD-looking output, and the check judges safety only.
   - CAD snapshots or captures as `subject` will pull the look towards clay.
   - There is no "form-only" reference role and no realism check.
   - The brief's piece description is not carried to Take to CAD or to the spec.
6. **Spec upkeep:**
   - It is drafted only at CAD time. The Design job and image generations never draft or amend it.
   - No spec line records the chosen image.
   - For imported pieces there is no assistant path to an agreed spec that keeps the import.
   - Context spec is per user message, not per tool round (amend results carry the new version).
7. **"A different version" of an import:** `proposeDirections` needs a spec, template or mix (parametric) and `duplicate` copies the mesh as it is. The only realistic route is images first (from captures, made to look like real jewelry), then Take to CAD.
8. **Merge:** spec/truth and ui/focus must be merged before building on both: they overlap in jobs.ts, commands.ts, entities.ts and assistant UI files.
