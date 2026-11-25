# Pavé — architecture

Pavé takes a piece of jewelry from an idea to a manufacturer's bench in one workspace:

```
Ideate ──▶ Spec ──▶ CAD ──▶ Render ──▶ On model ──▶ Sourcing ──▶ Production
 boards    plan     feature   stills &    brand       stones &     package for
 search    with     tree      animation   models      metal        the caster
 generate  the AI
```

An assistant can do everything a person can, through the same commands, and every edit —
human or AI — is recorded.

The research behind each decision is in [`docs/research`](./research); this page is the map.

## Three ideas everything hangs on

**1. A design is a document; geometry is a pure function of it.**
A design is a flat map of typed nodes (`ringShank`, `gem`, `setting`, `halo`, `gemRow`, `pave`,
`vectorBody`, `meshBody`, `relief`, `bail`, `chain`, …) that reference each other by id
([`packages/schema/src/design/nodes.ts`](../packages/schema/src/design/nodes.ts)). Nothing
geometric is stored. `@pave/kernel` evaluates the document into solids, instanced stones and a
report (weights, carats, diagnostics). Each parameter is declared once — range, default, unit,
label — and the inspector, validation and the assistant's tool schemas are all derived from that
declaration.

**2. Ops are the only way a design changes.**
A slider drag, an undo and an assistant tool call are all a list of ops
(`add` / `update` / `remove` / `move`) applied by one function that also returns the exact
inverse ([`design.ts`](../packages/schema/src/design/design.ts)). The server orders them into an
append-only log attributed to a user or to an agent run and tool call. That one log is undo/redo,
version history, the audit trail, live sync, and the trace dataset: an agent's edit followed by a
person's correction is implicit feedback, captured without extra instrumentation.

**3. One command registry.**
Every operation the product can perform is declared once with its input/output schema, minimum
role and whether it needs confirmation
([`commands.ts`](../packages/schema/src/api/commands.ts)). The server implements a handler per
command; the studio calls them through a typed client; the assistant's tools (and, once built,
the MCP server) are generated from the same entries. "What can a user do", "what can the assistant do" and "what
can an outside agent do" are one list with one set of permissions, metering and traces.

## Workspace model

```
Organisation
 ├─ Folders (collections, 2 levels) ─▶ Projects (pieces): a design board, CAD, renders,
 ├─ Boards (ideas) ─▶ References       on-model shots, stones, production packages, history
 ├─ Brand models
 ├─ Library        metals, stones, cuts, ring sizes, templates
 └─ Settings       members, AI, plan, usage, traces, privacy, integrations
```

The sidebar is navigation plus the folder tree. A piece page has tabs — Overview, Design
(the design board), CAD, Render, On model, Sourcing, Production, History. A stage is a status, not a gate: every tool is
always available, and every AI action has a manual way that never asks for AI. The assistant is a
window aware of the open piece, its stage and any board: snapped into the right-hand sidebar,
pulled out as a floating frosted-glass window, or folded to a pill that shows a running job's
progress (`apps/studio/src/app/AssistantDock.tsx`, geometry in `src/lib/float-window.ts`); where it
was is remembered per browser, and opening another piece brings up that piece's conversation. It is
also on the Home page as the starting point ("What are we making?").

## Packages

| Path | Role |
| --- | --- |
| `packages/schema` | The contract: reference data (metals, gems, sizes), the design document and ops, piece specs, recipes/templates, wire entities, the command registry |
| `packages/kernel` | Geometry: evaluate a design; export STL / 3MF / STEP / 3DM / OBJ / GLB |
| `packages/render` | Material library, looks, scene resolution, three.js materials (incl. the gem shader), Blender job runner |
| `packages/sourcing` | Stone and metal requirements from CAD; marketplace providers (Diaex first) |
| `packages/production` | Drawings, bill of materials, costing, manufacturability report, the bundle |
| `packages/agent` | The assistant: tools from the registry, the frozen prompt and skills, model tiers and prices, the run reducer; the gate's pure rules (run caps, rights, loop breaker, human-edit overlap); `./anthropic` (server only) builds Claude requests and adapts the SDK stream; `./tier-check` is the quick per-model request check. An MCP server for Claude Code is planned, not built |
| `packages/ui` | Design tokens and components ([the design language](./design-language.md): tokens, the glass rules, do and don’t) |
| `apps/server` | Hono API: auth, tenancy, command handlers, assets, usage ledger, traces, jobs; `src/assistant` runs the assistant (durable run loop, live-run driver and run event stream, approvals, client-tool bridge, feedback hook, the Claude API key sealed per organisation and registered at runtime, tiers) |
| `apps/studio` | The application (Vite + React); also served by the server as a single binary |
| `apps/desktop` | Planned, not built: an Electron shell that starts the local server and opens a window on it |
| `workers/render` | Python + `bpy`: the fixed Blender runner |

