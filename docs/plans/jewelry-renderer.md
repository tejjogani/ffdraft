# Jewelry renderer

25 November 2026, revised after review. The founder's priority: a renderer of our own, "inspired by Blender's Cycles but contained to what jewelry needs", for photoreal stills and animations on a machine with no Blender. It rests on research [15](../research/15-own-renderer.md) (options, licences, spikes), [14](../research/14-jewelry-rendering.md) (the physics) and [18](../research/18-low-end-machines.md) (the 8 GB Air, server costs). It adopts research 15's path, a contained path tracer as WebGPU compute kernels, **only behind a measurement gate and with real GPUs in the build loop**: the spike never ran on a GPU. Labels: `[V]` verified at source (by me where it says "today"); `[V run]` measured (the spike ran on a 2-core CPU, no GPU); `[E]` estimate. Code paths are in the assistant build.

- **Replaces** in `render-and-models.md`: §1 item 7 on machines with WebGPU; the rule (§2, §4.2) that `metrics.py` is the only metrics implementation; the cut "Browser animation export". Supersedes research 03 §6 ("do not write a path tracer").
- **Extends** `deploy-and-durable-jobs.md`: a take rendered in a window is one more runner of its `work` rows; hosted stills can render on the person's own GPU; what nodes are then for (§4.7).
- **Leaves:** `ResolvedScene` v2, the looks, the viewfinder; the Blender worker as a separate GPL program; the deploy plan's node protocol.

## 1. Experience

The Render stage keeps its shot list, viewfinder, look cards, Motion and Size controls and takes strip. What changes is what happens with no Blender installed.

1. **The viewfinder develops.** Frame a shot. While the camera moves you see today's live preview. About a second after it rests, the same view sharpens into a true render: real reflections between prongs, real light inside the stones. Touch anything and the live preview is back at once. It is not a take.
2. **Render starts at once.** Press Render (`mod+enter`): the tile shows the picture itself developing, not a ring, with a quiet "about 40 s". Nothing was installed.
3. **Draft, Standard, Final:** the same three choices as today, none counted against the allowance (decision 3). Times are `[E]` for the reference Air on the solitaire until gate P sets them.
   - **Draft:** a quick true-light picture to judge angle, light and framing; no fire. Up to 1024 px, 10–20 s.
   - **Standard:** the default take, with fire. Up to 2048 px, 1–3 min.
   - **Final:** the clean one; later with light spots on the ground. Up to 2048 px on 8 GB; minutes, shown first.
4. **Two renderers, one strip.** A take from our renderer sits beside a Blender take of the same shot, each with one caption: "Final · Pavé Render · 1 min 10 s" or "Final · Blender · 6 min". The WebGL fallback stays "Preview". Compare (`c`) wipes between any two takes. No samples, bounces or device names on the tile.
5. **Progress, pause, a calm laptop.** A take this window renders can be paused and resumed from its tile. Editing stays smooth: the renderer works in short slices and gives way the moment you touch the model. If the machine warms and slows, the estimate says so. If the graphics chip resets, the take carries on. Close the window and the tile reads "Interrupted · Resume"; progress is kept when the browser still has it.
6. **The engine chip** reads "Renders on this computer", "Blender 5.3" or "Preview only"; its dialog offers Automatic, This computer or Blender. Until Standard and Final exist (step 10), the dialog's existing one-step set-up of Blender's renderer is the photoreal answer. When ours cannot run, one quiet line gives the reason and the way out ("Photoreal rendering needs Chrome, Edge or a newer Safari on this Mac"); Preview still works.
7. **Animations, honestly.** They play live as today. A **motion draft** (540 px) checks the move in about 5 minutes `[E]`. The real thing is a leave-it-running job: a 5-second turntable is about 45 minutes at 1080 × 1080 and 1 to 1.5 hours at 1920 × 1080 on the Air if gate P is green `[E]`. The tile says so before it starts ("150 frames · about 45 min · this laptop will be busy"), keeps finished frames, and stops at 3 hours. Render machines, once they exist, are the default for animation.

**The AI render job** keeps its shape: the cinematographer looks at the piece, asks what the images are for, which formats and which animations, then places cameras and checks framing first. It works in Drafts (true light, so its critique is worth more than on a Preview), re-renders a weak shot at most twice, then renders the set. It says the time first, and that it needs a Pavé window open. The job panel's Pause pauses the take; a manual change to a shot pauses the job.

## 2. Structure

**One scene, every reader.** `resolveScene()` (`packages/render/src/resolve.ts`) compiles a shot and the kernel's evaluation into `ResolvedScene` v2. The WebGL viewport, the Blender worker (`job.json` plus a GLB, separate process), our renderer and a node all read that one object, so framing, lights and materials cannot drift. Rules that must hold in every engine live in the compiler, not in an engine: which stones get fire is decided there, once per shot (a small stone's material gets `dispersion: 0`).

