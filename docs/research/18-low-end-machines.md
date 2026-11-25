# 18 — Low-end machines: CAD viewports and rendering on a 2023 MacBook Air, and what to move to a server or GPU later

Research date: 2026-11-25. Scope: the machines Pavé must stay smooth on (the 2023 MacBook Air first, 8 GB Windows laptops with integrated Intel graphics second, iPad as a stretch); what the repository already does for them and what is missing; budgets for the viewport, the kernel and Blender on those machines; and which workloads should move to a server or a rented GPU, with prices read today. Builds on [`03-rendering.md`](./03-rendering.md), [`05-platform.md`](./05-platform.md), [`01-cad.md`](./01-cad.md) §4, and the plans [`deploy-and-durable-jobs.md`](../plans/deploy-and-durable-jobs.md), [`cad-workspace.md`](../plans/cad-workspace.md) and [`freeform-cad.md`](../plans/freeform-cad.md). The renderer of our own is topic 15; this file only gives it the machine constraints.

**How to read the evidence.** `[V]` = I opened the page this session and the claim is on it (link beside it). `[S]` = seen only in a search result. `[E]` = my estimate or working knowledge, with what it rests on. `[R]` = read in the repository; paths under `ref:` are in the assistant-build export (`/home/claude/ref/assistant-build`), which is newer than this branch. No GPU was available here, so every frame-rate and render-time figure for the Air is `[E]` until the founder runs §9.3. Prices were read on 25 November 2026.

## 1. The short answer

- **The Air is a good CAD machine and a poor render machine.** Its GPU matches a GTX 1650-class card in raster tests `[V]`, which is plenty for a viewport that draws on demand. In Cycles it scores 302 (8-core GPU) or 354 (10-core) on Blender Open Data, against 2,285 for an RTX 3060 and 3,132 for an RTX 4060 `[V]`: six to nine times slower. Its own CPU scores 109 `[V]`, so Metal is still worth three times the CPU.
- **No fan means two speeds.** The M2 may draw about 20 W in a burst and about 9 W sustained `[V]`. In a 30-minute Cinebench loop an M2 Air lost about 15 % `[V]`; under a combined CPU and GPU stress test the package fell from a 33 W peak to under 9 W `[V]`. A one-minute still runs in the burst. A turntable does not. Plan every long job at the sustained rate.
- **8 GB is the real limit, not the GPU.** An 8 GB M2 Air has failed Metal renders with memory peaking near 13.8 GB, and Blender does not treat running out of memory as a bug `[V]`. Pavé on one laptop is a browser tab, up to two WASM kernels in it, a Node server, up to two more kernel workers, and Blender. Nothing today budgets them together.
- **The repo's light-machine work is real and the right shape** `[R]`: on-demand drawing with zero idle frames, a frame-time governor that drops pixel ratio first and effects second, a Retina cap of 1.5, a per-device Performance setting, an integrated-GPU tier, instanced gems sharing one BVH, a memory-sized server kernel pool, and Metal first on a Mac. It was measured on a software rasteriser with a slowed CPU, never on a real Air.
- **What is missing:** a real-hardware measurement; a memory budget across processes; recycling of the *browser's* kernel worker; level of detail for small stones by pixel size; progressive refinement when idle; a render tier sized for one minute on the Air with a hard time cap and a thread cap; a memory guard on render size; and any path for a machine without Blender beyond the WebGL preview.
- **WebGL2 stays the baseline; WebGPU is now a safe enhancement on these machines.** Chrome and Edge have shipped it on Windows and macOS since version 113; Safari 26 has it on macOS 26 and iPadOS 26; Firefox has it on Windows (141) and on Apple-silicon Macs (147 on every macOS version) `[V]`. Figma ships both back ends and falls back to WebGL mid-session `[V]`; copy that pattern when the WebGPU path tracer arrives.
- **Keep the kernel single-threaded in the browser.** WASM threads need cross-origin isolation `[V]`, which blocks the Design board's third-party images unless every one is proxied. Parallelism comes from several workers, which exists.
- **What moves to a server, in order:** animations first, then final stills above 2K, then anything on a machine with no usable GPU or no Blender. Interactive modeling never moves: a streamed viewport would cost about $70 per active designer a month in GPU alone `[E]`, on a product whose CAD is free.
- **Rent by the second.** Render.com still has no GPU `[V]`. Modal lists an L4 at $0.80 an hour and RunPod a 4090 at $0.89 to $1.34 `[V]`. An L4 scores 3,599 on Blender Open Data, ten times the Air `[V]`. That puts a final 2K still at about 2 cents and a 5-second turntable at about 15 to 55 cents on an L4 or a 4090 `[E]`. Blender render farms and cloud Macs fit worse and cost more (§7).
- **One decision is needed first:** which Air the founder has (13 or 15 inch, 8 or 16 GB, 8 or 10 GPU cores). Every pass mark in §9.3 depends on it.

## 2. The target machines

| | MacBook Air 13" (M2, 2022; the model on sale through 2023) | MacBook Air 15" (M2, June 2023) | Typical 8 GB Windows laptop | iPad (stretch) |
|---|---|---|---|---|
| Chip | M2, 8-core CPU (4 performance, 4 efficiency) `[V]` | Same `[V]` | Intel 11th to 13th gen U-series `[E]` | iPad Air 13" (M2): 8-core CPU `[V]` |
| GPU | 8-core, option 10-core `[V]` | 10-core only `[V]` | Intel UHD or Iris Xe, integrated `[E]` | 9-core `[V]` |
| Memory | 8 GB unified, option 16 or 24 `[V]` | 8 GB at launch ($1,299 base) `[V]`; Apple's page now lists 16 GB as standard `[V]` | 8 GB shared with the GPU | 8 GB `[V]` |
| Display | 13.6", 2560 × 1664, 224 ppi `[V]` | 15.3", 2880 × 1864, 224 ppi `[V]` | 1920 × 1080 at 100–150 % scaling `[E]` | 2732 × 2048 `[V]` |
| Cooling | None: passive `[V]` | None `[V]` | One small fan `[E]` | None |
| Battery | 52.6 Wh `[V]` | 66.5 Wh `[V]` | 40–55 Wh `[E]` | — |

