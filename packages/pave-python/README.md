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
