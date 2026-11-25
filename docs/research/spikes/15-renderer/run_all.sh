#!/bin/bash
# Runs every spike render one after another and logs one JSON line per render to results.jsonl.
cd "$(dirname "$0")"
R=512; D=32
log() { echo "$1" >> results.jsonl; }
: > results.jsonl
for CAM in hero macro; do
  venv/bin/python render_mitsuba.py $CAM 256 nodisp $R $D 2>/dev/null | tail -1 >> results.jsonl
  venv/bin/python render_mitsuba.py $CAM 512 disp $R $D 2>/dev/null | tail -1 >> results.jsonl
  venv-bpy/bin/python render_cycles.py $CAM 256 disp $R $D 2>/dev/null | grep PAVE_RESULT | sed 's/PAVE_RESULT //' >> results.jsonl
  ./ptgem scene $CAM $R 512 $D out/own_${CAM}_disp.raw >> results.jsonl && venv/bin/python raw2npy.py out/own_${CAM}_disp.raw
  venv-lux/bin/python render_luxcore.py $CAM 192 disp $R $D 2>/dev/null | grep '^{"engine' >> results.jsonl
done
venv-bpy/bin/python render_cycles.py hero 64 disp_oidn $R $D 2>/dev/null | grep PAVE_RESULT | sed 's/PAVE_RESULT //' >> results.jsonl
venv-bpy/bin/python render_cycles.py macro 256 nodisp $R $D 2>/dev/null | grep PAVE_RESULT | sed 's/PAVE_RESULT //' >> results.jsonl
venv-lux/bin/python render_luxcore.py hero 192 caustic $R $D 2>/dev/null | grep '^{"engine' >> results.jsonl
./ptgem scene macro $R 512 $D out/own_macro_meshgem.raw meshgem >> results.jsonl
./ptgem scene macro $R 512 $D out/own_macro_nodisp.raw nodisp >> results.jsonl && venv/bin/python raw2npy.py out/own_macro_nodisp.raw
echo DONE >> results.jsonl