| Place | What is new |
|---|---|
| `packages/kernel/src/gems/planes.ts` | Per gem unit (cut and ratio): the planes of its flat triangle groups, and a test that no plane cuts the mesh. Units that pass are traced as plane sets, the rest as mesh |
| `packages/render/src/trace/` (no DOM, no three.js) | `kernels/*.wgsl`; `scene.ts` (packing); `bvh.ts` (ours: metal, mesh stones, a second level over stone instances); `spectral.ts`; `host.ts` (`PathRenderer` on any `GPUDevice`); `schedule.ts`; `settings.ts`; `post.ts`; `metrics.ts`; `denoise/` |
| `apps/studio/src/features/render/` | `path-worker.ts` (the host in a dedicated worker), `path-takes.ts` (beside `browser-takes.ts`), `engine-probe.ts`, viewfinder overlay, tile and `EngineDialog.tsx` changes |
| `apps/server/src/handlers/render.ts`; `workers/render/pave_worker/` (GPL side) | The third engine, on `work` rows; a reference mode chosen by `job.json` (linear EXR, raw view, no backdrop, no denoise), and `dispersion: 0` honoured |
| `tools/render-ref/` (Python; never imports `bpy`), `tools/gpu-lab/` | Fixtures, the reference runner (starts the worker), metrics, negative controls, the comparison pages; the lab's run scripts |

**Real GPUs in the build loop (the GPU lab).** No agent machine has a GPU, and CI's CPU rasteriser compiles WGSL with a different compiler from the ones browsers ship. So before any kernel step: a rented Apple-silicon Mac and a Windows GPU machine, driven over SSH, run the bench page and every fixture in headed Chrome and Safari (Mac) and Chrome and Edge (Windows, Direct3D 12) **on every kernel commit**. The same machines render the Cycles references and plan B's trial build.

- **Mac:** Scaleway M2 mini, 16 GB, €0.17 an hour or €115 a month (an 8 GB M1 mini: €75) `[V today]`; or AWS `mac2-m2.metal`, $0.878 an hour `[V]` (18). Kept for the build.
- **Windows, NVIDIA T4:** AWS `g4dn.xlarge`, $0.526 an hour at the Linux rate `[V today]` (Windows `[E]` about $0.70), or Azure NC4as T4 v3 `[V]` (18). Started per run: `[E]` $30–60 a month.

Cost: about €150–170 a month `[E]`, €1,300–1,900 over the build. Owner: the integration lane, on the founder's accounts (decision 2). Unproven: headed browsers with WebGPU under automation on a rented Mac; step 2 proves it, or the plan stops there. **Without the lab** only step 1, the founder's F0 and a slow CPU harness can run: no kernel step can be called done, and no reviewer can reproduce one. **Even with it**, a mini has a fan and 16 GB, and neither machine has Intel integrated graphics: heat and 8 GB pressure need three short sessions on the founder's Air (gates P, 1, 3); Intel laptops, one bought or borrowed (decision 5).

**Inside the kernel.** One compute pipeline carries a camera ray to a finished path, as the spike's `ptgem.wgsl` does `[V run]`. A convex stone is a plane set; metal and other stones are triangles in a BVH walked in the shader (WebGPU has no ray-tracing API, the M2 no such hardware `[V]`). Light is carried per wavelength: four share a path until it refracts through a stone that has fire, then one continues (hero-wavelength sampling `[V]`). Samples join a running sum one at a time, so slicing cannot change the result.

**Which cuts are plane sets** `[V run today]` (the kernel's own gem units, every vertex against every plane): round (121 planes), princess (29), emerald (57), asscher (57) and baguette (29) are exact convex plane sets at every ratio tried. Oval at its default ratio, pear, marquise, heart and trillion are **not** convex as the kernel builds them (planes cut the mesh by 1–50 % of the girdle width); cushion and radiant pass at some ratios; the cabochon is curved. So both paths ship in stage 1 and the per-unit test picks one. The mesh path is the slower (463–487 CPU-seconds against 264–302 in the spike `[V run]`).

**Rules the numbers do not say.** The Blender worker applies visibility rules that are not fields of `ResolvedScene` (`pave_worker/scene.py`): light panels are unseen by the camera and cast no shadows; black cards show only in reflections and refractions; the shadow ground is seen only by the camera; sparkle lights reach only stones. Step 3 measures what Cycles does for each (a ground → stone → sparkle path too) before our kernel copies it; the rules go into `types.ts`, a fixture each.

**Jobs: one model.** A take a window renders is a `work` row of the deploy plan. The window claims it, heartbeats with `renders.progress` and finishes with `renders.complete`, all fenced by the lease epoch; the deploy plan's reaper returns a silent take to `ready` and, after three tries, to `interrupted` with Resume. Pause is `parked`. Hand-queued browser takes gain an expiry too (today's runs only inside the assistant loop, `assistant/takes.ts`). So step 9 needs deploy plan step 1.

**Where it runs.** In a browser tab, local or hosted, in a dedicated worker (the main thread where a browser lacks WebGPU in workers `[E]`); a desktop shell later runs the same bundle; a node (step 13) runs the same `host.ts` under Node's `webgpu` package, unproven on a real GPU `[V run]`. CI's llvmpipe run is for regressions only. **Reach** `[V]`: Chrome, Edge and Electron on Windows and macOS since 113 (ARM Windows behind a flag); Firefox 141 on Windows, 147 on Apple-silicon Macs; Safari 26 on macOS 26. An Air on macOS 15 has it in Chrome, not Safari. Nothing in the studio requires WebGPU: without it the engine is Blender, else Preview, else a node.

