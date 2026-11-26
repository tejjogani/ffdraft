# Own CAD and routing: start from words or from your own CAD, see real jewelry first, ask the route only when it is unclear, keep the spec current

Build brief. Target file: `docs/plans/own-cad-and-routing.md` (MAIN `docs/agents/BOARD.md` row A15). Extends [`spec-truth.md`](./spec-truth.md) (SPEC branch), [`assistant.md`](./assistant.md), [`ideate-and-freeform.md`](./ideate-and-freeform.md) and [`reference-match.md`](./reference-match.md); it changes none of their undo, approval, caching or quote rules, except the one named in 4.1 (from the assistant, `pieces.setSpec` writes the first draft only). It builds the bore fit and the `.3dm` read that [`freeform-cad-additions.md`](./freeform-cad-additions.md) step 19 plans, in the shape step 19 asks for. Evidence: [`own-cad-and-routing/survey-code.md`](./own-cad-and-routing/survey-code.md) (code, 26 Nov) and [`own-cad-and-routing/research.md`](./own-cad-and-routing/research.md) (web, tagged O/L/R/S/K). Paths: **UI** = `/home/user/ffdraft-ui` (ui/focus), **SPEC** = `/home/user/ffdraft-spec` (spec/truth). **This plan starts after the two branches are merged** (step 0, which has its own plan and review).

The founder: "you go from the human prompting to the AI making an initial version … or the human starts with a CAD they make in the software or import … and tells the AI to make a different version … What if somebody has a CAD? … use our current hero, top and side viewfinders to get an idea of what the jewelry piece is, and then make some better designs. But … we never give back a CAD-looking image unless they ask for it. We always pitch a real jewelry design … then we go to CAD from there … we want the AI to think and say: do you want me to go to CAD directly, or help you pick an image design first? … unless they are clearly following the flow … the core description used by the verifier will need to be updated every time the AI suggests an update to the design … always passed in as a tool the AI can always pick."

**For the founder, in plain words.** You can start from words, from a CAD you made in Pavé, or from a file you drop on Home, with or without renders. A dropped file is read straight away. Pavé measures what can be measured: the true size, the ring size from the inside of the band, the metal weight, and, in a Rhino file whose stones are separate objects, how many stones and how wide. Cut, carat and claws from a file come later (phase 2); until then the AI names the cut from the views and says so. The chip shows the file's own hero view, and the first reply shows hero, top and side views and says plainly what the file cannot tell (which gold, natural or lab). If you ask for more designs, the AI pitches four photographs of real jewelry, never a grey CAD-looking picture unless you ask for one. Code and a second check drop anything that looks like a render; if nothing passes, you see none and a one-line offer to try again. You pick one, and the CAD is built from it, as a new version when the original is your file or a signed-off piece, so the original stays as it was. The AI does not quiz you. When your words or your press make the route clear it goes on and says so, and its first go-ahead card carries the other way as a quiet link ("Make four pictures · *or go straight to CAD*"). It asks a separate question only when it genuinely cannot tell: a file dropped with no words. Throughout, the spec (the description the checker holds the CAD to) is written once and then changed only through the amendment tool. While things are still pictures, each change is one quiet line you can undo; once agreed, it needs your words and your press, as today.

The key choices, one line each:
1. **The model decides the route; code shows it the facts and keeps the gates.** A facts-only *Flow* block in the context, a signal table in a new route skill, and the existing "ask before spending or replacing work" confirm tools. One card per decision: the route rides on the first go-ahead card as its second way, and a separate route card (`chat.route`) appears only when the signals disagree.
2. **Reading a model is one free tool, `references.readModel`.** Code measures, and the main model names. It returns hero, top and side shots in a metal studio look (never grey clay), the facts code measured, a draft spec whose lines are tagged *measured*, *named in your file*, *from your render* or *assumed*, and what the file cannot tell. It runs as the file uploads.
3. **The spec is written once and every later change by the assistant goes through `pieces.amendSpec`.** One writer per first draft: the assistant's `setSpec` or `create {spec}` for words and photos, the server for a file (from the read, when a piece is made from or bound to it). On a draft this needs no quote and no card (true today) and shows a quiet line with Undo; on an agreed spec it needs a quote and a card (spec-truth). Every picture is bound to the spec version it was made against. A brief that departs from a line the person stated or the file measured is refused in code unless the departure is declared as that direction's change.
4. **Every picture is a photograph of a real piece** unless the person's own words or press ask for another look. Our CAD views go in as *form* references (shape only) and are never pictures on the board. Code bans rendering words from the prompt and drops near-copies of our views. The vision check drops CAD-looking pictures with seven yes/no cues and an A/B comparison run both ways round. Nothing CAD-looking is ever shown as a fallback.
5. **"A different version" never overwrites what was agreed or imported.** A version is a sibling project ("Okafor halo · B") with the spec copied as a draft. A version of an imported mesh is rebuilt parametrically and fitted to the file's own views, with known cameras and true scale.

## 0. What exists today (26 November 2026; `survey-code.md` §1–6)

| Area | Today | File |
| --- | --- | --- |
| Home composer | Images only (`f.type.startsWith('image/')`, `accept="image/*"`, "Drop photos"); a dropped `.stl`, `.3dm` or `.step` is ignored without a word. The server takes any asset id but tells the model "a format you cannot read". Home attachments never reach a board | UI `features/assistant/Composer.tsx` l.87, 193; `apps/server/src/assistant/turn.ts` `userContent()`; `loop.ts bindPiece` |
| Route | Prompt text only. A specific brief goes to spec and build, an open brief to the board, any photo straight to CAD. Nothing asks the route, and "more designs" has no route | SPEC `prompt/skills/{spec,board,photo}.ts`, `core.ts` l.38 |
| Questions and go-ahead | `chat.ask` (confirm, at most 3, 5 from a picture); `runs.decide` approve or deny with a note and `answers`. In Do it all, recipe confirm tools are admitted with no card (`jobs.ts jobAdmission`) | SPEC `commands.ts` l.1880 (`chat.ask`), l.1858 (`runs.decide`) |
| Importing 3D | `pieces.openAsCad` (not a tool) accepts STL, OBJ, GLB, 3MF, PLY. The result is one welded solid with stones fused into the metal, rescaled to 40 mm tall, laid flat in au18k-yellow. STEP is refused; `.3dm` is known to the asset table but read by nothing | `apps/server/src/ideas.ts` l.96; `kernel/src/features/meshBody.ts`; `assets/assets.ts` l.33 |
| Facts of an import | Bounds after the rescale, one alloy's volume, thin walls. No band (only a `ringShank` gives one; `MeasuredFacts.band` requires `nodeId`, widths, thicknesses, `profile`, `shoulder`), no stones | `kernel/src/evaluate/measured.ts`; SPEC `spec/facts.ts` l.84–95 |
| Image fit | `match.fit` needs a plain background for its matte and refuses honestly otherwise; the photo skill calls it after a build when `cutout.ok` | SPEC `handlers/match.ts` l.3, 41; `prompt/skills/photo.ts` l.16 |
| Seeing a model | `viewport.capture` works on a piece's design only (studio window, else server clay). Board models, Home files and unopened files cannot be seen | `client-tools.ts` l.42; `assistant/capture.ts` |
| Image brief and check | One view, even light, "a plain, seamless, light grey or white background … so the piece can be cut out and modelled in CAD". The brief is not given the spec. The check covers safety only ("poor, off-brief or not jewelry is allowed"). Roles are `subject, style, identity, layout, product` (SPEC `entities.ts` l.439); a 3D reference is refused. A board is required (`briefRequest.boardId`). One brief per `references.generate`. Take to CAD lives in `ideate/{DesignBoard.tsx,actions.ts,GeneratePanel.tsx}`, `jobs/JobMode.tsx`, `projects/BringIn.tsx` and `PieceDirections.tsx` | `packages/agent/src/imagegen.ts` l.50–68; `imagegen/pipeline.ts picture()` l.161; SPEC `commands.ts` l.244, 1160 |
| Spec | `setSpec` writes the whole draft, any number of times, and is refused once agreed. People call it on existing drafts: the spec card edit (UI `components/SpecCard.tsx` l.112, 150; source `card`), a template in CAD (`cad/index.tsx` l.381), `PieceDirections.tsx` l.126. `pieces.create {spec}` and `pieces.chooseDirection` also write a whole spec (`loop.ts DRAFT_WRITES` l.1701). Prompt text sends the model to `setSpec` on existing pieces: `references.read` description (commands.ts l.1200), photo skill l.20, core.ts l.28/38. `amendSpec` changes named lines; `specNeedsPerson` makes it wait for a card **only once the spec is agreed**, so on a draft it runs with no quote and no card. `agreeSpec` and `specFromCad` are people only. The Design job writes neither. An import's only route to agreement is a build that replaces it | SPEC `commands.ts` l.495–561; `apps/server/src/spec.ts` l.436; `jobs.ts` |
| Variants | Parametric directions only; `duplicate` copies design and spec but not the board | UI `features/directions/`; SPEC `handlers/pieces.ts` l.442 |
| Parts to reuse | rhino3dm 8.35 (export only), the GLB writer, per-cut girdle outlines (`kernel/src/gems/outline.ts`), the gem table, `specFromFacts`, `@pave/match` with known cameras (`FitInput.cameras`) and `TargetView.spanMm` | `research.md` §3.3; `packages/match/src/types.ts` l.82, 156 |
| Image models | No `gpt-image-2.6-*`; `gpt-image-1` is listed but was shut down on 23 October 2026 | `packages/ideation/src/openai.ts` |

## 1. Experience

### 1.0 What the person never has to do

- **Answer the route twice, or answer what is already settled.** A message that settles the route gets no question; the assistant says the route in its first sentence and goes on. A ring size read from the bore is never asked. A route chosen for this project is reused ("Pictures first, as before").
- **See a CAD-looking picture they did not ask for**, or the check, the rejects and the retry. They see four photographs, or three and one quiet line.
- **Read a spec card while ideas are loose.** Draft changes are one quiet line with Undo. A card comes only when something is agreed, built, spent or replaced.
- **Lose their file's truth.** An import opens at its real size; the file stays on the board and in References; nothing the assistant pitches changes it.

The look is the studio's own (`docs/design-language.md`): Notion-calm columns, the orb as the only working sign, glass on chrome only, numbers on solid chips. Nothing here adds a panel, a tab or a stepper.

### 1.1 Journey A: a prompt, a first version, then chat and hand tweaks

**A1. A specific brief: straight to CAD, no question.** On Home: "1.5 ct oval, hidden halo, 18k yellow, size 6".
1. The words are specific and measurable, so the route is CAD. The assistant says "An oval with a hidden halo, as you described: here's the spec and what it would weigh." It calls `pieces.create`, then `pieces.setSpec` (assumed lines named), then `pieces.buildFromSpec`.
2. The build card is the only ask, as today: spec lines, estimate, **Agree and build**. New: a quiet second link under the button, *Show me pictures first*. This is the founder's question, offered without an extra card.
3. Pressing *Show me pictures first* declines the build with `instead: 'pictures'`. The route is recorded for the project, the spec stays a draft, and the next card is A2's generate card. No second question is asked.

**A2. An open brief: pictures first, no question.** "Something for our tenth anniversary, a bit vintage."
1. "Vintage can go several ways. I'll show you four: milgrain with a cushion centre, an Edwardian halo, a three-stone, an engraved band." The pictures are the question. No questions card comes first, and size questions wait for Take to CAD.
2. The assistant creates the project and writes the first draft (`setSpec`: ring, five lines, four assumed). Quiet line: *Spec draft started · ring · 4 assumed*.
3. It writes four briefs, one per direction. Each declares its changes from the draft (`direction.changes`, e.g. `stones.side: 2 round`). One generate card covers all four, one picture per brief: "Four picture ideas · about $0.20 · 30 s", **Make them**, and the second way *or go straight to CAD*.
4. Four photographs come back as tiles in the conversation (Take to CAD · More like this · Pin).
5. "The second, but in white gold." The assistant amends the draft (`amendSpec`, no card on a draft): *Spec draft · Metal 18k yellow → 18k white · Undo*. Then it refines the picture (one generate card).
6. **Take to CAD** applies that picture's declared changes to the draft as the person's amendment (source `picture`), then runs the existing CAD job. The size questions skip what the draft states; then comes the build card. If the pick changed lines, one sentence says so: "This picture has three stones; your spec had one. I've set the spec to the picture." A line the person stated after the picture was made is kept, not overwritten (4.5). After the build, the photo skill fits the CAD to the picture (`match.fit`) when the picture's background gives a clean matte (D2); otherwise it says "built from the spec; the backdrop is too busy to trace" and offers the side-by-side.

**A3. Chat tweaks after the build** are unchanged from spec/truth. "Make the band thinner" amends first, with a quote and a card on an agreed line, then edits. A change that touches no line (a claw turned) edits directly, with one quiet line and Undo.

