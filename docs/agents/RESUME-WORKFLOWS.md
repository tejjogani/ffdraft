# Resume the November 26 Pavé workflows

## Mac-first CAD trial and automation

The primary hands-on trial is on Apple silicon Mac. Windows x64 is a key market and has its own verification lane. The local designer can use the CAD builder, guide and manual edits without a Claude key. The [first-time guide](../first-time-cad.md) supplies the in-app steps. The [command roadmap](../plans/cad-command-api.md) lists Rhino, MatrixGold, Blender and CadQuery references, the public API contract and the next geometry milestones.

| Workstream | Merged or tested work | Where to continue |
| --- | --- | --- |
| Designer controls | The CAD guide covers carat entry, individual prong offsets, linked wire, imported mesh moves and weighted NURBS point editing. A Diaex fit stores supplier-listed carats alongside all three measurements. | Select a part in **Features** and edit its **Inspector**. Use a measured displacement, then verify reopen and undo. |
| Claude and Python tools | Scoped feature discovery, versioned atomic edits, history, evaluation and undo. Tests cover stale writes, idempotent requests, scope refusal, and persistence. | Use the [Python examples](../../packages/pave-python/README.md). Each next command needs a manual action, typed operation, script example and geometry readback. |
| Render setup and platforms | The local startup offer asks permission, downloads a pinned Blender build, verifies it and can resume setup after a cancelled attempt. Mac checks include WebKit editing, managed Blender 5.3.0 and a real 256 × 256 Cycles image. | Use the platform-specific workflows for ongoing compatibility. The built-in Mac package is for Apple silicon. Keep Windows ARM64 status distinct from x64. |
| Trace evaluation | Local edit history retains the undoable operations. Assistant changes also link to their run. Opted-in projects can export filtered numeric band and prong examples. | See the [evaluation format and CLI](../cad-evaluation-examples.md). Add operation-specific outcomes as the modeling vocabulary grows. |

For Rhino migration, use **Import model**, review the layers and choose **Include editable curves** when you need the exact NURBS. Supported closed B-reps and extrusions with complete saved render meshes retain native sources. Those sources travel in a `.pave` and can round-trip through eligible Rhino exports. Use **Edit mesh** for triangle-level shape changes. A mesh edit makes that part export as a mesh. Undo restores eligibility for native export. If a project used the earlier mesh-only importer, re-import the original `.3dm` to retain the native solid. [First-time CAD guide](../first-time-cad.md)

A single supported import can add up to 1,000 measured parts and editable curves. Exercise a selection above 500, undo once, redo once and reopen the portable archive. Ordinary edits keep the 500-operation limit. [Large import](../../apps/studio/e2e/large-model-import.ts)

For a native end-face edit, run the existing **Move end face** case. Move a qualifying cap in project millimetres and check its fixed opposite face and bore. The API regression reopens the edited `.pave` on a second server installation and undoes the change there. Arbitrary curved faces remain open. Use **Copy edge as curve** for an independent exact NURBS curve. The live SDK smoke moves a cap, copies an edge, verifies the curve and undoes both. [Studio edge picker](../../apps/studio/e2e/rhino-edge.ts) · [Live Python cap and edge edits](../../packages/pave-python/tests/rhino_native_smoke.py)

Rerun the existing readback cases before extending either operation. [Native end face](../../apps/server/src/rhino-caps.test.ts) · [Single edge](../../apps/server/src/rhino-edges.test.ts)

