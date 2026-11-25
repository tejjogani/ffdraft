# Lane B and C research: status

_Branch `claude/fable-research`. Items B1 and C1 from the board, run as one session from `docs/agents/LAPTOP-RESEARCH-PROMPT.md`. Updated 25 November 2026._

## Summary for the founder

Not written yet. It lands here when the plans have been reviewed.

## Done

- Working copy set up on `claude/fable-research`, based on `claude/busy-bardeen-o482lo` at `cb7dcd0`.
- Core docs read: `docs/PLAN.md`, `docs/HANDOVER.md`, `docs/agents/OPERATING-MODEL.md`, `docs/agents/BOARD.md`, `docs/agents/README.md`.

- Research 17, the native file format: `docs/research/17-pave-file-format.md`. Keep the zip with a manifest as a strict profile; fix how v1 handles newer files; take the exact STEP copy out of the file; three save profiles (Working, Share, Clean copy).
- Research 21, connectors and developer access: `docs/research/21-connectors-and-developer-api.md`. One first-party connector interface and one sync engine, nothing bought; the ERP report's connector order holds, with one correction on The Edge (below).
- Research 13, the jewelry CAD feature set: `docs/research/13-jewelry-cad-features.md`. The market moved in 2026: Rhino 9 is on sale with an AI assistant; RhinoArtisan 7 ships an MCP server and live diamond prices; Drakon 2 has a copilot; one browser product (Diatech Make, Dubai) calls itself AI-native jewelry CAD and is free with an account. The freeform plan's gaps are in the jewelry and workshop layers: scoop and azure cutters, hand control inside automatic stone layouts, the tech sheet as a screen, more cuts and heads, matching bands, shrink scaling and a sprue, re-sizing foreign files, an own-parts library. SubD should become a named later step.
- Research 18, low-end machines: `docs/research/18-low-end-machines.md`. The Air is a fine CAD machine and a poor render machine: its GPU scores about 302 to 354 on Blender Open Data against 2,285 for an RTX 3060. A one-minute still is fine; a 5-second turntable is an estimated 1 to 7 hours locally, or roughly 15 to 55 cents on a rented GPU. 8 GB of memory is the real limit. Render.com has no GPU.
- Research 20, accounts and identity: `docs/research/20-accounts-and-identity.md`. Keep Better Auth (the only option that runs in-process, so the same code serves an offline laptop and hosted; no licence cost). Local installs get a profile, not a login. Connecting to hosted is a device link plus a one-time claim, with a signed entitlement lease of about two weeks.
- Research 19, ERP, POS and accounting APIs: `docs/research/19-erp-and-pos-apis.md`. Tally is the better first live target (XML on port 9000, JSON from release 7.0, and a local install can post to it directly; the port has no authentication). The Edge has no API. Shopify does not feed The Edge or Jewel360: both push to Shopify and take no new stock from it. Shopify's and Xero's terms forbid using API data to train or improve AI.
- Research 16, AI human models and on-model imagery: `docs/research/16-ai-models-on-model.md`. No image or video model keeps a jewelry design true, so the pipeline is render-first: render the CAD on a simple proxy, let the model paint the brand model around it, paste the true render back, then gate with checks. Default provider Gemini, fallback OpenAI. Higgsfield's help centre says it may train on user content unless enterprise, so unreleased designs should not go there by default. Video by API has shrunk: Veo 3.1 left the Gemini API on 22 Oct 2026 and OpenAI's video API closed on 24 Sep 2026. Estimated cost: $0.30 to $0.70 per accepted still, $1.50 to $4 per accepted 5-second clip.
- Research 22, full Rhino parity: `docs/research/22-rhino-full-parity.md`. Rhino 8's command list has 1,078 names, grouped into 195 capabilities. The product has 16 today and 58 in part. Steps 1 to 8 of the freeform plan finish 37 more. After step 8, 142 of 195 (73%) are still open. Of those, 74 are cheap on today's engines, 55 are known algorithms and 13 need research or a new engine (SubD, QuadRemesh, Squish, BlendSrf, exact cage deformation). Three causes sit under most gaps: the plan's "bodies are closed" rule, the shipped OpenCascade build being a 353-class subset, and no SubD engine. The file proposes 15 further steps (9 to 23), about 65 to 90 lane-weeks by estimate.
- Research 14, rendering for jewelry: `docs/research/14-jewelry-rendering.md`. KeyShot's edge for jewelry is workflow, not physics (a gem material with an Abbe number, a one-click jewelry lighting preset, photon-mapped caustics; USD 1,299 a year). Its November 2026 release added an AI agent that sets up scenes from plain language. Only Cycles, Octane X, Redshift and KeyShot (beta) run on an Apple GPU. Standalone Cycles, LuxCore and pbrt-v4 are Apache-2.0; Mitsuba 3 is BSD-3-Clause with an extra clause. Measured optical data exists for pure gold, silver, copper, platinum, palladium and rhodium (CC0), but none was found for karat alloys.
- Research 15, our own renderer (the priority): `docs/research/15-own-renderer.md`, with the spike scripts, timings and a side-by-side image in `docs/research/spikes/15-renderer/`. Recommendation: our own contained path tracer as WebGPU compute kernels with a TypeScript host in the studio, the same kernels headless later, Open Image Denoise for denoising, Blender kept as a separate reference process. Five stages, 19 to 27 weeks for one graphics engineer by estimate, each with an image-distance gate. The spike: a 340-line tracer of our own and its 247-line WebGPU port show the same facet pattern and coloured flashes as Cycles and spectral Mitsuba on the same ring. The caveat: at similar CPU time Cycles was closer to the converged reference, and our gold came out slightly orange. Plan B is licence-clean: Cycles standalone is Apache-2.0, but native only. **No Mac or GPU timing was measured**: everything ran on a shared 2-core Linux CPU; the M2 figures are estimates, and section 6.6 has the commands to measure them.

