# Lane B and C research: status

_Branch `claude/fable-research`. Items B1 and C1 from the board, run as one session from `docs/agents/LAPTOP-RESEARCH-PROMPT.md`, plus two things the founder added on the day. Updated 25 November 2026. **State: all research, plans, reviews and fixes are done and pushed; the founder's decisions are recorded below; five pull requests are open into the integration branch** (see "Pull requests")._

## Summary for the founder

### What was done

- **Ten research files** (`docs/research/13` to `22`), each with every outside claim labelled verified at source, search result only, or estimate. Topic 22 was added on your word: a full audit of Rhino's CAD features against the product.
- **Six plans** (`docs/plans/`), each reviewed by a fresh adversarial reviewer and then fixed. The reviews found 10 blockers and 80 majors between them; all were fixed in the plans, none was waved away. The reviews are kept in `docs/inbox/fable-research/reviews/`.
- **A renderer spike**: one ring rendered in Mitsuba, Cycles, LuxCore, a small tracer of our own in C and its WebGPU port. Scripts, timings and a side-by-side image are in `docs/research/spikes/15-renderer/`.
- **A bug sweep** of the integration branch, as you asked: four branches, 36 commits, 38 defects fixed (18 major), 118 tests added. Details and what still needs a decision: `BUGSWEEP.md` beside this file.

### What I found, in order of weight

1. **Security, before you install a build that stores your key.** A local install answers to any host name, so a web page using DNS rebinding can read and change the workspace and spend your Claude key. Guests could read every file and every live edit (fixed on `claude/bugsweep-server`). Any website open in your browser could create pieces and upload files (fixed there too). The first `.pave` version has three security faults and gives away the paid STEP export (fixes are steps 1 to 4 of the file plan).
2. **Three licence and terms points for counsel.** (a) The kernel already ships OpenCascade, which is LGPL 2.1; as the review reads it, that needs a notice in the app, the library's source or a written offer, and product terms that allow modifying that library. None exists today. (b) The Edge's licence agreement bars interfacing other software with it without written permission. (c) Shopify's and Xero's terms forbid using API data to train or improve AI. None of this is legal advice.
3. **Our own renderer is plausible but unproven.** A 340-line tracer of our own shows the same facets and fire as Cycles and Mitsuba on the same ring. But at equal CPU time Cycles was closer to the reference, our gold came out rose-coloured, and **nothing was measured on a GPU or on your Air**. The plan therefore starts with a one-hour measurement only you can run.
4. **"All of Rhino" is far.** The product has 16 of Rhino's 195 capabilities today, and 53 after the existing eight freeform steps, which are not built. The additions plan reaches 160 done, 30 in part and 5 left out, for an estimated 114 to 133 lane-weeks. Exact SubD-to-NURBS may never ship: the Rhino vendor does not offer it outside Rhino.
5. **Rivals shipped AI in 2026.** Rhino 9 has an assistant, RhinoArtisan 7 has an MCP server and live diamond prices, KeyShot added an AI scene agent on 12 November, and a free browser product (Diatech Make) calls itself AI-native jewelry CAD. Nobody ships the whole line from design board to CAD to renders without a Rhino licence.
6. **The paid exports are not protected today.** STEP and Rhino files are written in the browser after only a server "claim". No plan owns moving that to the server.
7. **A likely bug in today's renders.** Cycles counts reflections inside a stone as glossy bounces; the worker caps those at 12 to 16, so a diamond's light paths are cut short. A one-line fix (step 1 of the renderer plan).
8. **No image model keeps a jewelry design true.** On-model pictures must be built render-first: render the piece from CAD, let the model paint the person around it, paste the true render back, and check it in code.

### What I recommend we build first

**This week, before your first install (small, mostly done):**
1. Merge the four bug-sweep branches (lane A reviews them; each has a ready pull request description in `BUGSWEEP.md`).
2. Close the any-host gap: accounts plan step 1, on top of the server bug-sweep branch. It needs your answer to decision 1 below.
3. File plan steps 1 to 4 (about 3.5 days): the first-version fixes.
4. Renderer plan step 1: the Cycles bounce fix, with a before-and-after image.

**From you, this week (about two hours):**
5. Run the renderer measurement on your Air (research 15, section 6.6; three commands, allow an hour). It decides plan A or plan B.
6. Send counsel the three questions in finding 2, plus EU labelling duties for AI images (brand-models plan, section 4).