## Geometry

Two kernels behind one `Solid` abstraction ([research](./research/01-cad.md)):

- **OpenCascade** (via replicad) for everything parametric — bands, heads, bezels, bails. These
  are exact B-rep solids and export to **STEP**, which Rhino and MatrixGold open as NURBS.
- **Manifold** for everything freeform — imported, scanned or AI-generated meshes, extruded
  logos and lettering, reliefs — and for robust booleans whenever a mesh is involved. Whatever is
  cast is fused per metal into a guaranteed-watertight mesh for **STL / 3MF**.

Stones are never booleaned for display: they are facet-accurate meshes, instanced, so a pendant
with thousands of pavé stones stays interactive. Seats, azures and beads are cut only at
`production` detail. Evaluation is memoised per node, so dragging a slider rebuilds only what
depends on it, in a Worker.

**Anything can become jewelry.** Beyond the parametric archetypes, a body can come from text or
a logo outline (`vectorBody`), from an image as a relief (`relief`), or from any mesh
(`meshBody`: a scan, a download, or image-to-3D output). Each resolves to a closed solid in
millimetres that the same downstream features work on: scale to a real height, flat or hollow
the back, `pave` a region with graded stock-size stones at a chosen "ice level", add a `bail`,
hang it on a `chain`. That is the route from a photo of a trophy to an iced-out pendant
([research](./research/06-freeform.md)).

`.3dm` files carry layered meshes, curves and metadata; a true B-rep cannot be written to 3DM
from open tooling today, so STEP is the lossless interchange and the export notes say so.

## Rendering

