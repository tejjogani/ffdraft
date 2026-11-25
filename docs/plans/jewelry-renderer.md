# Jewelry renderer

25 November 2026. The founder's priority: a renderer of our own, "inspired by Blender's Cycles but contained to what jewelry needs", so Pavé makes photoreal stills and animations on a machine with no Blender. It rests on research [15](../research/15-own-renderer.md) (options, licences, spikes), [14](../research/14-jewelry-rendering.md) (the physics) and [18](../research/18-low-end-machines.md) (the fanless 8 GB Air, server costs). It adopts research 15's path, a contained path tracer written as WebGPU compute kernels, **only behind a measurement gate**, because the spike never ran on a GPU. Labels: `[V]` verified at source by the research, or by me where it says "today"; `[V run]` measured in the spike on a 2-core Linux CPU with no GPU; `[E]` estimate. Code paths are in the assistant build (`/home/claude/ref/assistant-build`).

- **Replaces** in `render-and-models.md`: §1 item 7 on machines with WebGPU (no Blender no longer means Preview only); the rule in §2 and §4.2 that `metrics.py` is the only metrics implementation; the scope cut "Browser animation export". It supersedes research 03 §6 ("do not write a path tracer").
- **Extends** `deploy-and-durable-jobs.md`: a third engine value in `work.requires`; hosted stills can render on the person's own GPU with no render node; what nodes are then for (§4.7); a heartbeat for takes a window renders.
- **Leaves:** `ResolvedScene` v2, the looks, the viewfinder; the Blender worker as a separate GPL program; the deploy plan's work model, node protocol, chunked Cycles stills and device choice.

## 1. Experience

The Render stage keeps its shot list, viewfinder, look cards, Motion and Size controls and takes strip. What changes is what happens with no Blender on the machine.

1. **The viewfinder develops.** Frame a shot. While the camera moves you see today's live preview. Half a second after it rests, the same view sharpens into a true render: real reflections between prongs, real light inside the stones. It cleans up for a few seconds and stops. Touch anything and the live preview is back at once. It is not a take and is never counted.
2. **Render starts at once.** Press Render (`mod+enter`). The tile shows the picture itself developing, not a ring: soft within a second or two, clean when done, with a quiet "about 40 s". Nothing was installed; the work runs on this computer's graphics chip.
3. **Draft, Standard, Final:** the same three choices as today. Times are `[E]` until §5 sets them.

   | | What it is | Size | Time on the Air `[E]` |
   |---|---|---|---|
   | **Draft** | A quick true-light picture to judge angle, light and framing; no fire in the stones. Never counted | up to 1024 px | 10–20 s |
   | **Standard** | The default take, with fire | the shot's size, up to 2048 px | 1–3 min |
   | **Final** | The clean one for a client or a listing; later with light spots on the ground | up to 2048 px on an 8 GB machine | minutes; the estimate is shown first |

   Whether Standard and Final count against the allowance is decision 3.

4. **Two renderers, one strip.** A take from our renderer sits beside a Blender take of the same shot. Each tile has one caption: "Final · Pavé Render · 1 min 10 s" or "Final · Blender · 6 min" (the name is decision 2). The WebGL fallback stays "Preview". Compare (`c`) wipes between any two takes of a shot. No samples, bounces or device names on the tile; the device is in the take's details.
5. **Progress, pause, a calm laptop.** A take this window renders can be paused and resumed from its tile; Cancel stays. Editing stays smooth: the renderer works in short slices and gives way the moment you touch the model. If the machine warms and slows, the estimate says so in one line. If the graphics chip resets, the take carries on. Reopen a closed window within a few minutes and it carries on; later, Retry picks up where it stopped.
6. **The engine chip** reads "Renders on this computer", "Blender 5.3" or "Preview only". Its dialog, renamed "Rendering", offers Automatic, This computer or Blender.
7. **When it cannot run:** one quiet line with the reason and the way out: "Photoreal rendering needs Chrome, Edge or a newer Safari on this Mac", or "Heart and cabochon stones render with Blender for now". Preview still works.
8. **Animations** play live as today. Rendering one shows frames arriving ("frame 31 of 150 · about 22 min") and keeps finished frames if interrupted. The time is shown first; once hosting exists, a render machine is offered.

**The AI render job** keeps its shape: the cinematographer looks at the piece, asks what the images are for, which formats and which animations, then places cameras and checks framing before render time is spent. It works in Drafts (quick, uncounted, true light, so its critique is worth more than on a Preview), re-renders a weak shot at most twice, then renders the set at the quality asked. It says the time first ("four shots, about 5 minutes of this computer's time") and asks before spending the last free render. It needs a Pavé window open, and says so. The job panel's Pause pauses the take in progress; a manual change to a shot pauses the job.

## 2. Structure

**One scene, every reader.** `resolveScene()` (`packages/render/src/resolve.ts`) already compiles a shot and the kernel's evaluation into `ResolvedScene` v2 (`types.ts`). The WebGL viewport (`@pave/render/three`), the Blender worker (`job.json` plus a GLB, separate process), our renderer and, later, a node all read that one object, so framing, lights, ground and materials cannot drift apart. Its shape does not change.

