# Measured tests: which Cycles render settings make a jewelry render repeatable, and which make it look right

25 November 2026. Everything marked **[M]** was measured here by the named script; **[E]** is an estimate or a reading of the numbers, not a measurement. All scripts, logs and images are in `/home/claude/scratch/23-lab/` (outside the repository). **CPU only. No GPU, no Apple Metal, no OptiX, no macOS, no second machine was tested.** One scene, one stone, one studio.

## 1. What was run, on what, and how it was measured

### Takeaway
Blender 5.3.0 (the `bpy` Python module, Cycles on 2 CPU threads) rendered the research-15 ring 349 times in 12 scripted experiments, 52 minutes of two-core machine time; every experiment listed in the brief ran, plus two the coordinator added (tangents, OpenEXR headers). The baseline for every test is the written workflow's settings ("WF" below), changed one thing at a time.

### Cited Findings
- **[M] Software.** Python 3.13.18; `bpy` 5.3.0, build hash `02f0899d78e3`, built 2026-11-10 from branch `blender-v5.3-release`; OpenColorIO 2.5.0, OpenImageIO 3.1.16. Found in the spike's virtual environment `/home/claude/scratch/15/venv-bpy/bin/python` (the default `python3` has no `bpy`); nothing had to be installed. — [inspect_bpy.py](/home/claude/scratch/23-lab/inspect_bpy.py), [log_inspect_bpy.txt](/home/claude/scratch/23-lab/log_inspect_bpy.txt)
- **[M] Machine.** `lscpu`: Intel(R) Xeon(R) Processor @ 2.30GHz (family 6, model 173), 2 CPUs, 1 thread per core, KVM guest, 8 GB memory, no GPU. Cycles ran with `scene.render.threads_mode='FIXED'`, `threads=2` unless a row says 1. Other agents used the machine during the run (load average up to 6), so **wall-clock times are inflated in places; CPU-seconds are the reliable figure**. Four 1024-sample renders took 183–253 s of wall-clock for that reason (101–127 s of two-core CPU time each). — [results.jsonl](/home/claude/scratch/23-lab/results.jsonl)
- **[M] Scene.** The research-15 spike export read unchanged from `/home/claude/scratch/15/scene/` (6.5 mm round brilliant, 57 facets, four-prong ring with 20,224 triangles, diffuse ground of albedo 0.8, four emissive soft boxes, three small "sparkle" panels, dim uniform world). Materials are the workflow's: gold = Principled, metallic 1, base (1.0, 0.76, 0.38), roughness 0.08; diamond = Principled, transmission 1, roughness 0, IOR 2.417, dispersion as below. — [lab.py](/home/claude/scratch/23-lab/lab.py)
- **[M] Baseline "WF"** (the workflow's section 5 line): max bounces 32, transmission 32, glossy 16, diffuse 3, transparent 8, caustics off, `blur_glossy` 0.2, `sample_clamp_indirect` 20, `sample_clamp_direct` 0, view AgX with look "AgX - Base Contrast". Lab choices on top: seed 0, **adaptive sampling off and fixed samples unless the row says otherwise**, denoiser off unless the row says on, pixel filter left at the default (Blackman-Harris 1.5), view exposure −1.152 stops (a gain of 0.45, the spike's gain; display only, the linear data are unaffected). — [lab.py](/home/claude/scratch/23-lab/lab.py)
- **[M] The Principled BSDF in bpy 5.3.0 has no socket called "Dispersion".** It has `Transmission Dispersion Scale` (default 0, range 0–1) and `Transmission Dispersion Abbe Number` (default 20). The workflow's "Dispersion 0.36" was therefore read as Scale 0.36 with the Abbe number left at its default 20. A script that sets `inputs["Dispersion"]` fails in this version. — [log_inspect_bpy.txt](/home/claude/scratch/23-lab/log_inspect_bpy.txt)
- **[M] Factory defaults in bpy 5.3.0**, for comparison with WF: samples 4096, adaptive sampling on at threshold 0.01, time limit 0, max bounces 12, glossy 4, transmission 12, diffuse 4, clamp indirect 10, clamp direct 0, `blur_glossy` 1.0, both caustics on, denoising on (denoiser reads back as Open Image Denoise, passes `RGB_ALBEDO_NORMAL`, prefilter `ACCURATE`, quality `HIGH`), view AgX with look None, dither 1.0, `use_animated_seed` off. — [log_inspect_bpy.txt](/home/claude/scratch/23-lab/log_inspect_bpy.txt)
- **[M] Views.** "Stone" = the spike's macro camera at 384 px, border-cropped to the stone (288 × 242 px; 33,428 pure stone pixels, 13,315 metal, 21,008 ground, from a mask render). "Ring" = the spike's hero camera, 256 × 256 full frame. Timing (experiment 11) = macro camera, 512 × 512 full frame. — [lab.py](/home/claude/scratch/23-lab/lab.py), [metrics.py](/home/claude/scratch/23-lab/metrics.py)
- **[M] Measures.** "Pixels equal" = SHA-256 of the 32-bit float buffer read back from the saved OpenEXR, and of the decoded 8-bit PNG. Differences in 8-bit display units (0–255) on Blender's own PNG; RMS relative to mean in linear light; SSIM and CIEDE2000 (scikit-image) as perceptual distances; luminance = Rec.709 Y of the linear image. Noise = RMS difference between seed 0 and seed 1 of the same settings, divided by √2. — [metrics.py](/home/claude/scratch/23-lab/metrics.py)
- **Scripts (re-runnable; each skips renders whose output exists, delete `out/` to redo):** `lab.py` (the only file that imports `bpy`; runs as its own process), `run.sh` (one fresh process per call), `metrics.py`, `inspect_bpy.py`, `exp01_repeat.py`, `exp02_adaptive.py`, `exp03_filebytes.py`, `exp03b_exr_header.py`, `exp03c_stamp_matrix.py`, `exp04_seed.py`, `exp05_depth.py`, `exp06_clamp.py`, `exp07_dispersion.py`, `exp08_denoise.py`, `exp09_flicker.py`, `exp10_colour.py`, `exp11_timing.py`, `exp12_tangent.py`, `chain1.sh`. Logs: `log_exp*.txt`. Side-by-side images: `exp05_depth_side.png`, `exp05_depth_diff.png`, `exp06_clamp_side.png`, `exp07_dispersion_side.png`, `exp08_denoise_64.png`, `exp08_denoise_256.png`, `exp08_denoise_1024.png`, `exp08_denoise_zoom.png`, `exp09_flicker_frames.png`, `exp09_flicker_diff.png`, `exp10_colour_em1.png`, `exp10_colour_e0.png`. — [/home/claude/scratch/23-lab/](/home/claude/scratch/23-lab/)

**Table of experiments** (all [M]; details and more numbers in sections 2–4)

