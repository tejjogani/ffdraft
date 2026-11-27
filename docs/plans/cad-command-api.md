# CAD commands for designers, Python and Claude

A designer should be able to adjust one prong in the inspector, ask Claude to make the same edit, or repeat it on a batch of projects from Python. All three paths must change the same geometry and produce an inspectable project history. Manual CAD runs locally without a model key. The existing render, export and assistant plan settings are separate.

## What to borrow

| Product | Design decision for Pavé |
| --- | --- |
| Rhino | RhinoScriptSyntax takes persistent object IDs and documents arguments, examples and return values per command. Use saved feature IDs in the API. Keep each method scoped to a project, since Pavé feature IDs such as `head` can recur in different pieces. [Rhino objects in Python](https://developer.rhino3d.com/en/guides/rhinopython/python-rhinoscriptsyntax-objects/) · [RhinoScriptSyntax reference](https://developer.rhino3d.com/en/api/RhinoScriptSyntax/) |
| MatrixGold | Multi-Prong Edit, Curve on Object and parametric Gem Creator cover concrete jeweler tasks. Start with selecting one prong and giving it a measured edit. Later, support named selections for multiple prongs and curves attached to surfaces. [MatrixGold feature guide](https://gemvision.com/matrixgold/version/4.0) |
| Blender | Blender exposes editable scene data and callable operators to Python. Give Pavé operators discoverable arguments and make them callable with explicit targets, even when the editor is closed. [Blender Python API quickstart](https://github.com/blender/blender/blob/main/doc/python_api/rst/info_quickstart.rst) |
| CadQuery | Workplanes separate the plane of a drawing from its position in 3D. Edge, face and vertex selectors express intent. Carry the plane through each curve operation and design stable subobject selection before exposing general edge edits. [CadQuery workplanes](https://github.com/CadQuery/cadquery/blob/master/doc/workplane.rst) · [Selectors](https://github.com/CadQuery/cadquery/blob/master/doc/selectors.rst) |

## Release targets

Mac is the primary design and hands-on trial platform. Exercise each new CAD command in the Mac browser, from Python and through the project-scoped assistant. Windows x64 has a separate compatibility check for startup, CAD edits, Python and the managed render engine. Track Windows ARM64 separately.

## The command contract

1. Select a project and read `pieces.get`. Its design contains ordered feature IDs. Coordinates are millimetres, Z is up and angles are degrees. A ring's finger axis is Y.
2. Call `design.describe` with `pieceId` and `nodeId`. It returns the version, current values and the feature's input JSON Schema, including unit, range, default, applicability and reference metadata where provided. This comes from the schema used by the editor. Changing stone size or cut goes through the specialized `design.replaceStone` command so the mount can follow.
3. Write one intention as one `design.apply` with the version inspected, a readable label, a unique change ID and one or more operations. A merge patch changes only the named fields. If the document has moved, reread before deciding whether the old edit still makes sense. A retry of the same edit reuses its change ID.
4. Check `design.evaluate` for geometry facts and diagnostics. Inspect `design.history` for operations, inverse, sequence number and actor. Use `design.revert` to undo one sequence or one assistant run. Overlapping later changes can prevent a revert.
5. In the assistant's tool list these operations use underscores, for example `design_describe`. The CAD job and the project conversation dispatch them through the same server registry. A designer can work through the inspector without calling an assistant.

The [Python package](../../packages/pave-python/README.md) contains callable examples. A script uses the permissions of its local session. Local scripts produce user edits. For an assistant tool call the server records the run ID and tool-call ID on the change.

## Implementation order

The [jewelry command inventory](../research/12-rhino-parity.md) lists the wider Rhino and plug-in scope. The [freeform implementation plan](freeform-cad.md) covers geometry dependencies and previous kernel experiments. Each row below has a concrete acceptance example. A planned row is ready for designers only after the example passes in the actual editor and the public command path.

| Increment | Starting point | Acceptance example |
| --- | --- | --- |
| Project and feature discovery | Shared command registry, parametric inspector, editable construction curves, drawn profiles and extrusion | Inspect a band's valid thickness range, edit only its base from Python or the inspector, evaluate its mass, then undo. Refuse an attempt from a project chat to write a different piece. |
| One prong at a time | Generated prong and basket heads | Change the tip of prong 1 by +0.25 mm. Compare the edited claw and each untouched claw, stone and gallery. Verify setting attachment, reopen and undo. A prong-tip control is a constrained geometric edit. Moving arbitrary vertices still needs a mesh editor. |
| Wire along a drawn curve | **Make wire** links a wire to a drawn construction curve. Existing inline-point pipes remain readable. | Select an existing construction curve and give the wire a section and dimensions. Move a point, reopen and export. Its wire and metal mass must follow without reselection. |
| Revolve, one-rail sweep, then loft | Revolve builds an editable solid from a closed construction curve in Studio, Python and the shared design API. Legacy SVG radius-height profiles still work. One-rail sweep with a selectable profile and loft are outstanding. | Revolve a bezel profile. Sweep a shoulder between measured sections. Loft a custom head, edit an earlier section and verify the exported body and orientation. Ship each tool separately. |
| Solid and edge operations | Parametric booleans; exact edge finishing requires durable subobject selection | Cut a seat, identify the intended edge after a resize, then fillet or chamfer it. Failed construction must leave a recoverable document. Verify the resulting solid independently. |
| Direct editing and exchange | Rhino and STL import with measured mesh placement, point editing for Pavé construction curves, existing export routes | Select a mesh vertex or face on a custom mount and move it by a measured amount. Preserve the selection on reopen, undo, and compare exported geometry to the edited shape. Surface control points, trimmed NURBS and SubD need separate milestones and fixtures. |

The project import accepts up to 500 selected mesh parts per edit. The Rhino reader accepts a 64 MiB file and up to one million triangles after expanding placed blocks. Large assemblies can be split in Rhino by layer. The .3dm route carries names, layers, placement and document units. A single STL carries surface triangles and imports as one part with the chosen units. The posted mesh becomes part of the saved project. Keep the original Rhino document to retain editable NURBS, curves and plugin data. [Rhino Mesh command](https://docs.mcneel.com/rhino/8/help/en-us/commands/mesh.htm) · [Rhino STL export](https://docs.mcneel.com/rhino/8mac/help/en-us/fileio/stereolithography_stl_import_export.htm)

## Trace quality

Project history answers what changed, who changed it, and how to reverse it. An assistant run also has ordered tool inputs, results, errors, and a link to the resulting changes. A useful regression replays a request on a disposable project and verifies the observed shape, bounds, mass or other task-specific result. A tool returning success alone is insufficient. The project-scoping regression includes a refused cross-project read and ensures that the other project keeps its original version.

The organisation's evaluation-use setting defaults off. An opted-in organisation can export anonymised numeric before/after examples for band dimensions and individual prong tips from an explicitly chosen project. The exporter reconstructs each edit from its inverse and writes a local JSONL file. Designers can review ordinary history with evaluation use off. Training and shared dataset infrastructure are future work. [Evaluation example format and export guide](../cad-evaluation-examples.md)
