# The Pavé file (`.pave`)

A `.pave` file is one piece with everything that makes it, so it can move between computers,
installs and organisations and open exactly as it was saved.

**Saving and opening a `.pave` file is always free.** It never counts against the plan. Rhino
(`.3dm`) and STEP exports are what the plan counts (the monthly free allowance, see
`packages/schema/src/plans/config.ts`); STL, 3MF, OBJ and GLB stay free.

- In the studio: **Export → Pavé file** in the CAD toolbar, **Save as Pavé file** in a piece's
  options menu or the ⌘K palette; **Open Pavé file** on the Pieces page or the palette (⌘O), or
  drop a `.pave` file anywhere on the window.
- Over the API: `pieces.saveFile {id}` returns the file as an asset; `pieces.openFile {assetId}`
  opens an uploaded file as a new piece. Neither is an assistant or MCP tool yet.
- Contract: `packages/schema/src/files/pave.ts`. Code: `apps/server/src/pavefile/`
  (`save.ts`, `open.ts`, `zip.ts`).

## The container

A zip archive (deflate or stored entries only; no encryption, no ZIP64, no folders of its own).
Names are fixed; there is nothing else in a file.

| Entry | What it holds |
| --- | --- |
| `mimetype` | `application/vnd.pave.piece+zip`, first and uncompressed, so a file can be recognised from its first bytes |
| `manifest.json` | Format version, app and version, dates, the piece's title and kind, provenance, a summary of the contents, and the size and SHA-256 of every other entry |
| `checksum.sha256` | The SHA-256 of `manifest.json` (`<hex>  manifest.json`) |
| `piece.json` | The piece: title, kind, stage, brief, spec, the design document, its version, cover, facts, origin, directions (each with its built design), the chosen direction |
| `history.json` | Every change of the design, oldest first: `id`, `seq`, `ops`, `inverse`, `actor`, `userId`, `label`, `at`, `reverts` |
| `references.json` | The piece's pin board (title, description, icon) and its pinned references with source, credit, licence, rights, tags, palette, generation record, canvas placement and image plane |
| `shots.json` | The saved shots: title, the full render scene (camera, look, lights, motion, output), position, who made it |
| `assets.json` | Every picture the records point at: the id they use, its entry, name, type and size |
| `assets/<sha256>.<ext>` | The pictures themselves, named by the SHA-256 of their bytes (identical pictures are stored once) |
| `thumbnails/cover.webp` | The cover, 256 px wide, for file browsers |
| `geometry/exact.step` | Not written any more (a STEP is a counted export); files from earlier versions may carry it, and readers accept it |
| `geometry/display.glb` | The display meshes, with stones and materials |

All JSON is UTF-8. Ids inside a file are the ids the piece had where it was saved; they only
link records within the file. Opening gives everything new ids.

### `manifest.json`

```jsonc
{
  "format": "pave",
  "formatVersion": 1,
  "app": { "name": "Pavé", "version": "0.1.0" },
  "createdAt": "…",   // when the piece was first made, wherever that was
  "modifiedAt": "…",  // its last change
  "savedAt": "…",     // this save
  "save": { "fileId", "savedAt", "app", "appVersion", "formatVersion", "pieceId", "org" },
  "earlier": [ /* saves it travelled through before this one, oldest first (at most 31) */ ],
  "piece": { "title": "…", "kind": "ring" },
  "contents": { "changes", "directions", "references", "referencesWithoutPictures", "shots", "assets", "geometry": ["step", "glb"] },
  "files": { "piece.json": { "bytes": 1234, "sha256": "…" }, … }
}
```

`org` is a fingerprint of the organisation that saved the file: an HMAC of its id under a key
derived from that install's auth secret. It tells an opener whether the file was saved here,
without putting an organisation's id or name in the file.

## What is inside, and what is not

Inside: the design document and its **full change history** (who made each change, a person or
an assistant run, so undo and the trace of how the piece was made survive), the spec, the
directions with their built designs and previews, the cover, pinned references, image planes,
saved shots, and the evaluated geometry.

Not inside:

