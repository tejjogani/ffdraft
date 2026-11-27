import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from queue import Queue

from pave import RpcError, Studio


def piece(version):
    return {
        "id": "ring",
        "version": version,
        "design": {
            "order": ["band", "head"],
            "nodes": {
                "head": {"id": "head", "kind": "setting"},
                "band": {"id": "band", "kind": "ringShank"},
            },
        },
    }


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.put((self.path, body))
        status, payload = self.server.replies.get_nowait()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def log_message(self, *_):
        pass


class StudioTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.server.requests = Queue()
        self.server.replies = Queue()
        worker = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        worker.start()
        self.addCleanup(worker.join)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.studio = Studio(f"http://127.0.0.1:{self.server.server_port}/")
        self.reply(piece(0))

    def reply(self, value, status=200):
        self.server.replies.put((status, value))

    def request(self, command):
        path, body = self.server.requests.get_nowait()
        self.assertEqual(path, f"/api/rpc/{command}")
        return body

    def project(self):
        project = self.studio.project("ring")
        self.assertEqual(self.request("pieces.get"), {"id": "ring"})
        return project

    def test_read_features_in_design_order(self):
        project = self.project()
        self.assertEqual(project.version, 0)
        self.assertEqual(list(project.features), ["band", "head"])
        project.features["head"]["kind"] = "bad"
        self.assertEqual(project.features["head"]["kind"], "setting")

    def test_measured_stone_fit_can_be_previewed_and_committed(self):
        project = self.project()
        fit = {
            "provider": "diaex", "sku": "FIXTURE",
            "measured": {"width": 5.5, "length": 7.2, "depth": 3.3},
        }
        self.reply({"version": 3, "applied": False})
        preview = project.replace_stone("center", fit=fit, dry_run=True)
        expected = {
            "pieceId": "ring", "target": {"nodeId": "center"},
            "change": {"fit": fit}, "dryRun": True,
        }
        self.assertEqual(self.request("design.replaceStone"), expected)
        self.assertEqual(project.version, 0)
        self.reply({"version": 4, "applied": True, "change": {"id": "refit", "seq": 4}})
        project.replace_stone(
            "center", fit=fit, base_version=preview["version"], change_id="refit",
        )
        self.assertEqual(self.request("design.replaceStone"), {
            **expected, "dryRun": False, "baseVersion": 3, "changeId": "refit",
        })
        self.assertEqual(project.version, 4)

    def test_replace_stone_requires_one_sizing_method(self):
        project = self.project()
        for options in ({}, {"carat": 1.0, "fit": {}}):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, "carat or fit"):
                project.replace_stone("center", **options)
        self.assertTrue(self.server.requests.empty())

    def test_apply_uses_a_guard_and_keeps_version_on_old_retry(self):
        project = self.project()
        self.reply({"version": 1, "change": {"id": "move-tip", "seq": 1}})
        project.set_prong_tip_offset("head", 1, 0.25, change_id="move-tip")
        first = self.request("design.apply")
        self.assertEqual(first["baseVersion"], 0)
        self.assertEqual(first["changeId"], "move-tip")
        self.assertEqual(first["pieceId"], "ring")
        self.assertEqual(
            first["ops"],
            [
                {
                    "t": "update",
                    "id": "head",
                    "patch": {"prongTipOffsetsMm": {"1": 0.25}},
                }
            ],
        )

        self.reply({"version": 2, "change": {"seq": 2}})
        project.set_band_thickness("band", base_mm=1.8)
        second = self.request("design.apply")
        self.assertEqual(second["baseVersion"], 1)
        self.assertTrue(second["changeId"])
        self.assertEqual(
            second["ops"],
            [{"t": "update", "id": "band", "patch": {"thicknessBottom": 1.8}}],
        )

        self.reply({"version": 1, "change": {"id": "move-tip", "seq": 1}})
        project.set_prong_tip_offset(
            "head", 1, 0.25, base_version=0, change_id="move-tip"
        )
        self.assertEqual(self.request("design.apply"), first)
        self.assertEqual(project.version, 2)

    def test_native_face_offset_uses_inspected_source_and_version(self):
        project = self.project()
        self.reply({"nativeAssetId": "original", "version": 3, "faces": [{"faceIndex": 2}]})
        listed = project.rhino_cap_faces("sleeve")
        self.assertEqual(self.request("design.rhinoCapFaces"), {"pieceId": "ring", "nodeId": "sleeve"})
        self.reply({"version": 4, "change": {"id": "thicken", "seq": 4}})
        project.offset_rhino_cap("sleeve", listed["nativeAssetId"], listed["faces"][0]["faceIndex"],
                                 0.25, base_version=listed["version"], change_id="thicken")
        self.assertEqual(self.request("design.offsetRhinoCap"), {
            "pieceId": "ring", "nodeId": "sleeve", "nativeAssetId": "original", "faceIndex": 2,
            "baseVersion": 3, "offsetMm": 0.25, "changeId": "thicken",
        })
        self.assertEqual(project.version, 4)

    def test_mount_inspection_reads_only_the_selected_members(self):
        project = self.project()
        bounds = {"min": [-3, -3, 0], "max": [9, 3, 2]}
        inspected = {"version": 3, "bounds": bounds, "parts": [
            {"nodeId": "sleeve", "assetId": "source-a", "native": True, "bounds": bounds},
        ]}
        self.reply(inspected)
        self.assertEqual(project.inspect_mount(iter(["sleeve"])), inspected)
        self.assertEqual(self.request("design.inspectMount"), {
            "pieceId": "ring", "nodeIds": ["sleeve"],
        })
        self.assertEqual(project.version, 0)

    def test_mount_edit_commits_one_guarded_change(self):
        project = self.project()
        cage = {
            "min": [-3, -3, 0], "max": [9, 3, 2],
            "offsets": [[0, 0, 0]] * 7 + [[1.25, 0, 0.2]],
            "mode": "byPart",
        }
        change = {"version": 4, "change": {"id": "reshape", "seq": 4}}
        self.reply(change)
        result = project.edit_mount(
            ["sleeve", "bail"], cage=cage, fit_gem_id="center", material="pt950",
            base_version=3, change_id="reshape",
        )
        self.assertEqual(self.request("design.editMount"), {
            "pieceId": "ring", "nodeIds": ["sleeve", "bail"], "cage": cage,
            "fitGemId": "center", "material": "pt950", "baseVersion": 3,
            "changeId": "reshape",
        })
        self.assertEqual(result, change)
        self.assertEqual(project.version, 4)
        self.reply(piece(4))
        self.assertEqual(list(project.features), ["band", "head"])
        self.assertEqual(self.request("pieces.get"), {"id": "ring"})

    def test_mount_edit_distinguishes_clearing_from_omitting_options(self):
        project = self.project()
        self.reply({"version": 1, "change": {"id": "alloy", "seq": 1}})
        project.edit_mount(["sleeve"], material="pt950", base_version=0, change_id="alloy")
        self.assertEqual(self.request("design.editMount"), {
            "pieceId": "ring", "nodeIds": ["sleeve"], "material": "pt950",
            "baseVersion": 0, "changeId": "alloy",
        })
        self.reply({"version": 2, "change": {"id": "clear", "seq": 2}})
        project.edit_mount(["sleeve"], cage=None, fit_gem_id=None, base_version=1)
        clear = self.request("design.editMount")
        self.assertEqual(clear.pop("changeId")[:4], "chg_")
        self.assertEqual(clear, {
            "pieceId": "ring", "nodeIds": ["sleeve"], "cage": None,
            "fitGemId": None, "baseVersion": 1,
        })

    def test_duplicates_an_exact_rhino_edge_as_one_independent_curve(self):
        project = self.project()
        curve = {"degree": 1, "knots": [0, 2], "controlPoints": [[1, 0, 0, 1], [1, 0, 2, 1]]}
        self.reply({"version": 3, "nativeAssetId": "source", "edgeCount": 6, "edges": []})
        page = project.rhino_edges("sleeve", offset=2, limit=1)
        self.assertEqual(self.request("design.rhinoEdges"), {
            "pieceId": "ring", "nodeId": "sleeve", "offset": 2, "limit": 1,
        })
        self.reply({"version": 3, "nativeAssetId": "source", "curve": curve})
        self.reply({"version": 4, "change": {"id": "duplicate", "seq": 4}})
        result = project.duplicate_rhino_edge(
            "sleeve", 1, "rail", at=page["version"], change_id="duplicate",
        )
        self.assertEqual(self.request("design.rhinoEdges"), {
            "pieceId": "ring", "nodeId": "sleeve", "edgeIndex": 1,
        })
        self.assertEqual(self.request("design.apply"), {
            "pieceId": "ring", "baseVersion": 3, "changeId": "duplicate",
            "label": "Duplicate Rhino edge",
            "ops": [{"t": "add", "node": {"id": "rail", "kind": "nurbsCurve", **curve}}],
        })
        self.assertEqual(result["version"], 4)
        self.assertEqual(project.version, 4)

    def test_duplicates_both_rhino_face_loops_in_one_versioned_edit(self):
        project = self.project()
        curve = {"degree": 1, "knots": [0, 1, 2, 3], "controlPoints": [
            [0, 0, 0, 1], [2, 0, 0, 1], [0, 2, 0, 1], [0, 0, 0, 1],
        ]}
        self.reply({"version": 3, "nativeAssetId": "source", "faceCount": 4, "faces": []})
        page = project.rhino_face_borders("sleeve", offset=2, limit=1)
        self.assertEqual(self.request("design.rhinoFaceBorders"), {
            "pieceId": "ring", "nodeId": "sleeve", "offset": 2, "limit": 1,
        })
        self.reply({"version": 3, "nativeAssetId": "source", "curves": [
            {"kind": "outer", **curve}, {"kind": "inner", **curve},
        ]})
        self.reply({"version": 4, "change": {"id": "copy-loops", "seq": 4}})
        result = project.duplicate_rhino_face_border(
            "sleeve", 3, ["outer-rim", "bore-rim"], at=page["version"], change_id="copy-loops",
        )
        self.assertEqual(self.request("design.rhinoFaceBorders"), {
            "pieceId": "ring", "nodeId": "sleeve", "faceIndex": 3,
        })
        self.assertEqual(self.request("design.apply"), {
            "pieceId": "ring", "baseVersion": 3, "changeId": "copy-loops",
            "label": "Duplicate Rhino face border",
            "ops": [
                {"t": "add", "node": {"id": node, "kind": "nurbsCurve", **curve}}
                for node in ["outer-rim", "bore-rim"]
            ],
        })
        self.assertEqual(result["version"], 4)

    def test_rhino_face_border_refuses_missing_loop_ids_and_stale_versions(self):
        project = self.project()
        self.reply({"version": 4, "nativeAssetId": "source", "curves": [
            {"kind": "outer"}, {"kind": "inner"},
        ]})
        with self.assertRaisesRegex(ValueError, "one unique node ID"):
            project.duplicate_rhino_face_border("sleeve", 3, ["one"], at=4)
        self.request("design.rhinoFaceBorders")
        self.assertTrue(self.server.requests.empty())
        self.reply({"version": 4, "nativeAssetId": "source", "curves": []})
        with self.assertRaises(RpcError) as raised:
            project.duplicate_rhino_face_border("sleeve", 3, ["one", "two"], at=3)
        self.assertEqual(raised.exception.status, 409)
        self.request("design.rhinoFaceBorders")
        self.assertTrue(self.server.requests.empty())

    def test_rhino_edge_duplication_refuses_an_outdated_selection(self):
        project = self.project()
        self.reply({"version": 4, "nativeAssetId": "new-source", "curve": {
            "degree": 1, "knots": [0, 2], "controlPoints": [[1, 0, 0, 1], [1, 0, 2, 1]],
        }})
        with self.assertRaises(RpcError) as error:
            project.duplicate_rhino_edge("sleeve", 1, "rail", at=3)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(error.exception.details["currentVersion"], 4)
        self.request("design.rhinoEdges")
        self.assertTrue(self.server.requests.empty())

    def test_conflict_keeps_guard_until_explicit_refresh(self):
        project = self.project()
        self.reply(
            {
                "error": {
                    "code": "conflict",
                    "message": "Project changed",
                    "currentVersion": 1,
                }
            },
            status=409,
        )
        with self.assertRaises(RpcError) as raised:
            project.set_band_thickness("band", base_mm=1.8)
        self.assertEqual(self.request("design.apply")["baseVersion"], 0)
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(raised.exception.code, "conflict")
        self.assertEqual(raised.exception.details, {"currentVersion": 1})
        self.assertEqual(project.version, 0)
        self.reply(piece(1))
        project.refresh()
        self.assertEqual(project.version, 1)

    def test_preview_uses_replace_stone_without_changing_known_version(self):
        project = self.project()
        self.reply({"version": 1, "applied": False, "after": {"caratTotal": 1.25}})
        preview = project.replace_stone("center", carat=1.25, dry_run=True)
        self.assertEqual(
            self.request("design.replaceStone"),
            {
                "pieceId": "ring",
                "target": {"nodeId": "center"},
                "change": {"carat": 1.25},
                "dryRun": True,
            },
        )
        self.assertEqual(preview["after"]["caratTotal"], 1.25)
        self.assertEqual(project.version, 0)

    def test_section_tools_keep_order_and_use_the_observed_project_version(self):
        project = self.project()
        self.reply({"version": 1, "change": {"seq": 1}})
        project.loft(["lower", "rim"], feature_id="head", ruled=True, change_id="head-1")
        body = self.request("design.apply")
        self.assertEqual((body["baseVersion"], body["changeId"]), (0, "head-1"))
        self.assertEqual(body["ops"][0]["node"], {
            "kind": "loft", "id": "head", "sections": ["lower", "rim"],
            "ruled": True, "capped": True,
        })
        self.reply({"version": 2, "change": {"seq": 2}})
        project.rail_sweep(["inner", "outer"], ["top"], feature_id="shoulder", capped=False)
        body = self.request("design.apply")
        self.assertEqual(body["baseVersion"], 1)
        self.assertEqual(body["ops"][0]["node"], {
            "kind": "railSweep", "id": "shoulder", "rails": ["inner", "outer"],
            "sections": ["top"], "capped": False,
        })

    def test_thicken_surface_keeps_the_source_and_uses_signed_millimetres(self):
        project = self.project()
        self.reply({"version": 1, "change": {"seq": 1}})
        project.thicken_surface("shoulder", feature_id="shoulder-metal", thickness_mm=-0.8,
                                change_id="thicken-1")
        body = self.request("design.apply")
        self.assertEqual((body["baseVersion"], body["changeId"]), (0, "thicken-1"))
        self.assertEqual(body["ops"], [{"t": "add", "node": {
            "kind": "thickenSurface", "id": "shoulder-metal", "surface": "shoulder",
            "thickness": 0.8, "reverse": True,
        }}])

    def test_revolve_uses_the_project_edit_guard_and_measured_axis(self):
        project = self.project()
        self.reply({"version": 1, "change": {"seq": 1}})
        project.revolve_curve("outline", solid_id="bezel", axis="horizontal",
                              axis_offset_mm=-2, angle_degrees=180, change_id="spin-1")
        body = self.request("design.apply")
        self.assertEqual((body["baseVersion"], body["changeId"]), (0, "spin-1"))
        self.assertEqual(body["ops"], [{"t": "add", "node": {
            "id": "bezel", "kind": "revolve", "curve": "outline", "axis": "horizontal",
            "axisOffset": -2, "angle": 180,
        }}])

    def test_set_mesh_vertices_binds_to_the_observed_source_and_version(self):
        project = self.project()
        self.reply({"version": 1, "change": {"seq": 1}})
        project.set_mesh_vertices("mount", "asset_1", {12: (2, 3, 4)}, base_version=0)
        body = self.request("design.apply")
        self.assertEqual(body["baseVersion"], 0)
        self.assertEqual(body["ops"], [{"t": "update", "id": "mount", "patch": {
            "meshEdits": {"assetId": "asset_1", "vertices": {"12": [2, 3, 4]}}
        }}])

    def test_make_wire_names_its_rail_and_preserves_the_edit_guard(self):
        project = self.project()
        self.reply({"version": 1, "change": {"seq": 1}})
        project.make_wire(
            "rail",
            wire_id="custom-band",
            width_mm=2.4,
            thickness_mm=1.8,
            section="halfRound",
            change_id="make-1",
        )
        first = self.request("design.apply")
        self.assertEqual(first["changeId"], "make-1")
        self.assertEqual(first["baseVersion"], 0)
        self.assertEqual(
            first["ops"],
            [
                {
                    "t": "add",
                    "node": {
                        "id": "custom-band",
                        "kind": "pipe",
                        "curve": "rail",
                        "section": "halfRound",
                        "width": 2.4,
                        "thickness": 1.8,
                    },
                }
            ],
        )

    def test_prong_offset_rejects_invalid_indices_and_measurements(self):
        project = self.project()
        for prong, offset in [(0, 0), (9, 0), (1, -0.51), (8, 0.51), (1, float("nan"))]:
            with self.subTest(prong=prong, offset=offset), self.assertRaises(
                ValueError
            ):
                project.set_prong_tip_offset("head", prong, offset)
        self.assertTrue(self.server.requests.empty())