One declarative `RenderScene` — look, camera, environment, overrides, animation, output — is
resolved into explicit numbers and drives both the real-time viewport (three.js, our own
BVH-traced gem shader) and Blender Cycles through a fixed, reviewed runner
([research](./research/03-rendering.md)). The assistant directs shots by editing that JSON; it
never writes Python. A look is a rig of softboxes described once, built as an environment map in
the browser and as area lights in Blender, so the preview and the final render agree. Renders are
checked numerically (framing, clipping, exposure, noise); a take renders exactly the scene it was
given, with a fixed Cycles seed (the same scene gives the same pixels on the same machine, measured
at any thread count), and auto-tune adjusts a preview draft only when asked or inside an AI job.
Each take records `sceneHash`, the fingerprint of the resolved scene it rendered. The Render tab's
live picture is a viewfinder: framing it by hand stores a custom camera (position, target, lens,
roll, and the bounds it was framed on, so a house shot scales to other pieces) as one undoable
shot change (`scenes.history`, `scenes.revert`), and a locked camera moves for nobody, the
assistant included. The vision pass is the assistant's own look at the finished take, inside a
traced run.
The Render job is a cinematographer (`@pave/render` `cinema.ts`, the assistant's cinema skill):
`scenes.suggest` reads what matters in the piece and places a camera for each shot of its kind's
vocabulary, `chat.ask` asks at most three quick questions as an approval-style wait whose answer
(`runs.decide {answers}`) comes back as the tool result, `scenes.capture` draws each shot through
its own camera on the server and measures the framing, and the loop refuses an assistant's take
of a shot that cuts the piece off. Animations (turntable, half orbit, push-in, macro sweep,
sparkle pass) are keyframed once and played by both renderers; a Blender animation take is an
MP4 from bpy's built-in encoder, its first frame as a poster, and a GIF made with sharp. A
person's later actions on the assistant's takes and shots (kept, swapped, starred, deleted,
reframed, restyled, re-rendered) are written as implicit feedback on its run (`render-feedback.ts`).
Without Blender, a take is drawn by one of the person's own windows from the same resolved scene
and labelled "Preview quality". A render costs this computer's time, never money: estimates are
machine time, learnt from this machine's finished takes.

### On a light machine

The CAD view and the Render tab's live preview draw on demand: nothing moves, nothing is drawn
(an idle window costs no frames and no battery). How sharp they draw is decided in one place,
`apps/studio/src/components/stage/adaptive.ts`, from measured frame times and the Performance
setting (Settings › General, per device: Auto by default, Smooth, Sharp):

- A still picture is drawn at the screen's pixel ratio, capped at 1.5 on a Retina screen in Auto
  and by the GPU tier (`quality.ts`; the base Apple M chips that Chrome and Electron name are
  integrated GPUs, like Safari's "Apple GPU").
- While the camera moves or a slider scrubs, the picture is drawn lighter: the pixel ratio follows
  the time between frames towards 30 frames a second (never below 0.5), and only when that is
  not enough do the effects step down (fewer bounces in the stones, then plain clay stand-ins
  while moving). It sharpens about 150 ms after the move stops. A machine where a full frame is
  slow draws every edit light first and sharpens it a moment later.
- When Auto had to step the effects down (or the setting is Smooth), the page drops its frosted
  glass for solid fills (`<html data-glass="solid">`): a software or weak GPU compositor pays for
  each blur on every frame.
- A quiet chip in the corner of the view says when the picture is reduced and opens the setting.
  Captures for covers and the assistant always use full effects.

On the server, the kernel pool sizes itself to the computer (`poolDefaults` in
`engines/kernel/pool.ts`): about a third of its memory and one CPU left free, so an 8 GB laptop
runs two workers of 1 GB with two warm pieces each. Blender uses the Apple GPU through Cycles on
Metal when present (`workers/render/pave_worker/devices.py`); time estimates learn from takes on
the device in use and count a fixed cost per animation frame.

## Assistant

The run loop lives on the server and uses the command registry as its toolset, plus a few
client-side tools (look at the viewport from named angles, navigate the UI). Commands flagged
`confirm` — anything destructive or that spends money — pause the run for approval. For CAD the
assistant works spec-first: it settles a small, readable `PieceSpec` with the designer, builds
the first design from a recipe, then refines with ops and checks itself with `design.evaluate`
and viewport captures. For an open brief it first proposes two to four design directions: built,
evaluated and priced variants of the same piece, compared as cards, mixed by part and chosen by
the designer, the chosen one becoming the piece's design. Every job asks before it acts, in its
first step, as quick replies with defaults picked (`chat.ask`): the Design job about what the brief
leaves open, the CAD job about what the spec leaves open, the Render job about purpose, shapes and
animations; the answers are kept on the job (`AiJob.answers`) and shown under that step of its
plan. A newly pinned picture can update an existing design as a CAD job ("Update the design to
this picture"), undone in one step; pinned shot references are copied by the Render job into its
cameras and shown beside each framing capture (`scenes.capture` `references`). Runs, steps, tool calls, token usage and cost are stored and linked to the
design changes they produced; organisations control retention and whether their traces may be
used for evaluation.

The Claude API key comes from `ANTHROPIC_API_KEY` or is pasted in Settings, AI and sealed per
organisation in the database; each run uses its conversation's tier (Power, Standard, Light),
each tier a model from a fixed allow-list. The server notes only whether a key is saved
(`<PAVE_DATA_DIR>/assistant-key.json`, yes or no) so the installer's `--check` can report it.
`pnpm agent:smoke` (`apps/server/src/smoke-cli.ts`, journeys in `src/assistant/smoke.ts`) is the
live check for a person with a key: the real server with its database in memory runs a brief to
directions, a photo to a design, a chat edit and a Blender render with the model's critique,
playing the designer (it approves what a run asks for and answers each job's `chat.ask` with the
defaults, but stills only, so the render is one quick take), and checks that each run finished, each design evaluates, the prompt cache is read and no replayed
thinking block is dropped. Its harness is tested without a key, with scripted turns.

Without a key, every assistant test reaches Claude through the real SDK and a strict fake Claude
API (`packages/agent/src/testing/fake-api`, described in [fake-claude-api.md](fake-claude-api.md)):
it validates each request against the documented rules (each rule cites its document), streams
replies as the real API does, injects errors, refusals, fallbacks and dropped streams, binds
thinking blocks to their conversation and models the prompt cache. `scripts/test-tiers.sh` runs
the suite on each tier's model. The founder's journeys were recorded with Claude playing the model
(`apps/studio/e2e/harness.ts` against the fake in agent mode) and are replayed through the real
loop by `replay.test.ts`.

## The design board, projects and folders

The Design stage is image-based: a piece's design board is the moodboard linked to it
(`board.piece_id`; `boards.forPiece` makes it once, its id derived from the piece so two windows
make one). It holds uploads (photos, scanned sketch sheets), sketches made in the app, pasted
links (Pinterest, Google, a shop: view-only, their picture captured only on request through the
safe fetch), notes, museum results and 3D models kept as inspiration (`Reference.type: 'model'`,
shown view-only by three.js loaders in `features/ideate/ModelViewer.tsx`). Boards also live on
their own in Ideas and can be linked, unlinked or started as CAD at any time
(`apps/studio/src/features/ideate`). The ways out of the board are in `apps/server/src/ideas.ts`:
**Take to CAD** (`pieces.takeToCad`) pins a picture beside CAD and the studio starts a CAD job
with it; the job calls `references.read`, whose result carries five spec questions with the
picture's answers as defaults (`packages/agent/src/spec-questions.ts`), asks them with
`chat.ask`, estimates the spec (`pieces.estimate`: the canon's build, evaluated and priced) and
builds; after `pieces.buildFromSpec` the loop lays the pinned picture in the matching CAD view,
scaled by its cut-out to the build (`assistant/take-plane.ts`). **Open as CAD**
(`pieces.openAsCad`) adds STL, OBJ, GLB, 3MF or PLY as a `meshBody` (STEP is refused as planned).
Built parametric alternatives (directions) are now **Try variants** in the CAD stage, off the
main path.

A project is a piece presented as its three stages with their costs, and a folder is a
collection that may sit in one other folder (two levels: the breadcrumb, the move menu and the
totals stay one glance deep). Every usage row carries its piece and stage (`usage_event.stage`:
a run's spend counts against its job's stage, else the stage tab the message came from,
`agent_run.stage`; image generations against Design; render machine time against Render), and
the plan's claims carry their piece. `apps/server/src/projects.ts` adds them up per project and
stage (`projects.summary`) and per folder, sub-folders included.

## References beside CAD

A reference panel sits beside the CAD workspace and the Render tab. It searches the keyless open
collections of The Met, the Art Institute of Chicago and the Cleveland Museum of Art
(`apps/server/src/references`), the piece's own photos and moodboards, the organisation's
boards, a pasted link or a dropped picture. Pins are references on one board per piece
(`board.pins_for`), so they share the boards' provenance and rights rules: a search result is
re-read from its provider before it is saved, and its picture is kept only where the provider's
terms allow (CC0); a pasted link stays a view-only link until someone captures its picture,
explicitly, through the SSRF-guarded safe fetch (`apps/server/src/net/safe-fetch.ts`). The model
sees pinned pictures it may use (labelled, once per conversation) and only the details of
view-only ones; `references.read` and `match.fit` refuse view-only pictures for anyone. A pinned
picture can be laid in the front, top or right view as an image plane (`references.place`): the
viewer draws it before the piece in a scene of its own, so it never reaches a capture, a render
or an export, and its moves have their own undo history. The panel is a reference window: docked
beside the work or floating over it, with tabs for References, a Sketch pad (a sketch is saved as
the person's own pinned picture and can be laid in a view like any other) and, only when an image
provider has a key, Generated.

## Concept images

The design board generates concept images in three commands (`apps/server/src/imagegen/pipeline.ts`):
`references.brief` (a structured Claude call, `packages/agent/src/imagegen.ts`: the guardrail's
verdict, the reading of the request and the prompt enhanced for jewelry, stored as an
`image_brief`), `references.attestBrief` (a person, never a tool, attests the right to a brand the
brief named) and `references.generate` (the provider makes the images from exactly the brief's
prompt; a second structured Claude call checks each image, and only the allowed ones are stored as
`generated` references with their lineage). Inside a run both Claude calls use the run's client
and tier (`Ctx.claude`, set by the loop) and are billed to the run; outside, the organisation's
default tier (`Assistant.claude`). Every guardrail failure fails closed. Each decision (the
request, each image, the provider's own filter, an attestation) is appended to the brief, which is
the trace for person-made generations; in a run the step output carries it too.

The providers are one family in `packages/ideation` (Gemini's `generateContent`, OpenAI's Images
API, Higgsfield's queued SOUL model, and a fake), each with its safety settings at the strictest
sensible level, injected `fetch` and a price table. `apps/server/src/imagegen/setup.ts` owns the
keys (sealed per organisation and provider like the Claude key, `.env` wins), the default
provider, quality and models, and registers `imageGen` exactly while a key exists. Claude's spend
is metered on `llm` and the provider's on `image`, both as Design work on the board's project.

## Platform

- **Tenancy and auth** — Better Auth with organisations; `org_id` on every row behind a scoped
  repository; roles owner / admin / designer / viewer / guest. Self-hosted and desktop use run
  in `local` mode with no sign-in ([research](./research/05-platform.md)).
- **Storage** — Postgres through Drizzle; embedded PGlite when no database is configured, so
  the same schema runs as a single process. Content-addressed blobs on disk or S3.
- **Usage** — an append-only ledger of metered events (model tokens, images, searches, 3D
  generations, render time) with idempotency keys; billing is an adapter on top.
- **Plans** — Free and Pro, defined in `packages/schema/src/plans/config.ts`. The CAD studio,
  AI jobs on your own key, browser previews and mesh exports (STL, 3MF, OBJ, GLB) are never
  counted; finished Blender takes and Rhino or STEP exports (and production packages with them)
  are counted per calendar month (UTC). `apps/server/src/plans.ts` is the one owner: each
  counted action claims a numbered slot before its work starts (a unique index decides races),
  keyed by the work so a retry counts once, and gives it back when the work fails or is
  canceled. The studio claims before exporting in the browser (`plan.claim`, `plan.settle`).
  Over the limit the server answers `plan_limit` (402); there is no checkout yet. `PAVE_PLAN`
  switches plans on a local install for testing.
- **The Pavé file** — `.pave` is the native file: a zip with a manifest, the design and its
  full change history, spec, directions, pinned references (pictures only where their rights let
  them travel), image planes, saved shots, thumbnails and the evaluated geometry, plus a checksum.
  Saving and opening one is always free and never counted (`pieces.saveFile`, `pieces.openFile`);
  opening checks everything, migrates older files and makes a new piece that keeps its
  provenance. The format and its versioning rules are in [`pave-file.md`](./pave-file.md); the
  contract is `packages/schema/src/files/pave.ts`, the code `apps/server/src/pavefile/`.
- **Desktop** — Electron: one Chromium everywhere matters for a GPU viewport. The shell only
  starts the server on loopback and opens a window; the web build is the same code.
- **Cross-platform** — macOS, Windows, Linux and the browser are all first-class. Geometry runs
  in WebAssembly, the database is embedded, there are no shell scripts in the toolchain, and CI
  runs on all three operating systems. Blender is found through the `bpy` wheel or a user
  install.

- **Licence** — Pavé is a proprietary product; the repository may be public, but it is not
  open source ([`LICENSE`](../LICENSE)). The one exception is `workers/render`, which imports
  Blender's GPL Python API and is therefore a separate GPL program that Pavé starts as its
  own process. OpenCascade (LGPL) ships as a separate, replaceable `.wasm` file.

## Sourcing

Every stone in a design is a structured record, so a piece has a live bill of materials. Each
row becomes a `StoneRequirement` (shape, seat dimensions with setting-specific tolerances,
quality, quantity; melee as parcels in stock sizes). A provider turns requirements into
purchasable stones. **Diaex** is the first provider, in phases
([plan](./research/07-sourcing.md)): deep links into Diaex search that fit the seat (works
today, no API); then matched candidates per row; then a cart for the whole design and requests
for stones nobody lists; then holds, order status and metal. When a real stone is chosen its
measured dimensions flow back into the design and the seat regenerates.

## Production package

A revisioned zip for the manufacturer ([research](./research/02-production.md)): spec sheet,
dimensioned drawings, watertight STL per metal part plus reference stones, STEP and 3DM, stone
list and bill of materials, a transparent cost estimate, a manufacturability report against
editable thresholds, renders, and a manifest that records units, volumes, weights and that
geometry is nominal (the caster compensates for shrinkage).

## Roadmap notes

**Order of work.** The core engine comes first: the geometry kernel and the CAD workspace are
finished and independently tested (every template, parameter fuzzing, visual inspection,
watertight exports, performance) before the breadth features — ideation, brand models,
publishing — are built on top of them.

**Teams.** Organisations, members, roles, invitations and per-organisation isolation exist in
the server. Still to do: invitation email and the accept flow in the studio, a members page that
manages seats and guests (a manufacturer sees only the production packages shared with them),
presence and live cursors on a piece (the op log already orders concurrent edits), and comments.

**Sign in with Diaex.** One Diaex connection should be both identity and sourcing: "Continue
with Diaex" on the sign-in page, and the same grant used to match stones and build carts. Diaex
authenticates with Firebase, which is not itself an OAuth provider, so Diaex needs a small
authorisation-code + PKCE endpoint that issues a signed identity token (subject, email, name,
organisation, KYC level) and a scoped partner token — the first item of the hand-off checklist
in [`research/07-sourcing.md`](./research/07-sourcing.md). Pavé then treats Diaex as a generic
OpenID provider in Better Auth, links by verified email on first sign-in, and maps the Diaex
organisation to a Pavé organisation. Until that exists the two accounts stay separate and
sourcing uses deep links.
