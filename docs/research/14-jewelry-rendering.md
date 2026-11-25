# 14 — Jewelry rendering: the engines, the physics, and real render times

Research date: 2026-11-25. Scope: what the offline and real-time renderers do for jewelry today (KeyShot in detail), the physics that makes a stone and a metal read as real and what each piece costs, browser and real-time options, and render times on an Apple M2 MacBook Air and on mid-range GPUs. Builds on and corrects [`03-rendering.md`](./03-rendering.md); feeds `docs/plans/jewelry-renderer.md` (not written yet) and the sister file 15 (architecture and licences of our own renderer). How renders are made today: a three.js viewport with our own gem shader (`packages/render/src/three/gem.ts`) and a separate GPL Blender Cycles worker (`workers/render`).

**How to read the evidence.** `[V]` I opened the page this session and the claim is on it; the link is next to it. `[V spike]` I measured it here (script in `/home/claude/scratch/14/depth.py`, not in the repo). `[V repo]` read in this repository. `[S]` seen only as a search-result title or summary. `[E]` my estimate or working knowledge, with its basis. Prices were read on 25 Nov 2026; several vendors show Black Friday discounts, so list prices are what is quoted.

**Limits of this session.** The shared web-search budget ran out after about 35 searches. After that I could only open pages whose address I already had. Not opened, so left as `[E]` or `[S]`: the V-Ray material and caustics manual pages, Corona's and Redshift's material pages, Octane's manual, Maxwell and Maverick pricing, anything on RenderMan and appleseed (their rows are from working knowledge), and Blender Open Data's own table for the M2 (the query page returns no rows to a fetch). Every such gap is marked where it matters.

## 1. The short answer

- **No engine has a secret.** Every serious engine renders a diamond the same way: a dielectric with exact Fresnel, deep ray chains, an Abbe number or Cauchy term for dispersion, and Beer–Lambert absorption. The differences that matter for jewelry are (a) how caustics are found, (b) how the stone behaves where it overlaps the metal, (c) presets and lighting, and (d) whether it runs on a Mac GPU.
- **KeyShot's jewelry advantage is workflow, not physics.** A Gem material with an Abbe number and an "ignore intersecting geometry" switch for prongs, a one-click Jewelry lighting preset (high ray bounces, caustics, interior mode), and progressive photon-mapped caustics from the team led by the inventor of photon mapping [V, §3]. It costs USD 1,299 a year, its Apple GPU mode is still beta, and since 12 Nov 2026 it ships an AI agent that sets up scenes from plain language [V]. That last item is a direct competitor to our Render stage.
- **Ray depth is the first thing to get right, and the repo has it slightly wrong.** In Cycles a total internal reflection counts as a *glossy* bounce, not a transmission bounce [V, source]. Our tiers set glossy to 12 or 16 and transmission to 24 or 32 [V repo], so the stone's chain is cut at 12–16. My spike on an ideal round brilliant shows what each depth loses: after 4 internal hits 25 % of the light that entered a diamond is still inside, after 8 hits 10 %, after 16 hits 4 %, after 32 hits 2 % [V spike, §4.2]. The Cycles default of 4 glossy bounces renders a quarter of the stone black. Fix: glossy = transmission = total, 16 for drafts and 32 for finals.
- **The physics that pays, in order:** correct cut geometry with enough depth; the light rig (small hard lights for fire, large soft lights and dark cards for metal); measured metal colour with a non-zero roughness; absorption by path length; glare and tone mapping in post; then dispersion; then ground caustics. Birefringence, polarisation, fluorescence and spectral absorption are not worth building now (§4, §7).
- **Measured optical constants exist for pure metals, not for karat alloys.** refractiveindex.info is CC0 and carries Au, Ag, Cu, Pt, Pd and Rh [V]. I found no measured n, k for 18k or 14k alloys; published mixing models are off by a factor of two for white alloys [V]. Alloy colours must be measured from swatches or fitted to published colour coordinates.
- **An M2 Air can render a ring, slowly.** My estimate for a 2048² ring still with dispersion at 512 samples in Cycles on the 8-core M2 GPU is 5–12 minutes; an RTX 4060 does it in about a minute; a 4096² final with brute-force caustics is over an hour on the Air [E, §6]. Nobody has published a measured jewelry benchmark on an M2 Air that I could find; measuring one on the founder's laptop should be the plan's first task.
- **In the browser,** a gem traced inside a fragment shader (what we have) is the state of the art for interactive work; commercial web jewelry viewers do the same with 4–5 bounces by default [V]. three-gpu-pathtracer is MIT, WebGPU-only, still marked unstable, and accepts only the two standard three.js materials [V], so our gem shader cannot run inside it.

## 2. Engine by engine

### 2.1 Comparison table

"Spectral" means light is carried per wavelength through the whole renderer. "RGB+λ" means an RGB renderer that samples a wavelength only for dispersive refraction.

