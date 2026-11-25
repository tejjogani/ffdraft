# Bug sweep of the integration branch: findings and branches

_Asked for by the founder on 25 November 2026: "spawn an agent team look for bugs, obvious misses, missing tests and paths and update on your work tree and raise PRs". He chose the integration branch as the target. Four areas, one branch each, all based on `claude/busy-bardeen-o482lo` at `cb7dcd0`. Each defect was reproduced with a failing test before its fix. The nine majors lane A carries into A4 were left alone._

Each branch is meant to become one pull request into `claude/busy-bardeen-o482lo`. Lane A decides what to merge.

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

## 2. Server: `claude/bugsweep-server` (8 commits, done)

Checks run: 13 server test files pass (two runs: 68 passed and 40 passed, each with 1 expected failure, which is finding 8 below); `pnpm -s typecheck` exits 0; the formatter clean on changed files; `drizzle-kit generate` against a scratch copy reports no schema drift. Eight tests added. **Not run:** the engine suites that need the kernel or Blender; engine code is unchanged. Note: the server runs on Postgres (embedded PGlite or `pg`), not SQLite.

| # | Severity | Where (under `apps/server/src`) | What was wrong | Commit |
|---|---|---|---|---|
| 1 | Major | `http/assets.ts`, `http/events.ts` | A guest can run no command, but both routes checked only membership. A guest could download any organisation file by id and receive every live event, including the full ops of each CAD edit. Both now need the viewer role. | `eca02bf` |
| 2 | Major | `app.ts`, `http/rpc.ts` | Local mode has no session cookie, and two kinds of POST need no CORS preflight. Any website open in the user's browser could run a command with an empty body (`pieces.create` made a piece) and upload files of up to 200 MB. Writes from an untrusted Origin now get 403. | `e813c79` |
| 3 | Major | `rpc/execute.ts`, `audit.ts` | A lone surrogate in any input string passed the handler's write, then failed the audit insert: the change was made, the answer was 500, and no audit row was left. A NUL character gave 500 on any command. Such input now gets 400 before anything is written. | `4f62c6e` |
| 4 | Major | `handlers/pieces.ts` | Deleting a piece removed its job rows without telling the engines. Blender takes and paid image jobs carried on. Live jobs are now cancelled first. Production package builds have no cancel and still run to completion. | `29f7baf` |
| 5 | Minor | `http/rpc.ts` | A command's request body had no size limit. Now 64 MB, 413 beyond. | `1171b6c` |
| 6 | Minor | `handlers/production.ts` | Concurrent `production.create` calls collided on the revision number and returned 500. They now get consecutive revisions. | `37656a5` |
| 7 | Minor | `recovery.ts` | A run whose assistant failed to resume at boot stayed `running` for good. It is now failed as interrupted. | `24a300a` |
| 8 | **Major, not fixed** | `app.ts`, `config.ts` | **A local install answers to any Host name.** A DNS-rebinding page is same-origin with the server, so fix 2 does not stop it: it can read and change the whole workspace and call `renders.configureEngine`, which probes a path as an executable. Recorded as an expected failure in `http.test.ts` (`4cf476c`). A Host allowlist (loopback, the public URL, `HOST`) would stop it but could lock out people who use a LAN address. **Needs a decision.** Research 20 found the same gap independently; `docs/plans/accounts-and-developer-api.md` plans the fix as its first step. |

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

## 4. Kernel and schema: `claude/bugsweep-kernel`

Running.
