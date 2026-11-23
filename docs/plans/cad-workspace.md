# The CAD workspace: viewport, outliner, inspector, design session, exports

Build brief: the judged synthesis of two independent design proposals.

## 1. Experience

- **Open.** Outliner, inspector and HUD are live at once from `pieces.get`; the stage shows the cover and "Preparing the workbench…" while WASM boots. Edits made meanwhile queue.
- **Empty** (`design.order.length === 0`): four doors, all keyless.
  - *Template*: `TEMPLATES` by family → `pieces.setSpec` + `pieces.buildFromSpec`.
  - *Describe it*: `assistant.open({ prompt, context: { pieceId } })`; with `capabilities.assistant` false, a three-question Quick start (kind, stone, metal) builds a `PieceSpec` and runs the same two commands.
  - *Bring something in* (drop, paste, browse): mesh → `uploadAsset` → `meshBody{source:{type:'asset',assetId}}`; SVG → `vectorBody{source:{type:'svg',d}}`; typed name → `{type:'text'}`; built-ins (`trophy`…) need no upload.
  - *From an image*: `relief{assetId}`; image-to-3D only when `capabilities.mesh3d.length`.
- **Next steps.** Chips surface the top add-menu suggestions ("Ice it out" → `pave`, "Add a bail", "Hang on a chain"): built-in trophy → iced pendant in four clicks.
- **Edit.** Click selects a feature, named by schema title ("Ring band", never `ringShank`); a second click on a stone shows that instance's mm·ct, read-only. Inspector shows essentials; "Fine-tune" reveals `advanced` fields. Scrubbing previews live; release writes one history entry ("Width at top 2.2 → 2.6 mm"). Dimension chips on the model (ring size, stone mm·ct, height) are the same field control.
- **HUD.** `≈ 4.2 g 18k yellow · 1.52 ct · 37 stones`. "Ready to cast ✓" only after a production-detail check of the current version; otherwise "2 things to check", each with **Show me** (select + frame `Diagnostic.at`) and **Fix it** when the kernel supplies ops.
- **Assistant edits** land live: one `--ai-*` sweep (static `AiMark` under reduced motion), a chip "✦ Assistant · Added halo, slimmed band — Undo · Review", a spark dot on each changed field showing the prior value.
- **Export.** Menu labelled by purpose ("For casting — STL", "For another CAD — STEP"), built from `kernel.formats`, run in the production worker, showing `ExportResult.notes`; server `design.export` is the fallback.
- **Failure.** Failed feature: last-good geometry ghosted with a badge. Save pill "Saved / Saving… / Offline — 3 edits kept" plus a `beforeunload` guard. Worker crash: one respawn, then a "Restart geometry engine" command. Software GL: clay mode with a "Simplified graphics" chip. No WebGL2 or kernel: edit by numbers. Viewer role: orbit, inspect, export.
- **Input.** Mouse: drag orbits, right/Shift-drag pans, wheel zooms to cursor. Trackpad: two-finger orbit, pinch zoom. Touch/pen: one-finger orbit, two-finger pan/pinch, long-press menu; panels become `Sheet`s under 900 px. Keyboard: `F6` cycles regions, arrows orbit, `F` fit, `1–4` views, `Shift+1–3` display, `X` x-ray, `W`/`E` gizmo; a live region announces selection.

## 2. Structure

Skeleton: Proposal 2 (shared session, kernel, stage); Proposal 1's novice layer grafted on.

Shared under `apps/studio/src` (Render, Sourcing and Production need the same design and `Evaluation`):
- `lib/design-session/core.ts` — pure state machine `{confirmed, version, pending[], inbox, gesture, undo[], redo[], runs}`.
- `lib/design-session/store.ts` — ref-counted zustand store per piece: outbox, SSE ingest, write-through to `rpcKey('pieces.get')`.
- `lib/kernel/client.ts` — draft worker plus lazy production/export worker over `createKernelClient()`; `AssetResolver` = `fetch(assetUrl(id))`; watchdog; dev-only `?kernel=fixture`.
- `lib/kernel/scheduler.ts` — latest-wins queue, EWMA timings from `Evaluation.timings`.
- `stage/` — `Stage.tsx` (R3F `<Canvas frameloop="demand">`, content under `zUpGroup`), `EvaluationScene.tsx` (the only caller of `@pave/render/three`), `controls.ts`, `quality.ts` (GPU tier, gem policy, context loss), `capture.ts`.
- `lib/save-file.ts` — `showSaveFilePicker`, anchor fallback, Windows-safe names.