**Memory on the 8 GB Air** (MB; first row from 18 §9.1). The three phases never overlap, which is the only reason it fits.

| Row | Evaluating | Tracing | Denoising |
|---|---|---|---|
| Page and viewport in Smooth 700, draft kernel 600, server 400, one pool worker 1,024 | 2,724 | 2,724 | 2,724 |
| Browser production kernel (stopped after packing) | 700 | 0 | 0 |
| Tracer, GPU, 2048 px: sum 67, guides 67, mask 17, display 17, read-back 67, scene 72 | 0 | 310 | 150 |
| Tracer, page: checkpoint copy 67, packing arrays 72 | 0 | 140 | 70 |
| Denoiser `[E]` | 0 | 0 | 250 |
| **Total** | 3,424 | 3,174 | 3,194 |

Pass mark, on the 200-stone band at 2048 px: Pavé under 3.5 GB, memory pressure green, swap flat, GPU side under 400 MB (18 §9.2). Shed in this order: the idle pool worker, the draft kernel (recycled), size 2048 to 1536, then pause with a plain line. Scene layout: vertex 16 bytes, triangle 12, BVH node 32, so 2 M triangles are about 72 MB in three buffers, each under the 128 MB binding limit, with seven storage buffers of the default eight `[V]`. Over 3.5 M triangles a take is refused; step 3 reports every fixture's count.

**Responsiveness and recovery.** The host renders a tile of a few samples, awaits `onSubmittedWorkDone`, then yields: at most 8 ms of GPU per slice while the person is active, 40 ms when idle `[E]`. Pipelines compile when the Render stage opens. A hidden tab may slow or stop `[E]`; the lease covers it. The sum is saved to the origin's private file store every 30 s: best effort (browsers may evict it), capped at 500 MB, deleted on completion or cancel. On `device.lost` the host asks for a new device and resumes at the saved sample; a second loss falls back to another engine and says so. Anything over 3 minutes is estimated at 60–70 % of first-minute speed `[E]` (the M2 holds 9 W sustained, 20 W in a burst `[V]`).

## 3. Contract changes

Additive unless marked. One migration.

