#!/bin/bash
# run.sh '<json job or list of jobs>'  -> one fresh Blender process, prints the LAB_RESULT lines.
cd "$(dirname "$0")"
/home/claude/scratch/15/venv-bpy/bin/python lab.py "$1" 2>&1 | grep -E "LAB_RESULT|Error|Traceback|error" 