| Place | What is new |
|---|---|
| `packages/kernel/src/gems/planes.ts` | Plane lists per cut from `GemUnit.facets` (one plane per facet, unit space), a convexity flag, and a mesh-fallback flag for cabochon and heart. Stones of a cut share one list; each stone's `matrix` places it |
| `packages/render/src/trace/` (export `@pave/render/trace`; no DOM, no three.js) | `kernels/*.wgsl`; `scene.ts` (packs `ResolvedScene` and geometry into typed arrays); `bvh.ts` (our own builder: metal triangles, and a second level over stone instances); `spectral.ts`; `host.ts` (`PathRenderer` on any `GPUDevice`); `schedule.ts` (time slices); `settings.ts` (tiers); `post.ts` (view transform, backdrop, PNG); `metrics.ts`; `denoise/` |
| `apps/studio/src/features/render/` | `path-worker.ts` (the host in a dedicated worker, posting `ImageBitmap`s), `path-takes.ts` (beside `browser-takes.ts`: claim, render, heartbeat, upload, complete), `engine-probe.ts`, the viewfinder overlay, tile and `EngineDialog.tsx` changes |
| `apps/server/src/handlers/render.ts`, `assistant/takes.ts` | `engineFor` learns the third engine; `renders.complete` accepts it; `renders.progress`; device reports; expiry by heartbeat. Client-rendered takes stay outside the server queue |
| `apps/server/src/engines/render/queue.ts`, `apps/node` | An engine-neutral runner interface and a headless runner (stage 5) |
| `tools/render-ref/` (new, Python, never imported by product code) | Fixtures, reference runners, the distance tool, the blind-comparison page; grown from the spike |

**Inside the kernel.** One compute pipeline carries a camera ray to a finished path, as the spike's `ptgem.wgsl` does `[V run]`. Stones are convex plane sets, not triangles; the tracer knows from its own state when a ray is inside one. Metal is triangles in a flat BVH walked in the shader, because WebGPU has no ray-tracing API and the M2 no ray-tracing hardware `[V]`. Light is carried per wavelength: four share a path until it refracts through a stone that has fire, then one continues (hero-wavelength sampling `[V]`). Samples are added to a running sum one at a time, so slicing cannot change the result.

**Rules the numbers do not say.** The Blender worker applies visibility rules that are not fields of `ResolvedScene` (`pave_worker/scene.py`): light panels are unseen by the camera and cast no shadows; black cards show only in reflections and refractions; the shadow ground is seen only by the camera; sparkle lights reach only stones. Our kernel implements the same rules; they go into the doc comments of `types.ts`, and each gets a conformance fixture.

**Where it runs.** *In a browser tab* (local and hosted, stages 1–4): WebGPU in a dedicated worker, or on the main thread where a browser lacks it in workers `[E]`; a desktop shell later runs the same bundle in Electron. *Headless on a node* (stage 5): Node with the `webgpu` package (Dawn) running the same `host.ts`, on Vulkan for NVIDIA cards (L4, T4, RTX), Metal on a Mac, Direct3D 12 on Windows `[E]`. Untested on a real GPU: the package found no adapter on the research box `[V run]`. Fallbacks: headless Chrome with Vulkan flags `[V today]`, or a Rust wgpu host. *In CI* (no GPU; correctness only): the WGSL files through wgpu-py on Mesa llvmpipe, as the spike ran `[V run]`, and the TypeScript host in headless Chromium if a software WebGPU adapter exists there (undocumented on the pages I opened; step 2 finds out).

**WebGPU reach** `[V]` (18 §4.4): Chrome, Edge and Electron on Windows and macOS since 113; Firefox 141 on Windows and 147 on Apple-silicon Macs; Safari 26 only on macOS 26 and iPadOS 26; Linux only in part. An Air on macOS 15 has it in Chrome and not in Safari. **Fallback:** nothing in the studio requires WebGPU. Without it the engine is Blender if installed, else today's WebGL Preview, else (hosted) a render machine.

**Budgets on the 8 GB Air.**

| Budget | Value |
|---|---|
| Tracer GPU memory at 2048 px | ≤ 350 MB: sum buffer 67, guides and mask 85, display and read-back 85, scene under 80 for 2 M triangles (arithmetic) |
| WebGPU default limits `[V]` | At most 6 storage buffers (limit 8; the spike used all 8 `[V run]`, so scene data packs into two), no binding over 128 MB, no buffer over 256 MB; a size beyond them is refused in plain words |
| Size and memory on ≤ 8 GB | Stills 2048 px long side, animation 1080 px (18 §6.3); denoiser ≤ 300 MB, tiled `[E]`; Pavé in total ≤ 3.5 GB while rendering (18 §9.1 allows 5 GB with Blender) |
| One GPU submission | ≤ 8 ms while the person is active, ≤ 40 ms when idle `[E]`; `schedule.ts` times each with `onSubmittedWorkDone` and sizes the next |
| Heat | Anything over 3 minutes is estimated at 60–70 % of first-minute speed `[E]` (the M2 holds 9 W sustained against 20 W in a burst `[V]`), then at a learned warm rate |