| Engine | Version seen | Licence and price | Apple Silicon GPU | Colour model | Dispersion input | Caustics method | Denoiser | Used for jewelry |
|---|---|---|---|---|---|---|---|---|
| **KeyShot Studio** | 2026.3, 12 Nov 2026 [V] | Proprietary. Pro USD 1,299/yr, Business 1,599/yr; no perpetual licence listed [V] | Beta since 2026.2; M1+, hardware ray tracing on M3+ only [V] | RGB+λ [E] | Abbe number plus "dispersion samples" on Gem, Dielectric, Multi-layer Optics [V] | Progressive photon mapping, CPU and GPU [V] | Own AI denoiser, CPU and GPU [V] | Named by McNeel, with V-Ray, as the popular output tool for Rhino jewelry work [V] |
| **V-Ray** | 7 (update 3 seen) [S] | Proprietary. Solo USD 540/yr, Premium 778.80/yr [V] | No (V-Ray GPU is CUDA/RTX) [E] | RGB+λ [E] | Abbe number on VRayMtl, default 50 [E] | Photon map and progressive caustics [E] | Own, NVIDIA, OIDN [E] | Matrix 9's built-in renderer; best stones-in-metal result in the 2020 test [V] |
| **Corona** | not verified | Proprietary. Solo USD 414/yr; 3ds Max and Cinema 4D only [V] | CPU only [E] | RGB+λ [E] | Abbe number [E] | Photon-based caustics solver joined to path tracing; vendor quotes about 50 % overhead [V] | OIDN, NVIDIA [E] | Product stills in 3ds Max shops [E] |
| **Cycles** (Blender 5.3) | 5.3, 10–11 Nov 2026 [V] | Blender is GPL; the standalone Cycles repository is Apache-2.0 [V] | Yes, Metal, macOS 13+ [V] | RGB+λ [V] | Dispersion Scale and Abbe Number on Principled BSDF only [V] | Path-traced; MNEE "shadow caustics" for smooth casters; path guiding on CPU only [V] | OIDN (GPU on Apple Silicon [V]), OptiX; DLSS in viewport only [V] | Free option; what we use; also inside Rhino and MatrixGold [V] |
| **LuxCoreRender** | 2.11.2, 6 Sep 2026 [V] | Apache-2.0 [V] | No Metal named; macOS arm CPU builds [V] | RGB+λ [E] | Cauchy B coefficient (diamond: A 2.3818, B 0.0121 µm²) [V] | BiDir, light tracing, PhotonGI caustic cache [S] | OIDN [V release notes mention it] | Hobbyist gem renders [E] |
| **pbrt-v4** | rolling | Apache-2.0 [V] | No; GPU path needs CUDA and OptiX [V] | Spectral, point-sampled [V] | Spectral IOR; extra wavelengths dropped at a dispersive hit [E] | BDPT, MLT, SPPM on CPU [E] | OptiX via `imgtool` [V] | Reference and teaching |
| **Mitsuba 3** | 3.9.1 [V] | BSD-3-Clause plus a contribution-licence clause [V] | No; GPU backend is CUDA/OptiX; macOS arm64 runs on CPU [V] | RGB or spectral variants, optional polarisation [V] | Not in the stock dielectric [E] | Path, light tracer [E] | OptiX [E] | Research, inverse rendering |
| **Arnold** | 7.5.1.2, May 2026 [S] | Proprietary subscription; price not shown on the page [V] | No; GPU is NVIDIA only, Mac is CPU [V] | RGB+λ [E] | Abbe number, "typically 10 to 70" [V] | Path-traced only [E] | OptiX, OIDN, Noice [V] | Maya-based product work [E] |
| **Redshift** | 2026.5, Apr 2026 [V]; 2026.6 seen [S] | Proprietary. USD 49/month or 289/yr [V] | Yes, macOS 14+ [V] (Metal [E]) | RGB+λ [E] | Abbe number [E] | Photon caustics [E] | OptiX, OIDN [E] | Cinema 4D motion work |
| **Octane** | 2026.2, Feb 2026 [V]; 2026.3 seen [S] | Proprietary. Studio+ EUR 19.99/month billed yearly; free single-GPU Prime edition [V] | Yes, Octane X, M1+, macOS 14+ [V] | Spectral [E] | Dispersion coefficient (Cauchy B) [E] | Photon Tracing kernel (GPU photon mapping plus guiding), per-material "Allow caustics" [V] | Own AI denoiser [E] | Hero and advertising shots |
| **Maverick Studio** | not verified | Proprietary; price not verified | No; built on NVIDIA CUDA [V] | [E] spectral | [E] Abbe | [E] | OptiX [V] | Jewelry and product; one-click Rhino bridge [V] |
| **Maxwell 5** | not verified | Proprietary | [E] no | Spectral [E] | Abbe [E] | Unbiased bidirectional [E] | [E] | Older jewelry studios |
| **Indigo 4** | 4 [V] | Proprietary | [E] no | Spectral throughout [V] | Cauchy [E] | BDPT and MLT [V for MLT] | OIDN [E] | Niche |
| **Radeon ProRender** | 3.01 named [V] | SDK; licence not named on the page [V] | Not named; default backend is HIP [V] | RGB [E] | [E] none | Path-traced [E] | [E] | Rare |
| **RenderMan** | not verified | Proprietary; free non-commercial licence [E] | No; XPU's GPU side is NVIDIA [E] | RGB+λ [E] | Abbe on the Lama dielectric [E] | Path-traced; manifold walk option [E] | Own AI denoiser [E] | Film, not jewelry |
| **appleseed** | 2.1 beta, dormant since about 2019 [E] | MIT [E] | CPU only [E] | Spectral [E] | [E] none built in | SPPM, light tracing [E] | [E] none | None; listed for its licence |
| **Unreal path tracer** | UE 5.9 [V] | Proprietary engine licence | No; needs Windows, DX12 and DXR [V] | RGB | Not listed [V, first part of page] | Path-traced [E] | OIDN-based, GPU [V] | Configurators |
| **Rhino Cycles / MatrixGold** | 2020 test [V] | Bundled | Rhino 8 Mac: [E] yes | RGB | A forum user believes none [V] | Path-traced | [E] | Everyday CAD previews. In the 2020 test Rhino 7 Cycles stones looked "glassy"; MatrixGold's looked good once cut out of the metal [V] |

Links for every `[V]` cell are in the Sources section at the end, grouped as KeyShot, Blender and Cycles, Other engines, and Jewelry tools and tests.

### 2.2 Notes that do not fit a table

