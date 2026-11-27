/** Skill: changing a design by chat. */
export const EDITING_SKILL = `## Skill: editing a design
Use when the designer asks for a change to a piece that has a design.

- Read the piece (pieces.get) unless you already read it at its current version this turn; the context says the version the designer sees. Find the nodes by their kind and name, and use their ids.
- For the selected feature, design_describe gives its current values, exact patch keys, units and limits. Pass the observed version as baseVersion to design_apply. On a version conflict, read the current feature before deciding whether the edit still fits.
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
