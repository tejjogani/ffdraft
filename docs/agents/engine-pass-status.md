# Engine test pass: status snapshot

_Generated 24 November 2026 from the running workflow's journal. The pass is still running; this is the latest known state, not the final one. Re-generate it or read the final commit message when the pass ends._

How the pass works: six testers (stones, pendants, freeform and pavé, core, exports and checks, performance and worker) tried to break the engine; fixers own one area each and fix blockers and majors; a fresh verifier re-runs every repro; up to three rounds per area. Scripts: `docs/agents/workflows/engine-test-pass.js` (round 1) and `engine-test-pass-continue.js` (rounds 2 and 3, the stone replacement build and the studio menus).

## Round 1 (testers)

| Area | Blockers | Majors | Minors |
|---|---|---|---|
| core | 4 | 14 | 11 |
| freeform | 1 | 7 | 10 |
| pendants | 1 | 19 | 5 |
| stones | 1 | 12 | 8 |

## Later results, newest last

### test:perf-worker

Perf-worker pass, round 2, run against the current code. Scripts, logs and outputs are under /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/perf-worker/ (P below). Round-1 output was moved to P/old-r1. I changed no repository files.

Caveat: other agents edited stones code while I ran (kernel.ts now calls resolveDesign; gem, setting, halo, gemRow and ringShank changed 17:44–18:08). I re-ran the incremental check on all six ring templates after the last change (P/logs/incr-rings-rerun.log). Draft determinism (all templates) and production determinism (all but solitaire and oval-pave, whose run-a evaluations started at 18:08:05–06, just after those edits) also ran after them. The pendant incremental runs predate some of those edits, but they touch no pendant code.

Ran and held up:
1. Incremental vs fresh kernel, 14 templates, draft: every add, remove, move, setKind and field update, each followed by its undo, about 900 edits. Parts, stones, report and diagnostics are identical everywhere except studs, where 19 edits show a last-bit volume drift (P/logs/incr-all.log, incr-summary-final.log).
2. Memory, 300 edits per design: halo, pendant-solitaire, iced-initial at draft and solitaire at production. WASM and JS heap plateau (halo stays at 16 MB Manifold / 45 MB heap). Cycling all 14 templates 6 times in one kernel plateaus at 193 MB Manifold / 49 MB heap. No leak found (P/logs/mem-*.log).
3. Determinism across fresh processes: identi

| Id | Severity | Summary |
|---|---|---|
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |

### fix:stones:1

## Stones area, fix round 1: report

**Summary.** Stone replacement is built: follow fields, the mount rules and `resolveDesign`, the `replaceStone` intent, and the `design.replaceStone` command with its server handler. All of it is tested.
- The plan's draft matrix is green: 6 centre-stone templates × 13 cuts × 0.5 / 1.5 / 4 ct, through the intent and again as a plain update. That is 234 cases each way, with no failed node and no error diagnostic.
- The blocker and most majors are fixed. A few items are partial or deferred; they are listed below with the reason.
- Typecheck is clean across all packages, and biome is clean on every file I touched.
- Three test groups in other owners' packages fail. One group (match pose fit) is caused by my wire rule; the other two I could not tie to my changes.
- No git state was changed.

### What was built
- **Follow fields** (`design/fields.ts` `follows()`, `nodes.ts`):
  - The follow fields are `gem.lw`, `gemRow.graduateTo`, `setting.prongCount`, `setting.prongDiameter`, `setting.prongSpin`, the ring-top `placement.angle`, `ringShank.shoulderHeight` and `gemRow.skipCenter`.
  - A new `placement.side` ('left' / 'right') marks a side stone. A new `halo.head` reference is filled by the resolver.
  - None of these fields has a schema default any more. Writing `null` resets a pin to auto.
- **Old designs keep their meaning:**
  - `DesignSchema` is now version 2. `migrateDesign` runs inside `applyOps` and `resolveDesign`.
  - It removes the two old "not set" sentinels: `graduateTo` 1.5, and `lw` 1 on a cut that cannot be square.
  - It then unpins any stored value that equals its rule. Every other stored value stays pinned, so old pieces build exactly as before.