**Responsiveness and recovery.** The host renders a tile of a few samples, awaits completion, then yields; recent input shrinks the slice, and the 3D view is held in Smooth during a take. A hidden tab keeps going in the worker `[E]`. The sum is read back every 10 s and written to the origin's private file store every 30 s. On `device.lost` the host asks for a new device, re-uploads the scene and resumes at the saved sample; a second loss on one take falls back to another engine and says so.

## 3. Contract changes

All additive unless marked. One migration (next free number after `0015`).

| Where | Change |
|---|---|
| `packages/schema/src/api/entities.ts` | `RenderJob.engine` and `RenderEstimate.engine` add `'pave'` (the column is text; no enum migration). `RenderJob` adds `engineVersion: string \| null`, `paused: boolean`, `heartbeatAt: iso \| null` |
| `packages/schema/src/api/commands.ts` | `renders.create` and `renders.estimate`: `engine` adds `'pave'`. `renders.complete`: allowed for `browser` and `pave`; adds optional `scene` (after auto-tune) and `critique`, parsed with the existing schemas, every string bounded. New `renders.progress { id, progress, phase?: 'draft' \| 'take' \| 'denoise' \| 'encode', frame?: { done, total }, previewAssetId? }`: creator only, client engines only; sets `heartbeatAt`, publishes `job.updated`. `renders.update` adds `paused?`. New `renders.reportDevice { webgpu: { available, adapter, reason, raysPerSecond? } }`, kept in server memory per user for 15 minutes so the assistant's `engine: 'auto'` can choose. `renders.engine` output adds `local: { available, device, reason } \| null` and `preferred` |
| `apps/server/src/assistant/takes.ts` | **Behaviour change.** Today a browser take fails 10 minutes after creation. New: that holds only while unclaimed; a claimed take with no heartbeat for 2 minutes returns to `queued` (at most 3 times), then fails with a plain reason |
| `packages/kernel/src/types.ts` | `Evaluation.gemPlanes: Record<meshKey, { planes: Float32Array /* nx, ny, nz, d */, convex: boolean }>` |
| `packages/render/src/quality.ts` | Step 1: glossy equals total in `FLOOR` and `DEEP` (24 and 32). New `RENDER_SETTINGS_VERSION` in `cacheKeyOf` (`queue.ts`). **Breaking for the cache only:** old hits stop matching, as intended |
| `packages/schema/src/plans/config.ts` | `ENGINE_COUNTS: Record<engine, 'never' \| 'standard-and-final' \| 'all'>`, shipped as `{ blender: 'all', browser: 'never', pave: 'never' }` until decision 3. `ALLOWANCE_WORDS.render.label` drops "Blender" once a second engine counts |
| `packages/agent/src/prompt/skills/render.ts`, tool descriptions | "Without Blender a take is preview quality" becomes engine-aware; Drafts are named as the critique loop's tool |
| Usage | On completion: meter `render`, provider `pave`, unit `second`, `costUsd: 0`, key `render:<id>:take` |
| Files | `THIRD-PARTY-NOTICES` (root and studio build); a client checkpoint in the origin's private file store, keyed by scene so a retry resumes: `accum.bin`, `state.json { engineVersion, sceneHash, samplesDone }` |
| `ResolvedScene` | No change (version 2); `ResolvedOutput`'s Cycles-shaped fields are hints to our engine |

## 4. Hard parts and decisions

### 4.1 Is the recommendation sound? Proven, and bet

**Proven** `[V run]`, on one scene with one stone: a 340-line tracer of our own gives the same facet pattern as Cycles 5.3 and spectral Mitsuba 3; a stone as 121 planes costs 264–302 CPU-seconds where the same stone as triangles costs 463–487; the algorithm as one 247-line WGSL shader runs through wgpu, 1.4–2 times slower per sample than native C on a CPU; Open Image Denoise cleans our 512 px output in 0.5 s and keeps the facets. Licences are `[V]` (§4.6).

**Bets:**

1. **GPU speed.** No GPU timing exists. Research 15 assumes 30–100 million rays a second on an M2 through WebGPU and calls it "the weakest number in this file". The spike kernel is one loop per pixel; on a GPU, long paths inside a stone make neighbouring threads wait, a cost no CPU run shows.
2. **Efficiency.** At similar CPU time Cycles was closer to the reference: distance 0.0054 against our 0.0086 on the ring, 0.0079 against 0.0117 on the close-up `[V run]`. That mixes noise with two known faults (mirror-only metal, a gold table typed from memory), so the true equal-time gap is unknown.
3. **Many stones.** The spike had one. A pavé band needs a second-level structure over hundreds: standard, not measured.
4. **Denoising in a browser at 2048 px**, keeping facets. The one open project that does it has no release `[V today]`.
5. **The rest:** rough metal, depth of field, absorption, grounds, heat.

