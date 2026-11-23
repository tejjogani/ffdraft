# Ideate and the "anything can become jewelry" on-ramp

Build brief: the judged synthesis of two independent design proposals.

## 1. Experience

**Ideas** (`/ideas`, `/ideas/$boardId`): a quiet research desk; every action is a registered command.

- **Search works on first launch.** `F` opens a glass sheet over the board with one row per provider, each its own `references.search {providers:[id]}` query: skeleton, then tiles, or one muted line with the reason and Retry. Zero config shows Met, Art Institute of Chicago and Cleveland, with a footer link to Settings → Integrations. `Enter` saves.
- **Collect.** Paste or drop a URL, image or mesh; `N` note; `C` swatch. A URL is a link card at once; "Capture image" is an explicit action.
- **Two views, same items.** `V` toggles Masonry and Canvas (pan/zoom, arrow-key nudge); DOM order is `position` in both.
- **Provenance popover**: source, credit, licence, captured date, and the rights tier as a sentence ("Can be shown. Can't be sent to AI.").
- **Generate.** Selecting references raises a frosted bar, "Generate with 3". Chips take roles; view-only chips are locked with the reason; confirm shows count × price. Results land beside their parents with the spark badge. No image key: "Brief the assistant" / "Copy prompt".
- **Lineage panel**: parents ← this → children → pieces. Deleted parents remain as credit lines.
- **Promote.** "Start a piece from these" creates a piece whose brief lists the references and credits; an assistant, if configured, drafts the `PieceSpec` for confirmation.
- **Build on past work.** "Explore from this piece" opens a board seeded with the piece's cover and renders as `own` references carrying `pieceId`; its spec summary prefills the prompt.

**Make it jewelry**: one rail in the piece's Design tab over the live viewport, shown when the design is empty or `?make=1`. The Home composer (image attached), a tile's "Make it jewelry", palette `make.start`, the CAD empty state and the assistant all go through `pieces.create {origin}` and land there.

| Step | AI proposes | User confirms | Writes |
|---|---|---|---|
| Picture | cut-out; logo/character/face flags | subject (one threshold slider); "I own or may use this artwork" (+ consent for a person) | `freeform.analyze`, `pieces.attest` |
| Shape | Outline / Relief / Sculpt previews, recommended one preselected | mode; Sculpt shows price and ~60 s | `mesh3d.create` (Sculpt only), `pieces.setSpec`, `pieces.buildFromSpec` |
| Size & ice | height, flat back, regions from colour layers, bail, chain | 25/38/50/75 mm on a neck silhouette; None / Accents / Iced / Flooded; metal, stone, chain | one `design.apply` per control on `body`, `ice`, `bail`, `chain` |
| Check & render | diagnostics in plain words, each with "Fix for me" | go | `design.apply`, `renders.create` (`black-acrylic`) |

A readout (grams, stones, carats, cost range) stays pinned. Analysis shows skeleton tiles; a mesh job shows progress and cancel, with "Use Relief instead" on failure. With no 3D key the Sculpt tile reads "Connect a 3D provider, or drop a mesh"; Outline and Relief need no keys. Reduced motion stops the turntable; the rail is keyboard-operable throughout.

## 2. Structure

