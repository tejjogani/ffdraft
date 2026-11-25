# Renderer spike for research 15

The scripts behind section 6 of [`../../15-own-renderer.md`](../../15-own-renderer.md). They are research scripts, not product code.

One ring (a round brilliant in a four-prong gold ring on a ground plane, in a procedural studio) is built once by `make_scene.py` and rendered by five engines:

| Script | Engine |
|---|---|
| `render_mitsuba.py` | Mitsuba 3, spectral, with a dispersive material written for the spike |
| `render_cycles.py` | Blender Cycles through `bpy`, in its own process (GPL; never linked into the product) |
| `render_luxcore.py` | LuxCore |
| `ptgem.c` | Our own small tracer in C: the stone as planes, one wavelength per path |
| `ptgem.wgsl` with `render_wgsl.py` | The same tracer as one WebGPU compute shader |

`run_all.sh` and `run2.sh` are the runs as they were made; `results.jsonl` and `results2.jsonl` are the timings; `tonemap.py` is the one display transform shared by all engines; `analyse.py` gives the distance of each image from the reference.

`comparison.jpg` shows the results. Top row, the stone: the Mitsuba reference at 2,057 samples, Cycles, our C tracer, our WGSL shader. Bottom row, the whole ring: the reference, Cycles, our C tracer, LuxCore.

**These timings are from a shared 2-core Linux CPU with no GPU.** They are not the founder's laptop. Section 6.6 of the research file gives the commands to repeat the spike on an Apple M2 with Metal.

The rendered images and the exported scene are not in the repository; `make_scene.py` regenerates the scene.
