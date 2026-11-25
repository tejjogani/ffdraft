# Live status of agents and tasks

_Generated 25 Nov 2026 18:35 UTC by `docs/agents/sync_status.py` from the workflow journals; pushed automatically. Who owns what: `docs/agents/BOARD.md`. The plan: `docs/PLAN.md`._

## Release verification (lane A, A3)

Branch `claude/busy-bardeen-o482lo`, head: d29e6c2 Board and status: the merge is in, release verification under way

| Agent | State | Outcome |
|---|---|---|
| verify:1 | running or interrupted |  |

## Trial on five real pieces (lane A)

| Agent | State | Outcome |
|---|---|---|
| setup | done | The trial install is ready and the HOWTO is proven, but I stopped another session's Pavé server by mistake while cleaning up. That comes first. ## Incident: my cleanup killed another session's server - **What I did:** a… |
| trial:solitaire | running or interrupted |  |
| trial:halo | running or interrupted |  |

## Diaex connection (lane A)

| Agent | State | Outcome |
|---|---|---|
| build | running or interrupted |  |

## Integration and release (lane A, A3)

Branch `claude/busy-bardeen-o482lo`, head: d29e6c2 Board and status: the merge is in, release verification under way

| Agent | State | Outcome |
|---|---|---|
| merge | running or interrupted |  |
| verify:1 | running or interrupted |  |

## Assistant build (lane A, A1)

Branch `claude/assistant-build`, head: 645a050 Record the temporary review-fix commit as superseded