| # | Script | Exact settings | Compared | Measured result | Conclusion |
|---|---|---|---|---|---|
| 1 | `exp01_repeat.py` | WF, stone, 64 spp, seed 0, adaptive off, no time limit; denoiser off, then Open Image Denoise (OIDN) on | Same process twice; three fresh processes; 2 threads vs 1 | Float pixels and 8-bit PNG pixels **bit-identical in all 8 comparisons** (max diff 0). File hashes of EXR and PNG differ every time. 7.0 s (2 threads), 13.7 s (1 thread) | Fixed seed + fixed samples is bit-repeatable on this machine, with or without OIDN, at any thread count |
| 2a | `exp02_adaptive.py` | As 1 but adaptive on, threshold 0.01, max 512 spp | Two fresh runs; 2 vs 1 thread; with OIDN | **Bit-identical** in all three. Against fixed 512 spp: max 9/255, mean 0.07/255; CPU 103.7 s vs 106.5 s | Adaptive sampling does not break repeatability; here it saved 3 % |
| 2b | `exp02_adaptive.py` | `time_limit` 10 s, max 4096 spp; also adaptive + time limit | Five fresh runs; two runs | **Three different images in five runs.** Differing pair: max 154/255, mean 1.02/255, 14.9 % of pixels off by more than 2, SSIM 0.994. Adaptive + limit: mean 4.2/255, max 177, 55 % of pixels off by more than 2, SSIM 0.955 | A time limit makes the picture depend on machine load. Never use it for a render that must repeat |
| 3 | `exp03_filebytes.py`, `exp03c_stamp_matrix.py` | 16 and 8 spp, each variant in two fresh processes | SHA-256 of PNG, JPEG, EXR files | Default: **no file repeats** (Date, RenderTime and three `cycles.ViewLayer.*` time strings differ); pixels identical. With the seven default-on flags off (`use_stamp_date`, `_time`, `_render_time`, `_frame`, `_camera`, `_scene`, `_filename`): PNG and JPEG from `render(write_still=True)` carry no text and **repeat byte for byte**. `Image.save_render()` files still differ | File bytes repeat only for `write_still` PNG/JPEG with those flags off; otherwise compare pixels |
| 3b | `exp03b_exr_header.py` | 16 spp, single-layer and multilayer EXR | Header attributes and pixel payload of two runs | **EXR bytes never repeated.** Flags off: `cycles.ViewLayer.render_time` and `.total_time` (and sometimes `.synchronization_time`) still differ; payload after the header identical | An EXR cannot be compared by file hash in 5.3.0 |
| 4 | `exp04_seed.py` | WF, stone, seed 0 vs seed 1, 64/256/1024 spp; OIDN off and on | Whole crop, 8-bit | Mean abs diff 9.6 / 4.8 / 2.4 (of 255), SSIM 0.79 / 0.91 / 0.97. With OIDN: 3.7 / 3.2 at 64 / 256 spp | Changing the seed changes the picture by far more than any "same image" tolerance; fix the seed |
| 5 | `exp05_depth.py` | WF, stone, 1024 spp, seed 0. total/glossy/transmission: (a) 32/16/32, (b) 32/32/32, (c) 16/16/16, (d) 64/64/64; plus a 15-point sweep at 64 spp | Stone mean luminance; differences | (a) 1.712, (c) 1.698, (b) 1.765, (d) 1.797; 128/128/128 gives 1.806 (sweep). (a) is 0.8 % above (c), 3.0 % below (b), 4.7 % below (d). 17.7 % of stone pixels are more than 10 % darker in (a) than in (b) | Confirmed: the glossy limit ends paths inside the stone. Glossy 16 behaves almost like 16 all round |
| 6 | `exp06_clamp.py` | WF, stone, 256 spp seeds 0 and 1 (and 1024 spp for clamp 20 vs 0) | Clamp indirect 20 / 10 / 0; `blur_glossy` 0.2 / 0; caustics on | Stone mean 1.712 / 1.607 / 2.814. Clamp off: 99.9th percentile 536 (vs 9.2), 80 stone pixels reach display white (vs 0). `blur_glossy` 0: mean 0.11/255 change in the stone, ground identical | Clamp 20 removes 39 % of the stone's light, all of it the sparkle highlights. `blur_glossy` 0.2 does nothing measurable here |
| 7 | `exp07_dispersion.py` | WF, stone, 256 spp seeds 0 and 1 | Scale 0; 0.36 @ Abbe 20; 1.0 @ Abbe 55.3; 0.36 @ Abbe 55.3; 1.0 @ Abbe 20 | Colour signal (cross-seed chroma RMS) 6.5 / 12.3 / 12.4 / 8.6 / 16.6. Noise (relative RMS) 0.039 with it off, 0.170 with it on at any strength. CPU 50.4 s off vs 51.8–52.8 s on | 0.36 at Abbe 20 equals 1.0 at Abbe 55.3 (diamond). Dispersion costs no time per sample but 4.4 times the noise |
| 8 | `exp08_denoise.py` | WF, stone, seed 0 at 64/256/1024 spp; OIDN off, on with albedo+normal, albedo only, no guides. Reference: mean of four 1024-spp renders, seeds 1–4 | Distance to reference in the stone (display mean abs, of 255) | Noisy 17.0 / 8.5 / 4.6. OIDN albedo+normal 8.9 / 6.3 / 4.4. OIDN no guides 8.4 / 6.0 / 4.1. Prefilter NONE at 64 spp: 14.8 | OIDN at 64 spp is as close as 256 spp without it; guides do not help the stone; at 1024 spp it changes almost nothing |
| 9 | `exp09_flicker.py` | Ring view 256 px, 32 spp, 6 frames, ring turned 2° per frame | Fixed seed vs `use_animated_seed`; OIDN on and off; static ground patches | Frame-to-frame mean change, OIDN: fixed 0.037–0.040, animated 0.054–0.071 (of 255). No denoise: fixed 0.000–0.001, animated 1.07–1.73 | Fixed seed is steadier in a static background; with OIDN both are below 0.1/255 |
| 10 | `exp10_colour.py` | Ring view 256 px, 128 spp + OIDN; 8 view/look pairs; two exposures | Background value and gold colour | Composite over white outside Blender: background exactly 255 under every view. Opaque white ground: 255 only under Standard. Gold chroma (CIELAB C*) at −1.15 stops: Standard 25.2, AgX 17.0, Filmic 19.0, Khronos PBR Neutral 30.0 | White must come from compositing, not from the view transform; AgX mutes gold |
| 11 | `exp11_timing.py` | Macro view 512 × 512, WF, 32 and 96 spp | Dispersion on vs off; glossy 32; depth 64; OIDN; 1 thread | 0.547 CPU-s per sample with dispersion, 0.543 without (0.275 s wall on 2 quiet threads). Glossy 32: +7.7 %. Depth 64: +15 %. OIDN: +1.5 s per frame | About 2.1 CPU-seconds per sample per megapixel for the stone close-up |
| 12 | `exp12_tangent.py` | Ring view 256 px, 32 spp; ring metal (20,224 triangles) with (A) noise → tangent-space Normal Map, (B) anisotropy with a UV-map Tangent node | 16 renders with 2 threads, 8 with 1 thread, per material | (A) all 24 identical. (B) **1 of 16 two-thread renders differed**: 3 of 65,536 pixels, max 1.2e-7 (one float step), 8-bit PNG identical. All 8 one-thread renders identical | The reported thread-order effect in tangents exists but is rare and below 8-bit visibility here |

### Inferences
- [E] The lab's view exposure (−1.152 stops) only affects the 8-bit figures; linear figures do not depend on it.
- [E] Because other agents shared the two cores, any wall-clock figure in this file may be up to twice the quiet-machine time; CPU-seconds divided by two is the better estimate of quiet wall-clock.

### Gaps
- GPU rendering (CUDA, OptiX, HIP, oneAPI, Metal) and macOS were **not tested**. Nothing here says a GPU render repeats, nor that a GPU render equals a CPU render.
- Repeatability **across machines, CPU models, operating systems or Blender builds was not tested**: every comparison is the same binary on the same virtual machine.
- One scene only: one round brilliant, one gold, one studio with very bright small sparkle lights. Coloured stones, absorption, pavé, white metal, HDRI lighting, depth of field and motion blur were not tested.
- Largest render was 512 px; the workflow's 1600 px finals were not rendered.
- The Blender manual page for the Principled BSDF could not be fetched (the site refused automated access), so the meaning of the two dispersion sockets rests on the measurement in section 3, not on the manual. The module's own description strings for those sockets are empty.

