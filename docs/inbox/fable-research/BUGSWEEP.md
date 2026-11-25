# Bug sweep of the integration branch: findings and branches

_Asked for by the founder on 25 November 2026: "spawn an agent team look for bugs, obvious misses, missing tests and paths and update on your work tree and raise PRs". He chose the integration branch as the target. Four areas, one branch each, all based on `claude/busy-bardeen-o482lo` at `cb7dcd0`. Each defect was reproduced with a failing test before its fix. The nine majors lane A carries into A4 were left alone._

Each branch is meant to become one pull request into `claude/busy-bardeen-o482lo`. Lane A decides what to merge.

## 0. State on 25 November, 11:50 Pacific: pushed, merged with the integration head, pull requests open

| Pull request | Branch | Checked after merging the integration head |
|---|---|---|
| [#1](https://github.com/tejjogani/ffdraft/pull/1) | `claude/bugsweep-macos-build` (new: the studio did not build on a Mac) | Studio type check and build; its new test |
| [#2](https://github.com/tejjogani/ffdraft/pull/2) | `claude/bugsweep-server` | Server type check; 352 server tests outside the engines |
| [#3](https://github.com/tejjogani/ffdraft/pull/3) | `claude/bugsweep-packages` | Production type check; 139 tests |
| [#4](https://github.com/tejjogani/ffdraft/pull/4) | `claude/bugsweep-kernel` | Kernel and schema type checks; 248 tests |
| [#5](https://github.com/tejjogani/ffdraft/pull/5) | `claude/bugsweep-studio` | Studio type check and build; 309 studio and UI tests |

The sections below describe each branch as it was first written, against `cb7dcd0`. Three things changed when the integration head (with the assistant build) was merged in:

- **Server, findings 2 and 8.** The integration branch has its own guard for a server without sign-in (`http/local-guard.ts`). The branch's two guards were removed in its favour. What the branch adds to that guard: `PAVE_ALLOWED_HOSTS`, the one address in `HOST`, `.localhost` names, and treating a page under one of the server's own names as its own site whatever the scheme or port.
- **Packages, the stone-price fix.** The cost estimate was refactored so a quick estimate shares the formula. The production package now works out each node's stones and hands them to the shared formula.
- **Studio, the export fix.** The integration branch has the server make Rhino and STEP files; the checked download now protects that path too.

The pull request descriptions on GitHub are the current ones; section 6 below is the earlier draft.

## 1. Packages and the install path: `claude/bugsweep-packages` (7 commits, done)

Checks run: `packages/production` 57 tests passed; `packages/render` and `packages/sourcing` 36 passed, 2 skipped (no Blender on the machine); `pnpm -s typecheck` clean; the formatter clean on the changed production, render and installer files. Eleven tests added.

| Severity | Where | What was wrong | Commit |
|---|---|---|---|
| Major | `packages/production/src/cost.ts` (also `context.ts`, `bom.ts`) | A supplier price was taken once per stone lot from the first node found. A pavé parcel in two size lots priced at 1,000 was charged 2,000. Two side stones bought at 400 and 450 that share a lot were costed 800, and `stones.csv` listed only the first SKU and certificate. | `92c5556` |
| Major, security | `packages/production/src/csv.ts` | Text starting with a minus sign and a digit was exempt from formula neutralising, so `-2+3+cmd\|...` went into `bom.csv` and `stones.csv` unescaped. Only a plain negative number is exempt now. | `c8d4ecf` |
| Major | `packages/production/src/render/svg.ts` | Control characters in a piece title were written into every drawing SVG, which then does not parse. | `ca97371` |
| Minor | `packages/render/src/node/index.ts` | A stdout line that looks like progress but is not valid JSON threw inside the stream handler: an uncaught exception in the host process. | `bad67f3` |
| Minor | `packages/production/src/cost.ts` | Brass ignored the user's base-metal rate and used the placeholder. | `8c9a918` |
| Minor | `packages/sourcing/src/requirements.ts` | A stale quality note won over the material: a lab-grown diamond could get a marketplace link filtered to natural stones. | `42ff8fe` |
| Minor | `scripts/install.mjs`, `README.md` | The installer said the Blender renderer was installed after a download that died half-way. README step numbers disagreed with the script. Checked by hand; no automated test. | `8617924` |

Kept on purpose and pinned by a test: a stone in a lot with no price of its own (a mirrored copy) is still estimated at the price of the stones it matches.

### Not fixed: needs a decision

1. **Currency mixing** in `cost.ts`: prices named in USD (`priceUsd`, `metalPricePerGramUsd`, `laborUsd`, `settingPerStoneUsd`) are added into totals labelled with `rates.currency`, with no conversion. Any currency other than USD gives a mixed estimate.
2. **A price on a patterned gem**: a mirrored priced gem is costed twice, a polar pattern of the same gem once. What a price on a patterned gem means is a product call.
3. **Empty design**: a production package builds for a design with no parts. Reject, or allow?
4. A newline in a title breaks the RFQ subject line in `rfq-email.md`.
5. The spec sheet's part table mixes per-body volume with group net weight; ambiguous for chains.
6. Inches print with a trailing "mm" (`0.650 [16.51] mm`) in `rfq.ts` and `spec-sheet.ts`.
7. `package.json` asks for Node 22.3 or later; the installer and the README say 22.
8. `install.ps1` uses `Set-Location -Path`, which treats `[` and `]` in a folder name as wildcards.
9. `workers/render/setup.mjs`: `--wheel-dir` with no value is silently ignored and the 1 GB download goes ahead.
10. The production test fixture groups stones per node; the kernel groups by size across nodes. That is why the merged-lot bug had no failing test.
11. `packages/sourcing/src` fails the formatter before this branch, so `pnpm lint` is red there.
12. Read, not chased: `renderWithBlender` with a timeout above 2^31−1 ms would fire at once; canon `evalExpr` division by zero gives NaN and `whenHolds` treats NaN as true; `StoneRequirement.ref` is not unique for lots that differ only by length, setting, role or material; the matched-set marketplace link passes only the width for fancy shapes.

Not reached: DFM check thresholds, drawing dimensions, render looks and cameras, the other Blender worker modules, the heavy match and canon suites.

## 2. Server: `claude/bugsweep-server` (9 commits, done)

Checks run: 13 server test files pass (two runs: 68 passed and 40 passed, each with 1 expected failure, which was finding 8 below); after finding 8 was fixed, 11 server test files were re-run (96 tests, all passing, no expected failure) and `pnpm --filter @pave/server typecheck` is clean; `pnpm -s typecheck` exits 0 at the earlier head; the formatter clean on changed files; `drizzle-kit generate` against a scratch copy reports no schema drift. Eleven tests added. **Not run:** the engine suites that need the kernel or Blender; engine code is unchanged. Note: the server runs on Postgres (embedded PGlite or `pg`), not SQLite.

| # | Severity | Where (under `apps/server/src`) | What was wrong | Commit |
|---|---|---|---|---|
| 1 | Major | `http/assets.ts`, `http/events.ts` | A guest can run no command, but both routes checked only membership. A guest could download any organisation file by id and receive every live event, including the full ops of each CAD edit. Both now need the viewer role. | `eca02bf` |
| 2 | Major | `app.ts`, `http/rpc.ts` | Local mode has no session cookie, and two kinds of POST need no CORS preflight. Any website open in the user's browser could run a command with an empty body (`pieces.create` made a piece) and upload files of up to 200 MB. Writes from an untrusted Origin now get 403. | `e813c79` |
| 3 | Major | `rpc/execute.ts`, `audit.ts` | A lone surrogate in any input string passed the handler's write, then failed the audit insert: the change was made, the answer was 500, and no audit row was left. A NUL character gave 500 on any command. Such input now gets 400 before anything is written. | `4f62c6e` |
| 4 | Major | `handlers/pieces.ts` | Deleting a piece removed its job rows without telling the engines. Blender takes and paid image jobs carried on. Live jobs are now cancelled first. Production package builds have no cancel and still run to completion. | `29f7baf` |
| 5 | Minor | `http/rpc.ts` | A command's request body had no size limit. Now 64 MB, 413 beyond. | `1171b6c` |
| 6 | Minor | `handlers/production.ts` | Concurrent `production.create` calls collided on the revision number and returned 500. They now get consecutive revisions. | `37656a5` |
| 7 | Minor | `recovery.ts` | A run whose assistant failed to resume at boot stayed `running` for good. It is now failed as interrupted. | `24a300a` |
| 8 | Major | `app.ts`, `config.ts` | A local install answered to any Host name. A DNS-rebinding page is same-origin with the server, so fix 2 does not stop it: it could read and change the whole workspace and call `renders.configureEngine`, which probes a path as an executable. The founder chose loopback plus an explicit allow-list (25 Nov). In local mode the server now refuses, on every route, any host name other than loopback, the public URL, the dev origins, the address in `HOST` and the names in the new `PAVE_ALLOWED_HOSTS` setting. Accounts mode is unchanged. **For people who open a local install by a LAN address: they must now list that address in `PAVE_ALLOWED_HOSTS`** (the refusal message says so; the README has the line). | `6c87baf` |

### Seen but not fixed

1. `org.setRole`'s last-owner check is not atomic: two owners demoting each other at once could leave none. Not reproduced.
2. A negative `limit` is accepted by `design.history`, `renders.list`, `threads.list` and `traces.runs`. PGlite returns nothing; real Postgres would likely error. The clean fix is a contract change in `packages/schema`.
3. Missing indexes: `brand_model` and `run_feedback` have none on `org_id` or `run_id`; `reference.asset_id` and `model_shot.piece_id` are filtered without one. Needs a migration.
4. A mutation and its audit row are not one transaction (`rpc/execute.ts`).
5. The auth library's `get-full-organization` route is reachable by any signed-in user; whether a guest can list members through it was not tested.
6. **For the assistant branch:** extra routes mounted through `routes(app, runtime, withCtx)` (the run stream, `/mcp`) get membership only. They need their own role check, as `/api/events` did.

Found clean: tenancy scoping in every handler, asset path and type handling, error and secret hygiene, job terminal states, migrations against the schema.

Not reached: the Blender queue and kernel pool under failure, the auth library's organisation routes beyond two probes, rate limiting on `/api/auth/*`, static file serving.

## 3. Studio and UI: `claude/bugsweep-studio` (11 commits, done)

Only files under `apps/studio/src` changed (26 files). Checks run: all 24 studio and UI test files (192 tests) pass, run one file at a time; `pnpm --filter @pave/studio typecheck` and `pnpm --filter @pave/ui typecheck` clean; the formatter clean on the changed files. 65 tests added. **Not run:** the repo-wide `pnpm -s typecheck` (it was killed for lack of memory on the shared machine: run it at integration) and anything in a browser.

| Severity | Where (under `apps/studio/src`) | What was wrong | Commit |
|---|---|---|---|
| Major | `features/cad/ops.ts`, `features/cad/index.tsx` | Selecting a band together with its stone and pressing Delete did nothing: the cascade removed the stone, the second removal failed, the whole change was refused and the error was uncaught. | `3916677` |
| Major | `features/cad/state/workspace.ts` | The selection kept features that had left the design (undo of an add, a teammate's or the assistant's delete). Delete then threw; rename and hide were offered for a feature that was gone. | `3916677` |
| Major | `lib/rpc.ts`, `lib/design-session/session.ts` | A successful answer that is not JSON (a proxy page) came back as `null`. The design outbox then stalled for good: "Saving" forever, later edits never sent. | `8ef5167` |
| Major | `lib/rpc.ts` | A connection lost while the answer was being read was treated as a refusal and the edit was dropped, though the server may have applied it. It is now retried under its id. | `8ef5167` |
| Major | `features/cad/export.ts`, `lib/assets.ts` | When the in-browser exporter failed, the server fallback saved a 404 or 500 error body as `Piece.stl` and said "Exported STL". | `c42a1f9` |
| Major | `features/cad/viewport/StageStatus.tsx`, `lib/kernel/usePieceEvaluation.ts` | When the first evaluation of a piece failed, the view said "Preparing the workbench…" for good. It now shows the reason and a Retry. The retry wiring is covered by typecheck only. | `4455fab` |
| Minor | `lib/design-session/core.ts` | Redo was offered for an undo that had been dropped before it was sent. | `1296dd4` |
| Minor | `lib/rpc.ts` | An error with no body over HTTP/2 gave an empty message in the toast. | `8ef5167` |
| Minor | `features/cad/inspector/measures.ts`, `features/cad/ops.ts` | Typing a carat weight stored the width with float noise (0.13 ct wrote `3.2600000000000002` mm). These values are saved in the design. | `f9875f1` |
| Minor | `lib/format.ts` | A 0.8 mm melee stone read "0 ct"; relative times read "60 sec. ago" and "24 hr. ago". | `5cdafbd` |
| Minor | `features/cad/empty/importers.ts` | A file named `model.constructor` was taken for an importable type. | `34b487e` |
| Minor | `lib/save-file.ts` | "CON.backup" was saved under a reserved Windows name; the length cap could cut an emoji in half. | `f65019c` |
| Minor, latent | `lib/commands.ts` | The command registry could restore a registration that had already left. | `8f4b448` |

For the reviewer: `remove()` in `features/cad/ops.ts` now takes the design as its first argument; `carats()` prints three decimals below 0.1 ct wherever it is used; the viewport status overlay moved to its own file.

### Not fixed: needs a decision or a browser (read from the code, not reproduced)

1. **Major, unverified:** bare-key shortcuts are suppressed only inside text fields. With focus on a button in a dialog, a menu or the palette, Delete and Backspace may still delete the selected feature behind it, and letter keys may fire during menu typeahead. Needs a browser check and a rule for overlays.
2. When an update fails while a model is already on screen, the old model and old weights stay with no notice.
3. The optimistic spec edit (`pages/piece/SpecCard.tsx`) has no rollback if the refetch also fails.
4. `addStep` commits ops built against an earlier design after an await; if the target was removed meanwhile, it is an unhandled rejection with no message.
5. The server export fallback exports the saved version, not what is on screen, when edits are still unsaved.
6. `packages/ui/src/storage.ts` trusts any JSON in localStorage; a bad value under the palette's recents key would throw on every load.
7. Small ones: Escape in the title field does not leave the field; an "Error: " prefix in a tooltip; bare-key shortcuts also fire with Ctrl held on macOS; every ack rebuilds the view objects, costing one redundant draft evaluation per edit; `Workspace` is not keyed by piece id; text fields commit on blur only.

The end-to-end scripts in `apps/studio/e2e` are driver scripts that need Playwright, the server and a browser; they were read, not run.

Not reached: `features/assistant`, the middle of the viewer (picking, model build, framing), settings, library and auth pages, the small feature folders, most of `packages/ui`.

## 4. Kernel and schema: `claude/bugsweep-kernel` (9 commits, done)

Checks run on the final code, one file at a time with a 4 GB heap: the export suite (30 tests), eight neighbouring kernel test files (160), the production bundle test (5) and the schema suite (150) all pass; `@pave/kernel` and `@pave/schema` typecheck clean; the formatter clean on all changed files. 31 tests added and 1 strengthened. **Not run:** the repo-wide typecheck and the rest of the kernel suite (freeform, bail, finding, fonts, mesh, hosts). No contract in `packages/schema` was changed.

| # | Severity | Where (under `packages/kernel/src`) | What was wrong | Commit |
|---|---|---|---|---|
| 1 | Major | `export/rhino3dm.ts` | Every 3DM export left its whole model in the rhino3dm heap: 17 MB grew to 269 MB over 60 exports. Flat after the fix. | `4936b68` |
| 2 | Major | `export/step.ts` | Every STEP export with a faceted stone grew the OpenCascade heap by about 4 MB: 105 MB grew to 451 MB over 60 exports. Flat after the fix. | `a1fa2eb` |
| 3 | Major | `workerHost.ts`, `client.ts` | If posting an evaluation to the page failed, the worker still recorded those buffers as delivered. The next `evaluate()` never settled. | `6c8f6d2` |
| 4 | Major | `mesh/parse/glb.ts` | GLB import read accessor data through a view of the caller's whole buffer, so a crafted file returned whatever bytes lay behind it as vertex positions. Indices were never checked. | `9bfb4f5` |
| 5 | Minor | `export/glbFormat.ts` | GLB export of an empty selection wrote an invalid glTF. It is now refused, as in the other formats. | `b5b21dc` |
| 6 | Minor | `export/meshes.ts` | A control character in a part name made the 3MF model malformed XML and dropped the name in 3DM. | `03868f1` |
| 7 | Minor | `export/meshes.ts` | Repeated names were numbered without checking names already taken, so two objects could share a name. | `03868f1` |
| 8 | Minor | `evaluate/build.ts` | A stone of zero or negative size from a stored document was weighed (−0.134 ct for a −3 mm round) and a halo with stone size 0 sent 147 NaN matrices to the viewer. | `706e6b2` |
| 9 | Minor, test | `export/export.test.ts` | The OBJ float32 test compared a value with itself and could never fail. | `220db97` |

Also added (`cb46c1f`): undo as a property over all 14 templates (120 random op batches each), and ring sizes against published charts.

**For the reviewer:** STEP files change once. Geometry, products and colour assignments are identical entity for entity; only the order of the colour blocks at the end differs. No test or stored hash depends on the old bytes. The first line of commit `03868f1` lists STL among the formats that carry names; STL carries none.

### Needs a decision (not changed)

1. UK quarter sizes print as halves: 11.25 shows as "UK L½" (`packages/schema/src/domain/sizes.ts`).
2. `ringSizeFromDiameter(10, 'us')` returns −2, which prints as "US -2" and which the node schema would then refuse.
3. Out-of-range values in stored documents are slow, not refused: a stone row with gap −5 took 9 s at draft (7,999 stones); a setting with 500 prongs took 17 s. Clamping at the kernel boundary is a design choice.
4. Reference kinds are not checked in `validateDesign` beyond pavé, engraving and boolean; a chain threaded through a non-bail builds with no message.
5. The cabochon carat factor (`0.0105` in `packages/schema/src/domain/gems.ts`) looks about 14% above the usual formula. Not checked against a published source: please verify before changing.

Seen, not reproduced: 3MF import has no cap on triangles through nested components; `geometry/sweep.ts` uses the same collector-dependent sewing tool that was replaced in STEP export.

Found clean: US ring sizes 3 to 13 against published diameters, undo and op squashing over 2,737 random change sets, 224 extreme piece specs, 67 degenerate designs.

Not reached: the mesh pipeline (repair, shell, simplify), fonts, DFM checks, the API contracts, the numeric rules in `intents.ts` and `mount.ts`.

## 5. Totals

Four branches, 36 commits, 38 defects fixed (18 major), 118 tests added. Open and needing a decision: keyboard shortcuts firing behind dialogs (major, unverified), currency mixing in cost estimates, and the smaller items listed under each branch. Nothing was checked in a browser, and Blender was not installed on the machine.

## 6. Pull request text, ready to paste

All four target `claude/busy-bardeen-o482lo`. The pull requests are not raised yet: this session could not push. To raise them after the branches are on GitHub:

```bash
gh pr create --base claude/busy-bardeen-o482lo --head claude/bugsweep-server --title "<title below>" --body-file <file with the description below>
```

Each description should end with these two lines:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016tMMHaaq3eF5cAC9rFpKCe
```

### `claude/bugsweep-server`

**Title:** Server bug sweep: guest access, cross-site writes, unknown host names, unstorable text, orphaned jobs and three smaller fixes

**Description:**

What: eight server defects fixed, each with a test that failed first.

- A local install answered to any host name, so a page using DNS rebinding could read and change the whole workspace. In local mode the server now answers only to loopback, the public URL, the dev origins, the address in `HOST` and the names in the new `PAVE_ALLOWED_HOSTS` setting. Accounts mode is unchanged. Anyone opening a local install by a LAN address must add that address to `PAVE_ALLOWED_HOSTS`.
- Guests could download organisation assets and watch the live event stream; both now need the viewer role.
- On a local install, any website could run empty-body commands and upload files; writes from an untrusted Origin are refused with 403.
- A lone surrogate or NUL in command input caused a 500, and in the surrogate case left a change with no audit row; such input is refused with 400 before anything is written.
- Deleting a piece left its renders, image-to-3D jobs and on-model images running in their engines; they are cancelled first.
- Command bodies had no size limit; now 64 MB, 413 beyond.
- Concurrent `production.create` calls returned 500; they now get consecutive revisions.
- A run whose assistant failed to resume at boot stayed `running`; it is now failed as interrupted.

Why: found in a sweep of `apps/server` for authorisation, input handling, job durability and database issues.

How verified: 11 new tests. 11 server test files pass at the head (96 tests); `pnpm --filter @pave/server typecheck` is clean; the formatter is clean on changed files. `drizzle-kit generate` reported no schema drift before the last commit, which changes no schema.

Not included: production package builds are not cancelled when their piece is deleted; no migration for the missing indexes; no change to `packages/schema`. The engine suites (kernel, Blender) were not run; engine code is unchanged.

### `claude/bugsweep-studio`

**Title:** Studio bug sweep: delete and selection, unreadable server answers, export fallback, viewport error state, number and name formatting

**Description:**

What:

- Delete now works when a feature is selected together with something attached to it, and the selection no longer keeps features that left the design.
- The RPC client rejects a successful answer that is not JSON, treats a connection lost mid-answer as unreachable, and never produces an empty error message. The design outbox retries instead of stalling.
- Redo is not offered for an undo that was dropped before it was sent.
- The server export fallback no longer saves an error response as the exported file.
- The viewport says when the first evaluation failed and offers a retry, instead of "Preparing the workbench…" for good.
- Stone widths from carats and default chain sizes are stored as exact steps. Weights under 0.1 ct show three decimals. Relative times never read "60 sec. ago". Export file names catch Windows device names before a dot and never cut a character in half. A file extension that is an Object method name is not an importable type.
- The command registry never falls back to a registration that has already left.

Why: a sweep of `apps/studio` and `packages/ui` for state and data correctness, error paths, resource cleanup, input basics and missing tests. Each fix is for a defect reproduced by a failing test.

How verified: 65 new tests; all 24 studio and UI test files (192 tests) pass, one file at a time. `pnpm --filter @pave/studio typecheck` and `pnpm --filter @pave/ui typecheck` are clean; the formatter is clean on changed files. The repo-wide `pnpm -s typecheck` was killed for lack of memory on the shared machine and must be run at integration. Nothing was checked in a browser.

Not included: bare-key shortcuts while a dialog or menu has focus (needs a browser check and a rule); a notice for a failed update over a model already on screen; rollback for the optimistic spec edit; the unhandled rejection in the next-step chips; the server export fallback waiting for unsaved edits; validation of values read from localStorage; the replace-stone dialog outliving its tab (owned by lane A).

Review notes: `remove()` in `features/cad/ops.ts` now takes the design as its first argument. `carats()` prints three decimals below 0.1 ct wherever it is used. The viewport status overlay moved to `features/cad/viewport/StageStatus.tsx`.

### `claude/bugsweep-packages`

**Title:** Bug sweep, packages: stone pricing, CSV formulas, SVG, render progress, installer

**Description:**

What: seven fixes in the supporting packages and the install path, each with the test that proves it.

- Production cost: a supplier price attached to stones is now charged once and in full. A pavé parcel whose stones fall in two size lots was charged to both (1,000 became 2,000); two stones bought apart that share a lot were costed at the first one's price, and `stones.csv` listed only the first SKU and certificate.
- Production CSV: text starting with a minus sign and a digit is no longer exempt from formula neutralising. Only a plain negative number is exempt now.
- Production drawings: control characters in a piece title no longer make every SVG unparseable.
- Production cost: brass honours `spotPerGram.base` instead of the placeholder.
- Render runner: a stdout line that looks like progress but is not valid JSON is skipped instead of throwing an uncaught exception in the server.
- Sourcing: a lab-grown diamond is lab-grown whatever a leftover quality note says.
- Installer: step 6 checks that Blender actually loads before saying it is installed; the README step numbers match the script.

Why: the first three reach a customer or a workshop (money in the estimate, files opened in a spreadsheet, drawings that will not open).

How verified: 11 new tests (the installer change was checked by hand). `packages/production` 57 tests; `packages/render` and `packages/sourcing` 36 passed and 2 skipped (no Blender on the machine); `pnpm -s typecheck` clean; the formatter clean on the changed production, render and installer files.

Not included: currency conversion for USD-named prices when the estimate is in another currency; what a price on a patterned gem means; rejecting an empty design; the Node 22.3 versus 22 mismatch; `install.ps1` with brackets in the path; formatting of `packages/sourcing`, which fails the formatter before this branch.

### `claude/bugsweep-kernel`

**Title:** Kernel and schema bug sweep: export memory, GLB import bounds, Worker recovery, export names

**Description:**

What: nine fixes in the CAD kernel, each with a test that failed first, plus property and table tests for the schema.

- 3DM export no longer keeps every exported model in the rhino3dm heap (17 MB to 269 MB over 60 exports before; flat now).
- STEP export frees its document, session and stone facets instead of leaving them to the garbage collector (105 MB to 451 MB over 60 exports before; flat now).
- The kernel Worker recovers when a result cannot be posted; before, the next `evaluate()` never settled.
- GLB import stays inside the file's binary chunk, checks triangle indices, and reports a truncated file readably.
- GLB export refuses an empty selection instead of writing an invalid glTF.
- Object names in 3MF, OBJ and 3DM: control characters become a space, and repeated names are numbered past names already taken.
- A stone of zero or negative size from a stored document fails its node instead of producing negative carats and NaN matrices.
- The OBJ float32 test can now fail.
- New tests: undo as a property over all 14 templates, and ring sizes against published charts.

Why: these are the paths the engine pass looked at least: files other programs must open, memory over many exports, and the Worker's failure path.

How verified: the export suite (30 tests), eight neighbouring kernel test files (160), the production bundle test (5) and the schema suite (150) pass on the final code. Typecheck of `@pave/kernel` and `@pave/schema` is clean; the formatter is clean on all changed files. The two memory fixes are proven by reading the WASM heaps directly.

Note for reviewers: STEP files change once. Geometry, products and colour assignments are identical entity for entity; only the order of the colour blocks at the end of the file differs.

Not included: UK quarter-size labels; negative US sizes from small diameters; range clamping at the kernel boundary; reference-kind checks in `validateDesign`; the cabochon carat factor. Each needs a decision. No change to any contract in `packages/schema`.
