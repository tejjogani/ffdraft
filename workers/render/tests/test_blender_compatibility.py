# SPDX-License-Identifier: GPL-3.0-or-later
"""Run inside Blender with --background --python-exit-code 1 --python <this file>."""

import sys
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

try:
    import bpy
except ImportError:
    bpy = None

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@unittest.skipUnless(bpy is not None, "requires Blender's shader nodes")
class BlenderCompatibility(unittest.TestCase):
    def test_transparent_gem_with_optional_dispersion_socket(self):
        from pave_worker.materials import build_materials

        material = build_materials({"emerald": {
            "kind": "gem", "ior": 1.58, "attenuationDistance": 5.0,
            "attenuationColor": (0.1, 0.75, 0.35),
        }})["emerald"]
        shader = material.node_tree.nodes.get("Principled BSDF")
        self.assertEqual(shader.inputs["Transmission Weight"].default_value, 1.0)
        self.assertAlmostEqual(shader.inputs["IOR"].default_value, 1.58, places=4)
        self.assertTrue(material.node_tree.nodes.get("Material Output").inputs["Volume"].is_linked)
        dispersion = shader.inputs.get("Transmission Dispersion Scale")
        if dispersion is not None:
            self.assertEqual(dispersion.default_value, 0.0)


    def test_shot_materials_and_sparkle_follow_each_native_mesh_assignment(self):
        from pave_worker.scene import import_piece

        with TemporaryDirectory() as directory:
            archive = Path(directory) / "linked-import.glb"
            mesh = bpy.data.meshes.new("Original facet")
            mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
            bpy.ops.object.select_all(action="DESELECT")
            originals = []
            for i, name in enumerate(("ImportedDiamond", "ImportedEmerald", "Clay")):
                obj = bpy.data.objects.new(name, mesh)
                bpy.context.scene.collection.objects.link(obj)
                obj.location.x = i * 2.0
                obj["role"] = "metal"  # Original CAD bodies have no confirmed stone role.
                obj.select_set(True)
                originals.append(obj)
            bpy.ops.export_scene.gltf(filepath=str(archive), use_selection=True, export_extras=True)
            for obj in originals:
                bpy.data.objects.remove(obj, do_unlink=True)

            optics = {"kind": "gem", "ior": 2.417, "attenuationDistance": 5,
                      "attenuationColor": [1, 1, 1]}
            _, gems = import_piece(archive, {
                "rig": {"pivot": [0, 0, 0]},
                "assignments": {"ImportedDiamond": "d", "ImportedEmerald": "e", "Clay": "c"},
                "materials": {
                    "d": optics, "e": {**optics, "ior": 1.58, "attenuationColor": [0.1, 0.6, 0.2]},
                    "c": {"kind": "surface", "color": [0.3] * 3, "roughness": 0.5, "ior": 1.45,
                          "subsurfaceMm": 0, "coat": 0, "thinFilm": None},
                },
            })
            self.assertEqual({obj.name for obj in gems}, {"ImportedDiamond", "ImportedEmerald"})
            self.assertEqual([bpy.data.objects[n].material_slots[0].material.name for n in
                              ("ImportedDiamond", "ImportedEmerald", "Clay")], ["d", "e", "c"])
            self.assertEqual(len({bpy.data.objects[n].data.as_pointer() for n in
                                  ("ImportedDiamond", "ImportedEmerald", "Clay")}), 1)


    def test_still_settings_and_video_encoding(self):
        import numpy as np
        from pave_worker.imageio import write_png
        from pave_worker.render import configure, encode_video

        configure({
            "width": 32, "height": 32, "samples": 1, "noiseThreshold": 0.1,
            "bounces": {"total": 4, "transmission": 2, "glossy": 1, "diffuse": 1, "transparent": 4},
            "clampDirect": 0, "clampIndirect": 0, "filterGlossy": 0, "denoise": False, "seed": 0,
        }, {"view": "agx", "exposure": 0}, animated=False)
        self.assertEqual(bpy.context.scene.render.image_settings.file_format, "PNG")
        with TemporaryDirectory() as directory:
            folder = Path(directory)
            for i in range(2):
                frame = np.full((32, 32, 4), float(i), dtype=np.float32)
                write_png(folder / f"frame_{i:04d}.png", frame, alpha=False)
            movie = encode_video(folder, 2, 12, 32, 32, folder)
            self.assertIsNotNone(movie)
            self.assertGreater(movie.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main(argv=[__file__])