- `packages/ideation/`: `SearchProvider`, `ImageGenProvider`, `EmbeddingProvider` (research 04 shapes); keyless adapters `met`, `aic`, `cleveland`; keyed `smithsonian`, `europeana`, `brave`, `gemini-image`, `bfl`, `gemini-embedding`; `fanOut()`; `palette()` (OKLab k-means); `briefFromReferences()`. Injected `fetch`.
- `packages/freeform/`: pure functions on typed arrays: `isolate`, `heightmap` (silhouette dome plus luminance, or a supplied depth map), `meshDepth` (front depth of kernel `MeshData`), `lint` (stroke, gap, island in mm at target height), ice presets. `./node`: `trace` (`@visioncortex/vtracer`) and `sharp` decode/encode. `./providers`: `Mesh3DProvider` (research 06 shape) with `fal` and `fixture`.
- `packages/kernel`: export one `parseMesh(bytes, mime) → MeshData` (GLB/STL/OBJ), shared by the `meshBody` builder and `freeform.analyze`.
- `apps/server/src/providers.ts`: `servicesFromEnv(env)`, passed to `createApp({ services })` by `main.ts` and the desktop entry; the test harness stays hermetic. The three museums are always registered.
- `apps/server/src/`: extend `handlers/ideate.ts`; add `handlers/freeform.ts`, `handlers/mesh3d.ts` (mirrors `handlers/render.ts`), `net/safe-fetch.ts` (SSRF guard, size and time caps), `spend.ts` (check `monthlyBudgetUsd`, then `recordUsage`), table `mesh_job`.
- `apps/studio/src/features/ideate/`: `BoardsPage`, `BoardPage`, `SearchSheet`, `Masonry` (virtualised past ~150 tiles), `Canvas`, `ReferenceTile`, `GenerateBar`, `LineagePanel`, `commands.ts`, `store.ts` (selection, view, filters only).
- `apps/studio/src/features/make/`: `MakeRail`, `steps/{Picture,Shape,SizeIce,Check}`, `RegionPainter`, `Readout`, `useMakeStep.ts`, `startMake.ts` (the one entry every door calls). `features/cad` `PieceDesign` mounts `MakeRail`.
- **State ownership:** server data lives in TanStack Query. The rail keeps no draft: its step derives from `piece.origin`, `piece.spec` and the design, so assistant edits advance the same rail, undo works, and every write is an audited command or an attributed design change.

## 3. Contract changes

**Entities.**
- `Reference`: `source` += `capturedAt`, `licenseUrl`; + `pieceId | null`, `canvas {x,y,w,z} | null`; `generation` += `seed`, `inputs: [{id, role, title, provider, url, credit, license, rights}]`.
- `SearchResult` += `mayStore`.
- `Piece` += `origin { kind: 'image'|'logo'|'text'|'mesh'|'references'|'piece', sourceAssetIds, referenceIds, flags: [{code, message}], attestation: { rights: 'own'|'licensed'|'permission', likenessConsent, by, at } | null } | null`.
- `MeshJobSchema`: status and progress as `RenderJob`, plus `provider`, `model`, `quality`, `inputAssetIds`, `meshAssetId`, `costUsd`, `actor`.
- `Capabilities` += `embedding`, `vision`, `depth`. Server: `JobKind` += `'mesh3d'`; `ServerEvent` += `board.updated`.

**Nodes and spec.**
- `Pave.region` += `{ type: 'mask', assetId }`: 8-bit grey PNG ≤ 1024 px, white = stones, mapped to the host's XZ bounding box and projected along Y.
- `Relief.outline` += `'custom'` with `outlinePath` (SVG `d`).
- `VectorBody` is unchanged: traces use `source.type: 'svg'`, simplified to ≤ 60k characters.
- `PieceSpec.body` += `outlinePath`, `heightMapAssetId`, `paveMaskAssetId`; `pendant()` maps them and stops overloading `meshAssetId` as the relief map.

**New commands.**