- **Only four of these run on an Apple GPU:** Cycles (Metal), Octane X and KeyShot (beta) [V], and Redshift (macOS 14+ is listed [V]; that it uses Metal is my inference [E]). V-Ray GPU, Arnold GPU, Maverick, pbrt-v4's GPU path and Mitsuba's GPU path all need NVIDIA [V for Arnold, Maverick, pbrt, Mitsuba; E for V-Ray]. The M2 has no hardware ray tracing; KeyShot says only M3 and later have it [V].
- **Licences that allow in-process use in a proprietary product:** Apache-2.0 (standalone Cycles, LuxCore, pbrt-v4), BSD-3-Clause (Mitsuba 3, with a clause granting the author a licence to enhancements you choose to share) [V]. Blender itself, and so `bpy`, is GPL, which is why our worker is a separate program [V repo]. File 15 owns the consequences; the fact to carry over is that the Cycles kernel on its own is not GPL [V].
- **Fully spectral engines** (pbrt-v4, Mitsuba spectral variants, Indigo [V]; Octane, Maxwell [E]) get dispersion and wavelength-dependent absorption without special cases. The RGB engines add a wavelength sample only at a dispersive refraction: the Blender manual says dispersion works by "randomly sampling from visible wavelengths" and warns that this adds colour noise needing more samples and a higher indirect clamp [V].
- **A new open toy worth knowing:** Caustify, a browser WebGL2 path tracer that picks one wavelength per path from 380–780 nm, refracts with Cauchy's equation and converts with the CIE 1931 curves; four fixed scenes, no mesh import, licence not stated in the article [V, [BlenderNation](https://www.blendernation.com/2026/09/13/caustify-a-free-open-source-spectral-dispersion-path-tracer/)].
- **What jewelry CAD tools ship:** MatrixGold renders with Rhino's Cycles (the 2020 test lists "MatrixGold Cycles", 300 passes); the old Matrix 9 used V-Ray [V]. 3Design and RhinoGold are described as real-time viewports or Rhino's renderer [V, secondary: [Fox Renderfarm list](https://www.foxrenderfarm.com/news/list-of-top-3d-jewelry-rendering-software/)]. McNeel's jewelry page names V-Ray and KeyShot as the popular output tools [V, [rhino3d.com](https://www.rhino3d.com/en/for/jewelry/)].

## 3. KeyShot for jewelry

| Area | What KeyShot does | Evidence |
|---|---|---|
| Gem material | Colour, Transparency Distance (how deep the colour shows, by thickness), Refractive Index (default 1.5; the manual points to a gem index table), Roughness with its own samples, Abbe Number with its own "dispersion samples", and **Ignore intersecting geometry** for prongs that overlap the stone. | [V, [manual](https://manual.keyshot.com/?p=3773), page last changed 2021] |
| Dispersion | Three materials carry it: Gem, Dielectric and Multi-layer Optics. Abbe 0 switches it off; lower is stronger; the manual suggests 35–55 for a subtle effect; a trainer quotes diamond at about 55. Grainy colour is fixed by raising dispersion samples. | [V, manual; [Will Gibbons](https://www.willgibbons.com/articles/keyshot-dispersion)] |
| Jewelry lighting preset | One preset that turns on high ray bounces, higher shadow quality, global illumination, caustics and Interior mode. The numeric bounce value is not on any page I could open. | [V, [KeyShot blog 2016](https://www.keyshot.com/blog/5-steps-to-getting-great-caustics-in-keyshot/); [2026 lighting menu](https://manuals.keyshot.com/kss2026/en-us/manual/main-menu_lighting.html) lists Basic, Product, Interior, Jewelry] |
| Caustics | A single Caustics switch. Under it: progressive photon mapping, on the GPU since KeyShot 9 and improved in 10; the CPU version is adaptive. The post is by Henrik Wann Jensen, Luxion's chief scientist and the inventor of photon mapping. A cognac-glass close-up is quoted at about 10 s on an RTX card. Advice: accurate geometry with sharp gem edges, a bright small source, a non-metal ground to catch the pattern. | [V, [GPU caustics post](https://www.keyshot.com/blog/rdering-caustics-in-keyshot-on-the-gpu); 2016 blog] |
| Materials library | Marketed as large and accurate, with gem and precious-metal presets; no count is published. | [V, [jewelry page](https://www.keyshot.com/3d-jewelry-rendering-software/)] |
| Animation | Turntables by model or camera rotation, output as MP4, MOV, AVI or frames. | [V, llms-full.txt] |
| Configurator, web | KeyShot Studio Web is a USD 39/month add-on; KeyShotXR (web spinner) is mentioned only under education. Configurator details were not on the pages I opened. | [V, llms-full.txt; rest E] |
| Rhino and MatrixGold | Direct `.3dm` import; a Rhino plug-in with live linking exists [E]; MatrixGold is not named anywhere on KeyShot's site that I opened. | [V for import] |
| Network and cloud | Network Rendering is an add-on in nine tiers from 16 to 256 cores; 32 cores cost USD 749/yr. Cloud Rendering (from 2026.2) is prepaid: **1 credit = 1 gigasample**, 100 credits for USD 25. | [V, pricing] |
| GPU | NVIDIA and AMD on Windows; Apple GPU is beta, needs macOS 15, 16 GB recommended, M3+ advised; a 30–50× speed-up over the CPU is quoted for some scenes on M5. | [V, [Apple GPU requirements](https://manuals.keyshot.com/kss2026/en-us/manual/Apple-GPU-Requirements.htm); 2026.2 post] |
| AI | Local generative "AI Shots" (a 19.4 GB download, 16 GB VRAM advised), upscaling, and from 2026.3 a cloud **AI Agent (beta) that sets up scenes from plain language**, paid in credits. A reviewer found AI Shots slow (over five minutes for some prompts) and loose with prompts. | [V, llms-full.txt; [Creative Bloq](https://www.creativebloq.com/3d/keyshot-2026-review-fast-easy-3d-rendering-and-with-ai-tools-you-might-actually-use)] |
| Price today | Pro USD 1,299/yr (108.25/month billed yearly), Business 1,599/yr, Enterprise on quote, education USD 95/yr. Subscription only. | [V, pricing, 25 Nov 2026] |

**What to copy:** the prong-overlap switch; one named preset that sets every jewelry-relevant quality number; a single caustics switch; pricing renders by samples rather than by minutes. **What not to copy:** a general material graph, and a 19 GB local image model.

## 4. The physics, what each part costs, and how the engines do it

### 4.1 Dispersion and fire

- **What it is.** The refractive index falls with wavelength. For diamond the trade figure is 0.044 between the B and G lines and the Abbe number is about 55 [V repo 03; V Gibbons]. Fire is seen when a small bright source is split so that one colour reaches the eye from a facet.
- **Parametrisations.** Abbe number (KeyShot, Cycles, Arnold [V]; V-Ray, Corona, Redshift, Maxwell [E]); Cauchy A and B (LuxCore [V]; Octane, Indigo [E]); a full Sellmeier fit (the GIA model below; any spectral engine fed a table). glTF stores `dispersion = 20 / Abbe`, the same transform as OpenPBR and Adobe's material [V, [Khronos](https://github.com/KhronosGroup/gltf/blob/main/extensions/2.0/Khronos/KHR_materials_dispersion/)]. A two-term Cauchy with LuxCore's diamond values gives B–G = 0.040 and V ≈ 61, about 10 % weaker than the Sellmeier figure [E, computed here from the wiki's numbers].
- **Sampling.** One wavelength per path is the norm (Cycles [V]; Caustify [V]). Hero-wavelength sampling (several wavelengths share one path) only helps until the first dispersive refraction, where pbrt-v4 drops the extra wavelengths [E]. Every path into a gem refracts first, so inside stones all spectral engines are one-wavelength-per-path [E]. Real-time shaders trace three fixed rays for R, G and B [V, Khronos note; V repo `gem.ts`], which shows three coloured copies instead of a continuous spectrum.
- **Reference accuracy.** GIA's 1998 brilliance model computed the index at 1 nm steps from 360 to 830 nm with a Sellmeier formula and tracked polarisation at each bounce [V, [Hemphill et al.](https://www.gia.edu/dam/migrated-assets/docs/doc1/Modeling-the-Appearance-of-the-Round-Brilliant-Cut-Diamond-An-Analysis-of-Brilliance.pdf)]. Sun, Fracchia and Drew found eight spectral samples enough for the smooth part of a spectrum [V, [paper](https://www.cs.sfu.ca/~mark/ftp/Skigraph00/renderDiamonds.pdf)].
- **Cost.** No extra rays, but colour noise in gem pixels: about 2–4× the samples for the same perceived noise [E, from the Blender manual's warning and our 03 tests]. It also forces a high or absent indirect clamp, which lets fireflies through.
- **Payoff.** High for a diamond, moissanite or CZ that fills more than a few hundred pixels and is lit by small sources. Close to nil for melee and for most coloured stones (sapphire V ≈ 72).

### 4.2 Total internal reflection and ray depth

Critical angle and normal-incidence reflectance [E, computed]: diamond 24.4° and 17 %; moissanite 22.0° and 21 %; CZ 27.6° and 13.5 %; sapphire 34.5° and 7.7 %; quartz 40.2° and 4.7 %.

**Spike [V spike].** A convex round brilliant (table 57 %, crown 34.5°, pavilion 40.75°, 64-flat polished girdle, 121 planes), unpolarised Fresnel, 200,000 rays from a cone above the crown. I followed the light inside and recorded how much of what entered was still inside after k facet hits.

| Stone (brilliant cut), light cone | after 4 | after 8 | after 12 | after 16 | after 24 | after 32 | mean path |
|---|---|---|---|---|---|---|---|
| Diamond, ±5° (face-up) | 14 % | 3.4 % | 1.6 % | 0.9 % | 0.5 % | 0.3 % | 3.2 radii |
| Diamond, ±30° | 25 % | 10 % | 6.2 % | 4.3 % | 2.6 % | 1.8 % | 4.5 radii |
| Diamond, full hemisphere | 32 % | 14 % | 8.3 % | 5.9 % | 3.7 % | 2.6 % | 5.2 radii |
| Moissanite (mean index), ±30° | 28 % | 12.5 % | 7.9 % | 5.6 % | 3.6 % | 2.6 % | 5.0 radii |
| Cubic zirconia, ±30° | 21 % | 8.1 % | 4.3 % | 2.8 % | 1.6 % | 1.0 % | 4.0 radii |
| Sapphire, ±30° | 7.2 % | 1.4 % | 0.6 % | 0.4 % | 0.2 % | 0.2 % | 2.6 radii |
| Quartz, ±30° | 3.1 % | 0.3 % | 0.1 % | — | — | — | 2.0 radii |

Shallow and deep pavilions (38° and 43°) change the diamond row by a few points only. The long tail is partly light circling a polished girdle; a bruted girdle would shorten it, so treat the figures beyond 16 as upper bounds.

**What follows.**
- A depth of 2–4 is fine for quartz, beryl and sapphire, which matches Guy and Soler's remark that after two reflections very little is added for their coloured stones [V, [paper](https://core.ac.uk/download/50063425.pdf)]. It is wrong for diamond, CZ and moissanite.
- For high-index stones: 8 hits keeps 90 %, 16 keeps 96 %, 32 keeps 98 %. GIA traced until 99.95 % had left [V], which the spike puts beyond 90 hits.
- A commercial web jewelry viewer defaults to 4–5 bounces and allows 16, quoting 12 for a pear [V, [iJewel3D docs](https://ijewel3d.com/docs/edit/playground/diamond-materials.html)].
- Light still inside at the cut-off should be replaced by an environment lookup, not black. Our shader already does this at half weight [V repo].
- **Cycles counts each internal reflection as a glossy bounce** and only entry and exit as transmission bounces [V, [`path_state.h`](https://github.com/blender/blender/blob/main/intern/cycles/kernel/integrator/path_state.h)]. The Cycles default is 4 glossy [V repo 03], which blacks out about 25 % of a diamond. Cost of going deeper is small: few paths survive that long.

### 4.3 Absorption and coloured stones

Beer–Lambert by path length is universal: Cycles volume absorption [V repo], KeyShot's Transparency Distance [V], Arnold's transmission depth [V], glTF attenuation [V repo]. Two facts from the spike matter: the mean path in a diamond-index brilliant is about 2.2 diameters and in a sapphire-index one about 1.3 diameters [V spike], so the "attenuation distance" must be calibrated against the face-up colour of a stone of a given size, not against its depth. RGB absorption cannot reproduce colour change between illuminants (alexandrite) or stones with two transmission windows whose hue shifts with thickness (ruby, some garnets); that needs spectral absorption curves [E]. Cost: nothing extra per ray.

### 4.4 Birefringence and facet doubling

- **Which stones.** Doubly refractive: moissanite (0.043), zircon (0.059), peridot (0.036), tourmaline (0.020), sapphire and quartz (0.008–0.009, not visible). Singly refractive: diamond, CZ, spinel, garnet [V repo 03 for most; E for zircon].
- **Who renders it.** Research only. Guy and Soler rendered uniaxial stones with pleochroism in real time in 2004 [V]. Weidlich and Wilkie added uniaxial birefringence with polarisation to the ART research renderer and report no significant slowdown from sending two refracted rays [V, [paper](https://cgg.mff.cuni.cz/wp-content/uploads/2021/05/weidlich_2007_rrbuc-paper.pdf)]. A biaxial method exists [S, [Latorre et al.](https://graphics.unizar.es/papers/biref.pdf)]. I found no production engine in §2 that documents it; forum threads only ask for it [S].
- **Cost and payoff.** Two rays per refraction and a direction-dependent index; correct weights need polarisation state. Visible only as doubled back-facet edges in moissanite, zircon and peridot under magnification. Not worth building now.

### 4.5 Caustics

- **On the ground plane.** A path from a small light through a stone to a diffuse floor cannot be found by a camera path unless the light is large. Engines add a light-side method: photon mapping (KeyShot [V], Octane's Photon Tracing kernel [V], V-Ray and Redshift [E]), photons joined to path tracing (Corona, about 50 % overhead by its vendor's account [V]), bidirectional or light tracing (LuxCore [S], Indigo, pbrt-v4 on CPU [E]), manifold walks (Cycles MNEE, smooth casters only, so not faceted stones [V repo 03]), or learned guiding (Cycles OpenPGL, CPU only [V]; it doubled render time for no visible gain in our earlier test [V repo 03]).
- **Inside a setting.** Light going stone → polished metal → stone is a purely specular chain. An ordinary path tracer finds it; it needs depth, not a caustics solver [E]. Only stone light landing on satin or matte metal is a true caustic.
- **Controls worth copying.** Corona has a per-light "generate" and per-object "receive" switch [V]; Octane a per-material "Allow caustics" [V]; KeyShot one global switch [V].
- **Cost and payoff.** A photon or light-tracing pass limited to "from each light, through each gem, onto the ground" is cheap for flat-faceted convex stones and gives the coloured fire spots seen in product photographs on white. Medium payoff, medium cost; behind dispersion in priority because without dispersion the spots are white.

### 4.6 Measured complex index of refraction for metals

| Metal | Data sets on refractiveindex.info | Evidence |
|---|---|---|
| Gold | Johnson and Christy 1972; Babar and Weaver 2015 (0.21–12.4 µm); McPeak 2015; Olmon 2012; Werner 2009; Rakić 1998 models; others. **No alloy entries on the gold page.** | [V, [Au page](https://refractiveindex.info/?shelf=main&book=Au&page=Babar)] |
| Platinum | Werner 2009 (from electron energy-loss spectra); Tselin 2024; Rakić 1998 models | [V, [Pt page](https://refractiveindex.info/?shelf=main&book=Pt&page=Werner)] |
| Rhodium | Weaver 1977 (0.2–12.4 µm; the page notes Palik's handbook supplies the numbers); Arndt 1984; Coulter 1973 films | [V, [Rh page](https://refractiveindex.info/?shelf=main&book=Rh&page=Weaver)] |
| Silver, copper, palladium | Present (Johnson and Christy and later) | [V repo 03 used them; not reopened] |

- **Licence.** The database is CC0 1.0; it asks for a citation to Polyanskiy, *Scientific Data* 11, 94 (2024), and to the original paper per data set; files are YAML [V, [repository](https://github.com/polyanskiy/refractiveindex.info-database)]. Palik's *Handbook of Optical Constants of Solids* is a copyrighted book: take its numbers through the CC0 database, do not transcribe the tables [E]. The "Physically Based" colour list used in 03 is CC0 [V repo 03, not reopened]. An "other/alloys" shelf exists in the database but its listing refused to open; check it for Au–Ag and Cu–Zn entries.
- **Alloys by karat and colour.** Measured n, k for 18k and 14k yellow, rose and white were not found. What exists: (a) colour-versus-composition measurements for Au–Ag–Cu [V abstract, [German et al. 1980](https://link.springer.com/article/10.1007/BF03216549)]; (b) a mixing model with fitted "bowing" corrections for binary alloys, whose uncorrected form predicts a reflectance step between 450 and 550 nm of 0.337 for gold with 10 % platinum where about 0.16 was measured [V, [Shiraishi and Tilley 2014](https://link.springer.com/article/10.1007/s13404-013-0124-7)]; (c) first-principles colour prediction that misses elemental metals by an average ΔE of 6.4, far above the visible threshold of 1–2 [V, [Prandini et al. 2019](https://www.nature.com/articles/s41524-019-0266-0)]. This confirms 03's low confidence in its white-gold row. Dependable alloy colour needs a spectrophotometer reading of real swatches, including rhodium plate over white gold.
- **Use.** Spectral n, k for the pure metals drive a spectral conductor; for RGB, integrate reflectance under D65 to a linear colour, as 03 did. Pure gold's red reflectance lands slightly outside sRGB (1.04–1.06) [V repo 03], so the working space should be wider than sRGB.

### 4.7 Conductor Fresnel and artist parameters

- Gulbrandsen maps two 0–1 colours, reflectivity r and edge tint g, to n and k: n = g(1−r)/(1+r) + (1−g)(1+√r)/(1−√r), then k from r and n; the paper is CC BY-ND 3.0 [V, [JCGT 2014](https://jcgt.org/published/0003/04/03/paper.pdf)].
- Hoffman argues that for RGB rendering the full complex Fresnel equations are less principled and match measured metals worse than Schlick's approximation as commonly used [V abstract, [EG 2019](https://diglib.eg.org/items/677f583f-aedf-4a6c-8516-1e7e10838136/full)]; the remedy that followed is Schlick plus a tint at about 82°, the "F82-tint" model, which is OpenPBR's metal [V section title, [OpenPBR paper](https://arxiv.org/html/2512.23696v2); formula E].
- Blender's Metallic BSDF offers F82 or physical n, k [V repo 03]; we already use F82 there. three.js has no edge tint [V repo `metals.ts`]. For gold, platinum and rhodium the edge tint is nearly white, so the loss is small [V repo 03 table].
- Cost: none. Payoff: colour is the whole identity of a metal; the base colour matters far more than the edge term.

### 4.8 Roughness and brushed finishes

GGX microfacet with a roughness that is never zero (0.03–0.06 for high polish) and anisotropy 0.7–0.8 along the brush direction is what all engines offer and what the repo ships [V repo]. Blender 5.3 added anisotropic roughness to transmission as well [V]. What separates a photograph from a render on brushed and sandblasted metal is discrete glints and visible scratch direction; that needs a scratch normal map or a glint model, not a different BRDF [E]. Cost: a texture lookup; anisotropic highlights converge slower than isotropic ones [E].

### 4.9 Thin films

OpenPBR and Blender implement thin-film interference as a closed-form Airy summation over film thickness and index [V, OpenPBR paper appendix; Blender manual: thickness in nm, strongest at about 100–1000 nm, default film index 1.33]. Uses in jewelry: anodised titanium and niobium, heat-blued steel, tarnish, coated "mystic" stones, and as a stand-in for pearl orient and opal play of colour [E]. The web viewer above exposes a thin-film layer on its diamond material [V]. Cost: negligible. Payoff: narrow; only when the material calls for it.

### 4.10 Studio lighting, light tents and HDRIs

- **What jewelry photographers do, turned into parameters** [E, standard practice; unchanged from 03 §3]: a tent or large top softbox for the metal, dark cards to draw edges, and a few small hard sources placed for the stones. Fire needs small bright sources; brilliance needs contrast in the environment.
- **Engines.** KeyShot's strength is editing an HDRI by pinning lights onto it [E]; Maverick sells "gradient lights" for jewelry [V]; the web viewer exposes environment rotation per stone material, "diamond oriented lighting" [V].
- **HDRI sources.** Poly Haven: CC0, bundling in a sold product is explicitly allowed, no credit needed; its website terms forbid scraping, so download by hand or through its API [V, [licence](https://polyhaven.com/license)]. ambientCG is also CC0 [E]. Avoid non-commercial archives and any HDRI shipped with a commercial renderer.
- **A cheap extra the CAD can own:** a cut-quality view (ASET or ideal-scope style) is only a colour-coded hemisphere environment and a face-up orthographic camera [E]. No renderer in §2 offers it; diamond-grading software does.

### 4.11 Sparkle, glare, bloom and star filters

In a photograph the star on a highlight comes from the lens: aperture-blade diffraction, a cross-screen filter, or scatter in the glass. Renderers add it afterwards on the linear image: Blender's Glare node (used on the ring render cited in §6 [V]), KeyShot's bloom [E]. Rules [E]: keep the beauty pass unclamped, since clamping and firefly removal delete the very pixels that should flare; run glare before tone mapping; make spikes wavelength-scaled for coloured stars; in animation, expect denoisers to make sparkles flicker. Cost: milliseconds. Payoff: high.

### 4.12 Depth of field and focus stacking

Real macro shots of a ring have a millimetre or two in focus at f/16, so photographers stack focus [E]. A renderer has no such limit: a pinhole camera gives the stacked look for free and with less noise. Use no depth of field for catalogue images and a thin-lens f/2.8–f/5.6 for hero images (already in 03). Shallow focus over sparkling stones needs about 2–4× the samples in the blurred area [E].

### 4.13 Tone mapping and colour management

Khronos PBR Neutral was designed for product imagery: colours below a threshold pass through unchanged and highlights fade to white without hue shifts; its authors say ACES and AgX both lose saturation, and that a white light on gold should end as a white, not clipped yellow, highlight [V, [model-viewer](https://modelviewer.dev/examples/tone-mapping)]. Blender 5.3 offers AgX, Filmic, Standard, Khronos PBR Neutral, ACES 1.3 and 2.0 [V repo 03]. For jewelry: Neutral where yellow, rose and white gold must be told apart and match the catalogue; AgX for hero shots. The repo already maps these to three.js [V repo `stage.ts`].

## 5. Real-time and browser rendering

| Option | State on 25 Nov 2026 | Licence | Limits for jewelry | Evidence |
|---|---|---|---|---|
| three.js `WebGLRenderer` | 0.187.0; maintained, no large new features planned | MIT | Custom gem shader works here | [V npm; [manual](https://threejs.org/manual/en/webgpurenderer)] |
| three.js `WebGPURenderer` | The manual calls it experimental; falls back to WebGL 2; `ShaderMaterial`, `onBeforeCompile` and `EffectComposer` are unsupported, so custom shaders must be rewritten in TSL | MIT | Our GLSL gem shader would need a port | [V manual] |
| three-gpu-pathtracer | 0.0.28 (2 Nov 2026); WebGPU compute only; "not yet stable"; tied to three-mesh-bvh internals (which reached 0.10.0 on 24 Nov) | MIT | Only `MeshStandardMaterial` and `MeshPhysicalMaterial`; README lists area, spot, point lights, depth of field, denoising and upscaling, and does not mention dispersion or caustics | [V npm; [README](https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/main/README.md)] |
| Babylon.js | 9.37.2 | Apache-2.0 | Implements glTF dispersion as three per-channel refractions | [V npm; Khronos page] |
| model-viewer | 4.4.0, built on three.js | Apache-2.0 | Neutral tone mapping; no gem shader | [V npm; model-viewer page] |
| Filament | npm build 1.53.4, last published Aug 2024 | Apache-2.0 | Refraction with absorption; dispersion not confirmed | [V npm; rest E] |
| Unity HDRP recursive rendering | Ray-traced multi-bounce reflection and refraction with a depth setting; cost grows steeply with depth | Proprietary | Needs ray-tracing hardware; not a browser path | [V, [Unity manual](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Ray-Tracing-Recursive-Rendering.html)] |
| Unreal path tracer | Windows, DX12, DXR | Proprietary | Not on a Mac; dispersion not listed | [V] |

**Published real-time gem methods.**
- *Facet tree, 2004.* Guy and Soler: build a tree of facets seen through facets, shade deepest first, with absorption, polarisation, uniaxial birefringence and approximate dispersion; 12–30 fps at depth 2–3 on a 2003 graphics card [V].
- *Ray tracing inside the fragment shader against the stone's own BVH,* looking up an environment map on exit. This is the N8 "diamonds" demo behind drei's material and what our `GemMaterial` extends with exact Fresnel, Abbe-based channel indices, absorption and sparkle lights [V repo].
- *Commercial variants.* A web jewelry viewer exposes ray bounces (4–5 default, up to 16), dispersion, absorption, index (default 2.6), per-channel boost and gamma, an inclusion map and environment rotation per stone [V]. A studio describes a per-pixel loop over facets with Fresnel split, three separate paths for R, G and B and path-length attenuation [V, [Digital Tails](https://digital-tails.group/case-studies/diamond-shader-rendering-technology-case-study-2), promotional, no numbers].
- *Cube-map tricks* (render back faces with a refracted cube lookup, then add front-face reflection) are the old game-engine gem shader; they have no internal reflection chain [E].
- Khronos's own note on dispersion says gems have many internal reflections, so dispersion alone does not capture them in real time [V].

**What quality is reachable interactively [E].** One stone traced in a shader at 6–8 internal hits with three-channel dispersion holds 60 fps on integrated graphics, and by the spike keeps 85–90 % of a diamond's light. A convex faceted stone is at most a few hundred planes, so it can be intersected analytically without a BVH. What the shader approach cannot see: other stones, the metal around it (unless a local cube capture is added), ground caustics, and a continuous spectrum. A progressive WebGPU path tracer fills those gaps in seconds to tens of seconds per view on an M2-class GPU, with no hardware ray tracing to lean on. The gap between "interactive" and "final" is therefore lighting interaction and noise, not the stone's own optics.

## 6. Render times

### 6.1 Measured by others or by us

| What | Result | Evidence |
|---|---|---|
| Ring, six renderers, one laptop (RTX 2060, i7-10750H), presets only, Dec 2020, resolution not stated | V-Ray 5 RTX 49 s; Thea 60 s; MatrixGold Cycles 1 m 12 s (300 passes); KeyShot 9 1 m 20 s; Rhino 7 Cycles 1 m 47 s; Maverick 2 m 50 s to 3 m | [V, comparison test] |
| Gold ring with diamonds and a ruby, Cycles 3.6, 2168×1680, 6,180 samples, depth of field and glare | 7 m 32 s on an unnamed "5 years old" PC | [V, [Blender Artists](https://blenderartists.org/t/calibrating-diamonds-for-a-gold-ring-cycles-3-6-angel-rays/1495464)] |
| Our test ring, Cycles 5.3, 4 cloud vCPUs, no GPU, dispersion, 24 bounces | 512² at 128 samples: 21–26 s; 1024² at 256 samples: 178 s (about 1.5 million pixel-samples per second); path guiding doubles it | [V repo 03 §0] |
| Blender Classroom scene, Metal, Blender 3.3 | M2 10-core GPU 221 s; M3 10-core 128 s; M4 10-core 103 s; M4 8-core 110 s | [V, [Notebookcheck M4](https://www.notebookcheck.net/Apple-M4-10-core-GPU-Benchmarks-and-Specs.835807.0.html), [M4 8-core](https://www.notebookcheck.net/Apple-M4-8-core-GPU-Benchmarks-and-Specs.910076.0.html)] |
| "Blender scores" as listed by a render farm (Blender version and GPU backend not stated on the page; updated 23 Nov 2026) | RTX 3060 2,287; RTX 4060 3,109; RTX 4070 5,365; RTX 5070 6,079; RTX 4090 11,609; Apple M4 10-core 1,394 | [V, [Drop and Render](https://dropandrender.com/blender-benchmarks)] |
| Apple GPUs against an RTX 4090, Blender 4.5 Open Data medians | M2 Max 38-core about 16 %; M4 Max 40-core about 48 % | [V, [guide read 18 Nov 2026](https://geturna.com/en/guides/blender-on-mac)] |
| KeyShot on Apple GPU | 30–50× over the Apple CPU on some scenes, on M5 | [V] |

No page I could open gives a Blender score for the 8-core M2 itself, and none gives a jewelry scene timed on an M2 Air.

### 6.2 Estimates for a ring scene [E]

**Basis.** (1) M2 Max at 16 % of 11,609 is about 1,860 for 38 GPU cores; scaled per core, an 8-core M2 scores about 390; the Classroom ratio against the M4 gives about 520; I use 400–500. That makes an RTX 3060 about 5×, an RTX 4060 about 7× and an RTX 4070 about 12× an M2 Air. (2) If these are Blender Open Data scores (samples per minute summed over three 1920×1080 scenes), a score of 450 is roughly 5 million pixel-samples per second on the benchmark scenes. (3) Our ring test ran at 1.5 million per second on a 4-vCPU box, which I assume would score about 50, so the simple ring is about 2.5× cheaper per sample than the benchmark scenes; real pieces fill the frame and carry many stones, which takes most of that back. I take 4–10 million pixel-samples per second for the M2 GPU when cool and **3–8 million sustained**, allowing 20–30 % for a fanless laptop under a long load. (4) Dispersion is counted through the sample counts, not the speed. Every figure below could be off by a factor of two.

| Scene (Cycles, 32 bounces, denoised) | Pixel-samples | M2 Air 8-core GPU | RTX 3060 | RTX 4060 | RTX 4070 |
|---|---|---|---|---|---|
| 2048² draft, 128 samples, no dispersion | 0.54 G | 1–3 min | 15–35 s | 10–25 s | 6–15 s |
| 2048² standard, 512 samples, dispersion on, caustics by plain path tracing | 2.1 G | 5–12 min | 1–2.5 min | 40 s–1.7 min | 25–60 s |
| 2048² final, 2,048 samples, converged fire and brute-force ground caustics | 8.6 G | 18–48 min | 4–10 min | 2.5–7 min | 1.5–4 min |
| 4096² standard, 512 samples, dispersion | 8.6 G | 18–48 min | 4–10 min | 2.5–7 min | 1.5–4 min |
| 4096² final, 2,048 samples | 34 G | 1.2–3.2 h | 15–40 min | 10–27 min | 6–16 min |
| Turntable, 120 frames, 1080², 192 samples | 27 G | 1–2.5 h | 12–30 min | 8–21 min | 5–13 min |

A 3840×2160 frame has half the pixels of 4096², so halve those rows. The M2's own CPU is about 3–4× slower than its GPU in Cycles [E, from typical scores of about 110–120 against 400–500], and path guiding runs on the CPU only [V], so on the Air the CPU is a real option for caustic-heavy stills.

**For the other engines:** no M2 figures exist that I could open. The 2020 test puts V-Ray RTX, Thea, Cycles and KeyShot within about 2× of each other on the same NVIDIA laptop [V]. KeyShot's Apple GPU mode is beta and tuned for M3 and later [V]. Octane X and Redshift run on the M2 [V] but I found no jewelry timing.

**Reading.** A user on an M2 Air gets a usable 2K still in minutes from Cycles, not seconds, and a 4K final with fire and ground caustics is out of reach by brute force. That is the opening for a purpose-built path: analytic stones, a light-side pass for gem-to-ground caustics, and stratified wavelengths, instead of more samples.

## 7. What this means for the plan

**Minimum physics for jewelry to read as real, ranked by visual payoff per cost.**

| Rank | Item | Cost | Why |
|---|---|---|---|
| 1 | True facet geometry, exact dielectric Fresnel, internal chain to 8 hits interactive, 16 draft, 32 final; leftover light replaced by an environment lookup | Depth only | Without it a diamond looks like glass (§4.2) |
| 2 | Light rig: small hard sources for stones, large soft sources and dark cards for metal, as scene data shared by every backend | None at render time | Fire and brilliance are lighting effects |
| 3 | Metal base colour from measured data, F82 tint, roughness never zero, reflections between metal parts to depth 8 or more | None | Colour is how gold, rose and platinum are told apart |
| 4 | Beer–Lambert absorption calibrated on face-up colour | None | Coloured stones (§4.3) |
| 5 | Glare and bloom on an unclamped linear image, then Neutral or AgX | Milliseconds | Sparkle in the final picture |
| 6 | Soft contact shadow and ground reflection | Small | Grounds the piece |
| 7 | Dispersion from the Abbe number, one wavelength per sample, stratified; only for stones above a pixel-size threshold | 2–4× samples in gem pixels | Fire on diamond, moissanite, CZ |
| 8 | Depth of field for hero shots | 2–4× samples in blur | Photographic look |
| 9 | Gem-to-ground caustics by a light-side pass, opt-in per light and per ground | A second pass | Fire spots on white backgrounds |
| 10 | Anisotropic brushing, scratch and grain maps, thin film where the material needs it | Small | Finishes |
| — | Spectral absorption, birefringence, polarisation, fluorescence, inclusions | High | Reject for now; revisit for moissanite doubling and alexandrite |

**Engine features to copy.** KeyShot's prong-overlap switch on the gem material and its single Jewelry preset; its caustics on/off simplicity; pricing by samples (1 credit = 1 gigasample) as a model for paid renders. Corona's and Octane's per-light and per-material caustic opt-in. V-Ray's behaviour with stones sunk into metal, the best in the 2020 test, as the target for overlap handling. The web viewer's per-stone environment rotation. From outside rendering: a cut-quality (ASET-style) view as a CAD feature.

**Data sets to ship, with licences.**

| Data | Licence | Note |
|---|---|---|
| refractiveindex.info YAML for Au, Ag, Cu, Pt, Pd, Rh, Ti and the gem Sellmeier fits | CC0 1.0; cite Polyanskiy 2024 and each original paper | Ship the subset and a credits file |
| Alloy colours by karat and colour, and rhodium over white gold | Our own measurements | Needs a spectrophotometer session on real swatches; until then 03's estimates stay marked provisional |
| Studio HDRIs from Poly Haven | CC0; bundling allowed | 1k in the app; fetch by hand or API, do not scrape |
| CIE colour-matching functions and D65 | Published standard data [E] | Needed for any wavelength sampling |
| Do not ship | — | Palik's tables copied from the book; non-commercial HDRI archives; any vendor's material library |

**Decisions to take.**
1. Fix bounce settings now in the Cycles worker: glossy = transmission = total (16 preview, 32 standard and final). This is a one-line change with a visible effect on stones.
2. Make "measure a ring scene on the founder's M2 Air" step one of the renderer plan: three tiers from §6.2, Metal GPU and CPU, cold and after ten minutes. Every later choice depends on that number.
3. Treat the gem as an analytic convex solid in any renderer we write; pass file 15 the depth table and the mean path lengths.
4. Default tone mapping: Neutral for catalogue, AgX for hero (already the repo's mapping).
5. Dispersion and ground caustics are per-shot switches, off in drafts.

**Open questions for the founder.**
- What wait is acceptable for a 2K still on the laptop: one minute or ten? It decides whether dispersion is on by default.
- Can real alloy swatches, including rhodium-plated white gold, be measured with a spectrophotometer, and by whom?
- Is moissanite's facet doubling something customers would notice? If yes, birefringence moves up the list.
- Should paid renders be metered by time, by image, or by samples as KeyShot's cloud does?
- KeyShot now has an AI agent for scene setup. Is matching KeyShot's still quality the bar, or is "good enough without leaving the CAD" the bar?

## 8. Corrections and confirmations to `03-rendering.md`

| 03 says | Finding |
|---|---|
| "Transmission bounces at least 24 and glossy at least 12", with the larger number on transmission | **Corrected.** Internal reflections are glossy bounces in Cycles [V]; the glossy cap is the stone's depth. |
| Native dispersion since Blender 5.3, Principled only | Confirmed [V release notes and manual]. Socket labels are "Dispersion Scale" and "Dispersion Abbe Number". |
| Path guiding is CPU-only (marked unchecked) | Confirmed [V manual]. |
| DLSS Ray Reconstruction is viewport-only | Confirmed [V]. |
| Poly Haven is CC0 (marked unchecked) | Confirmed, including bundling in a sold product [V]. |
| refractiveindex.info is CC0 | Confirmed [V]. |
| three-gpu-pathtracer "has dispersion, volumes and an OIDN denoiser" | **Not confirmed.** Today's README lists denoising and upscaling, lights and depth of field, and accepts only the two standard materials; dispersion is not mentioned [V]. |
| "No target renderer models double refraction" | Still true for production engines as far as I could find; two research renderers do [V]. |
| Gold alloy rows are estimates; white gold low confidence | Confirmed, and no measured alloy n, k was found [V]. |
| Nothing on KeyShot, Metal timings or caustic methods | Added here (§3, §6, §4.5). |

## Repo notes for the lead

- `packages/render/src/quality.ts` (both copies): `FLOOR` has glossy 12 and `DEEP` glossy 16 against transmission 24 and 32. By §4.2 the glossy number is what limits a stone. Suggest glossy = transmission = total.
- `packages/render/src/three/gem.ts` (assistant build): `hero` is 6 bounces and `melee` 2. By the spike, 6 hits leaves roughly 15 % of a diamond's light to the half-weight environment fallback, and 2 leaves over half. Fine for motion; a still from the browser engine should use 8–16.
- `packages/render/src/materials/gems.ts`: attenuation distances are per material, not per stone size; with mean paths of 1.3–2.2 diameters a 1 mm melee and a 9 mm centre of the same material will differ more than intended, or less, depending on how the distance was chosen. Worth a calibration note.
- `docs/research/03-rendering.md` §5 cites three-gpu-pathtracer features that today's README does not list (see §8).
- `docs/PLAN.md` row B1 points to "our own renderer"; `docs/plans/jewelry-renderer.md` does not exist yet, as expected.
- three-mesh-bvh moved to 0.10.0 on 24 Nov 2026 and the path tracer's README warns its internals change between releases; pin the version wherever both are used.

## Sources

**KeyShot** [V]: [llms-full.txt](https://www.keyshot.com/llms-full.txt) · [pricing](https://www.keyshot.com/pricing/) · [Gem material manual](https://manual.keyshot.com/?p=3773) · [lighting settings, older manual](https://manual.keyshot.com/?p=5471) · [2026 lighting menu](https://manuals.keyshot.com/kss2026/en-us/manual/main-menu_lighting.html) · [Apple GPU requirements](https://manuals.keyshot.com/kss2026/en-us/manual/Apple-GPU-Requirements.htm) · [2026.2 release post](https://www.keyshot.com/blog/keyshot-studio-introduces-apple-gpu-support-cloud-rendering-and-more/) · [caustics on the GPU](https://www.keyshot.com/blog/rdering-caustics-in-keyshot-on-the-gpu) · [five steps to caustics](https://www.keyshot.com/blog/5-steps-to-getting-great-caustics-in-keyshot/) · [jewelry page](https://www.keyshot.com/3d-jewelry-rendering-software/) · [Will Gibbons on dispersion](https://www.willgibbons.com/articles/keyshot-dispersion) · [Creative Bloq review](https://www.creativebloq.com/3d/keyshot-2026-review-fast-easy-3d-rendering-and-with-ai-tools-you-might-actually-use). Could not open: [2025 lighting manual](https://manuals.keyshot.com/kss2025/manual/lighting.html) (login wall).

**Blender and Cycles** [V]: [5.3 Cycles release notes](https://developer.blender.org/docs/release_notes/5.3/cycles/) · [Principled BSDF](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html) · [GPU rendering](https://docs.blender.org/manual/en/latest/render/cycles/gpu_rendering.html) · [sampling](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/sampling.html) · [light paths](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/light_paths.html) · [`path_state.h`](https://github.com/blender/blender/blob/main/intern/cycles/kernel/integrator/path_state.h) · [standalone Cycles](https://github.com/blender/cycles) · [CG Channel on 5.3](https://www.cgchannel.com/?p=180007) · [80.lv on dispersion](https://80.lv/articles/understanding-native-dispersion-in-blender-5-3).

**Other engines** [V unless marked]: [V-Ray buy page](https://www.chaos.com/vray/buy-online) · [Corona buy page](https://www.chaos.com/corona/buy-online) · [Chaos on caustics](https://blog.chaos.com/what-are-caustics-and-how-to-render-them-the-right-way) · [LuxCore repository](https://github.com/LuxCoreRender/LuxCore) · [LuxCore releases](https://www.github.com/LuxCoreRender/LuxCore/releases) · [LuxCore dispersion wiki](https://wiki.luxcorerender.org/Glass_Material_IOR_and_Dispersion) · [pbrt-v4](https://github.com/mmp/pbrt-v4) · [Mitsuba 3](https://github.com/mitsuba-renderer/mitsuba3) · [Mitsuba licence](https://github.com/mitsuba-renderer/mitsuba3/blob/master/LICENSE) · [Arnold features](https://www.autodesk.com/products/arnold/features) · [Arnold shader parameters via Foundry](https://learn.foundry.com/mari/Content/reference_guide/shader_parameters/aistandard_surface.html) · [Redshift 2026.5](https://www.cgchannel.com/2026/04/maxon-releases-redshift-2026-5/) · [Octane purchase](https://otoy.com/render/octane-render/purchase) · [Octane 2026.2](https://www.cgchannel.com/?p=173999) · [Octane 2026 launch](https://home.otoy.com/octane2026/) · [Octane photon kernel guide](https://irendering.net/octane-spectron-vs-mesh-emitters-caustic-cache-guide/) · [Maverick](https://maverickrender.com/) · [Indigo](https://indigorenderer.com/unbiased-rendering) · [ProRender SDK](https://github.com/GPUOpen-LibrariesAndSDKs/RadeonProRenderSDK) · [Unreal path tracer](https://dev.epicgames.com/documentation/en-us/unreal-engine/path-tracer-in-unreal-engine) · [Caustify](https://www.blendernation.com/2026/09/13/caustify-a-free-open-source-spectral-dispersion-path-tracer/). [S] only: V-Ray 7 for Rhino announcement titles, Arnold 7.5.1.2 release-note title, Redshift 2026.6 and Octane 2026.3 titles, LuxCore forum titles on PhotonGI and hybrid back/forward tracing.

**Jewelry tools and tests** [V]: [render comparison test, 2020–21](https://www.cadjewelleryskills.com/jewellery-tech-blog-topics/jewellery-learning-resources/rhino-cad-rendering-comparison-test-part-1/) · [McNeel forum on MatrixGold rendering](https://discourse.mcneel.com/t/matrixgold/187799) · [Rhino for jewelry](https://www.rhino3d.com/en/for/jewelry/) · [Fox Renderfarm list](https://www.foxrenderfarm.com/news/list-of-top-3d-jewelry-rendering-software/) · [iJewel3D diamond material](https://ijewel3d.com/docs/edit/playground/diamond-materials.html) · [Digital Tails case study](https://digital-tails.group/case-studies/diamond-shader-rendering-technology-case-study-2) · [Blender Artists ring](https://blenderartists.org/t/calibrating-diamonds-for-a-gold-ring-cycles-3-6-angel-rays/1495464).

**Physics and data** [V unless marked]: [Hemphill et al., GIA 1998](https://www.gia.edu/dam/migrated-assets/docs/doc1/Modeling-the-Appearance-of-the-Round-Brilliant-Cut-Diamond-An-Analysis-of-Brilliance.pdf) · [Sun, Fracchia, Drew, Rendering Diamonds](https://www.cs.sfu.ca/~mark/ftp/Skigraph00/renderDiamonds.pdf) · [Guy and Soler 2004](https://core.ac.uk/download/50063425.pdf) · [Weidlich and Wilkie, birefringence](https://cgg.mff.cuni.cz/wp-content/uploads/2021/05/weidlich_2007_rrbuc-paper.pdf) · [Latorre et al., biaxial](https://graphics.unizar.es/papers/biref.pdf) [S] · [refractiveindex.info database](https://github.com/polyanskiy/refractiveindex.info-database) · [Au](https://refractiveindex.info/?shelf=main&book=Au&page=Babar) · [Pt](https://refractiveindex.info/?shelf=main&book=Pt&page=Werner) · [Rh](https://refractiveindex.info/?shelf=main&book=Rh&page=Weaver) · [German et al. 1980](https://link.springer.com/article/10.1007/BF03216549) · [Shiraishi and Tilley 2014](https://link.springer.com/article/10.1007/s13404-013-0124-7) · [Prandini et al. 2019](https://www.nature.com/articles/s41524-019-0266-0) · [Gulbrandsen 2014](https://jcgt.org/published/0003/04/03/paper.pdf) · [Hoffman 2019](https://diglib.eg.org/items/677f583f-aedf-4a6c-8516-1e7e10838136/full) · [OpenPBR paper](https://arxiv.org/html/2512.23696v2) · [glTF dispersion extension](https://github.com/KhronosGroup/gltf/blob/main/extensions/2.0/Khronos/KHR_materials_dispersion/) · [Poly Haven licence](https://polyhaven.com/license) · [Khronos PBR Neutral, via model-viewer](https://modelviewer.dev/examples/tone-mapping). Could not open: "Fifty shades of yellow" (ResearchGate), the database's alloys folder (GitHub tree refused).

**Real-time** [V]: [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer) · [three.js releases](https://github.com/mrdoob/three.js/releases) · [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) and its [README](https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/main/README.md) · [Unity HDRP recursive rendering](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Ray-Tracing-Recursive-Rendering.html) · npm registry for three, three-gpu-pathtracer, three-mesh-bvh, @babylonjs/core, @google/model-viewer, filament (versions, licences, dates).

**Benchmarks** [V]: [Drop and Render score list](https://dropandrender.com/blender-benchmarks) · [Notebookcheck M4 10-core](https://www.notebookcheck.net/Apple-M4-10-core-GPU-Benchmarks-and-Specs.835807.0.html) · [Notebookcheck M4 8-core](https://www.notebookcheck.net/Apple-M4-8-core-GPU-Benchmarks-and-Specs.910076.0.html) · [Blender on Mac guide](https://geturna.com/en/guides/blender-on-mac). Could not read rows from [Blender Open Data](https://opendata.blender.org/benchmarks/query/) or the Notebookcheck M2 8-core page.

**Local** [V spike]: `/home/claude/scratch/14/depth.py` (round-brilliant energy-versus-depth simulation; numpy; not in the repository).
