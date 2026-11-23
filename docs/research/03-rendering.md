# 03 — Photoreal jewelry rendering: real-time viewport and AI-driven Blender (Nov 2026)

**Research limits.** The shared web-search budget ran out after about ten queries, and most hosts (blender.org, threejs.org, gia.edu, polyhaven.com, 80.lv) are blocked for direct fetch. Evidence is therefore, in order of weight: (a) experiments run in this container, (b) source files read from GitHub raw, npm and PyPI, (c) search extracts of the linked pages. Claims marked † come from prior knowledge and were not re-checked this session. Material numbers marked *calc* were computed here from public n/k data; those marked *est* are estimates to calibrate against real swatches.

## 0. Verified in this container

| Check | Result |
|---|---|
| Install | `python3.13 -m venv venv && venv/bin/pip install bpy-5.3.0-cp313-cp313-manylinux_2_28_x86_64.whl` from the pre-downloaded wheel; dependencies (numpy, requests, zstandard, cython, cattrs) came from PyPI in 13 s. Equivalent to `pip install bpy==5.3.0`. 428 MB wheel, 918 MB installed, Python 3.13 only, licence GPL-3.0 ([PyPI](https://pypi.org/project/bpy/)). |
| System libs | `ldd bpy/__init__.so` needs libX11, libXrender, libXfixes, libXi, libxkbcommon, libSM, libICE, libGL, libXext, libxcb. All were already in the Ubuntu 24.04 image, so nothing was installed. On a slim image: `apt-get install -y libx11-6 libxrender1 libxfixes3 libxi6 libxkbcommon0 libsm6 libice6 libgl1`. libXxf86vm is not linked by 5.3. |
| Headless Cycles CPU | Works. `import bpy` takes 1.5 s; build has OIDN, Embree, OSL, OpenPGL, USD, FFmpeg. |
| Render time (4 vCPU, no GPU) | Ring (smooth torus, flat 49-face gem with dispersion, 2 area + 3 point lights, 24 bounces, OIDN): 512² at 128 spp = 21–26 s; same with path guiding = 51.5 s; 1024² at 256 spp = 178 s. |
| EEVEE headless | Fails: `Couldn't open libEGL.so.1`, no Vulkan device. Not pursued (`apt` could not locate `libegl1`). |
| GLB round trip | bpy's glTF importer kept node names, material names, `extras` (as custom properties), metre units, and flat versus smooth shading from vertex normals. |
| Draco / meshopt | The wheel logs "Draco is not available" and "MeshOptimizer is not available". Do not compress GLBs sent to the worker. |

## 1. Blender for jewelry in 2026

Blender 5.3 shipped 10 Nov 2026 ([CG Channel](https://www.cgchannel.com/?p=180007), [Phoronix](https://phoronix.com/news/Blender-5.3-Released)); 5.2 is the LTS (14 Jul 2026, fixes to Jul 2028) ([release notes](https://developer.blender.org/docs/release_notes/5.2/rendering/)); `main` is 5.4 alpha. PyPI carries `bpy` 5.1.0 to 5.3.0.

| Feature | Status for gems and metal |
|---|---|
| Dispersion | **Native since 5.3**, Principled BSDF only. Sockets `Transmission Dispersion Scale` (clamped 0–1, default 0) and `Transmission Dispersion Abbe Number` (default 20), confirmed in bpy 5.3. Cycles samples one wavelength per path and applies the OpenPBR 1.1.1 Cauchy fit; the rest of the pipeline stays RGB ([kernel source](https://github.com/blender/blender/blob/main/intern/cycles/kernel/closure/bsdf_microfacet.h), [80.lv](https://80.lv/articles/understanding-native-dispersion-in-blender-5-3)). Glass BSDF has no dispersion socket. On 5.2 LTS the RGB-split IOR trick is still needed. |
| Metallic BSDF | `F82` (base colour + edge tint) or `PHYSICAL_CONDUCTOR` (RGB n, k). Thin-film sockets exist on Principled, Glass and Metallic. |
| Path guiding | OpenPGL, off by default, CPU-only†. It doubled render time in our test with no visible gain; reserve it for caustics-on-floor shots. |
| Shadow caustics (MNEE) | Per-light `is_caustics_light` plus caster/receiver object flags. It needs smooth-shaded casters and is not a general caustics solver ([#97784](https://projects.blender.org/blender/blender/issues/97784), [#96991](https://projects.blender.org/blender/blender/issues/96991)). Faceted gems are flat-shaded, so use ordinary path-traced caustics instead. |
| Light linking | `object.light_linking` present. Use it for gem-only sparkle lights and metal-only reflection cards. |
| Denoise | OIDN on CPU (default). OptiX on RTX†. DLSS Ray Reconstruction in 5.3 is viewport-only per coverage ([Phoronix](https://phoronix.com/news/Blender-5.3-Released)). |
| View transforms | AgX (default), Filmic, Standard, Khronos PBR Neutral, ACES 1.3, ACES 2.0, Raw; looks such as `AgX - Medium High Contrast` (all accepted by bpy 5.3). |
| EEVEE | Raster with screen-space refraction, so no internal reflection chain in gems. Needs a GPU and EGL/Vulkan. Not a path for final gem renders. |

### Recommended Cycles settings

bpy 5.3 defaults: 4096 samples, noise threshold 0.01, bounces 12 total / 4 glossy / 12 transmission / 4 diffuse / 8 transparent, indirect clamp 10, filter glossy 1.0, both caustics on, OIDN on.

| Setting | Draft (critique loop) | Final still | Animation frame |
|---|---|---|---|
| Resolution | 768² | 2048²–3000² | 1080² or 1920×1080 |
| Max samples / noise threshold | 64 / 0.05 | 512–1024 / 0.01 | 192–256 / 0.02 |
| Bounces total / transmission / glossy / diffuse | 16 / 16 / 8 / 2 | 32 / 32 / 16 / 4 | 24 / 24 / 12 / 4 |
| Clamp direct / indirect | 0 / 10 | 0 / 0–10 (clamping dims sparkle) | 0 / 5–10 |
| Caustics reflective + refractive | on | on | on |
| Filter glossy | 1.0 | 0–0.2 | 0.5 |
| Denoise | OIDN | OIDN with albedo + normal, or none above 1024 spp | OIDN, `use_animated_seed` |
| Film | opaque | transparent plus `film_transparent_glass` for cut-outs | opaque |
| Output | 8-bit PNG | 16-bit PNG or EXR, plus Cryptomatte | PNG sequence, then encode |

The defaults of 12 transmission and 4 glossy bounces are too low: brilliant cuts rely on long internal-reflection chains, and prongs reflect prongs. Colour: AgX for hero shots; Khronos PBR Neutral for colour-true catalogue shots, which also matches three.js `NeutralToneMapping`.

CPU versus GPU: extrapolating linearly from the 1024² test, a 2048² still at 512 spp is about 24 min on 4 vCPU, and a 120-frame 1080² turntable at 256 spp is about 6–7 h. Stills on CPU are acceptable; animation needs a GPU (OptiX) pool.

## 2. Material library

### Metals

Base colour is normal-incidence reflectance in linear sRGB; use it for Blender `Metallic BSDF` (F82) and three.js `color` with `metalness: 1`. *calc* rows were integrated here from [refractiveindex.info data](https://github.com/polyanskiy/refractiveindex.info-database) (CC0) under D65. The method reproduces the [Physically Based](https://github.com/AntonPalmqvist/physically-based-api) (CC0) value for copper exactly and for palladium to within 0.01.

| ID | Alloy (wt ‰) | Base colour (linear) | F82 edge tint | Basis |
|---|---|---|---|---|
| `au999` 24k | Au 999 | 1.000, 0.766, 0.336 | 0.97, 1.00, 0.98 | *calc*; datasets give R of 1.04–1.06 (out of gamut, clamp). n = 0.156/0.424/1.383, k = 3.60/2.47/1.92 at 650/550/450 nm |
| `au917-yellow` 22k | Au 917, Ag 50, Cu 33 | 1.00, 0.76, 0.40 | 0.97, 0.99, 0.99 | *est* |
| `au750-yellow` 18k | Au 750, Ag 125, Cu 125 | 0.98, 0.75, 0.47 | 0.98, 0.98, 0.99 | *est*, Lab ≈ 91, 3.5, 24 |
| `au585-yellow` 14k | Au 585, Ag 205, Cu 210 | 0.97, 0.76, 0.52 | 0.98, 0.97, 0.99 | *est* |
| `au750-rose` 18k | Au 750, Ag 45, Cu 205 | 0.97, 0.68, 0.48 | 0.98, 0.98, 0.97 | *est*, Lab ≈ 88, 8, 20 |
| `au585-rose` 14k | Au 585, Ag 90, Cu 325 | 0.96, 0.67, 0.51 | 0.98, 0.97, 0.97 | *est* |
| `au750-white` unplated | Pd or Ni white | 0.67, 0.61, 0.52 | 0.85, 0.86, 0.88 | *est*, low confidence; real alloys span a wide yellowness range† |
| `rhodium` (plated white gold) | Rh | 0.80, 0.77, 0.745 | 0.81, 0.82, 0.84 | *calc*; n = 2.19/1.97/1.75, k = 5.74/5.02/4.45 |
| `pt950` | Pt 950 | 0.72, 0.68, 0.63 | 0.79, 0.82, 0.85 | Between Rakić fit (0.68, 0.64, 0.58) and Physically Based (0.765, 0.730, 0.676) |
| `pd950` | Pd 950 | 0.733, 0.697, 0.652 | 0.83, 0.85, 0.89 | *calc*, pure Pd |
| `ag925` sterling | Ag 925, Cu 75 | 0.95, 0.93, 0.88 | 0.99, 0.99, 1.00 | *est*; pure silver is 0.989, 0.984, 0.978 |
| `titanium` | Ti | 0.542, 0.497, 0.449 | 0.77, 0.79, 0.82 | Common engine value†; datasets range from 0.44 to 0.62 |
| `rhodium-black` | plated | 0.23, 0.23, 0.22 | 0.6, 0.6, 0.6 | *est*, artistic |

The gold alloy rows combine atomic-fraction mixing of the Au/Ag/Cu dielectric functions with remembered CIELAB values†. That mixing fails for white gold, which is why that row is low confidence.

| Finish | Roughness | Anisotropy | Normal detail |
|---|---|---|---|
| High polish | 0.03–0.06 (never 0) | 0 | none |
| Satin | 0.25–0.30 | 0 | none |
| Brushed | 0.30–0.35 | 0.7–0.8 along the brush direction | optional fine scratch map |
| Matte / sandblast | 0.50–0.60 | 0 | grain bump at 0.02–0.05 mm |
| Hammered | 0.08–0.12 | 0 | cellular normal map, 1–2 mm cells, strength 0.3–0.5 |

Finish values are starting points†.

### Gems

RI, birefringence and B–G dispersion are standard gemmological figures† ([GIA Gem Encyclopedia](https://www.gia.edu/gem-encyclopedia)). Abbe numbers marked *calc* come from Sellmeier fits in the refractiveindex.info database; those fits reproduce the trade B–G figures for diamond (0.044), corundum (0.018), CZ (0.060) and quartz (0.013). Other Abbe numbers use V ≈ (n − 1) / (0.58 × B–G); the 0.57–0.59 ratio was measured across six fits. Attenuation colours are *est*.

| Gem | RI | Biref. | B–G | Abbe V | Attenuation colour @ mm |
|---|---|---|---|---|---|
| Diamond | 2.417 | none | 0.044 | 55.3 *calc* | 1, 1, 1 |
| Moissanite | 2.648–2.691 | 0.043 | 0.104 | 25 *calc* (24–26) | 0.99, 0.99, 0.96 @ 10 |
| Cubic zirconia | 2.15–2.18 | none | 0.060 | 33.5 *calc* | 1, 1, 1 |
| Sapphire / ruby (corundum) | 1.762–1.770 | 0.008 | 0.018 | 72.3 *calc* | blue 0.05, 0.15, 0.75 @ 4; pink 0.95, 0.35, 0.60 @ 5; yellow 0.98, 0.80, 0.15 @ 6; ruby 0.85, 0.03, 0.08 @ 4 |
| Emerald / aquamarine / morganite (beryl) | 1.577–1.590 | 0.006–0.008 | 0.014 | 71 | emerald 0.05, 0.60, 0.25 @ 5; aquamarine 0.55, 0.88, 0.92 @ 8; morganite 0.98, 0.72, 0.70 @ 8 |
| Amethyst / citrine (quartz) | 1.544–1.553 | 0.009 | 0.013 | 69.7 *calc* | amethyst 0.55, 0.25, 0.80 @ 6; citrine 0.95, 0.65, 0.10 @ 8 |
| Topaz, blue | 1.609–1.627 | 0.009 | 0.014 | 76 | 0.30, 0.75, 0.95 @ 8 |
| Tourmaline, green | 1.624–1.644 | 0.020 | 0.017 | 64 | 0.10, 0.45, 0.25 @ 5 |
| Garnet, rhodolite / almandine | 1.76–1.79 | none | 0.026 | 50 | 0.55, 0.03, 0.05 @ 3 |
| Peridot | 1.654–1.690 | 0.036 | 0.020 | 58 | 0.55, 0.80, 0.15 @ 6 |
| Tanzanite | 1.691–1.700 | 0.009 | 0.021 | 57 | 0.30, 0.25, 0.85 @ 5 |

Mapping to renderers:

- **Blender:** IOR goes to `IOR`, V to the Abbe socket with scale 1.
- **glTF and three.js:** `dispersion = 20 / V` ([KHR_materials_dispersion](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_dispersion)), so diamond 0.36, moissanite 0.80, CZ 0.60, sapphire 0.28.
- **Absorption:** store it as glTF-style `attenuationColor` plus `attenuationDistance`. For Cycles compute σ = −ln(colour) / distance per channel (in metres), then set Volume Absorption density = max σ and colour = 1 − σ / density. Do not tint the Principled base colour; that ignores path length.
- **Birefringence:** no target renderer models double refraction. Use the mean RI. Moissanite's facet doubling will be missing.

Non-transmissive stones (never use the refraction shader):

| Stone | Recipe |
|---|---|
| Pearl | Opaque. Base 0.80, 0.75, 0.70; roughness 0.35; IOR 1.68; subsurface radius 0.3–0.5 mm; thin film 200–700 nm for orient (values from [Physically Based](https://github.com/AntonPalmqvist/physically-based-api)); add a coat layer for lustre. |
| Opal | Cabochon, RI 1.45†. Milky subsurface body plus thin-film iridescence with thickness 250–700 nm driven by 3D cellular noise. |
| Onyx | Opaque black dielectric, base 0.005, IOR 1.54†, roughness 0.03. |
| Turquoise | Opaque, base about 0.05, 0.50, 0.50, IOR 1.62†, roughness 0.2, optional matrix-vein texture. |

## 3. Lighting and staging

Standard product-photography practice†, turned into parameters; not source-checked this session.

- **Environment.** Poly Haven assets are CC0 and need no credit ([licence](https://polyhaven.com/license)†; restated in the [MCP for Blender README](https://github.com/ahujasid/mcp-for-blender)), so studio HDRIs can be bundled: 1k in the app, 4k fetched for finals. Better still, define the studio as light shapes in `RenderScene` and build it in both engines (drei `Lightformer`, Blender area lights), which gives matching preview and final with no asset dependency.
- **Catalogue white.** Large top softbox, two side strips, white sweep, shadow-catcher ground, and black cards to draw dark edge lines on polished metal.
- **Black acrylic.** Ground at roughness 0.05–0.10 and IOR 1.49, rim strips, mirrored reflection.
- **Gradient cards.** Emissive planes with a linear gradient, light-linked to metal, so curved surfaces show a smooth falloff.
- **Sparkle.** Three to eight point lights of 0.5–2 mm radius in the upper hemisphere, light-linked to stones. Small sources are what produce fire and scintillation.
- **Camera.** 85–105 mm full-frame equivalent; f/8–f/16 or no depth of field for catalogue; f/2.8–f/5.6 for hero bokeh; focus on the table facet.

| Shot | Azimuth / elevation |
|---|---|
| Hero three-quarter | 30–45° / 20–30° |
| Top-down | any / 90° |
| Side profile | 90° / 0–5° |
| Front | 0° / 10° |
| On-angle | 45° / 45° |
| Through-finger | along the finger axis / 0° |

| Animation | Spec |
|---|---|
| Turntable | 360° over 120 frames at 30 fps (or 144 at 24), linear, render frames 0 to N−1 for a seamless loop; 36 or 72 stills for web spinners |
| Light sweep | Rotate environment 0→120° over 72–96 frames, geometry static |
| Rack focus | Key focus distance from prongs to band over 48–72 frames at f/2.8 |
| Exploded view | Translate parts along assembly axes with staggered ease-in-out |
| Gem drop-in | Stones descend on +Z with ease-out-bounce, 2–3 frame stagger, no physics |
| Metal swap | Key a material mix factor, or render two sequences and dissolve |

## 4. Driving Blender with an AI agent

| Option | What it is | Fit for Pavé |
|---|---|---|
| Blender Lab MCP server | Official, at [projects.blender.org/lab/blender_mcp](https://projects.blender.org/lab/blender_mcp); needs Blender 5.1+ and an add-on; v1.0.0 on 27 Apr 2026, v1.0.3 on 11 Sep 2026; pitched at analysis and scripting; there is a [Claude connector](https://claude.com/connectors/blender) (search extracts; [comparison](https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026)) | Useful for a designer's own Blender, not a headless worker |
| [MCP for Blender](https://github.com/ahujasid/mcp-for-blender) (formerly `blender-mcp`) | Third-party, MIT. A socket add-on in a live Blender; `execute_blender_code` runs arbitrary Python; opt-in `BLENDER_MCP_SAFE_MODE=1` validator; default anonymous telemetry. [CVE-2026-10688](https://nvd.nist.gov/vuln/detail/CVE-2026-10688) and [CVE-2026-10661](https://nvd.nist.gov/vuln/detail/CVE-2026-10661) are open against it | Do not embed |

**Safety.** bpy Python has full process rights (files, network, subprocess). A script validator is a convenience, not a boundary; the boundary must be the operating system: container or microVM, no network, read-only inputs, one writable output directory, time and memory limits, non-root, one process per job.

**The declarative pattern is right. Refinements:**

1. The agent edits `RenderScene` JSON, never bpy. Compilation is a pure function of scene, GLB hash and compiler version, so results are cacheable and the compiler can be golden-tested without rendering.
2. Offer presets with overrides. A small action space fails less often.
3. Materials are referenced by library ID; an unknown ID is a validation error.
4. The escape hatch is a named, versioned, reviewed op in the repo (`ops: [{id, params}]`), not an inline string. Inline Python only in a local, sandboxed lab mode.
5. The same JSON drives the three.js viewport, so Blender is one backend of a renderer-neutral scene.
6. Split the critique loop. Do not ask a vision model to measure pixels.

| Tier | Checks |
|---|---|
| Numeric, from render passes | Subject bounding box from alpha or Cryptomatte: fill 55–75% of frame, margins at least 5%, centroid offset. Clipped pixels inside the subject mask under about 1%. Background luminance target on white. Firefly count against a local median on the raw pass. Residual noise. Per-stone visible pixel count and occlusion. Mean metal hue against the spec (ΔE). Sharpness inside the centre-stone mask. Loop continuity and flicker for animation. |
| Vision model, on a 768² draft | Composition, whether the piece reads as specified, dark blobs reflected in metal, dead or black stones, distracting hotspots. Output is a JSON patch limited to whitelisted fields (orbit, exposure, light power, environment rotation). |

Cap the loop at three iterations with a fixed seed, accept a patch only if the numeric score improves, and render full resolution once.

**Geometry transport: GLB.** One node per part, named by stable part ID, with `extras` carrying part ID, role, material ID and finish, and one material slot per part. Units are metres, +Y up. Gems are exported unindexed with face normals. Metals are exported with vertex normals computed in the app at a 30–40° crease angle, and the worker must not recompute normals; the round trip in §0 shows both survive import. Pavé stones are separate nodes sharing one mesh. No Draco or meshopt. USD export works in bpy but has no mature JavaScript writer, so keep it for later DCC interchange. STL loses names, units and normals, so it is print-only.

## 5. Real-time web rendering

| Fact (verified via npm and source) | Consequence |
|---|---|
| three is 0.187.0. `MeshPhysicalMaterial` has `dispersion`, `anisotropy`, attenuation, iridescence and clearcoat; `AgXToneMapping` and `NeutralToneMapping` exist. | Metals need nothing custom. |
| r187 removed `CubeUVReflectionMapping` and the `cube_uv_reflection_fragment` chunk ([migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)). drei 10.7.9's [`MeshRefractionMaterial`](https://github.com/pmndrs/drei/blob/master/src/materials/MeshRefractionMaterial.tsx) still includes that chunk, and `WebGLProgram` throws on an unknown include. | Expect it to fail to compile on r187 (checked by source, not in a browser). Own the gem shader. |
| That material is a GLSL `ShaderMaterial` from [N8's diamond demo](https://github.com/N8python/diamonds): BVH ray bounces inside the gem, environment lookup only, a fake Fresnel term, RGB shift by an arbitrary `aberrationStrength`, with instancing support. | WebGL only; it cannot see the metal around the stone and has no absorption. |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) 0.0.28 (2 Nov 2026) requires three ≥ 0.187 and three-mesh-bvh ≥ 0.9.17. The README is now WebGPU-only (`WebGPUPathTracer` from `three-gpu-pathtracer/webgpu`) and labelled "not yet stable"; it has dispersion, volumes and an OIDN denoiser. `WebGLPathTracer` is deprecated since 0.0.25. | Use the WebGPU tracer for progressive previews; do not build on the WebGL one. |
| [N8AO](https://github.com/N8python/n8ao) 2.1.0 is "not yet compatible with WebGPU". three ships TSL `GTAONode`, `SSGINode`, `SSRNode`, `BloomNode`, `DepthOfFieldNode` and `TRAANode`. | The post stack differs per renderer. |
| WebGPURenderer reports are mixed: blogs call it production-ready, while forum posts from 2026 report slower CPU paths on many-mesh scenes and lifecycle problems ([forum](https://discourse.threejs.org/t/the-dawn-of-inadequacy/95624.md), [manual](https://threejs.org/manual/en/webgpurenderer)). | Not the default yet. |

**Recommended stack.** `WebGLRenderer` with:

- `MeshPhysicalMaterial` metals (metalness 1, roughness and anisotropy per finish).
- Our own `GemMaterial`: a fork of the N8 shader with per-channel IOR from the Abbe number, Beer–Lambert absorption by path length, true Fresnel, and a low-resolution cube capture so stones see the setting.
- A PMREM from the `RenderScene` light rig.
- N8AO plus drei `AccumulativeShadows` or `ContactShadows`.
- Bloom with a threshold above 1.0 and a small radius.
- Neutral tone mapping by default and AgX for hero shots, matching the Blender view transform.

Keep the renderer behind an interface and plan a TSL port using [three-mesh-bvh's WebGPU functions](https://github.com/gkjohnson/three-mesh-bvh). Add a "path-traced preview" button that uses `WebGPUPathTracer` when `navigator.gpu` exists and a server Cycles draft otherwise.

**Budget for 200+ pavé stones** (targets to benchmark; no GPU was available here):

- One `InstancedMesh` per cut and size bucket sharing one BVH. Cost then scales with gem pixels, not stone count.
- Melee: at most 150 triangles, 2 bounces, single-ray chroma.
- Hero stone: full facets, 5–6 bounces, three-ray dispersion.
- While orbiting, drop to 2 bounces and DPR 1; restore on idle.
- Stones under about 12 px wide get a plain environment-mapped material.
- Target 60 fps at 1080p and DPR 1.5 on integrated graphics.

## 6. Should we build our own renderer?

| Path | For | Against |
|---|---|---|
| Own WebGPU path tracer | Full control, runs client-side | Years of work to reach Cycles on caustics, denoising and colour; gkjohnson's tracer already exists and is still unstable |
| Blender headless (bpy wheel or CLI) | Works today on CPU (§0), native dispersion, deterministic, free | GPL-3.0 worker code, 0.9 GB install, Python 3.13 only, slow animation on CPU |
| Cloud GPU render | Fast animation | Cost and queueing; still needs a scene compiler |

Staged answer: (1) now, raster viewport with `GemMaterial` plus a bpy 5.3 Cycles worker for stills; (2) next, `WebGPUPathTracer` as an in-browser preview, contributing upstream instead of forking; (3) later, a GPU pool running the same `RenderScene` for animation. Do not write a path tracer. "Our own engine" should mean the scene format, material library and compilers.

## Decisions for Pavé

- `RenderScene` JSON is the product surface. Blender, three.js and the WebGPU path tracer are backends.
- Pin `bpy==5.3.0` on Python 3.13 in the render worker, one sandboxed process per job. Keep the worker package GPL-3.0-compatible and separate from the app (process boundary, files and JSON only).
- Use Principled BSDF with native dispersion for every transmissive gem and Metallic BSDF (F82) for metals. No RGB-split node groups unless 5.2 LTS support is required.
- Ship one material library (the tables in §2) consumed by both renderers. Treat alloy colours as provisional until measured against physical swatches.
- Transmission bounces at least 24 and glossy at least 12 everywhere. Do not use MNEE for gems. Path guiding stays off by default.
- Define light rigs as shapes in the scene, not as HDRIs. Bundle a few CC0 HDRIs as optional looks.
- No arbitrary LLM-written bpy in the product path. Reviewed ops only.
- Critique loop: numeric checks first, vision model second, on drafts of 768² at 64 spp, three iterations at most.
- Geometry travels as uncompressed GLB with part IDs in names and `extras`; normals are authored in the app.
- Stay on `WebGLRenderer` for r187 and write our own gem shader now. Revisit WebGPU each three.js release.
- Budget a GPU pool before promising animations.

## Proposed `RenderScene` shape

```jsonc
{
  "version": 1,
  "geometry": { "uri", "sha256", "units": "mm" },
  "materialLibrary": "pave-materials@1",
  "parts": { "<partId>": { "material", "finish", "visible", "overrides": { "roughness", "attenuationColor" } } },
  "environment": { "preset", "hdri": { "id", "rotationDeg", "strength", "visibleToCamera" },
                   "background": { "type": "color|gradient|transparent", "color" } },
  "ground": { "type": "none|shadowCatcher|whiteSweep|blackAcrylic", "roughness" },
  "lights": [ { "id", "type": "area|point|spot|card", "sizeMm", "positionMm", "lookAtMm", "powerW",
                "temperatureK", "gradient", "linkTo": ["role:stone"] } ],
  "camera": { "type": "persp|ortho", "focalMm", "sensorMm",
              "orbit": { "azimuthDeg", "elevationDeg", "distanceMm|auto", "target" },
              "fill", "dof": { "enabled", "fStop", "focus": "part:<id>|mm" } },
  "animation": { "recipe": "turntable|lightSweep|rackFocus|exploded|gemDrop|metalSwap", "fps", "frames", "loop",
                 "tracks": [ { "target", "keys": [ { "f", "v", "ease" } ] } ] },
  "render": { "quality": "draft|standard|final", "resolution", "samples", "noiseThreshold",
              "bounces": { "total", "transmission", "glossy", "diffuse", "transparent" },
              "clampIndirect", "filterGlossy", "pathGuiding", "denoise": "oidn|optix|none", "device", "seed" },
  "color": { "viewTransform": "AgX|Khronos PBR Neutral|Standard", "look", "exposureEv" },
  "output": { "format": "png|exr|webp|mp4", "bitDepth", "transparent", "passes": ["combined", "cryptoObject", "albedo", "normal"] },
  "ops": [ { "id": "name@version", "params" } ],
  "checks": { "fillRange", "maxClippedPct", "minStonePx", "maxFireflies", "metalDeltaE" }
}
```