Sources: Apple tech specs for the [13-inch](https://support.apple.com/en-us/111867) and [15-inch](https://support.apple.com/en-us/111346) Air and the [iPad Air 13-inch (M2)](https://support.apple.com/119893) `[V]`; launch price and 8 GB base of the 15-inch from [Notebookcheck's review](https://www.notebookcheck.net/Apple-MacBook-Air-15-2023-M2-review-The-everyday-MacBook-now-in-15-inches.726811.0.html) `[V]`; passive cooling from [Macworld](https://www.macworld.com/article/821312/m2-macbook-air-throttle-overheating-design.html) `[V]`.

**What the display means for pixels.** macOS runs the Air at a pixel ratio of 2. In the default scaled mode the 13-inch desktop is about 1470 × 956 points `[E, the macOS default]`. A viewport taking 70 % of that window is about 1030 × 800 points: 3.3 million pixels at ratio 2, 1.85 million at 1.5, 0.82 million at 1. The Retina cap of 1.5 therefore removes 44 % of the pixels before any governor acts.

**Thermal behaviour, with evidence.**

| Measurement | Result | Source |
|---|---|---|
| M2 power limits | about 20 W short burst, 9 W sustained; GPU about 13.5 W at load | [Notebookcheck](https://www.notebookcheck.net/Apple-MacBook-Air-M2-review-The-faster-10-core-GPU-isn-t-worth-it.640427.0.html) `[V]` |
| Combined CPU and GPU stress test, 10-core model | package peaks near 33 W, settles under 9 W; average 10.4 W; GPU peaks 13.3 W, averages 4.3 W | same `[V]` |
| 10-core GPU's lead over the 8-core | about 19–20 % in a short run, about 9 % after a few minutes | same `[V]` |
| Case temperature under load | up to 44.7 °C top, 44.6 °C bottom | same `[V]` |
| Cinebench looped for 30 minutes | M2 Air loses about 15 %, M1 Air about 10 %; average core temperature 105 °C after the first run | [MacRumors forum test](https://forums.macrumors.com/threads/my-cinebench-throttling-tests-m2-vs-m1-macbook-airs.2377984) `[V]`, one user's test |

Reading: CPU-only work loses 10–15 % over half an hour. Work that loads CPU and GPU together loses much more, because both share one 9 W envelope. For a long Cycles animation I plan on 60–70 % of the first minute's speed `[E, from the power figures above; to be measured in §9.3]`. The extra two GPU cores buy little once the machine is warm.

**The Windows laptop.** Intel's own support note says a machine with single-channel memory reports "UHD Graphics" instead of Iris Xe, and its example is an 8 GB system ([Intel](https://www.intel.com/content/www/us/en/support/articles/000094617.html) `[V]`). So the cheapest 8 GB laptops get the slower graphics mode. In Cycles, "Intel Iris Xe Graphics" has a median Open Data score of 101 from 10 runs `[V]`: about the same as the M2's CPU and 3.5 times slower than the M2's GPU. Blender renders are not practical there. Raster speed is roughly half an M2 `[E, from general benchmark knowledge; Notebookcheck's Iris Xe page would not open]`. This is the machine the `low` tier and Smooth mode exist for.

**iPad.** Rhino does not run on iPad at all ([McNeel](https://www.rhino3d.com/8/system-requirements) `[V]`). Shapr3D does, with a native Parasolid kernel ([Siemens case study](https://resources.sw.siemens.com/en-US/case-study-shapr3d) `[V]`). Pavé in Safari on iPadOS 26 gets WebGL2 and WebGPU `[V]`, but the page's process has a hard memory limit: a WebKit engineer puts it in the "4GB+ range" on an 8 GB iPad, with typed arrays capped near 2 GB, and a tester measured 1.88 GB usable ([WebKit bug 268816](https://bugs.webkit.org/show_bug.cgi?id=268816) `[V]`). An iPad can therefore be a viewer and a light editor with one draft kernel. It cannot run Blender, so renders there need the browser renderer or a server.

## 3. What the repository does today for light machines

All of this is on the assistant-build branch (commit "CAD that stays smooth on a light laptop…", 25 Nov) `[R]`. This research branch does not have it yet: its `apps/studio/src/components/stage/` has no `adaptive.ts`, and its pool still uses `min(4, availableParallelism() - 1)`.

| Area | What exists | Where (`ref:`) |
|---|---|---|
| Draw on demand | One `requestAnimationFrame` per invalidation; nothing drawn while nothing changes; camera-controls events schedule frames | `apps/studio/src/components/stage/viewer.ts` (`invalidate`, `tick`) |
| Frame-time governor | `AdaptiveQuality`: target 30 fps while moving. A slow frame cuts the moving pixel ratio in one step of at most 40 % (floor 0.5, steps of 1/8). At the floor, effects step `full → reduced → minimal`. Six fast frames raise the ratio again; 30 restore effects. What was learned carries to the next piece | `stage/adaptive.ts` |
| Still picture | Full effects at the device ratio, capped at 1.5 in Auto and by GPU tier. Sharpens 150 ms after the camera rests. A machine whose still frame takes over 80 ms draws every edit light first | `adaptive.ts`, `viewer.ts` (`stopMoving`, `SLOW_STILL_MS`) |
| Scrub detection | Evaluations under 600 ms apart count as a scrub: drawn light, refined 250 ms after the last | `viewer.ts` (`SCRUB_GAP_MS`) |
| Performance setting | Auto, Smooth (ratio 1 still, 0.75 moving, reduced effects), Sharp (device ratio up to 2, never reduced). Stored per device in the browser. A chip in the view says when quality is reduced | `stores/performance.ts`, `stage/QualityIndicator.tsx`, Settings › General |
| GPU tiers | `software` (SwiftShader, llvmpipe, Basic Render, or the browser's performance caveat), `low` (Intel, Mali, low Adreno, "Apple GPU", base Apple M chips), `high`. Low: ratio cap 1.5, hero stones 5 bounces with dispersion at rest and 2 moving, melee 2 and 1, melee budget 600 stones | `stage/quality.ts` |
| Gems | Our own BVH refraction shader on `InstancedMesh`, one batch per cut, material and tier; bounces are a uniform, so changing them does not recompile | `packages/render/src/three/gem.ts`, `evaluation.ts` |
| Environment | PMREM from the light rig at 256 px, 128 on software or struggling machines; rebuilt only when the piece's size changes by 30 % | `viewer.ts`, `three/environment.ts` |
| Shadows | CAD view: a static contact-shadow texture, shadow maps off. Render preview: one 1024 VSM map, reused while only the camera moves | `viewer.ts`, `three/stage.ts`, `features/render/shot-renderer.ts` |
| Glass chrome | Frosted glass switches to solid fills in Smooth or when Auto had to lower effects | `QualityIndicator.tsx` (`useSolidGlass`) |
| Picking | CPU raycast through three-mesh-bvh; BVHs built in idle time | `viewer.ts` |
| Browser kernel | One draft worker and a lazy production worker (stopped after 60 s idle); latest-wins scheduler; parts sent only when their `rev` changed; watchdog 45 s draft, 15 min production; one respawn | `apps/studio/src/lib/kernel/{client,scheduler}.ts`, `packages/kernel/src/client.ts` |
| Tessellation | Draft chord 0.02 mm and 0.35 rad; production 0.005 mm and 0.3 rad; never finer than 1/10,000 of the body | `packages/kernel/src/solid/solid.ts` |
| Cancellation | Evaluation yields every 12 ms and checks for abort between nodes | `packages/kernel/src/evaluate/yield.ts` |
| WASM build | Single-threaded OpenCascade and Manifold; no SharedArrayBuffer needed | `packages/kernel/src/runtime/index.ts` |
| Server kernel pool | Sized from cores and memory: 30 % of RAM, one core left free, at most 4. On 8 GB: 2 workers of 1,024 MB with 2 warm pieces each. Workers over budget retire; idle ones stop after 2 minutes; heavy tasks never take the last worker | `apps/server/src/engines/kernel/pool.ts` (`poolDefaults`) |
| Blender device | Metal first on a Mac; `PAVE_CYCLES_DEVICE` overrides; `PAVE_RENDER_THREADS` can cap CPU threads | `workers/render/pave_worker/{devices,render}.py` |
| Render estimates | Learned from this machine's finished takes per device; fallback 0.6 s per million pixel-samples plus 10 s per pass and 2 s per frame | `packages/render/src/takes.ts` |
| Without Blender | A take is drawn by the browser's WebGL renderer, up to 2048 px, stills only | `features/render/browser-takes.ts` |
| Test driver | `apps/studio/e2e/light.ts`: Chromium on SwiftShader, CPU slowed 4×, ratio 2, reporting an M2. Measured: orbit 1.2–2.4 → 22–32 fps; slider step 2.1–2.3 s → 0.24–0.34 s; live preview drag 0.1–0.9 → 2–4 fps | commit message `[R]` |

**What is missing.**

1. **No measurement on real hardware.** The driver is a pessimistic stand-in. Nobody has timed an M2.
2. **No budget across processes.** The browser tab, its two kernels, the server, its pool and Blender each size themselves alone.
3. **The browser's kernel worker never retires.** The server pool recycles workers because WASM heaps never shrink; the studio's draft worker lives for the whole session.
4. **No machine probe in the studio.** Nothing reads `navigator.deviceMemory` or `hardwareConcurrency`. Both are weak signals anyway: `deviceMemory` is non-standard and not Baseline ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory) `[V]`), and WebKit reports only 4 or 8 cores ([WebKit source](https://webkit.googlesource.com/WebKit/+/master/Source/WebCore/page/NavigatorBase.cpp) `[V]`). The local server knows the truth (`os.totalmem()`), so it should tell the studio.
5. **No level of detail by size on screen.** A melee stone 6 pixels wide runs the same BVH shader as one 200 pixels wide. The plan's "cheap env-mapped facets" for small stones was not built; the melee budget only lowers bounces.
6. **No progressive refinement.** At rest the view sharpens once. It never accumulates samples.
7. **Antialiasing is fixed.** The context is created with `antialias: true`, so multisampling cannot be turned off while moving.
8. **No budget warnings.** Triangles and draw calls are not counted in the app (`renderer.info` is unused); only the test driver counts them from outside.
9. **Renders have no laptop tier.** `preview` is 768 px at 64 samples; `standard` jumps to 2048 px at 384. `final` has no size cap. No `time_limit`. `PAVE_RENDER_THREADS` is never set by default, so a CPU fallback takes every core.
10. **No WebGPU path, no OffscreenCanvas, no thermal or battery awareness.** The governor reacts to thermal slowdown through frame times, which is enough for the viewport; renders have nothing.

## 4. The viewport

### 4.1 Budgets for the Air (Auto mode)

These are targets to confirm in §9.3; the basis for each is given.

| Item | Budget | Basis |
|---|---|---|
| Frame time, moving | ≤ 33 ms at the 95th percentile (30 fps) | The governor's target `[R]` |
| Frame time, still | ≤ 80 ms, or draw light first | `SLOW_STILL_MS` `[R]` |
| Idle | 0 frames, 0 animation callbacks | Built and tested `[R]` |
| Pixel ratio | Still 1.5; moving 1.0 down to 0.5 | `[R]`; §2 pixel counts |
| Triangles in view | ≤ 1.5 M typical, warn at 3 M | `[E]`: an M2 raster-tests like a GTX 1650 Ti ([Notebookcheck](https://www.notebookcheck.net/Apple-M2-10-Core-GPU-Benchmarks-and-Specs.632306.0.html) `[V]`); Spline tells its users 50–150 k polygons for the web at large ([Spline docs](https://docs.spline.design/importing-content/cad-to-spline-optimization-best-practices) `[V]`), which is far too tight for CAD but shows the order of magnitude that is safe everywhere |
| Draw calls | ≤ 150 at rest | `[E]`; three.js pays CPU per call. Instancing already gives one call per gem batch `[R]` |
| Gem cost | Hero: 5 bounces with dispersion at rest, 2 moving. Melee: 2 and 1. Over 600 melee: 1 always | `quality.ts` `[R]`; cost grows with gem pixels × bounces × 3 when dispersion is on `[R gem.ts]` |
| Environment map | 256 px PMREM (128 when struggling) | `[R]` |
| Shadow map | None in CAD; one 1024 map in the Render preview, 512 on `low` while moving | `[R]` plus `[E]` |
| Antialiasing | 4× multisampling at rest only when ratio ≤ 1.5; none while moving | `[E]`, see 4.3 |
| GPU memory | ≤ 400 MB of buffers and targets | `[E]`; Onshape warns that under 1 GB of video memory causes context loss ([Onshape help](https://cad.onshape.com/help/Content/Home/hardware_and_graphics_performance_recommendations.htm) `[V]`), and on the Air this memory comes out of the same 8 GB |

### 4.2 Transmission and refraction

three.js says `MeshPhysicalMaterial` costs more per pixel than its other materials and that each effect adds cost when enabled ([three.js docs](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) `[V]`). Its built-in transmission also draws the opaque scene into a separate target first, so draw calls roughly double `[E, from the three.js renderer source as I know it; forum reports of doubled draw calls agree, [thread](https://discourse.threejs.org/t/draw-call-and-triangles-amount-increases-when-having-a-physical-material-with-transmission/46663) [V]]`. Pavé does not use it: the repo's own gem shader traces inside the stone and reads only the environment `[R]`. Keep it that way. The rule for the Air: never put built-in transmission on instanced melee, and keep any future "stones see the metal" cube capture at 128–256 px, refreshed at rest only.

### 4.3 Antialiasing and pixel ratio

- Multisampling on a tile-based GPU such as Apple's is cheap in time but not in memory `[E]`. At ratio 1.5 the 13-inch viewport is 1.85 MP; four samples of colour and depth are about 60 MB `[E, arithmetic]`.
- At ratio 2 (Sharp), multisampling adds little that the eye sees. At ratio 0.5–1 while moving, it costs fill rate the governor is trying to save.
- Recommendation: render into our own multisampled target (WebGL2 supports it) so the sample count can change at run time: 4 at rest, 0 while moving. Then add accumulation when idle (4.5), which gives better edges than either FXAA or TAA with no cost while moving. FXAA blurs fine prongs; TAA ghosts on sparkle `[E]`.

### 4.4 WebGL2 versus WebGPU on these machines

| Browser | Windows | macOS | iPadOS |
|---|---|---|---|
| Chrome, Edge, Electron | WebGPU since 113 (Direct3D 12); Windows on ARM still behind a flag | Since 113, with no macOS version condition listed | Uses WebKit `[E]` |
| Firefox | Since 141 | Apple silicon: 145 on macOS 26, 147 on all versions. Intel Macs: Nightly only | Uses WebKit `[E]` |
| Safari | — | Safari 26 on macOS 26 only | Safari 26 on iPadOS 26 |

Sources: [web.dev, 25 Nov 2025](https://web.dev/blog/webgpu-supported-major-browsers) `[V]`; the [gpuweb implementation-status wiki](https://github.com/gpuweb/gpuweb/wiki/implementation-status), last edited 2 Oct 2026 `[V]`. Linux is partial (Chrome 144 on recent Intel, 147 on NVIDIA under Wayland) `[V]`.

Consequences:
- WebGL2 remains the baseline, as research 05 decided. An Air on macOS 15 has WebGPU in Chrome and in an Electron shell, but not in Safari.
- Figma's account of shipping WebGPU is the model to copy ([Figma](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/) `[V]`): one renderer interface with two back ends, shaders generated for both, start on WebGPU, fall back to WebGL in the same session when a test or a device loss says so, and block device classes with high fallback rates. Their result was better on some device classes, neutral on others, no regressions. They also met mid-session device loss that load-time tests did not predict, mostly on Windows.
- For Pavé the raster viewport gains little from WebGPU today (research 03 found mixed three.js reports). The reason to add it is the path-traced preview (topic 15).

### 4.5 Techniques, in the order worth building

1. **Size-on-screen level of detail for stones.** Per batch, estimate projected width from the camera. Under about 12 px `[R, research 03's figure]`: a plain faceted material with the environment map, no BVH loop. 12–40 px: one bounce. Above: tier quality. This removes most gem cost on a 2,000-stone piece at fit-to-view, where melee is 4–10 px wide `[E]`.
2. **Geometry level of detail for prongs and beads.** A bead 0.4 mm wide needs 8 segments, not 24, until it fills 30 px `[E]`. The kernel can emit two meshes per `meshKey` (it already meshes at two chords `[R]`).
3. **Idle refinement.** After 300 ms at rest, accumulate 8–16 jittered frames into a float target, one per animation frame, stopping at the first input. This gives supersampling at ratio 1–1.5, and room for more gem bounces per pass. It ends with zero frames, so the idle rule holds.
4. **Budget counters.** Read `renderer.info` after each still frame; show triangles, calls and frame time in a `?perf=1` overlay and record them in the test driver.
5. **Antialiasing as a run-time choice** (4.3).
6. **OffscreenCanvas in a worker: not now.** It is Baseline since March 2023 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) `[V]`), but picking, capture, HTML labels pinned to the model and camera-controls all assume the main thread `[R]`. The main thread is not the bottleneck while kernels already run in workers. Revisit only if main-thread long tasks show up in §9.3.

### 4.6 Memory in a tab

- Chrome: the V8 heap is a 4 GB reservation per process, a WASM memory is at most 4 GiB, and the old 4–16 GB per-process sandbox limit on Windows was raised to 1 TB ([Eric Lawrence, updated Nov 2023](https://textslashplain.com/2020/09/15/browser-memory-limits/) `[V]`; [V8](https://v8.dev/blog/4gb-wasm-memory) `[V]`). On an 8 GB machine none of these bind before physical memory does.
- Memory64 is in Chrome 133 and Firefox 134 and in no Safari ([caniuse](https://caniuse.com/wf-wasm-memory64) `[V]`). Do not depend on it. A jewelry piece does not need more than 4 GB of kernel heap; the 320-cutter test in research 01 peaked at 678 MB `[R]`.
- WASM threads need `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; under those, every cross-origin image must opt in or be loaded with CORS ([web.dev](https://web.dev/articles/coop-coep) `[V]`). The Design board shows pasted links from Pinterest and Google. Isolation would break them unless the server proxies every image. Not worth it for the gain in §5.
- Budget for the studio on 8 GB `[E]`: page and GPU buffers ≤ 700 MB; draft kernel ≤ 600 MB, recycled above that; production kernel only while needed. See §9.1 for the whole-machine budget.

### 4.7 How others handle it

| Product | Approach | What to take |
|---|---|---|
| Onshape | Geometry is computed on servers; only changed triangles reach the browser; the local GPU draws, rotates and selects. Their help offers a triangles-per-second check, "Match pixel density" off, coarse tessellation and "shaded without edges" for weak machines ([help](https://cad.onshape.com/help/Content/Home/hardware_and_graphics_performance_recommendations.htm) `[V]`; [blog, 2019](https://onshape.com/en/blog/under-the-hood-cad-performance) `[V]`) | A built-in machine check with a number; pixel-density and tessellation as user-visible levers. Pavé's Performance setting already covers the first two |
| Figma | WebGL and WebGPU side by side with live fallback ([blog](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/) `[V]`) | §4.4 |
| Spline | Publishes hard content budgets: 50–150 k polygons, ≤ 20 materials, ≤ 2 shadow lights ([docs](https://docs.spline.design/importing-content/cad-to-spline-optimization-best-practices) `[V]`) | Budgets shown to the user at import time (meshes brought into Pavé as CAD) |
| Shapr3D | Native app with a native kernel on iPad, Mac and Windows; works offline ([Mac page](https://www.shapr3d.com/mac-os) `[V]`; [Siemens](https://resources.sw.siemens.com/en-US/case-study-shapr3d) `[V]`) | The case for a native kernel in a desktop shell later (§5.4) |
| Rhino 8 on Mac | Moved its display to Metal; McNeel's own table shows 3× to 24× more frames on an M1 Max; 8 GB RAM recommended ([Metal page](https://www.rhino3d.com/features/display/metal/) `[V]`; [requirements](https://www.rhino3d.com/8/system-requirements) `[V]`) | The incumbent treats 8 GB as normal. Our comparison machine is a real one |
| Zoo | The whole viewport is a video stream from a cloud GPU over WebRTC ([docs](https://zoo.dev/docs/zoo-design-studio/features/system-requirements/zoo-stream) `[V]`) | The last resort in §7.4, and why it is last |
| Autodesk viewers | I could not open an engineering note; the Autodesk University session page describes large-model work without detail `[V, no technical content]` | Nothing verified |
| Blender on M2 | Requires 8 GB minimum, recommends 32 GB ([requirements](https://www.blender.org/download/requirements/) `[V]`) | Blender itself calls our target machine the minimum |

## 5. The CAD kernel on a light machine

### 5.1 What OpenCascade in WASM costs

- **Speed.** The standard study found WebAssembly 45 % (Firefox) to 55 % (Chrome) slower than native on SPEC, with peaks of 2–2.5× ([Jangda et al., USENIX ATC 2019](https://www.usenix.org/conference/atc19/presentation/jangda) `[V]`). One OpenCascade forum user reported 5× with an older build, with no reply from staff ([forum](https://occt3d.com/dev/content/webassembly-performance-degradation/index.html) `[V]`). A current third-party benchmark shows OCCT's WASM builds within about 10–45 % of each other on small operations, at 18–27 ms per simple boolean ([brepjs benchmarks, 14 Nov 2026](https://raw.githubusercontent.com/andymai/brepjs/main/benchmarks/results/latest.md) `[V]`). Plan on 1.5–2× native `[E]`.
- **Measured in this repo** (one shared Node core, not an M2) `[R]`: kernel start 0.27 s; 108 seat cutters as one compound cut 2.4 s plus 1.6 s of meshing; 320 cutters 7.0 s plus 6.0 s, 678 MB; the same in Manifold 1.0 s and 2.8 s; a drawn sweep 23 ms; fillets 8–144 ms, but 0.4–7 s and mostly failing where a head meets a band; an exact shank-plus-head union 2.1 s; STEP export 8.1 s; a cached re-evaluation 0.6–1.5 ms. An M2 performance core is faster than that test core, so these are upper bounds for the Air `[E]`.
- **Memory.** WASM heaps never shrink; the JavaScript collector cannot see them `[R, research 01]`. A long session only grows.
- **Threads.** A threaded OpenCascade build exists but needs SharedArrayBuffer and cross-origin isolation, and its documented use is meshing ([ocjs.org](https://ocjs.org/docs/advanced/multi-threading/intro) `[V]`). The Air has 4 performance cores. Meshing is not what makes edits slow; booleans and fillets are, and those are single-threaded per shape `[E]`. Stay single-threaded.

### 5.2 Rules for a light machine

| Rule | State |
|---|---|
| Never run exact booleans per drag. Draft = uncut metal plus instanced gems, or Manifold | Built `[R]` |
| Latest-wins queue; abort between nodes; cache by node hash; send only changed parts | Built `[R]` |
| Draft tessellation while dragging, production only for checks and exports | Built (0.02 mm against 0.005 mm) `[R]` |
| A third, coarser "drag" chord (0.05 mm) for nodes whose closure costs over 150 ms, refined on release | Missing; cheap, since chord is one parameter `[E]` |
| Fillets and shells only in the exact worker, 300 ms deadline, kill and respawn on overrun | Planned in `freeform-cad.md` §4.4 `[R]` |
| Recycle the browser's draft worker when its WASM memory passes a budget (600 MB on ≤ 8 GB), at an idle moment, rebuilding from the node cache | Missing |
| On ≤ 8 GB, never hold the browser's production worker and a server pool worker for the same piece at once | Missing |
| Worker count from cores and memory | Built on the server; the browser is fixed at 1 + 1, which is right for 4 performance cores |

**Two kernels on one laptop.** In local mode the studio evaluates in its own workers, and the server's pool evaluates again for the assistant, exports, render input and packages `[R]`. On 8 GB that can mean four OpenCascade heaps. The pool's 2 × 1 GB default is a sane cap, but the sum is not managed (§9.1).

### 5.3 Manifold

Manifold is the right draft engine on a light machine: 0.18 MB compressed, 20 ms to start, 2–3× faster than the compound exact cut in the repo's test `[R]`. Its WASM build is used single-threaded here `[R]`; I could not confirm from its documentation whether the npm build can run threaded ([performance notes](https://github.com/elalish/manifold/wiki/Performance-Considerations) `[V]` do not mention WebAssembly).

### 5.4 What is worth moving to native or to a server

| Workload | Local WASM on the Air | Native in a desktop shell | Server |
|---|---|---|---|
| Draft evaluation while editing | Yes; it is the product | 1.5–2× faster `[E]`; not needed for the plan's 120 ms target on templates | No: latency and offline use |
| Production check (all seats cut) | Yes, in the background; minutes on a heavily set piece `[R]` | Worth it later: native OCCT can run booleans in parallel `[E]` | Fallback when hosted, through the existing pool |
| STEP and 3DM export | Yes, 8 s class `[R]` | Marginal | Already possible (`design.export`) `[R]` |
| Production package | Yes, up to 15 min allowed `[R]` | Marginal | Good candidate when hosted (`pave-worker`, deploy plan step 9) `[R]` |
| Photo fit | Yes, up to 2 min in a pool worker `[R]` | No | Good candidate when hosted |

A native kernel means a second build of the same C++ and an Electron native module or sidecar per platform. Do it only if §9.3 shows production checks over a minute on common pieces. The server pool gives the same relief with no new code when Pavé is hosted.

## 6. Rendering on the Air

### 6.1 How fast Cycles is on it

Blender Open Data median scores (samples per minute summed over three scenes), read today from the site's query endpoint with its default filters `[V]`:

| Device | Score | Runs | Against the Air's 10-core GPU |
|---|---|---|---|
| Apple M2, CPU | 108.7 | 854 | 0.31× |
| Intel Iris Xe Graphics | 100.9 | 10 | 0.28× |
| Apple M2, GPU 8 cores (Metal) | 301.8 | 89 | 0.85× |
| **Apple M2, GPU 10 cores (Metal)** | **354.4** | 225 | 1× |
| Apple M4, GPU 10 cores | 1,070.9 | 580 | 3.0× |
| NVIDIA Tesla T4 | 1,458.9 | 147 | 4.1× |
| NVIDIA RTX 3060 | 2,284.8 | 6,614 | 6.4× |
| NVIDIA RTX 4060 | 3,131.6 | 2,122 | 8.8× |
| NVIDIA A10G | 3,244.6 | 37 | 9.2× |
| NVIDIA L4 | 3,598.9 | 51 | 10.2× |
| NVIDIA L40S | 9,115.4 | 60 | 25.7× |
| NVIDIA RTX 4090 | 11,678.7 | 9,057 | 33× |

Source: `opendata.blender.org/benchmarks/query/?device_name=…&group_by=device_name&response_type=datatables`, for example [the M2 rows](https://opendata.blender.org/benchmarks/query/?device_name=Apple%20M2&group_by=device_name&group_by=blender_version&group_by=compute_type&response_type=datatables) `[V]`. Medians mix Blender versions. A second source agrees: Blender 3.3 Classroom takes 221 s on the M2's GPU against 32 s on a desktop RTX 3060 with OptiX ([Notebookcheck](https://www.notebookcheck.net/M2-10-Core-GPU-vs-NVIDIA-GeForce-RTX-3060-vs-M2-8-Core-GPU_11368_10960_11375.247598.0.html) `[V]`).

Why the M2 is far behind the M3 and M4: Cycles turns hardware ray tracing (MetalRT) on by default only for M3 and newer ([Blender PR 120299](https://projects.blender.org/blender/blender/pulls/120299) `[V]`).

### 6.2 Memory, start-up and heat

- **Memory.** One 8 GB M2 Air failed GPU renders with usage peaking near 13.8 GB; a 16 GB M1 ran out during an animation with persistent data on; developers answered that out-of-memory is not treated as a bug ([issue 101787](https://projects.blender.org/blender/blender/issues/101787), [issue 110520](https://projects.blender.org/blender/blender/issues/110520) `[V]`). Metal lets the GPU use only part of unified memory; one developer-forum poster believes 75 % ([Apple forums](https://developer.apple.com/forums/thread/732035) `[V, a user's belief, not Apple's statement]`). Jewelry scenes are small (no textures, under a few million triangles), so the risk is image size and passes, not the scene `[E]`.
- **First render.** Cycles compiles its Metal kernels the first time a Blender version runs and caches them. That took about 20–24 s on an M1 Max after a regression to 6 m 45 s was fixed ([issue 100102](https://projects.blender.org/blender/blender/issues/100102) `[V]`). Expect half a minute or more once per install on the Air `[E]`. Pavé should run a tiny warm-up render when Blender is first configured, and say so.
- **Denoising.** Blender 4.1 added OpenImageDenoise on Metal ([PR 116124](https://projects.blender.org/blender/blender/pulls/116124) `[V]`). Research 03 said the denoiser was CPU-only; that is out of date. A 2K denoise should take a few seconds either way `[E]`.
- **Heat.** §2: plan long jobs at 60–70 % of burst speed `[E]`.
- **Intel Macs.** Since Blender 4.3, Cycles on Metal supports Apple silicon only ([Blender forum](https://forum.blender.org/t/cycles-remove-support-of-metal-with-amd-intel-gpus-for-4-3-and-onwards/35098) `[V]`). With bpy 5.3 an Intel Mac renders on CPU.

### 6.3 What fits in a minute

Work is counted in millions of pixel-samples (MPS), as `takes.ts` does `[R]`. The repo's fallback rate is 0.6 s per MPS on CPU, measured on four shared cores `[R]`. For the Air I estimate 0.3–0.6 s per MPS on CPU and 0.1–0.2 on the GPU in a burst, from the 3.3× ratio in 6.1 `[E]`. That is 5–10 MPS per second on the GPU.

| Tier | Size and samples | Work | Air GPU, estimated | State |
|---|---|---|---|---|
| preview (critique draft) | 768 px, 64 spp | 38 MPS | 15–20 s | Exists `[R]` |
| **quick (new)** | 2048 px long side, 96 spp cap, noise threshold 0.03, OIDN, 45 s time limit | ≤ 400 MPS | 50–75 s | **Proposed** |
| standard | 2048 px, 384 spp | 1,610 MPS | 3–6 min; 8–16 min on CPU | Exists `[R]` |
| final | uncapped, 1,024 spp; at 2048 px | 4,295 MPS | 7–15 min; 20–45 min on CPU | Exists `[R]`; needs a size guard |
| 5 s turntable, standard | 150 frames at 1080 px, 192 spp | 224 MPS a frame | 25–45 s a frame at first, up to 70 s once warm: **1–3 hours** | Exists `[R]` |
| 5 s turntable, final | 150 frames at 1920 × 1080, 256 spp | 531 MPS a frame | 55–110 s a frame at first, more once warm: **2.5–7 hours** | Exists `[R]` |

All times `[E]`: fixed cost of 10 s per pass and 2 s per frame from `takes.ts`, plus work at the rates above, with the sustained penalty on the animations. Adaptive sampling usually finishes plain backgrounds early, so real stills should land at the low end.

Defaults that follow:

1. **Add the `quick` tier** and make it the default "Render" on machines the server classes as light (≤ 8 GB, or no discrete GPU). Set `cycles.time_limit` so it cannot overrun; the deploy plan rejected time limits only for chunked, resumable stills, which this is not.
2. **Cap local size by memory.** On ≤ 8 GB: longest side 2048 for stills unless the person confirms; 1080 for animation `[E]`.
3. **Cap CPU threads.** Set `PAVE_RENDER_THREADS` to performance cores minus one by default when the device is CPU, so the studio stays usable. On Metal, the GPU is shared with the viewport: while a take renders, hold the viewport in Smooth.
4. **Estimate at the sustained rate** for any job over about 3 minutes, and learn a second, "warm" rate from frames after the first 3 minutes.
5. **Offer the server** when the estimate passes a threshold (§8).

### 6.4 EEVEE as a draft path

Reject it. EEVEE is a rasteriser with no internal reflection chain inside a gem, which research 03 already ruled out for finals `[R]`. As a draft it competes with the browser preview, which already has our gem shader, starts in no time and needs no Blender. Whether EEVEE runs headless on macOS was not tested here; it failed on Linux without a display `[R]`.

### 6.5 Constraints for our own WebGPU path tracer (for topic 15)

- **Speed class.** The Air's GPU is one sixth of an RTX 3060 in a mature path tracer, and WebGPU exposes no ray-tracing hardware, so intersection is software in compute or fragment shaders `[E for the API point; 6.1 for the ratio]`.
- **Limits.** WebGPU defaults: buffers up to 256 MB, storage-buffer bindings 128 MB, 2D textures 8,192 px, 8 storage buffers per stage ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits) `[V]`). Higher limits must be requested and may not be granted.
- **Memory.** Everything is in the same 8 GB as the page and the kernels.
- **Responsiveness.** Work must be cut into slices of a few milliseconds per frame, or the browser stalls and may drop the device `[E]`; Figma saw real device loss in production `[V]`.
- **Heat.** Sustained GPU power under mixed load averaged about 4–5 W against a 13 W peak `[V]`, so convergence slows after the first minutes.
- **Reach.** Chrome and Electron on any macOS; Safari only on macOS 26; needs the WebGL fallback path regardless.

## 7. What to move to a server or a GPU, and what it costs

### 7.1 Where GPUs can be rented (prices seen 25 Nov 2026)

| Provider | Offer | Price | Billing | Fit |
|---|---|---|---|---|
| Render.com | No GPU instance on the pricing page; the GPU request has been open since January 2020, last comment July 2026 | — | — | Web, database and CPU work only. Confirms the deploy plan ([pricing](https://render.com/pricing), [feedback](https://feedback.render.com/features/p/gpu-instances), [staff reply](https://community.render.com/t/does-render-offer-gpus/11222) `[V]`) |
| Modal | T4 $0.59/h, L4 $0.80/h, A10 $1.10/h, L40S $1.95/h; CPU about $0.047 per core-hour; $30 a month free on Starter | Per second, nothing when idle; regions add 1.15–1.75×; non-preemptible is 3× | **Best fit**: a container with bpy and our runner, scale to zero ([pricing](https://modal.com/pricing) `[V]`) |
| RunPod | Pods: A5000 $0.27/h, 3090 $0.50, L4 $0.69, 4090 $0.89, L40S $1.09. Serverless: 16 GB $0.58/h, 24 GB $0.75, 4090 $1.34 | Pods per second; serverless bills cold start and idle timeout | Good second choice; cheapest fast cards ([pricing](https://www.runpod.io/pricing), [serverless docs](https://docs.runpod.io/serverless/overview) `[V]`) |
| AWS | g4dn.xlarge (T4) $0.526/h, g6.xlarge (L4) $0.805, g5.xlarge (A10G) $1.006; spot $0.24–0.85 | Per second, but you manage instances | Works; more operations than Modal ([Vantage](https://instances.vantage.sh/aws/ec2/g6.xlarge) `[V]`) |
| Google Cloud | T4 $0.35 per GPU-hour plus the machine | Per second | Same as AWS ([pricing](https://cloud.google.com/products/compute/gpus-pricing) `[V]`) |
| Azure | NC4as T4 v3 $0.526/h, spot $0.16 | Per second | Same ([Vantage](https://instances.vantage.sh/azure/vm/nc4ast4-v3) `[V]`) |
| Lambda | Cheapest listed is a V100 at $0.79/h; the rest are A100 and up from $1.99 | Not stated | Training-class; poor fit ([pricing](https://lambda.com/pricing) `[V]`) |
| CoreWeave | Only 8-GPU nodes listed: L40 $10/h, L40S $18/h | — | Wrong scale ([pricing](https://www.coreweave.com/pricing) `[V]`) |

### 7.2 Blender render farms and cloud Macs

| Service | Price | Programmatic use | Verdict |
|---|---|---|---|
| SheepIt | Free, points earned by rendering for others | No custom scripts allowed; no API in the FAQ; each frame is sent to volunteers' computers | **Reject**: a jeweler's design would go to strangers' machines, and our scene compiler cannot run ([FAQ](https://www.sheepit-renderfarm.com/faq) `[V]`) |
| RenderStreet | $59.97 a month for unlimited CPU; on demand $3.00 (CPU) or $4.49 (L40S) per server-hour, by the minute | A "production API" exists; details on request | Possible overflow; 2–4× the raw GPU price ([pricing mirror](https://rs-front-deploy.pages.dev/plans-pricing/), [features](https://rs-front-deploy.pages.dev/features/) `[V]`; read on a deploy-preview host, so confirm on the main site) |
| GarageFarm | GPU nodes $1.12–6.73/h (RTX 4000 Ada) to $3.16–18.99 (L40S) by priority; $25 trial | Desktop client and plug-in; no API on the page | Built for artists with `.blend` files, not for a product ([pricing](https://garagefarm.net/pricing) `[V]`) |
| Fox Renderfarm | CPU $1.224 per node-hour, less with volume; GPU rates did not render on the page | No API on the pricing page | Same; GPU price unverified ([pricing](https://foxrenderfarm.com/pricing.html) `[V]`) |
| Scaleway Mac mini | M2 (16 GB) €0.17/h, M4 €0.22/h, M4 Pro (64 GB) €0.49/h | Full machine; minimum lease not stated on the page | Only if Metal parity ever matters. An M4 Pro scores about 2,500, below an L4 at similar cost, and cannot scale to zero ([pricing](https://scaleway.com/en/pricing/apple-silicon) `[V]`) |
| AWS EC2 Mac | mac2-m2.metal $0.878/h | Dedicated host | Poor value: M2 speed at above L4 price ([Vantage](https://instances.vantage.sh/aws/ec2/mac2-m2.metal) `[V]`) |

Farms sell convenience to people who hold `.blend` files. Pavé holds a scene description and its own runner (`workers/render`), which already runs headless from JSON and a GLB `[R]`. A general GPU container is the natural home; it is also exactly the "render node" of the deploy plan with a different owner.

### 7.3 Cost per render

Method `[E]`: time on a cloud GPU = fixed cost + (Air GPU time − fixed) × 354 / score, priced per second, plus 4 CPU cores and 16 GB on Modal (about $0.32/h).

| Job (Air estimate) | T4 on Modal ($0.91/h all in) | L4 on Modal ($1.12/h) | 4090 on RunPod serverless ($1.34/h) |
|---|---|---|---|
| Quick 2K still (about 1 min) | about 25 s: $0.006 | about 15 s: $0.005 | about 12 s: $0.005 |
| Final 2K still (7–15 min) | 2–4 min: $0.03–0.06 | 50–100 s: $0.02–0.03 | 25–40 s: $0.01–0.02 |
| 5 s turntable, standard (1–3 h) | 20–30 min: $0.30–0.45 | 10–15 min: $0.20–0.30 | 7–9 min: $0.15–0.20 |
| 5 s turntable, final (2.5–7 h) | 40–70 min: $0.60–1.05 | 20–30 min: $0.35–0.55 | 9–13 min: $0.20–0.30 |

Add a cold start on the first job after idle. Modal says containers boot in about a second and that imports and downloads dominate ([docs](https://modal.com/docs/guide/cold-start) `[V]`). Our image carries a 0.9 GB bpy install and `import bpy` takes 1.5 s `[R, research 03]`, so expect 10–40 s cold `[E]`, a few cents at most. Animations split cleanly: 150 frames across 10 containers finish in 1–3 minutes for the same money `[E]`.

**The business reading.** A final still costs Pavé a few cents and a turntable under a dollar. That fits "renders are paid, 5 free a month" easily, and it suggests pricing animations separately from stills.

### 7.4 Pixel streaming for the viewport: last resort

Zoo does this for its whole product `[V]`. For Pavé it fails on three counts. Cost: one L4 per active session at $0.80/h is about $70 a month for a designer working 4 hours a day `[E, arithmetic]`, against free CAD. Latency: the plan's target is 120 ms from slider to pixels; a round trip plus encode and decode spends most of that `[E]`. Offline and privacy: local mode is a selling point, and designs would have to live on our GPU. Keep it only as a named escape for a machine that cannot draw at all (software GL), and even there the clay mode and edit-by-numbers already exist `[R]`.

### 7.5 What must stay local, and why

- **The viewport and draft kernel.** Latency, offline use, zero marginal cost, and the design never leaves the machine.
- **Picking, gizmos, curve drawing.** Per-frame work; `freeform-cad.md` already keeps curves on the main thread `[R]`.
- **Design captures for the assistant.** They come from the live canvas.

Everything else can move behind the durable `work` rows of the deploy plan without changing the studio.

### 7.6 Corrections and additions to `deploy-and-durable-jobs.md`

1. "Render has no GPUs [S]" is now **`[V]`** (pricing page and feature request, both read today).
2. Render Workflows is on the pricing page with hourly rates ($0.20 per active CPU-hour on the flex tier, fixed tiers $0.40–2.50/h) `[V]`. I could not confirm whether it is still a public beta. It still has no GPU.
3. The plan's kernel-pool default (`min(4, availableParallelism() - 1)`, 1,536 MB, at `pool.ts:97`) is superseded on assistant-build by `poolDefaults` `[R]`.
4. The plan's Auto order (OPTIX, CUDA, HIP, ONEAPI, METAL) is now Metal-first on macOS `[R]`.
5. The plan's render node is "the founder's GPU machine". Add a second kind with the same protocol: a **rented node** (Modal or RunPod) that Pavé starts on demand. The node API, leases, checksums and the "data, never code" rule all apply unchanged. What is new: the node token is minted per job by the server instead of by pairing; billing for node time stops being `costUsd: 0`; the container must wipe its job folder on exit (it does by construction when it scales to zero).
6. A local Air can be a node too. With the sustained-rate estimate, the take tile can say "about 2 hours here, or about 12 minutes on a render server".

## 8. Decision table

| Workload | On an 8 GB Air today | Fallback | Trigger for a server |
|---|---|---|---|
| Viewport | Local WebGL2, Auto governor | Smooth mode; clay stand-ins; edit by numbers | Never (§7.4) |
| Kernel, draft | Browser worker, single-threaded WASM | Evaluate on release for costly nodes; coarser drag chord | Never |
| Kernel, production check and export | Browser production worker or local server pool | Server `design.export` | Hosted mode; or a check estimated over 60 s on ≤ 8 GB |
| Draft render (preview, critique loop) | Browser WebGL take, or Cycles preview on Metal (15–20 s) | Browser take when Blender is absent | No Blender and a path-traced look is wanted before topic 15 ships |
| Quick still | Cycles on Metal, new `quick` tier (about 1 min) | CPU with a thread cap (3–4 min) | Machine has no Metal or CUDA-class GPU (Intel UHD), or is on battery under 20 % |
| Final still | Local up to 2K (7–15 min), viewport held in Smooth | Chunked and resumable (deploy plan step 3) | Estimate over 5 min, size over 2K on ≤ 8 GB, or the person asks |
| Animation | Not by default on the Air | Local overnight with kept frames, at the sustained rate | **Default to a server whenever one is configured**; always when the estimate passes 15 min |
| AI image generation | Remote provider API (Gemini, OpenAI, Higgsfield) from the server `[R]` | — | Already remote; local diffusion does not fit in 8 GB `[E]` |
| Photo matching | Kernel pool task, up to 2 min on CPU `[R]` | Lower its worker rank as today | Hosted mode (`fit` as durable work); a segmentation model, if added, runs on a server or an API |

## 9. What this means for the plan

### 9.1 Budgets and defaults to adopt

**Whole-machine memory on ≤ 8 GB (new: one owner, the local server).** Target: Pavé's processes stay under 3 GB while editing and under 5 GB while rendering `[E]`.

| Process | Editing | While a local render runs |
|---|---|---|
| Studio page and GPU buffers | ≤ 700 MB | same, Smooth forced |
| Browser draft kernel | ≤ 600 MB, then recycle | same |
| Browser production kernel | only while a check or export runs | stopped |
| Server and database | ≤ 400 MB | same |
| Server kernel pool | 2 × 1,024 MB cap, idle workers stop after 2 min `[R]` | 1 worker |
| Blender | — | ≤ 2.5 GB; size guard |

The server reports `totalmem`, core count and render device to the studio at sign-in (one field in capabilities), so the studio never guesses from `navigator`.

**Viewport defaults** (§4.1): keep the governor as built; add stone level of detail by pixel size, idle accumulation, run-time antialiasing, and counters.

**Render defaults** (§6.3): the `quick` tier with a 45 s time limit; size caps by memory; a default thread cap; sustained-rate estimates; a warm-up render at set-up; the viewport in Smooth during a take.

### 9.2 Inputs for `docs/plans/jewelry-renderer.md`

- The in-browser renderer must run on WebGL2 and treat WebGPU as an upgrade, with Figma-style live fallback.
- Its budget on the Air: stay inside 400 MB of GPU memory; slice work to a few milliseconds a frame; assume one sixth of an RTX 3060 and no ray-tracing hardware; expect speed to sag after the first minutes.
- The "machine without Blender" case is common on the low end: 8 GB Windows laptops with Intel graphics cannot render Cycles usefully (score 101). For them the choice is our renderer or a server. That makes the server path and our renderer the two halves of one answer, not alternatives.
- One scene description must drive all four back ends (WebGL preview, our tracer, local Cycles, rented Cycles), which research 03 already decided.

### 9.3 A test protocol for the founder's own MacBook Air

Preparation: note the model, memory and GPU cores (About This Mac, System Information › Graphics). Plug in, turn Low Power Mode off, close other apps, let the machine cool for 10 minutes. Use the commit the founder is given to install. The build session should first add a `?perf=1` overlay (frame time p50 and p95, pixel ratio, effects level, triangles, draw calls, kernel ms, WASM MB) and a real-hardware mode for `apps/studio/e2e/light.ts` (no SwiftShader flags, no CPU throttle), so the numbers are read, not judged by eye.

| # | What to do | What to record | Pass mark |
|---|---|---|---|
| 1 | Open `chrome://gpu` (and Safari's Develop menu) | WebGL2 hardware accelerated; WebGPU status; macOS and browser versions | WebGL2 on GPU; renderer string classed `low` |
| 2 | Open the solitaire, halo, oval set-stone band and eternity templates, cold then warm | Time to first drawn piece | ≤ 8 s cold, ≤ 3 s warm |
| 3 | Orbit each for 10 s in Auto | fps, p95 frame time, pixel ratio and effects reached | ≥ 30 fps p95 on all four; effects stay `full` on solitaire and halo |
| 4 | Same on a piece with 2,000 stones and one with 5,000 | as above, plus triangles and draw calls | ≥ 24 fps; no clay stand-ins at 2,000 |
| 5 | Arrow-step "Width at top" 20 times; drag a slider for 5 s | Slider-to-pixels time | p95 ≤ 120 ms on templates; ≤ 400 ms at 5,000 stones (the plan's targets `[R]`) |
| 6 | Hands off for 60 s | Frames drawn; Activity Monitor CPU and Energy Impact | 0 frames; Pavé under 2 % CPU |
| 7 | Edit for 30 minutes across three pieces | Memory of browser, server and workers; memory pressure colour; swap | Pavé total ≤ 3 GB; pressure green; swap not growing |
| 8 | Orbit the halo continuously for 15 minutes | fps in minute 1 and minute 15; case temperature by hand | Minute 15 ≥ 80 % of minute 1 |
| 9 | First render after install, then a `preview` take twice | Kernel compile time; take time; device shown | Device is Metal; second take ≤ 30 s |
| 10 | A `quick` 2K still while orbiting the CAD view | Wall time; viewport fps during the take | ≤ 75 s; viewport ≥ 20 fps |
| 11 | A `standard` 2K still, then a `final` 2K still | Wall time; peak memory of the Blender process | Recorded (these set the server triggers); no swap storm, no failure |
| 12 | A 5 s `standard` turntable | Seconds per frame for frames 1–10 and the last 10 | Recorded; the ratio is the sustained factor (expected 0.6–0.7) |
| 13 | Repeat 10 with `PAVE_CYCLES_DEVICE=CPU` | Wall time; viewport fps with and without `PAVE_RENDER_THREADS=3` | Recorded; the thread cap keeps the viewport ≥ 20 fps |
| 14 | 30 minutes of editing on battery | Battery percentage used | ≤ 10 % on the 13-inch (about 5 Wh of 52.6) |

Rows 9–13 replace every `[E]` in §6.3 with the founder's numbers; rows 3–8 confirm or reset the viewport budgets.

### 9.4 Build order for the performance work

1. The overlay and the real-hardware driver mode (needed to measure anything).
2. The `quick` tier, time limit, size guard, thread cap and warm-up render (small, and they decide the first impression of rendering).
3. Machine facts from the server to the studio; the cross-process budget; recycling of the browser kernel.
4. Stone level of detail by pixel size; then idle accumulation and run-time antialiasing.
5. Rented render nodes on top of deploy-plan step 8 (same protocol).
6. WebGPU back end with live fallback, with topic 15.

**Reject:** WASM threads and cross-origin isolation (breaks the Design board for little gain); OffscreenCanvas for the viewport now; EEVEE drafts; SheepIt; cloud Macs; pixel-streamed modeling; a native kernel before measurements ask for it.

### 9.5 Decisions for the founder

1. **Which Air is the reference?** 13 or 15 inch, 8 or 16 GB, 8 or 10 GPU cores, and which macOS. If it is 16 GB, should an 8 GB machine still be a supported target (it is the base model and the common Windows configuration)?
2. **Where do animations render for a free user on an Air?** Locally for one to seven hours, or on a rented GPU for about 15–55 cents that Pavé pays or passes on. This sets whether "5 free renders" can include animations.
3. **May Pavé run rented GPUs at all** (Modal or RunPod), given that designs leave the laptop for those jobs? If yes, per-job consent or a setting?
4. **Is an 8 GB Intel Windows laptop a launch target?** If yes, it has no usable local Cycles, so either the server path or our own renderer must exist before launch.
5. **iPad:** viewer and light editing in Safari only, or out of scope for now?
6. **Is "about a minute" for a 2K still at 96 samples acceptable quality** for the default render, with standard and final one click away? The answer needs a look at the image from test row 10.

## 10. What I could not verify

- Any frame rate or render time on a real M2 Air (no GPU here). All such figures are estimates from benchmark ratios.
- Raster speed of Intel UHD and Iris Xe against the M2 (the Notebookcheck page failed to load).
- The Cycles GPU-rendering page of the Blender manual (too long to open in full), so oneAPI support for Iris Xe and the exact macOS requirement for Metal are unconfirmed.
- Whether Render Workflows is still in beta; Fox Renderfarm's GPU prices; Scaleway's minimum lease; RenderStreet's API details (and its pages were read on a preview host).
- Published engineering notes for Autodesk's web viewers.
- three.js's transmission pass in the current source; EEVEE headless on macOS; Manifold's threading in WASM.

## Repo notes for the lead

1. The light-machine work exists only on assistant-build. This branch's `apps/studio/src/components/stage/` lacks `adaptive.ts` and `QualityIndicator.tsx`, and its `pool.ts` still has the old default. Plans written from this branch should cite assistant-build paths.
2. `deploy-and-durable-jobs.md` §2 and §4.8 quote the old pool default and line numbers (`pool.ts:97`, `167`); §4.7 quotes the old device order. Both changed in commit `499b203`.
3. `ref: workers/render/pave_worker/devices.py` says Metal "drives … AMD GPUs in Intel Macs". Since Blender 4.3 it does not `[V]`; with bpy 5.3 an Intel Mac falls to CPU. The code still behaves correctly (no Metal device is found); only the comment is wrong.
4. `ref: packages/render/src/takes.ts` says the Air's GPU is "somewhat quicker" than its CPU. Open Data puts it at about 3× `[V]`. Harmless, because the rate is learned after two takes, but the first estimate will run long by that factor.
5. `03-rendering.md` §1 lists the denoiser as "OIDN on CPU (default)". Blender 4.1 and later can run it on Metal and other GPUs `[V]`.
6. `cad-workspace.md` §4.4 promises "cheap env-mapped facets" for melee over a tier-dependent count. The code lowers bounces instead; the stand-in material was not built.
7. `ref: apps/studio/e2e/light.ts` always launches SwiftShader, so it cannot measure a real machine as written.

## Sources

**Apple hardware** — [MacBook Air 13" M2 specs](https://support.apple.com/en-us/111867) `[V]` · [MacBook Air 15" M2 specs](https://support.apple.com/en-us/111346) `[V]` · [iPad Air 13" M2 specs](https://support.apple.com/119893) `[V]` · [Apple forums on the Metal working-set limit](https://developer.apple.com/forums/thread/732035) `[V]`

**Thermals and benchmarks** — [Notebookcheck, Air M2 10-core review](https://www.notebookcheck.net/Apple-MacBook-Air-M2-review-The-faster-10-core-GPU-isn-t-worth-it.640427.0.html) `[V]` · [Notebookcheck, Air 15 review](https://www.notebookcheck.net/Apple-MacBook-Air-15-2023-M2-review-The-everyday-MacBook-now-in-15-inches.726811.0.html) `[V]` · [Notebookcheck, M2 10-core GPU](https://www.notebookcheck.net/Apple-M2-10-Core-GPU-Benchmarks-and-Specs.632306.0.html) `[V]` · [Notebookcheck, M2 against RTX 3060](https://www.notebookcheck.net/M2-10-Core-GPU-vs-NVIDIA-GeForce-RTX-3060-vs-M2-8-Core-GPU_11368_10960_11375.247598.0.html) `[V]` · [MacRumors forum Cinebench loop](https://forums.macrumors.com/threads/my-cinebench-throttling-tests-m2-vs-m1-macbook-airs.2377984) `[V]` · [Macworld on the fanless design](https://www.macworld.com/article/821312/m2-macbook-air-throttle-overheating-design.html) `[V]` · [Intel on Iris Xe and single-channel memory](https://www.intel.com/content/www/us/en/support/articles/000094617.html) `[V]` · [Blender Open Data query](https://opendata.blender.org/benchmarks/query/?device_name=Apple%20M2&group_by=device_name&group_by=blender_version&group_by=compute_type&response_type=datatables) `[V]` (same endpoint for RTX 3060, RTX 4060, RTX 4090, Tesla T4, L4, A10G, Iris, Apple M4) · [MacRumors thread quoting M3 and M4 scores](https://forums.macrumors.com/threads/3d-rendering-on-apple-silicon-cpu-gpu.2269416/page-104) `[V]`

**Browsers and the web platform** — [web.dev on WebGPU support](https://web.dev/blog/webgpu-supported-major-browsers) `[V]` · [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/implementation-status) `[V]` · [MDN GPUSupportedLimits](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits) `[V]` · [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) `[V]` · [MDN deviceMemory](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory) `[V]` · [WebKit NavigatorBase.cpp](https://webkit.googlesource.com/WebKit/+/master/Source/WebCore/page/NavigatorBase.cpp) `[V]` · [web.dev on cross-origin isolation](https://web.dev/articles/coop-coep) `[V]` · [V8 on 4 GB WASM memory](https://v8.dev/blog/4gb-wasm-memory) `[V]` · [caniuse Memory64](https://caniuse.com/wf-wasm-memory64) `[V]` · [Browser memory limits, E. Lawrence](https://textslashplain.com/2020/09/15/browser-memory-limits/) `[V]` · [WebKit bug 268816](https://bugs.webkit.org/show_bug.cgi?id=268816) `[V]` · [three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) `[V]` · [three.js forum on transmission draw calls](https://discourse.threejs.org/t/draw-call-and-triangles-amount-increases-when-having-a-physical-material-with-transmission/46663) `[V]`

**Other tools** — [Onshape hardware recommendations](https://cad.onshape.com/help/Content/Home/hardware_and_graphics_performance_recommendations.htm) `[V]` · [Onshape, under the hood](https://onshape.com/en/blog/under-the-hood-cad-performance) `[V]` · [Figma on WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/) `[V]` · [Spline optimisation guide](https://docs.spline.design/importing-content/cad-to-spline-optimization-best-practices) `[V]` · [Shapr3D for Mac](https://www.shapr3d.com/mac-os) `[V]` · [Siemens case study on Shapr3D](https://resources.sw.siemens.com/en-US/case-study-shapr3d) `[V]` · [Rhino 8 requirements](https://www.rhino3d.com/8/system-requirements) `[V]` · [Rhino Metal display](https://www.rhino3d.com/features/display/metal/) `[V]` · [Zoo stream](https://zoo.dev/docs/zoo-design-studio/features/system-requirements/zoo-stream) `[V]` · [Autodesk University session](https://www.autodesk.com/autodesk-university/class/APS-Autodesk-Viewer-Performance-Journey-and-Road-Map-2024) `[V, no technical detail]` · [Blender requirements](https://www.blender.org/download/requirements/) `[V]`

**Kernel** — [Jangda et al., USENIX ATC 2019](https://www.usenix.org/conference/atc19/presentation/jangda) `[V]` · [OCCT forum on WASM speed](https://occt3d.com/dev/content/webassembly-performance-degradation/index.html) `[V]` · [ocjs multi-threading](https://ocjs.org/docs/advanced/multi-threading/intro) `[V]` · [brepjs benchmark results](https://raw.githubusercontent.com/andymai/brepjs/main/benchmarks/results/latest.md) `[V]` · [Manifold performance notes](https://github.com/elalish/manifold/wiki/Performance-Considerations) `[V]`

**Blender on Apple silicon** — [PR 120299, MetalRT default](https://projects.blender.org/blender/blender/pulls/120299) `[V]` · [PR 116124, OIDN on Metal](https://projects.blender.org/blender/blender/pulls/116124) `[V]` · [Issue 101787, 8 GB M2 Air](https://projects.blender.org/blender/blender/issues/101787) `[V]` · [Issue 110520, persistent data](https://projects.blender.org/blender/blender/issues/110520) `[V]` · [Issue 100102, kernel load time](https://projects.blender.org/blender/blender/issues/100102) `[V]` · [Metal removed for AMD and Intel GPUs](https://forum.blender.org/t/cycles-remove-support-of-metal-with-amd-intel-gpus-for-4-3-and-onwards/35098) `[V]`

**Cloud and farms (25 Nov 2026)** — [Render pricing](https://render.com/pricing) `[V]` · [Render GPU feature request](https://feedback.render.com/features/p/gpu-instances) `[V]` · [Render community reply](https://community.render.com/t/does-render-offer-gpus/11222) `[V]` · [Modal pricing](https://modal.com/pricing) `[V]` · [Modal cold starts](https://modal.com/docs/guide/cold-start) `[V]` · [RunPod pricing](https://www.runpod.io/pricing) `[V]` · [RunPod serverless](https://docs.runpod.io/serverless/overview) `[V]` · [Lambda pricing](https://lambda.com/pricing) `[V]` · [CoreWeave pricing](https://www.coreweave.com/pricing) `[V]` · Vantage: [g4dn.xlarge](https://instances.vantage.sh/aws/ec2/g4dn.xlarge), [g5.xlarge](https://instances.vantage.sh/aws/ec2/g5.xlarge), [g6.xlarge](https://instances.vantage.sh/aws/ec2/g6.xlarge), [mac2-m2.metal](https://instances.vantage.sh/aws/ec2/mac2-m2.metal), [Azure NC4as T4 v3](https://instances.vantage.sh/azure/vm/nc4ast4-v3) `[V]` · [Google Cloud GPU pricing](https://cloud.google.com/products/compute/gpus-pricing) `[V]` · [SheepIt FAQ](https://www.sheepit-renderfarm.com/faq) `[V]` · [RenderStreet plans](https://rs-front-deploy.pages.dev/plans-pricing/) and [features](https://rs-front-deploy.pages.dev/features/) `[V, preview host]` · [GarageFarm pricing](https://garagefarm.net/pricing) `[V]` · [Fox Renderfarm pricing](https://foxrenderfarm.com/pricing.html) `[V]` · [Scaleway Apple silicon](https://scaleway.com/en/pricing/apple-silicon) `[V]`
