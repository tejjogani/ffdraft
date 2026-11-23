# Render studio, brand models and on-model imagery

Build brief: the judged synthesis of two independent design proposals.

## 1. Experience

**Render tab** (`PieceRender`, full-bleed): shot list left, viewport on `.stage`, glass inspector right, takes filmstrip and a "Direct it…" composer below.

1. **Never empty, no write on read.** With no saved scenes the list shows the org's house shots, else `DEFAULT_SHOTS(kind)` (Hero, Front, Top, Macro, Turntable; no Top for flat pieces). The first edit or render saves them (`scenes.create`). While the kernel evaluates, the stage shows the piece cover.
2. **Adjust in plain words**: Look cards, Angle, Lens, Background blur, Light direction, Sparkle, Backdrop, Motion, Size. Drags update locally and send one `scenes.update` on release. A frame-safe overlay shows the crop and predicted fill ("62% · good"). Orbiting (mouse or arrow keys) sets `camera.preset: 'custom'`.
3. **Words.** The composer calls `assistant.open({ prompt, context: { pieceId, sceneId } })`. The assistant edits the same row, so the viewport changes before render time is spent; a diff chip offers Undo. Hidden when `capabilities.assistant` is false.
4. **Render.** `mod+enter` renders the selected shot, `mod+shift+enter` all. "Render in…" (metals, stones) shows the matrix first ("5 shots × 3 metals = 15"), then queues `renders.create` calls sharing a `groupId`.
5. **Progress.** The tile shows a ring, ETA and Cancel. Numeric auto-tune gets a plain chip, "Auto-adjusted: light −20%, reframed · 2 drafts", with draft thumbnails, "Keep on shot" and "Render exactly as set". The AI shimmer appears only when the assistant re-rendered ("Assistant re-rendered: warmer key").
6. **Review.** `job.stale` shows "Design changed · Re-render", plus a "Re-render all stale" command. Compare (`c`) is a wipe slider or 2-up. Star, Set as cover (`pieces.update`), Download, Copy link, "Review with assistant".
7. **No Blender.** The button reads "Render (browser)", takes are tagged "Preview quality", animations play live but cannot be exported (reason shown). One quiet banner opens `EngineDialog`: status, reason, path/version/device, a path field, download link, Re-check. Failed takes show the last log lines and Retry.

`/renders`: a virtualised grid of takes across pieces (filters: piece, stale, starred, animation, engine), same actions.

**Models.** New model → card form with mandatory synthetic attestation → generate face (cost confirm) → keep or regenerate → remaining views conditioned on the kept face → Approve (freezes the set, records the approver, bumps `version`).

**On model tab.** Model, placement (defaulted from piece kind), direction, count → `shots.estimate` → confirm → `shots.create`. The tile walks "Rendering references → Generating → Checking against CAD (2/3)". Results always carry "AI · Concept" and the findings. Failures are dimmed, "Didn't match the design — not exportable", with reasons and Retry. With no key, cards stay editable, the free CAD reference views still show, and Generate is disabled, naming the missing key (image or vision).

## 2. Structure

The pipeline proposal (P2) is the skeleton; the art-director proposal (P1) supplies the grafts noted below.

**Corrections to both proposals (checked against the tree)**
- `apps/studio/src/lib/events.ts` already listens per named event and maps `kind` to a domain (uncommitted). The remaining gap: events carry no status or progress, so every tick refetches `renders.list` and `pieces.list`.
- `BLENDER_PATH` appears nowhere. `IntegrationsSettings` tells every unset capability to "add its API key", which is wrong for Blender.
- `resolveRuntime` order is options → `PAVE_PYTHON` → `PAVE_BLENDER` → venv; P1 dropped `PAVE_PYTHON`.
- `RenderSceneSchema` has no field metadata, so a generated inspector needs `.meta()` first.
- `createKernelClient` is not in the tree yet. `monthlyBudgetUsd` is stored but never enforced. `PieceSummary` has no `version`, so the gallery cannot compute staleness client-side. `CommandGroup` has no Render or Models group. Studio does not yet depend on three, `@pave/render` or `@pave/kernel`.
- Confirmed: `renders.create` hardcodes `engine: 'blender'` and nothing ever completes the job; `updateRender` is unconditional, so a late `done` overwrites `canceled`; `WORKER_DIR` is source-relative; bpy 5.3.0 is installed in `workers/render/.venv`.

