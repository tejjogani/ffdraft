# Pavé Python client

Open and edit CAD projects on a running Pavé server from Python 3.10 or later. The client uses the Python standard library at runtime.

## Install locally

From the Pavé checkout, create a virtual environment and install the package in editable mode.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ./packages/pave-python
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1` in PowerShell.

## Edit a project

Start Pavé, open a project in the studio, and copy the project ID from its URL. The `head`, `band`, and `center` feature IDs in this example are from a classic solitaire. Use `project.features` to find the IDs in your design.

```python
from uuid import uuid4

from pave import Studio

project = Studio("http://127.0.0.1:8787").project("pc_your_project_id")
print(project.version, list(project.features))

head = project.describe("head")
print(head["schema"]["properties"]["prongTipOffsetsMm"])

# Move prong tip 1 outward by 0.25 mm and set the base of the band to 1.8 mm.
project.set_prong_tip_offset(
    "head", 1, 0.25, base_version=head["version"], change_id=f"chg_{uuid4().hex}"
)
project.set_band_thickness("band", base_mm=1.8)

# Preview a 1.25 ct stone and the resulting fit, then apply at the previewed version.
preview = project.replace_stone("center", carat=1.25, dry_run=True)
print(preview["after"], preview["warnings"])
project.replace_stone("center", carat=1.25, base_version=preview["version"])

print(project.evaluate()["metalMassG"])
print(project.history(limit=5))
```

Prong numbering starts at 1 and proceeds counterclockwise from the stone’s local +X axis, viewed from above. Tip offsets range from −0.5 to +0.5 mm. Positive offsets move tips outward.

`project.apply(ops, label, base_version=..., change_id=...)` accepts CAD operations. `project.undo(seq)` reverts the saved change with that sequence number using Pavé's history checks. `project.refresh()` reads the latest features and version.

`apply` and committed `replace_stone` requests default to the last known version. If Pavé raises `RpcError` with status `409`, use `project.refresh()` and review the current design before retrying. Pass your own `change_id` when you need to retry safely after a `TransportError`. Keep the original payload, base version, and change ID on that retry.

## Run the tests

```sh
python -m unittest discover -s packages/pave-python/tests
```

To include the live HTTP test, set `PAVE_TEST_URL` to a disposable Pavé server with geometry enabled. The live test creates and edits a solitaire project.

## Sweep a wire along a drawn curve

Select **Draw curve** in the CAD builder and draw the path. Select the curve and choose **Make wire**, or pass its feature ID to Python. The new wire keeps the source curve's plane and closure. Editing a point changes the wire. Width and thickness are in millimetres.

```python
project.make_wire(
    "rail", wire_id="custom-wire", width_mm=1.5, thickness_mm=1.0, section="halfRound"
)
```

## Review an imported part’s role

Use the source feature ID from the open project. The role plan previews the same choices as the Studio review dialog. Apply it at the returned version to record one undoable edit.

```python
plan = project.plan_import_roles([{"sourceId": "working-copy", "role": "reference"}])
if plan["ops"]:
    project.apply(plan["ops"], "Confirm the working copy as a reference", base_version=plan["version"])