- **`design/mount.ts`** (pure). It reuses canon numbers rather than new ones:
  - Claw count is `GEM_CUTS[cut].prongs.typical`. The canon's `PRONGS_BY_CUT` table moved here and canon now imports it. A round of 7.4 mm or more takes 6.
  - Claw rotation uses canon `clawSpin`: 4 claws at 45°, odd counts at 90/n, other even counts at 0.
  - Claw wire uses canon `0.1·W+0.35`, ×0.88 for 6 or more claws, −0.1 inside a halo, never under 0.8 mm.
  - Side stones are packed 0.5 mm in plan from the girdle beside them.
  - The cathedral rise is solved so the arch peaks sit about 0.3 mm under the girdle.
  - `skipCenter` clears the head, its claws and any halo by 0.4 mm.
  - Also in the file: `stoneDims` (moved from the kernel), `pins` / `pinsOffRule` / `unpinAtRule`, and `resolveDesign`.
  - The kernel evaluates `resolveDesign(design)`, called from `kernel.ts`.
- **`design/intents.ts` `replaceStone`** returns `{ ops, label, notes, warnings }` as the plan specifies:
  - Targets: a gem, a field, `instance` (no ops, plus an `instance.fixed` warning with a whole-field suggestion), or `scope: 'alike'`.
  - Size: a new cut with no size keeps a single stone's carat and a field's mm. Field sizes snap to stock melee. Graduation and the pavé size spread are kept.
  - Sourcing: a

### verify:core:1

Round-1 check of the core area. I re-ran every repro I could from copies in /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/verify-core-1/. Everything I wrote went there; I did not write into the tester folders.

Tests: `vitest run packages/kernel packages/production packages/render packages/schema` passed, 39 files and 458 tests (vitest.log). I rebuilt all 14 templates at draft and production with sweep.mts and the templates-fuzz audit (closed parts, finite numbers, stones near metal, raw messages). Nothing threw and the audit found no problem (sweep.log). I rendered the production solitaire, halo, iced trophy and pendant solitaire, plus close-ups of the name pendant, and they look like sound pieces. I also rendered the drawings for cuban, tennis, iced-initial and name-pendant and looked at each one.

Fixed, with evidence:
- Ellipsoid: closed, 100.53 mm3, STL and STEP export (ellipsoid.log).
- Revolve profiles now fail with a designer message (throws.log 8-10).
- 160k stones: clean feature.failed (throws.log 16).
- Nested patterns and trophy/combo scale: about 1.3 s, or a failure with a message (pattern.log, scale.log, trophy-scale.log).
- 200 mm iced pendant: no crash, production 168 s at 1.0 GB, and the kernel is still usable afterwards (crash200.log).
- Undo after a variant switch is exact; applyOps strictness (undo.log, abuse.log).
- Cuban package builds and its sheet is correct (ex/out/pkg/cuban/sheet.png).
- Exact STEP cut r

| Id | Severity | Summary |
|---|---|---|
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |

### verify:pendants:1

I re-checked the pendants area on the current working tree. A stones checkpoint (288c15e) was committed while I worked; it moves the gem lw handling into design/mount.ts. All scripts and logs are under /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/verify-pendants-1/ (P/out for logs and PNGs).

What I ran:
- Area tests (bail, chain, links, finding, cup, pattern, recipes): 103/103 pass. dfm and evaluate tests: 45/45 pass.
- Every template at draft and production (P/out/templates-all.log). The four hung-pendant templates have no error diagnostics, as the owner claims. iced-trophy keeps 4 seat.wall warnings. The ring templates' seat.wall warnings belong to the stones area.
- chain-fused and chain-missing-links: fixed (+0.00 mm³ on all four templates; 402/402 links).
- names.mts: 0/22 loose bails, 0/22 split names.
- The full 224-case bail matrix, which the owner did not re-run (P/out/bails.jsonl).
- loose.mts plus extra hidden-bail cases.
- carat.mts: every cut and recipe within 1 %.
- A 20,000-spec planDesign fuzz: 0 throws, 0 invalid nodes. Plus recipes --no-eval.
- scan-box: every case builds in 5–72 ms.
- scan-tennis and prodclash: drape is clean except a warned chain.tight at 10 mm / 406 mm; production overlap is down to 0.00009 mm³.
- Chain styles with the new wire rule: 0 clashes.
- Studs, mix/ and tennis-princess recipes, the iced 100 mm KING and the 3 mm iced pendant, misc heights, findings defaults, canon lint, canon sugges

