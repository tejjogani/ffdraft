import json
import os
import unittest
from urllib.request import Request, urlopen
from uuid import uuid4

from pave import RpcError, Studio


@unittest.skipUnless(
    os.environ.get("PAVE_TEST_URL"), "Set PAVE_TEST_URL to a disposable Pavé server"
)
class LiveCadTest(unittest.TestCase):
    def test_read_edit_retry_and_undo_over_http(self):
        url = os.environ["PAVE_TEST_URL"].rstrip("/")
        request = Request(
            f"{url}/api/rpc/pieces.create",
            data=json.dumps(
                {"templateId": "solitaire", "title": "Python CAD test"}
            ).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=60) as response:
            piece_id = json.load(response)["id"]

        studio = Studio(url)
        project = studio.project(piece_id)
        stale = studio.project(piece_id)
        version = project.version
        self.assertEqual(project.features["head"]["gem"], "center")
        head = project.describe("head")
        self.assertEqual(head["version"], version)
        self.assertEqual(head["kind"], "setting")
        self.assertEqual(head["nodeId"], "head")
        self.assertEqual(head["values"]["gem"], "center")
        self.assertIn("prongTipOffsetsMm", head["schema"]["properties"])

        change_id = f"chg_{uuid4().hex}"
        first = project.set_prong_tip_offset(
            "head", 1, 0.25, base_version=version, change_id=change_id
        )
        self.assertEqual(project.version, version + 1)
        self.assertEqual(project.features["head"]["prongTipOffsetsMm"], {"1": 0.25})
        repeated = project.set_prong_tip_offset(
            "head", 1, 0.25, base_version=version, change_id=change_id
        )
        self.assertEqual(repeated, first)
        self.assertEqual(
            sum(change["id"] == change_id for change in project.history()), 1
        )

        with self.assertRaises(RpcError) as rejected:
            stale.set_band_thickness("band", base_mm=1.8)
        self.assertEqual(rejected.exception.status, 409)
        self.assertEqual(rejected.exception.details["currentVersion"], version + 1)
        stale.refresh()
        self.assertEqual(stale.version, version + 1)

        band = project.features["band"]
        before = project.evaluate()
        project.set_band_thickness("band", base_mm=1.8)
        self.assertEqual(project.features["band"]["thicknessBottom"], 1.8)
        self.assertEqual(project.features["band"]["thicknessTop"], band["thicknessTop"])
        self.assertEqual(project.features["band"]["size"], band["size"])
        self.assertGreater(project.evaluate()["metalMassG"], before["metalMassG"])

        old_width = project.features["center"]["width"]
        preview = project.replace_stone("center", carat=1.25, dry_run=True)
        self.assertFalse(preview["applied"])
        self.assertAlmostEqual(preview["after"]["caratTotal"], 1.25, places=2)
        self.assertEqual(
            studio.project(piece_id).features["center"]["width"], old_width
        )
        result = project.replace_stone(
            "center", carat=1.25, base_version=preview["version"]
        )
        self.assertTrue(result["applied"])
        self.assertAlmostEqual(project.evaluate()["caratTotal"], 1.25, places=2)
        self.assertGreater(project.features["center"]["width"], old_width)

        project.undo(result["change"]["seq"])
        self.assertEqual(project.features["center"]["width"], old_width)
        self.assertEqual(project.features["head"]["prongTipOffsetsMm"], {"1": 0.25})

        points = [{"id": "a", "u": 0, "v": 0}, {"id": "b", "u": 10, "v": 0}]
        project.apply(
            [
                {
                    "t": "add",
                    "node": {
                        "id": "rail",
                        "kind": "curve",
                        "plane": "top",
                        "points": points,
                    },
                }
            ],
            "Draw a 10 mm rail",
        )
        wire = project.make_wire(
            "rail", wire_id="custom-wire", width_mm=1, thickness_mm=1
        )
        initial_mass = project.evaluate()["metalMassG"]
        points[1]["u"] = 20
        stretch = project.apply(
            [{"t": "update", "id": "rail", "patch": {"points": points}}],
            "Extend the rail to 20 mm",
        )
        self.assertGreater(project.evaluate()["metalMassG"], initial_mass)
        reopened = studio.project(piece_id)
        self.assertEqual(reopened.features["custom-wire"]["curve"], "rail")
        reopened.undo(stretch["change"]["seq"])
        self.assertAlmostEqual(
            reopened.evaluate()["metalMassG"], initial_mass, places=5
        )
        reopened.undo(wire["change"]["seq"])
        self.assertNotIn("custom-wire", reopened.features)
        self.assertIn("rail", reopened.features)


        # The Python tool makes the same linked solid as the editor.
        profile = {
            "id": "bezel-section", "kind": "curve", "plane": "front", "closed": True,
            "points": [{"id": str(i), "u": u, "v": v}
                       for i, (u, v) in enumerate([(3, 0), (5, 0), (5, 4), (3, 4)])],
        }
        reopened.apply([{"t": "add", "node": profile}], "Draw a bezel section")
        before = reopened.evaluate()["metalMassG"]
        result = reopened.revolve_curve("bezel-section", solid_id="bezel")
        self.assertGreater(reopened.evaluate()["metalMassG"], before)
        current = studio.project(piece_id)
        self.assertEqual(current.features["bezel"]["curve"], "bezel-section")
        current.undo(result["change"]["seq"])
        self.assertAlmostEqual(current.evaluate()["metalMassG"], before, places=4)

    def test_customer_revision_of_a_halo_ring(self):
        studio = Studio(os.environ["PAVE_TEST_URL"])
        piece = studio._rpc("pieces.create", {"templateId": "halo", "title": "Halo revision"})
        project = studio.project(piece["id"])
        original = project.evaluate(detail="production")
        self.assertEqual(original["stoneCount"], 31)
        fit = {
            "provider": "diaex", "sku": "WORKSHOP-FIXTURE",
            "measured": {"length": 6.4, "width": 6.3, "depth": 4.0},
        }
        preview = project.replace_stone("center", fit=fit, dry_run=True)
        self.assertFalse(preview["applied"])
        self.assertNotIn("sourcing", studio.project(piece["id"]).features["center"])
        project.replace_stone("center", fit=fit, base_version=preview["version"])
        fitted = project.evaluate(detail="production")
        center = next(lot for lot in fitted["lots"] if lot["role"] == "center")
        self.assertEqual((center["length"], center["width"]), (6.4, 6.3))
        self.assertGreater(fitted["boundsMm"]["y"], original["boundsMm"]["y"])
        self.assertGreater(fitted["metalMassG"], original["metalMassG"])

        resize = project.apply(
            [{"t": "update", "id": "band", "patch": {"size": {"system": "us", "value": 7}}}],
            "Change the finger size",
        )
        reopened = studio.project(piece["id"])
        features = reopened.features
        self.assertEqual(features["band"]["size"]["value"], 7)
        self.assertEqual(features["head"]["gem"], "center")
        self.assertEqual(features["halo"]["around"], "center")
        self.assertEqual(features["row"]["host"], "band")
        self.assertEqual(features["center"]["sourcing"]["sku"], fit["sku"])
        resized = reopened.evaluate(detail="production")
        self.assertEqual(resized["lots"], fitted["lots"])
        self.assertGreater(resized["boundsMm"]["x"], fitted["boundsMm"]["x"])
        self.assertGreater(resized["metalMassG"], fitted["metalMassG"])

        reopened.undo(resize["change"]["seq"])
        self.assertEqual(reopened.features["band"]["size"]["value"], 6)
        self.assertEqual(reopened.features["center"]["sourcing"]["sku"], fit["sku"])
        restored = reopened.evaluate(detail="production")
        self.assertAlmostEqual(restored["metalMassG"], fitted["metalMassG"], places=5)
        self.assertEqual(restored["lots"], fitted["lots"])

    def test_linked_sections_and_sweeps_over_http(self):
        studio = Studio(os.environ["PAVE_TEST_URL"].rstrip("/"))
        piece = studio._rpc("pieces.create", {"kind": "other", "title": "Python shoulder study"})
        project = studio.project(piece["id"])
        points = [{"id": str(i), "u": u, "v": v}
                  for i, (u, v) in enumerate([(0, 0), (4, 0), (4, 2), (0, 2)])]
        sections = [{"kind": "curve", "id": name, "plane": "top", "closed": True,
                     "points": points, "planeOffset": height}
                    for name, height in [("base", 0), ("rim", 10)]]
        rails = [
            {"kind": "nurbsCurve", "id": "straight", "degree": 1, "knots": [0, 1],
             "controlPoints": [[0, 0, 0, 1], [0, 0, 10, 1]]},
            {"kind": "nurbsCurve", "id": "bowed", "degree": 2, "knots": [0, 0, 1, 1],
             "controlPoints": [[4, 0, 0, 1], [9, 0, 3, 1], [4, 0, 10, 1]]},
        ]
        project.apply([{"t": "add", "node": node} for node in sections + rails], "Draw curves")
        create = project.loft(["base", "rim"], feature_id="head", ruled=True)
        self.assertAlmostEqual(project.evaluate()["metals"][0]["volumeMm3"], 80, places=3)
        edit = project.apply(
            [{"t": "update", "id": "rim", "patch": {"planeOffset": 12}}], "Raise the rim"
        )
        project = studio.project(piece["id"])
        self.assertAlmostEqual(project.evaluate()["metals"][0]["volumeMm3"], 96, places=3)
        project.undo(edit["change"]["seq"])
        project.undo(create["change"]["seq"])
        one = project.rail_sweep(["straight"], ["base"], feature_id="shoulder")
        self.assertAlmostEqual(project.evaluate()["metals"][0]["volumeMm3"], 80, places=3)
        project.undo(one["change"]["seq"])
        project.rail_sweep(["straight", "bowed"], ["base"], feature_id="shoulder")
        self.assertAlmostEqual(project.evaluate()["metals"][0]["volumeMm3"], 113.333, places=2)

    def test_imported_mesh_vertex_edit_export_and_undo(self):
        import struct

        url = os.environ["PAVE_TEST_URL"].rstrip("/")
        studio = Studio(url)
        project_id = studio._rpc("pieces.create", {"title": "Python mesh edit test"})["id"]
        project = studio.project(project_id)
        # Write a closed tetrahedron so the exported top vertex gives an independent measurement.
        mesh = b"v 0 0 0\nv 0 4 0\nv 4 0 0\nv 0 0 4\nf 1 2 3\nf 1 3 4\nf 3 2 4\nf 2 1 4\n"
        boundary = uuid4().hex
        prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="mount.obj"'
                  '\r\nContent-Type: model/obj\r\n\r\n').encode()
        upload = Request(url + "/api/assets", data=prefix + mesh + f"\r\n--{boundary}--\r\n".encode(),
                         headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
        with urlopen(upload, timeout=60) as response:
            source = json.load(response)["id"]
        project.apply([{"t": "add", "node": {
            "kind": "meshBody", "id": "mount", "source": {"type": "asset", "assetId": source},
            "keepSourcePlacement": True,
        }}], "Import mount")
        self.assertNotIn("importRole", project.features["mount"])
        self.assertGreater(project.evaluate()["metalMassG"], 0)
        components = project.mesh_components("mount")
        top = next(v["id"] for v in components["vertices"] if v["xyz"][2] == 4)
        edit = project.set_mesh_vertices("mount", components["assetId"], {top: (0, 0, 4.25)},
                                         base_version=components["version"])
        reopened = studio.project(project_id)
        self.assertEqual(reopened.mesh_components("mount", vertex_ids=[top], face_ids=[])["vertices"],
                         [{"id": top, "xyz": [0, 0, 4.25]}])
        file = studio._rpc("design.export", {"pieceId": project_id, "format": "stl", "stones": False})
        with urlopen(url + file["asset"]["url"], timeout=60) as response:
            data = response.read()
        faces = struct.unpack_from("<I", data, 80)[0]
        self.assertEqual(len(data), 84 + 50 * faces)
        max_z = max(struct.unpack_from("<f", data, 84 + i * 50 + 20 + j * 12)[0]
                    for i in range(faces) for j in range(3))
        self.assertAlmostEqual(max_z, 4.25)
        reopened.undo(edit["version"])
        self.assertEqual(reopened.mesh_components("mount", vertex_ids=[top])["vertices"][0]["xyz"], [0, 0, 4])
