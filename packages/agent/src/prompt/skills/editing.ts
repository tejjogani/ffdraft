/** Skill: changing a design by chat. */
export const EDITING_SKILL = `## Skill: editing a design
Use when the designer asks for a change to a piece that has a design.

- Read the piece (pieces.get) unless you already read it at its current version this turn; the context says the version the designer sees. Find the nodes by their kind and name, and use their ids.
- For the selected feature, design_describe gives its current values, exact patch keys, units and limits. Pass the observed version as baseVersion to design_apply. On a version conflict, read the current feature before deciding whether the edit still fits.
- To loft a head or sweep a shoulder, inspect the project's curve IDs with pieces_get. Use design_apply to add a loft with ordered sections, or a railSweep with one or two rails and ordered sections. Each ID must be a different construction or NURBS curve. Keep the section curves in their intended world positions. Set capped to true for closed profiles and casting metal, or false for an open modeling surface. Set ruled on a loft for straight spans. Edit a source curve to rebuild the feature. Verify the evaluation and dimensions before rendering or exporting.
- To turn an uncapped loft or rail sweep into a solid, add a thickenSurface node with its source feature ID in surface and a positive thickness in mm. Set reverse to true for the opposite side. The solid follows source edits. Verify the resulting thickness and that the evaluation built a solid.
- For an imported straight-sided solid, call design_rhinoCapFaces on the selected part. Use design_offsetRhinoCap with the returned face index, native asset ID and version to add or remove thickness in project millimetres while keeping its opposite face and bore fixed. Explain the returned reason if that solid has no supported end faces.
- For a handmade mount, use design_inspectMount on the selected metal member IDs. To keep the original trimmed surfaces choose byPart. To bend continuously across parts choose freeform and explain the evaluated mesh representation for a nonlinear edit. Use design_editMount with the returned bounds and version. Confirm the alloy when an unassigned part will enter casting. Link fitGemId to the particular confirmed stone to follow subsequent supplier measurements. Verify the original sources and the untouched neighboring parts.
- For Rhino jewelry, use design_planImportRoles to preview individually confirmed metal, stone, setting and reference decisions. Ask the jeweler to confirm the species, cut, dimensions, girdle orientation, and the specific head to refit. Use display labels only as hints. Apply the plan with design_apply at the returned version.
- For a measured imported part, design_meshComponents returns source vertices, triangular faces, assetId and version. To move a vertex, set meshEdits.assetId and meshEdits.vertices with that vertex ID and its absolute XYZ position in source millimetres using design_apply at that version. To move an edge or face, move its vertices together in the same update. Reread those IDs and evaluate the result.
- Translate the request into the fewest ops on the right fields. Common requests:
  - band thinner, wider, heavier: ringShank widthTop, widthBottom, thicknessTop, thicknessBottom (keep the base no wider than the top unless asked);
  - ring size: ringShank size;
  - stone sits higher or lower: the gem's placement.elevation;
  - another stone (cut, size, carat, colour, quality): not ops but design_replaceStone, which moves the mount with it (the stone skill below);
  - more or fewer claws, claw shape: the setting's prongCount, prongTip; bezel instead of claws: style bezel;
  - metal: material on every metal node of the piece (band, settings, halo, bail, chain, findings), keeping the karat unless asked; rhodium plating for white gold when they want it bright white;
  - pavé on the shoulders: a gemRow on the band with skipCenter wide enough to clear the head (and the halo, if any); an eternity is coverage 360 with no head;
  - a halo: a halo node around the centre gem; a hidden halo is not buildable (see the caveats);
  - engraving: an engraving node on the band, insideBand by default;
  - pendant from a ring head or a motif: a bail on the body, and a chain through the bail.
- Patches merge: send only the fields that change ({"t":"update","id":"band","patch":{"widthTop":2.4}}). A new node needs its kind, an id and its required fields; the defaults fill the rest. Removing a node another node needs fails unless you remove both (or use cascade, which removes the dependants too; say so).
- One design.apply per request, with a label that says what changed. Several fields that serve one intent go in the same call.
- Read the evaluation that comes back: an error diagnostic you caused means the change is not done. Style findings are the canon's view; follow them unless the designer asked for that look, and when a finding offers a fix, prefer it. Report the numbers that moved (weight, carats, size) in one line.
- Keep the piece coherent: one hero, one variant, at most two metal colours and two finishes, one claw-tip family.
- If a change would make the piece unsound (a band under 1.5 mm under a big stone, a culet touching the finger, soft stones in pavé), make it if the designer insists, and say once what the risk is.`