Use **Copy face borders** on an eligible retained face to create independent outer and inner NURBS curves together. Python exposes `rhino_face_borders` and `duplicate_rhino_face_border`. The project assistant uses `design_rhinoFaceBorders` followed by one guarded `design_apply` for the full set. Check the source solid and both curves in exported 3DM, then undo once. [Scoped assistant test](../../apps/server/src/assistant/project-guides.test.ts) The offline `cad:check-rhino` runner exercises edge and cap cases on local files and reports any skipped operations separately. [Face-border command](../../apps/server/src/rhino-face-borders.test.ts) · [Studio](../../apps/studio/e2e/rhino-face-borders.ts) · [Corpus runner](../plans/cad-command-api.md#local-rhino-regression-check)

For the next modeling work, handle seam-separated physical borders on periodic faces, with explicit tests for singular trims and geometry gaps. Give a sweep its own rail and section dependencies and verify orientation after editing either input. In the exchange lane, distinguish exact imported surfaces from faceted or omitted STEP output with independent readback. The [acceptance cases](../plans/cad-command-api.md#implementation-order) name the required measurements, and the [coverage ledger](../research/cad-feature-evidence.md) tracks the remaining Rhino and jewelry families.


**Start with the project menu.** Opening a piece should give the jeweler direct access to its Designs, CAD, Model, Renders and other areas. A reference saved in one area should be available where the jeweler needs it next. Design → CAD → Render describes a journey the assistant can carry out. The designer can enter the project anywhere.

The [founder's feedback and task board](BOARD.md) records the complaints, owners, dependencies and completion criteria. The [master plan](../PLAN.md) describes the product. The [agent worklog](STATUS.md) records 26 workflows, including the review and fix rounds. The [operating model](OPERATING-MODEL.md) explains the responsibilities of the build, research and integration lanes. The [journal index](journals.json) lists the old container's paths. The published worklog abbreviates long agent reports.

## How to run a workflow in Codex

From a checkout of `claude/busy-bardeen-o482lo`, give Codex this instruction, substituting the heading you want:

> Run **Studio and CAD viewer** from docs/agents/RESUME-WORKFLOWS.md. Start with the first missing behavior on the current branch. Reproduce it, implement it, exercise it through the normal user entry point, and record the result and next step in the worklog.

Each workflow below gives its starting point, job and acceptance checks. It can be carried out in one chat. The historical JavaScript under [workflows](workflows) supplies original briefs and reviewer questions. Its orchestration functions and absolute paths belonged to the old Claude environment.

Before changing a feature, fetch the integration branch and inspect any newly arrived implementation. Compare the current behavior with the acceptance checks. Reuse any recovered change that passes. The hashes below identify prior work mentioned by Claude. At the recovery baseline `05f5eaa`, the named local feature commits were unavailable. A green check on one of those hashes still needs a corresponding check on the branch being released.

## Studio and CAD viewer

**Owner and handoff.** Studio and viewer builders, then integration review. Board items A11 and A13. The historical menu was reported at `2ad4d35`. The last worklog names `d5a64e0` and `89411c9` for the final viewer changes. The remote integration tree at the recovery baseline still renders the stage stepper in [PiecePage](../../apps/studio/src/pages/piece/PiecePage.tsx).

1. **Project menu first.** Open a project from Home, including a project that already has CAD and renders. Replace the fixed stage navigation with a menu of area cards. Preserve direct links, project identity, folders, section contents and costs. Prove that a designer can enter Render directly, return to the same project, open CAD, and use a picture already on its board without re-uploading it. Include an empty project and browser Back.
2. **Working space.** Open CAD full-window with a back control and collapsible sidebar. Support starting from scratch and deleting a project with Undo. Give References and the assistant sensible positions after reload and on returning to CAD. Check both floating together at 1440 × 900 and the layout at 390 × 844. Capture the actual piece and controls in the same screenshot. The last reviewer still saw the two windows cover about half the ring.
3. **Assistant and job starts.** Keep a conversation begun on Home on Home. Use a small movable character, brief thinking feedback and readable Settings. At Take to CAD, a chat suggestion, Refine and the shoot card, offer “Check with me” and “Do it all” in one press before work starts. Show what each mode will do. Exercise both routes, including a full shot list and animations. The spec workflow owns approval for changes to an agreed spec.
4. **Navigation feel.** Measure first load, first orbit and a repeat edit. Rotate continuously over and underneath a ring. Exercise a mouse notch, trackpad drag, flick, catch followed by a slow adjustment, and an ease lasting over a second. Default momentum stopping to off so each movement under the fingers still takes effect. In the render viewfinder, scroll, immediately select a named angle, then wait for the pending wheel update. The selected angle must persist. Put “Record trackpad feel” in the View menu. A real Mac trace can tune optional momentum stopping later.
5. **Verify together.** Start with the [gesture and wheel tests](../../apps/studio/src/components/stage), [viewfinder](../../apps/studio/src/features/render/Viewfinder.tsx), and the existing [browser walkthroughs](../../apps/studio/e2e). Use the setup in each walkthrough's header. Exercise the actual entry points with a disposable local workspace. Record screenshots at both widths, timings, and the behavior after reload. Keep trackpad feel on physical hardware separate from synthetic coverage.

## Render realism against photographs

**Owner and handoff.** Render builder, then a photographer or independent reviewer ranking blinded candidates. Board item A12. The earlier session reported measuring 35 real photographs. Its inputs and target measurements were outside this checkout. The pushed [measurement note](../research/24-render-realism-measured.md) and [before-and-after sheets](../research/spikes/25-look-realism/README.md) preserve earlier experiments.

1. Recover the local photo benchmark if available, otherwise assemble a replacement locally. Label loose diamonds face-up and side-on, yellow- and rose-gold solitaires, a three-stone ring and studs. Match view, background and light, including black reflective acrylic, catalogue white, grey, warm and daylight.
2. Render a baseline through Pavé's own geometry, scene and Blender worker. The available script is `pnpm --filter @pave/render shots <absolute-output-directory> black-acrylic catalog-white editorial-warm`. The historical sheets also mention a later `look-shots` harness. Check available fixtures and extend them to the missing pieces and angles. Record the commit, engine, camera, lighting and quality for each take.
3. Compare each take with its photograph at full frame and at the stone, band and contact shadow. Measure facet size, bright/dark contrast, brightness, fire, metal highlight transitions and contact shadow. Start with the earlier bright stones and clean band as the visual reference. Isolate one change per comparison. Look closely for crushed-ice side views, chalk or grey speckle, flat gold, orange seats or a black crescent, and warm pieces appearing to float.
4. Blind the candidate names, place the real photograph beside them, and record the ranking and remaining visible differences. Check a second piece before keeping a change to a shared look. Preserve the measurements and repeatable settings in the [render skill](../../.claude/skills/jewelry-render/SKILL.md). Keep the comparison photographs local. A realism verdict requires the photographic comparison.

## Spec approvals, then Diaex access

**Owner and handoff.** Spec builder and verifier for A7, then access builder and verifier for A8b. The last log names `4ab6190` for spec and `ea5da53` for Diaex. The original [spec workflow](workflows/spec-truth.js) and [access workflow](workflows/diaex-connect.js) give the implementation entry points. Use the later board and founder decisions below when earlier instructions differ.

1. Reconcile the current spec, CAD measurement and job paths. Carry one versioned spec per piece. Record what changed, who changed it, and the source. Compare measurable CAD facts with agreed values and store sign-off against both versions. A 5 ct build against a 4 ct agreement must show “not met”.
2. Make an approval card show the exact change and the designer's whole message. Wording checks add advisory notes. Exercise unit changes, negations, corrections and number-only replies. Include the earlier 50-phrasing coverage where recoverable. An agreed amendment always requires the person's approval, including after switching to “Do it all”.
3. Replay the outstanding cases. Approve two independent changes from one message in both orders. Approve a whole-stone edit and check the stone's role stays as displayed. Change the spec while a card is open, then approve it. The server must use the version bound to the card and surface a stale conflict when appropriate. Verify the stored spec, CAD check, trace and what the user sees.
4. Check the Pavé access flow against the [partner contract](../integrations/diaex-partner-api.md) with the local test double. Verify that an approved organisation can sign in, revoked or removed credentials stop access, an open window reflects withdrawal, and known expiry wins during an outage. Exercise two organisations so background checks from one cannot starve the other's sign-in or explicit recheck. Keep tokens on the server. Record the observed result for each state.

## Integration and release

The last status update says three jobs restarted on November 26 at 12:40 p.m. Pacific. It records their starting states. Completion requires fresh evidence on a shared revision.

1. Combine verified studio and viewer changes first. Then integrate spec and access when their checks pass, and only the render changes supported by the photographic review. Exercise the boundaries after each merge, especially mode choice versus spec approval and render angle versus a pending gesture.
2. Run the frozen install, typecheck, build and the grouped suites in [the handover](../HANDOVER.md). Include the agent, ideation and UI packages and the CI lint check. Run `node scripts/install.mjs --check` from a clean installation. Distinguish previously reproduced failures from changes introduced by the merge.
3. Exercise a reference picture → spec → measured CAD → framed render, once manually and once with a scripted assistant. Record real-model and real-Blender results separately when available. Give the founder one revision, startup commands and a short list of unresolved issues.

## After the release

- **Starting from the jeweler's own CAD (A15).** The [34-step plan and acceptance cases](../plans/own-cad-and-routing.md) survived. Start with its integration prerequisite. Open a model at real size, show hero/top/side views and measured facts, and keep unknowns explicit. “More designs” produces photographic directions. Only the selected design amends the spec. A new version preserves the original. The plan calls for five private CAD files from different tools later in import verification.
- **Workshop feedback (A14).** After spec approval is in place, a confirmed change such as “we can cast this size” should update that organisation's manufacturing rule, with the previous rule and reason preserved.
- **Other lanes.** Rhino-class freeform modeling has a separate [eight-step build](../plans/freeform-cad.md) and [reviewed additions](../plans/freeform-cad-additions.md). The laptop's [research handoff](../inbox/fable-research/STATUS.md) records completed investigations and founder decisions. The [board](BOARD.md) tracks release trials, engine follow-ups, durable jobs and later product work.

## Worklog for the next run

Append a row for each completed step. Include the exact revision and worktree, the user action exercised, the command or artifact that proves the result, any remaining failure, and the next step. Preserve private inputs outside Git. Before handoff, distinguish commits present only on this machine from commits verified on the integration remote.

| Step | Revision and evidence | Result | Next |
|---|---|---|---|
| Recovery, Nov 26 | Integration `05f5eaa`, two Pavé checkouts, their refs and reflogs, local Git object search, GitHub refs and direct hash lookups | Worklogs and briefs recovered. The older Mac checkout contained the viewfinder filename fix already represented in `9d8acb2`. The reported feature branch tips were unavailable. | Begin A11 with the project landing page. |
| Release baseline | App tree identical at `5df472f` and `05f5eaa`. Install, typecheck, build and startup passed at `5df472f`. | Six assistant replays compared the recording date with today's date. All seven passed when only the context date matched the recording. CI lint reported 144 errors. Live AI and a configured Blender worker remain unverified. | Keep both failures visible during integration. |

### Project navigation implementation

1. Exercise the project landing page and each area with two separately created pieces in a disposable server. Check the route after switching, browser Back, reload, and a board edit.
2. Replace the stage row in PiecePage with a project breadcrumb and a project switcher. Extend ProjectSections so every existing area has a card. Reuse the registered piece URLs so bookmarks work.
3. Key the nested editor by piece. Keep board selection and assistant context tied to the current piece. Discard stale navigation and UI updates when a previously selected project finishes an asynchronous operation.
4. Run the two-project walkthrough and the studio typecheck, tests and production build. Record observed outcomes here.

### Founder walkthrough, November 26

The first local trial showed two separate problems. Designers needed project-scoped tools in one vertical stack, with the same project available across builders and an in-view switcher. The first stack still read like an accounting list. The founder wanted spacious, distinct cards, a concrete action per tool, and a specification that can be read without deciphering controls.

- Navigation landed in PR #7 (integration `91fe504`). Seven tool round trips, a cross-project board link, a delayed duplicate, drafts, history, the palette, reload and mobile switching were checked in a browser. Production build, workspace typecheck and 305 studio tests passed. Repository-wide lint remains red on existing files.
- The project menu now gives each tool its own card and keeps itemized spend folded. Design opens on a readable specification with a separate editor and direct access to the current CAD. Browser check: `apps/studio/e2e/project-cards.ts`.
- The board correction replaces “Start the design board” with actions on pictures, sketches and links. Pinterest and Google Images are the requested search destinations. Board layouts should say “Grid” and “Arrange by hand”, and appear when there is content to arrange.
- For a diamond swap, show the best candidate and alternatives, honor filters, recheck the chosen stone and fit the setting to its measured dimensions. Keep the chosen project and target stone explicit. Jewelry sold by a different supplier can be picked on Diaex and brought back by public stone ID. Separate a local fixture trial from live partner inventory verification.

**Later walkthrough correction.** The founder tried the large single-column cards and asked for two compact tool cards per row with short descriptions. Keep the vertical tool list inside workspaces. Projects should show each piece’s folder or Default folder and make project AI easy to find. From Home, the intended intake is full-screen: preserve the brief, logo and references, clarify unspecified chain, metal and stone choices, present directions, let the person select one, then build CAD and take feedback.

### Project assistant, visual handoff and local trial

The assistant carries the active project ID on each project turn. In the project chat, **AI focus** lets the designer follow the open tool or choose the whole project, Design, CAD or Render. A job uses its own stage. Home commissions and brainstorming limit which tools Claude can call. The shared identity and per-focus instructions live in `packages/agent/src/prompt/routing.ts`. Each model call records its focus, mode, instruction groups and prompt hash in the run trace. The initial focus stays stable for the duration of a run, including a run that creates a project.

`apps/server/src/assistant/turn.ts` sends the saved brief, specification, confirmed intake decisions and permitted references. The selected visual supplies shape and proportions. The engineering spec supplies dimensions and materials. An unresolved conflict goes back to the designer. `apps/server/src/assistant/project-guides.test.ts` checks a Design-to-CAD conversation, verifies the outgoing specification, and tests that a reference or direct piece lookup from another project cannot enter that conversation.

| Area | Integrated work | Manual trial or outstanding check |
| --- | --- | --- |
| Project organization | PRs #7, #10, #12, #16 and #23 cover project switching, folders, compact filled tool cards and a readable spec. | Use Back, switch projects within CAD, and return to each project’s tool menu. |
| References and Home | PRs #13, #18–20 and #24 cover Google/Pinterest links, moodboard imports, full-screen discovery and persistent confirmed measurements and selected artwork. | Open Home, attach a logo, confirm any missing chain and material choices, select a concept and reopen from Projects. |
| Editable CAD | PR #21 adds closed profiles and extrusion. PR #22 traces supported flat artwork into editable solids, including holes. | Draw a profile or trace a flat reference, verify the millimetre dimensions, then reopen the file. Organic multi-view reconstruction is a separate operation. |
| Sourcing | PRs #8, #9, #14 and #17 cover inventory candidates, filters, measured stone changes, setting refit, matching inspector carats and Undo. | Local supplier fixtures verify the swap. A live partner inventory search still requires a supported provider and access. |
| On model | PR #15 covers model selection, approvals and per-project shot preparation. | Completing a photograph requires implementing and registering an on-model provider, then verifying a generated shot. |
| Modeling and rendering research | The freeform CAD plan records the remaining Rhino operations, including associative sweeps and export readback. | Real trackpad input and blinded comparisons against jewelry photographs remain outstanding. |

Use disposable data directories for browser walks that create projects. The user's running Studio is for trying the product. Browser evidence from a scripted assistant verifies handoffs and tool calls. Real Claude design generation, finished on-model photographs and photographic realism require their respective live checks.