| Command | Kind | Sketch |
|---|---|---|
| `freeform.analyze` | mutation, tool | `{assetId (image or mesh), threshold?, invert?, heightMm?}` → `{maskAssetId, cutoutAssetId, outline:{d, aspect}, heightMapAssetId, depthSource:'model'\|'basic'\|'mesh', colorLayers:[{hex, areaPct, maskAssetId}], suggestedMode, reason, lints:[{code, message, valueMm, limitMm}], flags}` |
| `mesh3d.estimate` | query, tool | → `{provider, model, usd, seconds}` |
| `mesh3d.create` | mutation, `tool:{confirm:true}` | `{pieceId, imageAssetIds (1–4), quality}` → `MeshJob` |
| `mesh3d.get`, `mesh3d.cancel` | query / mutation | → `MeshJob` |
| `pieces.attest` | mutation, **not a tool**, user actors only | `{id, rights, likenessConsent?}` |
| `references.lineage` | query, tool | `{id}` → `{ancestors, descendants, pieces}` |
| `references.similar` | query, tool | `{id?, text?, boardId?, limit}` → `Reference[]` |
| `references.arrange` | mutation | `{boardId, items:[{id, position?, canvas?}]}` |
| `references.capture` | mutation | `{id}`: store pixels for a link; rights stay `viewOnly` |

**Changed commands.**
- `references.search`: input += `openOnly`; output += `unavailable: [{provider, reason}]`.
- `references.save` items += `swatch {hex}`, `pieceId`.
- `references.update` += `canvas`, `boardId`; raising `viewOnly` needs `attestation: true` from a user actor.
- `references.generate` += `roles`, `seed`.
- `pieces.create` and `pieces.update` += `origin` (never the attestation).
- `mesh3d.create`, `production.create` and `design.export` answer 409 when `origin` has sources and no attestation.
- Promote and explore-from-piece add no commands: `pieces.create {brief, origin}`; `boards.create` + `references.save {pieceId}`.

**Services.** `Services` += `mesh3d { estimate; submit(job, files, JobHandle<MeshJobPatch>, sctx); cancel }`, `vision { describe → tags, flags }`, `embedding { embed }`, `depth { estimate }`. Handlers test `isConfigured` and fall back, so `freeform.analyze` never returns 501.

## 4. Hard parts & decisions

1. **One path, not three.** Skeleton from Proposal 2: the flow produces a `PieceSpec` and the existing `pendant()` recipe builds `body`/`ice`/`bail`/`chain` once. Grafted from Proposal 1: after that the rail is a projection of the design and every control is one `design.apply`. Each confirmed choice is saved with `pieces.setSpec`, so the assistant can join mid-way. Rejected: Proposal 1's hand-written ops per step (re-implements the recipe); Proposal 2's local spec draft and separate screens.
2. **Compliance by construction.** No Pinterest or Google scraping and no SERP adapter; a pasted Pinterest URL is a `viewOnly` link tile. Adapters declare `mayStore`; only CC0 and own pixels are copied on save (today `referenceFromItem` copies nothing). On save the server re-resolves the result through its adapter by `key`, because client-echoed `rights` and URLs cannot be trusted; neither proposal covered this. Rights elevation and attestation are human-only: both proposals put the attestation on tool-exposed commands, letting an agent attest. Rejected: Proposal 2's `overrideViewOnly` on `references.generate`.
3. **Lineage that survives deletion.** `generation.inputs` snapshots each parent's credit and rights at generation time; `parentIds`, `reference.pieceId` and `origin.referenceIds` stay the walkable edges. Rejected: Proposal 1's archive-on-remove (board deletion still cascades) and an edge table.
4. **Generated meshes are not castable.** From Proposal 2: Sculpt defaults to high relief (`meshDepth` feeding a `relief` node, watertight and flat-backed by construction). Full round (`meshBody`) is opt-in and judged by kernel diagnostics, falling back to relief. Rejected: a Python repair service; a private Manifold check in `@pave/freeform`.
5. **Where image-to-geometry runs.** Server commands only, so person and agent share one traced path; on desktop that server is local, so Outline and Relief work offline. Both proposals claimed the tracer runs in the browser, but `@visioncortex/vtracer@1.0.0-alpha.4` is a Node-target CommonJS build. Rejected: Proposal 2's `preview.worker.ts`; the slider debounces `freeform.analyze`, cached by content hash and parameters.
6. **Paid, slow jobs and live updates.** Estimate, confirm, `spend.ts` budget check, then a job with usage key `mesh3d:${id}`; the provider's job id is stored so polling resumes after a restart. Both proposals assumed SSE works: the server sends named events (`http/events.ts`) but the studio listens with `onmessage` (`lib/events.ts`) and has no `job`, `piece` or `board` domains. Fix that, and poll `mesh3d.get` as a fallback.