| Where | Change |
|---|---|
| `packages/schema/src/api/entities.ts` | `RenderJob.engine` and `RenderEstimate.engine` add `'pave'` (a text column); `RenderJob.engineVersion: string \| null` |
| `packages/schema/src/api/commands.ts` | `renders.create`, `renders.estimate`: `engine` adds `'pave'`. New `renders.claim { id } → { epoch }`. `renders.progress { id, epoch, progress, phase?, frame?, previewAssetId? }` is the heartbeat. `renders.complete`: for `browser` and `pave`, takes `epoch`, optional `scene` and `critique` (existing schemas). `renders.update` adds `paused?` (parks the work row). `renders.reportDevice { webgpu: { available, adapter, reason, raysPerSecond? } }`, kept in a `render_device` row per user and install (not in memory: a deploy runs two instances). `renders.engine` adds `local` and `preferred` |
| `work` (deploy plan); `assistant/takes.ts` | `requires.engine` adds `'pave'`, `requires.runner: 'window'`; no lease columns on `render_job`. **Behaviour change:** `expireBrowserTake` goes; the reaper owns expiry for every client take |
| `packages/kernel/src/types.ts`; `workers/render` `job.json` | `Evaluation.gemPlanes: Record<meshKey, { planes: Float32Array, convex: boolean }>`; `output.reference?: true` (GPL side) |
| `packages/render/src/quality.ts`, `resolve.ts` | Step 1: glossy equals total in `FLOOR` and `DEEP` (24 and 32); `RENDER_SETTINGS_VERSION` in `cacheKeyOf`. Step 5: the fire rule (`dispersion: 0` under the size threshold, by a stone's largest size in the shot). **Both change Blender takes' pixels;** the version retires old cache hits |
| `packages/schema/src/plans/config.ts` | `ENGINE_COUNTS`, shipped `{ blender: 'all', browser: 'never', pave: 'never' }` (decision 3) |
| Other | The `packages/agent` render skill becomes engine-aware. `THIRD-PARTY-NOTICES`. The client checkpoint (`accum.bin`, `state.json { engineVersion, sceneHash, samplesDone }`) is a `work_checkpoint` row with no blob |

## 4. Hard parts and decisions

### 4.1 Is the recommendation sound? Proven, and bet

**Proven** `[V run]`, on one scene with one round stone and mirror metal: a small tracer of our own gives the same facet pattern as Cycles 5.3 and spectral Mitsuba 3; as one WGSL shader it runs through wgpu, 1.4–2 times slower per sample than native C on a CPU; Open Image Denoise cleans its 512 px output in 0.5 s and keeps the facets.

**Bets:**

1. **GPU speed.** No GPU timing exists. Research 15 assumes 30–100 million rays a second on an M2 and calls it "the weakest number in this file". The spike kernel is one loop per pixel; on a GPU, long paths in a stone make neighbouring threads wait.
2. **Efficiency.** At similar CPU time Cycles was closer to the reference: 0.0054 against our 0.0086 on the ring, 0.0079 against 0.0117 on the close-up `[V run]`. That mixes noise with two faults (mirror-only metal; gold that reads rose beside the reference), so the equal-time gap is unknown.
3. **Many stones, and stones that are not convex.** The spike had one round stone.
4. **Denoising in a browser at 2048 px**, keeping facets; **three shader compilers** (Chrome's, Safari's, wgpu's) on one large kernel; Direct3D 12; heat.

**Against the other two files.** Research 14 agrees with the shape: no engine has a secret, Cycles on the Air is "minutes, not seconds", and analytic stones plus a light-side caustics pass are the opening. Research 18: the Air's GPU scores 302–354 in Cycles against 2,285 for an RTX 3060 `[V]`. 8 GB Intel laptops score 101 `[V]`: for them the honest answer today is a server, and whether ours gives them even a Draft is unmeasured (decision 5). On rented NVIDIA cards Cycles has hardware ray tracing and ours none, so nodes run Cycles (§4.7).

**Decision.** Plan A is research 15's path, begun with the measurements that can refute it. **Plan B** is Cycles standalone (Apache-2.0 with BSD-3 files, inside a closed CAD product already `[V]`): least research risk; native only, no stated stable API `[V]`, nothing for a hosted person's GPU, 8–12 weeks `[E]`. Its traps are in the build: only OpenImageIO and TBB are required `[V]`; OpenImageIO's optional plugins (FFmpeg, LibRaw, libheif, Qt) stay off; the precompiled bundle "shared with Blender" `[V]` is never linked; NVIDIA builds fall under NVIDIA's terms; a sidecar must be signed. A trial build lists every library and licence. Rejected: bundling Blender; LuxCore (CPU only on Macs); three-gpu-pathtracer ("not yet stable" `[V]`).

### 4.2 Gate P: the measurements that come before the build

**F0, today, nothing built.** The founder on his Air, after research 15 §6.6's set-up, never tested on macOS (Homebrew LLVM, two Python environments, a 254 MB download): allow an hour. In `docs/research/spikes/15-renderer/`, plugged in and cool:

| Run | Command | Keep the whole JSON line |
|---|---|---|
| A | `venv/bin/python render_wgsl.py macro 256 1024 32` | t_A = `render_s`; `backend` must be Metal; `shader_compile_s`, `first_pass_s` |
| B | `SPIKE_CYCLES_DEVICE=METAL venv-bpy/bin/python render_cycles.py macro 256 disp 1024 32`, twice | t_B = second `render_s`; **void unless `device` names METAL** (the script now stops if Metal is missing) |
| C | `venv/bin/python render_wgsl.py macro 1024 1024 32` | sustained factor = 4·t_A / t_C |

Run A is about 1.12 billion rays; research 15 predicts 11–37 s. A "device lost" is not a result: each pass is a whole frame, so rerun at 512.

**What F0 can decide.** It times a one-stone, mirror-metal toy against a whole renderer on the same toy scene, so t_A ≤ t_B is a screen, not a like-for-like win. **Red is conclusive** (a toy that is too slow does not get faster with features). **Green is necessary, not sufficient:** it says nothing about many stones, rough metal, the browsers' compilers or speed at equal quality. Those are F0b and F1.

**F0b (step 4): like for like.** The spike gains a 200-stone pavé band and GGX rough gold, in both engines. Measured on the lab Mac and the Air: error against a converged reference **at equal seconds**, per mask; and the pavé band's ray rate. **F1 (step 4):** the same kernel as a bench page in the lab's four browsers: time, cold compile time, device loss in 5 minutes, the frame time of a WebGL view orbiting on the same page, GPU memory at 2048 px with 2 M synthetic triangles.

| At gate P | Rule | Then |
|---|---|---|
| **Red** | F0: t_A > 120 s, or > 2·t_B, or no Metal in wgpu and in Chrome. Or F0b: error at equal time over 3 × Cycles | Stop plan A. Founder chooses plan B or server-first. Kept: steps 1–3 |
| **Green** | F0: t_A ≤ 45 s and ≤ t_B. F0b: error at equal time ≤ 1.5 × Cycles on both scenes; pavé rate at least half the one-stone rate. F1: Chrome within 1.3 × t_A; compile ≤ 3 s `[E]`; orbit ≤ 33 ms at the 95th percentile; no device loss; ≤ 400 MB | Steps 5–9 |
| **Amber** | Anything between | The founder chooses on the numbers: a Draft-only build (steps 5–9 against amber marks: Draft at 768 px in 30 s, no 60 s mark), plan B, or server-first. Path compaction is no promised rescue: it is a change of architecture |

### 4.3 Contained scope

| Area | Stage 1 | Later |
|---|---|---|
| Metals | The library's colours for every metal and plating; GGX roughness, never zero, with the worker's own energy setting; one conductor model: F82 tint per wavelength from two tables per metal (reflectance at 0° and 82°) | Stage 2: brushed, hammered, matte; pure-metal tables from measured data |
| Karat alloys | No measured n, k exists for 18k or 14k; mixing models miss by a factor of two `[V]` (14 §4.6). So: a smooth spectrum fitted at build time to the library's RGB values, provisional as today | **Calibration:** one spectrophotometer session on polished swatches (each karat and colour, rhodium over white gold). The curve is the 0° table; integrated, it updates the RGB values the viewport and Blender use |
| Stones | Plane sets or mesh (§2), opaque polished stones as surfaces, exact Fresnel, total internal reflection, absorption by path length; a metal hit from inside a stone is metal; stones never nest, and where two touch the first entered wins. **Depth** (measured in 14 §4.2): a diamond still holds 10 % of its light after 8 internal hits, 4 % after 16, 2 % after 32; a sapphire 1.4 % after 8. So Drafts trace 16, Standard and Final 32, with roulette after 8; what remains goes to the ambient light, never black | Stage 2: pearl, opal, turquoise approximated; the cabochon. Stage 3: Sellmeier fits; absorption by stone size (mean path 2.2 diameters in diamond, 1.3 in sapphire) |
| Fire | Cauchy index from the stored index and Abbe number, one stratified wavelength per path. Off in Drafts; on only where the compiler says (§2), so Blender, the reference and ours agree and no stone switches mid-animation | Stage 3 tunes the threshold (`[E]` 24 px) |
| Light, ground | The six looks as they are, with direct-light sampling; grounds none, shadow, sweep, black acrylic. Every look already has the black card on the lens axis that draws a brilliant's arrows (`LENS_FLAG`, `looks.ts`) | |
| Caustics | Plain path tracing | **Stage 3: a photon pass aimed at stones**: from each light toward each stone's bounding sphere, at one wavelength, splatted on the ground. Opt-in per look, Final only. (Cycles' shadow caustics need smooth casters; path guiding is CPU only `[V]`) |
| Camera, output | The orbit rig exactly, roll, thin-lens depth of field. Open Image Denoise with albedo and normal guides, lighter on stone pixels. Sum in CIE XYZ; Neutral and AgX as the looks set them; backdrop after the view transform; PNG with alpha; mask | Rack focus; facet id as a denoise guide; glare; 16-bit. Stage 4: rigid motion, per-frame denoise, video |

**Left out:** node graphs, image textures, HDRIs, random-walk subsurface, birefringence, fluorescence, inclusions, spectral absorption, motion blur, EXR, deformation, volumes, hair.

### 4.4 Other hard parts

1. **No WebGL2 tracer.** Research 18 §9.2 asks for WebGL2 with WebGPU as an upgrade. That holds for the studio, not the path tracer: a second shader back end doubles kernel upkeep for a shrinking group (decision 5).
2. **View transforms.** Gates compare linear images through one shared transform. Neutral against Blender's is measured on a ramp (mark 2/255). AgX uses the viewport's approximation, so the one AgX look sits out the blind comparison; Blender's colour tables are not copied.
3. **Same pixels.** Seed 0, a hash of pixel and sample index, ordered sums, stop decisions at fixed sample counts: per machine and browser `[E]`, within 1/255 after the denoiser.

### 4.5 Security, safety, privacy

A take is delivered only by its lease holder. Client `scene` and `critique` are parsed and bounded; the sentence the assistant reads is rebuilt on the server from issue codes. `previewAssetId` gets the ownership check `assetIds` has; adapter strings are length-bounded. Kernels, weights and the ONNX runtime's WASM load from our own origin (tested); a headless-Chrome node, if ever used, loads the kernel from its own package. The kernels reach every browser as readable WGSL; the design never leaves the machine. Time caps: Draft 1 minute, Standard 10, Final 30, animation 3 hours `[E]`.

### 4.6 Licences

- **Runtime:** Dawn in Chrome (BSD-3); the `webgpu` npm package 0.6.2 (MIT) for a headless host `[V]`. wgpu (MIT or Apache-2.0) and wgpu-py (BSD-2) `[V]`: CI and spike only.
- **Denoiser:** Open Image Denoise 2.5.1 and its weights, Apache-2.0 `[V]`; the weights are converted to ONNX, so ship the NOTICE and say so. ONNX Runtime's web build, MIT `[V today]`, single-threaded (threads need cross-origin isolation). The open project pairing the two (MIT, no release `[V]`) is read, not used.
- **Video:** WebCodecs `VideoEncoder` (Chrome 94, Safari 16.4, Firefox 130 `[V]`) with the platform's H.264 encoder, else VP9 or AV1 in WebM (`isConfigSupported`); we ship no codec. The MIT MP4 muxer is deprecated; its successor is MPL-2.0 `[V]`: usable unmodified in a closed product if its notices are kept and any change to its own files is published. The H.264 patent pool changed its streaming terms in 2026 `[V]`; whether hosting customers' H.264 files needs a licence is for counsel.
- **Data:** refractiveindex.info, CC0 with a citation request `[V]`, for pure-metal tables and gem index fits (never Palik's book). Colour matching: the Wyman, Sloan and Shirley (2013) fit, `[E]` as published constants, cited; CIE's own table shows only a copyright notice `[V]`; for counsel. No HDRIs: looks are procedural.
- **Not in the tracer:** Mitsuba 3 (BSD-3) and Cycles through the worker (GPL, own process) are references; three.js and three-mesh-bvh (MIT `[V]`) stay in the viewport. The spike's gold table, typed from memory, is replaced.

**The GPL boundary.** Nothing GPL runs in a Pavé process. Blender and `workers/render` stay a separate program, started with a job file and a model file. The reference mode is added inside `workers/render`, under its licence. From step 3, CI fails if anything outside `workers/render` and `docs/research/spikes` imports `bpy`, and scans shipped packages for GPL. `workers/render/LICENSE` is a notice, not the licence text; GPL-3.0 section 4 asks that recipients get a copy `[V]` (request 1). Not legal advice.

### 4.7 Render nodes, and what they cost

When hosting exists, a still can render in the person's browser with no node. Nodes are for animation first, Finals above 2K, and machines with neither WebGPU nor Blender. **Nodes run Cycles:** on an L4 at $0.80 an hour `[V]` a Final 2K still costs 2–3 cents and a 5-second turntable 20–55 cents `[E]` (18 §7.3), up to five times that with the non-preemptible (3 ×) and region (1.15–1.75 ×) multipliers `[V]`. Our kernel on a node waits for a trigger (§6).

### Decisions that are the founder's

1. **Plan A or plan B.** A: 34–46 calendar weeks to animation `[E]` (§7), reach into the browser and hosted GPUs, kernels readable by anyone. B: 8–12 weeks `[E]`, native only. A late switch costs up to 18 weeks of A, then B. Recommended: A, behind gate P.
2. **The GPU lab:** about €150–170 a month `[E]`, on your accounts. Recommended: yes; without it plan A should not start.
3. **What is free and what is paid.** A take rendered in the person's own browser cannot be metered, locally or hosted: the pixels exist before the server hears of them. (a) Own-GPU renders are free for good, Drafts to Finals; the allowance and Pro keep covering Blender takes, and node renders (animation, above 2K, batches) are the metered product. (b) Standard and Final count like Blender takes from the day they ship, at `renders.create`: an honour system, as local Blender is (research 20 §4.4). (c) Count only when hosted. Recommended, and the shipped default: (a), the only line that can be enforced, and one that never flips. Its cost: once ours matches Blender, local rendering is free in practice and render revenue is nodes and exports.
4. **The name on the tile** (recommended: "Pavé Render", `'pave'`) **and what Automatic picks** (recommended: Blender when installed until gate 2, ours otherwise; after it, ours unless the person chose Blender).
5. **Launch scope and the reference Air** (which model, memory, macOS). Recommended: 8 GB stays the target; Apple silicon first. Windows with a graphics card is smoke-tested on every commit but carries no marks until stage 2. Intel laptops: buy or borrow one for gate P, or they are told plainly to use Preview or a render machine. No WebGPU (Safari before 26, ARM Windows): Preview, Blender or a node. iPad: out.
6. **The bar and the judges.** Research 14 asked whether the bar is a leading commercial renderer's stills or "good enough without leaving the CAD". Recommended: hard to tell from studio photographs of comparable pieces at web size (§5), judged by five or more working jewelers, on photographs you supply and may use, kept out of the repository; a commercial renderer's output only if its licence allows.
7. **Alloy swatches** measured once, before gate 2 (recommended: yes). **People:** a graphics engineer, or agents with the lab and a person who judges images at each gate. **Counsel:** the notices, the colour-matching fit, H.264 on a hosted service, plan B's libraries.

## 5. Verification

**Metrics** (`tools/render-ref/`, mirrored in `metrics.ts`), each per mask (stone, metal, ground), never whole-frame alone:

- **Distance D:** both linear images through one display transform, 4 × 4 block means, mean absolute difference.
- **Metal colour:** mean linear colour on the metal mask against the reference, each channel within 3 % and ΔE2000 ≤ 2; and each pure-metal table reproduces the colour computed from the measured data within ΔE 1, independent of Cycles. The spike's gold (green 7 % low `[V run]`) fails.
- **Fire:** inside the stone mask at full resolution, mean chroma within 20 % of the reference and a chroma-weighted hue histogram within 0.25 of it `[E]`.
- **Noise at equal time** against Cycles on Metal, on the lab Mac and the Air.

**References and caps.** A fixture is a `ResolvedScene` plus geometry. The reference is Cycles in the worker's reference mode at 1024 px, rendered **twice with different seeds** on the lab's T4 until the two agree to 0.002 per mask: that distance is the fixture's noise floor. Each fixture also gets **negative controls** from the same engine: fire off, depth cut to 8, roughness zero, metal hue shifted like the spike's gold. A cap is the floor plus a third of the smallest control effect in that mask, so every cap is tighter than the effect it protects; each control must fail its gate, or the gate is tightened. Research 15's 0.012 is no cap: it is larger than fire itself (0.011 `[V run]`). Mitsuba keeps one job: the physics check on the spike scenes, where it agreed with Cycles `[V run]`. A full set, about 60 images, is 7–14 hours of T4: $5–10 `[E]`. **Fixtures:** round solitaire, hero and face-up; oval solitaire (mesh path); emerald cut with coloured side stones; 200-stone pavé band in platinum; bezel and channel set (touching stones); satin band; black acrylic; white catalogue; later a brushed band and a pearl; a 2,000-stone piece for timing.

| Gate | Pass marks |
|---|---|
| **0. Harness** (step 3) | Floors and caps frozen for every fixture; every control fails; each visibility rule measured in Cycles; the `bpy` and GPL scans pass in CI |
| **1. Stills** (step 9) | Every stage-1 fixture inside its caps on D, metal colour and fire, **on the lab Mac in Chrome and Safari; compiles and runs on Direct3D 12**. Noise at equal time ≤ 2 × Cycles on Metal (solitaire, pavé band). Subject box within 1 % of `predictFraming`; arrows visible face-up. On the Air: Draft at 1024 px ≤ 20 s on the solitaire, ≤ 30 s on the pavé band, ≤ 60 s on the 2,000-stone piece `[E]`; 256 samples at 1024 px ≤ 60 s on the solitaire close-up; first true viewfinder image ≤ 1.5 s after rest; §2's memory mark; orbiting the CAD view ≥ 20 frames a second during a take. Same pixels on a re-run, across slice sizes and after `device.destroy()` mid-take. **First panel:** three jewelers see six Drafts beside photographs and say what is wrong, for the gate report |
| **2. Quality** (step 11) | Noise at equal time ≤ 1.25 × Cycles; caustic energy within 10 % of a light-tracing reference. **The comparison:** ten pieces fixed now (round solitaire, yellow gold; pavé band, platinum; three-stone with sapphire; emerald cut; oval halo, rose gold; bezel pendant; brushed band; pearl studs; eternity band on black acrylic; a face-up brilliant), five or more jewelers. *Arm 1, photographs:* our Finals mixed with studio photographs of comparable pieces; "photograph or render?" Pass: ours are called photographs at least 60 % as often as the real ones `[E]`. *Arm 2, Blender:* forced choice, no "no difference"; pass: ours chosen in at least 45 % of answers, and on no piece does Blender win four raters in five |
| **3. Animation** (step 12) | On the Air: 150 frames at 1080 × 1080 in ≤ 60 minutes, a motion draft in ≤ 6 (both re-set once from gate P's sustained rate, then frozen); flicker in static regions within 10 % of a 30-frame Cycles reference, and temporal energy inside the stone mask within 25 % `[E]`; no loop seam; a reload at frame 70 resumes at the first missing frame; the panel watches two turntables |

**Automated.** Vitest: the per-unit plane test (§2's list is its golden); packing goldens; BVH against brute force; spectra back to RGB within ΔE 0.5; `metrics.ts` (written from `RenderMetrics` in `assess.ts`, not translated from the GPL `metrics.py`) agreeing with it within 1 %; tiers and cache key; `engineFor` over every capability. Server harness: claim, heartbeat and complete with epochs, a stale epoch refused, park and unpark, asset ownership. Screenshots of every new state, light and dark. **Review lenses:** optics; security and cost; the first hour with no Blender; premium design; all reproduced on the lab. **By hand, the founder can:** run F0; open the bench page; watch a framed ring develop; wipe a take against a Blender take; orbit during a take; pause and resume.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| A WebGL2 port of the tracer | Over one first-hour session in ten lacks WebGPU |
| Our kernel on render nodes (step 13: a day proving Dawn finds the T4, then the runner in `apps/node` and an engine-neutral `queue.ts`; 3–5 weeks `[E]`; after deploy plan step 8) | A node Final must match local Drafts exactly, or nodes without Blender are wanted |
| Convex facets for oval, pear, marquise, trillion and cushion in the kernel | A CAD-lane item; those cuts then take the faster plane path with no renderer change |
| Stills above 2048 px on the laptop; the viewport's gem shader on planes | After gate 1, if asked; any time after step 5 |
| Birefringence, spectral absorption | The founder names moissanite doubling or alexandrite colour change a goal |
| HDRI import, custom lights, EXR; hardware ray tracing | As in `render-and-models.md`; with a native host |

## 7. Build order

Tests first. Effort is `[E]` build time for one graphics engineer, or agents with the lab. **Sum: 25–33 weeks to animation, 28–38 with headless (step 13, §6)** (research 15: 19–27, ±50 %; added: the lab, a harness twice the size, mesh stones, the lease plumbing). Every item also gets review and fix rounds, and gates wait on founder sessions, two panels and the swatch session: **plan on 34–46 calendar weeks to animation, 22–28 to Drafts in the product** `[E]`.

**Now, in parallel:** F0 (founder, an hour) and step 1. Steps 2 and 3 serve plan B too. Step 4 is the only plan A spend before gate P; step 5 on waits for it.

| # | Delivers | Files | Tests and "done means" | Effort | Needs |
|---|---|---|---|---|---|
| 1 | **Fix now: stones in Blender takes go dark too early.** Cycles counts an internal reflection as a glossy bounce `[V]`, and the tiers cap glossy at 12 and 16. Set glossy equal to total; version the cache key; give the Preview still's hero stones 8 bounces, not 6 | `packages/render/src/quality.ts`, `engines/render/queue.ts`, `features/render/shot-renderer.ts` | Before and after renders of the fixture solitaire close-up, same seed: brightness inside the stone mask rises, distance to a depth-64 render falls; the time change is recorded, not gated. Both images in the handoff | 1–2 days | |
| 2 | **The GPU lab.** Both machines rented; a script that, per commit, runs a WebGPU page in the four headed browsers and returns JSON and images; F0 repeated there; the worker rendering on Metal and on the T4 | `tools/gpu-lab/` | Done: a commit to a test branch yields results from four browsers with no person involved. If it cannot be automated, stop and report | 3–5 days | Decision 2 |
| 3 | **Reference harness.** The worker's reference mode (GPL side); fixtures; the four metrics; twin references, negative controls, floors and caps; visibility rules measured in Cycles; the `bpy` and GPL scans; comparison pages; notices | `tools/render-ref/`, `workers/render/pave_worker/render.py`, `job.py` | Gate 0. `pnpm ref:check` passes on a clean clone with no Blender | 3–4 weeks | 1, 2 |
| 4 | **F0b and F1.** The spike with a pavé band and rough gold in both engines; the bench page, the probe, `renders.reportDevice` | the spike folder, a `bench` route, `engine-probe.ts` | The gate P report, with every JSON line and image, for the founder | 1–1.5 weeks | 2; F0 not red |
| 5 | **Geometry and packing.** Plane lists with the per-unit test, mesh stones, packing, BVH, spectra, the fire rule in the compiler, the visibility rules in `types.ts` | `kernel/src/gems/planes.ts`, kernel `types.ts`, `render/src/trace/`, `resolve.ts` | §5's tests. Every fixture packs inside WebGPU's default limits | 1.5–2 weeks | Gate P |
| 6 | **Kernel.** Camera with depth of field; plane and mesh stones under the instance structure; fire; metal BVH; the conductor model; the looks' lights with direct-light sampling; three grounds; hero wavelengths; mask and guides | `trace/kernels/*.wgsl` | On every commit, on the lab: compiles and runs in Chrome and Safari on Metal and in Chrome on Direct3D 12; fixtures within twice their caps undenoised; the equal-time trend against Cycles posted | 5–6 weeks | 3, 5 |
| 7 | **Host.** Slices, worker, read-back, checkpoint, device-loss recovery, view transforms, metrics | `trace/host.ts`, `schedule.ts`, `post.ts`, `metrics.ts`, `path-worker.ts` | On the lab: same pixels across slice sizes; destroy and resume; orbit frame time during a render | 2 weeks | 6 |
| 8 | **Denoise.** First a bake-off: the browser path against native Open Image Denoise on the fixtures' noisy buffers; then tiling and stone weighting | `trace/denoise/` | On the lab: within D 0.002 of native; ≤ 5 s at 2048 px `[E]`; ≤ 250 MB. Failing that: our own convolution kernels in WGSL | 1–1.5 weeks | 7 |
| 9 | **In the product: Drafts and the developing viewfinder.** The `'pave'` engine on `work` rows, pause, captions, the dialog, per-device estimates, the assistant's wording | studio `features/render/*`, `handlers/render.ts`, schema, `packages/agent` | **Gate 1** and its panel. Useful alone: true-light Drafts on a machine with no Blender | 2–2.5 weeks | 7, 8; deploy plan step 1 |
| 10 | **Stage 2.** Brushed, hammered, matte; measured pure-metal tables; surface stones, the cabochon; Standard and Final on | `trace/kernels`, `spectral.ts`, `settings.ts` | The brushed band inside its caps; a pearl judged by eye and named an approximation | 3–4 weeks | 9 |
| 11 | **Stage 3.** Fire threshold, Sellmeier fits, absorption by stone size, the photon pass, facet-aware denoise, glare; alloy tables if measured | `trace/kernels`, `materials/gems.ts`, `looks.ts` | **Gate 2** | 3–4 weeks | 10 |
| 12 | **Stage 4: animation.** Motion draft, frame loop, stable noise, per-frame denoise, video, kept frames, warm-rate estimates, the 3-hour stop | `path-takes.ts`, `trace/host.ts`, `takes.ts` | **Gate 3** | 3–4 weeks | 9 |

**The plan B switch is a gate, not a clock.** The gate-1 review is held when step 9 is done, or 18 weeks after step 5 starts (the 14-week upper estimate plus four), whichever comes first. The lane lead writes the report: every mark, pass or fail, with images. **The founder decides.** Switch if any holds: noise at equal time worse than 2 × Cycles on both gate fixtures, or 3 × on either; a Draft mark missed by more than double; under two thirds of stage-1 fixtures inside their caps. The equal-time trend is posted from the first kernel commit, so the efficiency bet is visible weekly; a review at week 8 reads it and, if it is poor, starts Cycles' trial build on the lab Mac. Kept under plan B: steps 1–3, the engine value and the captions.

**Requests to the integration lane.**

1. Add the full GPL-3.0 text to `workers/render/LICENSE` (today's notice stays above it) before the worker is distributed.
2. Step 1 and step 3's worker reference mode, if this plan's lane may not touch `packages/render` or `workers/render`.
3. The spike's `render_cycles.py` imports `bpy`: keep it out of shipped packages and `tools/`; give it a GPL header if that folder is published.
