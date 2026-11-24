# SPDX-License-Identifier: GPL-3.0-or-later
"""Pavé render runner: a fixed, reviewed program — never generated code.

    python pave_render.py job.json                  # bpy wheel (workers/render/.venv)
    blender -b -P pave_render.py -- job.json        # a regular Blender 5.3 install

The job is a ResolvedScene from @pave/render plus the GLB and output paths (see
pave_worker/job.py). Writes the render (render.png, or frames/ plus render.mp4|webm), the
subject matte (mask.png) and result.json with the critique metrics into the job's outDir.
Progress goes to stdout as one JSON object per line: {"progress": 0.42}.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pave_worker.job import load_job  # noqa: E402
from pave_worker.metrics import measure  # noqa: E402
from pave_worker.render import (  # noqa: E402
    configure,
    encode_video,
    render_frames,
    render_mask,
    render_still,
    select_device,
)
from pave_worker.scene import build_scene  # noqa: E402


def progress(value: float) -> None:
    print(json.dumps({"progress": round(min(1.0, max(0.0, value)), 3)}), flush=True)


def job_argument(argv: list[str]) -> Path:
    args = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]
    if len(args) != 1:
        raise SystemExit("usage: pave_render.py job.json  |  blender -b -P pave_render.py -- job.json")
    return Path(args[0])


def run(job_path: Path) -> dict[str, object]:
    started = time.monotonic()
    job = load_job(job_path)
    scene = job["scene"]
    out = Path(job["outDir"])
    out.mkdir(parents=True, exist_ok=True)
    progress(0.0)

    groups = build_scene(scene, Path(job["glb"]))
    device = select_device()
    animation = scene["animation"]
    configure(scene["output"], scene["color"], animated=animation is not None)
    progress(0.05)

    files: dict[str, object] = {}
    if animation:
        folder, image, rendered = render_frames(out, scene["background"], animation["frameCount"], progress)
        files["frames"] = [str(p) for p in sorted(folder.glob("frame_*.png"))]
        video = None
        if scene["background"]["kind"] != "transparent":  # H.264/VP9 here carry no alpha
            o = scene["output"]
            video = encode_video(folder, animation["frameCount"], animation["fps"], o["width"], o["height"], out)
        files["video"] = str(video) if video else None
    else:
        final, image, rendered = render_still(out, scene["background"], progress)
        files["image"] = str(final)
    progress(0.92)

    mask_path = out / "mask.png"
    coverage = render_mask(mask_path, groups["ground"])
    files["mask"] = str(mask_path)
    result = {
        "files": files,
        "metrics": measure(image, coverage, rendered),
        "device": device,
        "seconds": round(time.monotonic() - started, 2),
    }
    (out / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    progress(1.0)
    return result


if __name__ == "__main__":
    run(job_argument(sys.argv))
