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
