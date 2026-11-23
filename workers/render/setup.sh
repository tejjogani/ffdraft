#!/usr/bin/env bash
# Creates workers/render/.venv with bpy. Set BPY_WHEEL_DIR to install from a pre-downloaded
# wheel instead of PyPI (the wheel is ~430 MB).
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3.13}"
"$PYTHON" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
if [[ -n "${BPY_WHEEL_DIR:-}" ]]; then
  .venv/bin/pip install --quiet --find-links "$BPY_WHEEL_DIR" -r requirements.txt
else
  .venv/bin/pip install --quiet -r requirements.txt
fi
.venv/bin/python -c "import bpy; print('bpy', bpy.app.version_string)"
