# Reviewing imported jewelry parts

The source model can tell a jeweler how objects are grouped and displayed. The jeweler decides which objects count as gemstones or casting metal. See the [CAD evidence matrix](../../research/cad-feature-evidence.md).

1. Preserve object and placement display labels, original layer paths, and group memberships through the Rhino reader, project file and Rhino export. Compare source and returned attributes on synthetic blocks.
2. Give each confirmed occurrence a separate gemstone and optional setting linked to its retained source. Test individual, bulk and reversed decisions with no changes to neighboring occurrences.
3. Display unassigned parts in the editor. Exclude them from casting weight and production STL until confirmed. Verify a measured supplier change adjusts a confirmed head and preserves an adjacent head.
4. Expose role review on newly imported and existing projects. Read the original mesh in millimetres to suggest a girdle plane and dimensions. Allow correction before saving. Exercise the workflow from the browser and document it in the first-time guide.

## Verification record

The reader and writer tests exercise actual Rhino group and material tables and affine block references. The kernel tests check initial native geometry, a measured replacement, the linked head, untouched neighboring metal and STL, STEP and 3DM output. Studio browser checks cover keyboard selection, individual exclusions, isolated source copies, bulk pairing and Undo. The Python client previews and applies the same decisions against the running server.

Two local whole-assembly readbacks preserved the supported solids and curves and left the source file digests unchanged. A disposable assembly with an outlying copy yielded the expected stone count after review. The production mass excluded all unconfirmed solids. The sourcing browser check used fixture inventory and the real geometry engine.

A linked head currently represents one separately identified source body. Reconstruction of a multi-solid handmade setting, recovery of third-party modeling history and identifying a gemstone species from its mesh remain open.