**Then, in parallel lanes:**
7. Freeform additions steps 9 to 13 (about nine weeks; they need none of steps 1 to 8): the parity ledger, the licence step, the tech sheet as a screen, weight-reduction cutters, hand control of stone layouts. Freeform steps 1 to 8 run beside them as B2.
8. Renderer: the GPU lab and the reference harness (useful under both plans), then the gate that decides the heavy build.
9. Integrations step 1: the item file as CSV and JSON. Small, useful by itself, no terms risk.
10. Brand models steps 1 and 2: the model card and a $10 go or no-go spike.

Hosted accounts, live connectors and on-model composites come after these.

### The decisions that are yours

Each plan's section 4 ends with its full list and my recommendation for each. The ones that block work soonest:

| # | Decision | Recommended |
|---|---|---|
| 1 | Which host names a local install answers to | Loopback plus an explicit allow-list setting; other machines on the LAN enter by a pasted link **Decided: loopback plus an explicit allow-list. Built on `claude/bugsweep-server` (`6c87baf`).** |
| 2 | Our own renderer (plan A) or Cycles standalone as a sidecar (plan B, native only, 8 to 12 weeks against 25 to 33) | Plan A, but only if your Air's measurement is green |
| 3 | A rented Mac and Windows GPU machine for the renderer build, about €150 to €170 a month | Yes: without them no builder can run the renderer on a real GPU |
| 4 | Are renders on the user's own GPU free or counted? | Free for good; paid means Blender-grade takes and render-node jobs |
| 5 | Exact geometry inside the `.pave` file. You asked for it; the plan recommends none, because it hands out the paid export | None in the file **Decided: none in the file.** |
| 6 | Learning from edits: a condition of the free plan, or opt-in per organisation (an earlier decision said opt-in) | Opt-in until hosting exists; a free-plan condition needs counsel first **Decided: not opt-in. Learning from traces is part of using the software. Open: whether a paid plan can switch it off.** |
| 7 | Publish the file's envelope spec, or keep it closed | Publish the envelope now, the design schema later **Reading taken from "a closed system, but open to anyone to join": closed for now. Not confirmed.** |
| 8 | Allow open surfaces as objects (reverses "bodies are closed" to "metal is closed") | Yes, as a separate surface class **Taken as yes: it is the CAD standard.** |
| 9 | SubD: castable-mesh grade first, exact NURBS conversion only if a spike passes; accept it may never ship | Yes **Decided: yes. Keep trying for exact conversion.** |
| 10 | The Edge: ask the vendor for permission, get counsel's view, drop it, or ship only a generic file the jeweler maps | Ask the vendor and counsel; ship the generic file meanwhile **Deferred: integrations come after CAD and sourcing.** |
| 11 | Data read back from Shopify or Xero never reaches a model, a trace or a saved file | Yes |
| 12 | Stop connectors after Shopify one-way until a customer pays for stock read-back | Yes **Consistent with his direction: integrations are later.** |
| 13 | On-model pictures: concept first, composite after a measured go | Concept first **Decided: concept first, composite on a go.** |
| 14 | May unreleased designs go to Higgsfield (it may train on content unless enterprise)? | Public designs only **Decided: Higgsfield is not used at all. No AI video; moving pictures come from renders.** |
| 15 | Up to $100 of measurement spend on your image keys, about two hours of labelling | Yes **Decided: yes, as a cap.** |
| 16 | Which legal entity registers the Google, Microsoft and Apple sign-in apps (also the `LICENSE` holder) | Yours to name; it blocks three steps and takes calendar time **Decided: the same organisation that runs the diamond marketplace. It has a D-U-N-S number and an Apple developer account already.** |
| 17 | Local limits on free renders and exports are honest-customer limits; hard limits only when hosted | Accept |
| 18 | Who casts for the first paying user (shrink scaling and the sprue stay off until answered) | Yours to say **Decided: the caster handles shrinkage. Shrink scaling and the sprue stay off.** |
| 19 | A trade-mark and file-extension search for `.pave`, done by a person. No agent could check it: the search rules forbid the word | Before any outside release **Decided: keep the name for now; it can change later.** |
| 20 | Diatech Make (Dubai) is a browser rival with a name close to the diamond marketplace's. Please confirm it is unrelated | — |

### What is not verified