Other corrections:
- Providers are not registered in `runtime.ts` (Proposal 2); nothing registers them today.
- `mod+V` and `/` cannot be registry shortcuts: `lib/commands.ts` fires mod chords inside inputs, and `/` is shifted on many layouts. Use the DOM `paste` event and `F`.
- `packages/production` has no costing; add one `estimateCost(report, rates)` there for the readout and the package.
- Only the `primitive` kernel builder exists; the rail offers only `kernel.kinds`.

## 5. Verification

- `packages/ideation`, `packages/freeform` (vitest, on the three-OS CI matrix): recorded JSON per adapter checks mapping, rights tier, `mayStore` and request snapshots; a fixture logo yields closed contours; height-map tolerance; lint thresholds; a non-manifold GLB falls back to relief.
- Server (`test/harness.ts`, fake services): save ingests only storable pixels and ignores spoofed rights; view-only gate; agent cannot attest; 409 gates; lineage after delete; budget refusal; usage rows and idempotency; SSRF guard; the `fixture` mesh job end to end.
- Playwright is not in CI. Extend `apps/studio/e2e/fixtures.ts` and `shots.ts` with board empty/masonry/canvas, key-less search, the no-key bar, lineage and the four rail steps, in light and dark, plus keyboard-only and reduced-motion runs.
- Cross-platform: TypeScript, WASM and `sharp` only; no Python or shell; `node:path`; add `.gitattributes` marking fixtures binary; `DataTransfer` drops (no Electron `file.path`); remote thumbnails use `referrerPolicy="no-referrer"`.
- Cannot be verified here: live museum APIs (opt-in `PAVE_LIVE=1`); Brave, Gemini, BFL and fal shapes, prices and quality; vision flag accuracy; depth quality; the trophy case through real `relief`/`pave` builders.

## 6. Scope cuts

Pinterest OAuth embeds; browser clipper; SERP adapters; Unsplash/Pexels; pgvector and clustering (brute-force cosine, or tag-and-palette overlap with no key); one reference in several boards; canvas arrows and multiplayer; enamel and two-tone regions; sculpt brushes; text-to-3D and multi-view capture; in-browser depth or segmentation models; quad/SubD hand-off; grillz and championship rings; C2PA re-signing.

## 7. Build order

1. **Contract.** Schema, node, spec and recipe changes; typed handler stubs; studio `QUERY_NAMES` and `DOMAIN_QUERIES`. Verify: typecheck, `schema.test.ts`, `rpc.test.ts`.
2. **Search and capture.** Museum adapters, `providers.ts`, `safe-fetch`, ingest on save, `capture`, the SSE fix. Verify: adapter fixtures, harness.
3. **Boards UI.** Pages, masonry, search sheet, collect, provenance, canvas, `arrange`. Verify: shots, keyboard run.
4. **Generate and lineage.** Roles, snapshot, `spend.ts`, `lineage`, `similar`, promote, explore-from-piece. Verify: harness with fake image generation; shots.
5. **Freeform core.** `packages/freeform`, `parseMesh`, `freeform.analyze`, `origin`, `pieces.attest`, the gates. Verify: vitest fixtures, harness.
6. **Mesh jobs.** `mesh3d.*`, `fixture` and `fal` adapters. Verify: harness, recorded fal responses.
7. **Make rail.** The four steps, readout, `estimateCost`, doors. Verify: shots against fixture evaluations until the kernel's `vectorBody`, `relief`, `pave`, `bail` and `chain` builders land, then the trophy case end to end.