- **Pictures whose rights do not let them travel.** Only `open` (open access) and `own` (the
  organisation's own) pictures go in the file. A `licensed` picture (the licence may cover only
  this organisation) or a `viewOnly` one stays behind; its reference still goes in with
  `withheld: true`, its title, source, credit, licence and rights, so whoever opens the file
  knows what it was and where to find it. Its image plane is dropped (there is nothing to show).
  Artwork a piece was made from follows the same rule.
- **Geometry for a piece made from artwork nobody has confirmed they may use.** Its file carries
  the design without `geometry/`, and says so, until a person confirms the rights.
- Renders and takes, production packages, the assistant's conversations, moodboards other than
  the piece's pins, the history of shot changes, members and settings.

The geometry is a cache for viewers and future fast opening. The design is the truth: opening
rebuilds from it and does not read the GLB. The exact STEP is left out: a `.pave` is free, and
an ordinary zip, so a STEP inside it would be an uncounted STEP export for anyone who unzipped
it. Files saved by earlier versions may still carry `geometry/exact.step`; they open as before.

## Opening

Nothing in a file is trusted. In order:

1. **Limits, from the zip's own directory, before anything is unpacked:** the whole file at most
   256 MB, at most 1200 entries, any entry at most 128 MB unpacked, all entries together at most
   512 MB, any JSON entry at most 32 MB. Each entry is inflated in 16 KB steps and refused the
   moment it grows past the size it declared, so a zip bomb or a file that lies about sizes
   cannot fill memory. Encrypted, ZIP64, split and exotically compressed entries are refused.
2. **Names:** every entry name must be one of the names above. A name like `../x`, `/etc/x`,
   `C:/x` or `a\b`, a duplicate name, or a name the local header and the directory disagree on
   refuses the whole file (no zip-slip). Nothing is ever written to disk under a name from a
   file: pictures are stored by their content hash.
3. **Integrity:** `mimetype` must be exact; `checksum.sha256` must match `manifest.json`; every
   entry must be listed in the manifest with the right size and SHA-256, and every listed entry
   must be there.
4. **Version:** a file of a newer format version is refused with "saved by a newer version of
   Pavé … Update Pavé to open it". Older files are migrated (below).
5. **Records:** every JSON entry is validated against its schema; the design document is
   migrated and validated (references between nodes, no cycles, each node listed once); every id
   a record uses (cover, origin, previews, references' pictures, the chosen direction, undo
   records in the history) must point at something the file carries; the history's sequence
   numbers must increase and end at or before the design's version.
6. **Writing:** only then, in one transaction, the pictures, the piece, its history, its pin
   board and references and its shots are written under new ids. Opening the same file twice
   makes two pieces. A refused file writes nothing.

### Provenance

A piece opened from a file records `provenance`: when it was first made, every save it travelled
through (oldest first, at most 32), the file's name, when and by whom it was opened, and whether
the file was saved elsewhere (another organisation or another install). The piece's Overview
shows it. The history keeps each change's original author. Saving the piece again carries the
trail on.

A rights confirmation (attestation) for a piece made from artwork is a statement by a person in
the organisation that saved the file. It is kept only when the file was saved here; opened
elsewhere, a person there must confirm it again before the piece can be exported.

## Versioning rules

- `formatVersion` is an integer. It changes only when a reader of the previous version would
  misread a file (a field changes meaning, an entry moves, a record is reshaped).
- **Adding is not a change.** A new optional field or a new entry keeps the version: readers
  ignore what they do not know, and every field added later is optional in the schemas.
- A reader opens its own version and every older one, migrating step by step:
  `PAVE_FILE_MIGRATIONS` in `apps/server/src/pavefile/open.ts` holds one step per older version
  (version 1 is the first, so it is empty). A breaking change adds the step from the old
  version, and older files keep opening.
- A reader refuses newer versions rather than guessing.
- The design document inside has its own version (`design.schemaVersion`), migrated by
  `migrateDesign` (`packages/schema/src/design/design.ts`). A document without a version
  (version 0) is brought up to version 1; fields a node gained since are filled with their
  defaults; a document from a newer Pavé is refused.