**Against the other two files.** Research 14 agrees with the shape: no engine has a secret, Cycles on the Air is "minutes, not seconds", and analytic stones plus a light-side caustics pass are the opening. Research 18 sharpens it: the Air's GPU scores 302–354 in Cycles against 2,285 for an RTX 3060, and an 8 GB Intel laptop scores 101 `[V]`. For such machines the answer is our renderer or a server: two halves of one answer. It also changes one conclusion of 15: on rented NVIDIA cards Cycles has hardware ray tracing and ours has none, so nodes run Cycles first (§4.7).

**Decision.** Plan A is research 15's path, begun with the measurement that can refute it and a named switch. Plan B is Cycles standalone (Apache-2.0 with BSD-3 files, already inside a closed CAD product `[V]`): least research risk, but native only, no stated stable API, no rendering on a hosted person's GPU, 8–12 weeks of C++ packaging `[E]`. Rejected: bundling Blender (GPL obligations, 250 MB); LuxCore (CPU only on Macs, slowest fire `[V run]`); three-gpu-pathtracer (its WebGPU tracer is two months old, "not yet stable", RGB `[V]`).

### 4.2 The deciding measurement (founder check F0)

A build agent has no GPU. The founder runs the spike on the reference Air after research 15 §6.6's set-up (never tested on macOS; if it fails, step 2's bench page stands in). Plugged in, cool, other apps closed. Record model, memory, GPU cores and macOS version, then, in `docs/research/spikes/15-renderer/`:

| Run | Command | Record |
|---|---|---|
| A | `venv/bin/python render_wgsl.py macro 256 1024 32` | `render_s` = t_A; `backend` must say Metal |
| B | `SPIKE_CYCLES_DEVICE=METAL venv-bpy/bin/python render_cycles.py macro 256 disp 1024 32`, twice (the first compiles kernels) | second `render_s` = t_B |
| C | `venv/bin/python render_wgsl.py macro 1024 1024 32` | t_C; sustained factor = 4·t_A / t_C |

Run A traces about 1.12 billion rays (4.16 per path `[V run]`); research 15's assumption predicts 11–37 s.

| Result | What happens |
|---|---|
| **Green:** t_A ≤ 45 s (at least 25 M rays/s) and t_A ≤ t_B (no slower per sample than Cycles on Metal) | Plan A; stage 1 starts |
| **Amber:** not green, but t_A ≤ 120 s and t_A ≤ 2·t_B. Good for Drafts and the developing viewfinder; Finals doubtful here | Spend one week on compacting live paths between bounces, re-measure, then build through step 8 for Drafts; founder chooses stage 2 or plan B |
| **Red:** slower on either count, or it does not run on Metal | Stop after step 4. Founder chooses plan B or server-first (nodes running Cycles). Steps 1–4 stay useful |

Why t_A ≤ t_B: at equal samples our image is noisier today, so equal time per sample still leaves a gap of two to four times at equal quality `[E]` for stages 2 and 3 to close. At twice Cycles' time I do not believe it closes.

### 4.3 Contained scope

