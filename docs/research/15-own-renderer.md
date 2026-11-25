# 15 — A jewelry renderer of our own: architecture, licences, spikes, recommendation

Research date: 2026-11-25. Scope: the founder's priority topic, a renderer of our own, "inspired by Cycles but contained to what jewelry needs", so Pavé renders photoreal stills and animations when Blender is not installed. This file covers the architecture options and their licences, spikes run in this container, one recommended path and a staged roadmap. Builds on [`03-rendering.md`](./03-rendering.md) and the plans [`render-and-models.md`](../plans/render-and-models.md) and [`deploy-and-durable-jobs.md`](../plans/deploy-and-durable-jobs.md). The general survey of engines and gem optics is topic 14 and low-end machines are topic 18; neither is repeated here.

**How to read the evidence.** `[V]` I opened the source this session and the claim is on it; the link follows. `[V run]` I measured it here (scripts, timings and a comparison image are in [`spikes/15-renderer/`](./spikes/15-renderer/); the full-size images stayed outside the repository). `[V local]` is the GPL-3.0 text on this machine (`/usr/share/common-licenses/GPL-3`). `[S]` could not be opened at source. `[E]` is my estimate or working knowledge, with its basis. The shared web-search budget ran out part-way, so later pages were opened by address and some literature in §5 stays `[E]`. Nothing here is legal advice; §4.5 is for the founder to confirm with counsel.

## 1. The short answer

- **Build it, and keep it small.** Recommended: a path tracer of our own written as **WGSL compute kernels with a thin TypeScript host**, running in the studio on WebGPU (Metal on a Mac), and later the same kernels headless through Dawn or wgpu on GPU nodes. It becomes a third render engine beside `blender` and `browser`, fed by the `ResolvedScene` that exists today. Blender Cycles stays a separate program: the test reference, and the high-end engine until ours passes its gates.
- **The spike supports it.** One procedural scene (a 57-facet round brilliant in a four-prong gold ring under soft boxes) was rendered in four engines here. A 340-line tracer of our own, with the diamond stored as 121 planes and one wavelength per path, gave the same facet pattern and the same coloured flashes in the same facets as Cycles 5.3 and spectral Mitsuba 3. The same tracer as one 250-line WGSL shader compiled first time and ran headless through wgpu `[V run]` (§6).
- **It is not yet as efficient as Cycles.** Per sample our spike is cheaper, but at equal CPU time Cycles was closer to the converged reference, because one wavelength per path adds colour noise everywhere and our gold was slightly off in hue `[V run]`. Both have known fixes; they are roadmap work, not done work.
- **Why our own and not an embedded engine.** An engine inside the studio needs no install, renders on the user's own GPU at no cost to us (also when Pavé is hosted on servers without GPUs), shares its camera with the viewfinder, and can use jewelry shortcuts general engines cannot. The price is about five to six months of one graphics engineer `[E]` and real risk in the long tail (brushed metal, pearls, caustics, denoising facets).
- **Plan B is real and licence-clean.** Cycles as a standalone library is Apache-2.0 (with some BSD-3-Clause files) and already ships inside a closed CAD product, Rhino `[V]` (§4.4). It would give Cycles quality without Blender in two to three months of C++ build work `[E]`, but only as a native sidecar: no browser, no rendering on a hosted user's GPU, nothing jewelry-specific. If stage 1 misses its gate, switch. If the founder values certainty over reach, it can be plan A; that is his call (§8).
- **Licences.** Our engine needs nothing GPL. What it leans on is MIT, BSD or Apache-2.0: three-mesh-bvh, Dawn, wgpu, Open Image Denoise and its weights `[V]`. Mitsuba 3 (BSD-3) and Cycles in a separate process are the test references. OptiX is proprietary and NVIDIA-only; not needed.
- **Two corrections.** Mitsuba 3.9.1's `dielectric` has no dispersion, even in spectral variants `[V run]` `[V]`; I wrote a dispersive material and a one-wavelength integrator to get fire. And three-gpu-pathtracer's WebGPU tracer is two months old and marked not yet stable `[V]`: learn from it, do not build on it.
- **Speed.** Every timing in §6 is from a shared 2-core Linux CPU with no GPU, not the founder's laptop. My estimate for an M2 MacBook Air is 10–40 s for a 1024 px, 256-sample still in our engine and 15–35 s in Cycles on Metal `[E]`. §6.6 has the commands to measure both on the Mac.

## 2. How a render is produced today, and where a second engine plugs in

Read from the assistant build (`/home/claude/ref/assistant-build`); this repository's copy is the same except where noted.

