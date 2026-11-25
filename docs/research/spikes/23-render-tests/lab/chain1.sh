#!/bin/bash
# Runs the stone-crop experiments one after another (never two renders at once).
cd "$(dirname "$0")"
for e in exp02_adaptive exp04_seed exp05_depth exp06_clamp exp07_dispersion exp08_denoise; do
  python3 $e.py > log_$e.txt 2>&1
  echo "done $e $(date +%T)" >> chain1.log
done