| Area | Ships first (stage 1) | Later | Left out |
|---|---|---|---|
| Metals | The library's colours for every metal and plating (`materials/metals.ts`); GGX roughness, never zero; one conductor model: the F82 tint per wavelength, from two small tables per metal (reflectance at 0° and at 82°) | Stage 2: brushed (anisotropy), hammered and matte relief; tables for pure gold, silver, platinum, palladium, rhodium and titanium from measured data | Node graphs, image textures, scratches and glints |
| Karat alloys | No measured n, k exists for 18k or 14k, and mixing models miss by a factor of two `[V]` (14 §4.6). So: a smooth spectrum fitted at build time to the library's RGB values, round-trip tested, marked provisional as today | **Calibration:** one session with a sphere spectrophotometer on polished swatches (each karat and colour, rhodium over white gold, black rhodium). The measured curve is the 0° table; integrated, it also updates the RGB values the viewport and Blender use, so all engines move together | Predicting colour from composition |
| Faceted stones | Plane sets, exact Fresnel, total internal reflection, absorption by path length; a metal hit from inside a stone is shaded as metal (a bezel-set fixture tests it). **Depth** (measured in 14 §4.2): after 8 internal hits a diamond still holds 10 % of its light, after 16 hits 4 %, after 32 hits 2 %; a sapphire 1.4 % after 8. So Drafts trace 16 hits, Standard and Final 32, with Russian roulette after 8 and what remains sent to the ambient light, never to black | Stage 3: Sellmeier fits; absorption distance by stone size (mean path is 2.2 diameters in diamond, 1.3 in sapphire) | Birefringence, polarisation, fluorescence, inclusions, spectral absorption curves |
| Fire | In the kernel from the start: Cauchy index from the stored index and Abbe number, one stratified wavelength per path. Off in Drafts. On only for strongly dispersive stones large enough on screen (`[E]` 24 px); the rest refract at the mean index and keep all four wavelengths, so they add no colour noise | Stage 3 tunes the thresholds | Three-ray RGB "fire" |
| Other stones | Opaque polished (onyx, black diamond) | Stage 2: pearl, opal and turquoise approximated (diffuse, coat, thin film); cabochon and heart through a mesh fallback. Until then Automatic sends such pieces to Blender or Preview, with the reason | Random-walk subsurface |
| Light | The six looks as they are: gradient panels, black cards, sparkle lights, three-colour ambient, with direct-light sampling. Every look already carries a black card on the lens axis (`LENS_FLAG` in `looks.ts`), which is what draws a brilliant's arrows; a face-up fixture proves they appear | | HDRIs, sky, IES |
| Caustics | Plain path tracing; sparkle lights reach only stones, so they cannot speckle the ground | **Stage 3: a photon pass aimed at stones.** From each light, emit only toward each stone's bounding sphere, trace through at one wavelength, splat on the ground, filter. Opt-in per look, Final only. Chosen because Cycles' shadow caustics need smooth casters and facets are flat, path guiding is CPU only `[V]`, and manifold and polynomial solvers do not reach deep chains `[E]` | Caustics on curved receivers |
| Camera, ground | The orbit rig exactly, roll, thin-lens depth of field. Grounds: none, shadow with alpha, sweep, black acrylic | Rack focus, with animation | Motion blur, lens distortion, displacement |
| Denoise | Open Image Denoise with albedo and normal guides; stone pixels get more samples and less denoise weight | Stage 3: facet id as a guide | Temporal denoisers |
| Colour | Sum in CIE XYZ (gold's red lands just outside sRGB, 14 §4.6); exposure; Neutral and AgX as the looks set them; backdrop composited after the view transform; 8-bit PNG with alpha; subject mask | Stage 3: optional glare on the linear image (gates are measured before it); 16-bit | EXR, deep output |
| Motion | | Stage 4: turntable, light sweep and camera tracks (rigid, so the BVH is never rebuilt), per-frame denoise, video | Deformation, physics; and never volumes, hair, subdivision or out-of-core scenes |

### 4.4 Other hard parts

1. **No WebGL2 tracer.** Research 18 §9.2 asks that the in-browser renderer run on WebGL2 with WebGPU as an upgrade. That holds for the studio (viewport and Preview stay WebGL2), not for the path tracer: a second shader back end doubles kernel upkeep for a shrinking group (Safari before 26, Firefox on Intel Macs, Linux). Revisit if over one first-hour session in ten lacks WebGPU.
2. **Metrics outside the GPL worker.** `metrics.ts` is written from the `RenderMetrics` definitions in `assess.ts`, not translated from `metrics.py`, and must agree with it within 1 % on the same images.
3. **View transforms.** Gates compare linear output through one shared display transform, as the spike did, so engine error and transform error stay apart. Neutral is a closed formula and must match Blender's within 1/255. AgX uses the viewport's existing approximation and is measured; Blender's colour tables are not copied.
4. **Same pixels.** Seed 0, a hash of pixel and sample index, ordered sums, stop decisions only at fixed sample counts. The promise is per machine and browser, because GPU vendors round differently `[E]`. If the denoiser is not bit-stable, it holds before the denoiser and within 1/255 after.
5. **Video without the worker.** WebCodecs `VideoEncoder` with the platform's H.264 encoder (Chrome 94, Safari 16.4, Firefox 130 `[V today]`), so we ship no codec. The muxer is chosen in stage 4 once its licence is read: the MIT one is deprecated `[V today]`, its successor unverified. The GIF stays with the server.

### 4.5 Security, safety, privacy

A take rendered in a window is delivered by the person who queued it, first write wins, as today; `scene` and `critique` from the client are parsed and bounded like the deploy plan's node uploads. Kernels and denoiser weights come from our own origin with integrity hashes, never from a third party at run time. The design never leaves the machine. Every tier has a time cap, so a fanless laptop is not driven for hours. No credentials, tokens or third-party terms are added.

### 4.6 Licences

| Component | Licence | Use | Evidence |
|---|---|---|---|
| Our kernels and host | Ours | In process | The spike is our own code; its gold table, typed from memory, is replaced |
| Dawn (in Chrome; the `webgpu` npm package for Node) | BSD-3-Clause; the package MIT | Browser runtime; headless host | `[V]` 15 §4.2. The npm page I opened today states no licence: re-read the package's file at install |
| wgpu, wgpu-py | MIT or Apache-2.0 | CI harness; fallback host | `[V]` |
| Open Image Denoise 2.5.1 and its weights | Apache-2.0 | Native on nodes; weights converted to ONNX for the browser | `[V]` |
| ONNX Runtime, web build | MIT | Runs the denoiser in the browser | `[V today]`; bundle size unverified |
| The open browser denoiser project | MIT, no release | Read for its tiling; not a dependency | `[V today]` |
| refractiveindex.info database | CC0, asks for citations | Tables for pure metals, gem index fits | `[V]` 14 §4.6; never transcribe Palik's book |
| Colour-matching functions | Analytic fit of Wyman, Sloan and Shirley (2013), as in the spike | Wavelength to colour | `[E]`: published constants, cited. CIE's own table page shows a copyright notice and no licence `[V today]`. For counsel |
| three-mesh-bvh, three.js | MIT `[V]`, MIT `[E]` | Viewport only; not in `trace/` | |
| Mitsuba 3; Cycles via the worker; LuxCore | BSD-3; GPL, own process; Apache-2.0 | Reference harness only, never shipped | `[V]` |
| HDRIs | None: looks are procedural | | If ever added: Poly Haven, CC0 `[V]` |

**The GPL boundary, restated.** Nothing GPL runs in a Pavé process. Blender and `workers/render` stay a separate program, started with a job file and a model file and returning images. The reference harness starts that worker as a process and never imports `bpy`. Notices for every Apache, BSD and MIT part ship in `THIRD-PARTY-NOTICES`. `workers/render/LICENSE` is a notice with a link, not the licence text, and GPL-3.0 section 4 asks that recipients get a copy `[V]`: request 1 in §7. None of this is legal advice.

### 4.7 Render nodes, and what they cost

When hosting exists, a still can render in the person's own browser with no node. Nodes are then for animations first, Finals above 2K, and machines with neither WebGPU nor Blender. **Nodes run Cycles by default:** on an L4 a Final 2K still costs about 2–3 cents and a 5-second turntable 20–55 cents `[E]` (18 §7.3, from $0.80 an hour and Open Data scores `[V]`), and NVIDIA cards give Cycles hardware ray tracing that our kernel cannot use. Our kernel on a node (stage 5) waits for a trigger (§6). A Draft from ours and a Final from Cycles differ slightly: the gates bound it and the captions say which made each.

### Decisions that are the founder's

1. **Plan A or plan B.** Recommended: plan A behind F0, with the switch rules in §4.2 and §7. Choose plan B now only if certainty matters more than rendering in the browser.
2. **The name on the tile.** Recommended: "Pavé Render"; schema value `'pave'`.
3. **Does a take from ours count against the 5 free a month?** It costs us nothing, but so does a local Blender take, and local limits cannot be enforced on a machine the person owns (research 20 §4.4). Options: (a) Standard and Final count like Blender takes, Drafts and the developing viewfinder never; (b) ours is free, and only Blender and node renders are paid; (c) meter node renders by work, as KeyShot's cloud does (1 credit = 1 gigasample `[V]`). Recommended: free until it passes the jewelers' comparison (gate 2), then (a), with (c) for nodes and animations priced apart from stills. Shipped default until you decide: not counted.
4. **What Automatic picks.** Recommended: until gate 2, Blender when installed and ours otherwise; after it, ours for Drafts always, and for takes unless the piece is not covered or the person chose Blender.
5. **The reference machine:** which Air (size, memory, GPU cores, macOS). Recommended: 8 GB stays the target even if yours has 16.
6. **Who judges "photoreal enough",** on which ten pieces. Recommended: five or more working jewelers, blind (§5).
7. **Alloy swatches:** may real swatches be measured, and by whom? Recommended: yes, before gate 2.
8. **Engine on render nodes:** Cycles (recommended), or our kernel to match local Drafts exactly.
9. **People:** one graphics engineer for about six months, or agents plus a person who judges images at each gate. **Counsel:** the notices, the colour-matching data and, under plan B only, the Cycles standalone notices.

## 5. Verification

**The metric.** Research 15's distance D: both images through one shared display transform, averaged over 4 × 4 pixel blocks, mean absolute difference in 0–1 units. Reported for the whole frame and inside the stone, metal and ground masks: a whole-frame mean hides the stone. Also: the colour ratio on metal pixels, mean brightness within 1 %, and the subject box.

**References.** A fixture is a `ResolvedScene` plus geometry. The gate reference is Cycles through our worker, in its own process, at 2,048 samples or more, depth 32, no denoise, made **after** step 1's fix. Mitsuba 3 with the spike's dispersive material cross-checks the stone fixtures. The repository stores the block-averaged linear images (under 1 MB each) at each test size, with checksums and engine versions; `pnpm ref:render` regenerates full-size ones. Fixtures: solitaire (hero and face-up), three coloured stones, a 200-stone band, a brushed band, black acrylic, white catalogue, a bezel-set stone, and a 2,000-stone piece for timing.

| Gate | Pass marks |
|---|---|
| **0. Harness** (step 3) | On each stone fixture Cycles and Mitsuba agree with D ≤ 0.010 (the spike measured 0.005 and 0.008 `[V run]`). Caps for later gates are frozen here, before any kernel exists: 1.5 × the Cycles-to-Mitsuba distance per fixture, and at most 0.012 unless a fixture's own floor is higher (reason recorded) |
| **F0, F1** (founder) | §4.2. F1: the bench page in Chrome, and in Safari where it has WebGPU, within 1.3 × t_A; frame time ≤ 33 ms at the 95th percentile during the run; no device loss in 5 minutes |
| **1. Stills** (step 8) | Denoised D within each fixture's cap, the brushed band excepted until step 9 (the spike reached 0.007 and 0.010 on its one easy scene); gold colour ratio within 3 % of the reference; subject box within 1 % of `predictFraming` and 1 px of the Blender mask and the Preview; arrows visible face-up; every visibility fixture passes. On the Air: Draft ≤ 20 s; 1024 px at 256 samples ≤ 60 s (15's mark); Pavé ≤ 3.5 GB, memory pressure green, swap flat; orbiting the CAD view ≥ 20 frames a second during a take. Identical pixels on a re-run and across slice sizes. `device.destroy()` mid-take: the take finishes with identical pixels |
| **2. Quality** (step 10) | Noise at equal time within 1.25 × Cycles on Metal on the Air; ground caustic energy within 10 % of a light-tracing reference; **blind comparison:** ten pieces, two views each, ours and Blender side by side, unlabelled, in random order; five or more working jewelers answer "which would you publish?" Pass: ours or "no difference" in at least half the answers, and no piece where four in five pick Blender |
| **3. Animation** (step 11) | A 150-frame 1080 px turntable finishes on the Air, time and warm rate recorded; flicker in static regions within 10 % of the Cycles reference; no loop seam in a frame difference; a reload at frame 70 resumes at the first missing frame |
| **4. Headless** (step 12) | A node renders a queued take within gate 1's cap of the browser's image; a licence scan in CI finds nothing GPL in any shipped process |