- No timing on an Apple M2 or any GPU. Every laptop render time in these files is an estimate.
- Nothing was checked in a browser, and Blender was not installed. The bug-sweep branches passed their own targeted tests and per-package type checks; I re-ran a sample of each myself (61, 16, 80 and 191 tests, all passing). Nobody ran the full suite or the repo-wide type check, which ran out of memory on this machine. Integration must.
- Parts of research 14 (V-Ray, Corona, Redshift, Octane details) and the gem-rendering literature in research 15 are working knowledge, marked as estimates: the web-search budget ran out.
- Effort figures in every plan are estimates by the agents who wrote them. Nothing was built.
- Several vendor pages would not open (Intuit, parts of Xero, SAP, Lightspeed, JewelCAD). Those rows are marked.

## New on 25 November, afternoon: research on product-page renders, and the render skill

The founder asked for deep research on making the Blender render workflow deterministic and true to life for jewelry product pages, and on how animations are made, and for the render skill to be updated from it.

- **Report:** `docs/research/reports/Jewelry product page renders.md` (about 8,000 words, 24 prioritised changes with evidence). Notes from five researchers are in `docs/research/research_notes/Jewelry product page renders/`. Test scripts, logs and comparison images are in `docs/research/spikes/23-render-tests/`.
- **Measured in Blender 5.3.0 on a CPU (349 renders, one small scene; no GPU, no Mac):** a fixed seed with no time limit gives bit-identical pixels across runs and thread counts, with the denoiser on or off; a time limit breaks it; glossy bounces at 16 leave 17.7% of a diamond's pixels more than 10% too dark; an indirect clamp of 20 removed 39% of the stone's light in the test studio; AgX cuts yellow gold's colour strength by about a third against Khronos PBR Neutral; depth-of-field f-numbers do nothing in a scene built at 1 unit = 1 mm; a fixed seed flickers less than an animated one on static, denoised background.
- **The skill:** the updated `.claude/skills/jewelry-render/SKILL.md` is on `claude/skill-jewelry-render` (pull request 6). Every changed setting is marked measured, sourced or estimate. Its code blocks were run in Blender 5.3.0 and its ffmpeg lines on test frames before pushing; that run caught and fixed two mistakes (noted at the end of the report).
- **For lane A, from this research:** `packages/render` still sets glossy bounces below transmission in `quality.ts` (already requested); the same tests suggest checking the product's own render worker for an indirect clamp, the view transform used for white-background takes, and depth-of-field values typed as photographic f-numbers in a millimetre scene.

## Pull requests open into `claude/busy-bardeen-o482lo` (25 November, 11:50 Pacific)

For lane A to review and merge. Each branch has the integration head merged in and was re-checked after that merge.

