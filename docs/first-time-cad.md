# First-time CAD guide

Open a project, choose CAD builder, then choose CAD guide to follow these steps in the editor. You can close the guide at any time and reopen it while you work. Manual editing works without Claude.

## Select the part you want to change

Click a part in the 3D view or choose its name in Features. On a solitaire, Band is the ring and Head is the metal setting around the centre stone. The Inspector shows controls for the selected part.

On a smaller screen, use the Features and Inspector buttons above the model to open those panels. If your project is empty, start with a template to try the material and stone controls.

## Bring in an existing Rhino model

Open the destination project’s CAD builder and choose Import model. Pick a .3dm and check its layers and selected dimensions in millimetres. Leave out display stands and lighting geometry. Imported solids start as Sculpted body features with 18k yellow gold assigned. You can measure a stone-shaped body here. Stone counts and Diaex sourcing use Pavé stone features. For a metal-only casting, leave out gemstone layers too. If stones and metal share a layer, separate them in Rhino first.

Turn on Include editable curves to import supported curves as NURBS from the selected layers. Pavé keeps the original NURBS degree, knots and weights and places the control points in world millimetres. Converted lines, arcs and connected joined curves preserve their shape and parameter domain. Converted arcs and joined curves can use different parameter spacing along the same shape.

Supported closed Rhino B-reps and extrusions with complete saved render meshes retain a native solid alongside the display mesh. Look for Rhino surface retained in the Inspector. Rhino export can write that solid back to .3dm after supported native edits. For a project that used the earlier mesh-only importer, re-import the original .3dm to bring in native solids or editable curves. Keep the original for Rhino construction history and plug-in data.

Review the skipped objects before choosing Import. Select the new parts in Features to change their material, finish or transform. Undo removes the batch import in one edit. From a reopened project, use History and choose Revert on the import.

## Move a Rhino end face

Select a retained Rhino solid in Features and choose Move end face in the Inspector. This works on parts with two matching planar ends and straight walls between them, such as a straight sleeve. The editor explains when it cannot offer a face pair.

Choose the moving face by its direction or centre in project coordinates. The opposite face stays fixed. Enter a positive offset in millimetres to add thickness or a negative offset to remove it. The dialog shows the resulting thickness before you choose Move face. Through-holes keep their cross-section, and the edited part stays eligible for native Rhino export. Use Undo or Redo in CAD to compare the two shapes.

## Copy an edge as a design curve

In Features, select an imported part with a retained Rhino solid. Choose Copy edge as curve, then click its outline in the drawing or enter the edge number. Use Top, Front or Right to separate edges that overlap on screen. Choose Copy curve. The new curve appears in Features and has its own Edit control points tool. Editing the curve leaves the original part in place.

## Copy a Rhino face’s borders

Select a retained Rhino solid in Features and choose Copy face borders in the Inspector. Choose an eligible face by number and inspect the outline and holes in the preview. Use Next faces to browse larger solids. Copy borders creates one independent curve for the outer border and one per hole. Undo removes all curves made by that copy. The solid stays in place.

## Edit a Rhino curve

For a curve imported as NURBS, select its name in Features and choose Edit control points. Click a point on the dashed control polygon or enter its point number, then drag it in the selected view or type X, Y and Z in millimetres. The solid line previews the curve. Adjust Weight to change how strongly a point attracts the curve. Save points records one edit. Export as Rhino .3dm to bring the edited curve back into Rhino.

## Take an assembly back into Rhino

In the CAD builder, choose Export, then For Rhino. Open the downloaded .3dm and select two parts that were separate in the source file. Independent imported solids keep their names, layer paths and placement, including parts of the same alloy that touch. Imported construction curves keep their NURBS control points and weights.

Read the export summary for the counts of native solids, curves and evaluated meshes. A mesh edit or a feature that cuts the metal can change the exported geometry type. Choose For casting when you need a watertight STL. Use Save as Pavé file to carry the editable Pavé project to another installation.

## Export a mesh from Rhino

If a solid has no saved render mesh, save the original with its render meshes in Rhino and try the import again. To bring it in as a mesh, select it in Rhino and run Mesh. Preview the result, select the generated mesh objects, then choose File → Export Selected and save as .3dm to carry separate parts and the document units. You can also choose STL. In Pavé, set the STL source units to the same units used for the export and check a known measurement before importing. A single STL comes into Features as one part.