`features/cad/`:
- `index.tsx` (`PieceDesign`), `commands.ts` (every action via `useRegisterCommands`), `state/workspace.ts` (selection, hover, view-hidden ids, display mode, section, input mode, ring-system preference).
- `viewport/{picking.ts, Highlight.tsx, Gizmo.tsx, Dimensions.tsx, Section.tsx}` — the gizmo emits `update {transform}` through the session gesture.
- `outliner/{tree.ts, Outliner.tsx, AddMenu.tsx}` — ARIA tree nested under the first `nodeRefs` host; rename, `move`, diagnostic badges, context menu. The add menu offers `kernel.kinds` only, disables unsatisfiable refs with a reason, and feeds the chips.
- `inspector/{Inspector.tsx, FieldControl.tsx, widgets/*}` — `FieldControl` is the only widget switch.
- `hud/{Hud.tsx, Checks.tsx, ChangeChips.tsx, Timings.tsx}`, `export.ts`, `cover.ts`, `capture-tool.ts`, `empty/{EmptyDesign.tsx, QuickStart.tsx, importers.ts}`.

Add: `three@0.187.0`, `@react-three/fiber@9`, `camera-controls`, `@pave/render`, `@pave/kernel`. No drei, no postprocessing.

Repo facts that correct the proposals:
- Upload exists (`apps/server/src/http/assets.ts`, `lib/assets.ts#uploadAsset`); Proposal 1 was wrong.
- `lib/events.ts` uses `onmessage` but the server sends named events, so nothing arrives today (Proposal 2 is right); `piece.updated`/`job.updated` also match no `DOMAIN_QUERIES` key. Rewrite as typed `onServerEvent`; stop invalidating `pieces.get` while a session is live.
- `lib/commands.ts`: match `Digit*` by `e.code`; add `when?: () => boolean` (focus-scoped `Delete`), `inEditable` (`mod+z` leaves text undo alone), a `'Design'` group.
- The kernel already aborts between nodes (`createBreather`) and returns `feature.failed` instead of rejecting: Proposal 1's "cannot abort" and Proposal 2's request are moot.
- `@pave/render/three/index.ts` and `createKernelClient` do not exist yet; the kernel registers only `primitive` and GLB. Hence one adapter file and a fixture kernel.
- `PieceHistory.tsx#describe` duplicates op labelling; replace with the schema's.

## 3. Contract changes

- `design/fields.ts`: `widget` gains `'ringSize'|'stoneSize'|'metal'|'finish'|'plating'|'stone'|'cut'`; add `advanced?: boolean`, `snap?: 'melee'`, `labels?: Record<string,string>`. Tag in `nodes.ts`: shared `metal`/`stone` fragments, `RingSizeSchema`, `Gem.width`, `stoneWidth`, `Pave.sizeMin/Max`; `advanced` on `prongSpin`, `taper`, `seed`, `gap`, `margin`, `drop`, `smooth`, `detail`, `plating`, `transform`.
- New `design/describe.ts` (pure): `describeNode(kind)`, `visibleFields`, `variantPatch`, `defaultNode(kind, design, hint)`, `squashOps`, `labelForOps`, `describeOps`.
- New `api/events.ts`: `ServerEventSchema`, moved from `apps/server/src/events.ts`.
- New `api/client-tools.ts` (same `def` shape, executed in the studio; the relay belongs to the assistant workstream):
  - `viewport.capture`: `{pieceId, views: (CameraPreset|{azimuth,elevation})[1..6], mode: 'rendered'|'clay'|'technical' = 'clay', size: 512|768|1024 = 768, focusNodeIds?, annotate?}` → `{version, images: {view, assetId}[], summary: EvaluationSummary}`.
  - `viewport.select {pieceId, nodeIds}`.