| # | Branch | What | Checked after the merge |
|---|---|---|---|
| [1](https://github.com/tejjogani/ffdraft/pull/1) | `claude/bugsweep-macos-build` | **The studio does not build on a Mac.** `Viewfinder.tsx` sits beside `viewfinder.ts`; on a file system that ignores letter case the import finds the wrong file. The founder hit it at step 4 of his first install. The helper file is renamed, and a test now fails on any such pair. | Studio type check and build; the new test fails on the old names |
| [2](https://github.com/tejjogani/ffdraft/pull/2) | `claude/bugsweep-server` | Guest access, unstorable text, orphaned jobs, the request size cap, package revisions, boot recovery, and `PAVE_ALLOWED_HOSTS` added to lane A's own local guard | Server type check; 352 server tests outside the engines |
| [3](https://github.com/tejjogani/ffdraft/pull/3) | `claude/bugsweep-packages` | Stone pricing, CSV formulas, SVG, render progress, the installer | Production type check; 139 tests |
| [4](https://github.com/tejjogani/ffdraft/pull/4) | `claude/bugsweep-kernel` | Two export memory leaks, GLB import bounds, worker recovery, export names | Kernel and schema type checks; 248 tests |
| [5](https://github.com/tejjogani/ffdraft/pull/5) | `claude/bugsweep-studio` | Delete and selection, unreadable server answers, export downloads, the viewport error state, formatting | Studio type check and build; 309 studio and UI tests |

**What changed when the assistant build was merged into the integration branch, and what it means for the findings below:**
- Lane A added its own guard for a server without sign-in (`apps/server/src/http/local-guard.ts`): it refuses unknown host names and writes from other sites. So the two guards on the server bug-sweep branch were removed in its favour; the branch now only adds the founder's allow-list to it.
- Lane A moved Rhino and STEP writing to the server (`exportCounts` in `apps/studio/src/features/cad/export.ts`). So the finding "the paid exports are not protected today" is answered on the integration head, and the founder's wish to move them to the server is already met.
- Three bug-sweep branches conflicted with the merge (8 files) and one fix needed rework: the stone-price fix against the refactored cost estimate. All are resolved on the branches.

## Decisions the founder has taken (25 November, 09:47 Pacific)

Recorded from his reply in chat. Where his reply was short, the reading taken is stated, so he can correct it.

**Direction and priorities** (third reply, 10:53)
- The edge is the vertical stack: the CAD, the traces of how people design, source and export, and stone sourcing through the diamond marketplace. A closed system that anyone can join.
- **First:** get the CAD right, and sourcing stones through the marketplace. He expects to pitch the product to the marketplace's first 100 to 200 sign-ups as a replacement for Rhino. **For lane A:** this moves the sourcing screen with the partner API up, next to the freeform CAD work. The board lists it as "later, after Diaex v1".
- **Later:** an API that feeds Shopify, Etsy and others, and a one-stop shop with hosted sites and ERP. `integrations-hub.md` stays as written but is not near-term; its step 1 (the item file) is the only part cheap enough to do early.
- **Learning from traces is not opt-in.** It is part of downloading the software: "this is how we make the models better". This replaces the earlier opt-in decision in `05-platform.md`. `pave-file-format.md` section 4.6 is changed to match and lists what must be true before any trace leaves a machine: said up front from the first release; about the work, not the person; and never supplier messages, whole-screen pictures, pictures the user does not own, or data read back from systems that forbid AI use. Open: whether a paid plan can switch learning off.
- **Gaps this opens, for a plan nobody has written yet:** no trace upload exists (a local install sends nothing today, and `org_settings.allow_eval_use` defaults to off and was worded more narrowly); there is no plan for the trace pipeline itself (what is captured, where it goes, how long it is kept, how a business gets its data removed).

**Freeform CAD and Rhino parity** (`docs/plans/freeform-cad-additions.md`)
- Our own OpenCascade build: accepted.
- SubD: castable-mesh grade first; exact NURBS conversion stays conditional on its spike. On the chance that exact conversion never ships: "hopefully we can fix it". So the spike stays in, and public wording stays honest until it passes.
- Counsel on the OpenCascade licence duties: yes, instruct. The change to `LICENSE` and the product terms is approved in principle; counsel sets the wording. **For lane A:** step 10 of the additions plan (the notice, the licences screen, the source bundle or written offer, the replaceable engine file) can be scheduled.
- Casting: the caster handles shrinkage. The product generates the exports, learns from how casters use them, and adds shrink handling later. Shrink scaling and the sprue stay off, and the RFQ keeps its line telling the caster to apply their own shrinkage.
- Stop after step 21 and decide again: yes.
- Surfaces as objects: he asked what the standard is in CAD. The standard is that surfaces and solids are both objects (Rhino treats a solid as a closed set of surfaces; SolidWorks, Fusion, CATIA, NX and Creo keep surface bodies beside solid bodies and join or thicken them into solids). The plan's proposal matches that. **Taken as yes on that basis; he has since replied "yes".**

**Brand models and on-model pictures** (`docs/plans/brand-models-v2.md`)
- Concept pictures first; the composite track only on a go from the first spike.
- **No AI video, and no Higgsfield** (second reply, 10:02): "we don't need video via higgs field that's why we have blender for the renders of the 3d object. We are not using AI video". Moving pictures come from renders of the 3D object. The plan is changed to match: the video provider, the Higgsfield adapter, the generated "gentle move" clip and the video meter are removed; stills go to the Gemini and OpenAI APIs directly. What remains is the sparkle pass, which is a render of the true piece under a moving light on an accepted still. He confirmed it stays. This replaces his earlier answer about Higgsfield and unreleased designs.
- Body views are kept, with the Portrait and Figure shots.
- On-model scene renders count against the 5 free renders a month.
- Measurement spend: yes, as a cap. Up to $100 of image-API charges on his own keys, for testing only.

**The file** (`docs/plans/pave-file-format.md`)
- No exact geometry in the file.
- The paid exports move to the server. He sees the product as installed software first, usable on the web as well. **Request to lane A:** make the server the only writer of STEP and Rhino files (a server export path already exists as the fallback in `apps/studio/src/features/cad/export.ts`), so the allowance is checked where the file is made. On an installed copy the server is the app's own process on the user's machine, so this closes the browser bypass and is enforceable when hosted; on a machine the user owns it remains an honest-customer limit.
- The `.pave` name stays for now and can change later. The file plan already has readers identify a file by its manifest, not its extension, so a rename stays cheap.

**Accounts** (`docs/plans/accounts-and-developer-api.md`)
- Host names: loopback plus an explicit allow-list. **Built:** commit `6c87baf` on `claude/bugsweep-server` adds the `PAVE_ALLOWED_HOSTS` setting and refuses unknown host names on a local install; the expected-failure test now passes. The accounts plan's step 1 still adds the route-by-route guard on top.
- After copying a project online, the local copy stays the working copy.
- Apple sign-in at launch: yes. The organisation has a D-U-N-S number and already publishes an iPhone app, so the Apple developer account exists.
- The sign-in apps (Google, Microsoft, Apple) are registered by the same organisation that runs the diamond marketplace. "One unified account for diaex and this" means the same company registrations with the providers, confirmed by him. People keep separate logins in the two products, linked per organisation by OAuth, as the plan has it.
- Storage caps for online copies: 2 GB on Free and 100 GB on Pro are accepted as the starting numbers.

## The files

| Research | Plan from it | Review result, all fixed |
|---|---|---|
| `13-jewelry-cad-features.md`, `22-rhino-full-parity.md` | `freeform-cad-additions.md` (steps 9 to 40) | 1 blocker, 13 majors, 13 minors |
| `14-jewelry-rendering.md`, `15-own-renderer.md`, `18-low-end-machines.md` | `jewelry-renderer.md` | 1 blocker, 13 majors, 11 minors |
| `16-ai-models-on-model.md` | `brand-models-v2.md` | 1 blocker, 10 majors, 9 minors |
| `17-pave-file-format.md` | `pave-file-format.md` (18 steps) | 3 blockers, 15 majors, 8 minors |
| `19-erp-and-pos-apis.md`, `21-connectors-and-developer-api.md` | `integrations-hub.md` | 2 blockers, 15 majors, 11 minors |
| `20-accounts-and-identity.md`, `21-connectors-and-developer-api.md` | `accounts-and-developer-api.md` (23 steps) | 2 blockers, 14 majors, 10 minors |

Research files are in `docs/research/`, plans in `docs/plans/`, reviews in `docs/inbox/fable-research/reviews/`. No existing plan was edited; where a new plan changes an old one, it says so in its own text.

## What each research file found

- Research 17, the native file format: `docs/research/17-pave-file-format.md`. Keep the zip with a manifest as a strict profile; fix how v1 handles newer files; take the exact STEP copy out of the file; three save profiles (Working, Share, Clean copy).
- Research 21, connectors and developer access: `docs/research/21-connectors-and-developer-api.md`. One first-party connector interface and one sync engine, nothing bought; the ERP report's connector order holds, with one correction on The Edge (below).
- Research 13, the jewelry CAD feature set: `docs/research/13-jewelry-cad-features.md`. The market moved in 2026: Rhino 9 is on sale with an AI assistant; RhinoArtisan 7 ships an MCP server and live diamond prices; Drakon 2 has a copilot; one browser product (Diatech Make, Dubai) calls itself AI-native jewelry CAD and is free with an account. The freeform plan's gaps are in the jewelry and workshop layers: scoop and azure cutters, hand control inside automatic stone layouts, the tech sheet as a screen, more cuts and heads, matching bands, shrink scaling and a sprue, re-sizing foreign files, an own-parts library. SubD should become a named later step.
- Research 18, low-end machines: `docs/research/18-low-end-machines.md`. The Air is a fine CAD machine and a poor render machine: its GPU scores about 302 to 354 on Blender Open Data against 2,285 for an RTX 3060. A one-minute still is fine; a 5-second turntable is an estimated 1 to 7 hours locally, or roughly 15 to 55 cents on a rented GPU. 8 GB of memory is the real limit. Render.com has no GPU.
- Research 20, accounts and identity: `docs/research/20-accounts-and-identity.md`. Keep Better Auth (the only option that runs in-process, so the same code serves an offline laptop and hosted; no licence cost). Local installs get a profile, not a login. Connecting to hosted is a device link plus a one-time claim, with a signed entitlement lease of about two weeks.
- Research 19, ERP, POS and accounting APIs: `docs/research/19-erp-and-pos-apis.md`. Tally is the better first live target (XML on port 9000, JSON from release 7.0, and a local install can post to it directly; the port has no authentication). The Edge has no API. Shopify does not feed The Edge or Jewel360: both push to Shopify and take no new stock from it. Shopify's and Xero's terms forbid using API data to train or improve AI.
- Research 16, AI human models and on-model imagery: `docs/research/16-ai-models-on-model.md`. No image or video model keeps a jewelry design true, so the pipeline is render-first: render the CAD on a simple proxy, let the model paint the brand model around it, paste the true render back, then gate with checks. Default provider Gemini, fallback OpenAI. Higgsfield's help centre says it may train on user content unless enterprise, so unreleased designs should not go there by default. Video by API has shrunk: Veo 3.1 left the Gemini API on 22 Oct 2026 and OpenAI's video API closed on 24 Sep 2026. Estimated cost: $0.30 to $0.70 per accepted still. (The founder has since decided against AI video altogether.)
- Research 22, full Rhino parity: `docs/research/22-rhino-full-parity.md`. Rhino 8's command list has 1,078 names, grouped into 195 capabilities. The product has 16 today and 58 in part. Steps 1 to 8 of the freeform plan finish 37 more. After step 8, 142 of 195 (73%) are still open. Of those, 74 are cheap on today's engines, 55 are known algorithms and 13 need research or a new engine (SubD, QuadRemesh, Squish, BlendSrf, exact cage deformation). Three causes sit under most gaps: the plan's "bodies are closed" rule, the shipped OpenCascade build being a 353-class subset, and no SubD engine. The file proposes 15 further steps (9 to 23), about 65 to 90 lane-weeks by estimate.
- Research 14, rendering for jewelry: `docs/research/14-jewelry-rendering.md`. KeyShot's edge for jewelry is workflow, not physics (a gem material with an Abbe number, a one-click jewelry lighting preset, photon-mapped caustics; USD 1,299 a year). Its November 2026 release added an AI agent that sets up scenes from plain language. Only Cycles, Octane X, Redshift and KeyShot (beta) run on an Apple GPU. Standalone Cycles, LuxCore and pbrt-v4 are Apache-2.0; Mitsuba 3 is BSD-3-Clause with an extra clause. Measured optical data exists for pure gold, silver, copper, platinum, palladium and rhodium (CC0), but none was found for karat alloys.
- Research 15, our own renderer (the priority): `docs/research/15-own-renderer.md`, with the spike scripts, timings and a side-by-side image in `docs/research/spikes/15-renderer/`. Recommendation: our own contained path tracer as WebGPU compute kernels with a TypeScript host in the studio, the same kernels headless later, Open Image Denoise for denoising, Blender kept as a separate reference process. Five stages, 19 to 27 weeks for one graphics engineer by estimate, each with an image-distance gate. The spike: a 340-line tracer of our own and its 247-line WebGPU port show the same facet pattern and coloured flashes as Cycles and spectral Mitsuba on the same ring. The caveat: at similar CPU time Cycles was closer to the converged reference, and our gold came out slightly orange. Plan B is licence-clean: Cycles standalone is Apache-2.0, but native only. **No Mac or GPU timing was measured**: everything ran on a shared 2-core Linux CPU; the M2 figures are estimates, and section 6.6 has the commands to measure them.

## Requests and findings for lane A

**Request, time-sensitive:** saving `.pave` version 1 is already in the assistant build, and A3 gives the founder a commit to install. Please take steps 1 to 4 of `docs/plans/pave-file-format.md` (about 3.5 days, confined to `apps/server/src/pavefile/`, `runtime.ts`, `files/pave.ts` and `ReferencePanel.tsx`) into A3 before that commit, and step 5 before any build goes to anyone else. If that cannot happen, name the shipped commit so the plan's fallback for version 1 files in the wild (its section 3.8) can be built.

**A licence point to check for the product as it ships today:** the kernel already ships an OpenCascade WebAssembly build, and OpenCascade is LGPL 2.1 with an exception that covers header material only. The review of the freeform additions plan reads the licence as requiring product terms that permit modifying the library and reverse engineering to debug it (the root `LICENSE` forbids modification today), the library's source or a written offer, and a notice in the app (there is none). Counsel should confirm; this is not legal advice.

**The Edge's licence agreement** (updated 23 July 2026, opened at source by two agents) bars interfacing other software with it without written permission and bars passing "downloads" to third parties. Nothing named for The Edge should ship, and no customer should be asked for its in-program import template, until the vendor gives permission or counsel says a file imported through its own wizard is not "interfacing".

**The paid exports** were written in the browser after only a server "claim" at the commit this research read. The integration head now has the server make Rhino and STEP files, so this is answered.

Three items in the first `.pave` version on `claude/assistant-build` (details in research 17, section 2.3, rows 9 to 11):

1. The "saved here" organisation fingerprint is a fixed value that can be copied from any file of that organisation, so a crafted file can carry a forged rights attestation.
2. `thumbUrl` survives opening a file, so a stranger's file can make the studio fetch a URL of the sender's choosing.
3. `save.ts` does not enforce `PAVE_LIMITS`, so a long-lived piece can be saved into a file that will not open.

Two security gaps in the server, to fix before the founder installs a build that stores his key (research 20):

4. The local server has no Host or Origin check (`apps/server/src/app.ts`, around lines 95 to 128). A DNS-rebinding page or any local program can call it and spend the stored Claude key. The bug-sweep branch `claude/bugsweep-server` fixes the cross-site write half (commit `e813c79`). The Host half (DNS rebinding) is fixed there too (`6c87baf`), after the founder chose loopback plus an explicit allow-list.
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

## The bug sweep (product code, not on this branch)

You asked on 25 November for an agent team to look for bugs, obvious misses and missing tests, fix them in a separate working tree, and raise pull requests, and you chose the integration branch as the target. Because this is product code it is kept off this docs-only branch:

| Branch | Area | Result |
|---|---|---|
| `claude/bugsweep-server` | `apps/server` | 8 fixes, including the host allow-list the founder decided on; 11 tests |
| `claude/bugsweep-studio` | `apps/studio`, `packages/ui` | 14 defects fixed in 11 commits, 65 tests |
| `claude/bugsweep-packages` | production, render, match, canon, sourcing, installers | 7 fixes, 11 tests |
| `claude/bugsweep-kernel` | `packages/kernel`, `packages/schema` | 9 fixes (two export memory leaks), 31 tests |

Each branch is based on `claude/busy-bardeen-o482lo` at `cb7dcd0` and is meant to become one pull request into it. The nine open majors lane A carries into A4 were left alone. Findings, checks run, what needs a decision, and a pull request title and description for each branch are in `BUGSWEEP.md`. **Request to lane A:** these are extra `claude/bugsweep-*` branches outside the board; the founder asked for them directly. The pull requests are open: see "Pull requests" near the top.

## How this session ran

- It ran in a cloud workspace linked to the founder's laptop, not on macOS itself. That is why no Metal timing exists.
- Pushing was refused for most of the day, so the other session could not see this work until 11:45 Pacific on 25 November, when the founder asked for the push and the repository was authorised for the session. `claude/fable-research` and five `claude/bugsweep-*` branches are on GitHub now.
- The integration branch was merged in at `bd29afc` (status and board commits only).
- The board gives C1 its own branch and status file; this session followed the newer laptop prompt and kept B1 and C1 together here.

## Things in the repo that look out of date

- `docs/agents/BOARD.md` gives C1 its own branch (`claude/integrations-research`) and status file (`docs/inbox/integrations/STATUS.md`). The newer laptop prompt puts B1 and C1 in one session on `claude/fable-research` with this status file. This session follows the laptop prompt.
- `docs/HANDOVER.md` section 1 still describes the Design stage as parametric directions in its first bullet, and as an image pin board further down (25 Nov). `docs/PLAN.md` matches the pin board. This session treats the pin board as current.
- `docs/HANDOVER.md` section 2 lists research `01`–`11` and says `freeform-cad.md` and `12-rhino-parity.md` are "when written". Both exist.

## All questions raised by the research, by topic

These are the questions as each research file raised them. Where a plan's reviewed list of founder decisions (its section 4) differs, the plan is the later word. The numbers are labels only.

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
