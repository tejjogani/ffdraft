# SPDX-License-Identifier: GPL-3.0-or-later
"""Which Cycles GPU backends to try, in order, on this platform (kept free of bpy for tests).

A Mac has exactly one GPU backend, Metal, which drives the Apple GPU of every M-series Mac
(a MacBook Air included) and AMD GPUs in Intel Macs; it is tried first so a Mac never spends
time probing NVIDIA, AMD or Intel backends that macOS builds do not have. Elsewhere OptiX
(RTX cards) comes before CUDA, then AMD's HIP and Intel's oneAPI; Metal last, where it is
never compiled in.
"""

from __future__ import annotations

_ORDER = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")
_MAC_ORDER = ("METAL",)


def backend_order(platform: str, forced: str = "") -> tuple[str, ...]:
    """GPU backends to probe for `platform` (`sys.platform`); `forced` names one to use alone.

    `PAVE_CYCLES_DEVICE=CPU` is handled by the caller; any other value is a backend name.
    """
    forced = forced.strip().upper()
    if forced:
        return (forced,)
    return _MAC_ORDER if platform == "darwin" else _ORDER