## Requests and findings for lane A (from the research so far)

**Request, time-sensitive:** saving `.pave` version 1 is already in the assistant build, and A3 gives the founder a commit to install. Please take steps 1 to 4 of `docs/plans/pave-file-format.md` (about 3.5 days, confined to `apps/server/src/pavefile/`, `runtime.ts`, `files/pave.ts` and `ReferencePanel.tsx`) into A3 before that commit, and step 5 before any build goes to anyone else. If that cannot happen, name the shipped commit so the plan's fallback for version 1 files in the wild (its section 3.8) can be built.

**A licence point to check for the product as it ships today:** the kernel already ships an OpenCascade WebAssembly build, and OpenCascade is LGPL 2.1 with an exception that covers header material only. The review of the freeform additions plan reads the licence as requiring product terms that permit modifying the library and reverse engineering to debug it (the root `LICENSE` forbids modification today), the library's source or a written offer, and a notice in the app (there is none). Counsel should confirm; this is not legal advice.

**The Edge's licence agreement** (updated 23 July 2026, opened at source by two agents) bars interfacing other software with it without written permission and bars passing "downloads" to third parties. Nothing named for The Edge should ship, and no customer should be asked for its in-program import template, until the vendor gives permission or counsel says a file imported through its own wizard is not "interfacing".

**The paid exports are not protected today:** STEP and Rhino files are written in the browser after only a server "claim" (`apps/studio/src/features/cad/export.ts`), so the allowance can be skipped, even when hosted. Moving that writing to the server is not owned by any plan yet.

Three items in the first `.pave` version on `claude/assistant-build` (details in research 17, section 2.3, rows 9 to 11):

1. The "saved here" organisation fingerprint is a fixed value that can be copied from any file of that organisation, so a crafted file can carry a forged rights attestation.
2. `thumbUrl` survives opening a file, so a stranger's file can make the studio fetch a URL of the sender's choosing.
3. `save.ts` does not enforce `PAVE_LIMITS`, so a long-lived piece can be saved into a file that will not open.

Two security gaps in the server, to fix before the founder installs a build that stores his key (research 20):

4. The local server has no Host or Origin check (`apps/server/src/app.ts`, around lines 95 to 128). A DNS-rebinding page or any local program can call it and spend the stored Claude key. The bug-sweep branch `claude/bugsweep-server` fixes the cross-site write half (commit `e813c79`). The Host half (DNS rebinding) is still open and recorded there as an expected failure; it needs a decision on which hosts to allow.
5. Accounts mode accepts unverified emails, and the auth library links a social sign-in to an existing account by email. That allows a pre-registration takeover once Google or Microsoft sign-in is switched on. Also, one auth secret both signs sessions and derives the key that seals customers' AI keys.

A render setting that looks wrong (research 14):