1. **Scene.** `resolveScene()` (`packages/render/src/resolve.ts`) compiles the editable `RenderScene` and the kernel's evaluation into a `ResolvedScene` v2 (`types.ts`): plain JSON, millimetres, Z up, every number explicit. It holds the orbit camera, the rig (emissive rectangles with gradients, "sparkle" lights only gems see, a three-colour ambient), background, ground (none, shadow, sweep, reflective), materials (metal: colour, F82 edge tint, roughness, anisotropy, relief; gem: index, Abbe number, attenuation; surface stones: subsurface, thin film, coat), assignments, animation tracks and output settings with seed 0.
2. **Blender path.** The queue (`apps/server/src/engines/render/queue.ts`, `take.ts`) calls `renderWithBlender()` (`packages/render/src/node/index.ts`), which writes `piece.glb` and `job.json` to a work folder, starts the worker with no shell (`python pave_render.py job.json` on bpy 5.3, or `blender -b -P`), reads progress lines, then `result.json` (image or frames, video, mask, metrics, device, seconds). The worker (`workers/render/pave_worker/`, GPL because it uses Blender's Python API) imports the GLB, assigns materials by node name, builds rig and camera, renders, composites the background, renders a mask and encodes video.
3. **Browser path.** `engine: 'browser'` takes are drawn by an open studio window (`apps/studio/src/features/render/browser-takes.ts`, `shot-renderer.ts`): three.js on WebGL with our `GemMaterial` (`packages/render/src/three/gem.ts`: at most 8 bounces, three-ray RGB dispersion). Stills only, at most 2048 px, labelled preview; animations are refused.

| Place | Today | Change for our engine |
|---|---|---|
| `RenderJob.engine`, `renders.create` (`packages/schema/src/api/entities.ts`, `commands.ts`) | `'blender' \| 'browser'` (+ `'auto'`) | A third value (called `'pave'` below; the name is the founder's) and an `auto` order |
| Studio | `shot-renderer.ts` draws a `ResolvedScene` on WebGL | A path renderer beside it with the same inputs; `browser-takes.ts` already does claiming, upload and `renders.complete` |
| Server or node | `renderWithBlender()`: `job.json` in, `result.json` out | A second runner with the same contract; `queue.ts` checks Blender's status and keys its cache on Blender's version, so it needs an engine-neutral interface |
| Geometry | Triangles in a GLB | Metal as triangles with authored normals; gems as **plane lists** from the kernel's cut data (`packages/kernel/src/gems`) |
| Metrics, animation | `metrics.py` in the GPL worker; Blender encodes video | The same numbers and a video encoder without the GPL worker |

`ResolvedOutput` is shaped like Cycles settings. That is fine as hints; our engine needs size, samples, noise threshold, depth, denoise and seed.

## 3. Requirements: what a jewelry renderer must do, and may skip

| Area | Must have (stills) | Later | Skip |
|---|---|---|---|
| Metals | Conductor Fresnel (F82 colours today, spectral n,k next), GGX roughness, anisotropy for brushed finishes, plating | Relief normals (hammered, sandblast), fine scratches | Node graphs, general image textures |
| Faceted gems | Smooth dielectric, exact Fresnel, total internal reflection, paths 24–32 bounces deep, dispersion by wavelength, absorption for colour, metal touching or entering the stone | Sellmeier fits and absorption spectra (alexandrite's colour change needs spectral light), birefringence for moissanite (no target engine does it: 03-rendering §2) | Inclusions, fluorescence, polarisation |
| Other stones | Opaque polished stones (onyx, black diamond) | Pearl, opal, turquoise, enamel: a diffusion-profile subsurface approximation, thin film and a coat. True random-walk subsurface is affordable in scenes this small but not needed first `[E]` | Skin, wax, cloth |
| Light | Rectangular soft boxes with gradients, black flags, sparkle lights linked to stones, ambient gradient, direct-light sampling with MIS | Importance-sampled HDRI | Sky models, IES, portals, many lights |
| Ground | Shadow catcher with alpha, white sweep, reflective acrylic | Caustics from stones | Displacement |
| Camera | The viewfinder's orbit rig exactly, thin-lens depth of field, roll | Rack focus | Motion blur, lens distortion |
| Animation | — | Turntable, light sweep, camera tracks: rigid transforms, one render per frame | Deformation, physics |
| Output | Progressive, fixed seed, same pixels on the same machine, the viewport's view transforms, PNG with alpha, subject mask | Adaptive sampling, 16-bit, EXR, video | Deep output, Cryptomatte |
| Denoise | Open Image Denoise with albedo and normal guides | Facet-aware denoise | Temporal ML denoisers |
| Never | — | — | Volumes, hair, fur, subdivision at render time, out-of-core scenes, OSL |

The "skip" column is what makes this a contained project. A jewelry scene is a few metal bodies, up to a few hundred convex stones of a few cuts, a ground and a handful of lights. The spike scene (20 224 metal triangles, one stone) builds its whole acceleration structure in 0.1 s in C and 0.2 s in Python `[V run]`.

## 4. Architecture options and their licences

### 4.1 Summary

Effort is to a first photoreal still from a `ResolvedScene`, one experienced graphics engineer `[E]`. Speed is a 1024 px, 256-sample still on an M2 Air `[E]` (basis in §6.5).

| Option | Licence position | Effort `[E]` | Quality ceiling | M2 Air `[E]` | Platforms | Ships as |
|---|---|---|---|---|---|---|
| **(a) Our own WebGPU tracer** | Our code; MIT helpers | 8–11 weeks | Cycles-class on metal and faceted stones; lower elsewhere by design | 10–40 s | Chrome and Edge on Mac and Windows `[E]`; Safari 26 `[V]`; desktop shells; headless on a GPU | In the studio bundle, no install |
| **(b) Our own native tracer** | Our code; MIT, Apache-2.0, BSD libraries | (a) + 4–8 weeks of per-OS builds and signing | As (a); can add hardware ray tracing | As (a) | Per-OS binaries | Sidecar, like Blender today |
| **(c1) Embed Cycles standalone** | Apache-2.0 with BSD-3 files `[V]` | 8–12 weeks | Cycles itself | 15–35 s | Mac (Metal), Windows and Linux (CUDA, OptiX, HIP, oneAPI) `[V]` | Sidecar, 100+ MB `[E]` |
| **(c2) Embed LuxCore** | Apache-2.0 `[V]` | 2–4 weeks via the pyluxcore wheel | Good caustics; slowest fire and greenish gold preset in the spike `[V run]` | CPU only `[E]` | Wheels for Windows, Linux, macOS ARM and Intel `[V]` | Sidecar with Python |
| **(c3) Mitsuba 3** | BSD-3-Clause `[V]` | Not a product engine | Reference-grade spectral; no dispersion built in `[V run]` | CPU only (no Metal backend listed `[V]`) | Wheels incl. macOS ARM `[V]` | Test reference |
| **(d) Blender, separate program** (today) | GPL, isolated by process | Done | Cycles | 15–35 s | Where Blender 5.3 runs | User installs, or bundled with obligations |

### 4.2 (a) A WebGPU path tracer of our own

- **Shape.** One compute shader that takes a camera ray to a finished path (as `ptgem.wgsl` in the spike), a few storage buffers (gem planes, metal BVH, triangles, lights), an accumulation buffer, and a TypeScript host that fills buffers from the `ResolvedScene`, dispatches short passes so the page stays responsive, and reads back for denoise and encode.
- **Start from three-gpu-pathtracer? No.** It is MIT; 0.0.28 was published on 2 Nov 2026 and needs three ≥ 0.187 `[V]` (npm registry). Its WebGPU tracer arrived in 0.0.25 on 28 Sep 2026, when the WebGL one was deprecated `[V]` ([releases](https://github.com/gkjohnson/three-gpu-pathtracer/releases)); the README calls it not yet stable, renders three.js physical materials in RGB and does not mention dispersion `[V]` ([README](https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/main/README.md)). Use **three-mesh-bvh** (MIT `[V]`, [repository](https://github.com/gkjohnson/three-mesh-bvh)) or our own 150-line builder for the metal, and read its kernels for ideas. Ours differs at the core: spectral, analytic gems, light linking.
- **No ray-tracing API in WebGPU.** The working group treats it as post-version-1 `[V]` ([gpuweb issue 535](https://github.com/gpuweb/gpuweb/issues/535)), so the shader walks the BVH itself. Acceptable for scenes this small, and the founder's M2 has no ray-tracing hardware anyway: Apple says it came to the Mac with M3 `[V]` ([Apple, Oct 2023](https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max-the-most-advanced-chips-for-a-personal-computer/)).
- **Where it runs.** Safari ships WebGPU from version 26 on macOS, iOS, iPadOS and visionOS `[V]` ([WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)). Headless: the `webgpu` npm package (Dawn for Node, 0.6.2, MIT) installs binaries for macOS, Linux and Windows but found **no adapter** on this GPU-less machine; wgpu-native found Mesa's software rasteriser through OpenGL and ran our shader on it `[V run]`. Headless Chrome on a Linux GPU server needs Vulkan flags and the right driver, or it silently falls back to software `[V]` ([Chrome for Developers](https://developer.chrome.com/blog/supercharge-web-ai-testing)).
- **Browser limits to design for** `[E]`: a GPU pass that runs too long is killed, so passes must be short; background tabs are throttled, so long renders need a worker and saved progress; 32-bit floats only (the WGSL port needed larger ray offsets than the C version `[V run]`); results differ slightly between GPU vendors, so "same pixels" is a per-machine promise.
- **Licences:** three-mesh-bvh MIT `[V]`; Dawn BSD-3-Clause `[V]` ([repository](https://github.com/google/dawn)); wgpu MIT or Apache-2.0 `[V]` ([repository](https://github.com/gfx-rs/wgpu)); three.js MIT `[E]`.

### 4.3 (b) A native renderer of our own, as a sidecar

- **Rust + wgpu** runs the same WGSL outside a browser on Metal, D3D12 and Vulkan `[V]`. Its ray-query features are experimental and listed for Vulkan only `[V]` ([wgpu Features](https://docs.rs/wgpu/latest/wgpu/struct.Features.html)), so on a Mac it walks the same software BVH. This is the natural **second host** for (a), stage 4 of the roadmap, not a separate renderer.
- **C++ with Metal, OptiX and Embree** reaches hardware ray tracing on M3 and RTX, and Embree on CPUs (Apache-2.0, supports Apple silicon `[V]`, [README](https://raw.githubusercontent.com/RenderKit/embree/master/README.md)). That is three backends and three build pipelines; not justified while scenes are this small.
- A sidecar must be built, signed and notarised per system, which the app does not do today.

### 4.4 (c) Embedding a permissively licensed engine

| Engine | Licence (opened) | Facts | Fit |
|---|---|---|---|
| **Cycles standalone** | `LICENSE` is the plain Apache-2.0 text `[V]` ([file](https://github.com/blender/cycles/blob/main/LICENSE)); the project site says it can be integrated in commercial software `[V]` ([cycles-renderer.org](https://www.cycles-renderer.org/)) | Builds as an application or a Hydra delegate `[V]`; Metal on Apple silicon (macOS 13+), CUDA, OptiX, HIP, oneAPI `[V]` ([manual](https://docs.blender.org/manual/en/latest/render/cycles/gpu_rendering.html)) | Plan B; detail below |
| **LuxCoreRender** | Apache-2.0 `[V]` ([repository](https://github.com/LuxCoreRender/LuxCore)) | pyluxcore 2.11.2 (6 Sep 2026): wheels for Windows, Linux, macOS ARM and Intel `[V]` ([PyPI](https://pypi.org/project/pyluxcore/)); GPU is OpenCL and CUDA, so CPU only on Apple silicon `[E]` | A caustics reference. Small volunteer project |
| **Mitsuba 3** | BSD-3-Clause plus a note on shared enhancements `[V]` ([LICENSE](https://github.com/mitsuba-renderer/mitsuba3/blob/master/LICENSE)) | Research-oriented; scalar, LLVM and CUDA backends `[V]` ([variants](https://mitsuba.readthedocs.io/en/stable/src/key_topics/variants.html)); fast CPU mode needs LLVM ≥ 18 `[V]` ([README](https://github.com/mitsuba-renderer/mitsuba3)); `dielectric` takes one index `[V]` ([docs](https://mitsuba.readthedocs.io/en/stable/src/generated/plugins_bsdfs.html)); 3.9.1 has macOS ARM wheels `[V]` ([PyPI](https://pypi.org/project/mitsuba/)) | The best **test reference**: spectral, fast, permissive |
| **pbrt-v4** | Apache-2.0 `[V]` ([repository](https://github.com/mmp/pbrt-v4)) | Spectral; GPU only via CUDA and OptiX `[V]` | A book's renderer |
| **Others** | appleseed MIT `[V]` ([repo](https://github.com/appleseedhq/appleseed)); Filament Apache-2.0 `[V]` ([repo](https://github.com/google/filament)); Radeon ProRender SDK licence file Apache-2.0 with BSD, MIT, CC0 parts `[V]` ([license.txt](https://github.com/GPUOpen-LibrariesAndSDKs/RadeonProRenderSDK/blob/master/license.txt)); Intel OSPRay Apache-2.0 `[V]` ([repo](https://github.com/RenderKit/ospray)); MoonRay Apache-2.0 `[V]` ([repo](https://github.com/dreamworksanimation/openmoonray)) | appleseed: activity not shown, I believe dormant `[E]`. Filament: a real-time rasteriser with screen-space refraction `[V]`. ProRender: default backend HIP since 3.01 `[V]`, Metal status not found, AMD binary core `[E]`. OSPRay: CPU first, GPU beta and Intel only `[V]`. MoonRay: Linux and macOS builds `[V]` ([docs](https://docs.openmoonray.org/getting-started/installation/building-moonray/)), a film studio's renderer | None fits: dormant, not a path tracer, vendor-tied, or far too large |
| **NVIDIA OptiX** | NVIDIA's own terms. The DesignWorks agreement I could open (June 2017) allows binary-only redistribution inside a product, for NVIDIA hardware only, asks for notice to NVIDIA before commercial use and forbids open-source entanglement `[V]` ([PDF](https://developer.download.nvidia.com/designworks/DesignWorks_SDKs_Samples_Tools_License_distrib_use_rights_2017_06_13.pdf)); NVIDIA's page says free for commercial use `[V]` ([OptiX](https://developer.nvidia.com/rtx/ray-tracing/optix)). Current text not opened | NVIDIA GPUs only | Later optional backend of (b) at most |
| **NVIDIA Iray** | Needs a separate runtime licence per the same agreement `[V]` | NVIDIA only | No |
| **Apple Metal ray tracing** | An OS API under Apple's developer terms `[E]` | Apple's sample needs macOS 11+ `[V]` ([sample](https://developer.apple.com/documentation/metal/accelerating-ray-tracing-using-metal.md)); hardware acceleration from M3 `[V]` | Later backend of (b) |

**Cycles: what is and is not Apache-2.0.**

- Blender is GPL (sources version 2 or later, binaries version 3 or later), and the same page says Cycles is available as Apache 2.0 `[V]` ([Blender licence page](https://www.blender.org/about/license/)).
- The standalone repository is **not uniformly Apache-2.0**: its build files carry Apache-2.0 headers `[V]` ([src/CMakeLists.txt](https://raw.githubusercontent.com/blender/cycles/main/src/CMakeLists.txt)), but `src/kernel/closure/bsdf_microfacet.h`, for one, is BSD-3-Clause, adapted from Open Shading Language `[V]` ([file](https://raw.githubusercontent.com/blender/cycles/main/src/kernel/closure/bsdf_microfacet.h)). Both are permissive; both sets of notices must ship.
- The `blender` glue directory is built only with `WITH_CYCLES_BLENDER` `[V]`. It talks to Blender's GPL internals and must never be in what we ship. Scripts that call Blender's Python API must be GPL when published `[V]` ([Blender FAQ](https://www.blender.org/support/faq/)); that is why our worker is GPL.
- Dependencies `[V]` ([BUILDING.md](https://github.com/blender/cycles/blob/main/BUILDING.md)): OpenImageIO and TBB are required; Embree, OpenColorIO, OpenVDB, OSL, Open Image Denoise, Alembic and USD are optional; NVIDIA builds need NVIDIA's CUDA Toolkit and OptiX SDK. Opened: OpenImageIO Apache-2.0, relicensed from BSD-3 `[V]` ([repo](https://github.com/AcademySoftwareFoundation/OpenImageIO)); oneTBB Apache-2.0 `[V]` ([repo](https://github.com/uxlfoundation/oneTBB)); Embree Apache-2.0 `[V]` ([repo](https://github.com/RenderKit/embree)); OSL BSD-3-Clause, needs LLVM `[V]` ([repo](https://github.com/AcademySoftwareFoundation/OpenShadingLanguage)); Open Image Denoise Apache-2.0 `[V]`; OpenVDB Apache-2.0 after relicensing from MPL-2.0 `[V]` ([repo](https://github.com/AcademySoftwareFoundation/openvdb)); Open PGL (path guiding) Apache-2.0, CPU only `[V]` ([repo](https://github.com/OpenPathGuidingLibrary/openpgl)). Not opened: OpenColorIO, Alembic, USD `[E: permissive]`.
- `make update` pulls Blender's whole precompiled library bundle `[V]`; a product build must link only what Cycles needs and audit each library `[E]`.
- **Precedent:** McNeel wraps Cycles in a C API with a C# layer for Rhino's renderer, under Apache-2.0 `[V]` ([CCSycles](https://github.com/mcneel/CCSycles)).
- **Not verified:** any promise of a stable C++ API (none is stated in the README or build notes), the size of a minimal build, and Metal kernel compile time on first run.

### 4.5 (d) Process isolation as a licence strategy

General description; confirm with counsel.

- **The licence text.** GPL-3.0 section 5 ends by defining an "aggregate": a covered work on the same medium as separate, independent works that are not its extensions and are not combined with it into a larger program; being in an aggregate does not put the other parts under the GPL. Section 2: the output of a covered program is covered only if the output is itself a covered work. Section 4: recipients must get a copy of the licence. Section 6: binaries must come with source or a way to get it `[V local]`. Blender's page adds that what you create with Blender is yours `[V]`.
- **The usual reading** `[S]` (the FSF's GPL FAQ would not open): programs that talk through files, pipes, sockets or command-line arguments are normally separate; sharing an address space, or exchanging internal data structures so closely that the two act as one, points to a single combined work.
- **Allowed by separation:** Pavé starting Blender with a job file and a model file and reading images back (today's code); shipping our GPL worker script in its own directory; rendering with Blender on our own servers and sending images, which is not conveying Blender, and GPL-3.0 has no network clause `[E]`.
- **Not allowed:** importing `bpy` or linking Blender or the Cycles-to-Blender glue into the Node server or studio; copying Blender source into Pavé; a proprietary worker; calling something separate while loading it as a library; terms that restrict the user's rights in the GPL part.

| Mode | What Pavé conveys | Obligations | Notes |
|---|---|---|---|
| User installs Blender; Pavé finds it (today: `PAVE_BLENDER`, saved path) | Our GPL worker script | Licence text and source of the worker | Cleanest; worst first run |
| Pavé fetches `bpy` from upstream when asked (today: `setup:blender`) | Arguably nothing of Blender `[E]` | As above | The wheel is 254.5 MB for macOS ARM, Python 3.13 only `[V]` ([PyPI](https://pypi.org/project/bpy/)) |
| Blender inside Pavé's installer | Blender's GPL binaries | Licence text; source access (Blender's FAQ: for official releases, pointing to blender.org's sources is enough `[V]`); it must stay a separable aggregate | Counsel should review; app-store terms sit badly with GPL `[E]` |

Isolation keeps Blender legal to use. It does not make renders work when Blender is absent, which is the requirement; that needs (a), (b) or (c1).

### 4.6 (e) Denoisers

| Denoiser | Licence | Apple silicon | Redistribution | Use |
|---|---|---|---|---|
| **Intel Open Image Denoise** 2.5.1 | Apache-2.0 `[V]` ([repo](https://github.com/RenderKit/oidn)); trained weights Apache-2.0 `[V]` ([weights](https://github.com/RenderKit/oidn-weights)) | CPU since 1.3; Metal GPU device since 2.2 (macOS Ventura+); also CUDA, HIP, SYCL `[V]` ([changelog](https://raw.githubusercontent.com/RenderKit/oidn/master/CHANGELOG.md)) | Free with notices | The denoiser for every path. Native: a library or sidecar beside the local server. In the browser: the same network as ONNX on WebGPU, e.g. the MIT project Denoiser, which reports about 0.1 s per 1080p frame on an M-series laptop `[V]` ([repo](https://github.com/DennisSmolek/Denoiser)); not tested here |
| **NVIDIA OptiX denoiser** | Part of OptiX (§4.4) | None | Binary only, NVIDIA hardware only `[V]` | Not needed. Blender's manual says Open Image Denoise usually gives the best quality `[V]` ([manual](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/sampling.html)) |

Measured: Cycles at 64 samples plus Open Image Denoise gave a clean 512 px hero still in 25 s on two cores. The `pyoidn` 2.5.1.0 wheel denoised our own tracer's 512 px output in 0.5–0.6 s with no guide images, and kept the facet pattern and the flashes `[V run]`. The wheel is 171 MB because it bundles every GPU backend; a product build should be CPU and Metal only `[E]`.

## 5. Jewelry-specific shortcuts a contained renderer can use

1. **A faceted stone is a convex polyhedron.** Store it as planes: entering is the latest entry plane, leaving is the earliest exit plane. No BVH, no triangles, and the tracer knows from its own state whether a ray is inside a stone. In the spike's C tracer on the close-up, the plane version (121 planes with a 64-sided girdle) used 264–302 CPU-seconds; the same stone as 366 triangles in a simple BVH used 463–487 `[V run]`. A tuned BVH would narrow that `[E]`; the larger wins are robustness, exact facet edges and a GPU loop with no pointer chasing. All melee stones of a cut share one plane list.
2. **Exceptions need a fallback:** hearts are not convex (two convex pieces), cabochons and carvings are curved (mesh in the BVH). The kernel owns cut geometry (`packages/kernel/src/gems`, `GEM_CUTS`), so plane lists should come from there.
3. **Scenes are tiny.** Everything fits in a few megabytes of GPU buffers and the BVH builds in milliseconds in the page. Swapping a metal or a stone changes a few numbers, so a variant starts rendering at once.
4. **One wavelength per path gives fire for free.** Cycles 5.3 took 133 s with dispersion and 130 s without on the same view `[V run]`. The cost is colour noise on everything. The standard fix is hero-wavelength sampling: carry four wavelengths, let one steer, and drop to one only when the path refracts through a dispersive surface `[V]` ([Wilkie et al. 2014](https://cgg.mff.cuni.cz/~wilkie/Website/EGSR_14_files/WNDWH14HWSS.pdf)).
5. **Spectral data is small:** a dozen n,k rows per metal, a Cauchy or Sellmeier fit per gem, one absorption curve per coloured stone.
6. **Light linking is one flag.** The rig's sparkle lights "only gems see"; in our engine that is a test at the hit.
7. **Caustics can be aimed.** The hard paths are light → stone → ground.

| Method | For faceted stones |
|---|---|
| Plain path tracing | Fine under large soft boxes; small bright lights leave speckle on the ground, seen in Cycles, LuxCore and our tracer `[V run]`. Clamping and glossy filtering hide it but dim sparkle (03-rendering §1) |
| Manifold next-event estimation | Cycles ships it as "shadow caustics": refractive only, at most 6 surfaces, **smooth normals only** `[V]` ([manual](https://docs.blender.org/manual/en/latest/render/cycles/object_settings/object_data.html)). Facets are flat, so it does not apply |
| Specular manifold sampling | A Newton solver for specular chains between two points `[V]` ([Zeltner et al. 2020](https://rgl.epfl.ch/publications/Zeltner2020Specular)). Possible, complex, one solution per try |
| Specular polynomials | Root finding that returns all solutions; exact for one bounce, bisection for more `[V]` ([Fan et al. 2024](https://arxiv.org/abs/2405.13409)). Deep chains in a brilliant are beyond it today `[E]` |
| Path guiding | In Cycles: CPU only, diffuse and glossy surfaces `[V]` ([manual](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/sampling.html)); Open PGL has no GPU backend `[V]` |
| **Photon pass aimed at stones** | **Recommended** `[E]`: emit from each light only toward each stone's bounding sphere, trace through the stone at one wavelength, splat on the ground into a small texture, filter. Targets are tiny and known and the receiver is a plane, so it is cheap and deterministic. LuxCore's light-tracing hybrid is the general form (ran here `[V run]`, no clear gain at 192 samples) |

8. **Small stones can be cheaper:** under about 12 px (03-rendering §5), fewer bounces or a per-cut table of exit directions shared by every stone of that cut `[E]`.
9. **Literature and products** `[E]`, not opened (search budget; one site refused): Guy and Soler's "Graphics Gems Revisited" (SIGGRAPH 2004) rendered faceted stones in real time from convex facets; trade tools such as DiamCalc ray-trace a cut from its proportions. Topic 14 covers these.
10. **What Cycles does for all of the above:** nothing special. A stone is a triangle mesh in the general BVH with the general Principled material; fire is the 5.3 dispersion input `[V]` ([5.3 notes](https://developer.blender.org/docs/release_notes/5.3/cycles/)); caustics are plain path tracing. That generality is what a contained engine does not pay for.

## 6. Spikes

Run here on 25 Nov 2026: **Linux, 2 virtual CPU cores (Xeon 2.1 GHz), 7 GB RAM, no GPU**, shared with other agents, so wall-clock time was often inflated. The main figure is therefore **CPU-seconds** of the render process; on an idle 2-core machine wall-clock is about half of it (measured wall-clock is given where the machine was quiet). Total render time for all spikes was about 70 minutes.

### 6.1 The scene (`make_scene.py`, numpy only)

- **Stone:** a round brilliant built as an intersection of planes. Diameter 6.5 mm, table 57 %, crown angle 34.5°, pavilion angle 40.75°, girdle 3.5 % at the mains with 64 flat girdle faces, star length 50 %, lower-half length 77 %, pointed culet. Result: crown height 14.8 %, pavilion depth 43.1 %, total depth 61.4 %, and 1 table + 8 star + 8 bezel + 16 upper girdle + 8 pavilion main + 16 lower girdle = **57 facets** `[V run]`. Index 2.417, Abbe number 55.3, as n = 2.37836 + 13 418 nm² / λ², which gives the trade dispersion of 0.044.
- **Ring:** an elliptical-section band (17 mm inside, 2.4 mm wide, 1.7 mm thick), a gallery rail and four 0.84 mm prongs that seat on the girdle and hook over the crown; 20 224 triangles, smooth normals. Gold: spectral gold where the engine has it, the repository's 24k F82 colours in Cycles, near-mirror polish.
- **Studio:** diffuse ground (albedo 0.8), four one-sided soft boxes, three 7 mm sparkle panels 260 mm away, a dim uniform environment. No HDRI.
- **Views:** "hero" (whole ring, 25° elevation) and "macro" (the stone, 52° elevation). 512 × 512, depth 32, no clamping, no depth of field.
- Exported once (`gem.ply`, `metal.ply`, OBJ copies, `scene.json`); every engine reads those files, and the plane tracer reads the planes the mesh was cut from. One shared display transform for all engines (`tonemap.py`).

### 6.2 What ran

| Engine | How | Colour and dispersion |
|---|---|---|
| **Mitsuba 3.9.1** (`pip install mitsuba`) | `llvm_ad_spectral`, stock path tracer | Spectral. "No fire": built-in `dielectric`. "Fire": my Python dispersive dielectric plus a wrapper integrator giving each path one wavelength |
| **Blender Cycles 5.3.0** (`pip install bpy==5.3.0`, own process) | CPU, 2 threads, fixed samples, caustics on | RGB with native Principled dispersion |
| **LuxCore 2.11.2** (`pip install pyluxcore`) | `PATHCPU`; one run with hybrid back/forward light tracing | RGB with Cauchy dispersion on glass |
| **Our tracer, C** (`ptgem.c`, 340 lines) | Stone as 121 planes, metal in a median-split BVH, direct-light sampling with MIS on the ground, mirror-polished metal | One wavelength per path; gold from a 12-row n,k table |
| **Our tracer, WGSL** (`ptgem.wgsl`, 247 lines, via wgpu-py 0.33) | The same algorithm as one WebGPU compute shader. With no GPU it ran on Mesa llvmpipe (a CPU) through wgpu's OpenGL backend | Same |

All five installed and ran; nothing failed to install. Two things were not as assumed. Mitsuba has no dispersion (above). And my tracer's first version let light pass through the back of the soft boxes, which made the ground 9 % too bright near the ring; a block-by-block comparison with Mitsuba found it, and after the fix our tracer, Cycles and Mitsuba agree on mean brightness to under 1 % in both views. LuxCore agrees on the whole ring but its close-up is 15 % brighter; I did not chase why.

### 6.3 Timings on this machine (2-core Linux CPU; not the founder's laptop)

| Engine, mode | View | Samples | CPU-seconds | Wall-clock when quiet |
|---|---|---|---|---|
| Mitsuba, no fire (4 wavelengths per path) | hero / macro | 264 | 35 / 64 | — |
| Mitsuba, fire (1 wavelength per path) | hero / macro | 517 | 57 / 111–115 | 31 s / 58 s |
| Mitsuba, fire, reference | hero / macro | 2057 | 256 / 460 | — |
| Cycles, fire | hero / macro | 256 | 181 / 251 | 91 s / 133 s |
| Cycles, no fire | macro | 256 | 243 | 130 s |
| Cycles, fire, 64 samples + Open Image Denoise | hero | 64 | 46 | 25 s |
| LuxCore, fire | hero / macro | 192 | 177 / 219 | — / 117 s |
| LuxCore, fire, light-tracing hybrid | hero | 192 | 127 | 89 s |
| Our C tracer, planes | hero / macro | 512 | 146 / 264–302 | — / 143 s |
| Our C tracer, stone as triangles in a BVH | macro | 512 | 463–487 | — |
| Our C tracer, no fire | macro | 512 | 261–265 | — |
| Our WGSL shader on llvmpipe (CPU) | hero / macro | 256 | 104 / 284 | 91 s / 235 s |
| Open Image Denoise on our 512 px output | both | — | 0.5–0.6 | 0.5–0.6 s |

**Per sample** (CPU-seconds for one sample over the frame, hero / macro): Mitsuba 0.11–0.13 / 0.22–0.24; our C tracer 0.29 / 0.52–0.59; Cycles 0.71 / 0.98; LuxCore 0.92 / 1.14. Our tracer traced 3.2 rays per path on hero and 4.2 on macro, 2–3 million rays per CPU-second.

**Per unit of noise** the order changes. Mean absolute difference from the 2057-sample reference, display values 0–1, averaged over 4 × 4 blocks:

| | Mitsuba fire 517 | Cycles 256 | Cycles 64 + denoise | Our C 512 | Our C 512 + denoise | Our WGSL 256 | LuxCore 192 |
|---|---|---|---|---|---|---|---|
| hero | 0.0082 | **0.0054** | 0.0055 | 0.0086 | 0.0070 | 0.0103 | 0.0096 |
| macro | 0.0086 | **0.0079** | — | 0.0117 | 0.0103 | 0.0137 | 0.0230 |

For scale: switching dispersion off moves the macro image by 0.011. So at similar CPU time Cycles is closer to the reference than our spike. Reasons: one wavelength per path (Mitsuba in the same mode shows the same noise), no roughness on our metal, and our gold hue (below).

**WGSL on a CPU** was only 1.4–2 times slower per sample than the native C, which says the shader has no hidden cost; it says nothing about GPU speed.

### 6.4 What the images show

I looked at every image. A side-by-side is in [`spikes/15-renderer/comparison.jpg`](./spikes/15-renderer/comparison.jpg); the full-size images stayed outside the repository.

- **Agreement.** Cycles, Mitsuba with my dispersive material, and both versions of our tracer show the same close-up: the same bright and dark facets, the same reflections of the prongs inside the stone, and the same saturated flashes (magenta upper left of centre and at the right prong, yellow at the left, cyan specks) in the same facets. Three independent implementations agreeing is the strongest result of the spike.
- **Fire:** present and believable in those four. In LuxCore at 192 samples it is coloured speckle, not clean flashes. In the whole-ring view the stone is about 100 px wide and fire reads only as a few coloured pixels in every engine.
- **Contrast pattern:** believable bright and dark facets, but **no arrows**. The view is not face-up and nothing dark sits above the stone (a real camera and photographer do); the studio is bright all round. Arrows and stronger contrast need a dark card over the table in the light rig. That is a lighting preset, not an engine fault.
- **Gold:** convincing in Cycles and Mitsuba, which agree (mean linear colour on gold pixels 1 : 0.75 : 0.34 and 1 : 0.74 : 0.33). Ours is slightly orange (1 : 0.69 : 0.35): my n,k table was typed from memory and my white point is simplified. LuxCore's "gold" preset is pale and greenish (1 : 0.89 : 0.43).
- **Noise and faults:** Cycles has a clean ground with scattered bright speckles (unresolved caustics from the sparkle lights) and a few coloured hot pixels. Mitsuba in one-wavelength mode and our tracer have fine colour grain everywhere at 512 samples. Our metal is a perfect mirror, a little harder than the others. Our tracer has no depth of field, no rough metal, no absorption: it proves the stone, not the product.
- **Denoised:** Cycles at 64 samples plus Open Image Denoise looks finished at ring size, with the stone a little smoothed. Our output denoised without guides keeps facets and flashes at close-up; a few coloured specks remain on the ground.

### 6.5 Estimate for an Apple M2 MacBook Air `[E]`

Estimates, not measurements, for a 1024 px still at 256 samples (four times the pixels of the spike).

| | This machine, measured and scaled ×4 | M2, 8 CPU cores `[E]` | M2 GPU `[E]` |
|---|---|---|---|
| Cycles 5.3 | 6–9 min quiet wall-clock | 50–110 s | 15–35 s on Metal, after kernels load |
| Our kernel | 2.5–5 min (C tracer, whole ring to close-up) | 20–60 s natively | 10–40 s through WebGPU |

Basis: this box is one shared Xeon core with two threads. I take the M2's CPU as 5–7 times faster on Cycles and its GPU on Metal as 3–4 times its CPU, from public Blender benchmark medians as I remember them; Blender Open Data would not open to confirm. For our kernel: 0.9–1.1 billion rays for that still (measured rays per path), at an assumed 30–100 million rays per second on the M2's GPU with a software BVH. That assumption is the weakest number in this file. With hero wavelengths and denoising, 64–128 samples may be enough, which would cut the time by two to four. A 2048 px, 512-sample final is eight times these figures. A fanless Air will slow down under minutes of sustained load `[E]`, which matters for animation.

### 6.6 Commands to repeat the spike on the Mac

The scripts are in [`spikes/15-renderer/`](./spikes/15-renderer/). In that folder (make an `out` folder first with `mkdir -p out`):

```bash
brew install llvm libomp python@3.13
python3.13 -m venv venv && venv/bin/pip install mitsuba numpy pillow wgpu pyoidn
python3.13 -m venv venv-bpy && venv-bpy/bin/pip install bpy==5.3.0 numpy
venv/bin/python make_scene.py
```

```bash
venv/bin/python render_mitsuba.py macro 512 disp 512 32            # spectral, with fire, CPU
venv-bpy/bin/python render_cycles.py macro 256 disp 512 32          # Cycles on the CPU
SPIKE_CYCLES_DEVICE=METAL venv-bpy/bin/python render_cycles.py macro 256 disp 512 32
clang -O3 -Xclang -fopenmp -I"$(brew --prefix libomp)/include" -L"$(brew --prefix libomp)/lib" -lomp ptgem.c -o ptgem -lm
./ptgem scene macro 512 512 32 out/own_macro_disp.raw && venv/bin/python raw2npy.py out/own_macro_disp.raw
venv/bin/python render_wgsl.py macro 256 512 32                     # our shader on the Apple GPU: the number that matters
venv/bin/python tonemap.py out/*.npy
```

Each script prints one JSON line with `render_s` and `cpu_s`. On the Mac wgpu should pick Metal by itself. If Mitsuba cannot find LLVM, point `DRJIT_LIBLLVM_PATH` at Homebrew's `libLLVM.dylib` `[E]`. None of this was tested on macOS.

## 7. Recommendation

**One path: our own contained path tracer, written once as WGSL kernels, hosted first in the studio (WebGPU) and later headless (Dawn or wgpu) on render nodes; Open Image Denoise for denoising; Cycles and Mitsuba 3 as separate-process references; Cycles standalone as the named plan B.**

**Why.**

1. It is the only option that works everywhere the product runs: on the laptop with nothing installed, and in a hosted Pavé whose servers have no GPU (the deploy plan's assumption) while the user's machine does. Rendering on the user's GPU costs us nothing per render.
2. The hard part of jewelry, the stone, is within reach of a small code base: the same pattern and fire as Cycles and Mitsuba from 340 lines, and the WGSL port ran unchanged in logic.
3. One camera and one scene description for viewfinder, preview and final, in the team's language.
4. It can do what general engines do not: stone-only lights for free, an aimed caustics pass, facet-aware denoising, later birefringence and spectral colour change.

**Why the others lose.** Cycles standalone has the least research risk and is licence-clean, but it is native only: a C++ build, sign and update pipeline on three systems, no stated stable API, no browser, no client-side rendering when hosted, no gain for the viewport. It is plan B, or plan A if the founder prefers certainty to reach. A native tracer of our own is the same engine plus packaging, so it comes second, as a host for the same kernels. LuxCore is CPU only on Macs, was slowest to resolve fire here and is a small project. Mitsuba 3 and pbrt-v4 are research and teaching engines; Mitsuba stays as the reference. OptiX and Iray are NVIDIA-only under proprietary terms. Bundling Blender is still Blender: 250+ MB, GPL obligations, counsel; an optional extra, not the answer. three-gpu-pathtracer is two months old on WebGPU, not yet stable, RGB and general-purpose.

**Risks.**

| Risk | Mitigation |
|---|---|
| Efficiency gap to Cycles (§6.3) | Hero wavelengths, rough conductors with proper light sampling, denoise; gate on noise at equal time, not on samples |
| The long tail: brushed and hammered metal, pearls, opal, enamel | Staged gates against references; ship polished metal and faceted stones first and say so |
| Denoisers smoothing facets and fire | More samples inside stones (the mask is free), facet id and normal as guides, less denoise weight on stone pixels |
| Caustics on the ground | The aimed photon pass in stage 2; until then looks without small lights on the ground |
| WebGPU differences: Safari from 26 only, pass time limits, 32-bit floats | Short passes, tested offsets, a capability check that falls back to the WebGL preview or Blender |
| Colour: our gold was off in the spike | Metal and view-transform values come from the shared material library and are tested against the references |
| Scope creep into a general renderer | The "skip" column of §3 is part of the plan; the rest goes to Blender |
| It takes longer than estimated | Trigger: if stage 1 has not passed ten weeks after it starts, build the Cycles sidecar instead |

**Roadmap.** One experienced graphics engineer plus part of an application engineer `[E]`, ±50 %. "Distance" is the 4 × 4-block display-space measure of §6.3 against a converged Cycles or Mitsuba render of the same `ResolvedScene`.

| Stage | Ships | Acceptance check | Effort `[E]` |
|---|---|---|---|
| **0. References, viewport** | A reference harness outside the product (fixtures rendered by Cycles in its own process and by Mitsuba); the distance tool; plane lists for every cut; the viewport gem shader moved from a mesh BVH to planes | On each fixture Cycles and Mitsuba agree within 0.010 (here: 0.005 and 0.008); viewport frame time on the M2 Air no worse than today | 2–3 weeks |
| **1. Stills** | WGSL kernel (plane gems, metal BVH, GGX conductors with anisotropy, panels, sparkles, ambient, three grounds, depth of field, one wavelength per path, fixed seed), time-sliced host, Open Image Denoise, view transforms, `engine: 'pave'` takes through the browser-take flow, metrics without the GPL worker | Six fixtures (solitaire, three coloured stones, 200-stone band, brushed band, black acrylic, white catalogue): denoised distance ≤ 1.5 × the Cycles-to-reference distance and never above 0.012 (the spike reached 0.007 and 0.010 on its one easy scene); subject box within 1 % of `predictFraming`; a 1024 px still in ≤ 60 s on the M2 Air; identical pixels on a re-run | 6–8 weeks |
| **2. Fire, caustics, materials** | Hero wavelength with three companions, Sellmeier and absorption spectra, aimed photon pass, thin film, pearl and opal approximation, relief normals, facet-aware denoise | Noise at equal time within 1.25 × Cycles on the fixtures; ground caustic energy within 10 % of a light-tracing reference; a blind comparison by working jewelers against Cycles on ten pieces: ours chosen or "no difference" at least half the time | 5–7 weeks |
| **3. Animation** | Frame loop over the existing tracks, stable noise across frames, per-frame denoise, video encode, resume at the first missing frame | A 120-frame 1080 px turntable in ≤ 30 min on the M2 Air `[E]`; flicker in static regions no worse than the Cycles reference plus 10 %; no visible loop seam in a frame difference | 3–4 weeks |
| **4. Servers, other GPUs** | The same kernels headless (Node with Dawn, or a Rust wgpu sidecar) behind the deploy plan's render-node protocol; Windows and NVIDIA validation | A node renders a queued take end to end within the stage 1 distance of the browser's image; a licence scan in CI finds nothing GPL in any shipped process | 3–5 weeks |

Total 19–27 weeks. Stage 0 is needed whichever plan is chosen.

## 8. What this means for the plan

Inputs for `docs/plans/jewelry-renderer.md`.

**Build first (stage 0, no product risk).**
- The reference harness in a tools folder: fixtures as `ResolvedScene` plus geometry, a Cycles runner (the existing GPL worker, separate process), a Mitsuba runner (own process; it needs the dispersive material from the spike), the distance tool. The spike scripts are a start.
- Plane lists per cut from the kernel, with a convexity flag and a mesh fallback.
- An engine-neutral runner interface in `queue.ts`, a third `engine` value in the schema, and a WebGPU capability probe reported like `capabilities.blender`.

**Design rules for stage 1.** WGSL kernels with no three.js dependency, so any host can run them. Spectral from the first day. Gems never as triangles unless non-convex. Lights and ground exactly as `ResolvedRig` and `ResolvedGround` define them. The accumulation buffer is the checkpoint, which fits the chunked resume in the deploy plan. A dark card over the stone in the default looks (§6.4).

**Decisions that are the founder's.**
1. **Plan A:** our own engine (recommended: more reach, more risk) or the Cycles sidecar (less risk, native only). The trigger in §7 applies either way.
2. **People:** one graphics engineer for about six months, or the equivalent agent time with a person who can judge images.
3. **Pricing:** renders are the paid feature (5 free a month). A render on the user's own GPU costs us nothing. Does a take from our engine count against the allowance, and how is it labelled next to a Blender take?
4. **Quality bar and judge:** who decides "photoreal enough", on which pieces. I propose the blind comparison in stage 2.
5. **Blender's later role:** optional high-end engine the user installs, bundled (mode 3 in §4.5, with counsel), or retired after stage 2.
6. **Platform order:** confirm Apple silicon, then Windows with NVIDIA, then server GPUs; and whether Macs whose Safari lacks WebGPU must work outside Chrome.
7. **Spectral-only features as goals:** alexandrite colour change, moissanite doubling.
8. **Counsel:** §4.5 (bundling, the hosted case) and the notices needed if Cycles standalone is ever shipped.

**Open questions I could not close.**
- The WGSL kernel's real speed on an M2 through Metal (§6.6 answers it in ten minutes on the Mac).
- How well Open Image Denoise keeps facets at production size, natively and in the browser.
- Whether one large compute pass stays inside browser GPU time limits at 2048 px, or needs tiles.
- The current OptiX licence text and the FSF FAQ wording.

## 9. Repo notes for the lead

1. `docs/research/03-rendering.md` §6 says "Do not write a path tracer"; `docs/PLAN.md` (B1) makes our own renderer a priority. This file supersedes 03 on that point only.
2. 03-rendering cites Cycles' `bsdf_microfacet.h` for dispersion. The standalone repository's copy has no dispersion code `[V]`. Dispersion in 5.3 is confirmed by the release notes and the spike; how it samples wavelengths is not verified at source.
3. 03-rendering §5 says three-gpu-pathtracer's README lists dispersion, volumes and an OIDN denoiser. The README I opened lists lights, denoising and upscaling, and depth of field, and no dispersion `[V]`. The version and date (0.0.28, 2 Nov 2026) are right.
4. This topic's brief assumed Mitsuba's spectral variants give dispersion. They do not in 3.9.1 without custom code `[V run]`.
5. `workers/render/LICENSE` is a short notice with a link, not the licence text. GPL-3.0 section 4 asks that recipients get a copy `[V local]`; add the full text before the worker is distributed.
6. `docs/plans/render-and-models.md` keeps `metrics.py` as the only metrics implementation (§4.2) and cuts browser animation export (§6). An engine in the browser needs both without the GPL worker.
7. `apps/server/src/engines/render/queue.ts` assumes Blender (availability check, cache key, failure text) and `RenderJob.engine` has two values; both need widening.
8. `docs/plans/deploy-and-durable-jobs.md` plans GPU render nodes because the host has no GPUs. With an in-browser engine, hosted stills can render on the user's machine; the plan should say what nodes are then for (batches, animation, machines without WebGPU).
9. Re-checked from 03-rendering and still right `[V]`: bpy 5.3.0 wheel size and Python 3.13 only (PyPI), path guiding CPU only and shadow caustics needing smooth casters (Blender manual), three-gpu-pathtracer 0.0.28 on 2 Nov 2026 (npm).
10. The viewport `GemMaterial` stops at 8 bounces on a mesh BVH. The spike measured 3–4 rays per path on average but tails to depth 32; planes would make deeper bounces cheaper there too.

## 10. Sources

Every external link is given inline where it is used, with its label. Grouped:

- **Blender and Cycles `[V]`:** licence page, FAQ, Cycles standalone repository (LICENSE, BUILDING.md, `src/CMakeLists.txt`, `bsdf_microfacet.h`, README), cycles-renderer.org, Cycles 5.3 release notes, Blender manual (GPU rendering, object caustics, sampling), bpy on PyPI, McNeel's CCSycles.
- **Other engines `[V]`:** Mitsuba 3 (repository, LICENSE, variants, BSDF docs, PyPI), pbrt-v4, LuxCore (repository, [releases](https://github.com/LuxCoreRender/LuxCore/releases), PyPI), appleseed, Filament, OSPRay, MoonRay (repository, build docs), Radeon ProRender SDK (repository, license.txt).
- **Libraries `[V]`:** Embree, OSL, OpenVDB, OpenImageIO, oneTBB, Open PGL, Open Image Denoise (repository, changelog, [releases](https://github.com/RenderKit/oidn/releases), weights), Denoiser.
- **GPU platforms `[V]`:** NVIDIA OptiX page and the June 2017 DesignWorks agreement; Apple's Metal ray tracing sample and M3 announcement; three-gpu-pathtracer ([repository](https://github.com/gkjohnson/three-gpu-pathtracer), README, releases), three-mesh-bvh, Dawn, wgpu and its Features page, gpuweb issue 535, WebKit on Safari 26, Chrome for Developers on headless GPU.
- **Papers `[V]`:** Wilkie et al. 2014 (hero wavelength), Zeltner et al. 2020 (specular manifold sampling), Fan et al. 2024 (specular polynomials).
- **Registries queried `[V]`:** mitsuba 3.9.1, bpy 5.3.0, pyluxcore 2.11.2, wgpu-py 0.33.0, pyoidn 2.5.1.0; npm `webgpu` 0.6.2 (MIT), three-gpu-pathtracer 0.0.28 (MIT, 2 Nov 2026), three 0.187.0, three-mesh-bvh 0.10.0 (MIT).
- **Local `[V run]` `[V local]`:** spikes in `docs/research/spikes/15-renderer/` (`results.jsonl`, `results2.jsonl`); GPL-3.0 text at `/usr/share/common-licenses/GPL-3` (sections 2, 4, 5, 6).
- **Could not open (kept `[S]` or `[E]`):** the FSF GPL FAQ (gnu.org refused), Blender Open Data benchmark tables, the KeyShot manual, the LuxCore wiki, Guy and Soler 2004, the manifold next-event estimation paper (Hanika et al. 2015), the current OptiX licence text.
