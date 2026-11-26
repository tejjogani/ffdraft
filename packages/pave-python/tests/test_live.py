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