6. Cycles counts each internal reflection inside a stone as a glossy bounce, not a transmission bounce. `quality.ts` sets glossy 12/16 against transmission 24/32, so a stone's light path is cut at 12 to 16 bounces. A small calculation on an ideal round brilliant shows about 4% of the light is still inside a diamond after 16 internal hits. Suggested: glossy = transmission = total (16 draft, 32 final). The browser gem shader's 6 bounces leave about 15% to its fallback.

7. Stone nodes hold `sourcing` (supplier, SKU, price, certificate) inside the design document (`packages/schema/src/design/nodes.ts`). So the design and every history op in a saved file carry prices. The file plan redacts them in Share and Clean copies.

Also: `docs/pave-file.md` says adding an entry or a field is not a breaking change, but the reader refuses unknown entries, rejects new enum values and checks names before the version. A newer file gets the wrong error instead of "update Pavé". `geometry/exact.step` inside the file hands the paid STEP export to anyone who unzips it, and open never reads it.

Corrections to earlier research:

- The Edge's "Item Data Import" only updates existing items. New items come in through "Receive Invoice, Import Invoice", whose blank template is downloadable only inside the program. The Edge connector is therefore two files; the create file needs one customer's template.
- `04-ideation-models.md` part B is stale on video models and on FLUX (now FLUX 3). The image-provider code's location is stated two ways (`apps/server/src/providers/image` and `packages/ideation`); neither exists. The assistant branch's schema already has `fidelity: 'concept' | 'composite'` while `render-and-models.md` cuts composite.
- `10-market.md` line 90 and `08-channels.md` line 95 treat Shopify as a route into The Edge and Jewel360. It is not: both systems only push to Shopify.
- The server uses PGlite (embedded Postgres), not SQLite. Queues are ordinary tables in both local and hosted modes.
- Etsy now lists webhook events for commercial and personal apps (`08-channels.md` flagged this as a contradiction).
- `01-cad.md` says STEP AP214; `step.ts` writes AP242.
- RhinoGold is discontinued; RhinoArtisan is a separate product from another company, not its new name. MatrixGold is at 4.0, Rhino at 9, 3Design at V13.
- Research 12 and `freeform-cad.md` treat Make2D as absent, and research 12 lists ShrinkWrap as an existing tool. Neither matches the code: `packages/production/src/drawing/` already draws hidden-line sheets, and level-set re-surfacing runs in `mesh/resurface.ts`. The assistant branch's README says MCP is "Planned, not built".
- `freeform-cad.md` lists Make2D and shrinkage compensation as cut or later, while `production/drawing` and `shrinkagePct` already exist.
- `workers/render/LICENSE` is a notice with a link, not the GPL text. The full text should be added before the worker is distributed.
- Mitsuba 3.9.1 has no dispersion, even in its spectral variants (the spike wrote its own dispersive material).
- `03-rendering.md` on three-gpu-pathtracer: its README today does not list dispersion and accepts only the two standard three.js materials, so the product's gem shader cannot run in it.
- `03-rendering.md` says Open Image Denoise runs on the CPU; it has run on the GPU since Blender 4.1. A comment in the render worker's `devices.py` about Metal on Intel Macs is wrong since Blender 4.3.
- `docs/ARCHITECTURE.md` (lines 177 to 182) still describes "Continue with Diaex" as a sign-in through OpenID. The contract links an organisation by plain OAuth. The `guest` role can currently call no command at all.
- The light-machine work exists only on `claude/assistant-build`. Its `e2e/light.ts` always uses a software renderer, so it cannot measure a real machine. Nothing budgets memory across the browser tab, the WASM kernels, the server pool and Blender; the browser kernel worker is never recycled.

## Now

