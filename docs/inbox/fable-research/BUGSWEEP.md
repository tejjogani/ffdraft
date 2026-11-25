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

## 2. Server: `claude/bugsweep-server`

Running.

## 3. Studio and UI: `claude/bugsweep-studio`

Running.

## 4. Kernel and schema: `claude/bugsweep-kernel`

Queued.