| Id | Severity | Summary |
|---|---|---|
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |

### verify:freeform:1

I re-ran every original repro against /home/user/ffdraft with the testers' unchanged scripts (copied to /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/verify-freeform-1/, logs in out/). I also wrote new probes there: genus-local.mts, bead-genus.mts, bead-genus-tpl.mts, beadedge.mts, buried.mts, genus-orig.mts (runs the fixer's pre-fix kernel snapshot), templates.mts, thinfix.mts, perf8k-t.mts, tf/engr.mts and tf/iced06.mts. I rendered and looked at about 20 PNGs.

**What held up**
- Finding 1 (blocker, stones inside the cavity): fixed. 0 stones face into the cavity on the dice; on the trophy, 0 in the cavity and 0 on the flat back. Images: cavity-dice-2.png, trophy2-all.png.
- Finding 2 (seats breaking through): fixed on the solid hosts. The hexagon plate and the 14 mm dice stay genus 0, with 0 breakouts.
- Finding 3: pave.thin appears with a one-click fix, and that fix applies cleanly.
- Finding 4 (beads): every stone in a single row now has beads.
- Finding 6: the floating speck is removed and the model comes out 40 mm.
- Finding 7: all 10 script names are one piece.
- Finding 9: the kernel's raw messages are reworded.
- Finding 11: far fewer sizes (circle, 0.8–3 mm range: 18 sizes down to 6).
- Finding 12: specks are gone on the trophy and relief cases.
- Finding 14: the star now comes out at exactly 22.00 mm.
- Finding 15: the pillow rim ripple is down from 0.100 to 0.015 mm.
- Finding 16: sans and serif kerning now applied (s

| Id | Severity | Summary |
|---|---|---|
|  | major |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |

### verify:stones:1

I checked the fix in /home/user/ffdraft (HEAD 288c15e plus two docs-only commits; git status is clean). For a baseline I extracted the pre-change tree e5d18f2 with git archive into my scratch dir. All scripts, logs and images are under /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/verify-stones-1/ (ss/, tf/, P/, compat/, attack/, look/out/).

**Tester repros rerun on my own copies:**
- probe2 K, L, M, N, O, Q, R, U; repro-misc; rows; gems; throws 12–15; two-alloy-head; suspects; templates (both detail levels); raw-messages; domain.

**Fixed, with evidence:**
- **0, claw legs:** fixed at 1.5 ct. Leans are 5–28°, there is one part, and a base rail.
- **1, claw spin and count:** fixed. With the rule spin every symmetric count is symmetric, and every asymmetric, bare-point or cleft pin warns (o2.mts).
- **2, stale head:** fixed through follow fields.
- **4, three-stone sides:** fixed. Plan gap is 0.50 mm in every case.
- **5, cathedral height:** fixed. Peaks sit 0.25–0.29 mm under the girdle.
- **6, shared prong:** fixed except the court band. Untouched claws went from 60/60 to 0, and the court-band channel now holds.
- **7 and 15, sentinel defaults:** fixed.
- **10, half bezel:** fixed. Points are 0.01–0.05 mm from metal.
- **11, flush head:** fixed. It now gives a `setting.noHost` error.
- **12, pavé end beads:** fixed. Beads went from 36 to 40.
- **13, measured size:** fixed in the schema, and the kernel falls back with `stone.mea

| Id | Severity | Summary |
|---|---|---|
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | major |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |
|  | minor |  |