```

## Edit a handmade mount

Pass the feature IDs of the imported parts you confirmed as metal. Inspection returns
each part's source asset ID, whether it retains native geometry, and the part and selection
bounds in project millimetres. Use the returned version to guard the edit.

```python
members = ["lower-gallery", "upper-gallery"]
mount = project.inspect_mount(members)
cage = {
    "min": mount["bounds"]["min"],
    "max": mount["bounds"]["max"],
    "offsets": [[0, 0, 0] for _ in range(7)] + [[0.25, 0, 0.15]],
    "mode": "byPart",
}
changed = project.edit_mount(
    members, cage=cage, material="pt950", base_version=mount["version"],
)
project.undo(changed["change"]["seq"])
```

The cage has eight corners. Index each one by `x + 2*y + 4*z`, using 0 for
the minimum and 1 for the maximum along each axis. Each offset is an XYZ vector
in project millimetres. `byPart` applies a separate affine transform to each
member and allows export as placed native geometry where the source permits it.
`freeform` applies the full trilinear warp and exports the evaluated mesh for
nonlinear edits.

Use `fit_gem_id` to link the selected members to the original girdle of a confirmed
imported stone. A measured replacement then refits those members using its length,
width and depth in millimetres.

```python
gem_id = "centre-stone"
mount = project.inspect_mount(members)
project.edit_mount(members, fit_gem_id=gem_id, base_version=mount["version"])
fit = {
    "provider": "diaex",
    "sku": "supplier-stone-id",
    "measured": {"length": 7.2, "width": 5.5, "depth": 3.3},
}
preview = project.replace_stone(gem_id, fit=fit, dry_run=True)
project.replace_stone(gem_id, fit=fit, base_version=preview["version"])
```

Pass `cage=None` or `fit_gem_id=None` to clear that setting. Omit it to keep its
saved value. Pass the same `change_id`, base version and arguments to retry
a write after a transport error.

## Edit a point on an imported part

Read the part's mesh to get source-space coordinates and stable vertex IDs. A face contains three vertex IDs. To move a complete face, pass new coordinates for all three in the same edit. The asset ID and project version bind the edit to the geometry you inspected.

```python
mesh = project.mesh_components("mount", vertex_ids=[12], face_ids=[])
x, y, z = mesh["vertices"][0]["xyz"]
edit = project.set_mesh_vertices(
    "mount", mesh["assetId"], {12: (x, y, z + 0.25)}, base_version=mesh["version"]
)
project.undo(edit["version"])
```

### Move a native Rhino end face

Select a straight-sided Rhino sleeve or plate with retained native geometry. Inspect the end faces and choose the one whose outward normal points in the direction you want to extend. Distances are signed project millimetres. This example extends the upper end and keeps the opposite end and through-holes fixed.

```python
ends = project.rhino_cap_faces("sleeve")
upper = next(face for face in ends["faces"] if face["normal"][2] > 0.999)
change = project.offset_rhino_cap(
    "sleeve", ends["nativeAssetId"], upper["faceIndex"], 0.25,
    base_version=ends["version"],
)
project.undo(change["version"])
```

If the returned list is empty, read `reason` for the geometry requirement.

### Duplicate a native Rhino edge

Page through the native edges of an imported Rhino solid using `offset` and `limit`, with up to 100 edges per page. Choose a zero-based edge index from the previews. The duplicate becomes an independent, editable NURBS curve in project millimetres, with the original edge's trimmed shape and direction stored as exact knots and weighted control points.

```python
edges = project.rhino_edges("sleeve")
change = project.duplicate_rhino_edge(
    "sleeve", edges["edges"][0]["edgeIndex"], "sleeve-rim", at=edges["version"],
)
project.undo(change["version"])
```

Pass an `edge_index` to `rhino_edges` to inspect the exact definition before duplicating. The `at` argument guards the version from the edge selection.

### Duplicate a native Rhino face border

Page through the source face indices with `rhino_face_borders`, up to 30 per page. `faceCount` includes ineligible faces, so a page can be empty. Pass a zero-based `face_index` to inspect one face's exact closed outer and inner curves in project millimetres.

```python
border = project.rhino_face_borders("sleeve", face_index=3)
changed = project.duplicate_rhino_face_border(
    "sleeve", 3, ["outside-rim", "inside-rim"], at=border["version"],
)
project.undo(changed["version"])
```

Supply one new node ID per loop in the returned order, outer first. All curves are added in one versioned edit. A face with a seam, a repeated edge, an edgeless trim or a gap returns its reason.

## Edit a NURBS control point

Use the project feature ID and the version returned by `describe`. Each control point stores Euclidean XYZ in millimetres and a rational weight. This example moves an interior point of an open curve 0.25 mm while preserving its weight, knots and degree.

```python
rail = project.describe("gallery-rail")
points = rail["values"]["controlPoints"]
points[2][2] += 0.25
project.apply(
    [{"t": "update", "id": "gallery-rail", "patch": {"controlPoints": points}}],
    "Raise gallery rail control point",
    base_version=rail["version"],
)
```