**Automated.** Vitest: plane lists against facet meshes (every vertex on or inside every plane); packing goldens; BVH against brute force; spectra back to RGB within ΔE 0.5; `metrics.ts` against `metrics.py`; tiers and cache key; expiry and heartbeat with a fake clock; `engineFor` over every capability combination. Kernel conformance through wgpu-py on llvmpipe. Server harness: `renders.progress`, `complete` with `scene` and `critique`, roles, decision 3's claim rules. Screenshots (`apps/studio/e2e/shots.ts`): developing viewfinder and tile, paused, the three captions, the "cannot run" lines, the dialog; light and dark.

**Review lenses.** Optics; security and cost; the founder's first hour with no Blender; premium design. **By hand, the founder can:** run F0; open the bench page; watch a framed ring develop; wipe a Final against a Blender take; orbit the CAD view during a take; pause and resume.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| A WebGL2 port of the tracer | §4.4's trigger |
| Our kernel on render nodes (stage 5) | A node Final must match local Drafts exactly; nodes without Blender are wanted; or counsel advises against Blender on hosted machines |
| Stills above 2048 px on the laptop (tiled) | After gate 1, if asked; otherwise nodes |
| The viewport's gem shader moved from a mesh BVH to planes (15 note 10) | Any time after step 4 |
| Birefringence, spectral absorption, fluorescence, inclusions | The founder names moissanite doubling or alexandrite colour change a goal (recommended: not now) |
| HDRI import, custom lights, EXR; native Open Image Denoise; cheaper stones under 12 px | As in `render-and-models.md`; with the desktop app; if the 2,000-stone fixture is too slow |