Ten research subagents, one per topic, one file each (topic 22 was added on the founder's word, 25 Nov: "ensure our Notion like beauty software has all the CAD features of rhino too"):

| File | Topic | State |
|---|---|---|
| `docs/research/13-jewelry-cad-features.md` | Full jewelry CAD feature set | Done; plan `docs/plans/freeform-cad-additions.md` reviewed (1 blocker, 13 majors, 13 minors) and fixed |
| `docs/research/14-jewelry-rendering.md` | Rendering state of the art for jewelry | Done (some engine rows are working knowledge, marked [E]: the web-search budget ran out) |
| `docs/research/15-own-renderer.md` | Our own renderer (priority) | Done, with spikes in five engines; plan `docs/plans/jewelry-renderer.md` reviewed (1 blocker, 13 majors, 11 minors) and fixed |
| `docs/research/16-ai-models-on-model.md` | AI human models, on-model imagery | Done; plan `docs/plans/brand-models-v2.md` reviewed (1 blocker, 10 majors, 9 minors) and fixed |
| `docs/research/17-pave-file-format.md` | The native file format | Done; plan `docs/plans/pave-file-format.md` reviewed (3 blockers, 15 majors, 8 minors) and fixed |
| `docs/research/18-low-end-machines.md` | Low-end machines | Done |
| `docs/research/19-erp-and-pos-apis.md` | ERP, POS and accounting APIs | Done; plan `docs/plans/integrations-hub.md` reviewed (2 blockers, 15 majors, 11 minors) and fixed |
| `docs/research/20-accounts-and-identity.md` | Accounts and identity | Done; plan `docs/plans/accounts-and-developer-api.md` reviewed (2 blockers, 14 majors, 10 minors) and fixed |
| `docs/research/21-connectors-and-developer-api.md` | Connectors and developer API | Done; both plans reviewed and fixed |
| `docs/research/22-rhino-full-parity.md` | Every Rhino 8 CAD capability (and Rhino 9's additions) against the plan and the product | Done; plan `docs/plans/freeform-cad-additions.md` reviewed (1 blocker, 13 majors, 13 minors) and fixed |

## Next

1. Six plans: `jewelry-renderer.md`, `brand-models-v2.md`, `pave-file-format.md`, `freeform-cad-additions.md` (from topics 13 and 22: the steps to full Rhino parity), `integrations-hub.md`, `accounts-and-developer-api.md` (all in `docs/plans/`).
2. One adversarial review per plan by a fresh subagent, then fixes.
3. The summary at the top of this file.

## A second job from the founder: a bug-sweep team (not on this branch)

The founder also asked (25 Nov) for an agent team to look for bugs, obvious misses and missing tests, fix them in a separate working tree, and raise pull requests. He chose the integration branch as the target. This is product code, so it is kept off this docs-only branch:

| Branch | Area | State |
|---|---|---|
| `claude/bugsweep-server` | `apps/server` | Done: 7 fixes, 1 open major (any Host name is answered), 8 tests; see `BUGSWEEP.md` |
| `claude/bugsweep-studio` | `apps/studio`, `packages/ui` | Done: 14 defects fixed in 11 commits, 65 tests; see `BUGSWEEP.md` |
| `claude/bugsweep-packages` | production, render, match, canon, sourcing, installers | Done: 7 fixes, 11 tests; see `BUGSWEEP.md` |
| `claude/bugsweep-kernel` | `packages/kernel`, `packages/schema` | Done: 9 fixes (two export memory leaks), 31 tests; see `BUGSWEEP.md` |

Each branch is based on `claude/busy-bardeen-o482lo` at `cb7dcd0` and becomes one pull request into it. The nine open majors lane A carries into A4 are left alone. **Request to lane A:** these are extra `claude/bugsweep-*` branches outside the board; the founder asked for them directly.

## Notes on how this session runs

- This session runs in a cloud workspace linked to the founder's laptop, not on macOS itself. Renderer spikes run on Linux CPU (2 cores). Apple M2 and Metal timings are therefore taken from sources or estimated, and labelled so. A real M2 run is still to do.
- Pushing from this workspace is not authorised yet. Commits are local until the founder authorises the repository for the session, or pushes a bundle from the laptop.

## Things in the repo that look out of date

- `docs/agents/BOARD.md` gives C1 its own branch (`claude/integrations-research`) and status file (`docs/inbox/integrations/STATUS.md`). The newer laptop prompt puts B1 and C1 in one session on `claude/fable-research` with this status file. This session follows the laptop prompt.
- `docs/HANDOVER.md` section 1 still describes the Design stage as parametric directions in its first bullet, and as an image pin board further down (25 Nov). `docs/PLAN.md` matches the pin board. This session treats the pin board as current.
- `docs/HANDOVER.md` section 2 lists research `01`–`11` and says `freeform-cad.md` and `12-rhino-parity.md` are "when written". Both exist.

## Questions for the founder

From research 17 (the file):
1. Open or closed spec? Recommended: publish the envelope now (container, manifest, thumbnail, mesh, provenance) and the design schema once freeform settles.
2. Any exact geometry inside the file? Recommended: none. The design is the truth; a display mesh rides along.
3. What history does a shared file keep by default?
4. Is learning from edits a condition of the free plan, or opt-in per organisation? `05-platform.md` decided opt-in; the free-file model assumes it. The two conflict.
5. The company's legal name and domain, for the MIME type and the macOS type identifier.

From research 21 (connectors):
6. India first (Tally) or US first (The Edge) for the second connector?
7. Can a customer on The Edge send the blank "Receive Invoice" import template?
8. Add a stock-unit record for tagged one-of-a-kind pieces? It changes the publishing plan's "variants are never stored" rule.
9. Is a small hosted webhook relay acceptable before full hosting, and who runs it?
10. Fold `channels` and `sourcing` into one connector package now, or keep them apart?

From research 16 (on-model imagery):
30. Approve a $20 to $30 measurement spike on your keys before the fidelity thresholds are fixed?
31. May unreleased designs be sent to Higgsfield, given its training clause?
32. Add a Black Forest Labs key for true mask inpainting? Open a Google Cloud project for Veo and Google's output indemnity, or stay on the Gemini key?
33. Ship "composite" (true render pasted back) in the first release, or concept images with a fidelity gate first?

From research 19 (ERP and POS):
26. Which Tally release and jewellery package does the pilot workshop run?
27. Do you accept a rule that data read back from Shopify or Xero never feeds model improvement? Counsel should read those clauses.
28. Is stock and order read-back wanted before a customer pays for it?
29. Should "invoice export to QuickBooks/Xero" in `10-market.md` be dropped, given "never build the books"?

From research 13 (CAD features):
11. Who is the first paying user: a custom jeweler who sends files to a bureau, or a manufacturer casting in-house? It decides whether shrink scaling and a sprue belong in the first release.
12. Is an engagement ring with its matching band one design with two rings, or two linked pieces?
13. Does the product answer RhinoArtisan's live diamond pricing and MCP server at launch?
14. Is SubD worth a later multi-week step, or is "import a sculpt and make it castable" enough for year one?
15. A browser rival is called Diatech Make (Dubai). The name is close to the diamond marketplace's. Please confirm it is unrelated.

From research 20 (accounts):
21. Is local-only use account-free for good, or will a free hosted account be needed to unlock the monthly free renders and exports?
22. Local allowances cannot be enforced on a machine the user owns. Accept them as honest-customer limits, or require the network for paid exports?
23. Offline lease: 14 or 30 days?
24. Which legal entity registers the Google, Microsoft and Apple sign-in apps? (Same as the open `LICENSE` holder question.)
25. Which roles cost a seat?

From research 22 (full Rhino parity):
34. Is the target Rhino 8 as a frozen baseline with Rhino 9 tracked (recommended), or Rhino 9 outright?
35. Reverse the plan's "bodies are closed" rule to allow open surfaces as objects? About two dozen capabilities depend on it.
36. Build SubD, and to which grade: castable mesh only, or exact NURBS too?
37. Accept our own OpenCascade build (a bigger download and a build pipeline)?
38. Grasshopper: a graph view plus formulas (recommended), or a full canvas?
39. Confirm the leave-out list: digitisers, marine and sun tools, legacy and proprietary formats, DWG, and Rhino's binary plug-ins.

From research 14 (rendering):
40. What wait is acceptable for a 2K still on the laptop: one minute or ten? It decides whether dispersion is on by default.
41. Can real alloy swatches, including rhodium-plated white gold, be measured with a spectrophotometer? No published data for karat alloys was found.
42. Does moissanite's facet doubling matter? Birefringence is otherwise left out.
43. Meter paid renders by time, by image or by samples?

From research 15 (our own renderer):
44. Plan A: our own engine (more reach, more risk), or the Cycles sidecar (less risk, native only, no rendering in the browser)?
45. Does a render on the user's own GPU count against the paid allowance, and how is it labelled next to a Blender take?
46. Who judges "photoreal enough"? Proposed: a blind comparison by working jewelers in stage 2.
47. Should Blender ever be bundled with the product? That needs counsel.
48. Please run the spike on your Air (section 6.6 of research 15): it gives the one number nobody could measure here.

From research 18 (machines):
16. Which Air exactly (13 or 15 inch, 8 or 16 GB, 8 or 10 GPU cores, macOS version)? Is 8 GB a supported target?
17. Where do animations render for a free user on an Air: hours locally, or a rented GPU that the product pays for or passes on?
18. May designs leave the laptop for rented-GPU jobs, with consent per job or a setting?
19. Is an 8 GB Intel Windows laptop a launch target? It has no usable local Cycles, so a server path or our own renderer must exist first.
20. Is a one-minute 2K still at 96 samples acceptable as the default render? Is iPad in scope?