**`packages/render`**
- `src/shots.ts`: `DEFAULT_SHOTS(kind)` and `REFERENCE_SCENES` (4–6 catalog-white views for on-model).
- `src/preflight.ts`: `predictFraming(resolved, subject)` → predicted `subjectBox`. Drives the overlay and fixes framing without a draft (P1).
- `src/critique.ts`: `runCritique(renderDraft, scene)`. Pure; at most 3 preview drafts; accepts only improvements (P2).
- `src/node/discover.ts`: per-OS candidates after the `resolveRuntime` order. `node/index.ts` gains tree-kill and `PAVE_RENDER_WORKER_DIR`.
- `src/three/still.ts`: progressive still from a `ResolvedScene` on the existing renderer (a render target, not a second GL context).
- `workers/render/pave_worker/metrics.py` stays the only metrics implementation.

**`apps/server/src`**
- `services/render-queue.ts`: `createRenderQueue({ concurrency, runner, runtime })`.
- `services/on-model.ts`: stages `references → generate → verify → label`.
- `services/index.ts`: composes defaults for `main.ts`. The queue is always registered; `capabilities.blender` comes from `detectBlender`.
- `providers/image/{gemini,bfl,fake}.ts`: one `ImageProvider` family (research 04's `ImageGenProvider` shape) shared with `imageGen`. The ideate workstream must not write a second client.
- `providers/vision/{anthropic,fake}.ts`: built on the assistant's model client in `packages/agent`, metered to `llm`.
- `imaging/disclosure.ts`: visible label from pre-outlined SVG paths (no system fonts) plus XMP `DigitalSourceType`, via sharp.
- `usage.ts`: a shared `assertBudget(ctx)` before paid calls.

**`apps/studio/src/features/render`**: `RenderStudio.tsx`, `Viewport.tsx`, `ShotList.tsx`, `SceneInspector.tsx`, `TakeStrip.tsx`, `TakeCard.tsx`, `CritiqueNote.tsx`, `Compare.tsx`, `VariantsPopover.tsx`, `EngineDialog.tsx`, `Gallery.tsx`, `useBrowserRenderer.ts`, `commands.ts`, `store.ts` (selection, compare pair, playhead, inverse-patch undo stack).

**`features/models`**: `ModelCardForm.tsx`, `PortraitSet.tsx`, `ShotComposer.tsx`, `ShotCard.tsx`, `FidelityReport.tsx`, `commands.ts`.

**State and reuse.** Scenes, jobs, models and shots are server state in TanStack Query; resolved scenes are derived. The Evaluation comes from one shared `usePieceEvaluation(pieceId)` with the CAD tab. `SceneInspector` uses the CAD workstream's schema-driven field renderer, with custom widgets only for look cards and angle.

## 3. Contract changes

**`entities.ts`**
- `RenderSceneSchema`: add `.meta({ title, group, unit, widget })` (the `FieldMeta` shape from `design/fields.ts`). Overrides key `'*'` means the whole piece (`resolveMaterials` merges `'*'` under the node key).
- `SavedSceneSchema { id, pieceId: id | null, title, scene, position, updatedAt }`; null `pieceId` is a house shot.
- `RenderJob` adds `sceneId`, `groupId`, `variantLabel`, `purpose: 'take' | 'reference'`, `requestedScene`, `critique: { passes: [{ adjustments, issues, draftAssetId }] } | null`, `retryOf`, `note`, `seconds`, `device`, `starred`, `stale` (server-computed).
- `SceneAdjustmentSchema` and `RenderIssueSchema` move here; `assess.ts` imports the types.
- `BrandModel`: `card.ageRange` becomes an adults-only enum; `card` adds `monkTone` (1–10), `undertone`, `eyes`, `marks`, `handLengthMm`; model adds `version`, `recipe { provider, model, seed } | null`, `approvedBy`, `approvedAt`.
- `ModelShot` adds `sourceVersion`, `modelVersion`, `stale`, `stage`, `attempts`, `error`, `actor`, `check.findings: [{ code, ok, expected?, seen? }]`, `provenance { provider, model, seed, prompt, referenceRenderIds, portraitAssetIds, disclosure }`.
- `Capabilities` adds `onModel: string[]`, `vision`, `c2pa`. `Thread.context` adds `sceneId`.

**`commands.ts`**
- `scenes.list { pieceId: id | null }`, `scenes.create`, `scenes.update { id, patch }` (merge patch, re-validated), all three `tool`; `scenes.delete`.
- `renders.create` adds `sceneId?`, `groupId?`, `variantLabel?`, `engine: 'auto' | 'blender' | 'browser'`, `autoTune = true`, `retryOf?`, `note?`, `purpose?`.
- `renders.list` adds `purpose = 'take'` and `before`.
- `renders.complete { id, assetIds }`: browser jobs only, same user, first write wins.
- `renders.update { id, starred?, title? }`, `renders.delete`.
- `renders.engine` (query: availability, version, device, reason, path).
- `renders.configureEngine { blenderPath | null }`: owner, local mode only, probed before saving to `<dataDir>/engine.json`.
- `shots.create` adds `count` (1–4) and `aspect`; new `shots.estimate` (query, `tool`), `shots.get`, `shots.cancel`, `shots.delete`, and `shots.export { id, label = true } → Asset`, which refuses unless `check.passed`.

**Server**
- `GeometryService.renderInput(design, sctx) → { glb: FileData, subject: SceneSubject }`.
- `ServiceContext` gains `invoke(name, input)` (same actor, same pipeline) and `jobSettled(kind, id, signal)`.
- `ServerEvent` `job.updated` adds `status` and `progress`.
- DB: a `render_scene` table and the columns above, plus `created_by` and `cache_key` on jobs, as a new drizzle migration.

## 4. Hard parts & decisions

1. **One scene row for people and the assistant.** Named `scenes.*` (P1): `renderShots` collides with the existing on-model `shots.*`. No seeding on open (both proposals wrote on a read; viewers cannot). No `renders.createBatch` (P1): variants are N `renders.create` calls. Every patch lands in the audit log with its actor. `retryOf` with `autoTune: false`, and stars, are the feedback signals for traces.
2. **Critique split.** Numeric lives in the queue (P2): deterministic and key-free. Vision is the assistant's job inside a traced, metered run, linked by `retryOf` and `note`. Both proposals put a vision critic in the queue; that spends money silently on every render and duplicates the assistant. A TypeScript `measure.ts` (P2) is rejected: it duplicates or rewrites `metrics.py`. Browser stills get the framing pre-flight only.
3. **Fallback engine.** `engine: 'auto'` resolves from `detectBlender`. Browser jobs are rendered by `useBrowserRenderer` under a Web Lock (one tab), uploaded through `/api/assets`, then `renders.complete`; unclaimed jobs fail after 10 minutes. On-model references use the same path. Rejected: headless GL on the server.
4. **Queue correctness, cross-platform.**
   - Concurrency 1 (`PAVE_RENDER_CONCURRENCY`), per-org round-robin, tier timeouts, progress at 1 Hz.
   - Terminal states are sticky (conditional update).
   - Cancel kills the tree: `taskkill /T /F` on Windows, a detached process group elsewhere; all jobs abort on shutdown.
   - Boot recovery re-queues through `runtime.context({ userId: createdBy, orgId, actor })`.
   - Cache key is sha256(pieceId, sourceVersion, requested scene, engine, runner version). P2's GLB hash would force an export just to test the cache.
   - Discovery is a PATH scan in Node (with `PATHEXT`) and install tables; only 5.3.x is accepted. No shell; `os.tmpdir()`; video only from bpy's built-in encoder.
   - Usage: `render`, `second`, key `render:<jobId>:<pass>`.
5. **On-model, fail closed.** `onModel` registers only when both image and vision providers exist. References are `purpose: 'reference'` jobs at the current version, created through `sctx.invoke` and reused across shots. Expected facts come from `design.evaluate`. Hero stones are counted exactly; melee is judged as coverage, because no judge can count an iced-out pavé field. Hand shots send hand references only (P1). Three attempts, cost-capped. The v2 seam is the stage list, not shipped `lock`/`ssim` code (P2's would be dead code).
6. **Guardrails that work.** Adults-only cards, text-only identity, attestation and a recorded approver. When vision exists, card and direction text are screened for real names. P1's image likeness gate is rejected: a vision model will not identify faces, so "passed" would be false assurance. Exports are labelled copies; originals stay untouched so provider C2PA and SynthID survive. A C2PA signer is an optional dynamic dependency behind `capabilities.c2pa`.

## 5. Verification

- **Vitest**
  - Scene patch and `'*'` goldens; `predictFraming` against fixture evaluations; `runCritique` with scripted metrics.
  - `discover.ts` with injected env and fs for win32, darwin and linux.
  - Queue with a fake runner (a Node script via `process.execPath`, with hang and crash modes): ordering, fairness, cancel race, timeout, recovery, idempotent metering, cache hit.
  - On-model with `FakeImage` and scripted `FakeVision`: pass, fail-then-pass, fail closed, stale reference, export refusal. Request-builder snapshots; `disclosure` read back.
- **Server harness** (`test/harness.ts`): `scenes.*`, `renders.*`, `shots.*`, 501 paths, roles, `configureEngine` refused outside local mode.
- **Real Blender here**: one CPU 768² fixture ring through the queue, gated on the venv; assert the metrics pass and the predicted and measured boxes agree within 2%.
- **Screenshots** (`apps/studio/e2e/shots.ts`, fixtures extended): default shots, inspector, overlay, progress, both critique notes, stale, compare, variants, engine dialog, gallery, model approval, shot stages, failed shot, every no-key state; light and dark; keyboard-only and reduced-motion passes. With `LIVE=1`: a browser take completes end to end.
- **CI on three OSes**: tree-kill and discovery.
- **Not verifiable without keys**: generation quality, identity consistency, judge accuracy, C2PA signing, GPU device choice, prices.

## 6. Scope cuts

- Composite (v2) shots, body proxies, pixel lock, drape.
- LoRA, real-person references, extra portrait views, on-model video.
- Browser animation export and browser exposure critique.
- Zip export, public share links.
- One-click Blender install, remote render farm.
- Custom lights, HDRI upload, EXR.
- Scene version history.
- Four-candidate face picking.
- Per-platform ad-label presets.

## 7. Build order

1. **Contracts and server basics**: schema, migration, `scenes.*`, sticky terminal states, event payloads, `stale`. Harness tests.
2. **Viewport**: shared evaluation hook, `Viewport`, `ShotList`, `SceneInspector`, overlay, commands. Screenshots.
3. **Browser engine**: `still.ts`, `engine: 'auto'`, `renders.complete`, takes, stale, compare, gallery. `LIVE=1` run.
4. **Queue**: discovery, tree-kill, runner, `runCritique`, metering, cache, recovery, `EngineDialog`. Fake-runner and real-bpy tests.
5. **Direction and variants**: `'*'` overrides, `groupId`, assistant context, `retryOf` and `note`.
6. **Providers and models**: image and vision adapters with fakes, `assertBudget`, card, portraits, approval.
7. **On-model**: pipeline, findings, `shots.export` with disclosure, no-key states.