## 7. Build order

Tests first in every step. Effort is `[E]` for one graphics engineer. Research 15 estimates 19–27 weeks, ±50 %; my steps sum to 22–30, because I count the multi-stone structure, the browser denoiser and the heartbeat and pause plumbing, which the spike never touched. Steps 1–4 do not depend on F0; stage 1 is steps 5–8.

**F0. Founder check** (20 minutes, any time; §4.2). Done means: the three numbers and the machine facts are in the lane's status file, and the rule's row is named.

| # | Delivers | Files | Tests and "done means" | Effort | Needs |
|---|---|---|---|---|---|
| 1 | **Fix now: stones in Blender takes go dark too early.** In Cycles an internal reflection counts as a glossy bounce `[V]` (14 §4.2), and the tiers cap glossy at 12 and 16 under transmission 24 and 32. Set glossy equal to total; version the cache key; give the Preview still's hero stones 8 bounces, not 6 | `packages/render/src/quality.ts` (both copies), `engines/render/queue.ts`, `features/render/shot-renderer.ts` | Before and after renders of the fixture solitaire close-up, same seed: brightness inside the stone mask rises, distance to a depth-64 render falls, time rises at most 15 %; both images in the handoff. Unit tests on tiers and cache key | 1–2 days | |
| 2 | **Bench page and probe.** The spike kernel and scene as a studio route that renders 512 and 1024 px in time slices, in a worker and on the main thread, and prints one JSON line (time, frame times, adapter). `renders.reportDevice`. Then founder check F1 | `features/render/engine-probe.ts`, a `bench` route, `handlers/render.ts`, schema | Probe tests with fake adapters; the page in headless Chromium if a software adapter exists (record the answer either way). Done: F1 recorded for Chrome and Safari | 3–5 days | |
| 3 | **Reference harness.** Fixtures, the Cycles runner (the worker as a process), the Mitsuba runner, the distance tool, stored references, frozen caps, the blind page, the licence scan, `THIRD-PARTY-NOTICES` | `tools/render-ref/`, root scripts | Gate 0. Done: `pnpm ref:check` passes on a clean clone with no Blender | 1.5–2 weeks | 1 |
| 4 | **Geometry and scene packing.** Plane lists and `Evaluation.gemPlanes`; `trace/scene.ts`, `bvh.ts`, `spectral.ts` with the fitted spectra; the visibility rules written into `types.ts` | `packages/kernel/src/gems/planes.ts`, kernel `types.ts`, `packages/render/src/trace/` | §5's tests for planes, packing, BVH and spectra. Done: every fixture packs inside WebGPU's default limits | 1–1.5 weeks | |
| | **Decision point:** F0 and F1 against §4.2 | | | | F0, 2 |
| 5 | **Kernel.** Camera with depth of field; stones with the instance structure and fire; metal BVH; the conductor model; panels, cards, sparkles and ambient with direct-light sampling; three grounds; hero wavelengths; roulette; mask and guides; ordered accumulation | `trace/kernels/*.wgsl` | On llvmpipe at 256 px: each fixture within twice its cap, undenoised, at 1,024 samples; every visibility fixture | 4–5 weeks | 3, 4 |
| 6 | **Host.** `PathRenderer`, slices, worker, read-back, checkpoint, device-loss recovery, view transforms, metrics | `trace/host.ts`, `schedule.ts`, `post.ts`, `metrics.ts`, `path-worker.ts` | Same pixels across slice sizes; destroy and resume; metrics against `metrics.py` | 2 weeks | 5 |
| 7 | **Denoise.** First a bake-off: the browser path against native Open Image Denoise on the fixtures' noisy buffers; then tiling and stone weighting | `trace/denoise/`, `tools/render-ref/` | Browser result within D 0.002 of native; ≤ 5 s at 2048 px on the Air `[E]`; ≤ 300 MB. If it fails: our own convolution kernels in WGSL, or more samples with a guided filter | 1–1.5 weeks | 6 |
| 8 | **In the product: Drafts and the developing viewfinder.** The `'pave'` engine, `path-takes.ts`, `renders.progress`, pause, the new expiry, captions, the Rendering dialog, the coverage check, per-device estimates, the assistant's wording | studio `features/render/*`, `handlers/render.ts`, `assistant/takes.ts`, schema, `plans/config.ts`, `packages/agent` | **Gate 1**; screenshots. Useful by itself: a machine with WebGPU and no Blender gets true-light Drafts in place of Preview | 2 weeks | 6, 7 |
| 9 | **Stage 2: finishes and the rest of the library.** Brushed, hammered, matte; measured tables for pure metals; surface stones; the mesh fallback for cabochon and heart; Standard and Final switched on | `trace/kernels`, `spectral.ts`, `settings.ts` | The brushed band inside its cap; a pearl judged by eye and named an approximation | 3–4 weeks | 8 |
| 10 | **Stage 3: fire tuning and caustics.** Fire thresholds, Sellmeier fits, absorption by stone size, the aimed photon pass, facet-aware denoise, optional glare; the alloy tables if decision 7 is yes | `trace/kernels`, `materials/gems.ts`, `looks.ts` (an opt-in flag) | **Gate 2.** After it, decisions 3 and 4 take effect | 3–4 weeks | 9 |
| 11 | **Stage 4: animation.** The frame loop over the existing tracks, stable noise, per-frame denoise, WebCodecs video, kept frames, warm-rate estimates | `path-takes.ts`, `trace/host.ts`, `takes.ts` | **Gate 3** | 3–4 weeks | 8 |
| 12 | **Stage 5: headless.** First one day on a rented L4 to prove Dawn finds the GPU; then the runner in `apps/node`, the engine-neutral queue, `requires.engine`, Windows and NVIDIA validation | `apps/node`, `engines/render/queue.ts` | **Gate 4** | 3–5 weeks | Deploy plan step 8; a §6 trigger |

**The plan B switch.** The clock starts with step 5. Week 6: if under half the fixtures pass step 5's test, start a two-day trial build of Cycles standalone on Apple silicon. Week 10 (research 15's trigger): if gate 1 has not passed on distance or on time, stop and build the Cycles sidecar (8–12 weeks `[E]`), started as a separate program the way Blender is. Kept from plan A: steps 1–4, the engine value and the captions. An amber F0 that stays amber rests at step 8.

**Requests to the integration lane.**

1. Add the full GPL-3.0 text to `workers/render/LICENSE` (today's notice stays above it) before the worker is distributed.
2. Step 1, if this plan's lane may not touch `packages/render` on the assistant branch.
3. The spike's `render_cycles.py` imports `bpy`: keep it out of every shipped package, and give it a GPL header if that folder is ever published.
