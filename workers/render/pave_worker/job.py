"""Typed view of the job file written by `@pave/render/node` (see packages/render/src/types.ts).

The worker reads only what this module declares; every number is explicit in the job, so the
runner contains no defaults that could drift from the TypeScript resolver.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, NotRequired, TypedDict

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]  # x, y, z, w
Rgb = tuple[float, float, float]

MM = 0.001
"""The job is in millimetres (the Evaluation frame); Blender scenes are in metres."""


class Camera(TypedDict):
    target: Vec3
    azimuth: float
    elevation: float
    distance: float
    focalLength: float
    sensorWidth: float
    focusDistance: float
    fStop: float | None
    near: float
    far: float


class Panel(TypedDict):
    id: str
    position: Vec3
    quaternion: Quat
    size: tuple[float, float]
    radiance: Rgb
    gradient: tuple[float, float]


class Sparkle(TypedDict):
    position: Vec3
    radius: float
    intensity: Rgb


class Ambient(TypedDict):
    zenith: Rgb
    horizon: Rgb
    nadir: Rgb


class Rig(TypedDict):
    pivot: Vec3
    rotation: float
    panels: list[Panel]
    sparkles: list[Sparkle]
    ambient: Ambient


class Background(TypedDict):
    kind: Literal["transparent", "solid", "gradient"]
    color: NotRequired[Rgb]
    top: NotRequired[Rgb]
    bottom: NotRequired[Rgb]


class Ground(TypedDict):
    kind: Literal["none", "shadow", "sweep", "reflective"]
    z: NotRequired[float]
    size: NotRequired[float]
    azimuth: NotRequired[float]
    center: NotRequired[Vec3]
    profile: NotRequired[list[tuple[float, float]]]
    width: NotRequired[float]
    color: NotRequired[Rgb]
    roughness: NotRequired[float]
    ior: NotRequired[float]


class Relief(TypedDict):
    kind: Literal["cells", "grain"]
    sizeMm: float
    strength: float


class Material(TypedDict):
    kind: Literal["metal", "gem", "surface"]
    # metal
    color: NotRequired[Rgb]
    edgeTint: NotRequired[Rgb]
    roughness: NotRequired[float]
    anisotropy: NotRequired[float]
    brushAxis: NotRequired[Vec3]
    relief: NotRequired[Relief | None]
    # gem / surface
    ior: NotRequired[float]
    abbe: NotRequired[float]
    attenuationColor: NotRequired[Rgb]
    attenuationDistance: NotRequired[float]
    subsurfaceMm: NotRequired[float]
    thinFilm: NotRequired[tuple[float, float] | None]
    coat: NotRequired[float]


Ease = Literal["linear", "easeIn", "easeOut", "easeInOut"]


class Keyframe(TypedDict):
    frame: int
    value: float
    ease: Ease


class Animation(TypedDict):
    fps: int
    frameCount: int
    loop: bool
    tracks: dict[str, list[Keyframe]]


class Bounces(TypedDict):
    total: int
    transmission: int
    glossy: int
    diffuse: int
    transparent: int


class Output(TypedDict):
    width: int
    height: int
    samples: int
    noiseThreshold: float
    bounces: Bounces
    clampDirect: float
    clampIndirect: float
    filterGlossy: float
    denoise: bool
    seed: int


class ColorSettings(TypedDict):
    view: Literal["agx", "neutral"]
    exposure: float


class Scene(TypedDict):
    version: int
    look: str
    color: ColorSettings
    camera: Camera
    rig: Rig
    background: Background
    ground: Ground
    materials: dict[str, Material]
    assignments: dict[str, str]
    animation: Animation | None
    output: Output


class Job(TypedDict):
    scene: Scene
    glb: str
    outDir: str


SUPPORTED_VERSION = 1


def load_job(path: Path) -> Job:
    job: Job = json.loads(path.read_text(encoding="utf-8"))
    version = job["scene"]["version"]
    if version != SUPPORTED_VERSION:
        raise ValueError(f"Unsupported resolved scene version {version}; runner supports {SUPPORTED_VERSION}")
    return job
