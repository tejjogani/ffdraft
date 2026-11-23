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
command; the studio calls them through a typed client; the assistant's tools and the MCP server
are generated from the same entries. "What can a user do", "what can the assistant do" and "what
can an outside agent do" are one list with one set of permissions, metering and traces.

## Workspace model

```
Organisation
 ├─ Collections ─▶ Pieces            a piece is a page: brief, spec, design, renders,
 ├─ Boards (ideas) ─▶ References       on-model shots, stones, production packages, history
 ├─ Brand models
 ├─ Library        metals, stones, cuts, ring sizes, templates
 └─ Settings       members, usage, traces, privacy, integrations
```

The sidebar is navigation plus the collection tree. A piece page has tabs — Overview, Design,
Render, On model, Sourcing, Production, History. A stage is a status, not a gate: every tool is
always available. The assistant lives in a dock that is aware of the open piece or board, and on
the Home page as the starting point ("What are we making?").

## Packages

| Path | Role |
| --- | --- |
| `packages/schema` | The contract: reference data (metals, gems, sizes), the design document and ops, piece specs, recipes/templates, wire entities, the command registry |
| `packages/kernel` | Geometry: evaluate a design; export STL / 3MF / STEP / 3DM / OBJ / GLB |
| `packages/render` | Material library, looks, scene resolution, three.js materials (incl. the gem shader), Blender job runner |
| `packages/sourcing` | Stone and metal requirements from CAD; marketplace providers (Diaex first) |
| `packages/production` | Drawings, bill of materials, costing, manufacturability report, the bundle |
| `packages/agent` | The assistant: prompt, tools from the registry, run loop, MCP server |
| `packages/ui` | Design tokens and components |
| `apps/server` | Hono API: auth, tenancy, command handlers, assets, usage ledger, traces, jobs |
| `apps/studio` | The application (Vite + React); also served by the server as a single binary |
| `apps/desktop` | Electron shell: starts the local server and opens a window on it |
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
checked numerically (framing, clipping, exposure, noise) before a vision pass, and the assistant
adjusts and retries.

## Assistant

The run loop lives on the server and uses the command registry as its toolset, plus a few
client-side tools (look at the viewport from named angles, navigate the UI). Commands flagged
`confirm` — anything destructive or that spends money — pause the run for approval. For CAD the
assistant works spec-first: it settles a small, readable `PieceSpec` with the designer, builds
the first design from a recipe, then refines with ops and checks itself with `design.evaluate`
and viewport captures. Runs, steps, tool calls, token usage and cost are stored and linked to the
design changes they produced; organisations control retention and whether their traces may be
used for evaluation.

## Platform

- **Tenancy and auth** — Better Auth with organisations; `org_id` on every row behind a scoped
  repository; roles owner / admin / designer / viewer / guest. Self-hosted and desktop use run
  in `local` mode with no sign-in ([research](./research/05-platform.md)).
- **Storage** — Postgres through Drizzle; embedded PGlite when no database is configured, so
  the same schema runs as a single process. Content-addressed blobs on disk or S3.
- **Usage** — an append-only ledger of metered events (model tokens, images, searches, 3D
  generations, render time) with idempotency keys; billing is an adapter on top.
- **Desktop** — Electron: one Chromium everywhere matters for a GPU viewport. The shell only
  starts the server on loopback and opens a window; the web build is the same code.
- **Cross-platform** — macOS, Windows, Linux and the browser are all first-class. Geometry runs
  in WebAssembly, the database is embedded, there are no shell scripts in the toolchain, and CI
  runs on all three operating systems. Blender is found through the `bpy` wheel or a user
  install.

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