- `design.revert`: `{pieceId, seq}` or `{pieceId, runId}` (whole run, one change). `StoredChangeSchema.reverts?: string[]`, set by revert and by `design.apply {reverts?}`.
- `PieceSummary.coverAuto: boolean`; `pieces.update {coverAuto?}`.
- `kernel/types.ts`: `Part.rev: string` (node-result hash); `Kernel.formats: readonly ExportFormat[]`; `Diagnostic.fix?: {label, ops: Op[]}`. `createKernelClient()` posts only parts whose `rev` the main thread lacks (transferred) and exposes `terminate()`.
- Server: `reverts` column, revert-by-run, `coverAuto`. Service interfaces: none.

## 4. Hard parts & decisions

1. **Sync under concurrent agent edits.** `design.apply` with `changeId`, no `baseVersion`, one in flight. Acks and SSE `design.changed` feed one seq-keyed inbox deduped by change id; pending changes and the live gesture re-apply over the new `confirmed`; one that throws `OpError` is dropped with a toast. On a gap or any EventSource reconnect, call the existing `design.history {limit: 200}` and take `seq > version`; beyond that, `pieces.get`. *Rejected:* `baseVersion` (409 livelock against a fast agent); Proposal 2's new `after` parameter (unneeded); Proposal 1's resync-only path (cannot tell which pending changes are already included).
2. **One gesture, one Change; undo that never clobbers.** `begin/preview/commit` yields one `squashOps`'d change labelled by `labelForOps`, mapping onto `NumberField`/`Slider` `onChange`/`onCommit`. Undo applies the server-acked inverse as a new change with `reverts`, filtered to leaves that still equal what that change wrote, so later assistant edits survive. The chip's Undo is `design.revert {runId}` (Proposal 2), not a client-assembled inverse (Proposal 1): exact even when this tab missed part of the run, shared with History and MCP. *Rejected:* global linear undo; Apply/Reject staging (needs branches, stalls runs).
3. **Evaluation budget, honest numbers.** Depth-1 latest-wins queue with abort between nodes; `Part.rev` skips the worker copy and the GPU upload. Fields whose dependency closure averages over 150 ms evaluate on release; rigid gizmo drags on leaf nodes move three objects and evaluate on release. Production detail and exports use the second worker (terminated after 60 s idle). Draft facts carry "≈" (seats uncut); only a production check, run 2 s after idle, may say "Ready to cast". Targets: p95 under 120 ms slider-to-pixels on templates, under 400 ms draft at 5k pavé, zero idle frames. *Rejected:* one worker.
4. **Thousands of stones, picking, highlight.** One `InstancedMesh` per `meshKey`. `quality.ts`: BVH gem shader always for centre/side stones, for melee only under a tier-dependent count (else cheap env-mapped facets); 2 bounces in motion, refined after 150 ms idle; DPR in [1, 2]. Picking is a CPU raycast through `three-mesh-bvh` (already a dependency), rAF-throttled, paused during camera motion (Proposal 1). *Rejected:* Proposal 2's GPU id pass: redraws every instance per hover, stalls software GL on `readPixels`, untestable without GL. Highlight redraws selected instances in a flat `--select` overlay plus `Part.edges` as `LineSegments2`; no outline pass.
5. **Generated inspector, true semantics.** No per-kind files. Unions render as a segmented control plus the active variant; `variantPatch` nulls the old variant's keys. Carat is never stored: `gemDimsFromCarat` writes `width`; melee fields use `snapToMelee`. Ring size: the system switch changes only the entry/display preference; the node is rewritten only when the user picks a value, with Δ mm shown (Proposal 1's switch, Proposal 2's warning that `ringSizeFromDiameter` rounds). Both proposals bound the eye to `visible`, but hidden nodes leave `activeResults` and change weight and exports: the eye is a view-only hide; "Exclude from piece" is `update {visible: false}`. Deleting a node with dependents lists them, then sends `cascade: true`.
6. **Cross-platform viewport, input, capture.**
   - `camera-controls` (Proposal 2) over OrbitControls (Proposal 1): imperative rotate/truck/dolly for keyboard and trackpad; framing from `CAMERA_PRESETS`/`framePoints`/`cameraPose` so CAD, capture and Render agree.
   - Pointer Events; non-passive wheel classifier (mouse vs trackpad, ctrl-wheel = pinch) with an Auto/Mouse/Trackpad setting; Safari `gesture*` fallback; menus on `contextmenu`; middle-click paste suppressed. No `Alt+digit` shortcuts (Alt opens menus on Windows/Linux, ⌥ types symbols on macOS). Imports classified by extension, not MIME.
   - GPU tier from `failIfMajorPerformanceCaveat` plus renderer string (SwiftShader, llvmpipe, Basic Render) → clay, DPR 1, no contact shadow, opaque panels. `compileAsync` (D3D); context-loss restore; no SharedArrayBuffer.
   - One `capture.ts`: wait for session idle and evaluation, render into the live canvas at target size within one task (keeps tone mapping), `drawImage`, restore. Cover: on tab leave when the version changed, designer role, non-software tier, only while `coverAuto`. Proposal 1's 3 s cadence would spam audit rows and `updatedAt`.