| Agent | State | Outcome |
|---|---|---|
| build:core | done | commit 9416abf. I built step 1. Most of the step-1 contract was already in the base commit: the ServerEvent and RunEvent schemas, the thread, run, step and message fields, message seq, design.revert {runId}, the budget_exceeded code, t… |
| build:loop | done | commit 797956b. I built step 2: the assistant now runs for real on the server. The scripted tests pass and the real server was checked by hand (details below). The studio screens are not built yet. - **Run loop** (apps/server/src/assis… |
| build:dock | done | commit d32024f. Step 3 is built and committed (d32024f). The studio now runs the assistant from end to end, and AI jobs are on the three stages. - **Dock** (apps/studio/src/features/assistant/): it combines the stored messages with the… |
| build:photo | done | commit ac8f3a1. Step 4 is built and committed as ac8f3a1 on ai/assistant (not pushed). The assistant can now look at the design and turn a photo of a piece into a parametric design. - **Seeing the design.** `ClientBridge` asks the wind… |
| build:design | done | commit eec5212. Step 5 is built and committed as eec5212 on ai/assistant (not pushed). The Design stage and the design-to-CAD job now work end to end with a Claude key and no image model. - **Directions belong to one piece, not separat… |
| build:render | done | commit c3afdf5. Step 6 is built and committed as c3afdf5 on ai/assistant (not pushed). The Render stage now works by hand and with the assistant, including real Blender takes. - **Render tab** (apps/studio/src/features/render/): - The … |
| build:plans | done | commit f555352. Step 7 is built and committed as f555352 on ai/assistant. It is on top of c3afdf5 and not pushed. An earlier interrupted attempt had left most of the code uncommitted in the worktree. I reviewed all of it, kept it, and … |
| build:mcp | done | commit 4589090. Most of step 15 was already in the branch: commit e36e71b, made between steps 9 and 10, added pnpm agent:smoke (apps/server/src/smoke-cli.ts and apps/server/src/assistant/smoke.ts), the installer's --check key report, t… |
| build:framing | done | commit f8aacab. Step 8 is built and committed as f8aacab on ai/assistant (on top of f555352, not pushed). An earlier interrupted attempt had left most of the code uncommitted. I reviewed all of it and kept it. Then I fixed what the rea… |
| build:references | done | commit 010345f. I built step 9 and committed it as 010345f on ai/assistant, on top of f8aacab. It is not pushed. There is now a reference panel beside CAD. - **The panel.** It sits beside the CAD workspace and the Render tab as a flat … |
| build:harness | done | commit 342481a. Step 16 is built and committed as 342481a on ai/assistant, on top of the checkpoint 207340c and e5d18f2's line. It is not pushed. Every layer of the assistant harness is now checked against a strict fake Claude API, and… |
| build:cinema | done | commit 7df93f9. Step 10 is built and committed as 7df93f9 on ai/assistant, on top of e36e71b. It is not pushed. The Render job now works as an AI cinematographer. - **Looks first.** The new `scenes.suggest` tool reads what matters in t… |
| build:polish | done | commit 95f4336. Step 13, the premium design pass, is committed as 95f4336 on ai/assistant, on top of ed6cf7c. It is not pushed. No behaviour changes. - **Biggest find: the frosted glass never frosted in Chromium or Electron.** We wrote… |
| build:flow | done | commit c4eddee. Step 11 is built and committed as c4eddee on ai/assistant, on top of 7df93f9. It is not pushed. - **The assistant window.** It has three forms. Docked, it sits in the right-hand sidebar. Pulled out, it is a floating fro… |
| build:pavefile | done | commit ed6cf7c. I built step 12, the native Pavé file, and committed it as ed6cf7c on ai/assistant, on top of c4eddee. It is not pushed. The tests, typecheck and three Playwright passes all pass. - **The file:** a zip with: - `mimetype… |
| build:light | done | commit 499b203. Step 14 is built and committed as 499b203 on ai/assistant, on top of 95f4336. It is not pushed. Orbiting is now 22–37 frames a second in the slow test setup, up from 1–2. A slider step shows in 0.2–0.34 s, down from 2.1… |
| review:api | done | 2 major, 3 minor. The request builder is mostly sound on every model and tier. Every request it builds keeps adaptive thinking with summarized display and sets effort to high ex… |
| review:safety | done | 1 blocker, 4 major, 2 minor. FAIL. The key itself is handled well, but the security and cost rules are broken in several places. What held up when tested: the saved key is sealed with AES-… |
| build:ideas | done | commit 8df7d93. Step 17 is built and committed as 8df7d93 on ai/assistant, on top of 342481a. It is not pushed. The Design stage no longer holds 3D: it is the piece's design board, a board of pictures, sketches and models. - **Design b… |
| build:imagegen | done | commit 1149e99. Step 18 is built and committed as 1149e99 on ai/assistant, on top of 8df7d93. It is not pushed. The design board can now generate concept images. - **How it works.** The designer writes a request and picks board picture… |
| review:e2e | done | 1 blocker, 2 major, 11 minor. FAIL for the founder's first hour. One blocker, two majors, and a set of polish issues, all reproduced in a real browser. The setup: the studio as committed, `… |
| review:design | done | 6 major, 15 minor. FAIL on the premium-design bar, with no blockers. Nothing I saw puts the founder's test, money or the key at risk. Six major issues break flows or the design-l… |
| fix:1 | done | fixed 31, not fixed 15; commit 9f8675c |
| verify:1 | done | 2 major, 7 minor. Most claimed fixes hold. Both blockers are closed: sec-1 (a DNS-rebound Host now gets 403 on RPC, assets and events) and fh-1 (a custom spec now gets a plain n… |
| fix:2 | done | fixed 2, not fixed 0; commit f57efe2 |
| verify:2 | done | 5 minor. Both fixes hold where they were aimed. Four small issues are still open and none of them blocks. dsn-4: the Facts panel and the readout now agree in every stat… |

## Engine follow-up (lane A, A2)

Branch `claude/busy-bardeen-o482lo`, head: d29e6c2 Board and status: the merge is in, release verification under way

| Agent | State | Outcome |
|---|---|---|
| green | done | All 8 red tests now pass. Typecheck is clean. The full vitest run is green: 832/832 across schema, canon, match, production, render, sourcing, server and studio. The kernel suite is 430/430 (NODE_OPTIONS=--max-old-space… |
| fix:stones | done | Stones area report. Of the 3 majors, 1 is fixed, 1 is partly fixed (the rest needs the canon owner), and 1 is green but not because of my work. Of the 4 minors, 2 are fixed, 1 partly and 1 deferred. Nothing is committed… |
| fix:core | done | ## Core area: report on the follow-up findings Of the 8 core findings, I fixed both majors and 3 minors and deferred 3 minors. Each fix started with a test that failed for the right reason, and I re-ran each finding's r… |
| fix:pendants | done | ## Pendants follow-up report **Outcome:** the three majors I could fix are fixed: name pendants now hang level, both clasps hold on to their end links, and the iced initial no longer warns. The fourth major (finding 4) … |
| fix:freeform | done | Freeform follow-up report. There are no commits; all changes are in the working tree under /home/user/ffdraft. **Result:** the two text majors are fixed. The pavé-layout major is only partly fixed. Of the minors, stone … |
| fix:studio_deferred | done | studio_deferred: all 5 majors are fixed. There are no minors in this key. The code fixes were already in the tree before I started. The fix-askai pass changed the assistant files, dialog.tsx, dock-area.ts and viewer.ts … |
| verify:core | done | 1 major, 4 minor. FAIL. Four of the five claimed fixes hold up when I re-run their repros: major 2 (bail drag), minor 1's main case (hollow box and bead), minor 2 (ready retry) … |
| verify:stones | done | 1 major, 5 minor. FAIL (stones area stays open, but much better). The fixer's main claims check out. Major 2 (cabochon in a halo) is fixed. Major 3 is green: match fit.test plus… |
| verify:pendants | done | 2 major, 5 minor. The fixer's three fixed majors check out (names hang level, clasps hold on to their end links, iced initial is clean), but the area is not clean. Two majors ar… |
| verify:studio_deferred | done | 1 major, 1 minor. All 5 studio_deferred majors check out against the current tree. Every repro was re-run from my own copies in /tmp/claude-0/-home-user-ffdraft/24192795-28e0-54… |
| verify:freeform | done | 4 major, 4 minor. FAIL. Text findings 1 and 2 are confirmed fixed apart from script İ. The pavé-layout major is still open, and I found two new regressions: pavé draft time on s… |

## Engine test pass, rounds 2-3 and studio menus

| Agent | State | Outcome |
|---|---|---|
| test:perf-worker | done | 9 major, 9 minor.  |
| fix:stones:1 | done | ## Stones area, fix round 1: report **Summary.** Stone replacement is built: follow fields, the mount rules and `resolveDesign`, the `replaceStone` intent, and the `design.replaceStone` command with its server handler. … |
| verify:core:1 | done | 4 major, 6 minor.  |
| verify:pendants:1 | done | 10 major, 8 minor.  |
| verify:freeform:1 | done | 2 major, 7 minor.  |
| verify:stones:1 | done | 6 major, 10 minor.  |
| fix:core:2 | done | ## Core fix round 2: report (owner "core") I fixed 22 of the 27 findings fully. 4 are partly fixed and 1 is deferred. Scratch scripts, logs and PNGs are in /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-946201… |
| fix:pendants:2 | done | ## Pendants fix round 2: report I copied the verifier's repro scripts to `/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/fix-pendants-2/P/` and ran them from there. All logs… |
| fix:freeform:2 | done | ## Freeform fix round 2: report **Outcome:** the major bead finding (1) and five minors (3, 4, 5, 6, 8) are fixed. Finding 2 (layout quality, major) is only partly done and still needs work. Findings 7 and 9 are partial… |
| fix:stones:2 | done | Fix round 2, stones area. I fixed or re-checked all 16 findings. Two tests outside my files are red, both explained under "Tests" below. I ran no git commands and changed no git state. ## Per finding **1. Halo (major): … |
| verify:pendants:2 | done | 9 major, 7 minor.  |
| verify:core:2 | done | 3 major, 6 minor.  |
| verify:freeform:2 | done | 4 major, 3 minor.  |
| verify:stones:2 | done | 2 major, 6 minor.  |
| fix:core:3 | done | ## Core fix round 3: report I fixed both blocker-level majors (the wall check and crash handling) and minors 4, 5, 7 and 8. Major 3 is only partly fixed: the remaining cost is in `features/chain`, which is not my area. … |
| fix:pendants:3 | done | ## Pendants fix round 3: report Most of this round's code was already in the checkpoint commits, done by an earlier run of this owner that was cut off before its final checks. In this session I re-ran every repro agains… |
| fix:freeform:3 | done | Freeform fix round 3: report Context: an earlier run of this task was cut off at about 01:04 when the VM restarted. That run had already made most of the changes for findings 1, 2, 3, 5 and 6, and its backups are in the… |
| fix:stones:3 | done | STONES fix round 3: report Scratch scripts, logs and images: /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/fix-stones-3/ (logs/, out/; the probes are hl.mts, wall.mts, post… |
| verify:core:3 | done | 2 major, 7 minor.  |
| verify:freeform:3 | done | 3 major, 2 minor.  |
| verify:pendants:3 | done | 4 major, 4 minor.  |
| verify:stones:3 | done | 3 major, 4 minor.  |
| studio:ask-ai | done | ## Ask AI menus and Replace stone in the studio: report **Summary.** The studio half of `docs/plans/targeted-edits.md` §7 is built and was checked in the real app: - Every context menu in the Design tab now ends with on… |
| review:ask-ai | done | 5 major, 5 minor.  |
| fix:ask-ai | done | All ten findings are fixed in /home/user/ffdraft. Two parts belong in the schema intent and are deferred: chain stones in the intent (finding 5) and the intent's own small-centre warning (finding 6). I did not commit. T… |

## Durable jobs and hosting plan

| Agent | State | Outcome |
|---|---|---|
| survey | done | I wrote the survey to /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/deploy-plan/survey.md; the two bpy probe scripts are next to it. I changed nothing in ffdraft, ffdraft-ai or diaex-backend, … |
| write | done | 1. I wrote the build brief to /home/user/ffdraft/docs/plans/deploy-and-durable-jobs.md (368 lines), in the style of the repo's other plans: a summary, then sections 1–7. I wrote no code. Nothing else in ffdraft, ffdraft… |
| check | done | 2 blocker, 11 major, 6 minor. REVISE BEFORE BUILD. This does not block the founder's local test with his Claude key, because nothing in the plan is built yet. The overall shape holds up: on… |
| fix | done | I applied all 19 findings to /home/user/ffdraft/docs/plans/deploy-and-durable-jobs.md. It now has 433 lines, up from 368, and the section structure (sections 1 to 7, subsections 4.1 to 4.9) is unchanged. Each place wher… |

## Freeform CAD plan

| Agent | State | Outcome |
|---|---|---|
| survey:repo | done | I wrote the survey to /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/freeform-cad/survey-repo.md. I changed no repo code or config. The spikes are spike-eval.mts and shoot.mjs, and the screensh… |
| survey:rhino | done | I wrote the survey at /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/freeform-cad/survey-rhino.md. I changed no repo files. The two spike scripts that test the kernel are next to it (spike-rhin… |
| propose:direct | done | I wrote the proposal to /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/freeform-cad/proposal-direct.md. I changed no repo code or config. Two new spikes back it, both next to it and run with np… |
| propose:history | done | I wrote the proposal to /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/freeform-cad/proposal-history.md. I changed no repo code or config. The three spikes are next to it: spike-naming.mts, spi… |
| synthesize | done | Summary (15 lines): 1. I wrote the build brief to /home/user/ffdraft/docs/plans/freeform-cad.md (271 lines, in the format of cad-workspace.md and assistant.md) and the inventory to /home/user/ffdraft/docs/research/12-rh… |
| check:feasibility | done | 2 blocker, 8 major, 6 minor. Feasible in outline, not as briefed. The tools for building from scratch all run on the real kernel: Sweep2 as a station sweep, extrude, revolve, loft, sweep, … |
| check:jeweler | done | 2 blocker, 8 major, 7 minor. The spine is right: history first, keyed points, provenance names, the fillet guard, one verb registry. But a working Rhino/MatrixGold jeweler cannot finish an… |
| fix | done | I applied all 39 findings to the two docs. Both files keep their structure: the plan went from 271 to 317 lines and research 12 from 245 to 247. I changed no code, config or other files, and nothing under /home/user/dia… |

## Diaex contract

| Agent | State | Outcome |
|---|---|---|
| read:diaex | done | I wrote the map to /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/diaex-contract/diaex-map.md (350 lines). Every claim about Diaex points to a file:line I opened. Diaex was read at commit 3fa75… |
| read:pave | done | I wrote /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/diaex-contract/pave-needs.md. Every claim about today's code has a file:line reference, and new work is marked **New**. I changed nothing … |
| write | done | I wrote the three files in `/home/user/ffdraft/docs/integrations/` (a new folder). I changed nothing else in Pavé, and nothing in Diaex: `git status` there is clean at commit 3fa756d. **The brief to paste is `/home/user… |
| check:diaex | done | 9 major, 4 minor. Fix before you hand it over. I opened about 90 of the brief's diaex: references at commit 3fa756d, and almost all of them hold: the routes, field lists, access… |
| check:contract | done | 9 major, 9 minor. PASS WITH FIXES. No blocker, but nine major issues should be fixed before the brief goes to the Diaex agent. What I checked: - **The OpenAPI file parses and is… |
| fix | done | I fixed all 31 findings: every blocker, every major and every minor. The YAML parses. It also passes an OpenAPI 3.1 validator (openapi-spec-validator 0.9.0, installed in a scratch venv). Before changing any claim about … |