**A4. Hand tweaks in the focused CAD editor** are never interrupted. The existing *Differs from the spec* chip offers **Update the spec** and **Put it back**. The assistant sees the edit on the next message (`designerEdits`) and mentions it only when the request touches it ("You widened the band to 2.4 mm; I'll keep that").

### 1.2 Journey B: their own CAD made in Pavé, then "a different version"

The project has a parametric CAD with an agreed or signed-off spec. In the focused editor: "can you make a different version of this?"
1. The words are open and a CAD exists, so the route is pictures **from this CAD**. No route card: the generate card carries the alternative. "I'll pitch four photographs that keep your 1.5 ct oval and size 6."
2. The briefs carry `shapeFrom: { pieceId }`. The server renders hero, top and side in the reference look (the alloy's colour, dark-contrast stones, a soft studio gradient). They go in as `form` references and are kept in each generated tile's details ("Sent as shape"), never as board pictures, so they cannot be picked, varied or used as style.
3. Against an agreed spec, each brief is bound to the spec version, and each direction declares its changes (`stones.halo: none`, `ring.shoulder: split`). The spec does not move.
4. Generate card: "Four picture ideas from your ring · about $0.20", **Make them**, *or try CAD variants instead*. The second way starts today's *Try variants* flow; on an agreed spec that first makes a version (1.2 step 5).
5. **Take to CAD** on a pick of an agreed piece makes a new version without asking ("keeps this one as signed off"), with a quiet link *Change this CAD instead*. The link opens the amendment card drawn by the studio; the person's press on it calls `amendSpec` as the person (source `picture`), so no quote is involved and the assistant is never let off the quote. A new version is a sibling project, *Okafor halo · B*, with "From Okafor halo" on its card. Its spec is A's copied as a draft with the pick's changes applied; then come the size questions and the build card, which lists every line that differs from A's agreed spec ("Changed from Okafor halo v3: halo none, shoulders split"), so the draft amendments without cards are all seen once before anything is built.
6. A specific request ("same ring with an emerald-cut centre") asks nothing. "I'll make that as version B so A stays signed off." The assistant calls `pieces.duplicate { as: 'version' }`, amends B's draft, and shows the build card on B.

The *Try variants* sheet gains **Picture ideas from this CAD**, so the person can start this without typing.

### 1.3 Journey C: a CAD imported or attached on Home, then "help me come up with some more designs" (the founder's case)

As phase 1 delivers it. Phase 1 reads every file as one merged body, except that in a `.3dm` the objects that are block instances or sit on a stone-named layer are kept apart as stones: counted, placed and measured by girdle width, drawn dark in the shots and left out of the metal weight (step 9). Cut, carat and claws from a file are phase 2.

1. The person drops `solitaire.3dm` on the Home composer, perhaps with two renders. The overlay reads "Drop photos or 3D models". Detection goes by extension (browsers give `.stl` and `.3dm` an empty `File.type`). The chip says "Reading…", then shows the file's own hero view. On hover: "Ring · US 6½ · 1 stone, 6.42 mm". An unreadable file keeps its chip, with one line under the composer: "This .3dm has no saved meshes. Re-save it in Rhino without *Save small*, or export STL."
2. They type "can you help me come up with some more designs?" The Flow block shows 1 model (read), 2 pictures, no project and no route. CAD attached plus "more designs" means pictures first, so there is no route card.
3. The reply opens with a **What I read** card:
   - three views on solid tiles (hero, top, side) in the metal studio look, the stone dark-contrast;
   - one mono line: *Ring · US 6½ (16.92 mm bore) · 1 stone, 6.42 mm wide · 2.0 mm band · 3.1 g without the stone*;
   - each value tagged *from your file*; the alloy tagged *named in your file* ("18K Yellow" layer);
   - one muted line: *Not in the file: natural or lab. Not read yet: cut and claws.*
   The assistant names what it sees and says so: "A four-claw solitaire with a round, from the views (≈ 1.00 ct if it is a round brilliant). I'll pitch four photographs of new directions that keep your stone and size." Its names go into the draft as one amendment of assumed lines (cut round, 4 claws, archetype solitaire).
   - **An STL, or a `.3dm` with the stone fused in:** the line reads *1 piece · 3.4 g including any stones*, the shots show one metal body, and the card says "The stones are joined to the metal, so I can't count them; tell me the stones or attach a render." The shots go to the generator as `form` with the label "stones are not shown in metal colour; follow the stone layout described".
4. **Renders attached:** they are read (`references.read`, a Claude call; the card's footer says "Read 2 renders · $0.01") for colour and categories only. If the renders show white metal against the "18K Yellow" layer, the card says so in one line and the draft keeps the file's value with an open question. If a render shows three stones and the file has one, the file wins and the card says "Say if the render is the newer one."
5. The assistant creates the project, its first action that needs one, so a Home chat that only asks about a file creates nothing. `bindPiece` pins the thread's attachments to the board (the file as a 3D model, the renders as pictures), and the server writes the first draft from the read (source `from-model`; measured lines not assumed). The model does not call `setSpec` here.
6. Four direction briefs follow, each `shapeFrom` the file and each declaring its changes (cathedral six-claw: `stones.center.prongs: 6`; hidden halo: `stones.halo`; split shank; bezel). The person's renders go in as `style`. One generate card: "Four picture ideas from your ring · about $0.20", *or open it as CAD*.
7. Four photographs come back: real metal, a soft contact shadow, a three-quarter perspective, crisp dark facets. "All four keep your 6.42 mm stone and size 6½."
8. "I like the second, but can the stone be bigger, like 2 carats?" The assistant amends the draft: *Spec draft · Centre stone ≈ 1.00 ct (6.42 mm, from your file) → 2.00 ct · Undo*. Then it refines the picture.
9. **Take to CAD:** "Your file is one solid body, so I'll build this as new CAD and keep your file beside it to compare." This is a version of the import project, *Solitaire · B*, built from the draft plus the pick, then fitted to the file's own views (section 6). The size questions skip the ring size (measured) and ask what the file could not say.

**Phase 2 adds** (steps 29–32): cut and girdle from the file's outline, carat from Pavé's table, claws from the metal, lots for halos and pavé, and stones in STL, OBJ, GLB and 3MF files that keep them as separate bodies. The headline becomes "1 round ≈ 1.00 ct · 4 claws", tagged *from your file*.

Inside a project the same flow starts by hand: the Design board's model tile menu gains **Picture ideas from this model** and **Rebuild as a version** beside **Open as CAD** (every stage by hand); CAD's **Bring in › A 3D model file…** accepts `.3dm` and opens at real size ("Opened at its real size, 22.4 × 18.1 mm").

| Attached | Words | Route |
| --- | --- | --- |
| Renders only | "more designs like this" | Pictures. `references.read` drafts the spec from the renders; the renders are `subject` |
| Renders only | "build this" | CAD: the existing photo skill (questions, estimate, build) |
| Renders and the CAD | "more designs" | Pictures: numbers from the file, colours from the renders, our views as `form`, renders as `style` |
| A clay render or a viewport screenshot | "more designs" | Pictures. The brief read flags it as CAD-looking and the server forces `form`, so its grey look never leaks into the photographs |
| The CAD | "photos of this", "renders" | Render stage (Blender), not new designs |

### 1.4 Journey D: an imported CAD, straight to CAD

1. **"Open this as CAD" or "edit this".** The route is the file as it is. The assistant calls `pieces.openAsCad` (now a tool) at real size; `openAsCad` is the one writer of the draft (from the read, source `from-model`), and the model then names the unmeasured lines in one draft amendment. The What I read card follows, then one card: **Agree this spec and keep your file** (`pieces.agreeSpec`, now a confirm tool). It lists the measured lines, the assumed ones ("18k yellow, named in your file"), and what a solid body cannot have checked ("stones: joined to the metal, not checked"). From then on the verifier has a spec for the import.
2. **"Resize it to a 7 and make it platinum"** on `band.stl`. The STL has no units; it is read as mm (jewelry is), which a 16.9 mm bore confirms, and no gems are found. He said size 7, and keeping the file cannot deliver it, so there is no route card: "Only a rebuilt band can be resized, so I'll rebuild it in Pavé as a version; your file stays as it is." The build card carries the other way as its link: *Keep my file, platinum only (size stays 6½)*.
3. Rebuild runs these steps:
   - `pieces.duplicate { as: 'version' }`;
   - `amendSpec` on the version's draft (size 7 and platinum, which he said);
   - `pieces.buildFromSpec` (the build card agrees it and lists the lines changed from the file);
   - `match.fit { fromPieceId }` against the original with known cameras; the changed lines are pinned, so the fit never pulls size 7 back;
   - `spec.check`: every line met.
   The original stays pinned as a 3D reference.
4. **"What do you think?" with a file:** the assistant answers from the read ("A clean four-claw solitaire; the band is 2.0 mm, fine for daily wear…") and ends with one line of offer in words ("I can pitch four new directions from it, or open it as CAD"). No card.
5. **The CAD with no words:** route card ● **Four picture ideas from it** ○ **Open it as CAD** ○ **Photographs of exactly this piece** (Render stage, with its cost).

### 1.5 The card budget

A Playwright test counts the cards each journey shows (section 11).

| Journey | Cards answered before the first result | Before the CAD is built |
| --- | --- | --- |
| A1 specific brief | 0 | 1 (build) |
| A2 open brief | 1 (generate) | + size questions + build |
| B a different version | 1 (generate) | + size questions + build on B |
| C CAD + "more designs" | 1 (generate) | + fewer size questions + build |
| D open as CAD | 1 (agree and keep) | — |
| D resize a welded mesh | 0 | 1 (build, with *keep my file* as its link) |
| D "what do you think?" | 0 | — |
| D file with no words, pictures picked | 1 (route; its priced option approves the generation) | as C |
| Any journey started as a Do it all job | 0 (the job start settled the route; recipe confirms admitted, no second-way link) | 1 (build, which asks in every way of working) |

### 1.6 Screen by screen

| Screen | Change | File |
| --- | --- | --- |
| Home composer | Accepts `.stl .obj .glb .gltf .3mf .ply .3dm` by extension (a `.gltf` with external buffers gets "export GLB"), and `.step` with a "not yet" line. "Drop photos or 3D models". Placeholder: "Describe a piece, or drop a photo or a CAD file." Limit 8, counting both. A model chip shows the read's hero view or the unreadable line | UI `pages/home/Composer.tsx`, `features/assistant/Composer.tsx`, `stores/assistant.ts` |
| Conversation | New rows in `minimal.ts`: **What I read** (result), **picture tiles** (the kept pictures of a generation), **spec draft line** (quiet, with Undo), **route card** (`chat.route`, drawn by `QuestionsCard`). The go-ahead card gains the second-way link. A draft write is no longer counted in "Made N changes" | UI `features/assistant/{minimal.ts,MessageView.tsx,ApprovalCard.tsx,QuestionsCard.tsx}`; new `ReadModelCard.tsx`, `PictureTiles.tsx`, `SpecDraftLine.tsx` |
| Design board | Model tile: **Picture ideas from this model**, **Rebuild as a version**. Generate panel: **Look** (Photograph, Clean for CAD, Technical drawing, Sketch) and **Shape from** (none, this project's CAD, a board model). Tile details: "Made against spec v3 · Kept: 1 centre, 6 claws · Sent as shape: 3 views", and a mark when it differs | UI `features/ideate/{DesignBoard,GeneratePanel,board}.tsx`, `actions.ts` |
| Focused CAD editor | Bring in accepts `.3dm` at real size; *Try variants* gains **Picture ideas from this CAD**; Take to CAD on an agreed piece makes a version, with *Change this CAD instead* as a link, in every place Take to CAD lives (§0) | UI `features/projects/{bring-in.ts,BringIn.tsx}`, `features/directions/TryVariants.tsx`, `features/assistant/jobs/JobMode.tsx`, `features/ideate/{DesignBoard.tsx,actions.ts,GeneratePanel.tsx}`, `features/cad/empty/importers.ts` |
| Spec panel | Each line's tag: *you said*, *from your file*, *named in your file*, *from your render*, *from the picture*, *assumed*; the chosen picture | SPEC `features/spec/` |
| Project cards | A version's facts line reads "From *Okafor halo*". A project started from a file shows the file's hero view as its CAD cover until built or opened | UI `features/projects/AreaCards.tsx`, `areas-view.ts` |
| Starters | In CAD with a design, the third starter becomes "Picture ideas from this CAD" | UI `features/assistant/starters.ts` |

## 2. The route decision

**Who decides.** The model decides, from the person's words and a facts-only **Flow** block in the context (8.6). Code does not classify the route. It enforces three things: the existing confirm tools (spending, replacing, agreeing), the route card's labels and prices (written by the server), and the route-card timing rules below.

**Signals** (the route skill, `skills/route.ts`):

| Signals | Route | It says, and the one card |
| --- | --- | --- |
| A measurable brief: cut, carat, metal, size, a templated archetype | `cad` | "Here's the spec and what it would weigh." Build card, with *Show me pictures first* |
| "build", "model", "CAD", "STL", "printable", or a change to a parametric CAD | `cad` | One line, then the edit or the build card |
| Open words: "ideas", "something for", "more designs", "variations", "a different version", "what would it look like", mood or era | `pictures` (from the CAD when one exists) | "I'll show you four: …" Generate card, with *or go straight to CAD* (or *or try CAD variants instead* on a parametric CAD) |
| A CAD attached or open, with "more designs", "better", "different" | `pictures` from that CAD | What I read, then the generate card with *or open it as CAD* |
| A CAD attached with "open", "edit", or a change only to its metal | `openFile` | What I read, then *Agree this spec and keep your file* |
| A CAD attached with a size, stone or band change on a mesh | `rebuild` (only a rebuild can do it) | "I'll rebuild it as a version; your file stays." Build card, with *Keep my file, {metal} only* when a metal change was also asked |
| A CAD or render with "photos of this", "renders" | `render` | "I'll set up the shots." Render job start |
| A file with "what do you think?" or another question | none yet | Answer from the read, then one line offering pictures or CAD in words. No card |
| A file with no words | **ask**: `pictures`, `openFile`, `render` | Route card |
| A press or job that settles it: a Design, CAD or Render job started, Take to CAD, *Picture ideas from this model/CAD*, *Rebuild as a version*, the Generate panel | the pressed route, stored `by: 'person'` | No card; `chat.route` is refused in that run (409 `route_settled`) |
| A route chosen for this project before, no new brief | that route | "Pictures first, as before." No card |
| Two signals pointing two ways in the words themselves | **ask** | Route card |
| No image key | `cad`; never a pictures option | "Pictures are off on this account; I'll go to CAD." |

**When it goes straight on.** Whenever one row matches, which is every row but two (a file with no words; two signals pointing two ways in the words). It says the route in its first sentence. The first spending or replacing go-ahead card of a project with no route carries the other way as a link. Pressing it declines the call (`runs.decide { decision: 'deny', instead }`), and the tool result is `{ declined: true, instead }`. The route is stored `by: 'person'`, and the model proceeds on the other route without asking again. The link appears only on that first card, so it never becomes clutter.

**When it asks, and exactly what.** Only in the **ask** rows. It asks once, before the first action, never midway. The card is `chat.route`, drawn by `QuestionsCard` as one single-choice question:
- an intro of one sentence in the person's terms ("How shall I change your band?");
- two or three options from `ROUTES`, the recommended one preselected;
- each option's label, hint and cost are written by the server, never the model (from `references.estimate`, `pieces.estimate`, the render estimate): "Four picture ideas from it · recommended: you dropped a file without saying · about $0.20 · 30 s".
- with no image key, the pictures option is left out; with only Higgsfield (which cannot see references), `shapeFrom` options are left out and the card says why.

When the person presses a priced **pictures** option, the run gets a one-use grant (`run.grant`) for one `references.generate` up to that count and price. The generate call then runs without a second card. A dearer call still asks, and the grant is consumed once (`UPDATE … WHERE used = false RETURNING`).

**Memory and modes.**
- The answer (route card, second way, a press, or stated in words) is stored on `piece.route`, or on `thread.route` until a project exists (moved by `bindPiece`).
- **Who decides a new brief:** the model, with the person's words as evidence. It passes `newBrief: { quote }` on `chat.route` (or on the first go-ahead whose card would carry the link); the quote is verified like an amendment quote. Code clears the stored route only on a verified quote or a new project.
- A job started by a press has settled the route. In Do it all every job starts that way, so `chat.route` is never needed there (409 `route_settled`), recipe confirm tools run without cards as today (`jobAdmission`), and the second-way link does not appear.
- In Check with me, the route card is one more confirm, like `chat.ask`.

## 3. Reading an imported or attached CAD

**When.** The studio calls `references.readModel { assetId }` as soon as a 3D file is uploaded: on Home, the board, Bring in or the CAD empty state. The call is free, code only, and cached by content hash and reader version, so a Send costs nothing extra and the chip can show the hero view first. The cache row holds no asset id: two assets with the same bytes share one read, and `source.assetId` is filled per call. The asset, piece or reference must belong to the caller's organisation (a Home asset belongs to its thread's owner before any piece exists); anything else is `not_found`. Cancelling the run or closing the upload aborts the worker job and frees its slot; a read that never finished leaves no row. The assistant gets the read in the context and its three shots as labelled image blocks in the user content. It can also call the tool on a `pieceId` (its own or an opened design) or a board `referenceId`.

**How (`packages/kernel/src/import/`, run in the server's kernel worker with caps: 60 s, 3 M triangles, 150 MB):**
1. **Parse to an `ImportScene`** (objects with name, layer path, material name, user strings, hidden flag, block definition and transform, mesh in file units). Phase 1 merges the objects for measurement, except `.3dm` block instances and objects on a stone-named layer (`gem`, `diamond`, `stone`, `melee`, any language in the names dictionary), which are kept apart as stones; phase 2 classifies everything. `.3dm` goes through rhino3dm: units, layers, materials, user strings, instance definitions with transforms, and the meshes Rhino cached on each face. Plug-in data is never decoded (`File3dmPlugInData` is empty in rhino3dm, research §3.3 L). A solid with no cached mesh is `no_mesh`.
2. **Units to mm.** From the file (`modelUnitSystem`, 3MF `unit`, glTF metres). Otherwise mm, as jewelry files are, unless mm gives an impossible piece (largest extent under 2 mm or over 300 mm), then the unit that puts a found bore at 13–24 mm or the extent at 5–120 mm. Never a question: the read states the unit ("read as mm") and the card offers a one-press fix ("It was inches").
3. **Measure.** Ring or not comes from a through hole: the bore is twice the smallest radius over the sections, the definition `MeasuredFacts.band.boreMm` already uses. An import has no band node, so it gets a bore-only fact, `MeasuredFacts.bore { boreMm, rms, widthBaseMm?, thicknessTopMm? }` (8.2). Band width at the base and thickness at the top come from a plain section, or are left out and listed. Metal volume and weight come from the closed meshes, without the stones kept apart. In phase 2, gems, cutters and metal are classified, then the cut, girdle size, carat, claws and lots are measured (table below).
4. **One evaluation, one set of facts.** The facts are produced by evaluating a transient design built exactly as `openAsCad` would build it (`meshBody size: 'file'`, `ringAxis` when a bore is found, and in phase 2 a `stoneSet` per lot). So a file opened later measures the same, and a fresh import never shows "Differs from the spec". The same transient design renders the hero, top and side shots in the reference look: the studio window when one is open, otherwise the server through the match shader.
5. **Draft.** `specFromModelRead` (on `specFromFacts`) builds `specDraft` with `basis` per line and `assumed`. The server is the one writer of an import's first draft: it writes `specDraft` (source `from-model`) when a piece is created from the file, when `bindPiece` pins it, or in `openAsCad`, whichever comes first, and never twice. The main model then names what code does not measure (archetype, cut in phase 1, setting style, claw tips, shoulders, style words) from the shots in one draft `amendSpec`, all assumed. It never restates a number from the shots.

**What is measured, read from pictures, assumed, or never claimed:**

| Fact | How | Tag on the line | Unsure or unknowable when |
| --- | --- | --- | --- |
| Units, overall size | File units; else mm unless impossible | *from your file* (a note when inferred) | Never asked: stated, with a one-press fix |
| Kind | Ring from a 13–24 mm through hole; otherwise named by the model from the shots | ring: *from your file*; others: *assumed* | — |
| Archetype, setting style, style words | Named by the model from the shots | *assumed* | Always a name, never a number |
| Ring size | Bore fit, twice the smallest radius; rms is the roundness | *from your file* | rms > 0.15 mm (euro or square inside): *assumed*, warning |
| Band width (base), thickness (top) | Sections at 6 o'clock and the first plain section near the top | *from your file* | No plain section: left out and listed |
| Metal weight | Manifold volume per part × the alloy's density, stones subtracted | facts; the card says "if 18k yellow" while the alloy is assumed | — |
| Alloy | Layer, material, object name or user strings through a dictionary (`18k`, `750`, `14k`, `585`, `pt950`, `925`, `YG/WG/RG`) | *named in your file* (stays in `assumed`) | No name: au18k-yellow, *assumed*. A render gives the colour family, *from your render*, karat assumed |
| Stones: count, positions, girdle width (phase 1, `.3dm` only) | Block instances and stone-layer objects; width from the definition's outline in its own frame | *from your file* | Fused into the metal: "including any stones", said plainly |
| Stones: lots (phase 2, every format) | Gem bodies or block instances; lots by size, cut and pattern (halo, row with coverage, pavé field, single) | *from your file* | Fused into one STL shell: unknown, said plainly. Casting STL: unknown (seats are a scope cut) |
| Cut, width, length, depth (phase 2) | Girdle outline compared with Pavé's own outlines at the measured ratio, plus the depth ratio. Confidence is the margin over the second-best cut | *from your file* | Margin < 0.03: *assumed*, warning |
| Carat (phase 2) | `gemCarat` on the measured size: Pavé's table, the one the check uses | *from your file* ("as diamond") | Material assumed: carat "as diamond" |
| Claws, setting (phase 2) | Metal sliced 0.2 mm above each girdle inside 1.2× its radius: n loops → n claws; one surrounding loop → bezel | *from your file* | Unclear: `unknown`, not in the spec |
| Stone material | Names, material IOR ≈ 2.42 | *named in your file* | No name: diamond, *assumed* |
| Natural or lab, colour and clarity grades, plug-in history | — | never claimed | Always; listed in `cannotTell` |

Only *from your file* lines with high confidence leave `assumed`, because the file is the person's own statement. Names (layers are not stable between files, research §3.2 R) and renders stay assumed, tagged with where they came from.

**Phases.** Phase 1 (steps 3–9) reads STL, OBJ, GLB, 3MF, PLY and `.3dm` cached meshes as one merged body: true size, bore and ring size, weight in one alloy, alloy names from the layers, and in `.3dm` the stones kept as separate objects (count, positions, width; cut named by the model, assumed). The founder's loop works on phase 1 as Journey C describes it; for a file with fused stones the pictures follow the stones the person or the model states. Phase 2 (steps 29–32) recognises gems and cutters in every format, measures cut, carat, claws and lots, and draws the stones as Pavé stones (`stoneSet`) at the file's positions, so renders, per-alloy weight and the stone lines of the check are right for the piece as it is.

**What Pavé says when it cannot know:**
- "Your file doesn't say which metal: I assumed 18k yellow."
- "The stones are joined to the metal in this STL, so I can't count them. Attach the .3dm or a render, or tell me the stones."
- "This .3dm has no saved meshes. Re-save it without Save small, or export STL."
- JewelCAD `.jcd`: "Export STL from JewelCAD."
- STEP: "STEP can't be read yet; export STL or .3dm."

## 4. The spec: a draft from a model, and every later change through `pieces.amendSpec`

1. **One write, then amendments.** The first draft has one writer: the assistant's `pieces.setSpec` or `pieces.create {spec}` (words, a photo read), or the server for a file (§3, point 5). **From the assistant**, `setSpec` on a piece that has a spec is refused (409 `spec_exists`: "change named lines with pieces.amendSpec"). Every later change by the assistant, in every recipe and in free chat, is `pieces.amendSpec`, the one tool the founder asked for.
   - **People keep their whole-spec writes** (the spec card edit, a template in CAD, `PieceDirections`), refused once agreed as today. The server records each as the line diff (`changed`), so the history and the mid-run note still name lines.
   - **`pieces.chooseDirection`** from the assistant on a piece with a spec is recorded as one amendment of the lines that differ (source `direction`), under the same quote and card rules as `amendSpec`.
   - **The prompt and tool texts that send the model to `setSpec` on an existing piece change in the same PR as the rule** (§13, step 16): the `references.read` description ("…then write the first draft with pieces.setSpec, or amend named lines when the piece has a spec"), photo skill l.20 ("Rebuild through one pieces.amendSpec of the changed lines, then pieces.buildFromSpec"), core.ts l.28 and l.38 ("setSpec for a new piece; every later change is pieces.amendSpec").
   - **On a draft:** no quote and no card, as today (`specNeedsPerson` is false until agreement). The conversation shows one quiet line, *Spec draft · Centre stone 1.00 ct → 2.00 ct (was from your file) · Undo*. Undo is a person's amendment back, source `undo`. Undo is offered only while the line still holds that value and the spec is still a draft; otherwise it is disabled ("changed since").
   - **On an agreed spec:** a quote and a card in both ways of working, unchanged from spec-truth. The source `picture` never lets the assistant off the quote: a press-made change on an agreed spec is the studio calling `amendSpec` as the person from its own card.
   - A wholly different piece is one amendment of many lines (up to 40), or a new project.
2. **The AI amends when it suggests.** A single suggestion ("a pear would suit this", or the person's "make it 2 carats") is amended **before** its picture or its edit. Four alternatives pitched together are the exception (point 3, and D4). The Design recipe gains `setSpec`, `amendSpec`, `references.readModel` and `pieces.estimate`.
3. **Directions carry their changes; the pick applies them.** Up to four briefs pitched together are alternatives, so the spec cannot hold all four. Each carries `direction: { label, changes }`, categorical lines only: archetype, cut, counts, claws, setting, metal colour, halo or not, style words. A picture cannot state millimetres; sizes come from the spec or the size questions. Picking a picture applies its changes through `amendSpec` with source `picture` and `fromReferenceId`, and records `spec.picture` (a words-only line that shows the chosen picture).
   - **The person picks** (Take to CAD, *Use this*): their press is their statement, so no quote is needed.
   - **The assistant picks** on the person's words ("the second one"): on a draft, no card.
   - **On an agreed spec:** the default is a new version (section 6), made without asking; *Change this CAD instead* goes through the studio's amendment card, pressed by the person.
4. **Bound pictures, checked briefs.** Every brief records the spec version it was made against, and its keep list is the countable, nameable lines the person stated or the file measured, as numerals ("1 round centre stone, 4 claws, a knife-edge band, yellow gold"). The brief call already reads the request; it now also returns `lines` in spec vocabulary. Code compares those with spec ⊕ `direction.changes`. A departure on a line that is not assumed and not declared is refused (409 `spec_departs`, naming the line: "Amend the draft first, or declare it as this direction's change"). Departures on assumed lines are allowed, because that is what the four pictures explore. The code enforces the founder's rule: the picture, the spec and the verifier read one description.
5. **A pick made against an older spec.** A picture made at v3 while the spec is at v5: the picture's changes are applied to v5, except on a line the person stated after v3 (a person's amendment, card edit or quoted assistant amendment). There **the person's later statement wins**, and the line is listed: "Kept your white gold (you said it after this picture); the picture's other change, three stones, is applied." Lines moved since v3 by anyone are listed too ("since this picture: centre 1.5 → 2.0 ct").
6. **The spec inside a run.** The context is still built once per person's message (cached, append-only). Every tool that writes the spec returns its version and the moved lines (`changed: { line, label, from, to }[]`). Before each model call, `loop.ts` compares `piece.specVersion` with the last version the model saw or wrote itself. If a person changed the spec mid-run, one context note lists the moved lines before the next tool call; the assistant's own writes never trigger it.
7. **A version's agreement.** A version's draft is agreed on its build card, which lists every line that differs from the source's agreed spec. A version finished by `design.apply` instead of a build ends with the `agreeSpec` card, showing the same differences; a CAD job cannot finish without it (core.ts l.28).
8. **An import's spec and agreement.**
   - The draft is written from the read, by the server.
   - `pieces.agreeSpec` becomes a confirm tool that always shows a card, in both ways of working ("Agree this spec and keep your file"), with every line's tag; Do it all never runs it. This gives the keep-the-file route its missing step without a rebuild.
   - On the checked import: ring size (from `facts.bore` when there is no `facts.band`), body, metal and mesh lines are checked from the opened design. *Put back* acts on `band.nodeId` only, so it is not offered for a bore-only ring size; *Differs from the spec* offers **Update the spec** or **Rebuild as a version** there. Stone lines are `unchecked` with `why: 'imported-mesh'` in phase 1 (the `.3dm` stone count is shown but not checked until phase 2). In phase 2 they are checked while the imported body is unchanged; after a hand edit of the mesh they are `unchecked` again, never met by assumption.
   - A person's whole-spec write or any amendment that changes a measured line drops its *from your file* tag and the result notes it ("your file measures 16.92 mm; this says US 7").

## 5. Photoreal-only pictures

**The look is chosen by the person, never the assistant.** `IMAGE_LOOKS = photo | clean | technical | sketch`; `photo` is the default.
- A non-photo look needs `lookAsked`: the person's own words, verified like a quote ("a clean white background so I can model it"). Or it needs the Generate panel's **Look** control, which is a person's press.
- The assistant's `look` hint alone never leaves `photo`.

**The brief (`BRIEF_SYSTEM`).** The photo look replaces today's background rule: "a professional jewelry product photograph of the real piece: a macro lens at about f/8, one perspective view (three-quarter for rings), the whole piece in frame; a soft three-point softbox setup with a large diffused key and narrow strip lights drawing long highlights along the metal; the metal named by karat and colour, with reflections of the studio; stones with bold dark and bright facets; on a white seamless background with a soft contact shadow" (D2 sets the backdrop; the default keeps the matte that `match.fit` needs). Today's paragraph is kept word for word as the `clean` look.
- The keep list is written as numerals and repeated as the prompt's last sentence. Code checks that every keep numeral and noun appears; one rewrite, then `internal`.
- Code also bans rendering words from a photo-look prompt, labels included: "render", "3D", "CGI", "CAD", "clay", "wireframe", "octane", "unreal", "viewport". One rewrite, then `internal`.

**Our views as form, never as look.** `GENERATION_ROLES` gains `form`: "take the shape, proportions and stone layout exactly; ignore colours, light, surface and background".
- `shapeFrom { pieceId | referenceId | assetId }` renders hero, top and side in the reference look. The shots are assets of the brief (`shapeFrom.shotIds`), **never References**: they are not on the board, cannot be picked for Take to CAD, used as a vary or refine parent, or given any role but `form`. The person sees them in the generated tile's details ("Sent as shape"). A board `model` reference is turned into views the same way instead of being refused.
- The label reads "Image 1 shows the piece's shape from three-quarter; image 2 from above, for the stone and claw count", with no rendering words. Top and side are evidence; the output is always one perspective photograph.
- The brief read flags any attached reference that looks like a CAD render or screenshot (`looksLikeCad`), and the server forces `form` on it. Such a person's upload stays on the board as theirs, marked "CAD view", and Take to CAD from it builds from its read as today.
- Higgsfield cannot see references. A brief with `shapeFrom` goes to a provider that can (Gemini, then OpenAI) when its key exists; only when none does is it refused (`provider_cannot_see`, "add a Gemini or OpenAI key to use your CAD as the shape").

**Checks before a picture is kept** (photo look only; safety always runs):

| Check | How | Drops when |
| --- | --- | --- |
| Near-copy (code) | The cut-out piece (the whole frame when the matte fails) as a 64 × 64 grey image, correlated with our form view of the nearest camera. Skipped when nothing was sent as shape (an open brief) | ≥ 0.92 (threshold set from fixtures, then from eval E2) |
| Seven CAD cues | Added to the existing check call, each a reason then yes/no: flat or default light; razor edges; no surface or contact shadow; orthographic view or UI marks; glassy, grey or rainbow stones; plastic or clay metal; too perfect | Two or more yes |
| A/B judge | `buildLookPairRequest`: the picture and our view of the same camera, "Which looks more like a photograph of a real piece?", asked twice with the order swapped. With no CAD view (an open brief), it is skipped and the cues decide alone | Loses either order |
| Keep (advisory) | Each keep item with a count of 12 or fewer is asked as yes/no/unsure on the picture | Never: marks "Differs from your spec: 5 claws instead of 6" and keeps it |

A dropped picture is redone once, with the failed cues named in positive words ("a soft contact shadow on a white surface"), capped at half the pictures on the card, rounded up (2 of 4, 1 of 1), and billed (D1). The card says "about $0.20, at most $0.30 if some are redone". **If no picture passes, none is shown**: one line says "These came out looking like renders, so I didn't keep them," with **Try again** and *Clean look instead* (the person's press sets the look). Fewer than asked shows those that passed and one quiet line. The tile's details record `generation.checks`. Vision counts are not reliable enough to gate on, and Pavé never counts pavé from pixels.

**Models.** Add `gpt-image-2.6-sunburst` and `-2.6-flare`; remove `gpt-image-1` (a board set to it reads as the default).

**Why a photograph even before Take to CAD.** Take to CAD builds from the spec plus the picture's declared changes, and `references.read` reads a photograph for categories. After the build, the photo skill traces the picture's outline with `match.fit`, which needs a plain-background matte (§0). The default backdrop (white seamless, soft contact shadow) is a real product photograph that keeps that matte, so a CAD-like "clean" look gains nothing. When the matte fails (the stone-surface backdrop of D2's alternative, or a busy person's upload), Take to CAD still builds from the spec and the picture's changes, skips the image fit, says so in one line, and offers the side-by-side.

## 6. "A different version" of an own or imported model

| Source | What happens | Original |
| --- | --- | --- |
| Parametric, draft spec | The pick amends the draft; **Change this CAD** edits through `design.apply`, keeping hand tweaks. *As a new version* is offered | Changed only if they choose Change |
| Parametric, agreed or signed off | **As a new version** (default): `pieces.duplicate { as: 'version' }` copies design, spec (as an unagreed draft) and board pins, applies the pick's changes, and sets `versionOf { pieceId, specVersion, signOffId }`. Then size questions, then the build card (lines changed from the source listed), or `design.apply` ending with the `agreeSpec` card (4.7). **Change this CAD instead**: the studio's amendment card, pressed by the person | Untouched; sign-off stays true |
| Parametric, "three CAD variants" | Today's `proposeDirections` on a draft; on an agreed spec a version is made first | Untouched |
| Imported mesh, any route that changes shape | **Rebuild as a version** (by the assistant, or by hand from the model tile or the CAD menu): `duplicate { as: 'version' }`, then the draft amended to the pick or the stated changes, then `buildFromSpec` (card), then `match.fit { fromPieceId }` against the original. The fit applies only when quality is good, as a second undoable change; otherwise the overlap is told honestly ("a close cousin of your ring, not a copy: overlap 0.71"). `archetype: 'custom'` falls back to the nearest buildable (`NEAREST_BUILDABLE`) with a note | The file stays pinned on the version's board as a 3D reference (its views are sent as shape, never pinned) |
| Imported mesh, metal or nothing | **Keep the file**: open as CAD, metal set on the import, agree on the card | Is the piece |

The fit targets the original's design, never the generated photograph (surfaces and shadows break the cut-out). It uses `match.fit { fromPieceId, views = hero, top, side, front, pinned }`: the source is rasterised with exact cameras, a true `spanMm` and a stone mask. The keys of the lines the person changed are pinned and their regions left out of the score, so the fit never undoes a change. Ops that would break an agreed line are `held` (spec-truth).

## 7. Structure

| Where | New or changed | What |
| --- | --- | --- |
| `packages/schema/src/spec/model-read.ts` | new | `ModelReadSchema`, `ROUTES`, `IMAGE_LOOKS`, `MODEL_VIEWS`, `KeepItemSchema` |
| `packages/schema/src/spec/keep.ts` | new | `keepListFor(spec)`; `departures(spec, changes, briefLines)` (pure) |
| `packages/schema/src/spec/{amend,facts,check,lines}.ts` | changed | `specFromModelRead`, the render merge (numbers from the file, categories from renders); `MeasuredFacts.source` and `bore`; `checkSpec` reads `band ?? bore` for `ring.size`; stone group `basis`; `LineResult.why: 'imported-mesh'`; `picture` among the unmeasured lines; `laterStatements(spec, sinceVersion)` (pure, 4.5) |
| `packages/schema/src/design/{spec,nodes}.ts` | changed | `PieceSpec.basis`, `picture`, `from`; `MeshBody.size`, `units`, `ringAxis`, `source.part`; `StoneSet` (phase 2) |
| `packages/kernel/src/import/` | new | `scene.ts`, `units.ts`, `read.ts` (phase 1); `rhino3dm.ts` with the loader moved to `runtime/rhino.ts`; `stones3dm.ts` (phase 1: block instances and stone layers kept apart, width from the outline); phase 2: `classify.ts`, `gemFit.ts`, `heads.ts`, `lots.ts`, `names.ts` |
| `packages/kernel/src/evaluate/bore.ts` | new | Bore fit (shared with freeform-cad-additions step 19) |
| `packages/kernel/src/mesh/parse/*` | changed (phase 2) | `parseObjects()` beside the unchanged `parseMesh()` |
| `packages/kernel/src/features/{meshBody,stoneSet}.ts`, `evaluate/measured.ts` | changed, new | `size: 'file'`, ring upright, the band from `ringAxis`; `stoneSet` drawn and published |
| `apps/server/src/models/read.ts` | new | `references.readModel`: worker, caps, `model_read` cache, transient design, shots |
| `apps/server/src/assistant/{turn,loop,capture}.ts` | changed | Model attachments with read and shots; Flow block; `chat.route`, `instead`, grant; mid-run spec note; `bindPiece` pins attachments; `reference` capture mode |
| `apps/server/src/imagegen/{pipeline,shapes,checks}.ts` | changed, new | `shapeFrom`, `form`, look, binding, `spec_departs`, `briefIds`, near-copy, cues, pair, capped retry |
| `apps/server/src/{ideas,spec}.ts`, `handlers/{pieces,match}.ts` | changed | `openAsCad` as a tool with `size`; the server-written import draft; `agreeSpec` card; from the assistant `setSpec` first-draft only and `chooseDirection` as an amendment; people's whole-spec writes recorded as line diffs; `duplicate as: 'version'`; `takeToCad`; `match.fit fromPieceId` |
| `packages/agent/src/imagegen.ts` | changed | Looks, form labels, keep list, CG-word check, cues, `looksLikeCad`, `lines`, pair request |
| `packages/agent/src/prompt/`, `jobs.ts` | changed | Section 9; recipe tool lists |
| `packages/ideation/src/openai.ts` | changed | Model list |
| UI `apps/studio/src/features/{assistant,ideate,projects,directions,cad,spec}/` | changed, new | Section 1.6 |

## 8. Contract changes

**8.1 Schema (`spec/model-read.ts`)**

```ts
export const ROUTES = ['pictures', 'cad', 'openFile', 'rebuild', 'render'] as const
export const IMAGE_LOOKS = ['photo', 'clean', 'technical', 'sketch'] as const   // photo is the default
export const MODEL_VIEWS = ['hero', 'top', 'side', 'front'] as const            // packages/render/src/camera.ts presets
export const LINE_BASIS = ['measured', 'named', 'render', 'picture'] as const

export const ModelReadSchema = z.object({
  source: z.object({ assetId: id, name: z.string(), format: z.enum(['stl', 'obj', 'glb', 'gltf', '3mf', 'ply', '3dm']),
    units: z.enum(['mm', 'cm', 'm', 'in']), unitsFrom: z.enum(['file', 'default', 'inferred', 'corrected']),
    pieceId: id.nullable(), referenceId: id.nullable(), generator: z.string().nullable() }),
  readable: z.boolean(),
  unreadable: z.string().nullable(),          // the one sentence the composer and the assistant show
  facts: MeasuredFactsSchema,                 // source 'file'; produced by evaluating the transient design; bore, not band
  shots: z.array(z.object({ view: z.enum(MODEL_VIEWS), assetId: id })),
  shotSource: z.enum(['studio', 'server']),
  headline: z.string().max(160),              // phase 1: "Ring · US 6½ (16.92 mm bore) · 1 stone, 6.42 mm · 3.1 g"
  specDraft: PieceSpecSchema,                 // with basis and assumed filled
  questions: z.array(QuickQuestionSchema).max(3),
  cannotTell: z.array(z.string()),            // "natural or lab", "which gold"
  ignored: z.array(z.object({ what: z.enum(['cutter', 'curve', 'hidden', 'duplicate']), count: z.number().int() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),   // import.fused, unitsGuessed, boreNotRound…
  readerVersion: z.number().int(),
})
export const KeepItemSchema = z.object({ line: z.string(), text: z.string(), count: z.number().int().optional() })
```

**8.2 Spec, facts, nodes**
- `PieceSpec.basis: Record<lineId, LineBasis>`, default `{}`. It is additive beside spec-truth's `assumed`, so its gate and cards are unchanged. A person's edit or a quoted amendment removes a line from both.
- `PieceSpec.picture?: { referenceId, specVersion }` and `PieceSpec.from?: { assetId, readerVersion }`.
- `SPEC_SOURCES` gains `'from-model'`, `'picture'` and `'direction'`.
- `MeasuredFacts.source: 'built' | 'file'` (default `built`); `MeasuredStoneGroup.basis: 'node' | 'file'`; `LineResult.why` gains `'imported-mesh'`.
- `MeasuredFacts.bore?: { boreMm, rms, widthBaseMm?, thicknessTopMm? }`, set for a mesh with a found bore. `band` stays as it is (required fields, a `nodeId`), so no existing reader changes. `checkSpec` checks `ring.size` from `band ?? bore`; Put back and *Differs from the spec* act on `band.nodeId` only, and with only `bore` they offer Update the spec or Rebuild as a version.
- `MeshBody` gains `size: 'file' | 'height'` (new nodes `file`; nodes without it read as `height`, so nothing existing changes size), `units`, `ringAxis?` and, in phase 2, `source.part?`.
- Phase 2 adds `StoneSet { cut, stone, width, lw, placements[1..5000], class: single|halo|row|pave, around?, setting|'unknown', claws?, origin: 'import'|'manual', measuredOn: { part, hash } }`. `PAVE_FORMAT_VERSION` stays 1.

**8.3 Entities (`api/entities.ts`)**
- `GENERATION_ROLES` gains `form`.
- `ImageBrief` gains `look`, `lookAsked: string | null`, `specVersion: number | null`, `keep: KeepItem[]`, `direction: { label, changes: { line, value }[] } | null` and `shapeFrom: { pieceId? | referenceId? | assetId?, views, shotIds } | null` (`shotIds` are assets, never References).
- `BriefRead` gains `look`, `lookAsked`, `lines` (archetype, centre cut and count, claws, side count, setting, metal colour, halo) and `looksLikeCad` per reference.
- A generated `Reference.generation` gains `specVersion`, `look`, `direction` and `checks: { look: 'photo' | 'cadLike' | 'skipped'; cues: string[]; pairwise: 'won' | 'lost' | 'split' | 'skipped'; nearCopy: number | null; keep: { line; seen: 'yes' | 'no' | 'unsure' }[] }`.
- `Piece` gains `route: { choice: Route; by: 'person' | 'said' | 'default'; at } | null` and `versionOf: { pieceId, specVersion, signOffId } | null`. `Thread` gains `route`. `Run` gains `grant: { tool, count, maxUsd, used } | null`.
- Studio `Attachment` gains `kind: 'image' | 'model'` and `read?: { headline, heroAssetId, unreadable }`.

**8.4 Commands (`api/commands.ts`, `client-tools.ts`)**

| Command | Tool | Change |
| --- | --- | --- |
| `references.readModel` | yes, query, free | New. `{ assetId? \| pieceId? \| referenceId?` (exactly one)`, views = hero, top, side }` → `ModelRead`. The shots come back to the model as images (`loop.ts captureImages` learns `shots`). Refused: STEP (`step_not_readable`), `no_mesh`, `too_large`, a non-3D asset, a view-only reference, another organisation's asset (`not_found`). Two concurrent reads of the same bytes make one row; a cancelled run aborts the read and frees the worker |
| `chat.route` | confirm | New. `{ pieceId?, intro (≤200), options: Route[2..3], recommended, newBrief?: { quote } }` → `{ route, by: 'person' \| 'default' \| 'remembered', grant }`. Server labels, hints and costs; a stored route with no verified `newBrief` returns `remembered` with no card; 409 `route_settled` in a run started by a press or a job |
| `runs.decide` | no | Adds `instead?: Route`, valid only on the first spending or replacing go-ahead (`references.generate`, `pieces.buildFromSpec`, `pieces.openAsCad`) of a piece with no route; otherwise 409 |
| `references.brief` | yes | Adds `look?` (a hint), `lookAsked?` (verified as the person's words), `shapeFrom?`, `direction?`. The server adds `specVersion` and `keep`, renders `shapeFrom` into shot assets sent as `form` (never References), routes the brief to a provider that can see references, and turns `model` references into views. It refuses `spec_departs` (4.4), `provider_cannot_see` (only when no such provider has a key), millimetres in `direction.changes`, a non-`form` role on a model reference, and a shot asset in any role |
| `references.generate` | confirm | Accepts `briefIds` (1–4) beside `briefId`: one card for a set of directions, **one picture per brief** (`count` applies to a single `briefId` only; with `briefIds` it is refused). The card states the total ("Four picture ideas"). Output adds `kept`, `dropped: { safety, cadLike, nearCopy }`, `retried`, `costUsd`. One capped retry (half the total, rounded up). A matching `run.grant` admits it without a card |
| `references.estimate` | yes | Adds `retryCapUsd` and `briefIds` |
| `references.read` | yes | Unchanged, but its cost is shown wherever it reads a person's renders ("Read 2 renders · $0.01"); its description now says to write the first draft with setSpec, or amend named lines when the piece has a spec |
| `pieces.setSpec` | yes | From the assistant, first draft only: 409 `spec_exists` once a spec exists. People's writes unchanged and recorded as line diffs. Output adds `changed` and `notes` |
| `pieces.chooseDirection` | yes | From the assistant on a piece with a spec, recorded as one amendment of the differing lines (source `direction`) under `amendSpec`'s quote and card rules |
| `pieces.amendSpec` | yes | Adds `fromReferenceId?` (applies that picture's `direction.changes`, source `picture`, skipping lines the person stated after the picture: 4.5). Output adds `changed: { line, label, from, to }[]`, `kept: { line, why }[]` and `notes`. Card and quote rules unchanged: `picture` is no exemption for the assistant |
| `pieces.agreeSpec` | **confirm** (was people only) | `{ id, baseSpecVersion }`. From the assistant always a card, in both ways of working; never admitted by Do it all. The card lists lines changed from `versionOf`'s spec when there is one. Refused `spec_moved` and `nothing_built`; refused over MCP (no card) |
| `pieces.openAsCad` | **yes** (was people only) | Adds `size: 'file' \| 'height' = 'file'`, `heightMm?`; accepts `.3dm`. From the assistant, 409 `has_design` on a piece with a design. Writes the draft from the read when the piece has none (source `from-model`); the one writer for that path. Output adds `read` |
| `pieces.duplicate` | yes | Adds `as: 'copy' \| 'version' = 'copy'`, `fromReferenceId?`. A version copies the spec as an unagreed draft and the board pins, sets `versionOf`, applies the picture's changes, titles "<name> · B", "· C"… |
| `pieces.buildFromSpec` | confirm | Its card lists the lines that differ from `versionOf`'s agreed spec, and carries the second-way link when one applies |
| `pieces.takeToCad` | no | Adds `asVersion?: boolean` (default true on an agreed spec); applies the picture's changes to a draft (the person's amendment, source `picture`). Refuses a shot asset |
| `match.fit` | yes | Adds `fromPieceId` (instead of `assetId`), `views?`, `pinned?: string[]` |
| `viewport.capture` | yes | `mode` gains `reference` |

**8.5 Events, database, `.pave`**
- **Events:** `model.read` (server, for the chip), `route.chosen` (server), `route` (run stream).
- **Migration** `apps/server/drizzle/0019_own_cad.sql` (SPEC ends at 0018):
  - `model_read` (content hash, reader version, status, error, read jsonb with no asset id; unique on hash and reader version);
  - `piece.route`, `piece.version_of`, `thread.route`, `run.grant` (jsonb);
  - `image_brief.look`, `look_asked`, `spec_version`, `keep`, `direction`, `shape_from`;
  - `reference.generation_checks`.
- **`.pave`:** `spec.basis`, `spec.picture`, `spec.from` and `version_of` travel (round-trip test 98); `model_read` is a cache and does not.

**8.6 Context (`prompt/context.ts`).** A **Flow** block of at most six lines, after the attachments and before the spec. It holds facts only, never a recommendation, and is built once per person's message:

```
Flow:
- Attached now: 1 model (solitaire.3dm, read: Ring · US 6½ · round ≈ 1.00 ct · 3.1 g; cannot tell: natural or lab), 2 pictures
- Board: 7 pictures (4 generated, last against spec v2), 1 model; picked for CAD: none
- Design: none | imported mesh (true size, unedited) | parametric v12
- Spec: none | draft v2 (3 assumed) | agreed v3 | signed off v3
- Route for this project: pictures (chosen by the person, 2 turns ago) | none
```

## 9. The prompt

All new text is static and sits in the frozen system blocks. `PROMPT_HASH` hashes the system blocks and `toolDefs()` together (`prompt/index.ts` l.43), so **every step that adds or changes a tool definition or prompt text updates the snapshot** and re-records the recordings that step touches: the steps marked † in §13 (5, 12, 13, 15–19, 21, 22, 24, 25, 27, 28). A command lands with `tool: true` only in the step that implements its handler, so the model is never offered a tool that answers "not implemented". Step 28 re-records every journey once at the end.

**New skill `skills/route.ts`, "Starting work"**, first in `SKILLS`. Each rule is one sentence:
- Decide the route before your first tool call, from the words and the Flow block; when they settle it, say the route in your first sentence and go on.
- Ask with chat.route only in the ask rows of the table; ask once, before you start, never after work has started, never twice for the same project, never when a press or a started job chose the route.
- A question about a file ("what do you think?") is answered from the read; then offer the routes in one line of words, not a card.
- When you go ahead, the first go-ahead card offers the other way itself; do not also ask in words.
- A route the designer chose for this project stands until a new brief; say it in one line.
- Pictures are photographs of a real piece; never offer a CAD view or a clay image as a design picture.
- For an open brief, let the four pictures answer what is open: one brief per direction, sizes kept for Take to CAD.
The section 2 table follows, then counter-examples: never ask before a build card that already asks; never ask the route and then ask the generate card for the same pictures.

**New skill `skills/model.ts`, "A design from the designer's own CAD":**
1. Read the file first (the context's read, or `references.readModel`). Code measured the numbers: never change a measured count or size from the shots.
2. Name only what code does not measure: archetype, setting style, claw tips, shoulders, style words.
3. Renders attached with the file are the same piece: read them for colours only. When they disagree with the file, say which you used.
4. Pavé writes the first draft from the read when the piece is made, bound or opened; never call setSpec for it. Name the unmeasured lines in one pieces.amendSpec, all assumed. Say the three lines that matter and what the file cannot tell.
5. Then follow the route:
   - **pictures**: `shapeFrom` the file, one direction per brief;
   - **openFile**: `openAsCad`, then `agreeSpec`;
   - **rebuild**: version, amend, build, `match.fit { fromPieceId }`, check;
   - **render**: the render skill.
6. An imported mesh has no parametric variants: offer pictures, or a rebuild. A size, stone or band change on a mesh is a rebuild; do not ask.

**Edits** (the setSpec ones ship in step 16 with the rule, the rest in step 28):
- **Core**, "The spec is the source of truth" gains: "Every suggestion that changes the piece changes the spec first, with pieces.amendSpec; pictures pitched together declare their changes and the pick applies them; a different version never replaces the version it came from." l.28 and l.38: "setSpec writes a new piece's first draft; every later change is pieces.amendSpec." "A new piece from words" points to the route skill.
- **`spec.ts`**: setSpec once; amendSpec for every later change; the draft is written in Design.
- **`board.ts`**: the photo look; `form` for CAD views and `style` only for real photographs; read `kept`, `dropped` and the marks and report them; ask only what a picture cannot show.
- **`photo.ts`**: "always straight to CAD" becomes "straight to CAD when the words ask to build; otherwise the route skill". l.20: "Rebuild through one pieces.amendSpec of the changed lines, then pieces.buildFromSpec." Step 4's `match.fit` stays; when the matte fails, say "built from the spec; the backdrop is too busy to trace".
- **`references.read` description** (commands.ts l.1200): as in 8.4.
- **`directions.ts`**: a version for an agreed piece.

**`BRIEF_SYSTEM` and `CHECK_SYSTEM`** as in section 5. `CHECK_SYSTEM` keeps the safety rules word for word.

**`prompt.test.ts`**:
- both skills are present, and every `ROUTES` value appears;
- the banned vague phrases match nothing;
- "plain, seamless, light grey" appears only in the `clean` look;
- no prompt or tool text tells the model to call setSpec on a piece that has a spec;
- the snapshot is updated in each step listed above.

## 10. Hard parts and decisions

1. **The model routes; code keeps the gates.** *Rejected:* a route classifier in code (brittle on phrasing; cannot weigh a file against words); always asking (over-asking scores as badly as never asking: HiL-Bench 14.5 % at 8 % precision, S); a separate Claude call to route (a second prompt to keep in step).
2. **One card per decision.** The second way rides on the first go-ahead; the route card's priced option is the generation's approval. *Rejected:* a route card before every first action (two cards for one decision); a route option that only records a choice and is then followed by a generate card; a model-written price.
3. **Code measures, the model names.** `readModel` makes no Claude call. *Rejected:* a structured vision read of counts or sizes (it miscounts beyond about ten and reads no millimetres, research 11 R); decoding plug-in data (closed, versioned, and empty in rhino3dm, L).
4. **True size.** *Rejected:* keeping the 40 mm default for new imports (a ring opened 40 mm tall is wrong, silently); asking the size the file already knows.
5. **Phase 1 before gem recognition.** The loop works on whole-mesh facts, and `.3dm` cached meshes, with stones that are separate objects counted and sized, are in phase 1 because the founder works in Rhino (block instances come with their transforms in rhino3dm). *Rejected:* waiting for gem recognition, the least certain part, before routing and pictures.
6. **The spec: one write, then amendments, and pictures bound to it.** One writer per first draft (the server for a file). People keep whole-spec writes, recorded as line diffs. *Rejected:* `setSpec` per suggestion (the founder named amendSpec; whole rewrites hide which line moved); refusing people's whole-spec writes (breaks the spec card and templates); amending for every picture (D4); unbound pictures (the verifier and the picture check would read different descriptions); a loop note instead of the `spec_departs` refusal (a note can be ignored).
7. **"Never CAD-looking" is enforced in four places:** the look is chosen only by the person; rendering words are banned in code; our views go in as `form`; and three checks run after generation. *Rejected:* a 1–10 realism score (pairwise and binary questions agree better with people, S); classical CG detectors (they predate image models); showing all four with labels (it makes the person judge what code can).
8. **The keep check is advisory.** A picture with a `no` is kept and marked. *Rejected:* dropping it (vision counts are not a gate, and the person may want it); auto-amending from pixels.
9. **The project is born at the first action that needs it** (a brief needs a board). *Rejected:* a project per Home attachment (most such chats are questions); creating it on the generate card's approval (the brief comes first).
10. **Versions are sibling projects.** A signed-off piece's sign-off must stay true, so a picked picture of an agreed piece defaults to a version; *Change this CAD* stays available through the amendment card. *Rejected:* a version switcher inside a project (a new control everywhere; it breaks one project, one spec, one sign-off); deforming an imported mesh toward a picture (no handles; not editable CAD).
11. **Reading facts equal opened facts.** One evaluation path. *Rejected:* computing facts in the reader and again in the kernel (rounding differences would show false "Differs from the spec").
12. **Settled without the founder:** imports keep their real size; units default to mm with a one-press fix; the photo look stays even before Take to CAD (5, last paragraph); measured lines are not assumed while names and renders are; Take to CAD on an agreed piece makes a version without asking; nothing CAD-looking is shown as a fallback; the generation in free chat asks each time as today.

**Decisions for the founder** (the build's defaults):
**Settled 26 Nov by common sense (the founder asked not to be asked what common sense settles): D1 to D4 take their defaults below.** Pictures are made on the studio's own image keys, so a redo is the studio's spend, capped as stated; the white catalogue backdrop is the default because it keeps Take to CAD's trace, and a styled backdrop is there when the person asks; four pitched pictures move the spec only on the pick, so the verifier always reads one piece.

- **D1. Redoing a picture that looked like CAD costs money.** Default: redo once, up to half the request (2 of 4), billed to the person, with the cap printed on the card. The alternatives are absorbing the cost or never redoing (show it with a note).
- **D2. The default photograph's backdrop.** Default: a white seamless catalogue photograph with a soft contact shadow. It keeps the plain-background matte, so Take to CAD can trace the picture's outline (`match.fit`). The alternative, a pale stone surface (a styled product photograph), looks richer but often loses the matte, so Take to CAD builds from the spec alone and says so. Both pass the CAD-look check. Test 99 measures matte success on both before this is closed.
- **D4. When the spec moves while pictures are pitched.** The founder said the spec is updated "every time the AI suggests an update". Default: a single suggestion amends the spec before its picture; four alternatives pitched together each declare their changes, and only the pick amends the spec (so the spec never holds four contradictory versions, and the verifier always reads one piece). The alternative is to amend for every pitched picture, which makes four spec versions per pitch and the last one wins until a pick.
- **D3. Stones in an imported file (phase 2).** Default: redrawn as Pavé's cut models at the file's exact positions and girdle sizes, so renders, carat, the check and sourcing work. The alternative is keeping the file's own stone meshes as they are: visually exact, but with no cut, carat or material for renders or the check.

## 11. Verification

Server and agent tests run on the strict fake Claude API with scripted turns. Kernel fixtures are made in the tests from the 14 templates with Pavé's own exporters and the rhino3dm writer (`kernel/src/testing/importFixtures.ts`), so no vendor file is committed. The variants are `pave` (names and user strings), `anonymous`, `blocks`, `cutters`, `small` (no cached meshes), binary `stl` without units, `inch`, `cm`, `glb` in metres, `casting` (metal only) and `fused`. Playwright runs on a scripted server at 1440 × 900, 390 × 844 and in the app view, with screenshots.

| # | Edge case | Expected | Test |
| --- | --- | --- | --- |
| **Home and attachments** | | | |
| 1 | `.stl .obj .glb .3mf .ply .3dm` by drop, picker and paste | Uploaded; chip "Reading…", then hero view and headline | UI `features/assistant/composer-attach.test.ts` |
| 2 | `.step` / `.stp` | Chip "STEP can't be read yet; export STL or .3dm"; Send works; the model is told the same | same, `turn.test.ts` |
| 3 | `.zip`, `.pdf`, `.jcd` | Refused with one toast; `.jcd` gets the JewelCAD sentence | same |
| 4 | 6 pictures + 3 models | 8 kept, toast "Up to 8 files per message" | same |
| 5 | `.3dm` saved small | `readable: false`, the exact sentence under the composer before Send | `server/models/read.test.ts` |
| 6 | The same file twice, or two windows at once | One `model_read` row | same (database) |
| 7 | Turn with a model attachment | Context lists it with headline and `cannotTell`; three shots as image blocks; never under "Not shown to you" | `assistant/turn.test.ts` |
| 8 | Read still pending at Send | Waits up to 20 s, then "still reading" and the tool | same |
| 9 | Home chat that only asks "what karat is this?" | No project created | `assistant/route.test.ts` |
| 10 | First brief, open or build on Home | `pieces.create`; `bindPiece` pins the file as a model reference and the pictures once; a retried bind adds nothing; the route moves from thread to piece | same |
| 11 | No Claude key on Home with a CAD | Project created with the file opened at real size | UI `pages/home/Composer.test.tsx` |
| **Reading, phase 1** | | | |
| 12 | mm ring STL, 17.35 mm bore | `boreMm` 17.35 ± 0.05; not rescaled; upright; `ring.size` measured | `kernel/evaluate/bore.test.ts`, `import/read.test.ts` |
| 13 | Same ring in inches; in cm | Scale 25.4 / 10, `unitsFrom: 'inferred'`, a note | `import/read.test.ts` |
| 14 | 40-unit pendant STL, no bore; a 0.9-unit ring with a 0.67 bore | First: mm (`unitsFrom: 'default'`), stated, never asked; *It was inches* rereads at 25.4 (`corrected`). Second: mm impossible, inches inferred from the bore, with a note | same, UI `ReadModelCard.test.tsx` |
| 15 | GLB in metres | File units used | same |
| 16 | Euro or square inside | `boreNotRound`; size assumed | same |
| 17 | An old meshBody without `size` | Still 40 mm tall | `kernel/features/meshBody.test.ts` |
| 18 | Read facts equal opened facts | The file opened with `openAsCad` has no line not met | `server/ideas.test.ts` |
| 19 | Determinism and cache | Same bytes give an equal read and the second is served from the cache; a reader-version bump reads again | `import/read.test.ts`, `models/read.test.ts` |
| 20 | Caps and corrupt files | Over 3 M triangles or 150 MB refused before parsing; a corrupt `.3dm` and a renamed `.txt` get the format sentence | same |
| 21 | `.3dm` phase 1 (fixtures written by rhino3dm in the test) | Units from `modelUnitSystem`; layer "18K Yellow" gives au18k-yellow, tagged *named*, in `assumed`; hidden objects left out of the metal; `no_mesh`; `partialMesh` naming the objects | `import/rhino3dm.test.ts` |
| 22 | Shots | Hero, top and side in the reference look (alloy colour, not clay); `studio` when a window draws them, else `server`; the images reach the model | `models/read.test.ts`, loop test |
| 23 | Inputs | `assetId`, `pieceId`, `referenceId` each work; none or two refused; view-only refused | same |
| **Spec** | | | |
| 24 | `specFromModelRead` | Measured lines tagged and not assumed; named and render lines tagged and assumed; archetype `custom` until named | `schema/spec/amend.test.ts` |
| 25 | Render merge | Numbers from the file, colour from the render; a count conflict keeps the file and adds the note | same |
| 26 | Second `setSpec` on a piece with a draft | From the assistant: 409 `spec_exists` naming amendSpec. From a person (spec card, template in CAD, `PieceDirections`): accepted on a draft and recorded with `changed` per line; refused once agreed as today | `server/spec.test.ts`, UI `SpecCard.test.tsx` |
| 27 | `amendSpec` on a draft | No quote, no card; quiet line from → to; Undo writes a person's amendment back; not counted in "Made N changes" | `spec.test.ts`, UI `minimal.test.ts`, `SpecDraftLine.test.tsx` |
| 28 | Amending a measured line | Its tag dropped; note "your file measures 16.92 mm" | `spec.test.ts` |
| 29 | Regression: amending an agreed spec | Quote and card still required | `spec-gate.test.ts` |
| 30 | A person edits the spec on its card mid-run | The next model request carries the note; nothing is sent when versions match | `assistant/loop.test.ts` |
| 31 | `agreeSpec` from the assistant | Card in both ways; Do it all never admits it; switching mode while waiting does not approve; `spec_moved`; `nothing_built`; refused over MCP | `spec.test.ts`, `jobs.test.ts` |
| 32 | Checked import, phase 1 | `ring.size` met from the bore; stone lines `unchecked`/`imported-mesh`; weight says "if 18k yellow" | `spec.test.ts` |
| 33 | `openAsCad` by the assistant on a piece with a design | 409 `has_design` | `ideas.test.ts` |
| **Route** | | | |
| 34 | Specific brief | No `chat.route`; build card with *Show me pictures first* | `assistant/route.test.ts` |
| 35 | Press *Show me pictures first* | Build declined; `{ declined, instead: 'pictures' }`; route stored; nothing built; next card is the generate card | same |
| 36 | Open brief | No `chat.ask` before the first generation; four direction briefs on one generate card with *or go straight to CAD* | same, `imagegen.test.ts` |
| 37 | CAD + "more designs" | No route card; What I read; generate card with *or open it as CAD* | same |
| 38 | CAD with no words | One `chat.route`: pictures, openFile, render; labels and costs from the server; a model-written cost ignored | same |
| 39 | "Resize to 7 and make it platinum" on a welded STL | No route card; build card on the version with *Keep my file, platinum only*; rebuild runs version → amend → build card → `match.fit` → check; pressing the link opens the file as CAD, metal set, agree card | same |
| 40 | Grant | The priced pictures option runs one generate without a card; a second asks; a dearer one asks; two racing calls consume it once | same (database) |
| 41 | Remembered route | No card, "as before"; a new brief may ask again | same |
| 42 | `chat.route` in a run started by a job or a press (Do it all, Check with me) | 409 `route_settled` | `jobs.test.ts` |
| 43 | `instead` on a non-first card or on a project with a route | 409 | `route.test.ts` |
| 44 | `chat.route` validation | 2–3 options; recommended among them | `schema` test |
| 45 | No image key | No pictures option or generate card; says pictures are off; offers CAD | `route.test.ts` |
| **Pictures** | | | |
| 46 | No look words | `photo`; the prompt, labels included, has no rendering word; a word written by the brief writer gets one rewrite, then `internal` | `imagegen.test.ts`, `pipeline.test.ts` |
| 47 | "white background so I can model it" | `clean`, `lookAsked` verified; an assistant `clean` hint alone stays `photo` | same |
| 48 | Generate panel Look = Technical | Technical, no `lookAsked` needed (a person's press) | `pipeline.test.ts`, UI `GeneratePanel.test.tsx` |
| 49 | `shapeFrom { pieceId }` | Views rendered as shot assets, labelled first as `form`, listed in the tile's details, no Reference created; a board set to Higgsfield sends the brief to Gemini or OpenAI when a key exists, else `provider_cannot_see` | `pipeline.test.ts` |
| 50 | Board model reference | Turned into views as `form`; any other role refused | same |
| 51 | Attached clay render | `looksLikeCad` forces `form` | same |
| 52 | Keep list | Every numeral in the prompt (rewritten once if missing) and repeated last | `imagegen.test.ts` |
| 53 | Near-copy | Our view returned: dropped; with noise and a colour shift: dropped; three real ring photographs: kept | `imagegen/checks.test.ts` (fixture images) |
| 54 | Two cues yes | Dropped; one retry; cap held; costs equal what the providers billed | `pipeline.test.ts` |
| 55 | A/B judge | Must win both orders; a split drops it; both requests recorded | same |
| 56 | Every try CAD-like | No picture shown or stored as a board picture; the line with **Try again** and *Clean look instead*; the clean press sets `look: 'clean'` as a person's press | same, UI `PictureTiles.test.tsx` |
| 57 | `clean`, `technical`, `sketch` | Look checks skipped; safety runs; a refused image is never stored | `pipeline.test.ts` |
| 58 | Keep check says 5 claws | Kept and marked "Differs from your spec: 5 claws instead of 6"; counts above 12 not asked | same |
| 59 | Models | 2.6 ids listed; `gpt-image-1` gone; a board set to it reads as the default | `ideation/openai.test.ts` |
| **Binding and picks** | | | |
| 60 | Brief on draft v4 | `specVersion` 4 and the keep list stored | `pipeline.test.ts` |
| 61 | Single brief departs on a stated or measured line (a pear centre against the person's "oval", or 3 centre stones against the file's 1), never amended | 409 `spec_departs` naming the line; a line the spec does not have yet counts as open, unless the file measured it (phase 2 stones) | same |
| 62 | Direction briefs with declared changes | Accepted; an undeclared departure is refused; millimetres in `changes` are refused | same |
| 63 | Departure on an assumed line | Allowed | same |
| 64 | Pick on a draft (Take to CAD) | `amendSpec` by the person, source `picture`; `spec.picture` set; one sentence | `handlers/pieces.test.ts`, `assistant/take-to-cad.test.ts` |
| 65 | Pick on an agreed spec, from each Take to CAD entry (JobMode, DesignBoard, actions, GeneratePanel, BringIn, PieceDirections) | A version made with no menu; *Change this CAD instead* opens the studio's amendment card; its press calls `amendSpec` as the person, source `picture` | same, UI `JobMode.test.tsx`, `DesignBoard.test.tsx` |
| 66 | Picture made at v3 (yellow, three stones), the person said white gold at v4, spec at v5 | Build from v5 plus three stones; white gold kept and listed ("you said it after this picture"); other moved lines listed | same, `schema/spec/keep.test.ts` |
| **Versions** | | | |
| 67 | `duplicate { as: 'version' }` | "· B"; draft unagreed; `versionOf` with the sign-off id; pins copied; A unchanged and its sign-off current | `handlers/pieces.test.ts` |
| 68 | Rebuild of the `anonymous` import of each ring and pendant-solitaire template (solitaire, oval-pave, halo, three-stone, wedding-band, eternity, signet, pendant-solitaire), with the archetype supplied by the scripted model turn | Parametric version with that archetype, a met spec, fit `good`; source version unchanged; source pinned as a 3D reference. Not run on name-pendant (text), iced-trophy and iced-initial (already mesh bodies), studs (a pair), cuban and tennis (links) | `server/rebuild.test.ts` |
| 69 | Rebuild with "an oval centre and a 1.6 mm band" | Changed keys pinned and nothing pulled back; check met | same |
| 70 | Rebuild of a `custom` import (toi et moi) | Nearest buildable with a note; `poor` is reported, not applied | same |
| 71 | Cancelled during the fit | Recipe build kept with "fit not run"; no half change | same |
| 72 | `match.fit { fromPieceId }` | Known cameras not searched; stone mask used; `spanMm` holds scale; a template recovered from its own export at or above the overlap floor | `match.test.ts` (bench) |
| **Reading, phase 2** | | | |
| 73 | `pave` × the six templates with stones (solitaire, oval-pave, halo, three-stone, eternity, pendant-solitaire) | Kind and lots exact (the archetype is the model's name, not a kernel fact); width ±0.02 mm; carat ±2 %; count exact; bore ±0.05 mm; mass ±1 %; `checkSpec(templateSpec, read.facts)` met except archetype, profile and shoulder | `import/read.test.ts` |
| 74 | `anonymous` × the same six | Same numbers; alloy and material assumed | same |
| 75 | `blocks` (40 graded pavé, 7 instances at 3 scales) | One lot of 40 with positions ±0.01 mm; three lots by scale | `import/rhino3dm.test.ts` |
| 76 | `cutters` hidden and visible | Never counted; `ignored.cutter` equals the stone count | `import/classify.test.ts` |
| 77 | 13 cuts at 0.01–4 ct, odd ratios, tilted and spun | Right cut or low-confidence with margin < 0.03; a faceted metal bead on a `Metal::18K` layer is metal | `import/gemFit.test.ts` |
| 78 | Heads: 4 and 6 claws, double claw, bezel, half bezel, flush, pavé | Setting and claws equal the kernel's own count for the template | `import/heads.test.ts` |
| 79 | `fused`, `casting` | `import.fused` with no stones invented; `noStones` | `import/read.test.ts` |
| 80 | Two-tone | `twoTone` warning; the larger alloy stated | same |
| 81 | `stoneSet` | N stones placed; one fact group; render scene with real materials; weight excludes gems; editing the host mesh turns setting and claws `unknown` and stone lines `unchecked` | `features/stoneSet.test.ts`, `measured.test.ts` |
| **Prompt and journeys** | | | |
| 82 | `prompt.test.ts` (section 9) and the rebuilt recordings | Pass; replay tests pass | `agent/prompt.test.ts`, replay |
| 83 | Hand edit, then "make the band 0.2 mm thinner" | The context lists the edit; the amendment's from-value is the person's edit | `assistant/turn.test.ts` |
| 84 | Card budget for A1, A2, B, C, D and Do it all | The counts of 1.5, exactly | `apps/studio/e2e/own-cad.ts` |
| 85 | Phone and app view: chip, What I read, route card, tiles | Nothing scrolls sideways; tiles two across | same |
| **Added in review** | | | |
| 86 | Assistant `chooseDirection` on a piece with a spec | One amendment of the differing lines, source `direction`; on an agreed spec it needs the quote and the card | `server/spec.test.ts` |
| 87 | Import draft, one writer | `bindPiece`, then `openAsCad`: the draft is written once (source `from-model`); the assistant's `setSpec` on it gets `spec_exists`; its naming amendment is one quiet draft line, all assumed | `ideas.test.ts`, `assistant/route.test.ts` |
| 88 | Shot assets | Never on the board; `takeToCad`, a vary or refine parent and any role but `form` refuse a shot asset id | `pipeline.test.ts`, `handlers/pieces.test.ts` |
| 89 | Take to CAD from a photograph whose matte fails | Built from the spec and the picture's changes; `match.fit` refused honestly; the one line said; no half change | `assistant/take-to-cad.test.ts` |
| 90 | *Change this CAD* on an agreed spec | The assistant's `amendSpec` with source `picture` and no quote is refused (`quote_not_found`); the studio's card press amends as the person | `spec-gate.test.ts` |
| 91 | A version finished by `design.apply` | The job ends with the `agreeSpec` card listing lines changed from the source; it cannot finish without it | `jobs.test.ts` |
| 92 | A version's build card | Lists every line that differs from the source's agreed spec, including draft amendments made without a card | `spec.test.ts`, UI `ApprovalCard.test.tsx` |
| 93 | Undo on a draft line | Works while the line holds that value on a draft; disabled once the spec is agreed or the line moved again | `SpecDraftLine.test.tsx`, `spec.test.ts` |
| 94 | Open brief, no CAD view | Near-copy and A/B skipped (`nearCopy: null`, `pairwise: 'skipped'`); cues decide alone | `pipeline.test.ts` |
| 95 | `briefIds` | Four briefs make four pictures and the card says four; `count` with `briefIds` refused; retry cap 2 of 4, 1 of 1 | same, `imagegen.test.ts` |
| 96 | `readModel` ownership | Another organisation's asset, piece or reference: `not_found`; a Home asset before any piece: readable by its thread's owner only | `models/read.test.ts` |
| 97 | File detection | `.stl` and `.3dm` with an empty `File.type` accepted by extension; self-contained `.gltf` accepted; `.gltf` with external buffers gets "export GLB" | `composer-attach.test.ts`, `read.test.ts` |
| 98 | `.pave` round trip | `spec.basis`, `spec.picture`, `spec.from` and `version_of` survive export and import | `server/pave.test.ts` |
| 99 | Matte on photo-look fixtures | White seamless with a contact shadow: matte plain in every fixture; stone surface: rate reported (feeds D2) | `handlers/match.test.ts` (fixture images) |
| 100 | Same bytes, two assets | One `model_read` row; each read returns its own `source.assetId` | `models/read.test.ts` (database) |
| 101 | New brief | A verified `newBrief` quote clears the stored route; an unverified one is ignored; a new project starts with none | `route.test.ts` |
| 102 | The assistant's own `amendSpec` mid-run | No spec note; a person's card edit in the same run does give one | `loop.test.ts` |
| 103 | Cancel during a read | The worker job is aborted, its slot freed, no row left; the next read of the bytes starts fresh | `models/read.test.ts` |
| 104 | Renders read with the file | The What I read card shows "Read 2 renders · $0.01"; the cost is metered | `ReadModelCard.test.tsx`, `turn.test.ts` |
| 105 | Do it all | No `chat.route`, no second-way link; recipe confirms admitted; build and agree cards still shown | `jobs.test.ts` |
| 106 | *Rebuild as a version* by hand | From the model tile and the CAD menu: version made, build card shown, no assistant needed | UI `DesignBoard.test.tsx`, `handlers/pieces.test.ts` |
| 107 | `.3dm` phase-1 stones (fixtures with block instances and a "Gems" layer) | Count exact, width ±0.02 mm, positions ±0.01 mm, weight without them, dark in the shots; a fused STL reads "including any stones" | `import/stones3dm.test.ts` |
| 108 | "What do you think?" with a file | No card; the reply uses the read and offers the routes in words | `route.test.ts` |
| 109 | Presses that settle the route (Take to CAD, *Picture ideas from this model*, *Rebuild as a version*, the Generate panel, a job start) | Route stored `by: 'person'`; no `chat.route` in that run | same |
| 110 | Bore-only ring size | `checkSpec` meets `ring.size` from `facts.bore`; Put back not offered; *Differs* offers Update the spec or Rebuild as a version | `schema/spec/check.test.ts`, UI `SpecPanel.test.tsx` |

**Live evals** (`pnpm agent:eval route|look|keep|read`; not in CI; results filed in `docs/research/`; they need keys, allowed hosts and the founder's material):
- **E1 Route:** 30 prompts covering every signal row, with and without attachments, remembered routes and Do it all. Each is labelled go or ask, plus the route. Done: ≥ 90 % routes right and ask precision ≥ 0.8.
- **E2 Look judge:** 40 pairs the founder labels "looks like CAD or not". Report agreement, then set the cue count, the pair rule and the near-copy threshold from it.
- **E3 Faithfulness:** five of his CAD pieces × two providers × four pictures. Report the rate of centre count, claw count and halo kept, with and without the top view. If claws drift, revisit a structure-controlled provider (scope cut).
- **E4 Reader:** five of his files from different tools, read with the local bench (`pnpm --filter @pave/kernel bench:import <folder>`, which prints units, objects per layer, cached-mesh presence, blocks and the read; no file leaves his machine). Report stones found and sized against what he says each file holds. This sets the first-guess thresholds (convexity 0.97, cut margin 0.03, roundness 0.15 mm) before step 32 is called done.

## 12. Scope cuts

- STEP import (it needs a `brepBody`; freeform-cad step 8).
- Exact B-rep `.3dm` (freeform additions step 23).
- Stones from seats in casting STLs (phase 2 asks instead).
- Resizing an imported mesh ring (step 19 `meshOp`); the route recommends a rebuild.
- Band profile and shoulder from a file; prong tip shapes.
- Two-tone in the spec (spec-truth D4).
- Plug-in data.
- JewelCAD `.jcd`.
- The silhouette mask comparison of a picture with its CAD view.
- Pointing at stones on cropped regions, three runs.
- A canny or scribble-controlled provider (Imagen on Vertex) until E3 says so.
- Versions with a switcher inside a project.
- Sculpting a mesh toward a picture.
- On-model pictures from an import.
- Per-conversation generation grants.
- A route eval in CI.

## 13. Build order

Each step is one branch and one PR, tests first, screenshots where a screen changes, at most about 400 changed lines with its tests. A command gets `tool: true` only in the step that implements it. Steps marked † change a tool definition or prompt text, so they update the `PROMPT_HASH` snapshot and re-record the recordings they touch (§9).

| Step | What ships | Touches | Tests | Size |
| --- | --- | --- | --- | --- |
| **0** | Merge spec/truth and ui/focus, under its own plan (`docs/plans/merge-spec-ui.md`: the conflict list for `jobs.ts`, `commands.ts`, `entities.ts`, the assistant UI, `cad/index.tsx`, `Toolbar.tsx`, `TakeTile.tsx`; both suites and the replay tests green) and its own review | both branches | all | merge |
| **1** | Pure schema: `model-read.ts`, `keep.ts` (`keepListFor`, `departures`, `laterStatements`), `PieceSpec.basis/picture/from`, `MeasuredFacts.source/bore`, `checkSpec` on `band ?? bore`, `LineResult.why` | `packages/schema/src/spec` | 44, 110 (check), keep units | 300 |
| **2** | Entity fields and migration 0019; no commands | `api/entities.ts`, `drizzle/0019` | entity and migration tests | 250 |
| **3** | Real size: `MeshBody.size: 'file'`, units, `evaluate/bore.ts`, ring upright, `bore` in `measured.ts`; `openAsCad size`; "Opened at its real size" | `kernel`, `ideas.ts`, UI `bring-in.ts` | 12, 16, 17 | 350 |
| **4** | Kernel reader phase 1: `import/{scene,units,read}.ts`, facts from the transient design | `kernel/import` | 13, 14, 15, 19, 20 (kernel half) | 400 |
| **5** † | `references.readModel`: worker with caps, cache without asset id, ownership, cancellation | `server/models/read.ts` | 6, 19, 20, 23, 96, 100, 103 | 400 |
| **6** | Shots in the reference look; `captureImages` learns `shots`; `viewport.capture mode: 'reference'` | `assistant/capture.ts`, `loop.ts` | 18, 22 | 350 |
| **7** | `specFromModelRead`, the render merge, the server-written import draft in `openAsCad` | `schema/spec/amend.ts`, `ideas.ts` | 24, 25, 28, 87 (open half) | 350 |
| **8** | `.3dm` cached meshes: `runtime/rhino.ts`, `import/rhino3dm.ts`, `names.ts`, `no_mesh`, `partialMesh`; Bring in and board accept `.3dm`; the bench | `kernel/import`, UI accept lists | 5, 21 | 400 |
| **9** | `.3dm` stones in phase 1: block instances and stone layers kept apart, counted, sized, out of the weight, dark in the shots | `kernel/import/stones3dm.ts` | 107 | 300 |
| **10** | Home takes 3D files: extension detection, chip, read on upload, `turn.ts` model lines and shots, `bindPiece` pins and writes the import draft | UI composers and store; `turn.ts`, `loop.ts` | 1–4, 7–11, 87 (bind half), 97 | 400 |
| **11** | Conversation rows: What I read (with the units fix and the renders cost) and picture tiles | UI `minimal.ts`, `MessageView.tsx`, `ReadModelCard.tsx`, `PictureTiles.tsx` | 14 (UI), 104, 85 (part) | 300 |
| **12** † | Looks: `look`, verified `lookAsked`, the photo `BRIEF_SYSTEM` (D2 backdrop), the rendering-word ban, the model list | `agent/imagegen.ts`, `pipeline.ts`, `ideation/openai.ts` | 46, 47, 52, 59 | 350 |
| **13** † | Form: `form`, `shapeFrom` as shot assets, `looksLikeCad`, model references as views, routing to a provider that sees references | `imagegen/{pipeline,shapes}.ts`, `agent/imagegen.ts` | 49, 50, 51, 88 | 400 |
| **14** | Generate panel: Look and Shape from; tile details "Sent as shape" | UI `GeneratePanel.tsx`, `DesignBoard.tsx` | 48 | 250 |
| **15** † | Look checks: near-copy, cues, A/B, capped retry, nothing shown when nothing passes, `generation.checks`, the cap on the card | `imagegen/checks.ts`, `agent/imagegen.ts`, UI `ApprovalCard.tsx`, `PictureTiles.tsx` | 53–57, 94, 99 | 400 |
| **16** † | The setSpec rule: assistant-only `spec_exists`, people's writes as line diffs, `chooseDirection` as an amendment, `changed` output, and in the same PR every prompt and tool text that sends the model to setSpec on an existing piece | `spec.ts`, `handlers/pieces.ts`, `loop.ts`, `commands.ts` l.1200, `skills/photo.ts`, `core.ts` | 26, 86, 82 (setSpec text) | 350 |
| **17** † | Binding: `specVersion`, keep list in the prompt, `direction`, `spec_departs` | `pipeline.ts`, `agent/imagegen.ts` | 60–63 | 400 |
| **18** † | `briefIds` (one picture per brief, `count` refused), keep marks | `pipeline.ts`, `commands.ts` | 58, 95 | 300 |
| **19** † | Picks: `amendSpec fromReferenceId`, later statements win, Take to CAD on a draft, the matte-failed line, the mid-run note, Design recipe tools | `spec.ts`, `handlers/pieces.ts`, `loop.ts`, `jobs.ts` | 29, 30, 64, 66, 89, 102 | 400 |
| **20** | Spec in the studio: the quiet draft line and its Undo rules, tile marks, panel tags | UI `SpecDraftLine.tsx`, `minimal.ts`, `features/spec/`, `ideate` | 27, 93 | 300 |
| **21** † | Route, server part 1: Flow block, `chat.route` with server labels, memory, `newBrief`, `route_settled` and the presses that settle a route | `context.ts`, `turn.ts`, `loop.ts`, `jobs.ts` | 34, 36–38, 41, 42, 44, 45, 101, 105, 108, 109 | 400 |
| **22** † | Route, server part 2: `runs.decide instead`, the second way on the first go-ahead, the grant | `loop.ts`, `runs` handler | 35, 40, 43 | 300 |
| **23** | Route in the studio: route card through `QuestionsCard`, the second-way link | UI `ApprovalCard.tsx`, `QuestionsCard.tsx` | UI tests for both, 85 (part) | 250 |
| **24** † | Import agree: `openAsCad` and `agreeSpec` as tools, the agree-and-keep card, `imported-mesh`, Put back and *Differs* on a bore-only size | `ideas.ts`, `spec.ts`, UI `features/spec/` | 31–33, 110 (UI) | 400 |
| **25** † | Versions, server: `duplicate as: 'version'`, `takeToCad asVersion`, the build and agree cards' changed-from-source lines, the `design.apply` finish, the studio's *Change this CAD* call | `handlers/pieces.ts`, `spec.ts`, `jobs.ts` | 65 (server), 67, 90–92 | 400 |
| **26** | Versions, studio: Take to CAD on an agreed piece in every entry point, "From …", *Picture ideas from this CAD*, *Rebuild as a version* by hand | UI `JobMode.tsx`, `ideate/{DesignBoard,actions,GeneratePanel}`, `BringIn.tsx`, `PieceDirections.tsx`, `TryVariants.tsx`, `AreaCards.tsx` | 65 (UI), 106 | 400 |
| **27** † | Rebuild: `match.fit fromPieceId` with known cameras, stone mask and `pinned` | `handlers/match.ts`, `packages/match` | 68–72 | 400 |
| **28** † | The prompt: `skills/{route,model}.ts`, core and skill edits, recipe lists, `prompt.test.ts`, scripted journeys, every recording re-recorded once | `packages/agent/src/prompt/`, `jobs.ts` | 39, 82, 83 | 300 + prompt text |
| **29** | Phase 2a: `parseObjects()` for OBJ, GLB, 3MF, STL; `classify.ts`, `gemFit.ts` | `kernel/mesh/parse`, `kernel/import` | 75–77 | 400 |
| **30** | Phase 2b: `heads.ts`, `lots.ts`, stones in the read and the draft | `kernel/import`, `schema/spec/amend.ts` | 73, 74, 78–80 | 380 |
| **31** | Phase 2c: the `StoneSet` node, drawn and published | `kernel/features/stoneSet.ts` | 81 (node) | 350 |
| **32** | Phase 2d: `source.part`, per-part metal, materials, stone lines checked, weight without gems; `openAsCad` builds them. Bench E4 on the founder's files before done | `measured.ts`, `ideas.ts`, `spec` check | 81 (rest), E4 | 350 |
| **33** | Journeys: Playwright A–D and Do it all with card counts at both sizes and the app view; `docs/design-language.md` "Starting from your own CAD"; README and ARCHITECTURE file map; board row; then E1–E3 once keys, hosts and the founder's material exist | `apps/studio/e2e/own-cad.ts`, docs | 84, 85, E1–E3 | 250 |

What ships when:
- Steps 3–11 give the founder's case its first half (drop a CAD or a `.3dm` on Home and see what was read, stones counted in Rhino files) with no new paid calls.
- Steps 12–15 make every picture a photograph, and never show a CAD-looking one.
- Steps 16–20 keep the spec current through suggestions, pictures and picks.
- Steps 21–23 make the assistant ask only when it must.
- Steps 24–28 add versions, the keep-the-file route, the rebuild, and the prompt that ties them together. **After step 28 the founder's loop works end to end** as Journey C describes it for phase 1.
- Steps 29–32 make every import honest about cut, carat and claws.

**What is needed from the founder** (not decisions): five of his own files from different tools for E4 and step 32; 40 labelled pairs for E2; image keys and the allowed hosts listed in `research.md` for E1–E3 and to confirm the `[S]` claims.

## 14. What this revision did not take from the review, and why

- **Moving all of `.3dm` stone recognition into phase 1.** Taken only in part: separate stone objects in `.3dm` are counted and sized in phase 1 (cheap, block instances carry transforms), but cut, carat and claws stay phase 2, because cut recognition is the least certain part and needs E4 on real files.
- **Making `MeasuredFacts.band` fields optional.** A separate `bore` fact was chosen instead, so no existing reader of `band` changes.
- **Removing the route card altogether.** It stays for one case, a file dropped with no words, because that is exactly the founder's "do you want CAD directly or pictures first?" and no signal settles it.
- **Amending on every pitched picture**, as the founder's words could be read. Not taken by default; put to him as D4.