## 2. Which settings make a render repeatable?

### Takeaway
On one machine and one build, a fixed seed with fixed samples, or with adaptive sampling, gives bit-identical pixels every time, with the denoiser on or off and at any thread count; a time limit, a changed seed, and (rarely, at the last float bit) UV-tangent materials on big meshes are what break it. Saved files never match byte for byte by default, because Blender writes the date and render time into them.

### Cited Findings
- **[M] Fixed seed, fixed samples: identical.** Stone, 64 spp, seed 0, adaptive off, no time limit. Same process rendered twice; process 1 vs a fresh process 2; fresh 2 vs fresh 3; 2 threads vs 1 thread: in all four, the 32-bit float buffer has the same SHA-256 and the decoded PNG pixels are equal (max difference 0 in linear and in 8-bit). — [exp01_repeat.py](/home/claude/scratch/23-lab/exp01_repeat.py), [log_exp01.txt](/home/claude/scratch/23-lab/log_exp01.txt)
- **[M] Same with Open Image Denoise on** (`denoiser='OPENIMAGEDENOISE'`, passes `RGB_ALBEDO_NORMAL`, prefilter `ACCURATE`, CPU): all four comparisons bit-identical, including 1 thread vs 2. For scale, denoiser on vs off at 64 spp differs by mean 6.6/255, max 179/255. — [exp01_repeat.py](/home/claude/scratch/23-lab/exp01_repeat.py), [log_exp01.txt](/home/claude/scratch/23-lab/log_exp01.txt)
- **[M] The 8-bit PNG pixels repeat too**, with Blender's default dither (`dither_intensity` 1.0) left on: the dither did not introduce run-to-run differences. — [log_exp01.txt](/home/claude/scratch/23-lab/log_exp01.txt)
- **[M] Adaptive sampling at 0.01 (the workflow's setting): identical.** Max 512 spp: run a vs run b, 2 threads vs 1 thread, and adaptive + OIDN run a vs run b all have equal float hashes. Against a fixed 512-spp render it differs slightly (max 9/255, mean 0.07/255, 0.08 % of pixels off by more than 2, SSIM 0.9992) and used 103.7 CPU-s against 106.5: at this threshold almost every pixel of the stone crop still took nearly all 512 samples. — [exp02_adaptive.py](/home/claude/scratch/23-lab/exp02_adaptive.py), [log_exp02_adaptive.txt](/home/claude/scratch/23-lab/log_exp02_adaptive.txt)
- **[M] A time limit breaks it.** `time_limit=10`, max 4096 spp, five fresh runs: three share one pixel hash and two have their own. A differing pair: max 154/255, mean 1.02/255, RMS 2.7/255, 14.9 % of pixels off by more than 2, SSIM 0.994, mean CIEDE2000 0.84. The runs received between 10.3 and 13.5 CPU-seconds inside the same 10 s of wall-clock, because other processes were competing. Adaptive sampling plus the time limit, two runs: mean 4.2/255, max 177, 55 % of pixels off by more than 2, SSIM 0.955. — [exp02_adaptive.py](/home/claude/scratch/23-lab/exp02_adaptive.py), [log_exp02_adaptive.txt](/home/claude/scratch/23-lab/log_exp02_adaptive.txt)
- **[M] The saved sample count does not reveal an early stop.** The metadata string `cycles.ViewLayer.samples` read 4096 on the time-limited renders (the requested number), although they cannot have completed 4096 samples in 10 s. — [log_exp02_adaptive.txt](/home/claude/scratch/23-lab/log_exp02_adaptive.txt)
- **[M] Seed sensitivity** (seed 0 vs seed 1, everything else equal, stone crop; 8-bit units of 255):

  | Samples | Denoiser | Whole crop: mean abs / RMS / share of pixels off by >2 | SSIM | Mean CIEDE2000 | Stone only: mean abs (max) | Metal only: mean abs | Ground only: mean abs (max) |
  |---|---|---|---|---|---|---|---|
  | 64 | off | 9.63 / 19.2 / 60 % | 0.788 | 7.8 | 16.3 (215) | 6.0 | 0.98 (32) |
  | 256 | off | 4.83 / 9.7 / 52 % | 0.909 | 4.5 | 8.3 (155) | 2.9 | 0.35 (11) |
  | 1024 | off | 2.41 / 4.8 / 44 % | 0.968 | 2.4 | 4.2 (82) | 1.5 | 0.12 (4) |
  | 64 | OIDN | 3.69 / 7.6 / 49 % | 0.945 | 3.5 | 6.2 (134) | 2.9 | 0.11 (16) |
  | 256 | OIDN | 3.20 / 6.8 / 46 % | 0.957 | 3.1 | 5.4 (101) | 2.3 | 0.08 (11) |

  Linear relative RMS difference in the stone: 0.48 / 0.24 / 0.12 at 64 / 256 / 1024 spp without denoising. Denoised seed 1 at 1024 spp was not rendered. — [exp04_seed.py](/home/claude/scratch/23-lab/exp04_seed.py), [log_exp04_seed.txt](/home/claude/scratch/23-lab/log_exp04_seed.txt)
- **[M] File bytes, default settings: nothing repeats.** PNG and JPEG from `bpy.ops.render.render(write_still=True)`, and PNG, JPEG and EXR from `Image.save_render()`, all had different SHA-256 across two runs while their pixels were identical. The PNG text chunks present were `File`, `Date`, `Time`, `Frame`, `Camera`, `Scene`, `RenderTime`, `cycles.ViewLayer.samples`, `.total_time`, `.render_time`, `.synchronization_time`; the ones that changed were `Date`, `RenderTime` and the Cycles time strings. JPEG carries the same as `Blender:…` comment segments. — [exp03_filebytes.py](/home/claude/scratch/23-lab/exp03_filebytes.py), [log_exp03.txt](/home/claude/scratch/23-lab/log_exp03.txt)
- **[M] What makes PNG and JPEG bytes repeat.** With `use_stamp_date`, `use_stamp_time`, `use_stamp_render_time`, `use_stamp_frame`, `use_stamp_camera`, `use_stamp_scene` and `use_stamp_filename` set False (the seven that are on in a factory scene; `use_stamp_memory` on or off made no difference), the PNG and the JPEG written by `render(write_still=True)` contain no text at all and are **byte-identical across two fresh processes**. Turning off only the date, or only the render time, or both, is not enough: the Cycles time strings remain. `metadata_input` ('SCENE' or 'STRIPS') made no difference. — [exp03c_stamp_matrix.py](/home/claude/scratch/23-lab/exp03c_stamp_matrix.py), [log_exp03c.txt](/home/claude/scratch/23-lab/log_exp03c.txt)
- **[M] Two traps in that.** (1) Also setting `use_stamp_labels=False`, or `use_stamp_hostname=True`, brings the four `cycles.ViewLayer.*` strings back and the bytes differ again; so "set every `use_stamp…` property to False" does **not** give repeatable bytes, because `use_stamp_labels` defaults to True and must be left alone. (2) Files written with `bpy.data.images['Render Result'].save_render()` kept the `cycles.ViewLayer.*` strings under every flag combination tried, and never repeated. — [exp03c_stamp_matrix.py](/home/claude/scratch/23-lab/exp03c_stamp_matrix.py), [log_exp03c.txt](/home/claude/scratch/23-lab/log_exp03c.txt)
- **[M] OpenEXR never repeated.** Single-layer EXR (`save_render`) and multilayer EXR (`write_still`, format `OPEN_EXR_MULTILAYER`), two runs each: file bytes differ in every variant. Default flags: header attributes `Date`, `RenderTime`, `cycles.ViewLayer.render_time`, `.synchronization_time`, `.total_time` differ. All stamp flags off, and the seven-flags-off variant that makes PNG repeat: `cycles.ViewLayer.render_time` and `.total_time` still differ (for example '00:03.32' vs '00:03.35'). In every case the files have the same size and **everything after the header is byte-identical**, and the decoded float pixels are equal. The header also carries `Software` ("Blender 5.3.0") and `cycles.ViewLayer.samples`. This confirms the documentation researcher's inference about EXR. — [exp03b_exr_header.py](/home/claude/scratch/23-lab/exp03b_exr_header.py), [log_exp03b.txt](/home/claude/scratch/23-lab/log_exp03b.txt)
- **[M] A setting-free way to get repeatable files.** Re-saving the two default PNGs from their pixels alone with Pillow gave identical file hashes. — [exp03_filebytes.py](/home/claude/scratch/23-lab/exp03_filebytes.py), [log_exp03.txt](/home/claude/scratch/23-lab/log_exp03.txt)
- **[M] Tangents and threads (coordinator's addition).** Ring metal, 20,224 triangles, given a UV map. Material A (procedural noise into a tangent-space Normal Map node): 16 renders with 2 threads and 8 with 1 thread, all 24 float buffers identical. Material B (Principled anisotropy 0.8 with a Tangent node set to the UV map): 15 of 16 two-thread renders identical; **one differed in 3 of 65,536 pixels by at most 1.19e-7 absolute (2e-7 relative, one float step)**, with the 8-bit PNG pixels equal; all 8 one-thread renders identical. The control with plain gold was identical across runs. The odd render was the first of two in one process. — [exp12_tangent.py](/home/claude/scratch/23-lab/exp12_tangent.py), [log_exp12.txt](/home/claude/scratch/23-lab/log_exp12.txt)
- **[M] Animation: fixed seed vs animated seed.** Ring view, 32 spp, 6 frames with the ring turned 2° per frame; two 56 × 56 ground patches that the ring does not affect (with a fixed seed and no denoiser they change by 0.000–0.001/255 between frames, which shows they are static):

  | | Mean change per pixel between consecutive frames (of 255) | Largest change | Temporal std of 8 × 8 block means | Linear relative temporal std |
  |---|---|---|---|---|
  | OIDN, fixed seed | 0.037 – 0.040 | 1 | 0.011 – 0.012 | 0.0006 |
  | OIDN, animated seed | 0.054 – 0.071 | 1 | 0.025 – 0.036 | 0.0010 – 0.0013 |
  | OIDN, animated seed, ring not moving (control) | 0.058 – 0.073 | 1 | 0.025 – 0.037 | 0.0010 – 0.0013 |
  | No denoiser, fixed seed | 0.000 – 0.001 | 1 | 0.000 – 0.001 | 0.0000 |
  | No denoiser, animated seed | 1.07 – 1.73 | 5 – 10 | 0.056 – 0.080 | 0.020 – 0.033 |

  A third patch near the ring's shadow changed even with a fixed seed and no denoiser (0.38/255), because the light there really changes as the ring turns; it is not counted as static. With `use_animated_seed` on, frame 1 does not have the same pixels as a seed-0 still. Render time per frame was the same in all four modes (3.1–3.3 s under load). — [exp09_flicker.py](/home/claude/scratch/23-lab/exp09_flicker.py), [log_exp09_flicker.txt](/home/claude/scratch/23-lab/log_exp09_flicker.txt)
- **[M] Looked at** `exp09_flicker_frames.png` and `exp09_flicker_diff.png`: with a fixed seed the amplified (×16) frame difference is black everywhere except the ring, its reflections and its shadow, with or without the denoiser; with an animated seed and no denoiser the whole ground is covered in grain; with an animated seed and OIDN the ground is nearly black again. — [exp09_flicker_diff.png](/home/claude/scratch/23-lab/exp09_flicker_diff.png)

### Inferences
- [E] A "same picture" check on one machine can demand exact equality of decoded pixels when the seed is fixed, samples are fixed or adaptive, and no time limit is set. If a tolerance is wanted (for the tangent case, or across machines, which was not tested), it should sit far below seed noise: the smallest seed-to-seed difference measured was mean 2.4/255 over the crop at 1024 spp, and 0.08/255 on plain ground with OIDN, while the tangent effect was zero in 8-bit. A threshold such as "no pixel differs by more than 1/255" would pass the tangent case and fail every seed change measured here.
- [E] The time-limit result is explained by the limit stopping the render at whatever sample count the machine reached: three runs that got about the same CPU time matched exactly, two that got more or less did not. The actual sample counts were not read.
- [E] The stamp behaviour looks as if Blender writes the Cycles time strings whenever any stamp bit is set, and "hide labels" (the off state of `use_stamp_labels`) counts as a set bit. That is a guess from the eight flag combinations tested, not from the source.
- [E] For file-level comparison the safe rule is: hash decoded pixels, or write PNG/JPEG with `write_still=True` and the seven flags off. EXR files have to be compared by pixel data.
- [E] For turntables the denoised background is steady either way (under 0.1/255 mean). A fixed seed is measurably steadier there and is exactly repeatable; the known objection to a fixed seed (a noise pattern that stays still while the object moves under it) was not measured here.
- [E] The tangent result supports the source-reading finding in kind (only with more than one thread, only with UV tangents on a mesh over 10,000 faces) but at a rate of 1 in 16 for one material and 0 in 16 for the other, and at one float step. `threads=1` removed it in 8 of 8 renders, at twice the render time on this machine.

### Gaps
- Cross-machine, cross-OS and GPU repeatability: not tested.
- `use_persistent_data`, path guiding, `scrambling_distance`, sample subsets/offsets, and tiles (images above 2048 px) were not tested.
- The tangent test used 24 renders per material; the true rate is uncertain (1 event). Whether the normal-map path can show it at all was not established.
- Flicker on the moving ring itself, and at higher sample counts, was not separated from real motion.
- Whether a newer or older Blender writes the same metadata was not tested.

## 3. Which settings make the stone and the metal look right?

### Takeaway
Three of the workflow's settings change the diamond measurably: glossy 16 cuts light paths inside the stone and leaves about 18 % of its pixels more than 10 % too dark against glossy 32; clamp indirect 20 removes 39 % of the stone's light, which is all of its bright sparkle; and AgX mutes the gold. "Dispersion 0.36" turns out to be the physically right strength for diamond only if the Abbe number is left at the node default of 20. `blur_glossy` 0.2 and caustics off make no measurable difference to the stone.

### Cited Findings

**Ray depth (experiment 5)**
- **[M] Main test, stone, 1024 spp, seed 0, all else WF:**

  | | total / glossy / transmission | Stone mean luminance | vs (d) | Stone median | Metal mean | Ground mean | CPU-s |
  |---|---|---|---|---|---|---|---|
  | (a) workflow | 32 / 16 / 32 | 1.7119 | 95.3 % | 1.005 | 1.1211 | 1.5408 | 211.2 |
  | (b) | 32 / 32 / 32 | 1.7647 | 98.2 % | 1.069 | 1.1283 | 1.5408 | 231.3 |
  | (c) | 16 / 16 / 16 | 1.6977 | 94.5 % | 0.988 | 1.1187 | 1.5408 | 202.7 |
  | (d) | 64 / 64 / 64 | 1.7965 | 100 % | 1.103 | 1.1327 | 1.5408 | 254.1 |

  — [exp05_depth.py](/home/claude/scratch/23-lab/exp05_depth.py), [log_exp05_depth.txt](/home/claude/scratch/23-lab/log_exp05_depth.txt)
- **[M] Is (a) the same as (c)?** Not bit-identical, but close: stone mean differs by 0.8 %, mean 1.4/255, SSIM 0.9935, no stone pixel more than 10 % darker. (a) against (b): mean 4.7/255, RMS 14.7/255, max 223/255, SSIM 0.960, mean CIEDE2000 2.9, and **17.7 % of stone pixels are more than 10 % darker in (a)**. (a) against (d): mean 6.9/255, SSIM 0.933, 23.1 % of stone pixels more than 10 % darker. (b) against (d): mean 2.3/255, 10.9 % of pixels. — [log_exp05_depth.txt](/home/claude/scratch/23-lab/log_exp05_depth.txt)
- **[M] Which limit does the cutting** (sweep at 64 spp, seed 0, stone mean luminance; 128/128/128 = 1.8064 taken as 100 %):

  | Setting | Mean | % of 128 |
  |---|---|---|
  | glossy 2 (total 32, transmission 32) | 1.2307 | 68.1 |
  | glossy 4 | 1.4520 | 80.4 |
  | glossy 8 | 1.6233 | 89.9 |
  | glossy 16 (the workflow) | 1.7127 | 94.8 |
  | glossy 32 | 1.7656 | 97.7 |
  | all three 64 | 1.7972 | 99.5 |
  | all three 16 | 1.6984 | 94.0 |
  | all three 8 | 1.5777 | 87.3 |
  | transmission 4 (total 32, glossy 32) | 1.7615 | 97.5 |
  | transmission 8 or 16 (total 32, glossy 32) | 1.7656 | 97.7 |

  Exact identities by pixel hash: total 64 / glossy 16 / transmission 64 is **bit-identical** to the workflow's 32/16/32 (raising the total and transmission above 32 does nothing while glossy is 16); transmission 16 is bit-identical to transmission 32 at glossy 32; total 8 with glossy and transmission 32 is bit-identical to 8/8/8. So the glossy limit and the total limit end paths in the stone, and the transmission limit hardly matters. This confirms the earlier research: each internal reflection counts as a glossy bounce. — [log_exp05_depth.txt](/home/claude/scratch/23-lab/log_exp05_depth.txt)
- **[M] Looked at** `exp05_depth_side.png` and `exp05_depth_diff.png`: in (a) and (c) a band of small facets across the far crown and upper girdle is dark grey to black; in (b) and (d) those same facets are lit and show colour. The difference image (a − b) is concentrated in that band and along some pavilion reflections; the table is unchanged. The dark facets in (a) are cut-off paths, not real contrast. — [exp05_depth_side.png](/home/claude/scratch/23-lab/exp05_depth_side.png)

**Clamping and filter glossy (experiment 6)**
- **[M] Stone, 256 spp, mean of seeds 0 and 1** (linear luminance; "white" = all three 8-bit channels ≥ 250):

  | | Stone mean | 99th pct | 99.9th pct (seed 0 / 1) | Max (seed 0 / 1) | Stone pixels at display white | Coloured pixels, their saturation | Noise, stone (rel. RMS) | Noise, metal | Isolated bright pixels off the stone (seed 0 / 1) |
  |---|---|---|---|---|---|---|---|---|---|
  | WF: clamp 20, blur 0.2 | 1.712 | 6.69 | 9.18 / 9.49 | 10.8 / 10.5 | 0 (brightest 8-bit value 244) | 65.6 %, 0.517 | 0.170 | 0.247 | 97 / 88 |
  | clamp 10 | 1.607 | 5.47 | 6.14 / 6.13 | 6.9 / 6.9 | 0 (brightest 232) | 77.8 %, 0.512 | 0.163 | 0.246 | 95 / 87 |
  | clamp 0 (off) | 2.814 | 6.87 | 535.8 / 537.4 | 610 / 613 | 80 | 61.8 %, 0.534 | 0.982 | 0.560 | 144 / 138 |
  | blur_glossy 0 | 1.712 | 6.69 | 9.18 / 9.49 | 10.8 / 10.5 | 0 | 65.7 %, 0.517 | 0.170 | 0.247 | 99 / 87 |
  | clamp 0 + blur 0 | 2.815 | 6.87 | 535.8 / 537.4 | 610 / 613 | 80 | 61.9 %, 0.534 | 0.982 | 0.562 | 146 / 136 |
  | WF + caustics on | 1.714 | 6.69 | 9.18 / 9.49 | 10.8 / 10.5 | 0 | 65.6 %, 0.517 | 0.170 | 0.245 | 97 / 86 |

  "Coloured" = saturation (max − min)/max above 0.25 with max above 0.2. — [exp06_clamp.py](/home/claude/scratch/23-lab/exp06_clamp.py), [log_exp06_clamp.txt](/home/claude/scratch/23-lab/log_exp06_clamp.txt)
- **[M] What the clamp removes is real, not noise.** At 1024 spp with the clamp off, 103 stone pixels (0.31 %) are brighter than 20 and carry **39.1 % of the stone's summed luminance**; 77 of them are above 100. The 99.9th percentile is the same at both seeds and at 1024 spp (536, 537, 550), which random fireflies would not be. With clamp 20 no stone pixel exceeds 20, and the stone mean falls from 2.825 to 1.712. The rest of the stone (pixels below 20 in the unclamped render) is 1.8 % darker with the clamp (1.696 vs 1.727). — [log_exp06_clamp.txt](/home/claude/scratch/23-lab/log_exp06_clamp.txt)
- **[M] Cost of removing the clamp.** Linear noise in the stone 0.170 → 0.982 and in the metal 0.247 → 0.560 (dominated by those few very bright pixels); isolated bright pixels on metal and ground 97/88 → 144/138. In display terms the seed-to-seed difference in the stone rises only from mean 8.3 to 8.8/255 (RMS 12.9 → 14.9). Clamp 20 vs clamp 0 at the same seed, stone, display: mean 1.4/255, max 214/255. Ground: unchanged (max 3/255). — [log_exp06_clamp.txt](/home/claude/scratch/23-lab/log_exp06_clamp.txt)
- **[M] Clamp 10** (Blender's default) lowers the stone mean a further 6 % (1.607), the brightest 8-bit value to 232, and against WF changes the stone by mean 2.8/255. — [log_exp06_clamp.txt](/home/claude/scratch/23-lab/log_exp06_clamp.txt)
- **[M] `blur_glossy` 0.2 vs 0:** stone mean 1.7118 vs 1.7122, identical percentiles, same-seed difference mean 0.11/255 in the stone, ground bit-identical, noise identical. **Caustics on** (both reflective and refractive): stone unchanged (mean 0.12/255), ground changes by mean 0.57/255 (max 8) and its noise rises from 0.0081 to 0.0140. — [log_exp06_clamp.txt](/home/claude/scratch/23-lab/log_exp06_clamp.txt)
- **[M] Looked at** `exp06_clamp_side.png`: with the clamp off two facets flash pure white (upper right of the table) and one pink-white flash appears near the centre; with clamp 20 the same facets are light grey or lilac; with clamp 10 the whole stone is slightly duller and more yellow-green. The `blur_glossy` 0 and caustics-on panels are indistinguishable from WF by eye. — [exp06_clamp_side.png](/home/claude/scratch/23-lab/exp06_clamp_side.png)

**Dispersion (experiment 7)**
- **[M] Stone, 256 spp, seeds 0 and 1.** "Signal chroma" is the cross-seed RMS of CIELAB chroma (noise that differs between seeds cancels); "raw" is the plain mean chroma of one render, which includes colour noise.

  | Scale @ Abbe | Stone mean lum. | Chroma: raw mean / signal RMS / 99th pct | Coloured pixels, saturation | Noise (rel. RMS) | Colour noise (chroma RMS) | CPU-s |
  |---|---|---|---|---|---|---|
  | 0 (off) | 1.7183 | 3.19 / 6.54 / 24.2 | 20.1 %, 0.477 | 0.039 | 0.71 | 50.4 |
  | 0.36 @ 55.3 | 1.7117 | 8.79 / 8.58 / 37.6 | 60.3 %, 0.469 | 0.170 | 8.33 | 52.2 |
  | 0.36 @ 20 (workflow as read) | 1.7118 | 10.73 / 12.34 / 46.7 | 65.6 %, 0.517 | 0.170 | 8.29 | 52.3 |
  | 1.0 @ 55.3 (diamond's Abbe number) | 1.7118 | 10.75 / 12.38 / 46.9 | 65.8 %, 0.517 | 0.170 | 8.29 | 51.8 |
  | 1.0 @ 20 | 1.7056 | 13.83 / 16.57 / 51.4 | 74.1 %, 0.586 | 0.169 | 8.18 | 52.8 |

  — [exp07_dispersion.py](/home/claude/scratch/23-lab/exp07_dispersion.py), [log_exp07_dispersion.txt](/home/claude/scratch/23-lab/log_exp07_dispersion.txt)
- **[M] Scale and Abbe number combine as scale ÷ Abbe.** Scale 0.3617 at Abbe 20 against scale 1.0 at Abbe 55.3 (20 ÷ 55.3 = 0.3617), same seed: mean 0.085/255, SSIM 0.9998, mean CIEDE2000 0.09, against 8.3/255 between two seeds. The workflow's 0.36 at Abbe 20 against 1.0 at Abbe 55.3: mean 0.53/255. So **"0.36" with the default Abbe 20 is the diamond value**; 0.36 with the Abbe number changed to 55.3 gives about 0.36 of the physical strength. The value 55.3 for diamond is the one in the spike's scene file; the module's documentation strings are empty, so the module itself gives no physical value. — [log_exp07_dispersion.txt](/home/claude/scratch/23-lab/log_exp07_dispersion.txt), [scene.json](/home/claude/scratch/15/scene/scene.json)
- **[M] Cost.** Time per sample is the same with and without (50.4 vs 51.8–52.8 CPU-s at 256 spp on the crop, +3 to +5 %; 0.543 vs 0.547 CPU-s per sample at 512 px, under 1 %). Noise in the stone is 4.4 times higher with dispersion on (0.170 vs 0.039 relative RMS), and it is the same at every strength tested. Mean brightness does not change (1.712 vs 1.718). — [log_exp07_dispersion.txt](/home/claude/scratch/23-lab/log_exp07_dispersion.txt), [log_exp11_timing.txt](/home/claude/scratch/23-lab/log_exp11_timing.txt)
- **[M] Looked at** `exp07_dispersion_side.png`: with dispersion off the stone is neutral grey-white with warm reflections of the gold; at 0.36 @ 20 and 1.0 @ 55.3 (which look the same) there are distinct yellow, lilac, cyan and red flashes in the crown facets; 0.36 @ 55.3 has the same flashes but paler; 1.0 @ 20 has rainbow bands across many facets and looks overdone. — [exp07_dispersion_side.png](/home/claude/scratch/23-lab/exp07_dispersion_side.png)

**Denoiser and facets (experiment 8)**
- **[M] Reference.** Mean of four 1024-spp renders with seeds 1–4 (4096 samples in all, no denoiser), not one 4096-spp render, to keep each render short. Its two halves (2048 each) differ from each other by 0.085 relative RMS and 4.1/255 in the stone, so the reference's own noise is about 0.04 relative RMS (about 2/255); distances near that floor mean "as good as the reference can tell". — [exp08_denoise.py](/home/claude/scratch/23-lab/exp08_denoise.py), [log_exp08_denoise.txt](/home/claude/scratch/23-lab/log_exp08_denoise.txt)
- **[M] Distance to the reference in the stone, seed 0** (display values through one fixed gain-and-sRGB curve, of 255; "edge energy" = mean gradient magnitude relative to the reference, below 1 means smoother):

  | Samples | Variant | Linear rel. RMSE | Display mean abs | Display RMSE | SSIM in stone | CIEDE2000 | Edge energy | Mean brightness ratio |
  |---|---|---|---|---|---|---|---|---|
  | 64 | no denoiser | 0.344 | 17.0 | 30.0 | 0.713 | 12.1 | 1.23 | 1.001 |
  | 64 | OIDN, albedo + normal | 0.177 | 8.9 | 14.8 | 0.876 | 7.2 | 0.94 | 0.986 |
  | 64 | OIDN, albedo only | 0.188 | 9.2 | 15.4 | 0.863 | 7.5 | 0.94 | 0.997 |
  | 64 | OIDN, no guides | 0.176 | 8.4 | 14.0 | 0.883 | 6.9 | 0.92 | 1.006 |
  | 64 | OIDN, albedo + normal, follow reflections off | 0.206 | 9.4 | 15.7 | 0.862 | 7.9 | 0.99 | 0.992 |
  | 64 | OIDN, albedo + normal, prefilter NONE | 0.273 | 14.8 | 27.3 | 0.746 | 10.7 | 1.17 | 0.992 |
  | 256 | no denoiser | 0.176 | 8.5 | 14.3 | 0.870 | 7.5 | 1.06 | 1.000 |
  | 256 | OIDN, albedo + normal | 0.131 | 6.3 | 10.5 | 0.927 | 5.7 | 1.00 | 0.994 |
  | 256 | OIDN, albedo only | 0.135 | 6.6 | 11.0 | 0.914 | 6.0 | 1.01 | 0.996 |
  | 256 | OIDN, no guides | 0.127 | 6.0 | 10.0 | 0.931 | 5.5 | 0.98 | 1.001 |
  | 256 | OIDN, albedo + normal, follow reflections off | 0.146 | 6.8 | 11.3 | 0.914 | 6.2 | 1.02 | 0.998 |
  | 1024 | no denoiser | 0.094 | 4.6 | 7.7 | 0.941 | 4.6 | 1.01 | 1.000 |
  | 1024 | OIDN, albedo + normal | 0.094 | 4.4 | 7.4 | 0.947 | 4.4 | 1.01 | 1.000 |
  | 1024 | OIDN, no guides | 0.088 | 4.1 | 6.8 | 0.956 | 4.1 | 1.00 | 1.000 |

  — [log_exp08_denoise.txt](/home/claude/scratch/23-lab/log_exp08_denoise.txt)
- **[M] Reading of the table.** OIDN at 64 spp is as close to the reference as 256 spp without it (8.9 vs 8.5). At 256 spp it gains about a quarter (8.5 → 6.3). At 1024 spp it changes almost nothing (4.6 → 4.4). Dropping the albedo and normal guides was slightly **closer** to the reference in the stone at all three sample counts (8.4, 6.0, 4.1). Turning the prefilter off with guides on was much worse (14.8). `denoising_pass_follow_reflections` (on by default in 5.3.0) helps a little when on (8.9 vs 9.4 at 64; 6.3 vs 6.8 at 256). OIDN added about 1.5 s to a 512 px frame. — [log_exp08_denoise.txt](/home/claude/scratch/23-lab/log_exp08_denoise.txt), [log_exp11_timing.txt](/home/claude/scratch/23-lab/log_exp11_timing.txt)
- **[M] Visual check** (`exp08_denoise_64.png`, `exp08_denoise_256.png`, `exp08_denoise_zoom.png`, opened and compared with the reference). At 64 spp, with or without guides, the boundaries between large bright and dark facets stay sharp and in the right place, and the strong colour flashes (yellow, lilac, cyan) are kept. What is lost is the fine detail **inside** facets: the reference shows thin streaks and small secondary reflections inside the dark pavilion facets and a faceted texture in the large lower-left facet; at 64 spp these become soft, slightly painterly patches of pastel colour, and the lower-left facet turns milky. I saw no facet edge that is not in the reference, so no invented structure, but the interiors are smoothed (edge energy 0.92–0.94). At 256 spp most of the interior streaks are back and the image is hard to tell from the reference at normal size; at 1024 spp denoised and reference match apart from grain. — [exp08_denoise_zoom.png](/home/claude/scratch/23-lab/exp08_denoise_zoom.png)

**Colour management on a white background (experiment 10)**
- **[M] What each view transform does to a scene-linear grey** (emissive plane, exposure 0, 8-bit value written):

  | View / look | 0.18 | 0.5 | 0.8 | 1.0 | 1.5 | 2 | 4 | 8 | 16 | 32 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Standard / None | 118 | 187 | 231 | 255 | 255 | 255 | 255 | 255 | 255 | 255 |
  | AgX / None | 118 | 170 | 189 | 197 | 209 | 217 | 233 | 245 | 255 | 255 |
  | AgX / AgX - Base Contrast | 118 | 170 | 189 | 197 | 209 | 217 | 233 | 245 | 255 | 255 |
  | AgX / AgX - Medium High Contrast | 118 | 178 | 199 | 207 | 221 | 229 | 244 | 255 | 255 | 255 |
  | AgX / AgX - Punchy | 88 | 144 | 167 | 177 | 192 | 202 | 222 | 237 | 249 | 255 |
  | Filmic / None | 128 | 177 | 197 | 206 | 219 | 227 | 242 | 251 | 255 | 255 |
  | Filmic / Medium High Contrast | 128 | 183 | 204 | 213 | 225 | 233 | 245 | 252 | 255 | 255 |
  | Khronos PBR Neutral / None | 105 | 181 | 225 | 239 | 248 | 250 | 253 | 254 | 255 | 255 |

  — [exp10_colour.py](/home/claude/scratch/23-lab/exp10_colour.py), [log_exp10_colour.txt](/home/claude/scratch/23-lab/log_exp10_colour.txt)
- **[M] The module has all the named views:** Standard, AgX, Filmic, Filmic Log, Khronos PBR Neutral, Raw, False Color, ACES 1.3, ACES 2.0. AgX accepts the looks None, AgX - Base Contrast, - Medium High Contrast, - High Contrast, - Very High Contrast, - Punchy, - Greyscale. — [log_inspect_bpy.txt](/home/claude/scratch/23-lab/log_inspect_bpy.txt)
- **[M] "AgX - Base Contrast" is the same picture as AgX with no look.** The grey ramp is identical, and on three rendered images the two PNGs differ in 17–40 of 65,536 pixels by 1/255. — [log_exp10_colour.txt](/home/claude/scratch/23-lab/log_exp10_colour.txt)
- **[M] Method A, the workflow's: film transparent, shadow-catcher ground, RGBA PNG composited over #FFFFFF with Pillow.** Under all eight view/look pairs and both exposures the corner patch is exactly 255, 255, 255, and 99.4–99.8 % of ground pixels are exactly 255. The remainder is the contact shadow (0.55 % of ground pixels have alpha above 0, at most 34/255). The linear render is bit-identical under every view; only the saved 8-bit colours of the piece change. — [log_exp10_colour.txt](/home/claude/scratch/23-lab/log_exp10_colour.txt)
- **[M] Method B, opaque film with a white ground plane.** Ground albedo 1.0, scene-linear 1.87 at the corner, exposure 0: Standard 255; AgX 215 (max 218); AgX Medium High Contrast 227; AgX Punchy 200; Filmic 226; Filmic Medium High Contrast 231; Khronos PBR Neutral 250 (max 251). With albedo 0.8 and exposure −1.152: Standard 214, AgX 182, Filmic 190, Khronos 209. Only Standard gives a 255 ground, and only because the ground is above 1.0. — [log_exp10_colour.txt](/home/claude/scratch/23-lab/log_exp10_colour.txt)
- **[M] Gold under each view** (lower band of the ring, method A, mean 8-bit sRGB; linear mean there is 1.568, 1.184, 0.584):

  | View / look | Exposure −1.152: sRGB | L* / C* / hue° | Gold pixels clipped | Exposure 0: sRGB | L* / C* / hue° | Clipped |
  |---|---|---|---|---|---|---|
  | Standard / None | 188, 168, 125 | 69.6 / 25.2 / 88 | 11.2 % | 227, 217, 173 | 86.6 / 23.4 / 99 | 62.0 % |
  | AgX / None and AgX / Base Contrast | 166, 150, 122 | 62.6 / 17.0 / 85 | 0.0 % | 197, 183, 160 | 75.0 / 13.8 / 86 | 0.1 % |
  | AgX / Medium High Contrast | 173, 154, 122 | 64.5 / 19.4 / 85 | 0.1 % | 207, 192, 166 | 78.2 / 15.2 / 85 | 1.3 % |
  | AgX / Punchy | 141, 124, 94 | 52.8 / 19.1 / 85 | 0.0 % | 177, 161, 134 | 67.0 / 16.4 / 85 | 0.1 % |
  | Filmic / None | 174, 161, 128 | 66.6 / 19.0 / 92 | 0.1 % | 205, 194, 164 | 78.6 / 16.5 / 94 | 0.2 % |
  | Filmic / Medium High Contrast | 178, 164, 128 | 67.8 / 20.9 / 92 | 0.1 % | 210, 199, 168 | 80.5 / 17.3 / 95 | 0.2 % |
  | Khronos PBR Neutral / None | 180, 156, 105 | 65.3 / 30.0 / 87 | 0.1 % | 221, 195, 144 | 79.9 / 29.1 / 87 | 0.7 % |

  — [log_exp10_colour.txt](/home/claude/scratch/23-lab/log_exp10_colour.txt)
- **[M] Looked at** `exp10_colour_em1.png` and `exp10_colour_e0.png`: all eight sit on a pure white page. Standard shows a saturated yellow gold with hard clipped highlights (at exposure 0 the lit side burns out to pale yellow-white); AgX shows a beige, champagne-coloured metal that reads closer to pale brass than yellow gold; Punchy is darker and browner; Filmic is pale with a slight green cast; Khronos PBR Neutral shows a rich yellow-orange gold with highlights that roll off without burning. — [exp10_colour_em1.png](/home/claude/scratch/23-lab/exp10_colour_em1.png), [exp10_colour_e0.png](/home/claude/scratch/23-lab/exp10_colour_e0.png)

### Inferences
- [E] **Ray depth.** The workflow's glossy 16 is the binding limit; its total 32 and transmission 32 buy almost nothing while glossy stays at 16 (0.8 % over 16/16/16). Setting glossy = total = 32 recovers 3.1 % of mean light and re-lights 17.7 % of the stone's pixels for about 8–10 % more CPU time. Going to 64 recovers a further 1.8 % (10.9 % of pixels change by more than 10 %) for a further 7–10 %. 128 is within 0.5 % of 64. Transmission can stay at 32 or lower without visible effect on the stone in this scene.
- [E] **Clamp.** In this studio the sparkle comes from three small very bright panels, and their reflections in the stone are hundreds of times brighter than the body. An indirect clamp of 20 flattens every one of them to light grey: no stone pixel reaches white. Whether that matters depends on the lighting: with only large soft boxes (the workflow's strip softboxes at strength about 18) the brightest reflections may sit under the clamp and lose little. That case was not rendered. With the clamp off the price is a few dozen extra isolated bright pixels on the metal and ground and higher linear noise; the denoiser's handling of those was not measured.
- [E] **`blur_glossy` and caustics** can be left as the workflow has them; with a zero-roughness stone and a 0.08-roughness metal they change nothing measurable in the stone. Caustics on only adds noise and light to the ground.
- [E] **Dispersion.** The workflow line should name the real sockets: `Transmission Dispersion Scale` 0.36 with `Transmission Dispersion Abbe Number` left at 20, or equivalently scale 1.0 with Abbe 55.3. Because noise rises 4.4 times, matching the no-dispersion noise level by samples alone would take about 19 times the samples (4.4²); the practical cost of fire is noise, not seconds per sample.
- [E] **Denoiser.** Below about 256 spp the denoiser is worth a fourfold sample count on the stone but softens detail inside facets; for a close-up of a stone, 256 spp or more with OIDN is the point where the softening stopped being visible here. The albedo and normal guides did not help the stone in this test (no guides was slightly closer); they were not tested on the metal or the ground separately, where guides usually matter more, so this is not a reason to switch them off for the whole frame. If guides are used, the prefilter must stay on.
- [E] **White background.** Exactly white comes only from compositing the transparent render over white outside the view transform, which works under every view. Under AgX a lit white floor cannot reach 255 without about 16 times scene white.
- [E] **Gold.** AgX (with or without Base Contrast, which is the same thing) lowers the gold's chroma by about a third against Standard (17.0 vs 25.2) and keeps the hue; Khronos PBR Neutral keeps the highest chroma (30.0) without clipping. For a product page where the metal colour must read as yellow gold, Khronos PBR Neutral or Standard with controlled exposure is closer to the material's set colour than AgX. Which is "right" against a photograph of real gold was not tested.

### Gaps
- No intermediate clamp value between 20 and off (for example 100 or 1000) was tested, and no direct clamp.
- The clamp result depends on the three small sparkle panels in this studio; the workflow's own light rigs (strip softboxes, banded world dome) were not rendered.
- Depth was tested on a single 57-facet round brilliant from one camera angle; step cuts, fancy shapes and pavé (many stones seen through each other) were not.
- The denoiser test covers the stone only; metal and ground distances to the reference were not tabulated, and OIDN quality settings `BALANCED` and `FAST`, and GPU denoising, were not tested.
- The reference is 4 × 1024 samples with four seeds, not a single 4096-sample render, and it uses WF settings (so it shares WF's depth and clamp bias); it measures noise and denoiser error, not physical correctness.
- Dispersion in Cycles was not compared again with a spectral renderer here (the spike did that at scale 1.0, Abbe 55.3).
- Colour: no comparison against a calibrated photograph or a measured gold colour; white gold, rose gold and platinum not tested; only the sRGB display.

## 4. What does it cost in time?

### Takeaway
On this 2-core CPU the stone close-up costs about 0.55 CPU-seconds per sample at 512 × 512 (0.27 s of wall-clock when the machine is quiet), about 2.1 CPU-seconds per sample per megapixel; dispersion is free per sample, glossy 32 adds about 8 %, depth 64 about 15 %, and the denoiser about 1.5 s per frame.

### Cited Findings
- **[M] Macro camera, 512 × 512 full frame, WF, 2 threads, machine nearly quiet (load 1.1–2.0):**

  | Variant | 32 spp wall / CPU | 96 spp wall / CPU | Marginal per sample, wall / CPU |
  |---|---|---|---|
  | Dispersion on (0.36 @ 20) | 9.0 s / 17.9 s | 26.6 s / 52.9 s | 0.275 s / 0.547 s |
  | Dispersion off | 9.0 s / 17.9 s | 26.4 s / 52.6 s | 0.272 s / 0.543 s |

  Fixed overhead per render about 0.2–0.3 s; process start, scene build and file saving added about 0.7–1.4 s on top in two timed runs. — [exp11_timing.py](/home/claude/scratch/23-lab/exp11_timing.py), [log_exp11_timing.txt](/home/claude/scratch/23-lab/log_exp11_timing.txt)
- **[M] Variants at 96 spp, 512 × 512:** with OIDN 28.1 s wall, 55.9 CPU-s (+1.5 s wall); glossy 32: 56.5 CPU-s (0.589 per sample, +7.7 %); total/glossy/transmission 64: 60.4 CPU-s (0.629 per sample, +15 %); 1 thread: 52.3 s wall, 52.2 CPU-s (same CPU time, twice the wall-clock). — [log_exp11_timing.txt](/home/claude/scratch/23-lab/log_exp11_timing.txt)
- **[M] Stone crop (288 × 242), CPU-seconds:** 64 spp 13.4–13.9; 256 spp 50.4–54.0; 1024 spp 204–211 (seeds 0–4); 1024 spp with OIDN 216; depth (b) 231, (c) 203, (d) 254. That is 0.20 CPU-s per sample for 69.7 thousand pixels, most of them stone. — [results.jsonl](/home/claude/scratch/23-lab/results.jsonl)
- **[M] Adaptive sampling at 0.01** used 103.7 CPU-s against 106.5 for fixed 512 spp on the stone crop (−2.7 %). — [log_exp02_adaptive.txt](/home/claude/scratch/23-lab/log_exp02_adaptive.txt)
- **[M] Ring view, 256 × 256, 128 spp with OIDN:** 12.4–13.0 CPU-s per render; 32 spp: about 3.1–3.3 s per frame while the machine was shared. — [results.jsonl](/home/claude/scratch/23-lab/results.jsonl)
- **[M] Whole lab:** 349 renders, 6,258 CPU-seconds (52.1 minutes on two cores), 4,407 s of summed render wall-clock. — [results.jsonl](/home/claude/scratch/23-lab/results.jsonl)

### Inferences
- [E] Scaling by pixels and samples from 0.547 CPU-s per sample at 0.262 megapixels (2.1 CPU-s per sample per megapixel): a 1600 × 1600 close-up at 160 samples would take about 860 CPU-seconds, roughly 7 minutes on these two cores when quiet; at 256 samples about 11.5 minutes; at 1024 samples about 46 minutes. A wider shot with less stone in frame costs less per pixel (the ring view measured about 1.5 CPU-s per sample per megapixel with OIDN included). These are scalings, not measurements, and say nothing about a GPU or an Apple laptop.
- [E] At the workflow's threshold of 0.01 adaptive sampling saves almost nothing on a stone close-up, so it is not a reason to accept an uncertain sample count; fixed samples cost 3 % more here.

### Gaps
- No timing above 512 px, none on a GPU, none on Apple hardware.
- Timings were taken on a shared virtual machine; CPU-seconds were stable to a few percent between repeats, wall-clock was not.
- Memory use was not measured.
