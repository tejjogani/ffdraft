# SPDX-License-Identifier: GPL-3.0-or-later
"""Run with: python3 -m unittest discover -s workers/render/tests (no Blender needed)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pave_worker.devices import backend_order  # noqa: E402


class BackendOrder(unittest.TestCase):
    def test_mac_uses_metal_only(self) -> None:
        self.assertEqual(backend_order("darwin"), ("METAL",))

    def test_others_prefer_optix_then_cuda(self) -> None:
        for platform in ("linux", "win32"):
            order = backend_order(platform)
            self.assertEqual(order[:2], ("OPTIX", "CUDA"))
            self.assertIn("HIP", order)
            self.assertEqual(order[-1], "METAL")

    def test_forced_backend_alone(self) -> None:
        self.assertEqual(backend_order("darwin", "cuda "), ("CUDA",))
        self.assertEqual(backend_order("linux", "METAL"), ("METAL",))


if __name__ == "__main__":
    unittest.main()
