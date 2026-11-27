# First-time CAD guide

Open a project, choose CAD builder, then choose CAD guide to follow these steps in the editor. You can close the guide at any time and reopen it while you work. Manual editing works without Claude.

## Select the part you want to change

Click a part in the 3D view or choose its name in Features. On a solitaire, Band is the ring and Head is the metal setting around the centre stone. The Inspector shows controls for the selected part.

On a smaller screen, use the Features and Inspector buttons above the model to open those panels. If your project is empty, start with a template to try the material and stone controls.

## Bring in an existing Rhino model

Open the destination project’s CAD builder and choose Import model. Pick a .3dm and check its layers and selected dimensions in millimetres. Leave out display stands and lighting geometry. For a metal-only casting, leave out gemstone layers too. If stones and metal share a layer, separate them in Rhino first. Pavé treats each included part as a mesh body.

Review the skipped objects before choosing Import. You can select the new parts in Features and change their material, finish or transform. Undo removes the import in one edit. After reopening the project, use History and choose Revert on the import. Keep the original .3dm for Rhino curves, editable surfaces, and design history.

## Edit a Rhino curve

For a curve imported as NURBS, select its name in Features and choose Edit control points. Click a point on the dashed control polygon or enter its point number, then drag it in the selected view or type X, Y and Z in millimetres. The solid line previews the curve. Adjust Weight to change how strongly a point attracts the curve. Save points records one edit.

## Export a mesh from Rhino

If a solid has no saved display mesh, select it in Rhino and run Mesh. Preview the result, select the generated mesh objects, then choose File → Export Selected and save as .3dm to carry separate parts and the document units. You can also choose STL. In Pavé, set the STL source units to the same units used for the export and check a known measurement before importing. A single STL comes into Features as one part.

## Make a ring band thicker or thinner

Select Band. In the Band section of the Inspector, Thickness at top changes the wall near the setting. Thickness at base changes the wall on the palm side. Click a value, type the new measurement in millimetres and press Enter. For example, changing a 1.5 mm base to 1.8 mm adds 0.3 mm there.

Width at top and Width at base control how wide the band looks across your finger. Ring size controls the opening. Use Undo to compare the edit with the original.

## Choose the metal and finish

Select Band, then choose Metal in the Material section of the Inspector. Try 18k Rose Gold for a warmer color. Under Finish, try High polish, Satin, Brushed, Matte / sandblast or Hammered. Use the Rendered view to see the material.

The band and head can use different metals. To change the whole piece at once, right-click empty space in the 3D view and choose Change metal everywhere. To coat a part, open Fine-tune and choose Plating. These controls use material presets. Uploading an arbitrary texture map onto a part is a planned feature.

## Design a different mount

Select Head in Features. Under Style, try Basket. Set Gallery rails to 2, choose Claw under Tip, and adjust Prong wire. Fine-tune gives you Prong rotation and Taper. For an open-sided setting, choose Half bezel and adjust Half-bezel arcs and Bezel wall. The head keeps its link to the centre stone.

On a prong or basket head, pick Prong 1. Use the locate button to see which tip it is. Enter 0.25 mm in Tip offset to move it outward, then press Enter. A negative value moves it inward. Editing its individual mesh vertices and faces is outside the current editor. For an additional custom solid, use Draw profile, then select the solid and choose Edit profile to change its outline.

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
