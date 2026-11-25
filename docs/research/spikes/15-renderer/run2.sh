#!/bin/bash
# Second batch: own tracer after the light-occlusion fix, Mitsuba timings and references, WGSL kernel.
cd "$(dirname "$0")"
while ! grep -q DONE results.jsonl; do sleep 5; done
R=512; D=32
for CAM in hero macro; do
  ./ptgem scene $CAM $R 512 $D out/own_${CAM}_disp.raw >> results2.jsonl && venv/bin/python raw2npy.py out/own_${CAM}_disp.raw
done
./ptgem scene macro $R 512 $D out/own_macro_meshgem.raw meshgem >> results2.jsonl
./ptgem scene macro $R 512 $D out/own_macro_nodisp.raw nodisp >> results2.jsonl && venv/bin/python raw2npy.py out/own_macro_nodisp.raw
venv/bin/python render_mitsuba.py hero 256 nodisp $R $D 2>/dev/null | tail -1 >> results2.jsonl
venv/bin/python render_mitsuba.py hero 512 disp $R $D 2>/dev/null | tail -1 >> results2.jsonl
venv/bin/python render_mitsuba.py macro 256 nodisp $R $D 2>/dev/null | tail -1 >> results2.jsonl
venv/bin/python render_mitsuba.py macro 512 disp $R $D 2>/dev/null | tail -1 >> results2.jsonl
for CAM in hero macro; do
  WGPU_BACKEND_TYPE=OpenGL venv/bin/python render_wgsl.py $CAM 256 $R $D 2>/dev/null | grep '^{"engine' >> results2.jsonl
done
# Converged references (Mitsuba, dispersive, 2048 spp), kept under separate names.
for CAM in hero macro; do
  venv/bin/python render_mitsuba.py $CAM 2048 disp $R $D 2>/dev/null | tail -1 >> results2.jsonl
  mv out/mitsuba_${CAM}_disp.npy out/ref_${CAM}_disp2048.npy
  venv/bin/python render_mitsuba.py $CAM 512 disp $R $D 2>/dev/null | tail -1 >> results2.jsonl
done
echo DONE >> results2.jsonl