## 5. Verification

- **Vitest, pure** (root config only picks up `*.test.ts`): `core.ts` seeded property test against a fake server running real `applyOps` (convergence, idempotent retry, guarded undo, gap recovery, one change per scrub); `describe.ts` over all `NODE_KINDS` (every titled field has a widget, every `when` key exists, `variantPatch`/`defaultNode` pass `NodeSchema`); scheduler with a delayed fake kernel; picking on fixture Evaluations; importers, wheel classifier, filename sanitiser.
- **Server tests** on the existing harness: revert-by-run, `reverts`, `coverAuto`.
- **Playwright**, extending `apps/studio/e2e/shots.ts` and `fixtures.ts` (stateful `design.apply`); `?kernel=fixture` serves `packages/render/fixtures` plus a generated 5,000-stone pavé; SSE by holding `/api/events` and fulfilling it with an agent `design.changed`. Screenshots: three display modes, section, empty, Quick start, AI chip; light/dark; 1440 and 390 px touch; reduced motion. Flows: keyboard-only add → edit → undo; chip Undo calls `design.revert {runId}`; GLB download starts with `glTF`; `viewport.capture` round trip; draw calls and zero idle frames at 5k stones.
- **CI:** add a Chromium e2e job to the three-OS matrix in `.github/workflows/ci.yml`.
- **Cannot be verified here:** real-GPU gem look and frame times, D3D shader compile, physical trackpad/touch/pen, Electron save dialogs, live assistant relay, image-to-3D, and non-GLB exports until those exporters land.
- Checked while planning (read-only probe run from a scratch file outside the repo): `z.toJSONSchema` on `NODE_SCHEMAS` carries `title/unit/step/group/when/refKinds/widget`; unions arrive as `oneOf`.

## 6. Scope cuts

Sketch and path-point editing; face/edge selection and painted pavé regions; per-stone pavé edits; kernel-emitted dimensions and drag handles; multi-select transforms and snapping; measure tool; section caps on stones; stone LOD impostors; presence and branches; expressions in number fields; IndexedDB persistence of pending edits; headless server-side capture; audit records for client-side exports; WebGPU viewport; phone-first layout.

## 7. Build order

1. **Contracts and plumbing.** Section 3 plus the `lib/events.ts` and `lib/commands.ts` fixes. Proven by schema and server tests.
2. **Design session.** `core.ts`, `store.ts`; `PieceHistory` on `describeOps`. Proven by the property tests.
3. **Kernel client and scheduler** with the fixture kernel. Proven by scheduler tests.
4. **Edit by numbers.** Outliner, add menu, generated inspector, HUD, checks, commands: a complete workspace with no canvas, which is also the no-WebGL fallback. Proven by the keyboard-only flow.
5. **Stage.** Canvas, `EvaluationScene`, controls, display modes, quality tiers, picking, highlight. Proven by the screenshot matrix.
6. **Direct manipulation.** Gizmo, dimension chips, section/x-ray, contact shadow, view-only hide.
7. **Assistant affordances.** Change chips, spark dots, run undo, `viewport.select`. Proven by the SSE flow.
8. **Empty state.** Templates, Quick start, importers, chips. Proven by trophy → iced pendant on the fixture kernel.
9. **Leaving the workspace.** Export menu, capture, cover, `viewport.capture`; performance pass at 5k stones; e2e on all three operating systems.