## Edit an imported mesh

Select a Rhino or STL part brought in with Import model and choose Edit mesh in the Inspector. Choose Vertex, Edge or Face, then click a visible component. Orbit the part or choose a view such as Bottom to reach the other side. For an exact vertex, enter its zero-based ID. Type the X, Y and Z displacement in source millimetres to preview the move. Choose Save mesh edit to record one change, or Cancel to discard the preview. Undo reverses the change.

A saved mesh shape edit makes that part export as a mesh in .3dm. Undo the edit to make its retained solid eligible for native Rhino export again.

## Save a portable Pavé file

Choose Pavé file in the export menu. Open the saved .pave on another Pavé installation to keep working with its imported meshes, mesh edits, editable NURBS curves and retained Rhino solids. Review any STEP output in the receiving CAD tool. STEP parity for imported Rhino solids remains unverified.

## Make a ring band thicker or thinner

Select Band. In the Band section of the Inspector, Thickness at top changes the wall near the setting. Thickness at base changes the wall on the palm side. Click a value, type the new measurement in millimetres and press Enter. For example, changing a 1.5 mm base to 1.8 mm adds 0.3 mm there.

Width at top and Width at base control how wide the band looks across your finger. Ring size controls the opening. Use Undo to compare the edit with the original.

## Choose the metal and finish

Select Band, then choose Metal in the Material section of the Inspector. Try 18k Rose Gold for a warmer color. Under Finish, try High polish, Satin, Brushed, Matte / sandblast or Hammered. Use the Rendered view to see the material.

The band and head can use different metals. To change the whole piece at once, right-click empty space in the 3D view and choose Change metal everywhere. To coat a part, open Fine-tune and choose Plating. These controls use material presets. Uploading an arbitrary texture map onto a part is a planned feature.

## Design a different mount

Select Head in Features. Under Style, try Basket. Set Gallery rails to 2, choose Claw under Tip, and adjust Prong wire. Fine-tune gives you Prong rotation and Taper. For an open-sided setting, choose Half bezel and adjust Half-bezel arcs and Bezel wall. The head keeps its link to the centre stone.

On a prong or basket head, pick Prong 1. Use the locate button to see which tip it is. Enter 0.25 mm in Tip offset to move it outward, then press Enter. A negative value moves it inward. For an additional custom solid, use Draw profile, then select the solid and choose Edit profile to change its outline.

## Change the centre stone

Select Centre stone in Features. In the Inspector, use Stone to choose the gem material and color, such as ruby or blue sapphire. Use Cut to change its shape. For an unsourced centre stone, type a target such as 1.25 in the carat weight field marked ct, then press Enter. Width in millimetres updates from the cut and material. The displayed carat value is a geometry estimate.

To swap the stone and adjust its mount together, right-click the stone in the 3D view and choose Replace stone. Review the replacement before applying it.

## Fit a diamond from inventory

Open Stone sourcing for the same project. Find the centre stone, choose Find diamonds (Change diamond for a fitted stone), select a candidate and preview the change. Fit this stone applies the supplier’s measured dimensions to the CAD setting.

A fitted diamond uses the listing’s measurements and carat weight. For an older fit without a listed weight, the inspector shows an estimate from its dimensions. To try a different size, compare another listing. Inventory results depend on your Diaex connection.

## Draw and check your work

Draw profile lets you draw a closed outline or rectangle and extrude it into a solid. Draw curve creates an open or closed construction polyline. Choose Front, Top or Right and click points or enter coordinates in millimetres. The curve can snap to an endpoint or midpoint.

Select the result and use Edit profile or Edit points to revise it. Undo reverses an edit. Open Project history to review changes, or return to the project and open Render studio to set up a shot.

To make a metal wire, draw a construction curve, select it and choose Make wire. Set Wire width and Wire thickness in the inspector. Edit points on the original curve to reshape the wire.

To turn a cross-section into a bezel or band, draw a closed curve on the Front plane. For a practice bezel, enter (3, 0), (5, 0), (5, 4), and (3, 4) in mm. Select the curve and choose Revolve. A vertical axis at 0 mm and a 360° sweep make a 10 mm outer diameter, 6 mm bore and 4 mm height. Choose Create solid. You can change the sweep or axis in the inspector, or choose Edit points on the curve to reshape the bezel.
